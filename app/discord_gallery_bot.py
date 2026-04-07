from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from pathlib import Path
import logging
import os

import discord

from db import db_conn, load_conf
from gallery_upload_service import (
    GalleryActor,
    GalleryUploadPreparedFile,
    GalleryUploadError,
    extract_candidate_shot_at_from_image_bytes,
    perform_gallery_upload,
)

logger = logging.getLogger(__name__)

IMAGE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@dataclass(frozen=True)
class BotConfig:
    token: str
    guild_id: int | None
    watch_channel_ids: set[int]
    max_files: int
    public_default: bool


def _load_bot_config(conf: dict) -> BotConfig:
    section = (conf.get("discord_bot") or {}) if isinstance(conf, dict) else {}
    token = str(section.get("token") or os.environ.get("DISCORD_BOT_TOKEN") or "").strip()
    guild_id_raw = str(section.get("guild_id") or "").strip()
    watch_raw = section.get("watch_channel_ids") or []
    if isinstance(watch_raw, str):
        watch_values = [part.strip() for part in watch_raw.split(",")]
    else:
        watch_values = [str(part).strip() for part in watch_raw]

    channel_ids: set[int] = set()
    for value in watch_values:
        if not value:
            continue
        try:
            channel_ids.add(int(value))
        except ValueError:
            continue

    guild_id = int(guild_id_raw) if guild_id_raw.isdigit() else None
    max_files = max(1, min(20, int(section.get("max_files") or 20)))
    public_default = bool(section.get("public_default", True))
    return BotConfig(
        token=token,
        guild_id=guild_id,
        watch_channel_ids=channel_ids,
        max_files=max_files,
        public_default=public_default,
    )


def _parse_bool_text(value: str, default: bool) -> bool:
    text = str(value or "").strip().lower()
    if text in {"1", "true", "yes", "y", "on", "public", "open"}:
        return True
    if text in {"0", "false", "no", "n", "off", "private", "close", "closed"}:
        return False
    return default


def _is_image_attachment(attachment: discord.Attachment) -> bool:
    content_type = str(attachment.content_type or "").lower()
    if content_type in IMAGE_CONTENT_TYPES:
        return True
    suffix = Path(attachment.filename or "").suffix.lower()
    return suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def _resolve_gallery_actor(conf: dict, discord_user_id: int) -> GalleryActor | None:
    conn = db_conn(conf)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT u.id, u.can_upload AS upload_enabled, u.status
FROM auth_identities ai
JOIN users u ON u.id=ai.user_id
WHERE ai.provider=%s AND ai.provider_user_id=%s AND ai.is_enabled=1
LIMIT 1
""",
                ("discord", str(discord_user_id)),
            )
            row = cur.fetchone()
        if not row:
            return None
        if str(row.get("status") or "") != "active":
            return None
        return GalleryActor(id=int(row["id"]), can_upload=bool(row.get("upload_enabled")))
    finally:
        conn.close()


async def _read_attachments(attachments: list[discord.Attachment]) -> list[GalleryUploadPreparedFile]:
    prepared: list[GalleryUploadPreparedFile] = []
    for attachment in attachments:
        prepared.append(
            GalleryUploadPreparedFile(
                filename=attachment.filename or "image",
                content=await attachment.read(),
            )
        )
    return prepared


class UploadMetadataModal(discord.ui.Modal):
    def __init__(
        self,
        *,
        bot_client: "GalleryDiscordBot",
        message: discord.Message,
        mode: str,
        attachments: list[discord.Attachment],
        actor: GalleryActor,
        candidate_shot_at: str,
    ) -> None:
        default_title = attachments[0].filename.rsplit(".", 1)[0][:120] if len(attachments) == 1 else f"Discord Upload {message.id}"
        super().__init__(title="Gallery Upload")
        self.bot_client = bot_client
        self.message = message
        self.mode = mode
        self.attachments = attachments
        self.actor = actor
        self.title_input = discord.ui.TextInput(
            label="タイトル",
            default=default_title[:100],
            max_length=100,
            required=True,
        )
        self.alt_input = discord.ui.TextInput(
            label="説明文",
            default="",
            style=discord.TextStyle.paragraph,
            max_length=1000,
            required=False,
        )
        self.shot_at_input = discord.ui.TextInput(
            label="撮影日",
            default=candidate_shot_at,
            placeholder="YYYY-MM-DDTHH:MM",
            max_length=16,
            required=False,
        )
        self.public_input = discord.ui.TextInput(
            label="公開設定",
            default="public" if bot_client.bot_cfg.public_default else "private",
            placeholder="public / private",
            max_length=16,
            required=False,
        )
        self.add_item(self.title_input)
        self.add_item(self.alt_input)
        self.add_item(self.shot_at_input)
        self.add_item(self.public_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer(thinking=True, ephemeral=True)
        title = str(self.title_input.value or "").strip()
        alt = str(self.alt_input.value or "").strip()
        shot_at = str(self.shot_at_input.value or "").strip()
        is_public = _parse_bool_text(str(self.public_input.value or ""), self.bot_client.bot_cfg.public_default)

        try:
            prepared = await _read_attachments(self.attachments)
            if self.mode == "separate":
                created_ids: list[str] = []
                duplicate_names: list[str] = []
                for index, item in enumerate(prepared, start=1):
                    item_title = title if len(prepared) == 1 else f"{title} #{index}"
                    result = await asyncio.to_thread(
                        perform_gallery_upload,
                        conf=self.bot_client.conf,
                        title=item_title,
                        alt=alt,
                        is_public=is_public,
                        shot_at=shot_at,
                        files=[item],
                        actor=self.actor,
                    )
                    if result.get("has_duplicates"):
                        duplicate_names.extend(
                            entry["filename"]
                            for entry in (result.get("items") or [])
                            if entry.get("duplicate")
                        )
                        continue
                    created_ids.extend(str(entry["image_id"]) for entry in (result.get("items") or []))
                if duplicate_names and not created_ids:
                    await interaction.followup.send(
                        f"重複画像があるため投稿を中止しました。{', '.join(duplicate_names)}",
                        ephemeral=True,
                    )
                    return
                suffix = f" / 重複除外: {', '.join(duplicate_names)}" if duplicate_names else ""
                await interaction.followup.send(
                    f"{len(created_ids)}件の画像を Gallery へ投稿しました。image_id: {', '.join(created_ids)}{suffix}",
                    ephemeral=True,
                )
                return

            result = await asyncio.to_thread(
                perform_gallery_upload,
                conf=self.bot_client.conf,
                title=title,
                alt=alt,
                is_public=is_public,
                shot_at=shot_at,
                files=prepared,
                actor=self.actor,
            )
            if result.get("has_duplicates"):
                duplicates = ", ".join(item["filename"] for item in result.get("items") or [] if item.get("duplicate"))
                await interaction.followup.send(f"重複画像があるため投稿を中止しました。{duplicates}", ephemeral=True)
                return

            if result.get("content_key"):
                await interaction.followup.send(
                    f"Gallery へ投稿しました。content_key: {result['content_key']} / 件数: {result.get('count', 0)}",
                    ephemeral=True,
                )
            else:
                created_ids = ", ".join(str(item["image_id"]) for item in result.get("items") or [])
                await interaction.followup.send(f"Gallery へ投稿しました。image_id: {created_ids}", ephemeral=True)
        except GalleryUploadError as exc:
            await interaction.followup.send(f"投稿に失敗しました: {exc.message}", ephemeral=True)
        except Exception as exc:
            logger.exception("Discord upload failed")
            await interaction.followup.send(f"投稿に失敗しました: {type(exc).__name__}: {exc}", ephemeral=True)


class UploadChoiceView(discord.ui.View):
    def __init__(self, *, bot_client: "GalleryDiscordBot", message: discord.Message, attachments: list[discord.Attachment], actor: GalleryActor) -> None:
        super().__init__(timeout=900)
        self.bot_client = bot_client
        self.message = message
        self.attachments = attachments
        self.actor = actor
        if len(attachments) == 1:
            self.upload_separate.disabled = True
            self.upload_grouped.disabled = True

    async def _ensure_author(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.message.author.id:
            await interaction.response.send_message("この操作は元の投稿者のみ実行できます。", ephemeral=True)
            return False
        return True

    async def _candidate_shot_at(self) -> str:
        first = self.attachments[0]
        try:
            data = await first.read()
            return extract_candidate_shot_at_from_image_bytes(first.filename or "image", data, self.bot_client.conf)
        except Exception:
            logger.exception("Failed to build candidate shot_at")
            return ""

    @discord.ui.button(label="Galleryへ投稿", style=discord.ButtonStyle.primary)
    async def upload_single(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        if len(self.attachments) > 1:
            await interaction.response.send_message("複数枚のときは下のボタンを使ってください。", ephemeral=True)
            return
        modal = UploadMetadataModal(
            bot_client=self.bot_client,
            message=self.message,
            mode="single",
            attachments=self.attachments,
            actor=self.actor,
            candidate_shot_at=await self._candidate_shot_at(),
        )
        await interaction.response.send_modal(modal)

    @discord.ui.button(label="1枚ずつ投稿", style=discord.ButtonStyle.secondary)
    async def upload_separate(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        modal = UploadMetadataModal(
            bot_client=self.bot_client,
            message=self.message,
            mode="separate",
            attachments=self.attachments,
            actor=self.actor,
            candidate_shot_at=await self._candidate_shot_at(),
        )
        await interaction.response.send_modal(modal)

    @discord.ui.button(label="まとめて1投稿", style=discord.ButtonStyle.success)
    async def upload_grouped(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        if len(self.attachments) > self.bot_client.bot_cfg.max_files:
            await interaction.response.send_message(
                f"まとめ投稿は {self.bot_client.bot_cfg.max_files} 枚までです。",
                ephemeral=True,
            )
            return
        modal = UploadMetadataModal(
            bot_client=self.bot_client,
            message=self.message,
            mode="grouped",
            attachments=self.attachments,
            actor=self.actor,
            candidate_shot_at=await self._candidate_shot_at(),
        )
        await interaction.response.send_modal(modal)


class GalleryDiscordBot(discord.Client):
    def __init__(self, *, conf: dict, bot_cfg: BotConfig) -> None:
        intents = discord.Intents.default()
        intents.guilds = True
        intents.messages = True
        intents.message_content = True
        super().__init__(intents=intents)
        self.conf = conf
        self.bot_cfg = bot_cfg

    async def on_ready(self) -> None:
        logger.info("discord gallery bot ready user=%s", self.user)

    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot:
            return
        if self.bot_cfg.guild_id and message.guild and message.guild.id != self.bot_cfg.guild_id:
            return
        if self.bot_cfg.watch_channel_ids and message.channel.id not in self.bot_cfg.watch_channel_ids:
            return

        attachments = [attachment for attachment in message.attachments if _is_image_attachment(attachment)]
        if not attachments:
            return
        if len(attachments) > self.bot_cfg.max_files:
            await message.reply(
                f"Gallery 連携は {self.bot_cfg.max_files} 枚までです。今回の投稿は {len(attachments)} 枚でした。",
                mention_author=False,
            )
            return

        actor = await asyncio.to_thread(_resolve_gallery_actor, self.conf, message.author.id)
        if actor is None:
            await message.reply(
                "Gallery へ投稿するには、先に Gallery 側アカウントへ Discord を連携してください。",
                mention_author=False,
            )
            return
        if not actor.can_upload:
            await message.reply(
                "Gallery への投稿権限がありません。管理者へ確認してください。",
                mention_author=False,
            )
            return

        count_text = "この画像" if len(attachments) == 1 else f"この {len(attachments)} 枚"
        view = UploadChoiceView(bot_client=self, message=message, attachments=attachments, actor=actor)
        await message.reply(
            f"{count_text} を Felixxsv Gallery へ送りますか？",
            view=view,
            mention_author=False,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="discord_gallery_bot")
    parser.add_argument("--config", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = build_parser().parse_args(argv)
    conf = load_conf(args.config)
    bot_cfg = _load_bot_config(conf)
    if not bot_cfg.token:
        raise SystemExit("discord_bot.token or DISCORD_BOT_TOKEN is required")
    bot = GalleryDiscordBot(conf=conf, bot_cfg=bot_cfg)
    bot.run(bot_cfg.token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
