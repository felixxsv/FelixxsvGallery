from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import string
import uuid
from datetime import datetime, timezone
import re

from fastapi import APIRouter, Body, Cookie, Path, Query
from fastapi.responses import JSONResponse

from auth_security import DEFAULT_COOKIE_NAME, build_clear_session_cookie_options
from auth_service import get_current_user_profile
from db import db_conn, load_conf


router = APIRouter(prefix="/api/admin", tags=["admin"])

_ALLOWED_PAGES = {
    "dashboard": "ダッシュボード",
    "users": "ユーザー管理",
    "content": "コンテンツ管理",
    "mail": "メール配信",
    "settings": "サイト設定",
    "audit-logs": "監査ログ",
}

_NAV_ITEMS = [
    {"key": "dashboard", "label": "ダッシュボード", "href": "/gallery/admin/"},
    {"key": "content", "label": "コンテンツ管理", "href": "/gallery/admin/content/"},
    {"key": "users", "label": "ユーザー管理", "href": "/gallery/admin/users/"},
    {"key": "mail", "label": "メール配信", "href": "/gallery/admin/mail/"},
    {"key": "settings", "label": "サイト設定", "href": "/gallery/admin/settings/"},
    {"key": "audit-logs", "label": "監査ログ", "href": "/gallery/admin/audit-logs/"},
]

_DASHBOARD_PREFERENCE_KEY = "admin_dashboard.clock_mode"
_ALLOWED_CLOCK_MODES = {"digital", "analog"}
_ALLOWED_ROLES = {"admin", "user"}
_ALLOWED_STATUSES = {"active", "locked", "disabled", "deleted"}
_USERKEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{3,19}$")
_TEMP_USERKEY_CHARS = string.ascii_lowercase + string.digits
_TEMP_PASSWORD_CHARS = string.ascii_letters + string.digits


def _request_id() -> str:
    return str(uuid.uuid4())


def _json_error(status_code: int, request_id: str, code: str, message: str, clear_session_cookie: bool = False, field_errors: dict | None = None) -> JSONResponse:
    response = JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "request_id": request_id,
            "error": {
                "code": code,
                "message": message,
            },
            "field_errors": field_errors or {},
        },
    )
    if clear_session_cookie:
        options = build_clear_session_cookie_options()
        response.delete_cookie(
            key=DEFAULT_COOKIE_NAME,
            path=options.get("path", "/"),
            domain=options.get("domain"),
            secure=bool(options.get("secure", False)),
            httponly=bool(options.get("httponly", True)),
            samesite=options.get("samesite", "lax"),
        )
    return response


def _json_success(request_id: str, data: dict, message: str | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={
            "ok": True,
            "request_id": request_id,
            "data": data,
            "next": None,
            "message": message,
        },
    )


def _get_admin_profile(session_token: str | None, request_id: str):
    result = get_current_user_profile(session_token)
    if not result.get("ok"):
        return None, _json_error(
            status_code=401,
            request_id=request_id,
            code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=bool(result.get("clear_session_cookie")),
        )

    user = (result.get("data") or {}).get("user") or {}
    if str(user.get("role") or "") != "admin":
        return None, _json_error(
            status_code=403,
            request_id=request_id,
            code="admin_required",
            message="管理者権限が必要です。",
        )

    return result, None


def _get_conf() -> dict:
    conf_path = os.environ.get(
        "GALLERY_CONF",
        "/etc/felixxsv-gallery/gallery.conf",
    )
    return load_conf(conf_path)


def _get_db_connection(autocommit: bool = True):
    return db_conn(_get_conf(), autocommit=autocommit)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc_text(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc).isoformat()
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def _coerce_utc_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return None


def _detect_table(conn, *table_names: str) -> str | None:
    with conn.cursor() as cur:
        for table_name in table_names:
            cur.execute("SHOW TABLES LIKE %s", (table_name,))
            if cur.fetchone():
                return table_name
    return None


def _table_columns(conn, table_name: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM `{table_name}`")
        return {str(row["Field"]) for row in cur.fetchall()}




def _users_columns(conn) -> set[str]:
    return _table_columns(conn, "users")


def _users_has_column(conn, column_name: str) -> bool:
    return column_name in _users_columns(conn)


def _users_email_column(conn) -> str | None:
    cols = _users_columns(conn)
    if "primary_email" in cols:
        return "primary_email"
    if "email" in cols:
        return "email"
    return None


def _users_upload_column(conn) -> str | None:
    cols = _users_columns(conn)
    if "upload_enabled" in cols:
        return "upload_enabled"
    if "can_upload" in cols:
        return "can_upload"
    return None


def _users_avatar_column(conn) -> str | None:
    cols = _users_columns(conn)
    if "avatar_path" in cols:
        return "avatar_path"
    return None


def _users_password_hash_column(conn) -> str | None:
    cols = _users_columns(conn)
    if "password_hash" in cols:
        return "password_hash"
    return None


def _normalize_user_row_runtime(row: dict) -> dict:
    out = dict(row or {})
    if "primary_email" not in out:
        out["primary_email"] = out.get("email")
    if "upload_enabled" not in out:
        out["upload_enabled"] = out.get("can_upload") if out.get("can_upload") is not None else True
    if "avatar_path" not in out:
        out["avatar_path"] = None
    return out

def _ensure_admin_user_preferences_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_user_preferences (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    preference_key VARCHAR(100) NOT NULL,
    value_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_user_preferences_user_pref (user_id, preference_key),
    KEY idx_admin_user_preferences_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )


def _get_admin_preference(conn, user_id: int, preference_key: str, default_value):
    _ensure_admin_user_preferences_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT value_json
FROM admin_user_preferences
WHERE user_id=%s AND preference_key=%s
LIMIT 1
""",
            (user_id, preference_key),
        )
        row = cur.fetchone()
    if not row:
        return default_value
    value = row.get("value_json")
    if isinstance(value, (dict, list, str, int, float, bool)) or value is None:
        return value
    try:
        return json.loads(value)
    except Exception:
        return default_value


def _set_admin_preference(conn, user_id: int, preference_key: str, value) -> None:
    _ensure_admin_user_preferences_table(conn)
    value_json = json.dumps(value, ensure_ascii=False)
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO admin_user_preferences (user_id, preference_key, value_json)
VALUES (%s, %s, CAST(%s AS JSON))
ON DUPLICATE KEY UPDATE
    value_json=CAST(%s AS JSON),
    updated_at=CURRENT_TIMESTAMP(6)
""",
            (user_id, preference_key, value_json, value_json),
        )


def _format_count_short(value: int | None) -> str:
    if value is None:
        return "0"
    n = int(value)
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        v = n / 1000
        return f"{v:.1f}K".replace(".0K", "K")
    if n < 1_000_000_000:
        v = n / 1_000_000
        return f"{v:.1f}M".replace(".0M", "M")
    v = n / 1_000_000_000
    return f"{v:.1f}B".replace(".0B", "B")


def _build_preview_url(path_value: str | None) -> str | None:
    if not path_value:
        return None
    raw = str(path_value).strip()
    if raw == "":
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if raw.startswith("/gallery/"):
        return raw
    if raw.startswith("/storage/"):
        return f"/gallery{raw}"
    if raw.startswith("/media/"):
        return f"/gallery{raw}"
    if raw.startswith("storage/"):
        return f"/gallery/{raw}"
    if raw.startswith("media/"):
        return f"/gallery/{raw}"
    if raw.startswith("/"):
        return f"/gallery/storage{raw}"
    return f"/gallery/storage/{raw}"


def _load_active_users(conn) -> list[dict]:
    session_table = _detect_table(conn, "sessions", "user_sessions")
    if session_table is None:
        return []

    session_cols = _table_columns(conn, session_table)
    now_dt = _utc_now()
    email_col = _users_email_column(conn)
    avatar_col = _users_avatar_column(conn)

    select_parts = [
        "u.id AS user_id",
        "u.user_key",
        "u.display_name",
        f"u.{email_col} AS primary_email" if email_col else "NULL AS primary_email",
        f"u.{avatar_col} AS avatar_path" if avatar_col else "NULL AS avatar_path",
        "MAX(s.last_seen_at) AS last_seen_at",
        "MIN(s.created_at) AS session_started_at",
    ]

    revoked_where = "AND s.revoked_at IS NULL" if "revoked_at" in session_cols else ""
    group_parts = ["u.id", "u.user_key", "u.display_name"]
    if email_col:
        group_parts.append(f"u.{email_col}")
    if avatar_col:
        group_parts.append(f"u.{avatar_col}")

    sql = f"""
SELECT {", ".join(select_parts)}
FROM `{session_table}` s
JOIN users u ON u.id=s.user_id
WHERE s.expires_at > %s
  {revoked_where}
  AND s.last_seen_at >= DATE_SUB(%s, INTERVAL 10 MINUTE)
  AND u.status='active'
GROUP BY {", ".join(group_parts)}
ORDER BY MAX(s.last_seen_at) DESC
LIMIT 8
"""
    with conn.cursor() as cur:
        cur.execute(sql, (now_dt, now_dt))
        rows = cur.fetchall()

    items = []
    for row in rows:
        row = _normalize_user_row_runtime(row)
        session_started_at = _coerce_utc_datetime(row.get("session_started_at"))
        elapsed = 0
        if session_started_at is not None:
            elapsed = max(0, int((_utc_now() - session_started_at).total_seconds()))
        items.append(
            {
                "user_id": row.get("user_id"),
                "user_key": row.get("user_key"),
                "display_name": row.get("display_name"),
                "primary_email": row.get("primary_email"),
                "avatar_url": _build_preview_url(row.get("avatar_path")),
                "session_started_at": _coerce_utc_text(row.get("session_started_at")),
                "last_seen_at": _coerce_utc_text(row.get("last_seen_at")),
                "session_elapsed_sec": elapsed,
            }
        )
    return items

def _load_recent_audit_logs(conn) -> list[dict]:
    table = _detect_table(conn, "audit_logs")
    if table is None:
        return []

    sql = """
SELECT
    a.id,
    a.created_at,
    a.action_type,
    a.target_type,
    a.target_id,
    a.result,
    a.summary,
    a.ip_address,
    u.id AS actor_user_id,
    u.display_name AS actor_display_name,
    u.user_key AS actor_user_key
FROM audit_logs a
LEFT JOIN users u ON u.id=a.actor_user_id
ORDER BY a.created_at DESC, a.id DESC
LIMIT 8
"""
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    items = []
    for row in rows:
        items.append(
            {
                "id": row.get("id"),
                "created_at": _coerce_utc_text(row.get("created_at")),
                "action_type": row.get("action_type"),
                "target_type": row.get("target_type"),
                "target_id": row.get("target_id"),
                "result": row.get("result"),
                "summary": row.get("summary"),
                "ip_address": row.get("ip_address"),
                "actor": {
                    "user_id": row.get("actor_user_id"),
                    "display_name": row.get("actor_display_name"),
                    "user_key": row.get("actor_user_key"),
                },
            }
        )
    return items


def _load_latest_image(conn) -> dict | None:
    image_cols = _table_columns(conn, "images")
    uploader_key = None
    if "uploader_user_id" in image_cols:
        uploader_key = "uploader_user_id"
    elif "owner_user_id" in image_cols:
        uploader_key = "owner_user_id"

    public_expr = "i.is_public" if "is_public" in image_cols else "1"
    user_join = f"LEFT JOIN users u ON u.id=i.{uploader_key}" if uploader_key else ""
    user_avatar_col = _users_avatar_column(conn)

    user_select = ""
    if user_join:
        user_select = ", u.display_name AS user_display_name, u.user_key AS user_user_key"
        if user_avatar_col:
            user_select += f", u.{user_avatar_col} AS user_avatar_path"
        else:
            user_select += ", NULL AS user_avatar_path"

    sql = f"""
SELECT
    i.id AS image_id,
    i.title,
    i.alt,
    i.preview_path,
    i.thumb_path_960,
    i.thumb_path_480,
    i.shot_at,
    i.created_at AS posted_at,
    COALESCE(st.like_count, 0) AS like_count,
    COALESCE(st.view_count, 0) AS view_count,
    {public_expr} AS is_public
    {user_select}
FROM images i
LEFT JOIN image_stats st ON st.image_id=i.id
{user_join}
ORDER BY COALESCE(i.created_at, i.shot_at) DESC, i.id DESC
LIMIT 1
"""
    with conn.cursor() as cur:
        cur.execute(sql)
        row = cur.fetchone()

    if not row:
        return None

    preview_url = (
        _build_preview_url(row.get("preview_path"))
        or _build_preview_url(row.get("thumb_path_960"))
        or _build_preview_url(row.get("thumb_path_480"))
    )

    return {
        "image_id": row.get("image_id"),
        "title": row.get("title"),
        "alt": row.get("alt"),
        "preview_url": preview_url,
        "like_count": int(row.get("like_count") or 0),
        "view_count": int(row.get("view_count") or 0),
        "like_count_text": _format_count_short(row.get("like_count")),
        "view_count_text": _format_count_short(row.get("view_count")),
        "posted_at": _coerce_utc_text(row.get("posted_at")),
        "shot_at": _coerce_utc_text(row.get("shot_at")),
        "is_public": bool(row.get("is_public")),
        "user": {
            "display_name": row.get("user_display_name"),
            "user_key": row.get("user_user_key"),
            "avatar_url": _build_preview_url(row.get("user_avatar_path")),
        },
    }

def _load_dashboard_stats(conn) -> dict:
    image_cols = _table_columns(conn, "images")
    public_count = 0
    private_count = 0
    if "is_public" in image_cols:
        sql = """
SELECT
    SUM(CASE WHEN is_public=1 THEN 1 ELSE 0 END) AS public_count,
    SUM(CASE WHEN is_public=0 THEN 1 ELSE 0 END) AS private_count
FROM images
"""
        with conn.cursor() as cur:
            cur.execute(sql)
            row = cur.fetchone() or {}
        public_count = int(row.get("public_count") or 0)
        private_count = int(row.get("private_count") or 0)
    else:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS c FROM images")
            row = cur.fetchone() or {}
        public_count = int(row.get("c") or 0)

    with conn.cursor() as cur:
        cur.execute(
            """
SELECT COUNT(*) AS c
FROM images
WHERE COALESCE(created_at, shot_at) >= CURRENT_DATE()
"""
        )
        today_row = cur.fetchone() or {}

    conf = _get_conf()
    storage_root = ((conf.get("paths") or {}).get("storage_root") or "").strip()
    storage_total_bytes = None
    storage_used_bytes = None
    if storage_root:
        try:
            usage = shutil.disk_usage(storage_root)
            storage_total_bytes = int(usage.total)
            storage_used_bytes = int(usage.used)
        except Exception:
            storage_total_bytes = None
            storage_used_bytes = None

    return {
        "today_upload_count": int(today_row.get("c") or 0),
        "public_count": public_count,
        "private_count": private_count,
        "quarantine_count": 0,
        "storage_used_bytes": storage_used_bytes,
        "storage_total_bytes": storage_total_bytes,
    }


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _hash_password(password: str) -> str:
    pw = password.encode("utf-8")
    salt = os.urandom(16)
    iters = 200_000
    dk = hashlib.pbkdf2_hmac("sha256", pw, salt, iters, dklen=32)
    return f"pbkdf2_sha256${iters}${_b64u(salt)}${_b64u(dk)}"


def _generate_temp_user_key(conn) -> str:
    for _ in range(50):
        candidate = "tmp" + "".join(secrets.choice(_TEMP_USERKEY_CHARS) for _ in range(7))
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE user_key=%s LIMIT 1", (candidate,))
            if cur.fetchone() is None:
                return candidate
    raise RuntimeError("temporary_user_key_generation_failed")


def _generate_temp_password() -> str:
    while True:
        password = "".join(secrets.choice(_TEMP_PASSWORD_CHARS) for _ in range(12))
        if any(c.islower() for c in password) and any(c.isupper() for c in password) and any(c.isdigit() for c in password):
            return password


def _validate_user_key(value: str) -> str:
    normalized = str(value or "").strip()
    if not _USERKEY_RE.match(normalized):
        raise ValueError("user_key")
    return normalized


def _log_audit_event(conn, actor_user_id: int | None, action_type: str, target_type: str, target_id: str | None, result: str, summary: str, meta_json: dict | None = None) -> None:
    table = _detect_table(conn, "audit_logs")
    if table is None:
        return
    columns = _table_columns(conn, table)
    cols = ["actor_user_id", "action_type", "target_type", "result", "summary"]
    vals = [actor_user_id, action_type, target_type, result, summary]
    if "target_id" in columns:
        cols.append("target_id")
        vals.append(target_id)
    if "meta_json" in columns:
        cols.append("meta_json")
        vals.append(json.dumps(meta_json or {}, ensure_ascii=False))
    placeholders = ", ".join(["%s"] * len(cols))
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO `{table}` ({', '.join(cols)}) VALUES ({placeholders})",
            vals,
        )


def _count_admin_users(conn) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status<>'deleted'")
        row = cur.fetchone() or {}
    return int(row.get("c") or 0)


def _load_user_providers_map(conn, user_ids: list[int]) -> dict[int, list[str]]:
    if not user_ids:
        return {}
    placeholders = ",".join(["%s"] * len(user_ids))
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT user_id, provider FROM auth_identities WHERE user_id IN ({placeholders}) ORDER BY provider ASC",
            user_ids,
        )
        rows = cur.fetchall()
    out: dict[int, list[str]] = {int(user_id): [] for user_id in user_ids}
    for row in rows:
        user_id = int(row.get("user_id"))
        provider = str(row.get("provider") or "")
        if provider:
            out.setdefault(user_id, []).append(provider)
    return out


def _load_user_two_factor_map(conn, user_ids: list[int]) -> dict[int, dict]:
    if not user_ids:
        return {}
    if _detect_table(conn, "two_factor_settings") is None:
        return {}
    placeholders = ",".join(["%s"] * len(user_ids))
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT user_id, method, is_enabled, is_required, enabled_at, updated_at FROM two_factor_settings WHERE user_id IN ({placeholders})",
            user_ids,
        )
        rows = cur.fetchall()
    out = {}
    for row in rows:
        out[int(row.get("user_id"))] = {
            "method": row.get("method") or "email",
            "is_enabled": bool(row.get("is_enabled")),
            "is_required": bool(row.get("is_required")),
            "enabled_at": _coerce_utc_text(row.get("enabled_at")),
            "updated_at": _coerce_utc_text(row.get("updated_at")),
        }
    return out


def _load_user_last_seen_map(conn, user_ids: list[int]) -> dict[int, str | None]:
    session_table = _detect_table(conn, "sessions", "user_sessions")
    if session_table is None or not user_ids:
        return {}
    cols = _table_columns(conn, session_table)
    revoked_where = "AND revoked_at IS NULL" if "revoked_at" in cols else ""
    placeholders = ",".join(["%s"] * len(user_ids))
    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT user_id, MAX(last_seen_at) AS last_seen_at
FROM `{session_table}`
WHERE user_id IN ({placeholders})
  AND expires_at > %s
  {revoked_where}
GROUP BY user_id
""",
            [*user_ids, _utc_now()],
        )
        rows = cur.fetchall()
    return {int(row.get("user_id")): _coerce_utc_text(row.get("last_seen_at")) for row in rows}


def _serialize_user_list_item(row: dict, providers_map: dict[int, list[str]], two_factor_map: dict[int, dict], last_seen_map: dict[int, str | None]) -> dict:
    row = _normalize_user_row_runtime(row)
    user_id = int(row.get("id"))
    return {
        "user_id": user_id,
        "display_name": row.get("display_name"),
        "user_key": row.get("user_key"),
        "primary_email": row.get("primary_email"),
        "role": row.get("role"),
        "status": row.get("status"),
        "upload_enabled": bool(row.get("upload_enabled")) if row.get("upload_enabled") is not None else True,
        "is_email_verified": bool(row.get("is_email_verified")) if row.get("is_email_verified") is not None else False,
        "avatar_url": _build_preview_url(row.get("avatar_path")),
        "auth_providers": providers_map.get(user_id, []),
        "two_factor": two_factor_map.get(user_id) or {
            "method": "email",
            "is_enabled": False,
            "is_required": False,
            "enabled_at": None,
            "updated_at": None,
        },
        "created_at": _coerce_utc_text(row.get("created_at")),
        "updated_at": _coerce_utc_text(row.get("updated_at")),
        "last_seen_at": last_seen_map.get(user_id),
    }


def _load_users_page(conn, page: int, per_page: int, q: str | None, role: str | None, status: str | None, provider: str | None, sort: str | None) -> dict:
    page = max(1, int(page or 1))
    per_page = max(1, min(100, int(per_page or 20)))
    offset = (page - 1) * per_page
    query = str(q or "").strip()
    role_value = str(role or "").strip().lower() or None
    status_value = str(status or "").strip().lower() or None
    provider_value = str(provider or "").strip().lower() or None
    sort_value = str(sort or "created_desc").strip().lower()

    email_col = _users_email_column(conn)
    upload_col = _users_upload_column(conn)
    avatar_col = _users_avatar_column(conn)

    where = ["1=1"]
    params: list = []

    if query:
        like = f"%{query}%"
        if email_col:
            where.append(f"(u.display_name LIKE %s OR u.user_key LIKE %s OR COALESCE(u.{email_col}, '') LIKE %s)")
            params.extend([like, like, like])
        else:
            where.append("(u.display_name LIKE %s OR u.user_key LIKE %s)")
            params.extend([like, like])

    if role_value in _ALLOWED_ROLES:
        where.append("u.role=%s")
        params.append(role_value)
    if status_value in _ALLOWED_STATUSES:
        where.append("u.status=%s")
        params.append(status_value)
    if provider_value and _detect_table(conn, "auth_identities") is not None:
        where.append("EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id=u.id AND ai.provider=%s)")
        params.append(provider_value)

    if sort_value == "name_asc":
        order_sql = "u.display_name ASC, u.id ASC"
    elif sort_value == "name_desc":
        order_sql = "u.display_name DESC, u.id DESC"
    elif sort_value == "last_seen_desc":
        order_sql = "last_seen_at DESC, u.id DESC"
    elif sort_value == "created_asc":
        order_sql = "u.created_at ASC, u.id ASC"
    else:
        order_sql = "u.created_at DESC, u.id DESC"

    session_table = _detect_table(conn, "sessions", "user_sessions")
    last_seen_join = ""
    session_params: list = []
    if session_table is not None:
        session_cols = _table_columns(conn, session_table)
        revoked_where = "AND s.revoked_at IS NULL" if "revoked_at" in session_cols else ""
        last_seen_join = f"""
LEFT JOIN (
    SELECT s.user_id, MAX(s.last_seen_at) AS last_seen_at
    FROM `{session_table}` s
    WHERE s.expires_at > %s
      {revoked_where}
    GROUP BY s.user_id
) session_last_seen ON session_last_seen.user_id=u.id
"""
        session_params = [_utc_now()]
    else:
        last_seen_join = "LEFT JOIN (SELECT NULL AS user_id, NULL AS last_seen_at) session_last_seen ON 1=0"

    where_sql = " AND ".join(where)
    email_select = f"u.{email_col} AS primary_email" if email_col else "NULL AS primary_email"
    upload_select = f"u.{upload_col} AS upload_enabled" if upload_col else "1 AS upload_enabled"
    avatar_select = f"u.{avatar_col} AS avatar_path" if avatar_col else "NULL AS avatar_path"

    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM users u WHERE {where_sql}", params)
        total = int((cur.fetchone() or {}).get("c") or 0)

        cur.execute(
            f"""
SELECT
    u.id,
    u.display_name,
    u.user_key,
    {email_select},
    u.role,
    u.status,
    {upload_select},
    u.is_email_verified,
    {avatar_select},
    u.created_at,
    u.updated_at,
    session_last_seen.last_seen_at
FROM users u
{last_seen_join}
WHERE {where_sql}
ORDER BY {order_sql}
LIMIT %s OFFSET %s
""",
            [*session_params, *params, per_page, offset],
        )
        rows = cur.fetchall()

    user_ids = [int(row.get("id")) for row in rows]
    providers_map = _load_user_providers_map(conn, user_ids)
    two_factor_map = _load_user_two_factor_map(conn, user_ids)
    last_seen_map = {int(row.get("id")): _coerce_utc_text(row.get("last_seen_at")) for row in rows}

    items = [_serialize_user_list_item(row, providers_map, two_factor_map, last_seen_map) for row in rows]
    pages = (total + per_page - 1) // per_page if total > 0 else 1
    return {
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "total": total,
        "items": items,
    }

def _load_user_detail(conn, user_id: int) -> dict | None:
    email_col = _users_email_column(conn)
    upload_col = _users_upload_column(conn)
    avatar_col = _users_avatar_column(conn)
    email_select = f"{email_col} AS primary_email" if email_col else "NULL AS primary_email"
    upload_select = f"{upload_col} AS upload_enabled" if upload_col else "1 AS upload_enabled"
    avatar_select = f"{avatar_col} AS avatar_path" if avatar_col else "NULL AS avatar_path"

    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT
    id,
    display_name,
    user_key,
    {email_select},
    role,
    status,
    {upload_select},
    is_email_verified,
    must_reset_password,
    {avatar_select},
    created_at,
    updated_at,
    deleted_at,
    force_logout_after
FROM users
WHERE id=%s
LIMIT 1
""",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    providers_map = _load_user_providers_map(conn, [user_id])
    two_factor_map = _load_user_two_factor_map(conn, [user_id])
    last_seen_map = _load_user_last_seen_map(conn, [user_id])
    item = _serialize_user_list_item(row, providers_map, two_factor_map, last_seen_map)
    item["must_reset_password"] = bool(row.get("must_reset_password")) if row.get("must_reset_password") is not None else False
    item["deleted_at"] = _coerce_utc_text(row.get("deleted_at"))
    item["force_logout_after"] = _coerce_utc_text(row.get("force_logout_after"))
    return item

def _build_user_update_payload(payload: dict) -> tuple[dict, dict]:
    field_errors: dict = {}
    normalized: dict = {}

    if "display_name" in payload:
        display_name = str(payload.get("display_name") or "").strip()
        if display_name == "":
            field_errors["display_name"] = {"code": "required", "message": "表示名を入力してください。"}
        elif len(display_name) > 100:
            field_errors["display_name"] = {"code": "too_long", "message": "表示名が長すぎます。"}
        else:
            normalized["display_name"] = display_name

    if "user_key" in payload:
        try:
            normalized["user_key"] = _validate_user_key(payload.get("user_key"))
        except Exception:
            field_errors["user_key"] = {"code": "invalid", "message": "ID の形式が正しくありません。"}

    if "role" in payload:
        role_value = str(payload.get("role") or "").strip().lower()
        if role_value not in _ALLOWED_ROLES:
            field_errors["role"] = {"code": "invalid", "message": "ロールの値が正しくありません。"}
        else:
            normalized["role"] = role_value

    if "status" in payload:
        status_value = str(payload.get("status") or "").strip().lower()
        if status_value not in _ALLOWED_STATUSES:
            field_errors["status"] = {"code": "invalid", "message": "状態の値が正しくありません。"}
        else:
            normalized["status"] = status_value

    if "upload_enabled" in payload:
        normalized["upload_enabled"] = bool(payload.get("upload_enabled"))

    return normalized, field_errors


def _build_user_create_payload(payload: dict) -> tuple[dict, dict]:
    field_errors: dict = {}
    role_value = str((payload or {}).get("role") or "user").strip().lower()
    if role_value not in _ALLOWED_ROLES:
        field_errors["role"] = {"code": "invalid", "message": "ロールの値が正しくありません。"}
    display_name = str((payload or {}).get("display_name") or "").strip() or "未設定ユーザー"
    if len(display_name) > 100:
        field_errors["display_name"] = {"code": "too_long", "message": "表示名が長すぎます。"}
    upload_enabled = bool((payload or {}).get("upload_enabled", True))
    return {
        "role": role_value,
        "display_name": display_name,
        "upload_enabled": upload_enabled,
    }, field_errors


@router.get("/ping")
def admin_ping(session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME)):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    user = (result.get("data") or {}).get("user") or {}
    return _json_success(
        request_id=request_id,
        data={
            "status": "ok",
            "user": {
                "id": user.get("id"),
                "display_name": user.get("display_name"),
                "user_key": user.get("user_key"),
                "role": user.get("role"),
            },
        },
        message="管理 API は利用可能です。",
    )


@router.get("/bootstrap")
def admin_bootstrap(
    page: str = Query(default="dashboard"),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    page_key = str(page or "dashboard").strip().lower()
    if page_key not in _ALLOWED_PAGES:
        page_key = "dashboard"

    user = (result.get("data") or {}).get("user") or {}

    return _json_success(
        request_id=request_id,
        data={
            "current_user": {
                "id": user.get("id"),
                "display_name": user.get("display_name"),
                "user_key": user.get("user_key"),
                "primary_email": user.get("primary_email"),
                "role": user.get("role"),
            },
            "page": {
                "key": page_key,
                "title": _ALLOWED_PAGES[page_key],
            },
            "navigation": _NAV_ITEMS,
            "permissions": {
                "can_view_admin": True,
                "can_manage_users": True,
                "can_manage_content": True,
                "can_send_mail": True,
                "can_manage_settings": True,
                "can_view_audit_logs": True,
            },
            "ui": {
                "sidebar_collapsed_default": False,
            },
        },
        message="管理画面の初期データを取得しました。",
    )


@router.get("/dashboard")
def admin_dashboard(session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME)):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    user = (result.get("data") or {}).get("user") or {}
    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        clock_mode = _get_admin_preference(conn, int(user["id"]), _DASHBOARD_PREFERENCE_KEY, "digital")
        if str(clock_mode or "") not in _ALLOWED_CLOCK_MODES:
            clock_mode = "digital"

        active_users = _load_active_users(conn)
        recent_audit_logs = _load_recent_audit_logs(conn)
        latest_image = _load_latest_image(conn)
        stats = _load_dashboard_stats(conn)

        return _json_success(
            request_id=request_id,
            data={
                "clock_mode": clock_mode,
                "online_user_count": len(active_users),
                "active_users": active_users,
                "recent_audit_logs": recent_audit_logs,
                "latest_image": latest_image,
                "stats": stats,
            },
            message="ダッシュボードデータを取得しました。",
        )
    except Exception:
        return _json_error(
            status_code=500,
            request_id=request_id,
            code="server_error",
            message="ダッシュボードデータの取得に失敗しました。",
        )
    finally:
        if conn is not None:
            conn.close()


@router.patch("/dashboard/preferences")
def update_dashboard_preferences(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    user = (result.get("data") or {}).get("user") or {}
    clock_mode = str((payload or {}).get("clock_mode") or "").strip().lower()
    if clock_mode not in _ALLOWED_CLOCK_MODES:
        return _json_error(
            status_code=400,
            request_id=request_id,
            code="validation_error",
            message="clock_mode の値が正しくありません。",
        )

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        _set_admin_preference(conn, int(user["id"]), _DASHBOARD_PREFERENCE_KEY, clock_mode)
        conn.commit()
        return _json_success(
            request_id=request_id,
            data={
                "clock_mode": clock_mode,
            },
            message="ダッシュボード設定を更新しました。",
        )
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(
            status_code=500,
            request_id=request_id,
            code="server_error",
            message="ダッシュボード設定の更新に失敗しました。",
        )
    finally:
        if conn is not None:
            conn.close()


@router.get("/users")
def admin_users_list(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    provider: str | None = Query(default=None),
    sort: str | None = Query(default="created_desc"),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        data = _load_users_page(conn, page=page, per_page=per_page, q=q, role=role, status=status, provider=provider, sort=sort)
        return _json_success(request_id=request_id, data=data, message="ユーザー一覧を取得しました。")
    except Exception:
        return _json_error(500, request_id, "server_error", "ユーザー一覧の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/users/{user_id}")
def admin_user_detail(
    user_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    _, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        data = _load_user_detail(conn, user_id)
        if data is None:
            return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
        return _json_success(request_id=request_id, data={"user": data}, message="ユーザー詳細を取得しました。")
    except Exception:
        return _json_error(500, request_id, "server_error", "ユーザー詳細の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/users/{user_id}")
def admin_user_update(
    user_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    normalized, field_errors = _build_user_update_payload(payload or {})
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力内容を確認してください。", field_errors=field_errors)
    if not normalized:
        return _json_success(request_id=request_id, data={"changed": False}, message="変更はありません。")

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        current = _load_user_detail(conn, user_id)
        if current is None:
            return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")

        if "role" in normalized and normalized["role"] != current.get("role"):
            if int(actor.get("id") or 0) == user_id and normalized["role"] != "admin":
                return _json_error(409, request_id, "cannot_demote_self", "自分自身の管理者権限は解除できません。")
            if current.get("role") == "admin" and normalized["role"] != "admin" and _count_admin_users(conn) <= 1:
                return _json_error(409, request_id, "last_admin_protected", "最後の管理者は変更できません。")

        if "user_key" in normalized and normalized["user_key"] != current.get("user_key"):
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE user_key=%s AND id<>%s LIMIT 1", (normalized["user_key"], user_id))
                if cur.fetchone() is not None:
                    return _json_error(409, request_id, "user_key_already_used", "この ID はすでに使用されています。", field_errors={"user_key": {"code": "duplicate", "message": "この ID はすでに使用されています。"}})

        changes = {}
        for key, value in normalized.items():
            if current.get(key) != value:
                changes[key] = value

        if not changes:
            return _json_success(request_id=request_id, data={"changed": False, "user": current}, message="変更はありません。")

        upload_col = _users_upload_column(conn)
        users_cols = _users_columns(conn)

        set_clauses = []
        params = []
        for key, value in changes.items():
            db_key = upload_col if key == "upload_enabled" else key
            if db_key is None:
                continue
            set_clauses.append(f"{db_key}=%s")
            params.append(value)

        if "status" in changes and "is_disabled" in users_cols:
            set_clauses.append("is_disabled=%s")
            params.append(1 if str(changes["status"]) in {"disabled", "deleted"} else 0)

        set_clauses.append("updated_at=CURRENT_TIMESTAMP(6)")
        params.append(user_id)
        with conn.cursor() as cur:
            cur.execute(f"UPDATE users SET {', '.join(set_clauses)} WHERE id=%s", params)
            if _detect_table(conn, "auth_identities") is not None and ("display_name" in changes or "user_key" in changes):
                provider_updates = []
                provider_params = []
                if "display_name" in changes:
                    provider_updates.append("provider_display_name=%s")
                    provider_params.append(changes["display_name"])
                if provider_updates:
                    provider_params.append(user_id)
                    cur.execute(f"UPDATE auth_identities SET {', '.join(provider_updates)}, updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=%s", provider_params)
        _log_audit_event(
            conn,
            actor_user_id=int(actor.get("id") or 0) or None,
            action_type="admin.users.update",
            target_type="user",
            target_id=str(user_id),
            result="success",
            summary="ユーザー情報を更新しました。",
            meta_json={"changes": changes},
        )
        conn.commit()
        updated = _load_user_detail(conn, user_id)
        return _json_success(request_id=request_id, data={"changed": True, "user": updated}, message="ユーザー情報を更新しました。")
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "ユーザー情報の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.post("/users/create")
def admin_user_create(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    normalized, field_errors = _build_user_create_payload(payload or {})
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力内容を確認してください。", field_errors=field_errors)

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        temp_user_key = _generate_temp_user_key(conn)
        temp_password = _generate_temp_password()
        password_hash = _hash_password(temp_password)

        users_cols = _users_columns(conn)
        email_col = _users_email_column(conn)
        upload_col = _users_upload_column(conn)
        password_col = _users_password_hash_column(conn)

        insert_cols: list[str] = []
        insert_vals: list = []

        def add_user_col(name: str, value):
            if name in users_cols:
                insert_cols.append(name)
                insert_vals.append(value)

        add_user_col("gallery", _get_conf().get("app", {}).get("gallery"))
        add_user_col("user_key", temp_user_key)
        add_user_col("display_name", normalized["display_name"])
        if email_col:
            add_user_col(email_col, None)
        add_user_col("avatar_path", None)
        add_user_col("role", normalized["role"])
        add_user_col("status", "active")
        if upload_col:
            add_user_col(upload_col, 1 if normalized["upload_enabled"] else 0)
        add_user_col("is_email_verified", 0)
        add_user_col("must_reset_password", 1)
        add_user_col("force_logout_after", None)
        add_user_col("deleted_at", None)
        add_user_col("is_disabled", 0)
        if password_col:
            add_user_col(password_col, password_hash)

        with conn.cursor() as cur:
            placeholders = ", ".join(["%s"] * len(insert_cols))
            cur.execute(
                f"INSERT INTO users ({', '.join(insert_cols)}) VALUES ({placeholders})",
                insert_vals,
            )
            cur.execute("SELECT LAST_INSERT_ID() AS id")
            user_id = int((cur.fetchone() or {}).get("id") or 0)

            if _detect_table(conn, "auth_identities") is not None:
                ai_cols_def = _table_columns(conn, "auth_identities")
                ai_cols: list[str] = []
                ai_vals: list = []

                def add_ai_col(name: str, value):
                    if name in ai_cols_def:
                        ai_cols.append(name)
                        ai_vals.append(value)

                add_ai_col("user_id", user_id)
                add_ai_col("provider", "email_password")
                add_ai_col("provider_user_id", temp_user_key)
                add_ai_col("provider_email", None)
                add_ai_col("provider_display_name", normalized["display_name"])
                add_ai_col("is_enabled", 1)
                placeholders_ai = ", ".join(["%s"] * len(ai_cols))
                cur.execute(
                    f"INSERT INTO auth_identities ({', '.join(ai_cols)}) VALUES ({placeholders_ai})",
                    ai_vals,
                )

            if _detect_table(conn, "password_credentials") is not None:
                pc_cols_def = _table_columns(conn, "password_credentials")
                pc_cols: list[str] = []
                pc_vals: list = []

                def add_pc_col(name: str, value):
                    if name in pc_cols_def:
                        pc_cols.append(name)
                        pc_vals.append(value)

                add_pc_col("user_id", user_id)
                add_pc_col("password_hash", password_hash)
                add_pc_col("failed_attempts", 0)
                add_pc_col("locked_until", None)
                placeholders_pc = ", ".join(["%s"] * len(pc_cols))
                cur.execute(
                    f"INSERT INTO password_credentials ({', '.join(pc_cols)}) VALUES ({placeholders_pc})",
                    pc_vals,
                )

            if _detect_table(conn, "two_factor_settings") is not None:
                cur.execute(
                    """
INSERT INTO two_factor_settings (
    user_id,
    method,
    is_enabled,
    is_required,
    enabled_at,
    updated_at
) VALUES (%s, 'email', 0, 0, NULL, CURRENT_TIMESTAMP(6))
""",
                    (user_id,),
                )
        _log_audit_event(
            conn,
            actor_user_id=int(actor.get("id") or 0) or None,
            action_type="admin.users.create",
            target_type="user",
            target_id=str(user_id),
            result="success",
            summary="仮ユーザーを作成しました。",
            meta_json={"role": normalized["role"], "upload_enabled": normalized["upload_enabled"]},
        )
        conn.commit()
        created = _load_user_detail(conn, user_id)
        return _json_success(
            request_id=request_id,
            data={
                "user": created,
                "temporary_credentials": {
                    "user_key": temp_user_key,
                    "password": temp_password,
                    "setup_required": True,
                },
            },
            message="仮ユーザーを作成しました。",
        )
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "仮ユーザーの作成に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.post("/users/{user_id}/delete")
def admin_user_delete(
    user_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    if int(actor.get("id") or 0) == user_id:
        return _json_error(409, request_id, "cannot_delete_self", "自分自身は削除できません。")

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        current = _load_user_detail(conn, user_id)
        if current is None:
            return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
        if current.get("role") == "admin" and _count_admin_users(conn) <= 1:
            return _json_error(409, request_id, "last_admin_protected", "最後の管理者は削除できません。")

        with conn.cursor() as cur:
            cur.execute(
                """
UPDATE users
SET status='deleted',
    deleted_at=CURRENT_TIMESTAMP(6),
    force_logout_after=CURRENT_TIMESTAMP(6),
    updated_at=CURRENT_TIMESTAMP(6)
WHERE id=%s
""",
                (user_id,),
            )
        _log_audit_event(
            conn,
            actor_user_id=int(actor.get("id") or 0) or None,
            action_type="admin.users.delete",
            target_type="user",
            target_id=str(user_id),
            result="success",
            summary="ユーザーを論理削除しました。",
        )
        conn.commit()
        return _json_success(request_id=request_id, data={"deleted": True, "user_id": user_id}, message="ユーザーを削除しました。")
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "ユーザー削除に失敗しました。")
    finally:
        if conn is not None:
            conn.close()
