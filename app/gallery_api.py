from __future__ import annotations

from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import logging
import os
import re
import shutil
import uuid
import hashlib
import tempfile
import base64
import hmac
import secrets
import urllib.parse

logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, Request, Response, Cookie, Body
from fastapi.responses import FileResponse, HTMLResponse
import html as _html
import pymysql
from pymysql.err import IntegrityError
from PIL import Image, UnidentifiedImageError

from db import load_conf, db_conn
from auth_router import router as auth_router
from admin_router import router as admin_router
from auth_security import DEFAULT_COOKIE_NAME
from auth_service import get_current_user_by_session_token
from galleryctl.colors import extract_top_colors, load_palette_from_conf, load_settings_from_conf
from badge_defs import _parse_display_badges_py, get_post_count_badges, list_badge_keys, list_catalog as list_badge_catalog, serialize_badge
from supporter_service import (
    build_supporter_context,
    get_public_supporter_profile,
    get_user_payment_history,
    update_supporter_settings,
)
from gallery_upload_service import (
    GalleryActor,
    GalleryUploadError,
    GalleryUploadPreparedFile,
    perform_gallery_upload,
)


def clamp_per_page(n: int) -> int:
    return n if n in (30, 60, 90, 120) else 90


def parse_csv_strs(s: str | None) -> list[str]:
    if not s:
        return []
    out: list[str] = []
    for x in s.split(","):
        x = x.strip()
        if x:
            out.append(x)
    return out


def parse_csv_ints(s: str | None) -> list[int]:
    if not s:
        return []
    out: list[int] = []
    for x in s.split(","):
        x = x.strip()
        if not x:
            continue
        try:
            out.append(int(x))
        except ValueError:
            continue
    return out


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def cache_path(cache_root: Path, image_id: int, ext: str) -> Path:
    s = f"{image_id:010d}"
    return cache_root / s[0:2] / s[2:4] / s[4:6] / f"{image_id}.{ext}"


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = rgb
    r = 0 if r < 0 else 255 if r > 255 else r
    g = 0 if g < 0 else 255 if g > 255 else g
    b = 0 if b < 0 else 255 if b > 255 else b
    return f"#{r:02x}{g:02x}{b:02x}"


def _default_palette() -> list[dict]:
    base = [
        (1, "Red", (255, 75, 75)),
        (2, "Orange", (255, 159, 26)),
        (3, "Yellow", (255, 210, 26)),
        (4, "Green", (52, 211, 153)),
        (5, "Cyan", (34, 211, 238)),
        (6, "Blue", (96, 165, 250)),
        (7, "Purple", (167, 139, 250)),
        (8, "Pink", (251, 113, 133)),
        (9, "White", (229, 231, 235)),
        (10, "Black", (17, 24, 39)),
    ]
    return [{"id": cid, "name": name, "hex": _rgb_to_hex(rgb)} for cid, name, rgb in base]


def _palette_from_conf(conf: dict) -> list[dict]:
    colors = conf.get("colors") or {}
    pal = colors.get("palette")
    if not pal:
        return _default_palette()

    out: list[dict] = []
    for item in pal:
        try:
            cid = int(item["id"])
            name = str(item.get("name") or f"c{cid}")
            rgb = item.get("rgb")
            if not isinstance(rgb, (list, tuple)) or len(rgb) != 3:
                continue
            r = int(rgb[0])
            g = int(rgb[1])
            b = int(rgb[2])
            out.append({"id": cid, "name": name, "hex": _rgb_to_hex((r, g, b))})
        except Exception:
            logger.exception("Unhandled error")
            continue

    if not out:
        return _default_palette()

    out.sort(key=lambda x: int(x["id"]))
    return out


def _serialize_color_tags(color_rows: list[dict] | None) -> list[dict]:
    rows = color_rows or []
    if not rows:
        return []

    palette_map = {
        int(item["id"]): {
            "id": int(item["id"]),
            "name": str(item.get("name") or f"Color {item['id']}"),
            "hex": str(item.get("hex") or ""),
        }
        for item in _palette_from_conf(CONF)
        if item.get("id") is not None
    }

    color_tags: list[dict] = []
    for row in rows:
        try:
            color_id = int(row.get("color_id"))
        except Exception:
            continue
        palette_item = palette_map.get(color_id, {})
        color_tags.append({
            "id": color_id,
            "label": palette_item.get("name") or f"Color {color_id}",
            "name": palette_item.get("name") or f"Color {color_id}",
            "hex": palette_item.get("hex") or "",
            "ratio": float(row.get("ratio") or 0),
            "rank_no": int(row.get("rank_no") or len(color_tags) + 1),
        })

    return color_tags


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_text_search_sql(gallery: str, q: str | None) -> tuple[str, list]:
    if not q:
        return "", []
    q = q.strip()
    if not q:
        return "", []
    like = f"%{_escape_like(q)}%"
    sql = """
 AND (
   i.title LIKE %s ESCAPE '\\\\'
   OR i.alt LIKE %s ESCAPE '\\\\'
   OR EXISTS (
     SELECT 1
     FROM image_tags it
     JOIN tags t ON t.id=it.tag_id
     WHERE it.image_id=i.id AND t.gallery=%s AND t.name LIKE %s ESCAPE '\\\\'
   )
 )
"""
    return sql, [like, like, gallery, like]


def build_tag_filter_sql(gallery: str, tags_any: list[str], tags_all: list[str]) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    if tags_any:
        ph = ",".join(["%s"] * len(tags_any))
        clauses.append(
            f"""EXISTS (
                SELECT 1
                FROM image_tags it
                JOIN tags t ON t.id=it.tag_id
                WHERE it.image_id=i.id AND t.gallery=%s AND t.name IN ({ph})
            )"""
        )
        params.append(gallery)
        params.extend(tags_any)

    for tname in tags_all:
        clauses.append(
            """EXISTS (
                SELECT 1
                FROM image_tags it
                JOIN tags t ON t.id=it.tag_id
                WHERE it.image_id=i.id AND t.gallery=%s AND t.name=%s
            )"""
        )
        params.append(gallery)
        params.append(tname)

    if not clauses:
        return "", []

    return " AND " + " AND ".join(clauses), params


def build_color_filter_sql(colors_any: list[int], colors_all: list[int]) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    if colors_any:
        ph = ",".join(["%s"] * len(colors_any))
        clauses.append(
            f"""EXISTS (
                SELECT 1
                FROM image_colors ic
                WHERE ic.image_id=i.id AND ic.rank_no BETWEEN 1 AND 3 AND ic.color_id IN ({ph})
            )"""
        )
        params.extend(colors_any)

    for cid in colors_all:
        clauses.append(
            """EXISTS (
                SELECT 1
                FROM image_colors ic
                WHERE ic.image_id=i.id AND ic.rank_no BETWEEN 1 AND 3 AND ic.color_id=%s
            )"""
        )
        params.append(cid)

    if not clauses:
        return "", []

    return " AND " + " AND ".join(clauses), params


def build_date_filter_sql(column_sql: str, date_from: str | None, date_to: str | None) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    if date_from:
        clauses.append(f"{column_sql} >= %s")
        params.append(f"{date_from} 00:00:00")

    if date_to:
        clauses.append(f"{column_sql} < DATE_ADD(%s, INTERVAL 1 DAY)")
        params.append(date_to)

    if not clauses:
        return "", []

    return " AND " + " AND ".join(clauses), params


def build_gallery_date_filters(
    shot_date_from: str | None,
    shot_date_to: str | None,
    posted_date_from: str | None,
    posted_date_to: str | None,
) -> tuple[str, list]:
    shot_sql, shot_params = build_date_filter_sql("i.shot_at", shot_date_from, shot_date_to)
    posted_sql, posted_params = build_date_filter_sql("i.created_at", posted_date_from, posted_date_to)
    return f"{shot_sql}{posted_sql}", [*shot_params, *posted_params]


def month_start_and_next(now_local: datetime) -> tuple[str, str]:
    month_start = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        next_month = month_start.replace(year=month_start.year + 1, month=1)
    else:
        next_month = month_start.replace(month=month_start.month + 1)
    return month_start.strftime("%Y-%m-%d %H:%M:%S"), next_month.strftime("%Y-%m-%d %H:%M:%S")


def build_shortcut_filter_sql(
    shortcut: str | None,
    now_local: datetime,
    viewer_user_id: int | None = None,
) -> tuple[str, list]:
    key = str(shortcut or "").strip().lower()
    if key in ("", "latest"):
        return "", []

    if key == "favorites":
        if viewer_user_id is None:
            raise HTTPException(status_code=401, detail="login required")
        return " AND EXISTS (SELECT 1 FROM image_likes il WHERE il.image_id=i.id AND il.user_id=%s)", [viewer_user_id]

    if key in ("current_month", "this_month"):
        start_at, next_at = month_start_and_next(now_local)
        return " AND i.created_at >= %s AND i.created_at < %s", [start_at, next_at]

    return "", []


def _get_current_user(req: Request | None) -> dict | None:
    if req is None:
        return None

    session_token = (req.cookies.get(DEFAULT_COOKIE_NAME) or "").strip()
    if not session_token:
        return None

    current = get_current_user_by_session_token(session_token=session_token)
    if not current or not current.get("user"):
        return None

    user = current["user"]
    return {
        "id": int(user["id"]),
        "user_key": user.get("user_key"),
        "display_name": user.get("display_name"),
        "role": user.get("role"),
        "status": user.get("status"),
        "can_upload": bool(user.get("upload_enabled")),
    }


def _images_owner_expr(alias: str = "i") -> str | None:
    has_uploader = _check_column_exists("images", "uploader_user_id")
    has_owner = _check_column_exists("images", "owner_user_id")
    if has_uploader and has_owner:
        return f"COALESCE({alias}.uploader_user_id, {alias}.owner_user_id)"
    if has_uploader:
        return f"{alias}.uploader_user_id"
    if has_owner:
        return f"{alias}.owner_user_id"
    return None


def _ensure_admin_content_states_table(conn: pymysql.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_content_states (
    image_id BIGINT UNSIGNED NOT NULL,
    moderation_status ENUM('normal', 'quarantined', 'deleted') NOT NULL DEFAULT 'normal',
    previous_is_public TINYINT(1) NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (image_id),
    KEY idx_admin_content_states_status (moderation_status),
    KEY idx_admin_content_states_updated_by_user_id (updated_by_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )


def _serialize_content_owner_controls(current_user: dict | None, owner_user_id: int | None, visibility: str, status: str) -> tuple[dict, dict | None]:
    actor_user_id = int(current_user["id"]) if current_user and current_user.get("id") is not None else None
    is_owner = actor_user_id is not None and owner_user_id is not None and actor_user_id == int(owner_user_id)
    can_manage = bool(is_owner and status == "normal")
    viewer_permissions = {
        "can_manage_content": can_manage,
        "can_change_visibility": can_manage,
        "can_delete_content": can_manage,
    }
    owner_meta = None
    if is_owner:
        owner_meta = {
            "visibility": visibility,
            "status": status,
            "is_owner": True,
        }
    return viewer_permissions, owner_meta


def _viewer_visible_image_sql(viewer_user_id: int | None, image_alias: str = "i", status_alias: str = "acs") -> tuple[str, list]:
    owner_expr = _images_owner_expr(image_alias)
    status_sql = f"COALESCE({status_alias}.moderation_status, 'normal')='normal'"
    if viewer_user_id is not None and owner_expr:
        return f"{status_sql} AND ({image_alias}.is_public=1 OR {owner_expr}=%s)", [int(viewer_user_id)]
    return f"{status_sql} AND {image_alias}.is_public=1", []


def _resolve_mutable_content_rows(conn: pymysql.Connection, content_key: str) -> list[dict]:
    key = str(content_key or "").strip().lower()
    if not key:
        raise HTTPException(status_code=404, detail="not found")

    _ensure_admin_content_states_table(conn)
    owner_expr = _images_owner_expr("i")
    owner_select = f"{owner_expr} AS owner_user_id" if owner_expr else "NULL AS owner_user_id"

    with conn.cursor() as cur:
        if key.startswith("i-"):
            try:
                image_id = int(key[2:])
            except ValueError:
                raise HTTPException(status_code=400, detail="invalid content key")
            cur.execute(
                f"""
SELECT
  i.id AS image_id,
  COALESCE(i.is_public, 1) AS is_public,
  COALESCE(acs.moderation_status, 'normal') AS moderation_status,
  {owner_select}
FROM images i
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
WHERE i.gallery=%s AND i.id=%s
""",
                (GALLERY, image_id),
            )
            rows = cur.fetchall()
        elif key.startswith("c-"):
            try:
                content_id = int(key[2:])
            except ValueError:
                raise HTTPException(status_code=400, detail="invalid content key")
            if not (_table_exists(conn, "gallery_contents") and _table_exists(conn, "gallery_content_images")):
                raise HTTPException(status_code=404, detail="not found")
            cur.execute(
                f"""
SELECT
  i.id AS image_id,
  COALESCE(i.is_public, 1) AS is_public,
  COALESCE(acs.moderation_status, 'normal') AS moderation_status,
  {owner_select}
FROM gallery_content_images gci
JOIN images i ON i.id=gci.image_id AND i.gallery=%s
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
WHERE gci.content_id=%s
ORDER BY i.id ASC
""",
                (GALLERY, content_id),
            )
            rows = cur.fetchall()
        else:
            raise HTTPException(status_code=400, detail="invalid content key")

    if not rows:
        raise HTTPException(status_code=404, detail="not found")
    return rows


def _apply_owned_content_visibility(conn: pymysql.Connection, content_key: str, actor_user_id: int, is_public: bool) -> dict:
    if not _check_column_exists("images", "is_public"):
        raise HTTPException(status_code=409, detail="visibility unsupported")
    rows = _resolve_mutable_content_rows(conn, content_key)
    owner_ids = {int(row["owner_user_id"]) for row in rows if row.get("owner_user_id") is not None}
    if not owner_ids or owner_ids != {int(actor_user_id)}:
        raise HTTPException(status_code=403, detail="forbidden")
    if any(str(row.get("moderation_status") or "normal") != "normal" for row in rows):
        raise HTTPException(status_code=409, detail="content locked")

    with conn.cursor() as cur:
        for row in rows:
            image_id = int(row["image_id"])
            cur.execute("UPDATE images SET is_public=%s WHERE id=%s", (1 if is_public else 0, image_id))
            cur.execute(
                """
INSERT INTO admin_content_states (image_id, moderation_status, previous_is_public, updated_by_user_id)
VALUES (%s, 'normal', NULL, %s)
ON DUPLICATE KEY UPDATE
  moderation_status=VALUES(moderation_status),
  updated_by_user_id=VALUES(updated_by_user_id),
  updated_at=CURRENT_TIMESTAMP(6)
""",
                (image_id, actor_user_id),
            )

    visibility = "public" if is_public else "private"
    viewer_permissions, owner_meta = _serialize_content_owner_controls(
        {"id": actor_user_id},
        actor_user_id,
        visibility,
        "normal",
    )
    return {
        "content_id": str(content_key).strip().lower(),
        "visibility": visibility,
        "status": "normal",
        "viewer_permissions": viewer_permissions,
        "owner_meta": owner_meta,
    }


def _apply_owned_content_delete(conn: pymysql.Connection, content_key: str, actor_user_id: int) -> dict:
    if not _check_column_exists("images", "is_public"):
        raise HTTPException(status_code=409, detail="visibility unsupported")
    rows = _resolve_mutable_content_rows(conn, content_key)
    owner_ids = {int(row["owner_user_id"]) for row in rows if row.get("owner_user_id") is not None}
    if not owner_ids or owner_ids != {int(actor_user_id)}:
        raise HTTPException(status_code=403, detail="forbidden")
    if any(str(row.get("moderation_status") or "normal") == "quarantined" for row in rows):
        raise HTTPException(status_code=409, detail="content locked")

    with conn.cursor() as cur:
        for row in rows:
            image_id = int(row["image_id"])
            prev_visibility = 1 if bool(row.get("is_public")) else 0
            cur.execute("UPDATE images SET is_public=0 WHERE id=%s", (image_id,))
            cur.execute(
                """
INSERT INTO admin_content_states (image_id, moderation_status, previous_is_public, updated_by_user_id)
VALUES (%s, 'deleted', %s, %s)
ON DUPLICATE KEY UPDATE
  moderation_status='deleted',
  previous_is_public=VALUES(previous_is_public),
  updated_by_user_id=VALUES(updated_by_user_id),
  updated_at=CURRENT_TIMESTAMP(6)
""",
                (image_id, prev_visibility, actor_user_id),
            )

    viewer_permissions, owner_meta = _serialize_content_owner_controls(
        {"id": actor_user_id},
        actor_user_id,
        "private",
        "deleted",
    )
    return {
        "content_id": str(content_key).strip().lower(),
        "visibility": "private",
        "status": "deleted",
        "viewer_permissions": viewer_permissions,
        "owner_meta": owner_meta,
    }


def _table_cols(conn: pymysql.Connection, table: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
        rows = cur.fetchall()
    return {str(r["Field"]).lower() for r in rows}


def _client_ip(req: Request) -> str:
    xff = (req.headers.get("x-forwarded-for") or "").strip()
    if xff:
        return xff.split(",")[0].strip()
    if req.client and req.client.host:
        return str(req.client.host)
    return ""


def _now_local_naive(conf: dict) -> datetime:
    tz = str((conf.get("app") or {}).get("timezone") or "Asia/Tokyo")
    try:
        dt = datetime.now(ZoneInfo(tz))
        return dt.replace(tzinfo=None)
    except Exception:
        logger.exception("Unhandled error")
        return datetime.now()


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _b64u_dec(s: str) -> bytes:
    pad = "=" * ((4 - (len(s) % 4)) % 4)
    return base64.urlsafe_b64decode((s + pad).encode("ascii"))


def _hash_password(password: str) -> str:
    pw = password.encode("utf-8")
    salt = os.urandom(16)
    iters = 200_000
    dk = hashlib.pbkdf2_hmac("sha256", pw, salt, iters, dklen=32)
    return f"pbkdf2_sha256${iters}${_b64u(salt)}${_b64u(dk)}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) != 4:
            return False
        algo, iters_s, salt_s, hash_s = parts
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iters_s)
        salt = _b64u_dec(salt_s)
        want = _b64u_dec(hash_s)
        got = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters, dklen=len(want))
        return hmac.compare_digest(got, want)
    except Exception:
        logger.exception("Unhandled error")
        return False


_USERKEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{3,19}$")


def _validate_user_key(user_key: str) -> str:
    k = str(user_key or "").strip()
    if not _USERKEY_RE.match(k):
        raise HTTPException(status_code=400, detail="invalid user_key")
    return k


def _cookie_secure(conf: dict) -> bool:
    v = (conf.get("app") or {}).get("cookie_secure")
    if v is None:
        return False
    return bool(v)


app = FastAPI()
app.include_router(auth_router)
app.include_router(admin_router)

CONF_PATH = os.environ.get("GALLERY_CONF", "/etc/felixxsv-gallery/gallery.conf")
CONF = load_conf(CONF_PATH)
GALLERY = CONF["app"]["gallery"]

SOURCE_ROOT = Path(CONF["paths"]["source_root"])
CACHE_ROOT = Path(CONF["paths"]["original_cache_root"])
STORAGE_ROOT = Path((CONF.get("paths") or {}).get("storage_root") or "/data/felixxsv-gallery/www/storage")


def _check_column_exists(table: str, column: str) -> bool:
    """Check whether a column exists in a table (used to handle pending migrations)."""
    try:
        conn = db_conn(CONF)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s",
                [table, column],
            )
            return int((cur.fetchone() or {}).get("cnt", 0)) > 0
    except Exception:
        logger.exception("Unhandled error")
        return False
    finally:
        conn.close()


# Cache column-existence checks at startup to avoid per-request overhead
_HAS_IMAGES_OWNER_USER_ID: bool = _check_column_exists("images", "owner_user_id")
_HAS_IMAGES_ACCESS_TOKEN: bool = _check_column_exists("images", "access_token")
_HAS_USERS_HIDDEN_FROM_SEARCH: bool = _check_column_exists("users", "is_hidden_from_search")


@app.get("/api/health")
def health():
    return {"ok": True}


def _load_user_display_badges(conn, user_id: int, display_badge_keys: list) -> list[dict]:
    """Load badge details for the user's selected display badges."""
    if not display_badge_keys:
        return []
    if not _detect_table_exists(conn, "user_badges"):
        return []
    placeholders = ",".join(["%s"] * len(display_badge_keys))
    import json as _json
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT badge_key, granted_by, granted_at FROM user_badges WHERE user_id=%s AND badge_key IN ({placeholders})",
            [user_id, *display_badge_keys],
        )
        rows = {r["badge_key"]: r for r in (cur.fetchall() or [])}
    result = []
    for key in display_badge_keys:
        if key in rows:
            row = rows[key]
            result.append(serialize_badge(key, granted_at=None, granted_by=row.get("granted_by"), conn=conn))
    return result


def _detect_table_exists(conn, table_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE %s", (table_name,))
        return cur.fetchone() is not None


@app.get("/api/users/{user_key}")
def get_public_user_profile(user_key: str):
    try:
        validated = _validate_user_key(user_key)
    except HTTPException:
        raise HTTPException(status_code=404, detail="not found")

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_key, display_name, bio, avatar_path, display_badges FROM users WHERE user_key=%s AND status='active'",
                [validated],
            )
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=404, detail="not found")

            cur.execute(
                "SELECT url FROM user_links WHERE user_id=%s AND gallery=%s ORDER BY display_order ASC, id ASC",
                [user["id"], GALLERY],
            )
            links = [{"url": r["url"]} for r in cur.fetchall()]

            avatar_url = f"/api/auth/avatar/{user['id']}" if user.get("avatar_path") else None
            display_badge_keys = _parse_display_badges_py(user.get("display_badges"), conn=conn)
            badges = _load_user_display_badges(conn, user["id"], display_badge_keys)
            supporter_profile = get_public_supporter_profile(conn, int(user["id"]), conf=CONF)

            return {
                "user": {
                    "user_key": user["user_key"],
                    "display_name": user["display_name"],
                    "bio": user.get("bio") or "",
                    "links": links,
                    "avatar_url": avatar_url,
                    "badges": badges,
                    "supporter_profile": supporter_profile,
                }
            }
    finally:
        conn.close()


@app.get("/api/support/me")
def get_my_support(
    req: Request,
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    session_result = get_current_user_by_session_token(gallery_session)
    user = (session_result or {}).get("user") if session_result else None
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です。")
    conn = db_conn(CONF)
    try:
        return {
            "support": build_supporter_context(conn, int(user["id"]), conf=CONF, include_private=True, include_admin=False),
        }
    finally:
        conn.close()


@app.put("/api/support/me/settings")
async def update_my_support_settings(
    req: Request,
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    session_result = get_current_user_by_session_token(gallery_session)
    user = (session_result or {}).get("user") if session_result else None
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です。")
    payload = await req.json()
    conn = db_conn(CONF)
    try:
        settings = update_supporter_settings(conn, int(user["id"]), payload or {})
        conn.commit()
        support = build_supporter_context(conn, int(user["id"]), conf=CONF, include_private=True, include_admin=False)
        support["settings"] = settings
        return {
            "ok": True,
            "support": support,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@app.get("/api/support/me/entitlements")
def get_my_support_entitlements(
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    session_result = get_current_user_by_session_token(gallery_session)
    user = (session_result or {}).get("user") if session_result else None
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です。")
    conn = db_conn(CONF)
    try:
        support = build_supporter_context(conn, int(user["id"]), conf=CONF, include_private=True, include_admin=False)
        return {
            "entitlements": support.get("entitlements") or {},
            "status": support.get("status") or {},
        }
    finally:
        conn.close()


@app.get("/api/support/me/payments")
def get_my_support_payments(
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
    limit: int = Query(default=24, ge=1, le=60),
):
    session_result = get_current_user_by_session_token(gallery_session)
    user = (session_result or {}).get("user") if session_result else None
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です。")
    conn = db_conn(CONF)
    try:
        payments = get_user_payment_history(conn, int(user["id"]), limit=limit)
        return {"payments": payments}
    finally:
        conn.close()


@app.put("/api/users/me/badge-display")
async def update_my_badge_display(
    request: Request,
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    """User selects up to 3 badges from their pool to display on public profile."""
    import json as _json
    payload = await request.json()
    badge_keys = payload.get("badge_keys") or []
    if not isinstance(badge_keys, list):
        raise HTTPException(status_code=400, detail="badge_keys must be a list")
    if len(badge_keys) > 3:
        raise HTTPException(status_code=400, detail="バッジは最大3つまで選択できます。")

    session_result = get_current_user_by_session_token(gallery_session)
    user = (session_result or {}).get("user") if session_result else None
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です。")

    conn = db_conn(CONF)
    try:
        if not _detect_table_exists(conn, "user_badges"):
            raise HTTPException(status_code=503, detail="バッジ機能はまだ有効になっていません。")

        # Validate all badge_keys are in user's pool
        if badge_keys:
            placeholders = ",".join(["%s"] * len(badge_keys))
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT badge_key FROM user_badges WHERE user_id=%s AND badge_key IN ({placeholders})",
                    [user["id"], *badge_keys],
                )
                owned = {r["badge_key"] for r in (cur.fetchall() or [])}
            invalid = [k for k in badge_keys if k not in owned]
            if invalid:
                raise HTTPException(status_code=400, detail=f"所持していないバッジです: {', '.join(invalid)}")
            # Validate keys exist in catalog
            unknown = [k for k in badge_keys if k not in set(list_badge_keys(conn))]
            if unknown:
                raise HTTPException(status_code=400, detail=f"無効なバッジキーです: {', '.join(unknown)}")

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET display_badges=%s WHERE id=%s",
                (_json.dumps(badge_keys), user["id"]),
            )
        conn.commit()
        return {"ok": True, "display_badges": badge_keys}
    finally:
        conn.close()


@app.get("/api/users/me/badges")
def get_my_badges(
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    """Return the current user's badge pool and current display selection."""
    import json as _json
    session_result = get_current_user_by_session_token(gallery_session)
    user = (session_result or {}).get("user") if session_result else None
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です。")

    conn = db_conn(CONF)
    try:
        if not _detect_table_exists(conn, "user_badges"):
            return {"pool": [], "display_badges": [], "catalog": []}

        with conn.cursor() as cur:
            cur.execute(
                "SELECT badge_key, granted_by, granted_at FROM user_badges WHERE user_id=%s ORDER BY granted_at ASC",
                (user["id"],),
            )
            rows = cur.fetchall() or []
        pool = [serialize_badge(r["badge_key"], granted_at=None, granted_by=r.get("granted_by"), conn=conn) for r in rows]

        with conn.cursor() as cur:
            cur.execute("SELECT display_badges FROM users WHERE id=%s LIMIT 1", (user["id"],))
            row = cur.fetchone()
        display_badges = _parse_display_badges_py(row.get("display_badges") if row else None, conn=conn)
        return {"pool": pool, "display_badges": display_badges, "catalog": list_badge_catalog(conn)}
    finally:
        conn.close()


@app.get("/api/palette")
def palette():
    return {"items": _palette_from_conf(CONF)}


@app.get("/api/search-suggest")
def search_suggest(q: str | None = None):
    q_str = (q or "").strip()
    if len(q_str) < 1:
        return {"images": [], "tags": [], "users": []}
    like = f"%{_escape_like(q_str)}%"
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT i.id, i.title, i.thumb_path_480 "
                "FROM images i "
                "JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0 "
                "WHERE i.gallery=%s AND i.is_public=1 "
                "AND (i.title LIKE %s ESCAPE '\\\\' OR i.alt LIKE %s ESCAPE '\\\\') "
                "ORDER BY i.shot_at DESC LIMIT 4",
                [GALLERY, GALLERY, like, like],
            )
            images = list(cur.fetchall())
            cur.execute(
                "SELECT t.name, COUNT(it.image_id) AS cnt, "
                "  (SELECT i2.thumb_path_480 FROM image_tags it2 "
                "   JOIN images i2 ON i2.id=it2.image_id AND i2.gallery=%s AND i2.is_public=1 "
                "   WHERE it2.tag_id=t.id ORDER BY i2.like_count DESC LIMIT 1) AS thumb_path "
                "FROM tags t "
                "JOIN image_tags it ON it.tag_id=t.id "
                "JOIN images i ON i.id=it.image_id AND i.gallery=%s AND i.is_public=1 "
                "WHERE t.gallery=%s AND t.name LIKE %s ESCAPE '\\\\' "
                "GROUP BY t.id, t.name ORDER BY cnt DESC LIMIT 5",
                [GALLERY, GALLERY, GALLERY, like],
            )
            tags = list(cur.fetchall())
            hidden_filter = " AND u.is_hidden_from_search=0" if _HAS_USERS_HIDDEN_FROM_SEARCH else ""
            cur.execute(
                "SELECT u.user_key, u.display_name "
                "FROM users u "
                f"WHERE u.status='active'{hidden_filter} "
                "AND (u.user_key LIKE %s ESCAPE '\\\\' OR u.display_name LIKE %s ESCAPE '\\\\') "
                "LIMIT 3",
                [like, like],
            )
            users = list(cur.fetchall())
        return {
            "images": [{"id": r["id"], "title": r["title"], "thumb_path": r["thumb_path_480"]} for r in images],
            "tags": [{"name": r["name"], "count": int(r["cnt"]), "thumb_path": r["thumb_path"]} for r in tags],
            "users": [{"user_key": r["user_key"], "display_name": r["display_name"]} for r in users],
        }
    finally:
        conn.close()


@app.get("/api/images")
def list_images(
    req: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(90, ge=1),
    sort: str = Query("latest"),
    q: str | None = None,
    owner_user_key: str | None = None,
    tags_any: str | None = None,
    tags_all: str | None = None,
    colors_any: str | None = None,
    colors_all: str | None = None,
    shot_date_from: str | None = None,
    shot_date_to: str | None = None,
    posted_date_from: str | None = None,
    posted_date_to: str | None = None,
    shortcut: str | None = None,
    random_seed: str | None = None,
):
    per_page = clamp_per_page(per_page)
    offset = (page - 1) * per_page

    current_user = _get_current_user(req)
    viewer_user_id = int(current_user["id"]) if current_user else None

    tags_any_list = parse_csv_strs(tags_any)
    tags_all_list = parse_csv_strs(tags_all)
    colors_any_list = parse_csv_ints(colors_any)
    colors_all_list = parse_csv_ints(colors_all)

    tag_sql, tag_params = build_tag_filter_sql(GALLERY, tags_any_list, tags_all_list)
    color_sql, color_params = build_color_filter_sql(colors_any_list, colors_all_list)
    date_sql, date_params = build_gallery_date_filters(
        shot_date_from,
        shot_date_to,
        posted_date_from,
        posted_date_to,
    )
    text_sql, text_params = build_text_search_sql(GALLERY, q)
    shortcut_sql, shortcut_params = build_shortcut_filter_sql(shortcut, _now_local_naive(CONF), viewer_user_id=viewer_user_id)

    owner_key_str = (owner_user_key or "").strip()
    if owner_key_str and re.match(r'^[a-zA-Z0-9_-]{1,20}$', owner_key_str) and _HAS_IMAGES_OWNER_USER_ID:
        owner_sql = " AND EXISTS (SELECT 1 FROM users uu WHERE uu.id=i.owner_user_id AND uu.user_key=%s AND uu.status='active')"
        owner_params: list = [owner_key_str]
    else:
        owner_sql, owner_params = "", []

    where_extra_sql = f"{tag_sql}{color_sql}{date_sql}{text_sql}{shortcut_sql}{owner_sql}"
    where_extra_params = [*tag_params, *color_params, *date_params, *text_params, *shortcut_params, *owner_params]

    sort_key = (sort or "latest").lower()
    join_stats = "LEFT JOIN image_stats st ON st.image_id=i.id"
    status_join = "LEFT JOIN admin_content_states acs ON acs.image_id=i.id"
    visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")
    access_token_select = ", i.access_token" if _HAS_IMAGES_ACCESS_TOKEN else ", NULL AS access_token"
    if _HAS_IMAGES_OWNER_USER_ID:
        user_select = """,
  i.owner_user_id AS owner_user_id,
  u.user_key AS uploader_user_key,
  u.display_name AS uploader_display_name,
  CASE WHEN u.avatar_path IS NOT NULL THEN CONCAT('/api/auth/avatar/', u.id) ELSE NULL END AS uploader_avatar_url"""
        user_join = "LEFT JOIN users u ON u.id = i.owner_user_id AND u.status = 'active'"
    else:
        user_select = ""
        user_join = ""
    order_params: list = []
    viewer_liked_sql = "0 AS viewer_liked"
    viewer_liked_params: list = []

    if viewer_user_id is not None:
        viewer_liked_sql = "EXISTS(SELECT 1 FROM image_likes il WHERE il.image_id=i.id AND il.user_id=%s) AS viewer_liked"
        viewer_liked_params.append(viewer_user_id)

    if sort_key == "popular":
        order_sql = "ORDER BY i.like_count DESC, COALESCE(st.view_count,0) DESC, i.shot_at DESC"
    elif sort_key in ("shot_oldest", "oldest"):
        order_sql = "ORDER BY i.shot_at ASC, i.created_at ASC, i.id ASC"
    elif sort_key == "posted_newest":
        order_sql = "ORDER BY i.created_at DESC, i.shot_at DESC, i.id DESC"
    elif sort_key == "posted_oldest":
        order_sql = "ORDER BY i.created_at ASC, i.shot_at ASC, i.id ASC"
    elif sort_key == "random":
        seed = str(random_seed or "").strip() or _now_local_naive(CONF).strftime("%Y%m%d")
        order_sql = "ORDER BY SHA2(CONCAT(%s, ':', i.id), 256)"
        order_params.append(seed)
    else:  # shot_newest, latest (alias), default
        order_sql = "ORDER BY i.shot_at DESC, i.created_at DESC, i.id DESC"

    sql_count = f"""
SELECT COUNT(*)
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
{join_stats}
{status_join}
WHERE i.gallery=%s AND {visibility_sql}
{where_extra_sql}
"""

    sql_list = f"""
SELECT
  i.id, i.shot_at, i.created_at, i.title, i.alt, i.width, i.height, i.format,
  i.thumb_path_480, i.thumb_path_960, i.preview_path,
  COALESCE(i.focal_x, 50) AS focal_x, COALESCE(i.focal_y, 50) AS focal_y,
  COALESCE(st.view_count,0) AS view_count,
  i.like_count,
  COALESCE(i.is_public, 1) AS is_public,
  {viewer_liked_sql}{access_token_select}{user_select}
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
{join_stats}
{status_join}
{user_join}
WHERE i.gallery=%s AND {visibility_sql}
{where_extra_sql}
{order_sql}
LIMIT %s OFFSET %s
"""

    conn = db_conn(CONF)
    try:
        _ensure_admin_content_states_table(conn)
        with conn.cursor() as cur:
            cur.execute(sql_count, [GALLERY, GALLERY, *visibility_params, *where_extra_params])
            total = int(cur.fetchone()["COUNT(*)"])

            cur.execute(sql_list, [*viewer_liked_params, GALLERY, GALLERY, *visibility_params, *where_extra_params, *order_params, per_page, offset])
            items = cur.fetchall()

        for item in items:
            item["visibility"] = "public" if bool(item.get("is_public")) else "private"

        pages = (total + per_page - 1) // per_page
        return {"page": page, "per_page": per_page, "pages": pages, "total": total, "items": items}
    finally:
        conn.close()


@app.post("/api/images/{image_id}/view")
def inc_view(image_id: int):
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO image_stats (image_id, view_count) VALUES (%s, 1) "
                "ON DUPLICATE KEY UPDATE view_count=view_count+1",
                (image_id,),
            )
        return {"ok": True}
    finally:
        conn.close()


@app.get("/api/images/{image_id}")
def get_image(image_id: int, req: Request):
    current_user = _get_current_user(req)
    viewer_user_id = int(current_user["id"]) if current_user else None
    viewer_liked_sql = "0 AS viewer_liked"
    viewer_liked_params: list = []

    if viewer_user_id is not None:
        viewer_liked_sql = "EXISTS(SELECT 1 FROM image_likes il WHERE il.image_id=i.id AND il.user_id=%s) AS viewer_liked"
        viewer_liked_params.append(viewer_user_id)

    access_token_select = ", i.access_token" if _HAS_IMAGES_ACCESS_TOKEN else ", NULL AS access_token"
    conn = db_conn(CONF)
    try:
        _ensure_admin_content_states_table(conn)
        visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")
        with conn.cursor() as cur:
            owner_expr = _images_owner_expr("i")
            if _HAS_IMAGES_OWNER_USER_ID:
                detail_user_select = """,
  u.user_key AS uploader_user_key,
  u.display_name AS uploader_display_name,
  CASE WHEN u.avatar_path IS NOT NULL THEN CONCAT('/api/auth/avatar/', u.id) ELSE NULL END AS uploader_avatar_url"""
                detail_user_join = "LEFT JOIN users u ON u.id = i.owner_user_id AND u.status = 'active'"
            else:
                detail_user_select = ""
                detail_user_join = ""
            owner_select = f", {owner_expr} AS owner_user_id" if owner_expr else ", NULL AS owner_user_id"
            cur.execute(
                f"""
SELECT
  i.id, i.shot_at, i.title, i.alt, i.width, i.height, i.format,
  i.thumb_path_480, i.thumb_path_960, i.preview_path,
  COALESCE(i.focal_x, 50) AS focal_x, COALESCE(i.focal_y, 50) AS focal_y,
  COALESCE(st.view_count,0) AS view_count,
  i.like_count AS like_count,
  COALESCE(st.x_like_count,0) AS x_like_count,
  COALESCE(i.is_public, 1) AS is_public,
  COALESCE(acs.moderation_status, 'normal') AS moderation_status,
  {viewer_liked_sql}{detail_user_select}{owner_select}{access_token_select}
FROM images i
LEFT JOIN image_stats st ON st.image_id=i.id
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
{detail_user_join}
WHERE i.gallery=%s AND i.id=%s AND {visibility_sql}
""",
                [*viewer_liked_params, GALLERY, image_id, *visibility_params],
            )
            img = cur.fetchone()
            if not img:
                raise HTTPException(status_code=404, detail="not found")

            cur.execute(
                """
SELECT t.name
FROM image_tags it
JOIN tags t ON t.id=it.tag_id
WHERE it.image_id=%s AND t.gallery=%s
ORDER BY t.name ASC
""",
                (image_id, GALLERY),
            )
            img["tags"] = [r["name"] for r in cur.fetchall()]

            cur.execute(
                """
SELECT rank_no, color_id, ratio
FROM image_colors
WHERE image_id=%s
ORDER BY rank_no ASC
""",
                (image_id,),
            )
            img["colors"] = cur.fetchall()
            img["color_tags"] = _serialize_color_tags(img["colors"])

        visibility = "public" if bool(img.get("is_public", 1)) else "private"
        status = str(img.get("moderation_status") or "normal")
        viewer_permissions, owner_meta = _serialize_content_owner_controls(
            current_user,
            int(img["owner_user_id"]) if img.get("owner_user_id") is not None else None,
            visibility,
            status,
        )
        img["visibility"] = visibility
        img["viewer_permissions"] = viewer_permissions
        if owner_meta is not None:
            img["owner_meta"] = owner_meta

        return img
    finally:
        conn.close()



def _get_image_like_count(conn: pymysql.Connection, image_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT like_count FROM images WHERE id=%s", (image_id,))
        row = cur.fetchone()
    return int((row or {}).get("like_count") or 0)


@app.post("/api/images/{image_id}/like")
def like_image(image_id: int, req: Request):
    current_user = _get_current_user(req)
    if not current_user:
        raise HTTPException(status_code=401, detail="login required")

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM images WHERE gallery=%s AND id=%s AND is_public=1",
                (GALLERY, image_id),
            )
            image_row = cur.fetchone()
            if not image_row:
                raise HTTPException(status_code=404, detail="not found")

            cur.execute(
                "INSERT IGNORE INTO image_likes (image_id, user_id) VALUES (%s, %s)",
                (image_id, int(current_user["id"])),
            )
            inserted = cur.rowcount > 0

            if inserted:
                cur.execute(
                    "UPDATE images SET like_count = like_count + 1 WHERE id=%s",
                    (image_id,),
                )
                cur.execute(
                    "INSERT INTO image_stats (image_id, like_count) VALUES (%s, 1) "
                    "ON DUPLICATE KEY UPDATE like_count = like_count + 1",
                    (image_id,),
                )

        return {"ok": True, "liked": True, "like_count": _get_image_like_count(conn, image_id)}
    finally:
        conn.close()


@app.delete("/api/images/{image_id}/like")
def unlike_image(image_id: int, req: Request):
    current_user = _get_current_user(req)
    if not current_user:
        raise HTTPException(status_code=401, detail="login required")

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM images WHERE gallery=%s AND id=%s AND is_public=1",
                (GALLERY, image_id),
            )
            image_row = cur.fetchone()
            if not image_row:
                raise HTTPException(status_code=404, detail="not found")

            cur.execute(
                "DELETE FROM image_likes WHERE image_id=%s AND user_id=%s",
                (image_id, int(current_user["id"])),
            )
            deleted = cur.rowcount > 0

            if deleted:
                cur.execute(
                    "UPDATE images SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id=%s",
                    (image_id,),
                )
                cur.execute(
                    "INSERT INTO image_stats (image_id, like_count) VALUES (%s, 0) "
                    "ON DUPLICATE KEY UPDATE like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END",
                    (image_id,),
                )

        return {"ok": True, "liked": False, "like_count": _get_image_like_count(conn, image_id)}
    finally:
        conn.close()


@app.get("/api/image-archives")
def list_image_archives(
    req: Request,
    kind: str = Query("shot"),
    q: str | None = None,
    tags_any: str | None = None,
    tags_all: str | None = None,
    colors_any: str | None = None,
    colors_all: str | None = None,
    shot_date_from: str | None = None,
    shot_date_to: str | None = None,
    posted_date_from: str | None = None,
    posted_date_to: str | None = None,
    shortcut: str | None = None,
):
    archive_kind = str(kind or "shot").strip().lower()
    if archive_kind not in ("shot", "posted"):
        raise HTTPException(status_code=400, detail="invalid kind")

    current_user = _get_current_user(req)
    viewer_user_id = int(current_user["id"]) if current_user else None

    tags_any_list = parse_csv_strs(tags_any)
    tags_all_list = parse_csv_strs(tags_all)
    colors_any_list = parse_csv_ints(colors_any)
    colors_all_list = parse_csv_ints(colors_all)

    tag_sql, tag_params = build_tag_filter_sql(GALLERY, tags_any_list, tags_all_list)
    color_sql, color_params = build_color_filter_sql(colors_any_list, colors_all_list)
    text_sql, text_params = build_text_search_sql(GALLERY, q)
    shortcut_sql, shortcut_params = build_shortcut_filter_sql(shortcut, _now_local_naive(CONF), viewer_user_id=viewer_user_id)

    shot_from = shot_date_from if archive_kind != "shot" else None
    shot_to = shot_date_to if archive_kind != "shot" else None
    posted_from = posted_date_from if archive_kind != "posted" else None
    posted_to = posted_date_to if archive_kind != "posted" else None
    date_sql, date_params = build_gallery_date_filters(shot_from, shot_to, posted_from, posted_to)

    where_extra_sql = f"{tag_sql}{color_sql}{date_sql}{text_sql}{shortcut_sql}"
    where_extra_params = [*tag_params, *color_params, *date_params, *text_params, *shortcut_params]

    target_column = "i.created_at" if archive_kind == "posted" else "i.shot_at"
    visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")

    sql = f"""
SELECT
  YEAR({target_column}) AS y,
  MONTH({target_column}) AS m,
  COUNT(*) AS c
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
WHERE i.gallery=%s AND {visibility_sql} AND {target_column} IS NOT NULL
{where_extra_sql}
GROUP BY YEAR({target_column}), MONTH({target_column})
ORDER BY YEAR({target_column}) DESC, MONTH({target_column}) DESC
"""

    conn = db_conn(CONF)
    try:
        _ensure_admin_content_states_table(conn)
        with conn.cursor() as cur:
            cur.execute(sql, [GALLERY, GALLERY, *visibility_params, *where_extra_params])
            rows = cur.fetchall()

        grouped: list[dict] = []
        current_year = None
        current_months: list[dict] = []

        for row in rows:
            year = int(row["y"])
            month = int(row["m"])
            count = int(row["c"])

            if current_year != year:
                if current_year is not None:
                    grouped.append({"year": current_year, "months": current_months})
                current_year = year
                current_months = []

            current_months.append({"month": month, "count": count})

        if current_year is not None:
            grouped.append({"year": current_year, "months": current_months})

        return {"kind": archive_kind, "items": grouped}
    finally:
        conn.close()


@app.get("/api/tags")
def list_tags(limit: int = Query(200, ge=1, le=2000)):
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT t.name, COUNT(*) AS c
FROM tags t
JOIN image_tags it ON it.tag_id=t.id
JOIN images i ON i.id=it.image_id AND i.gallery=%s AND i.is_public=1
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
WHERE t.gallery=%s
GROUP BY t.name
ORDER BY c DESC, t.name ASC
LIMIT %s
""",
                (GALLERY, GALLERY, GALLERY, limit),
            )
            rows = cur.fetchall()
        return {"items": rows}
    finally:
        conn.close()


@app.post("/api/check-hashes")
async def check_hashes(req: Request):
    u = _get_current_user(req)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    body = await req.json()
    hashes = [str(h) for h in (body.get("hashes") or []) if h]
    if not hashes:
        return {"duplicates": []}
    uniq = sorted(set(hashes))
    conn = db_conn(CONF)
    try:
        ph = ",".join(["%s"] * len(uniq))
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT content_hash FROM images WHERE gallery=%s AND content_hash IN ({ph})",
                [GALLERY, *uniq],
            )
            found = {str(r["content_hash"]) for r in cur.fetchall()}
        return {"duplicates": [h for h in hashes if h in found]}
    finally:
        conn.close()


def _try_grant_post_count_badges(conn, user_id: int) -> None:
    """Check post count and auto-grant threshold badges. Safe to call after commit."""
    try:
        if not _detect_table_exists(conn, "user_badges"):
            return
        # Count uploads by this user
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
        # Grant all thresholds reached
        to_grant = [key for threshold, key in get_post_count_badges(conn) if post_count >= threshold]
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


@app.post("/api/upload")
def upload_images(
    req: Request,
    title: str = Form(...),
    alt: str = Form(""),
    tags: str = Form(""),
    is_public: str = Form("true"),
    shot_at: str = Form(""),
    focal_x: float = Form(50.0),
    focal_y: float = Form(50.0),
    files: list[UploadFile] = File(...),
):
    u = _get_current_user(req)
    try:
        prepared_files: list[GalleryUploadPreparedFile] = []
        for idx, upload in enumerate(files):
            name = upload.filename or f"file{idx}"
            try:
                try:
                    upload.file.seek(0)
                except Exception:
                    pass
                content = upload.file.read()
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"save failed: {type(exc).__name__}: {exc}")
            prepared_files.append(GalleryUploadPreparedFile(filename=name, content=content))

        actor = GalleryActor(id=int(u["id"]), can_upload=bool(u.get("can_upload"))) if u else None
        return perform_gallery_upload(
            conf=CONF,
            title=title,
            alt=alt,
            tags=tags,
            is_public=str(is_public or "true").strip().lower() in ("1", "true", "yes", "on"),
            shot_at=shot_at,
            focal_x=focal_x,
            focal_y=focal_y,
            files=prepared_files,
            actor=actor,
            upload_source="web",
        )
    except GalleryUploadError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.get("/media/original/{image_id}")
def get_original(image_id: int, req: Request):
    current_user = _get_current_user(req)
    viewer_user_id = int(current_user["id"]) if current_user else None
    conn = db_conn(CONF)
    try:
        _ensure_admin_content_states_table(conn)
        visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")
        with conn.cursor() as cur:
            cur.execute(
                f"""
SELECT s.source_path
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
WHERE i.gallery=%s AND i.id=%s AND {visibility_sql}
LIMIT 1
""",
                (GALLERY, GALLERY, image_id, *visibility_params),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="not found")
            rel = str(r["source_path"])
    finally:
        conn.close()

    src = SOURCE_ROOT / rel
    if not src.exists():
        raise HTTPException(status_code=404, detail="source missing")

    ext = src.suffix.lstrip(".").lower() or "bin"
    dst = cache_path(CACHE_ROOT, image_id, ext)
    ensure_dir(dst.parent)

    if not dst.exists():
        shutil.copy2(src, dst)

    return FileResponse(str(dst))


@app.get("/img/{token}")
def get_by_token(token: str, req: Request):
    if not re.match(r'^[0-9a-fA-F]{16}$', token):
        raise HTTPException(status_code=404, detail="not found")
    current_user = _get_current_user(req)
    viewer_user_id = int(current_user["id"]) if current_user else None
    conn = db_conn(CONF)
    try:
        _ensure_admin_content_states_table(conn)
        visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")
        with conn.cursor() as cur:
            cur.execute(
                f"""
SELECT i.id, i.title, s.source_path
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
WHERE i.gallery=%s AND i.access_token=%s AND {visibility_sql}
LIMIT 1
""",
                (GALLERY, GALLERY, token, *visibility_params),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="not found")
            image_id = int(r["id"])
            title = str(r["title"] or "").strip()
            rel = str(r["source_path"])
    finally:
        conn.close()

    src = SOURCE_ROOT / rel
    if not src.exists():
        raise HTTPException(status_code=404, detail="source missing")

    ext = src.suffix.lstrip(".").lower() or "bin"
    dst = cache_path(CACHE_ROOT, image_id, ext)
    ensure_dir(dst.parent)

    if not dst.exists():
        shutil.copy2(src, dst)

    display_name = title or token
    encoded = urllib.parse.quote(display_name, safe="")
    headers = {"Content-Disposition": f"inline; filename*=UTF-8''{encoded}"}
    return FileResponse(str(dst), headers=headers)


_VIEW_MIME: dict[str, str] = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "png": "image/png", "gif": "image/gif",
    "webp": "image/webp", "avif": "image/avif",
    "svg": "image/svg+xml",
}

@app.get("/view/{token}")
def view_by_token(token: str, req: Request):
    if not re.match(r'^[0-9a-fA-F]{16}$', token):
        raise HTTPException(status_code=404, detail="not found")
    current_user = _get_current_user(req)
    viewer_user_id = int(current_user["id"]) if current_user else None
    conn = db_conn(CONF)
    try:
        _ensure_admin_content_states_table(conn)
        visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")
        with conn.cursor() as cur:
            cur.execute(
                f"""
SELECT i.id, i.title, s.source_path
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
WHERE i.gallery=%s AND i.access_token=%s AND {visibility_sql}
LIMIT 1
""",
                (GALLERY, GALLERY, token, *visibility_params),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="not found")
            image_id = int(r["id"])
            title = str(r["title"] or "").strip() or token
            rel = str(r["source_path"])
    finally:
        conn.close()

    src = SOURCE_ROOT / rel
    if not src.exists():
        raise HTTPException(status_code=404, detail="source missing")

    ext = src.suffix.lstrip(".").lower() or "bin"
    dst = cache_path(CACHE_ROOT, image_id, ext)
    ensure_dir(dst.parent)
    if not dst.exists():
        shutil.copy2(src, dst)

    mime = _VIEW_MIME.get(ext, "image/jpeg")
    img_b64 = base64.b64encode(dst.read_bytes()).decode()
    data_uri = f"data:{mime};base64,{img_b64}"

    safe_title = _html.escape(title)
    page = f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>{safe_title}</title>
  <style>
    *{{margin:0;padding:0;box-sizing:border-box}}
    html,body{{width:100%;height:100%;background:#111;overflow:hidden}}
    #stage{{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;cursor:grab}}
    #stage.dragging{{cursor:grabbing}}
    #img{{max-width:100vw;max-height:100vh;object-fit:contain;display:block;-webkit-user-drag:none;user-select:none;will-change:transform;transform-origin:center}}
    #slider-wrap{{position:fixed;top:50%;right:18px;transform:translateY(-50%);width:48px;height:220px;display:grid;place-items:center;background:rgba(12,18,28,.52);border-radius:999px;border:1px solid rgba(255,255,255,.12);z-index:10;opacity:0;transition:opacity .18s ease}}
    body.is-controls-visible #slider-wrap{{opacity:1}}
    @media(pointer:coarse){{#slider-wrap{{display:none}}}}
    #slider{{appearance:auto;writing-mode:vertical-lr;direction:rtl;width:8px;height:180px;accent-color:#88a9ff;background:transparent;cursor:pointer}}
  </style>
</head>
<body>
  <div id="stage"><img id="img" src="{data_uri}" alt="{safe_title}" draggable="false"></div>
  <div id="slider-wrap" hidden>
    <input id="slider" type="range" min="100" max="800" step="10" value="100" aria-label="Zoom">
  </div>
  <script>
    document.addEventListener('contextmenu',e=>e.preventDefault());
    document.addEventListener('dragstart',e=>e.preventDefault());
    const stage=document.getElementById('stage'),img=document.getElementById('img');
    const sliderWrap=document.getElementById('slider-wrap'),slider=document.getElementById('slider');
    let sc=1,tx=0,ty=0,hideTimer=null,dr=false,dx,dy;
    function apply(){{
      img.style.transform=`translate(${{tx}}px,${{ty}}px) scale(${{sc}})`;
      slider.value=String(Math.round(sc*100));
      sliderWrap.hidden=sc<=1;
    }}
    function zoomAt(cx,cy,f){{
      const ns=Math.min(8,Math.max(1,sc*f)),r=ns/sc;
      tx=(cx-innerWidth/2)*(1-r)+tx*r;
      ty=(cy-innerHeight/2)*(1-r)+ty*r;
      sc=ns;
      if(sc<=1){{sc=1;tx=0;ty=0;}}
      apply();
    }}
    function reset(){{
      sc=1;tx=0;ty=0;
      img.style.transition='transform .2s ease';
      apply();
      setTimeout(()=>img.style.transition='',200);
    }}
    function showControls(){{
      document.body.classList.add('is-controls-visible');
      clearTimeout(hideTimer);
      hideTimer=setTimeout(()=>document.body.classList.remove('is-controls-visible'),1800);
    }}
    function keepControls(){{
      document.body.classList.add('is-controls-visible');
      clearTimeout(hideTimer);
    }}
    document.addEventListener('mousemove',()=>{{if(!dr)showControls();}});
    slider.addEventListener('mousedown',keepControls);
    slider.addEventListener('touchstart',keepControls,{{passive:true}});
    slider.addEventListener('mouseup',showControls);
    slider.addEventListener('touchend',showControls,{{passive:true}});
    slider.addEventListener('input',()=>{{
      const ns=Number(slider.value)/100;
      zoomAt(innerWidth/2,innerHeight/2,ns/sc);
    }});
    stage.addEventListener('wheel',e=>{{e.preventDefault();zoomAt(e.clientX,e.clientY,e.deltaY<0?1.15:1/1.15);}},{{passive:false}});
    stage.addEventListener('mousedown',e=>{{if(e.button||sc<=1)return;dr=true;dx=e.clientX-tx;dy=e.clientY-ty;stage.classList.add('dragging');}});
    window.addEventListener('mousemove',e=>{{if(!dr)return;tx=e.clientX-dx;ty=e.clientY-dy;apply();}});
    window.addEventListener('mouseup',()=>{{dr=false;stage.classList.remove('dragging');}});
    stage.addEventListener('dblclick',reset);
    let tp={{}},pd=0;
    stage.addEventListener('touchstart',e=>{{
      for(const t of e.changedTouches)tp[t.identifier]=t;
      const v=Object.values(tp);
      if(v.length===1){{dx=v[0].clientX-tx;dy=v[0].clientY-ty;}}
      else if(v.length===2)pd=Math.hypot(v[0].clientX-v[1].clientX,v[0].clientY-v[1].clientY);
    }},{{passive:true}});
    stage.addEventListener('touchmove',e=>{{
      e.preventDefault();
      for(const t of e.changedTouches)tp[t.identifier]=t;
      const v=Object.values(tp);
      if(v.length===1&&sc>1){{tx=v[0].clientX-dx;ty=v[0].clientY-dy;apply();}}
      else if(v.length===2){{const nd=Math.hypot(v[0].clientX-v[1].clientX,v[0].clientY-v[1].clientY);zoomAt((v[0].clientX+v[1].clientX)/2,(v[0].clientY+v[1].clientY)/2,nd/pd);pd=nd;}}
    }},{{passive:false}});
    stage.addEventListener('touchend',e=>{{
      for(const t of e.changedTouches)delete tp[t.identifier];
      const v=Object.values(tp);
      if(v.length===1){{dx=v[0].clientX-tx;dy=v[0].clientY-ty;}}
    }},{{passive:true}});
  </script>
</body>
</html>"""
    return HTMLResponse(content=page)


def _table_exists(conn: pymysql.Connection, table_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE %s", (table_name,))
        return cur.fetchone() is not None


def _content_key_expr(image_alias: str = "i", mapping_alias: str = "gci") -> str:
    return f"CASE WHEN {mapping_alias}.content_id IS NULL THEN CONCAT('i-', {image_alias}.id) ELSE CONCAT('c-', {mapping_alias}.content_id) END"


def _content_sort_clause(sort_key: str) -> str:
    key = (sort_key or "latest").lower()
    if key == "popular":
        return "ORDER BY like_count_sum DESC, view_count_sum DESC, content_shot_at DESC, content_created_at DESC, content_key DESC"
    if key in ("shot_oldest", "oldest"):
        return "ORDER BY content_shot_at ASC, content_created_at ASC, content_key ASC"
    if key == "posted_newest":
        return "ORDER BY content_created_at DESC, content_shot_at DESC, content_key DESC"
    if key == "posted_oldest":
        return "ORDER BY content_created_at ASC, content_shot_at ASC, content_key ASC"
    # shot_newest, latest (alias), default
    return "ORDER BY content_shot_at DESC, content_created_at DESC, content_key DESC"


def _normalize_content_detail_item(item: dict, content_title: str | None, content_alt: str | None) -> dict:
    return {
        "image_id": int(item["image_id"]),
        "id": int(item["image_id"]),
        "title": content_title or item.get("title") or "タイトル未設定",
        "alt": content_alt if content_alt is not None else (item.get("alt") or ""),
        "shot_at": item.get("shot_at"),
        "created_at": item.get("created_at"),
        "posted_at": item.get("created_at") or item.get("shot_at"),
        "preview_path": item.get("preview_path"),
        "thumb_path_480": item.get("thumb_path_480"),
        "thumb_path_960": item.get("thumb_path_960"),
        "width": item.get("width"),
        "height": item.get("height"),
        "format": item.get("format"),
        "like_count": int(item.get("like_count") or 0),
        "viewer_liked": bool(item.get("viewer_liked")),
        "view_count": int(item.get("view_count") or 0),
        "sort_order": item.get("sort_order"),
        "is_thumbnail": bool(item.get("is_thumbnail")),
        "uploader_user_key": item.get("uploader_user_key"),
        "uploader_display_name": item.get("uploader_display_name"),
        "uploader_avatar_url": item.get("uploader_avatar_url"),
        "owner_user_id": item.get("owner_user_id"),
        "is_public": item.get("is_public"),
        "moderation_status": item.get("moderation_status"),
        "access_token": item.get("access_token") or None,
    }


@app.get("/api/contents")
def list_contents(
    req: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(90, ge=1),
    sort: str = Query("latest"),
    q: str | None = None,
    owner_user_key: str | None = None,
    tags_any: str | None = None,
    tags_all: str | None = None,
    colors_any: str | None = None,
    colors_all: str | None = None,
    shot_date_from: str | None = None,
    shot_date_to: str | None = None,
    posted_date_from: str | None = None,
    posted_date_to: str | None = None,
    shortcut: str | None = None,
    random_seed: str | None = None,
):
    per_page = clamp_per_page(per_page)
    offset = (page - 1) * per_page

    conn = db_conn(CONF)
    try:
        if not (_table_exists(conn, "gallery_contents") and _table_exists(conn, "gallery_content_images")):
            payload = list_images(
                req=req,
                page=page,
                per_page=per_page,
                sort=sort,
                q=q,
                owner_user_key=owner_user_key,
                tags_any=tags_any,
                tags_all=tags_all,
                colors_any=colors_any,
                colors_all=colors_all,
                shot_date_from=shot_date_from,
                shot_date_to=shot_date_to,
                posted_date_from=posted_date_from,
                posted_date_to=posted_date_to,
                shortcut=shortcut,
                random_seed=random_seed,
            )
            items = []
            for item in payload.get("items", []):
                items.append({
                    "content_id": f"i-{int(item['id'])}",
                    "thumbnail_image_id": int(item["id"]),
                    "image_count": 1,
                    **item,
                })
            payload["items"] = items
            return payload

        current_user = _get_current_user(req)
        viewer_user_id = int(current_user["id"]) if current_user else None
        _ensure_admin_content_states_table(conn)
        visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")
        tags_any_list = parse_csv_strs(tags_any)
        tags_all_list = parse_csv_strs(tags_all)
        colors_any_list = parse_csv_ints(colors_any)
        colors_all_list = parse_csv_ints(colors_all)

        tag_sql, tag_params = build_tag_filter_sql(GALLERY, tags_any_list, tags_all_list)
        color_sql, color_params = build_color_filter_sql(colors_any_list, colors_all_list)
        date_sql, date_params = build_gallery_date_filters(
            shot_date_from,
            shot_date_to,
            posted_date_from,
            posted_date_to,
        )
        text_sql, text_params = build_text_search_sql(GALLERY, q)
        shortcut_sql, shortcut_params = build_shortcut_filter_sql(shortcut, _now_local_naive(CONF), viewer_user_id=viewer_user_id)
        owner_key_str = (owner_user_key or "").strip()
        if owner_key_str and re.match(r'^[a-zA-Z0-9_-]{1,20}$', owner_key_str) and _HAS_IMAGES_OWNER_USER_ID:
            owner_sql = " AND EXISTS (SELECT 1 FROM users uu WHERE uu.id=i.owner_user_id AND uu.user_key=%s AND uu.status='active')"
            owner_params: list = [owner_key_str]
        else:
            owner_sql, owner_params = "", []
        where_extra_sql = f"{tag_sql}{color_sql}{date_sql}{text_sql}{shortcut_sql}{owner_sql}"
        where_extra_params = [*tag_params, *color_params, *date_params, *text_params, *shortcut_params, *owner_params]
        join_stats = "LEFT JOIN image_stats st ON st.image_id=i.id"
        join_content = "LEFT JOIN gallery_content_images gci ON gci.image_id=i.id LEFT JOIN gallery_contents gc ON gc.id=gci.content_id AND gc.gallery=i.gallery"
        content_key_expr = _content_key_expr("i", "gci")
        if _HAS_IMAGES_OWNER_USER_ID:
            content_user_select = """,
    i.owner_user_id AS owner_user_id,
    u.user_key AS uploader_user_key,
    u.display_name AS uploader_display_name,
    CASE WHEN u.avatar_path IS NOT NULL THEN CONCAT('/api/auth/avatar/', u.id) ELSE NULL END AS uploader_avatar_url"""
            content_user_join = "LEFT JOIN users u ON u.id = i.owner_user_id AND u.status = 'active'"
        else:
            content_user_select = ""
            content_user_join = ""
        sort_key = (sort or "latest").lower()

        count_sql = f"""
SELECT COUNT(*) AS c
FROM (
  SELECT {content_key_expr} AS content_key
  FROM images i
  JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
  LEFT JOIN admin_content_states acs ON acs.image_id=i.id
  {join_stats}
  {join_content}
  WHERE i.gallery=%s AND {visibility_sql}
  {where_extra_sql}
  GROUP BY content_key
) counted
"""

        order_seed = str(random_seed or "").strip() or _now_local_naive(CONF).strftime("%Y%m%d")
        order_clause = _content_sort_clause(sort_key)
        page_params: list = [GALLERY, GALLERY, *visibility_params, *where_extra_params]
        if sort_key == "random":
            order_clause = "ORDER BY SHA2(CONCAT(%s, ':', content_key), 256)"
            page_params.append(order_seed)

        page_sql = f"""
SELECT
  {content_key_expr} AS content_key,
  MAX(COALESCE(gc.shot_at, i.shot_at, i.created_at)) AS content_shot_at,
  MAX(COALESCE(gc.created_at, i.created_at, i.shot_at)) AS content_created_at,
  SUM(COALESCE(st.view_count, 0)) AS view_count_sum,
  SUM(COALESCE(i.like_count, 0)) AS like_count_sum,
  MAX(COALESCE(NULLIF(gc.title, ''), i.title, i.alt, CONCAT('image-', i.id))) AS content_title,
  MAX(COALESCE(gc.alt, i.alt, '')) AS content_alt
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
{join_stats}
{join_content}
WHERE i.gallery=%s AND {visibility_sql}
{where_extra_sql}
GROUP BY content_key
{order_clause}
LIMIT %s OFFSET %s
"""
        page_params.extend([per_page, offset])

        with conn.cursor() as cur:
            cur.execute(count_sql, [GALLERY, GALLERY, *visibility_params, *where_extra_params])
            total = int((cur.fetchone() or {}).get("c") or 0)
            cur.execute(page_sql, page_params)
            rows = cur.fetchall()

        content_keys = [str(row["content_key"]) for row in rows]
        thumbs_by_key: dict[str, dict] = {}

        if content_keys:
            key_placeholders = ",".join(["%s"] * len(content_keys))
            at_col = "i.access_token" if _HAS_IMAGES_ACCESS_TOKEN else "NULL"
            thumb_viewer_sql = "0 AS viewer_liked"
            thumb_params: list = []
            if viewer_user_id is not None:
                thumb_viewer_sql = "EXISTS(SELECT 1 FROM image_likes il WHERE il.image_id=i.id AND il.user_id=%s) AS viewer_liked"
                thumb_params.append(viewer_user_id)

            thumb_sql = f"""
SELECT *
FROM (
  SELECT
    {content_key_expr} AS content_key,
    i.id AS image_id,
    i.shot_at,
    i.created_at,
    i.title,
    i.alt,
    i.width,
    i.height,
    i.format,
    i.thumb_path_480,
    i.thumb_path_960,
    i.preview_path,
    i.like_count,
    COALESCE(i.is_public, 1) AS is_public,
    COALESCE(i.focal_x, 50) AS focal_x,
    COALESCE(i.focal_y, 50) AS focal_y,
    {at_col} AS access_token,
    {thumb_viewer_sql}{content_user_select},
    COUNT(*) OVER (PARTITION BY {content_key_expr}) AS image_count,
    ROW_NUMBER() OVER (
      PARTITION BY {content_key_expr}
      ORDER BY
        CASE WHEN gc.thumbnail_image_id=i.id THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(gci.is_thumbnail, 0)=1 THEN 0 ELSE 1 END,
        CASE WHEN gci.sort_order IS NULL THEN 1 ELSE 0 END,
        COALESCE(gci.sort_order, 2147483647),
        i.id ASC
    ) AS rn
  FROM images i
  JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
  LEFT JOIN admin_content_states acs ON acs.image_id=i.id
  LEFT JOIN gallery_content_images gci ON gci.image_id=i.id
  LEFT JOIN gallery_contents gc ON gc.id=gci.content_id AND gc.gallery=i.gallery
  {content_user_join}
  WHERE i.gallery=%s AND {visibility_sql} AND {content_key_expr} IN ({key_placeholders})
) picked
WHERE picked.rn=1
"""
            thumb_exec = [*thumb_params, GALLERY, GALLERY, *visibility_params, *content_keys]
            with conn.cursor() as cur:
                cur.execute(thumb_sql, thumb_exec)
                for row in cur.fetchall():
                    thumbs_by_key[str(row["content_key"])] = row

        supporter_profiles_by_user_id: dict[int, dict] = {}
        if _HAS_IMAGES_OWNER_USER_ID:
            owner_user_ids = sorted({
                int(thumb["owner_user_id"])
                for thumb in thumbs_by_key.values()
                if thumb.get("owner_user_id") is not None
            })
            for owner_user_id in owner_user_ids:
                supporter_profiles_by_user_id[owner_user_id] = get_public_supporter_profile(conn, owner_user_id, conf=CONF)

        items: list[dict] = []
        for row in rows:
            content_key = str(row["content_key"])
            thumb = thumbs_by_key.get(content_key)
            if not thumb:
                continue
            owner_user_id = int(thumb["owner_user_id"]) if thumb.get("owner_user_id") is not None else None
            supporter_profile = supporter_profiles_by_user_id.get(owner_user_id, {}) if owner_user_id is not None else {}
            items.append({
                "content_id": content_key,
                "thumbnail_image_id": int(thumb["image_id"]),
                "id": int(thumb["image_id"]),
                "image_count": int(thumb.get("image_count") or 1),
                "title": row.get("content_title") or thumb.get("title") or thumb.get("alt") or f"image-{thumb['image_id']}",
                "alt": row.get("content_alt") if row.get("content_alt") is not None else (thumb.get("alt") or ""),
                "shot_at": row.get("content_shot_at") or thumb.get("shot_at"),
                "created_at": row.get("content_created_at") or thumb.get("created_at"),
                "width": thumb.get("width"),
                "height": thumb.get("height"),
                "format": thumb.get("format"),
                "thumb_path_480": thumb.get("thumb_path_480"),
                "thumb_path_960": thumb.get("thumb_path_960"),
                "preview_path": thumb.get("preview_path"),
                "like_count": int(thumb.get("like_count") or 0),
                "viewer_liked": bool(thumb.get("viewer_liked")),
                "view_count": int(row.get("view_count_sum") or 0),
                "visibility": "public" if bool(thumb.get("is_public")) else "private",
                "focal_x": float(thumb.get("focal_x") or 50),
                "focal_y": float(thumb.get("focal_y") or 50),
                "owner_user_id": owner_user_id,
                "uploader_user_key": thumb.get("uploader_user_key"),
                "uploader_display_name": thumb.get("uploader_display_name"),
                "uploader_avatar_url": thumb.get("uploader_avatar_url"),
                "supporter_profile": supporter_profile,
                "user": {
                    "user_key": thumb.get("uploader_user_key"),
                    "display_name": thumb.get("uploader_display_name"),
                    "avatar_url": thumb.get("uploader_avatar_url"),
                    "supporter_profile": supporter_profile,
                },
            })

        pages = (total + per_page - 1) // per_page if total else 0
        return {"page": page, "per_page": per_page, "pages": pages, "total": total, "items": items}
    finally:
        conn.close()


@app.get("/api/content-archives")
def list_content_archives(
    req: Request,
    kind: str = Query("shot"),
    q: str | None = None,
    tags_any: str | None = None,
    tags_all: str | None = None,
    colors_any: str | None = None,
    colors_all: str | None = None,
    shot_date_from: str | None = None,
    shot_date_to: str | None = None,
    posted_date_from: str | None = None,
    posted_date_to: str | None = None,
    shortcut: str | None = None,
):
    archive_kind = str(kind or "shot").strip().lower()
    if archive_kind not in ("shot", "posted"):
        raise HTTPException(status_code=400, detail="invalid kind")

    conn = db_conn(CONF)
    try:
        if not (_table_exists(conn, "gallery_contents") and _table_exists(conn, "gallery_content_images")):
            return list_image_archives(
                req=req,
                kind=archive_kind,
                q=q,
                tags_any=tags_any,
                tags_all=tags_all,
                colors_any=colors_any,
                colors_all=colors_all,
                shot_date_from=shot_date_from,
                shot_date_to=shot_date_to,
                posted_date_from=posted_date_from,
                posted_date_to=posted_date_to,
                shortcut=shortcut,
            )

        current_user = _get_current_user(req)
        viewer_user_id = int(current_user["id"]) if current_user else None
        _ensure_admin_content_states_table(conn)
        visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")
        tags_any_list = parse_csv_strs(tags_any)
        tags_all_list = parse_csv_strs(tags_all)
        colors_any_list = parse_csv_ints(colors_any)
        colors_all_list = parse_csv_ints(colors_all)

        tag_sql, tag_params = build_tag_filter_sql(GALLERY, tags_any_list, tags_all_list)
        color_sql, color_params = build_color_filter_sql(colors_any_list, colors_all_list)
        text_sql, text_params = build_text_search_sql(GALLERY, q)
        shortcut_sql, shortcut_params = build_shortcut_filter_sql(shortcut, _now_local_naive(CONF), viewer_user_id=viewer_user_id)

        shot_from = shot_date_from if archive_kind != "shot" else None
        shot_to = shot_date_to if archive_kind != "shot" else None
        posted_from = posted_date_from if archive_kind != "posted" else None
        posted_to = posted_date_to if archive_kind != "posted" else None
        date_sql, date_params = build_gallery_date_filters(shot_from, shot_to, posted_from, posted_to)

        where_extra_sql = f"{tag_sql}{color_sql}{date_sql}{text_sql}{shortcut_sql}"
        where_extra_params = [*tag_params, *color_params, *date_params, *text_params, *shortcut_params]
        join_content = "LEFT JOIN gallery_content_images gci ON gci.image_id=i.id LEFT JOIN gallery_contents gc ON gc.id=gci.content_id AND gc.gallery=i.gallery"
        content_key_expr = _content_key_expr("i", "gci")
        target_expr = "MAX(COALESCE(gc.created_at, i.created_at, i.shot_at))" if archive_kind == "posted" else "MAX(COALESCE(gc.shot_at, i.shot_at, i.created_at))"

        sql = f"""
SELECT archive_year, archive_month, COUNT(*) AS c
FROM (
  SELECT
    {content_key_expr} AS content_key,
    YEAR({target_expr}) AS archive_year,
    MONTH({target_expr}) AS archive_month
  FROM images i
  JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
  LEFT JOIN admin_content_states acs ON acs.image_id=i.id
  {join_content}
  WHERE i.gallery=%s AND {visibility_sql}
  {where_extra_sql}
  GROUP BY content_key
) content_archives
WHERE archive_year IS NOT NULL AND archive_month IS NOT NULL
GROUP BY archive_year, archive_month
ORDER BY archive_year DESC, archive_month DESC
"""

        with conn.cursor() as cur:
            cur.execute(sql, [GALLERY, GALLERY, *visibility_params, *where_extra_params])
            rows = cur.fetchall()

        grouped: list[dict] = []
        current_year = None
        current_months: list[dict] = []
        for row in rows:
            year = int(row["archive_year"])
            month = int(row["archive_month"])
            count = int(row["c"])
            if current_year != year:
                if current_year is not None:
                    grouped.append({"year": current_year, "months": current_months})
                current_year = year
                current_months = []
            current_months.append({"month": month, "count": count})
        if current_year is not None:
            grouped.append({"year": current_year, "months": current_months})
        return {"kind": archive_kind, "items": grouped}
    finally:
        conn.close()


@app.get("/api/contents/{content_key}")
def get_content(content_key: str, req: Request):
    key = str(content_key or "").strip().lower()
    if key.startswith("i-"):
        image_id = int(key[2:])
        detail = get_image(image_id=image_id, req=req)
        detail["content_id"] = key
        detail["image_count"] = 1
        detail["thumbnail_image_id"] = image_id
        detail["images"] = [
            {
                "image_id": image_id,
                "id": image_id,
                "title": detail.get("title") or "タイトル未設定",
                "alt": detail.get("alt") or "",
                "shot_at": detail.get("shot_at"),
                "created_at": detail.get("created_at") or detail.get("posted_at") or detail.get("shot_at"),
                "posted_at": detail.get("created_at") or detail.get("posted_at") or detail.get("shot_at"),
                "preview_path": detail.get("preview_path"),
                "thumb_path_480": detail.get("thumb_path_480"),
                "thumb_path_960": detail.get("thumb_path_960"),
                "width": detail.get("width"),
                "height": detail.get("height"),
                "format": detail.get("format"),
                "like_count": int(detail.get("like_count") or 0),
                "viewer_liked": bool(detail.get("viewer_liked")),
                "view_count": int(detail.get("view_count") or 0),
                "sort_order": 1,
                "is_thumbnail": True,
                "access_token": detail.get("access_token"),
            }
        ]
        return detail

    if not key.startswith("c-"):
        raise HTTPException(status_code=400, detail="invalid content key")

    try:
        content_id = int(key[2:])
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid content key")

    current_user = _get_current_user(req)
    viewer_user_id = int(current_user["id"]) if current_user else None
    viewer_liked_sql = "0 AS viewer_liked"
    viewer_liked_params: list = []
    if viewer_user_id is not None:
        viewer_liked_sql = "EXISTS(SELECT 1 FROM image_likes il WHERE il.image_id=i.id AND il.user_id=%s) AS viewer_liked"
        viewer_liked_params.append(viewer_user_id)

    conn = db_conn(CONF)
    try:
        if not (_table_exists(conn, "gallery_contents") and _table_exists(conn, "gallery_content_images")):
            raise HTTPException(status_code=404, detail="not found")
        _ensure_admin_content_states_table(conn)
        visibility_sql, visibility_params = _viewer_visible_image_sql(viewer_user_id, "i", "acs")

        with conn.cursor() as cur:
            cur.execute(
                """
SELECT id, gallery, title, alt, shot_at, created_at, updated_at, thumbnail_image_id, image_count
FROM gallery_contents
WHERE gallery=%s AND id=%s
LIMIT 1
""",
                (GALLERY, content_id),
            )
            content_row = cur.fetchone()
            if not content_row:
                raise HTTPException(status_code=404, detail="not found")

            content_detail_at_col = "i.access_token" if _HAS_IMAGES_ACCESS_TOKEN else "NULL"
            if _HAS_IMAGES_OWNER_USER_ID:
                content_detail_user_select = """,
  i.owner_user_id AS owner_user_id,
  u.user_key AS uploader_user_key,
  u.display_name AS uploader_display_name,
  CASE WHEN u.avatar_path IS NOT NULL THEN CONCAT('/api/auth/avatar/', u.id) ELSE NULL END AS uploader_avatar_url"""
                content_detail_user_join = "LEFT JOIN users u ON u.id = i.owner_user_id AND u.status = 'active'"
            else:
                content_detail_user_select = ", NULL AS owner_user_id"
                content_detail_user_join = ""

            cur.execute(
                f"""
SELECT
  i.id AS image_id,
  i.title,
  i.alt,
  i.shot_at,
  i.created_at,
  i.width,
  i.height,
  i.format,
  i.thumb_path_480,
  i.thumb_path_960,
  i.preview_path,
  i.like_count,
  COALESCE(i.is_public, 1) AS is_public,
  COALESCE(acs.moderation_status, 'normal') AS moderation_status,
  COALESCE(st.view_count,0) AS view_count,
  {viewer_liked_sql}{content_detail_user_select},
  {content_detail_at_col} AS access_token,
  gci.sort_order,
  COALESCE(gci.is_thumbnail, 0) AS is_thumbnail
FROM gallery_content_images gci
JOIN images i ON i.id=gci.image_id AND i.gallery=%s
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
LEFT JOIN image_stats st ON st.image_id=i.id
{content_detail_user_join}
WHERE gci.content_id=%s AND {visibility_sql}
ORDER BY
  CASE WHEN %s IS NOT NULL AND %s = i.id THEN 0 ELSE 1 END,
  CASE WHEN COALESCE(gci.is_thumbnail, 0)=1 THEN 0 ELSE 1 END,
  CASE WHEN gci.sort_order IS NULL THEN 1 ELSE 0 END,
  COALESCE(gci.sort_order, 2147483647),
  i.id ASC
""",
                [*viewer_liked_params, GALLERY, GALLERY, content_id, *visibility_params, content_row.get("thumbnail_image_id"), content_row.get("thumbnail_image_id")],
            )
            image_rows = cur.fetchall()

        if not image_rows:
            raise HTTPException(status_code=404, detail="not found")

        images = [_normalize_content_detail_item(row, content_row.get("title"), content_row.get("alt")) for row in image_rows]
        thumbnail_image_id = int(images[0]["image_id"])
        primary = images[0]
        visibility = "public" if bool(primary.get("is_public", 1)) else "private"
        status = str(primary.get("moderation_status") or "normal")
        owner_user_id = int(primary.get("owner_user_id")) if primary.get("owner_user_id") is not None else None
        supporter_profile = get_public_supporter_profile(conn, owner_user_id, conf=CONF) if owner_user_id is not None else {}
        viewer_permissions, owner_meta = _serialize_content_owner_controls(current_user, owner_user_id, visibility, status)
        return {
            "content_id": key,
            "id": content_id,
            "title": content_row.get("title") or primary.get("title") or "タイトル未設定",
            "alt": content_row.get("alt") if content_row.get("alt") is not None else (primary.get("alt") or ""),
            "shot_at": content_row.get("shot_at") or primary.get("shot_at"),
            "created_at": content_row.get("created_at") or primary.get("created_at"),
            "posted_at": content_row.get("created_at") or primary.get("created_at"),
            "thumbnail_image_id": thumbnail_image_id,
            "image_count": len(images),
            "like_count": int(primary.get("like_count") or 0),
            "viewer_liked": bool(primary.get("viewer_liked")),
            "visibility": visibility,
            "viewer_permissions": viewer_permissions,
            "owner_meta": owner_meta,
            "uploader_user_key": primary.get("uploader_user_key"),
            "uploader_display_name": primary.get("uploader_display_name"),
            "uploader_avatar_url": primary.get("uploader_avatar_url"),
            "user": {
                "user_key": primary.get("uploader_user_key"),
                "display_name": primary.get("uploader_display_name"),
                "avatar_url": primary.get("uploader_avatar_url"),
                "supporter_profile": supporter_profile,
            },
            "images": images,
        }
    finally:
        conn.close()


@app.patch("/api/contents/{content_key}/visibility")
def update_owned_content_visibility(
    content_key: str,
    req: Request,
    payload: dict = Body(...),
):
    current_user = _get_current_user(req)
    if not current_user:
        raise HTTPException(status_code=401, detail="login required")
    if "is_public" not in (payload or {}):
        raise HTTPException(status_code=400, detail="is_public required")

    conn = db_conn(CONF)
    try:
        result = _apply_owned_content_visibility(
            conn,
            content_key=content_key,
            actor_user_id=int(current_user["id"]),
            is_public=bool(payload.get("is_public")),
        )
        conn.commit()
        return {"ok": True, "data": result}
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


@app.post("/api/contents/{content_key}/delete")
def delete_owned_content(content_key: str, req: Request):
    current_user = _get_current_user(req)
    if not current_user:
        raise HTTPException(status_code=401, detail="login required")

    conn = db_conn(CONF)
    try:
        result = _apply_owned_content_delete(
            conn,
            content_key=content_key,
            actor_user_id=int(current_user["id"]),
        )
        conn.commit()
        return {"ok": True, "data": result}
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


_CONTACT_CATEGORIES = {"bug", "feature", "account", "other"}

@app.post("/api/contact")
def submit_contact(
    payload: dict = Body(...),
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    session_result = get_current_user_by_session_token(gallery_session)
    user = (session_result or {}).get("user") if session_result else None
    if not user:
        raise HTTPException(status_code=401, detail="ログインが必要です。")

    category = str(payload.get("category") or "").strip()
    message = str(payload.get("message") or "").strip()

    if category not in _CONTACT_CATEGORIES:
        raise HTTPException(status_code=400, detail="無効なカテゴリです。")
    if not message:
        raise HTTPException(status_code=400, detail="メッセージを入力してください。")
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail="メッセージは2000文字以内で入力してください。")

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO contact_inquiries (user_id, category, message, status) VALUES (%s, %s, %s, 'open')",
                (int(user["id"]), category, message),
            )
        conn.commit()
        return {"ok": True, "message": "お問い合わせを送信しました。"}
    finally:
        conn.close()
