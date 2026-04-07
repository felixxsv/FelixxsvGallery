from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import hashlib
import logging
import re
import shutil
import tempfile
import uuid

from PIL import Image, UnidentifiedImageError

from db import db_conn
from galleryctl.colors import extract_top_colors, load_palette_from_conf, load_settings_from_conf
from badge_defs import POST_COUNT_BADGES

logger = logging.getLogger(__name__)


class GalleryUploadError(RuntimeError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = int(status_code)


@dataclass(frozen=True)
class GalleryActor:
    id: int
    can_upload: bool = True


@dataclass(frozen=True)
class GalleryUploadPreparedFile:
    filename: str
    content: bytes


def parse_csv_strs(s: str | None) -> list[str]:
    if not s:
        return []
    out: list[str] = []
    for x in s.split(","):
        x = x.strip()
        if x:
            out.append(x)
    return out


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _now_local_naive(conf: dict) -> datetime:
    from datetime import datetime as _datetime
    from zoneinfo import ZoneInfo

    tz = str((conf.get("app") or {}).get("timezone") or "Asia/Tokyo")
    try:
        dt = _datetime.now(ZoneInfo(tz))
        return dt.replace(tzinfo=None)
    except Exception:
        logger.exception("Unhandled error")
        return _datetime.now()


def _table_cols(conn, table: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
        rows = cur.fetchall()
    return {str(r["Field"]).lower() for r in rows}


def _table_exists(conn, table_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE %s", (table_name,))
        return cur.fetchone() is not None


def _upload_requires_login(conf: dict) -> bool:
    upload = (conf.get("upload") or {}) if isinstance(conf, dict) else {}
    return bool(upload.get("requires_login", True))


def _try_grant_post_count_badges(conn, user_id: int | None) -> None:
    if not user_id:
        return
    try:
        img_col = None
        for col in ("uploader_user_id", "owner_user_id"):
            with conn.cursor() as cur:
                cur.execute("SHOW COLUMNS FROM images LIKE %s", (col,))
                if cur.fetchone():
                    img_col = col
                    break
        if img_col is None:
            return
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS cnt FROM images WHERE {img_col}=%s", (user_id,))
            row = cur.fetchone()
        post_count = int((row or {}).get("cnt") or 0)
        to_grant = [key for threshold, key in POST_COUNT_BADGES if post_count >= threshold]
        if not to_grant:
            return
        for badge_key in to_grant:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT IGNORE INTO user_badges (user_id, badge_key, granted_by) VALUES (%s, %s, NULL)",
                    (user_id, badge_key),
                )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


def _render_webp(src: Path, dst: Path, max_w: int) -> None:
    img = Image.open(src)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    w0, h0 = img.size
    if w0 > max_w:
        scale = max_w / float(w0)
        nw = max_w
        nh = int(h0 * scale)
        if nh < 1:
            nh = 1
        img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    ensure_dir(dst.parent)
    img.save(dst, "WEBP", quality=82, method=6)


def _parse_file_shot_at(name: str, conf: dict) -> datetime:
    vr_re = re.compile(r"^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})")
    base = (name or "").split("/")[-1].split("\\")[-1]
    m = vr_re.match(base)
    if not m:
        return _now_local_naive(conf)
    y, mo, d, hh, mm, ss = map(int, m.groups())
    try:
        return datetime(y, mo, d, hh, mm, ss)
    except Exception:
        logger.exception("Unhandled error")
        return _now_local_naive(conf)


def parse_shot_at_input(shot_at: str | None) -> datetime | None:
    shot_at_str = str(shot_at or "").strip()
    if not shot_at_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(shot_at_str, fmt)
        except ValueError:
            continue
    return None


def extract_candidate_shot_at_from_image_bytes(filename: str, content: bytes, conf: dict) -> str:
    try:
        import io

        with Image.open(io.BytesIO(content)) as im:
            exif = im.getexif()
            for key in (36867, 36868, 306):
                raw = exif.get(key)
                if not raw:
                    continue
                value = str(raw).strip()
                for fmt_in in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                    try:
                        return datetime.strptime(value, fmt_in).strftime("%Y-%m-%dT%H:%M")
                    except ValueError:
                        continue
    except Exception:
        logger.exception("Failed to extract EXIF shot_at")

    return _parse_file_shot_at(filename, conf).strftime("%Y-%m-%dT%H:%M")


def perform_gallery_upload(
    *,
    conf: dict,
    title: str,
    alt: str = "",
    tags: str = "",
    is_public: bool = True,
    shot_at: str = "",
    focal_x: float = 50.0,
    focal_y: float = 50.0,
    files: list[GalleryUploadPreparedFile],
    actor: GalleryActor | None = None,
) -> dict:
    if _upload_requires_login(conf):
        if actor is None:
            raise GalleryUploadError("login required", 401)
        if not actor.can_upload:
            raise GalleryUploadError("upload not allowed", 403)

    t = str(title or "").strip()
    if not t:
        raise GalleryUploadError("title required", 400)
    if not files:
        raise GalleryUploadError("files required", 400)
    if len(files) > 20:
        raise GalleryUploadError("too many files (max 20)", 400)

    source_root = Path(conf["paths"]["source_root"])
    storage_root = Path((conf.get("paths") or {}).get("storage_root") or "/data/felixxsv-gallery/www/storage")
    gallery = str((conf.get("app") or {}).get("gallery") or "vrchat")

    focal_x_val = max(0.0, min(100.0, float(focal_x if focal_x is not None else 50.0)))
    focal_y_val = max(0.0, min(100.0, float(focal_y if focal_y is not None else 50.0)))
    tag_list = [x for x in parse_csv_strs(tags) if x]
    shot_at_override = parse_shot_at_input(shot_at)

    conn = db_conn(conf)
    try:
        src_cols = _table_cols(conn, "image_sources")
        img_cols = _table_cols(conn, "images")

        staged = []
        staging_root = source_root / "uploads" / "_staging"
        ensure_dir(staging_root)
        tmp_dir = Path(tempfile.mkdtemp(prefix="felixxsv_gallery_upload_", dir=str(staging_root)))

        try:
            for idx, prepared in enumerate(files):
                name = prepared.filename or f"file{idx}"
                resolved_shot_at = shot_at_override if shot_at_override is not None else _parse_file_shot_at(name, conf)

                ext = Path(name).suffix.lower().lstrip(".")
                if ext not in ("png", "jpg", "jpeg", "webp"):
                    ext = "png"

                tmp_path = tmp_dir / f"{idx:03d}_{uuid.uuid4().hex}.{ext}"
                data = prepared.content
                if not isinstance(data, (bytes, bytearray)) or len(data) == 0:
                    raise GalleryUploadError(f"invalid image: {name}", 400)

                h = hashlib.sha256()
                try:
                    with tmp_path.open("wb") as f:
                        f.write(data)
                    h.update(data)
                except Exception as e:
                    raise GalleryUploadError(f"save failed: {type(e).__name__}: {e}", 500)

                sha_hex = h.hexdigest()

                try:
                    with Image.open(tmp_path) as im:
                        w, h2 = im.size
                        fmt = (im.format or ext).upper()
                except (UnidentifiedImageError, OSError):
                    raise GalleryUploadError(f"invalid image: {name}", 400)

                staged.append(
                    {
                        "index": idx,
                        "filename": name,
                        "shot_at": resolved_shot_at,
                        "ext": ext,
                        "tmp_path": tmp_path,
                        "sha_hex": sha_hex,
                        "size_bytes": int(len(data)),
                        "width": int(w),
                        "height": int(h2),
                        "format": str(fmt),
                    }
                )

            uniq_hashes = sorted({x["sha_hex"] for x in staged})
            existing_map = {}
            if uniq_hashes:
                ph = ",".join(["%s"] * len(uniq_hashes))
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT id, content_hash FROM images WHERE gallery=%s AND content_hash IN ({ph})",
                        [gallery, *uniq_hashes],
                    )
                    for r in cur.fetchall():
                        existing_map[str(r["content_hash"])] = int(r["id"])

            seen = set()
            items = []
            any_dup = False
            for x in staged:
                sha = x["sha_hex"]
                exid = existing_map.get(sha)
                dup = (exid is not None) or (sha in seen)
                seen.add(sha)
                if dup:
                    any_dup = True
                items.append(
                    {
                        "index": int(x["index"]),
                        "filename": x["filename"],
                        "duplicate": bool(dup),
                        "existing_id": exid,
                    }
                )

            if any_dup:
                return {"ok": True, "has_duplicates": True, "count": 0, "items": items}

            palette = load_palette_from_conf(conf)
            cset = load_settings_from_conf(conf)
            has_content_tables = _table_exists(conn, "gallery_contents") and _table_exists(conn, "gallery_content_images")
            content_cols = _table_cols(conn, "gallery_contents") if has_content_tables else set()
            content_image_cols = _table_cols(conn, "gallery_content_images") if has_content_tables else set()

            conn.autocommit(False)
            created_orig_paths = []
            created_deriv_paths = []
            created_items = []

            def id_dir3(image_id: int) -> str:
                s = f"{image_id:08d}"
                return f"{s[0:2]}/{s[2:4]}/{s[4:6]}"

            try:
                for x in staged:
                    resolved_shot_at = x["shot_at"]
                    rel_dir = Path("uploads") / resolved_shot_at.strftime("%Y/%m/%d")
                    fname = f"VRChat_{resolved_shot_at.strftime('%Y-%m-%d_%H-%M-%S')}_{uuid.uuid4().hex[:8]}.{x['ext']}"
                    rel_path = str((rel_dir / fname).as_posix())
                    abs_path = source_root / rel_path

                    ensure_dir(abs_path.parent)
                    try:
                        x["tmp_path"].replace(abs_path)
                    except OSError:
                        shutil.move(str(x["tmp_path"]), str(abs_path))
                    created_orig_paths.append(abs_path)

                    st = abs_path.stat()
                    mtime_epoch = int(st.st_mtime)

                    img_cols_list = [
                        "gallery", "shot_at", "title", "alt", "width", "height", "format",
                        "thumb_path_480", "thumb_path_960", "preview_path", "content_hash",
                    ]
                    img_vals = [
                        gallery, resolved_shot_at, t, str(alt or ""), x["width"], x["height"], x["format"],
                        "", "", "", x["sha_hex"],
                    ]

                    if "is_public" in img_cols:
                        img_cols_list.append("is_public")
                        img_vals.append(1 if is_public else 0)
                    if "focal_x" in img_cols:
                        img_cols_list.append("focal_x")
                        img_vals.append(focal_x_val)
                    if "focal_y" in img_cols:
                        img_cols_list.append("focal_y")
                        img_vals.append(focal_y_val)
                    if "uploader_user_id" in img_cols and actor is not None:
                        img_cols_list.append("uploader_user_id")
                        img_vals.append(int(actor.id))
                    elif "owner_user_id" in img_cols and actor is not None:
                        img_cols_list.append("owner_user_id")
                        img_vals.append(int(actor.id))

                    with conn.cursor() as cur:
                        cur.execute(
                            f"INSERT INTO images ({', '.join(img_cols_list)}) VALUES ({', '.join(['%s'] * len(img_cols_list))})",
                            img_vals,
                        )
                        cur.execute("SELECT LAST_INSERT_ID() AS id")
                        image_id = int(cur.fetchone()["id"])

                    dir3 = id_dir3(image_id)
                    t480_rel = f"thumbs/{gallery}/{dir3}/{image_id}_w480.webp"
                    t960_rel = f"thumbs/{gallery}/{dir3}/{image_id}_w960.webp"
                    prev_rel = f"previews/{gallery}/{dir3}/{image_id}_max2560.webp"

                    _render_webp(abs_path, storage_root / t480_rel, 480)
                    _render_webp(abs_path, storage_root / t960_rel, 960)
                    _render_webp(abs_path, storage_root / prev_rel, 2560)
                    created_deriv_paths.extend([storage_root / t480_rel, storage_root / t960_rel, storage_root / prev_rel])

                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE images SET thumb_path_480=%s, thumb_path_960=%s, preview_path=%s WHERE id=%s AND gallery=%s",
                            (t480_rel, t960_rel, prev_rel, image_id, gallery),
                        )

                    src_cols_list = [
                        "gallery", "image_id", "source_path", "size_bytes", "mtime_epoch",
                        "content_hash", "is_primary", "is_hidden", "status",
                    ]
                    src_vals = [
                        gallery, image_id, rel_path, int(x["size_bytes"]), int(mtime_epoch),
                        x["sha_hex"], 1, 0, 0,
                    ]
                    if "sha256" in src_cols:
                        src_cols_list.append("sha256")
                        src_vals.append(x["sha_hex"])
                    with conn.cursor() as cur:
                        cur.execute(
                            f"INSERT INTO image_sources ({', '.join(src_cols_list)}) VALUES ({', '.join(['%s'] * len(src_cols_list))})",
                            src_vals,
                        )

                    if tag_list:
                        for name in tag_list:
                            with conn.cursor() as cur:
                                cur.execute(
                                    "INSERT INTO tags (gallery, name) VALUES (%s,%s) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
                                    (gallery, name),
                                )
                                cur.execute("SELECT LAST_INSERT_ID() AS id")
                                tag_id = int(cur.fetchone()["id"])
                                cur.execute("INSERT IGNORE INTO image_tags (image_id, tag_id) VALUES (%s,%s)", (image_id, tag_id))

                    try:
                        colors = extract_top_colors(abs_path, palette, cset)
                    except Exception:
                        logger.exception("Unhandled error")
                        colors = []
                    with conn.cursor() as cur:
                        cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
                        if colors:
                            vals2 = [(image_id, int(c["rank_no"]), int(c["color_id"]), float(c["ratio"])) for c in colors]
                            cur.executemany(
                                "INSERT INTO image_colors (image_id, rank_no, color_id, ratio) VALUES (%s,%s,%s,%s)",
                                vals2,
                            )

                    created_items.append({
                        "index": int(x["index"]),
                        "filename": x["filename"],
                        "duplicate": False,
                        "image_id": image_id,
                    })

                content_id = None
                if has_content_tables and created_items:
                    first_item = created_items[0]
                    first_staged = staged[0] if staged else None
                    content_cols_list = ["gallery", "title"]
                    content_vals = [gallery, t]
                    if "alt" in content_cols:
                        content_cols_list.append("alt")
                        content_vals.append(str(alt or ""))
                    if "shot_at" in content_cols:
                        content_cols_list.append("shot_at")
                        content_vals.append(first_staged["shot_at"] if first_staged else _now_local_naive(conf))
                    if "is_public" in content_cols:
                        content_cols_list.append("is_public")
                        content_vals.append(1 if is_public else 0)
                    if "uploader_user_id" in content_cols and actor is not None:
                        content_cols_list.append("uploader_user_id")
                        content_vals.append(int(actor.id))
                    if "thumbnail_image_id" in content_cols:
                        content_cols_list.append("thumbnail_image_id")
                        content_vals.append(int(first_item["image_id"]))
                    if "image_count" in content_cols:
                        content_cols_list.append("image_count")
                        content_vals.append(int(len(created_items)))
                    with conn.cursor() as cur:
                        cur.execute(
                            f"INSERT INTO gallery_contents ({', '.join(content_cols_list)}) VALUES ({', '.join(['%s'] * len(content_cols_list))})",
                            content_vals,
                        )
                        cur.execute("SELECT LAST_INSERT_ID() AS id")
                        content_id = int(cur.fetchone()["id"])

                    for idx, item in enumerate(created_items):
                        map_cols_list = ["content_id", "image_id"]
                        map_vals = [content_id, int(item["image_id"])]
                        if "sort_order" in content_image_cols:
                            map_cols_list.append("sort_order")
                            map_vals.append(idx + 1)
                        if "is_thumbnail" in content_image_cols:
                            map_cols_list.append("is_thumbnail")
                            map_vals.append(1 if idx == 0 else 0)
                        with conn.cursor() as cur:
                            cur.execute(
                                f"INSERT INTO gallery_content_images ({', '.join(map_cols_list)}) VALUES ({', '.join(['%s'] * len(map_cols_list))})",
                                map_vals,
                            )
                        item["content_id"] = content_id
                        item["content_key"] = f"c-{content_id}"

                conn.commit()
                conn.autocommit(True)
                if actor is not None:
                    _try_grant_post_count_badges(conn, int(actor.id))
                return {
                    "ok": True,
                    "has_duplicates": False,
                    "count": len(created_items),
                    "items": created_items,
                    "content_created": bool(has_content_tables and created_items),
                    "content_id": content_id,
                    "content_key": f"c-{content_id}" if content_id else None,
                }

            except Exception as e:
                try:
                    conn.rollback()
                except Exception:
                    pass
                try:
                    conn.autocommit(True)
                except Exception:
                    pass
                for p in created_deriv_paths:
                    try:
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass
                for p in created_orig_paths:
                    try:
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass
                raise GalleryUploadError(f"upload failed: {type(e).__name__}: {e}", 500)
        finally:
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass
    finally:
        conn.close()
