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

logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, Request, Response, Cookie
from fastapi.responses import FileResponse
import pymysql
from pymysql.err import IntegrityError
from PIL import Image, UnidentifiedImageError

from db import load_conf, db_conn
from auth_router import router as auth_router
from admin_router import router as admin_router
from auth_security import DEFAULT_COOKIE_NAME
from auth_service import get_current_user_by_session_token
from galleryctl.colors import extract_top_colors, load_palette_from_conf, load_settings_from_conf
from badge_defs import BADGE_CATALOG, POST_COUNT_BADGES, serialize_badge


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
            result.append(serialize_badge(key, granted_at=None, granted_by=row.get("granted_by")))
    return result


def _detect_table_exists(conn, table_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE %s", (table_name,))
        return cur.fetchone() is not None


def _parse_display_badges(raw) -> list[str]:
    import json as _json
    if isinstance(raw, list):
        return [str(k) for k in raw if k in BADGE_CATALOG][:3]
    if isinstance(raw, str):
        try:
            parsed = _json.loads(raw)
            if isinstance(parsed, list):
                return [str(k) for k in parsed if k in BADGE_CATALOG][:3]
        except Exception:
            pass
    return []


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
            display_badge_keys = _parse_display_badges(user.get("display_badges"))
            badges = _load_user_display_badges(conn, user["id"], display_badge_keys)

            return {
                "user": {
                    "user_key": user["user_key"],
                    "display_name": user["display_name"],
                    "bio": user.get("bio") or "",
                    "links": links,
                    "avatar_url": avatar_url,
                    "badges": badges,
                }
            }
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
            unknown = [k for k in badge_keys if k not in BADGE_CATALOG]
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
        pool = [serialize_badge(r["badge_key"], granted_at=None, granted_by=r.get("granted_by")) for r in rows]

        with conn.cursor() as cur:
            cur.execute("SELECT display_badges FROM users WHERE id=%s LIMIT 1", (user["id"],))
            row = cur.fetchone()
        display_badges = _parse_display_badges(row.get("display_badges") if row else None)

        from badge_defs import list_catalog as _list_catalog
        return {"pool": pool, "display_badges": display_badges, "catalog": _list_catalog()}
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
            cur.execute(
                "SELECT u.user_key, u.display_name "
                "FROM users u "
                "WHERE u.status='active' "
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
    if _HAS_IMAGES_OWNER_USER_ID:
        user_select = """,
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
        order_sql = "ORDER BY COALESCE(st.view_count,0) DESC, i.shot_at DESC"
    elif sort_key == "oldest":
        order_sql = "ORDER BY i.shot_at ASC"
    elif sort_key == "random":
        seed = str(random_seed or "").strip() or _now_local_naive(CONF).strftime("%Y%m%d")
        order_sql = "ORDER BY SHA2(CONCAT(%s, ':', i.id), 256)"
        order_params.append(seed)
    else:
        order_sql = "ORDER BY i.shot_at DESC"

    sql_count = f"""
SELECT COUNT(*)
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
{join_stats}
WHERE i.gallery=%s AND i.is_public=1
{where_extra_sql}
"""

    sql_list = f"""
SELECT
  i.id, i.shot_at, i.created_at, i.title, i.alt, i.width, i.height, i.format,
  i.thumb_path_480, i.thumb_path_960, i.preview_path,
  COALESCE(i.focal_x, 50) AS focal_x, COALESCE(i.focal_y, 50) AS focal_y,
  COALESCE(st.view_count,0) AS view_count,
  i.like_count,
  {viewer_liked_sql}{user_select}
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
{join_stats}
{user_join}
WHERE i.gallery=%s AND i.is_public=1
{where_extra_sql}
{order_sql}
LIMIT %s OFFSET %s
"""

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(sql_count, [GALLERY, GALLERY, *where_extra_params])
            total = int(cur.fetchone()["COUNT(*)"])

            cur.execute(sql_list, [*viewer_liked_params, GALLERY, GALLERY, *where_extra_params, *order_params, per_page, offset])
            items = cur.fetchall()

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

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            if _HAS_IMAGES_OWNER_USER_ID:
                detail_user_select = """,
  u.user_key AS uploader_user_key,
  u.display_name AS uploader_display_name,
  CASE WHEN u.avatar_path IS NOT NULL THEN CONCAT('/api/auth/avatar/', u.id) ELSE NULL END AS uploader_avatar_url"""
                detail_user_join = "LEFT JOIN users u ON u.id = i.owner_user_id AND u.status = 'active'"
            else:
                detail_user_select = ""
                detail_user_join = ""
            cur.execute(
                f"""
SELECT
  i.id, i.shot_at, i.title, i.alt, i.width, i.height, i.format,
  i.thumb_path_480, i.thumb_path_960, i.preview_path,
  COALESCE(i.focal_x, 50) AS focal_x, COALESCE(i.focal_y, 50) AS focal_y,
  COALESCE(st.view_count,0) AS view_count,
  i.like_count AS like_count,
  COALESCE(st.x_like_count,0) AS x_like_count,
  {viewer_liked_sql}{detail_user_select}
FROM images i
LEFT JOIN image_stats st ON st.image_id=i.id
{detail_user_join}
WHERE i.gallery=%s AND i.id=%s AND i.is_public=1
""",
                [*viewer_liked_params, GALLERY, image_id],
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

    sql = f"""
SELECT
  YEAR({target_column}) AS y,
  MONTH({target_column}) AS m,
  COUNT(*) AS c
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
WHERE i.gallery=%s AND i.is_public=1 AND {target_column} IS NOT NULL
{where_extra_sql}
GROUP BY YEAR({target_column}), MONTH({target_column})
ORDER BY YEAR({target_column}) DESC, MONTH({target_column}) DESC
"""

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, [GALLERY, GALLERY, *where_extra_params])
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
    upload_requires_login = _upload_requires_login(CONF)
    u = _get_current_user(req)

    if upload_requires_login:
        if not u:
            raise HTTPException(status_code=401, detail="login required")
        if not u.get("can_upload"):
            raise HTTPException(status_code=403, detail="upload not allowed")

    t = str(title or "").strip()
    if not t:
        raise HTTPException(status_code=400, detail="title required")
    if not files:
        raise HTTPException(status_code=400, detail="files required")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="too many files (max 20)")

    is_pub = str(is_public or "true").strip().lower() in ("1", "true", "yes", "on")
    focal_x_val = max(0.0, min(100.0, float(focal_x if focal_x is not None else 50.0)))
    focal_y_val = max(0.0, min(100.0, float(focal_y if focal_y is not None else 50.0)))
    tag_list = [x for x in parse_csv_strs(tags) if x]

    # フロントから送られた shot_at を解析（datetime-local 形式: "YYYY-MM-DDTHH:MM:SS"）
    shot_at_override: datetime | None = None
    shot_at_str = str(shot_at or "").strip()
    if shot_at_str:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
            try:
                shot_at_override = datetime.strptime(shot_at_str, fmt)
                break
            except ValueError:
                continue

    conn = db_conn(CONF)
    try:
        src_cols = _table_cols(conn, "image_sources")
        img_cols = _table_cols(conn, "images")

        staged = []
        staging_root = SOURCE_ROOT / "uploads" / "_staging"
        ensure_dir(staging_root)
        tmp_dir = Path(tempfile.mkdtemp(prefix="felixxsv_gallery_upload_", dir=str(staging_root)))

        try:
            vr_re = re.compile(r"^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})")

            def parse_shot_at_from_name(name: str) -> datetime:
                base = (name or "").split("/")[-1].split("\\")[-1]
                m = vr_re.match(base)
                if not m:
                    return _now_local_naive(CONF)
                y, mo, d, hh, mm, ss = map(int, m.groups())
                try:
                    return datetime(y, mo, d, hh, mm, ss)
                except Exception:
                    logger.exception("Unhandled error")
                    return _now_local_naive(CONF)

            for idx, uf in enumerate(files):
                name = uf.filename or f"file{idx}"
                # フロントの手動入力を優先。未指定ならファイル名から自動取得
                resolved_shot_at = shot_at_override if shot_at_override is not None else parse_shot_at_from_name(name)

                ext = Path(name).suffix.lower().lstrip(".")
                if ext not in ("png", "jpg", "jpeg", "webp"):
                    ext = "png"

                tmp_path = tmp_dir / f"{idx:03d}_{uuid.uuid4().hex}.{ext}"

                h = hashlib.sha256()
                size = 0
                try:
                    try:
                        uf.file.seek(0)
                    except Exception:
                        pass
                    with tmp_path.open("wb") as f:
                        while True:
                            b = uf.file.read(1024 * 1024)
                            if not b:
                                break
                            f.write(b)
                            h.update(b)
                            size += len(b)
                except Exception as e:
                    raise HTTPException(status_code=500, detail=f"save failed: {type(e).__name__}: {e}")

                sha_hex = h.hexdigest()

                try:
                    with Image.open(tmp_path) as im:
                        w, h2 = im.size
                        fmt = (im.format or ext).upper()
                except (UnidentifiedImageError, OSError):
                    raise HTTPException(status_code=400, detail=f"invalid image: {name}")

                staged.append(
                    {
                        "index": idx,
                        "filename": name,
                        "shot_at": resolved_shot_at,
                        "ext": ext,
                        "tmp_path": tmp_path,
                        "sha_hex": sha_hex,
                        "size_bytes": int(size),
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
                        [GALLERY, *uniq_hashes],
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

            palette = load_palette_from_conf(CONF)
            cset = load_settings_from_conf(CONF)
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

            def render_webp(src: Path, dst: Path, max_w: int):
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

            try:
                for x in staged:
                    shot_at = x["shot_at"]
                    rel_dir = Path("uploads") / shot_at.strftime("%Y/%m/%d")
                    fname = f"VRChat_{shot_at.strftime('%Y-%m-%d_%H-%M-%S')}_{uuid.uuid4().hex[:8]}.{x['ext']}"
                    rel_path = str((rel_dir / fname).as_posix())
                    abs_path = SOURCE_ROOT / rel_path

                    ensure_dir(abs_path.parent)
                    try:
                        x["tmp_path"].replace(abs_path)
                    except OSError:
                        shutil.move(str(x["tmp_path"]), str(abs_path))
                    created_orig_paths.append(abs_path)

                    st = abs_path.stat()
                    mtime_epoch = int(st.st_mtime)

                    img_cols_list = [
                        "gallery",
                        "shot_at",
                        "title",
                        "alt",
                        "width",
                        "height",
                        "format",
                        "thumb_path_480",
                        "thumb_path_960",
                        "preview_path",
                        "content_hash",
                    ]
                    img_vals = [
                        GALLERY,
                        shot_at,
                        t,
                        str(alt or ""),
                        x["width"],
                        x["height"],
                        x["format"],
                        "",
                        "",
                        "",
                        x["sha_hex"],
                    ]

                    if "is_public" in img_cols:
                        img_cols_list.append("is_public")
                        img_vals.append(1 if is_pub else 0)

                    if "focal_x" in img_cols:
                        img_cols_list.append("focal_x")
                        img_vals.append(focal_x_val)

                    if "focal_y" in img_cols:
                        img_cols_list.append("focal_y")
                        img_vals.append(focal_y_val)

                    if "uploader_user_id" in img_cols and u is not None:
                        img_cols_list.append("uploader_user_id")
                        img_vals.append(int(u["id"]))

                    with conn.cursor() as cur:
                        cur.execute(
                            f"INSERT INTO images ({', '.join(img_cols_list)}) VALUES ({', '.join(['%s'] * len(img_cols_list))})",
                            img_vals,
                        )
                        cur.execute("SELECT LAST_INSERT_ID() AS id")
                        image_id = int(cur.fetchone()["id"])

                    dir3 = id_dir3(image_id)
                    t480_rel = f"thumbs/{GALLERY}/{dir3}/{image_id}_w480.webp"
                    t960_rel = f"thumbs/{GALLERY}/{dir3}/{image_id}_w960.webp"
                    prev_rel = f"previews/{GALLERY}/{dir3}/{image_id}_max2560.webp"

                    render_webp(abs_path, STORAGE_ROOT / t480_rel, 480)
                    render_webp(abs_path, STORAGE_ROOT / t960_rel, 960)
                    render_webp(abs_path, STORAGE_ROOT / prev_rel, 2560)

                    created_deriv_paths.extend([STORAGE_ROOT / t480_rel, STORAGE_ROOT / t960_rel, STORAGE_ROOT / prev_rel])

                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE images SET thumb_path_480=%s, thumb_path_960=%s, preview_path=%s WHERE id=%s AND gallery=%s",
                            (t480_rel, t960_rel, prev_rel, image_id, GALLERY),
                        )

                    src_cols_list = [
                        "gallery",
                        "image_id",
                        "source_path",
                        "size_bytes",
                        "mtime_epoch",
                        "content_hash",
                        "is_primary",
                        "is_hidden",
                        "status",
                    ]
                    src_vals = [
                        GALLERY,
                        image_id,
                        rel_path,
                        int(x["size_bytes"]),
                        int(mtime_epoch),
                        x["sha_hex"],
                        1,
                        0,
                        0,
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
                                    (GALLERY, name),
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

                    created_items.append(
                        {
                            "index": int(x["index"]),
                            "filename": x["filename"],
                            "duplicate": False,
                            "image_id": image_id,
                        }
                    )

                content_id = None
                if has_content_tables and created_items:
                    first_item = created_items[0]
                    first_staged = staged[0] if staged else None
                    content_cols_list = ["gallery", "title"]
                    content_vals = [GALLERY, t]

                    if "alt" in content_cols:
                        content_cols_list.append("alt")
                        content_vals.append(str(alt or ""))
                    if "shot_at" in content_cols:
                        content_cols_list.append("shot_at")
                        content_vals.append(first_staged["shot_at"] if first_staged else _now_local_naive(CONF))
                    if "is_public" in content_cols:
                        content_cols_list.append("is_public")
                        content_vals.append(1 if is_pub else 0)
                    if "uploader_user_id" in content_cols and u is not None:
                        content_cols_list.append("uploader_user_id")
                        content_vals.append(int(u["id"]))
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

                    map_cols_base = ["content_id", "image_id"]
                    for idx, item in enumerate(created_items):
                        map_cols_list = list(map_cols_base)
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
                # Auto-grant post count badges if user is logged in
                if u is not None and created_items:
                    _try_grant_post_count_badges(conn, int(u["id"]))
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

                raise HTTPException(status_code=500, detail=f"upload failed: {type(e).__name__}: {e}")

        finally:
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    finally:
        conn.close()


@app.get("/media/original/{image_id}")
def get_original(image_id: int):
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT s.source_path
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1
WHERE i.gallery=%s AND i.id=%s AND i.is_public=1
LIMIT 1
""",
                (GALLERY, GALLERY, image_id),
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


def _table_exists(conn: pymysql.Connection, table_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE %s", (table_name,))
        return cur.fetchone() is not None


def _content_key_expr(image_alias: str = "i", mapping_alias: str = "gci") -> str:
    return f"CASE WHEN {mapping_alias}.content_id IS NULL THEN CONCAT('i-', {image_alias}.id) ELSE CONCAT('c-', {mapping_alias}.content_id) END"


def _content_sort_clause(sort_key: str) -> str:
    key = (sort_key or "latest").lower()
    if key == "popular":
        return "ORDER BY view_count_sum DESC, content_shot_at DESC, content_created_at DESC, content_key DESC"
    if key == "oldest":
        return "ORDER BY content_shot_at ASC, content_created_at ASC, content_key ASC"
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
    }


@app.get("/api/contents")
def list_contents(
    req: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(90, ge=1),
    sort: str = Query("latest"),
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
        where_extra_sql = f"{tag_sql}{color_sql}{date_sql}{text_sql}{shortcut_sql}"
        where_extra_params = [*tag_params, *color_params, *date_params, *text_params, *shortcut_params]
        join_stats = "LEFT JOIN image_stats st ON st.image_id=i.id"
        join_content = "LEFT JOIN gallery_content_images gci ON gci.image_id=i.id LEFT JOIN gallery_contents gc ON gc.id=gci.content_id AND gc.gallery=i.gallery"
        content_key_expr = _content_key_expr("i", "gci")
        if _HAS_IMAGES_OWNER_USER_ID:
            content_user_select = """,
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
  {join_stats}
  {join_content}
  WHERE i.gallery=%s AND i.is_public=1
  {where_extra_sql}
  GROUP BY content_key
) counted
"""

        order_seed = str(random_seed or "").strip() or _now_local_naive(CONF).strftime("%Y%m%d")
        order_clause = _content_sort_clause(sort_key)
        page_params: list = [GALLERY, GALLERY, *where_extra_params]
        if sort_key == "random":
            order_clause = "ORDER BY SHA2(CONCAT(%s, ':', content_key), 256)"
            page_params.append(order_seed)

        page_sql = f"""
SELECT
  {content_key_expr} AS content_key,
  MAX(COALESCE(gc.shot_at, i.shot_at, i.created_at)) AS content_shot_at,
  MAX(COALESCE(gc.created_at, i.created_at, i.shot_at)) AS content_created_at,
  SUM(COALESCE(st.view_count, 0)) AS view_count_sum,
  MAX(COALESCE(NULLIF(gc.title, ''), i.title, i.alt, CONCAT('image-', i.id))) AS content_title,
  MAX(COALESCE(gc.alt, i.alt, '')) AS content_alt
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
{join_stats}
{join_content}
WHERE i.gallery=%s AND i.is_public=1
{where_extra_sql}
GROUP BY content_key
{order_clause}
LIMIT %s OFFSET %s
"""
        page_params.extend([per_page, offset])

        with conn.cursor() as cur:
            cur.execute(count_sql, [GALLERY, GALLERY, *where_extra_params])
            total = int((cur.fetchone() or {}).get("c") or 0)
            cur.execute(page_sql, page_params)
            rows = cur.fetchall()

        content_keys = [str(row["content_key"]) for row in rows]
        thumbs_by_key: dict[str, dict] = {}

        if content_keys:
            key_placeholders = ",".join(["%s"] * len(content_keys))
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
    COALESCE(i.focal_x, 50) AS focal_x,
    COALESCE(i.focal_y, 50) AS focal_y,
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
  LEFT JOIN gallery_content_images gci ON gci.image_id=i.id
  LEFT JOIN gallery_contents gc ON gc.id=gci.content_id AND gc.gallery=i.gallery
  {content_user_join}
  WHERE i.gallery=%s AND i.is_public=1 AND {content_key_expr} IN ({key_placeholders})
) picked
WHERE picked.rn=1
"""
            thumb_exec = [*thumb_params, GALLERY, GALLERY, *content_keys]
            with conn.cursor() as cur:
                cur.execute(thumb_sql, thumb_exec)
                for row in cur.fetchall():
                    thumbs_by_key[str(row["content_key"])] = row

        items: list[dict] = []
        for row in rows:
            content_key = str(row["content_key"])
            thumb = thumbs_by_key.get(content_key)
            if not thumb:
                continue
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
                "focal_x": float(thumb.get("focal_x") or 50),
                "focal_y": float(thumb.get("focal_y") or 50),
                "uploader_user_key": thumb.get("uploader_user_key"),
                "uploader_display_name": thumb.get("uploader_display_name"),
                "uploader_avatar_url": thumb.get("uploader_avatar_url"),
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
  {join_content}
  WHERE i.gallery=%s AND i.is_public=1
  {where_extra_sql}
  GROUP BY content_key
) content_archives
WHERE archive_year IS NOT NULL AND archive_month IS NOT NULL
GROUP BY archive_year, archive_month
ORDER BY archive_year DESC, archive_month DESC
"""

        with conn.cursor() as cur:
            cur.execute(sql, [GALLERY, GALLERY, *where_extra_params])
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

            if _HAS_IMAGES_OWNER_USER_ID:
                content_detail_user_select = """,
  u.user_key AS uploader_user_key,
  u.display_name AS uploader_display_name,
  CASE WHEN u.avatar_path IS NOT NULL THEN CONCAT('/api/auth/avatar/', u.id) ELSE NULL END AS uploader_avatar_url"""
                content_detail_user_join = "LEFT JOIN users u ON u.id = i.owner_user_id AND u.status = 'active'"
            else:
                content_detail_user_select = ""
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
  COALESCE(st.view_count,0) AS view_count,
  {viewer_liked_sql}{content_detail_user_select},
  gci.sort_order,
  COALESCE(gci.is_thumbnail, 0) AS is_thumbnail
FROM gallery_content_images gci
JOIN images i ON i.id=gci.image_id AND i.gallery=%s AND i.is_public=1
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
LEFT JOIN image_stats st ON st.image_id=i.id
{content_detail_user_join}
WHERE gci.content_id=%s
ORDER BY
  CASE WHEN %s IS NOT NULL AND %s = i.id THEN 0 ELSE 1 END,
  CASE WHEN COALESCE(gci.is_thumbnail, 0)=1 THEN 0 ELSE 1 END,
  CASE WHEN gci.sort_order IS NULL THEN 1 ELSE 0 END,
  COALESCE(gci.sort_order, 2147483647),
  i.id ASC
""",
                [*viewer_liked_params, GALLERY, GALLERY, content_id, content_row.get("thumbnail_image_id"), content_row.get("thumbnail_image_id")],
            )
            image_rows = cur.fetchall()

        if not image_rows:
            raise HTTPException(status_code=404, detail="not found")

        images = [_normalize_content_detail_item(row, content_row.get("title"), content_row.get("alt")) for row in image_rows]
        thumbnail_image_id = int(images[0]["image_id"])
        primary = images[0]
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
            "uploader_user_key": primary.get("uploader_user_key"),
            "uploader_display_name": primary.get("uploader_display_name"),
            "uploader_avatar_url": primary.get("uploader_avatar_url"),
            "images": images,
        }
    finally:
        conn.close()
