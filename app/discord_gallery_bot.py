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
PROMPT_INACTIVITY_SECONDS = 120


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


def _load_tag_suggestions(conf: dict, limit: int = 8) -> list[str]:
    conn = db_conn(conf)
    try:
        gallery = str((conf.get("app") or {}).get("gallery") or "vrchat")
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT t.name, COUNT(*) AS cnt
FROM tags t
JOIN image_tags it ON it.tag_id=t.id
JOIN images i ON i.id=it.image_id AND i.gallery=t.gallery AND i.is_public=1
WHERE t.gallery=%s
GROUP BY t.id, t.name
ORDER BY cnt DESC, t.name ASC
LIMIT %s
""",
                (gallery, int(limit)),
            )
            rows = cur.fetchall() or []
        return [str(row["name"]) for row in rows if row.get("name")]
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
    def __init__(self, *, view_ref: "UploadChoiceView", candidate_shot_at: str) -> None:
        super().__init__(title="投稿内容を編集")
        self.view_ref = view_ref
        self.title_input = discord.ui.TextInput(
            label="タイトル",
            default=view_ref.draft_title,
            placeholder="タイトルを入力",
            max_length=100,
            required=True,
        )
        self.alt_input = discord.ui.TextInput(
            label="説明文",
            default=view_ref.draft_alt,
            style=discord.TextStyle.paragraph,
            max_length=1000,
            required=False,
        )
        self.shot_at_input = discord.ui.TextInput(
            label="撮影日",
            default=view_ref.draft_shot_at or candidate_shot_at,
            placeholder="YYYY/MM/DD-HH:MM",
            max_length=16,
            required=False,
        )
        self.add_item(self.title_input)
        self.add_item(self.alt_input)
        self.add_item(self.shot_at_input)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await interaction.response.defer()
        self.view_ref.draft_title = str(self.title_input.value or "").strip()
        self.view_ref.draft_alt = str(self.alt_input.value or "").strip()
        self.view_ref.draft_shot_at = str(self.shot_at_input.value or "").strip()
        await self.view_ref.refresh_prompt_message()


class UploadChoiceView(discord.ui.View):
    def __init__(self, *, bot_client: "GalleryDiscordBot", message: discord.Message, attachments: list[discord.Attachment], actor: GalleryActor) -> None:
        super().__init__(timeout=900)
        self.bot_client = bot_client
        self.message = message
        self.attachments = attachments
        self.actor = actor
        self.prompt_message: discord.Message | None = None
        self.selected_public = bool(bot_client.bot_cfg.public_default)
        self.suggested_tags = _load_tag_suggestions(bot_client.conf, limit=8)
        self.draft_title = ""
        self.draft_alt = ""
        self.draft_shot_at = ""
        self.draft_tags = ""
        self.separate_index = 0
        self.separate_uploaded_ids: list[str] = []
        self.separate_processed_count = 0
        self.separate_completed = False
        self.inactivity_task: asyncio.Task | None = None
        if self.suggested_tags:
            self.tag_select = UploadTagSelect(self, self.suggested_tags)
            self.add_item(self.tag_select)
        if len(attachments) == 1:
            self.remove_item(self.upload_separate)
            self.remove_item(self.upload_grouped)
        else:
            self.remove_item(self.upload_single)
        self._sync_button_state()

    def _sync_button_state(self) -> None:
        self.toggle_visibility.label = f"公開設定: {'公開' if self.selected_public else '非公開'}"
        self.toggle_visibility.style = discord.ButtonStyle.success if self.selected_public else discord.ButtonStyle.secondary
        if len(self.attachments) > 1:
            self.upload_separate.label = "1枚ずつ投稿完了" if self.separate_completed else f"{self.separate_index + 1}枚目を投稿"
            self.upload_separate.disabled = self.separate_completed
            self.upload_grouped.disabled = self.separate_completed
            self.skip_current.disabled = self.separate_completed

    async def ensure_initial_draft(self) -> None:
        if not self.draft_shot_at:
            self.draft_shot_at = await self._candidate_shot_at(0)

    async def _ensure_author(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.message.author.id:
            await interaction.response.send_message("この操作は元の投稿者のみ実行できます。", ephemeral=True)
            return False
        return True

    async def _candidate_shot_at(self, index: int) -> str:
        attachment = self.attachments[index]
        try:
            data = await attachment.read()
            return extract_candidate_shot_at_from_image_bytes(attachment.filename or "image", data, self.bot_client.conf)
        except Exception:
            logger.exception("Failed to build candidate shot_at")
            return ""

    def _current_attachment_label(self) -> str:
        if len(self.attachments) == 1:
            return self.attachments[0].filename or "画像"
        attachment = self.attachments[self.separate_index]
        return f"({self.separate_index + 1}/{len(self.attachments)}枚目) {attachment.filename or '画像'}"

    def _build_prompt_text(self) -> str:
        count_text = "この画像" if len(self.attachments) == 1 else f"この {len(self.attachments)} 枚"
        lines = [f"{count_text}をFelixxsv Gallery へアップロードしますか？"]
        if len(self.attachments) > 1:
            lines.append(f"1枚ずつ投稿の現在対象: {self._current_attachment_label()}")
            lines.append(f"1枚ずつ投稿済み: {self.separate_processed_count}/{len(self.attachments)}")
        lines.extend(
            [
                f"タイトル: {self.draft_title or '「内容を編集」から入力してください'}",
                f"説明文: {self.draft_alt or '「内容を編集」から入力してください(任意)'}",
                f"タグ: {self.draft_tags or '「タグ候補を選択」から選択してください(任意)'}",
            ]
        )
        lines.append("入力後「Galleryへ投稿」からアップロードが可能です。")
        lines.append("操作しない場合2分後にこのメッセージは削除されます。")
        return "\n".join(lines)

    async def refresh_prompt_message(self) -> None:
        self._sync_button_state()
        if self.prompt_message is not None:
            await self.prompt_message.edit(content=self._build_prompt_text(), view=self)
            self.touch_prompt()

    def touch_prompt(self) -> None:
        self._cancel_inactivity_task()
        if self.prompt_message is not None:
            self.inactivity_task = asyncio.create_task(self._auto_delete_prompt())

    def _cancel_inactivity_task(self) -> None:
        if self.inactivity_task is not None:
            if self.inactivity_task is asyncio.current_task():
                self.inactivity_task = None
                return
            self.inactivity_task.cancel()
            self.inactivity_task = None

    async def _auto_delete_prompt(self) -> None:
        try:
            await asyncio.sleep(PROMPT_INACTIVITY_SECONDS)
            await self._delete_prompt_message()
        except asyncio.CancelledError:
            return

    async def _delete_prompt_message(self) -> None:
        self._cancel_inactivity_task()
        self.stop()
        if self.prompt_message is None:
            return
        message = self.prompt_message
        self.prompt_message = None
        try:
            await message.delete()
        except Exception:
            logger.exception("Failed to delete prompt message")

    async def _open_metadata_modal(self, interaction: discord.Interaction) -> None:
        modal = UploadMetadataModal(
            view_ref=self,
            candidate_shot_at=self.draft_shot_at or await self._candidate_shot_at(self.separate_index),
        )
        await interaction.response.send_modal(modal)

    def _draft_ready(self) -> str | None:
        if not self.draft_title.strip():
            return "先に「内容を編集」からタイトルを入力してください。"
        return None

    async def _submit_upload(
        self,
        *,
        files: list[discord.Attachment],
        title: str,
        alt: str,
        tags: str,
        shot_at: str,
        is_public: bool,
    ) -> dict:
        prepared = await _read_attachments(files)
        return await asyncio.to_thread(
            perform_gallery_upload,
            conf=self.bot_client.conf,
            title=title,
            alt=alt,
            tags=tags,
            is_public=is_public,
            shot_at=shot_at,
            files=prepared,
            actor=self.actor,
        )

    async def _send_temporary_followup(self, interaction: discord.Interaction, content: str) -> None:
        try:
            notice = await interaction.followup.send(content, ephemeral=True, wait=True)
        except TypeError:
            await interaction.followup.send(content, ephemeral=True)
            return

        async def _cleanup_notice() -> None:
            try:
                await asyncio.sleep(PROMPT_INACTIVITY_SECONDS)
                await notice.delete()
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("Failed to delete followup notice")

        asyncio.create_task(_cleanup_notice())

    async def _handle_upload_result(self, interaction: discord.Interaction, result: dict) -> None:
        if result.get("has_duplicates"):
            duplicates = ", ".join(item["filename"] for item in result.get("items") or [] if item.get("duplicate"))
            await self._send_temporary_followup(interaction, f"重複画像があるため投稿を中止しました。{duplicates}")
            return
        if result.get("content_key"):
            await self._send_temporary_followup(
                interaction,
                f"Gallery へ投稿しました。content_key: {result['content_key']} / 件数: {result.get('count', 0)}",
            )
            return
        created_ids = ", ".join(str(item["image_id"]) for item in result.get("items") or [] if item.get("image_id"))
        await self._send_temporary_followup(interaction, f"Gallery へ投稿しました。image_id: {created_ids}")

    async def _prepare_next_separate_draft(self) -> None:
        self.draft_title = ""
        self.draft_alt = ""
        self.draft_tags = ""
        self.draft_shot_at = await self._candidate_shot_at(self.separate_index)

    def _remaining_attachments(self) -> list[discord.Attachment]:
        if len(self.attachments) <= 1:
            return list(self.attachments)
        return list(self.attachments[self.separate_index:])

    async def _skip_current(self, interaction: discord.Interaction, *, message_prefix: str) -> None:
        if len(self.attachments) <= 1:
            await self._delete_prompt_message()
            return

        self.separate_processed_count += 1
        if self.separate_index + 1 >= len(self.attachments):
            self.separate_completed = True
        else:
            self.separate_index += 1
            await self._prepare_next_separate_draft()
        await self.refresh_prompt_message()
        if self.separate_completed:
            await self._delete_prompt_message()

    @discord.ui.button(label="内容を編集", style=discord.ButtonStyle.primary, row=1)
    async def edit_metadata(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        self.touch_prompt()
        await self._open_metadata_modal(interaction)

    @discord.ui.button(label="公開設定: 公開", style=discord.ButtonStyle.success, row=1)
    async def toggle_visibility(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        self.selected_public = not self.selected_public
        await interaction.response.defer()
        await self.refresh_prompt_message()

    @discord.ui.button(label="Galleryへ投稿", style=discord.ButtonStyle.success, row=2)
    async def upload_single(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        error = self._draft_ready()
        if error:
            await interaction.response.send_message(error, ephemeral=True)
            return
        await interaction.response.defer(thinking=True, ephemeral=True)
        self.touch_prompt()
        try:
            result = await self._submit_upload(
                files=self._remaining_attachments(),
                title=self.draft_title.strip(),
                alt=self.draft_alt.strip(),
                tags=self.draft_tags.strip(),
                shot_at=self.draft_shot_at.strip(),
                is_public=self.selected_public,
            )
            await self._delete_prompt_message()
            await self._handle_upload_result(interaction, result)
        except GalleryUploadError as exc:
            await self._send_temporary_followup(interaction, f"投稿に失敗しました: {exc.message}")
        except Exception as exc:
            logger.exception("Discord upload failed")
            await self._send_temporary_followup(interaction, f"投稿に失敗しました: {type(exc).__name__}: {exc}")

    @discord.ui.button(label="1枚ずつ投稿", style=discord.ButtonStyle.secondary, row=2)
    async def upload_separate(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        error = self._draft_ready()
        if error:
            await interaction.response.send_message(error, ephemeral=True)
            return
        await interaction.response.defer(thinking=True, ephemeral=True)
        self.touch_prompt()
        attachment = self.attachments[self.separate_index]
        try:
            result = await self._submit_upload(
                files=[attachment],
                title=self.draft_title.strip(),
                alt=self.draft_alt.strip(),
                tags=self.draft_tags.strip(),
                shot_at=self.draft_shot_at.strip(),
                is_public=self.selected_public,
            )
            if result.get("has_duplicates"):
                await self._skip_current(interaction, message_prefix="重複画像のためスキップしました。")
                return
            created_ids = [str(item["image_id"]) for item in result.get("items") or [] if item.get("image_id")]
            self.separate_uploaded_ids.extend(created_ids)
            self.separate_processed_count += 1
            if self.separate_index + 1 >= len(self.attachments):
                self.separate_completed = True
            else:
                self.separate_index += 1
                await self._prepare_next_separate_draft()
            await self.refresh_prompt_message()
            if self.separate_completed:
                await self._delete_prompt_message()
                await self._send_temporary_followup(interaction, "画像を投稿しました。1枚ずつ投稿は完了です。")
            else:
                await self._send_temporary_followup(
                    interaction,
                    f"画像を投稿しました。次の写真 {self._current_attachment_label()} を編集して投稿してください。",
                )
        except GalleryUploadError as exc:
            await self._send_temporary_followup(interaction, f"投稿に失敗しました: {exc.message}")
        except Exception as exc:
            logger.exception("Discord upload failed")
            await self._send_temporary_followup(interaction, f"投稿に失敗しました: {type(exc).__name__}: {exc}")

    @discord.ui.button(label="まとめて1投稿", style=discord.ButtonStyle.success, row=2)
    async def upload_grouped(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        if len(self.attachments) > self.bot_client.bot_cfg.max_files:
            await interaction.response.send_message(
                f"まとめ投稿は {self.bot_client.bot_cfg.max_files} 枚までです。",
                ephemeral=True,
            )
            return
        error = self._draft_ready()
        if error:
            await interaction.response.send_message(error, ephemeral=True)
            return
        await interaction.response.defer(thinking=True, ephemeral=True)
        self.touch_prompt()
        try:
            result = await self._submit_upload(
                files=self._remaining_attachments(),
                title=self.draft_title.strip(),
                alt=self.draft_alt.strip(),
                tags=self.draft_tags.strip(),
                shot_at=self.draft_shot_at.strip(),
                is_public=self.selected_public,
            )
            await self._delete_prompt_message()
            await self._handle_upload_result(interaction, result)
        except GalleryUploadError as exc:
            await self._send_temporary_followup(interaction, f"投稿に失敗しました: {exc.message}")
        except Exception as exc:
            logger.exception("Discord upload failed")
            await self._send_temporary_followup(interaction, f"投稿に失敗しました: {type(exc).__name__}: {exc}")

    @discord.ui.button(label="スキップ", style=discord.ButtonStyle.secondary, row=2)
    async def skip_current(self, interaction: discord.Interaction, _button: discord.ui.Button) -> None:
        if not await self._ensure_author(interaction):
            return
        await interaction.response.defer(thinking=True, ephemeral=True)
        self.touch_prompt()
        await self._skip_current(interaction, message_prefix="この画像をスキップしました。")


class UploadTagSelect(discord.ui.Select):
    def __init__(self, view_ref: UploadChoiceView, suggestions: list[str]) -> None:
        self.view_ref = view_ref
        options = [discord.SelectOption(label=tag[:100], value=tag[:100]) for tag in suggestions[:8]]
        super().__init__(
            placeholder="タグ候補を選択",
            min_values=0,
            max_values=min(5, len(options)),
            options=options,
            row=0,
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        if interaction.user.id != self.view_ref.message.author.id:
            await interaction.response.send_message("この操作は元の投稿者のみ実行できます。", ephemeral=True)
            return
        self.view_ref.draft_tags = ", ".join(self.values)
        await interaction.response.defer()
        await self.view_ref.refresh_prompt_message()


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
                "Gallery へ投稿するには、先に Gallery 側アカウントへ Discord を連携してください。\n"
                "URL: https://felixxsv.net/gallery/\n"
                "手順: 1. Galleryへログイン 2. アカウント設定でDiscord連携 3. このチャンネルへ戻って再投稿",
                mention_author=False,
            )
            return
        if not actor.can_upload:
            await message.reply(
                "Gallery への投稿権限がありません。管理者へ確認してください。",
                mention_author=False,
            )
            return

        view = UploadChoiceView(bot_client=self, message=message, attachments=attachments, actor=actor)
        await view.ensure_initial_draft()
        prompt = await message.reply(
            view._build_prompt_text(),
            view=view,
            mention_author=False,
        )
        view.prompt_message = prompt
        view.touch_prompt()


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
