from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import shutil
import string
import uuid
from datetime import datetime, timedelta, timezone
import re
import ipaddress
import csv
import io

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Body, Cookie, Path, Query
from fastapi.responses import JSONResponse, Response

from auth_security import DEFAULT_COOKIE_NAME, build_clear_session_cookie_options
from auth_service import get_current_user_profile
from auth_mail import AuthMailError, build_text_message, send_message
from db import db_conn, load_conf
from badge_defs import list_badge_keys, serialize_badge, list_catalog as list_badge_catalog
from supporter_service import (
    build_supporter_context,
    grant_supporter_access,
    record_supporter_provider_event,
    revoke_supporter_grant,
    upsert_supporter_subscription,
)
from galleryctl.colors import load_palette_from_conf


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
    {"key": "dashboard", "label": "ダッシュボード", "href": "/admin/"},
    {"key": "content", "label": "コンテンツ管理", "href": "/admin/content/"},
    {"key": "users", "label": "ユーザー管理", "href": "/admin/users/"},
    {"key": "contacts", "label": "お問い合わせ", "href": "/admin/contacts/"},
    {"key": "mail", "label": "メール配信", "href": "/admin/mail/"},
    {"key": "settings", "label": "サイト設定", "href": "/admin/settings/"},
    {"key": "audit-logs", "label": "監査ログ", "href": "/admin/audit-logs/"},
]

_DASHBOARD_PREFERENCE_KEY = "admin_dashboard.clock_mode"
_ALLOWED_CLOCK_MODES = {"digital", "analog"}
_ALLOWED_ROLES = {"admin", "user"}
_ALLOWED_STATUSES = {"active", "locked", "disabled", "deleted"}
_ALLOWED_SUPPORT_STATUS_FILTERS = {"active", "cancelScheduled", "giftActive", "permanentActive", "scheduled", "past_due", "unpaid", "expired", "inactive"}
_PRESENCE_VISIBLE_WINDOW_SEC = 90
_SESSION_FUTURE_SKEW_SEC = 300
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


def _coerce_local_text(value) -> str | None:
    """Return naive ISO string for datetimes stored in local (JST) timezone.
    JS treats timezone-free ISO 8601 datetime strings as local time, so
    the browser renders the correct JST value without any offset conversion.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None).isoformat()
    return str(value)


def _coerce_utc_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return None


def _presence_cutoff(now: datetime | None = None) -> datetime:
    base = _coerce_utc_datetime(now) if now is not None else _utc_now()
    if base is None:
        base = _utc_now()
    return base - timedelta(seconds=_PRESENCE_VISIBLE_WINDOW_SEC)


def _session_future_limit(now: datetime | None = None) -> datetime:
    base = _coerce_utc_datetime(now) if now is not None else _utc_now()
    if base is None:
        base = _utc_now()
    return base + timedelta(seconds=_SESSION_FUTURE_SKEW_SEC)


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
    if "is_hidden_from_search" not in out:
        out["is_hidden_from_search"] = False
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
        logger.exception("Unhandled error")
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
    if raw.startswith("/"):
        return raw
    if raw.startswith("/storage/"):
        return raw
    if raw.startswith("/media/"):
        return raw
    if raw.startswith("storage/"):
        return f"/{raw}"
    if raw.startswith("media/"):
        return f"/{raw}"
    if raw.startswith("/"):
        return f"/storage{raw}"
    return f"/storage/{raw}"


def _load_active_users(conn) -> list[dict]:
    session_table = _detect_table(conn, "sessions", "user_sessions")
    if session_table is None:
        return []

    session_cols = _table_columns(conn, session_table)
    now_dt = _utc_now()
    cutoff_dt = _presence_cutoff(now_dt)
    future_limit_dt = _session_future_limit(now_dt)
    email_col = _users_email_column(conn)
    avatar_col = _users_avatar_column(conn)

    presence_col = "last_presence_at" if "last_presence_at" in session_cols else "last_seen_at"
    access_col = "last_access_at" if "last_access_at" in session_cols else "last_seen_at"

    select_parts = [
        "u.id AS user_id",
        "u.user_key",
        "u.display_name",
        f"u.{email_col} AS primary_email" if email_col else "NULL AS primary_email",
        f"u.{avatar_col} AS avatar_path" if avatar_col else "NULL AS avatar_path",
        f"MAX(s.{presence_col}) AS last_presence_at",
        f"MAX(s.{access_col}) AS last_access_at",
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
  AND s.{presence_col} IS NOT NULL
  AND s.{presence_col} >= %s
  AND s.{presence_col} <= %s
  AND u.status='active'
GROUP BY {", ".join(group_parts)}
ORDER BY MAX(s.{presence_col}) DESC
LIMIT 200
"""
    with conn.cursor() as cur:
        cur.execute(sql, (now_dt, cutoff_dt, future_limit_dt))
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
                "last_presence_at": _coerce_utc_text(row.get("last_presence_at")),
                "last_access_at": _coerce_utc_text(row.get("last_access_at")),
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
    focal_select = ", COALESCE(i.focal_x, 50) AS focal_x, COALESCE(i.focal_y, 50) AS focal_y" if "focal_x" in image_cols else ", 50 AS focal_x, 50 AS focal_y"
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
    {focal_select}
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
        "posted_at": _coerce_local_text(row.get("posted_at")),
        "shot_at": _coerce_local_text(row.get("shot_at")),
        "is_public": bool(row.get("is_public")),
        "focal_x": float(row.get("focal_x") if row.get("focal_x") is not None else 50),
        "focal_y": float(row.get("focal_y") if row.get("focal_y") is not None else 50),
        "user": {
            "display_name": row.get("user_display_name"),
            "user_key": row.get("user_user_key"),
            "avatar_url": _build_preview_url(row.get("user_avatar_path")),
        },
    }

def _ensure_admin_content_states_table(conn) -> None:
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

    quarantine_count = 0
    try:
        _ensure_admin_content_states_table(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT COUNT(*) AS c
FROM admin_content_states
WHERE moderation_status='quarantined'
"""
            )
            q_row = cur.fetchone() or {}
        quarantine_count = int(q_row.get("c") or 0)
    except Exception:
        logger.exception("Unhandled error")
        quarantine_count = 0

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
            logger.exception("Unhandled error")
            storage_total_bytes = None
            storage_used_bytes = None

    return {
        "today_upload_count": int(today_row.get("c") or 0),
        "public_count": public_count,
        "private_count": private_count,
        "quarantine_count": quarantine_count,
        "storage_used_bytes": storage_used_bytes,
        "storage_total_bytes": storage_total_bytes,
    }


def _find_existing_usage_base(path: str) -> str | None:
    normalized = str(path or "").strip()
    if not normalized:
        return None
    candidate = os.path.abspath(normalized)
    while True:
        if os.path.exists(candidate):
            return candidate
        parent = os.path.dirname(candidate)
        if parent == candidate:
            return None
        candidate = parent


def _measure_path_size_bytes(path: str, cache: dict[str, int | None] | None = None) -> int | None:
    normalized = str(path or "").strip()
    if not normalized:
        return None
    abs_path = os.path.abspath(normalized)
    if cache is not None and abs_path in cache:
        return cache[abs_path]
    if not os.path.exists(abs_path):
        if cache is not None:
            cache[abs_path] = None
        return None
    total = 0
    try:
        if os.path.isfile(abs_path):
            total = int(os.path.getsize(abs_path))
        elif os.path.isdir(abs_path):
            for root, _, files in os.walk(abs_path, followlinks=False):
                for filename in files:
                    full_path = os.path.join(root, filename)
                    try:
                        if os.path.islink(full_path):
                            continue
                        total += int(os.path.getsize(full_path))
                    except OSError:
                        continue
        else:
            total = None
    except OSError:
        total = None
    if cache is not None:
        cache[abs_path] = total
    return total


def _build_storage_usage_item(key: str, label: str, path: str, size_cache: dict[str, int | None] | None = None) -> dict:
    normalized = str(path or "").strip()
    usage_base = _find_existing_usage_base(normalized) if normalized else None
    filesystem_total_bytes = None
    filesystem_used_bytes = None
    filesystem_free_bytes = None
    filesystem_usage_ratio = None
    if usage_base:
        try:
            usage = shutil.disk_usage(usage_base)
            filesystem_total_bytes = int(usage.total)
            filesystem_used_bytes = int(usage.used)
            filesystem_free_bytes = int(usage.free)
            filesystem_usage_ratio = (filesystem_used_bytes / filesystem_total_bytes) if filesystem_total_bytes else None
        except OSError:
            pass

    exists = bool(normalized) and os.path.exists(normalized)
    directory_size_bytes = _measure_path_size_bytes(normalized, size_cache) if normalized else None
    directory_share_ratio = None
    if directory_size_bytes is not None and filesystem_total_bytes:
        directory_share_ratio = directory_size_bytes / filesystem_total_bytes

    return {
        "key": key,
        "label": label,
        "path": normalized,
        "exists": exists,
        "is_directory": bool(normalized) and os.path.isdir(normalized),
        "is_file": bool(normalized) and os.path.isfile(normalized),
        "usage_base_path": usage_base,
        "directory_size_bytes": directory_size_bytes,
        "filesystem_total_bytes": filesystem_total_bytes,
        "filesystem_used_bytes": filesystem_used_bytes,
        "filesystem_free_bytes": filesystem_free_bytes,
        "filesystem_usage_ratio": filesystem_usage_ratio,
        "filesystem_usage_percent": round(filesystem_usage_ratio * 100, 2) if filesystem_usage_ratio is not None else None,
        "directory_share_of_filesystem_ratio": directory_share_ratio,
        "directory_share_of_filesystem_percent": round(directory_share_ratio * 100, 4) if directory_share_ratio is not None else None,
    }


def _load_storage_usage_payload(conn) -> dict:
    payload = _load_site_settings_group(conn, "storage")
    settings = payload.get("settings") or {}
    size_cache: dict[str, int | None] = {}
    items = [
        _build_storage_usage_item("source_root", "source_root", settings.get("source_root") or "", size_cache),
        _build_storage_usage_item("storage_root", "storage_root", settings.get("storage_root") or "", size_cache),
        _build_storage_usage_item("original_cache_root", "original_cache_root", settings.get("original_cache_root") or "", size_cache),
    ]
    primary = next((item for item in items if item.get("key") == "storage_root"), None) or (items[0] if items else None)
    return {
        "generated_at": _coerce_utc_text(datetime.now(timezone.utc)),
        "primary_key": primary.get("key") if primary else None,
        "primary": primary,
        "items": items,
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


def _serialize_user_list_item(row: dict, providers_map: dict[int, list[str]], two_factor_map: dict[int, dict], supporter_map: dict[int, dict] | None = None) -> dict:
    row = _normalize_user_row_runtime(row)
    user_id = int(row.get("id"))
    active_session_count = int(row.get("active_session_count") or 0)
    account_status = str(row.get("status") or "active")
    login_status = "logged_in" if active_session_count > 0 else "logged_out"

    last_presence_dt = _coerce_utc_datetime(row.get("last_presence_at"))
    now_dt = _utc_now()
    is_visible = False
    if last_presence_dt is not None and active_session_count > 0:
        is_visible = _presence_cutoff(now_dt) <= last_presence_dt <= _session_future_limit(now_dt)
    screen_status = "visible" if is_visible else "hidden"

    last_access_value = row.get("last_access_at") or row.get("last_seen_at")

    support = (supporter_map or {}).get(user_id) or {
        "status": {"code": "inactive", "is_active": False},
        "achievement_summary": {"total_months": 0, "highest_code": None},
    }

    return {
        "user_id": user_id,
        "display_name": row.get("display_name"),
        "user_key": row.get("user_key"),
        "primary_email": row.get("primary_email"),
        "role": row.get("role"),
        "status": account_status,
        "account_status": account_status,
        "login_status": login_status,
        "screen_status": screen_status,
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
        "last_seen_at": _coerce_utc_text(row.get("last_seen_at")),
        "last_presence_at": _coerce_utc_text(row.get("last_presence_at")),
        "last_access_at": _coerce_utc_text(last_access_value),
        "support": {
            "status": support.get("status") or {"code": "inactive", "is_active": False},
            "achievement_summary": support.get("achievement_summary") or {"total_months": 0, "highest_code": None},
        },
    }


def _load_users_page(conn, page: int, per_page: int, q: str | None, role: str | None, status: str | None, provider: str | None, sort: str | None, support_status: str | None = None) -> dict:
    page = max(1, int(page or 1))
    per_page = max(1, min(100, int(per_page or 20)))
    offset = (page - 1) * per_page
    query = str(q or "").strip()
    role_value = str(role or "").strip().lower() or None
    status_value = str(status or "").strip().lower() or None
    provider_value = str(provider or "").strip().lower() or None
    sort_value = str(sort or "created_desc").strip().lower()
    support_status_value = str(support_status or "").strip() or None
    if support_status_value not in _ALLOWED_SUPPORT_STATUS_FILTERS:
        support_status_value = None

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

    if provider_value:
        where.append("EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id=u.id AND ai.provider=%s)")
        params.append(provider_value)

    if sort_value == "created_desc":
        order_sql = "u.created_at DESC, u.id DESC"
    elif sort_value == "name_asc":
        order_sql = "u.display_name ASC, u.id ASC"
    elif sort_value == "name_desc":
        order_sql = "u.display_name DESC, u.id DESC"
    elif sort_value == "last_seen_desc":
        order_sql = "COALESCE(session_state.last_access_at, session_state.last_seen_at) DESC, u.id DESC"
    elif sort_value == "created_asc":
        order_sql = "u.created_at ASC, u.id ASC"
    else:
        order_sql = "u.created_at DESC, u.id DESC"

    session_table = _detect_table(conn, "sessions", "user_sessions")
    session_join = ""
    session_params: list = []
    if session_table is not None:
        session_cols = _table_columns(conn, session_table)
        revoked_active_case = "AND s.revoked_at IS NULL" if "revoked_at" in session_cols else ""
        access_expr = "s.last_access_at" if "last_access_at" in session_cols else "s.last_seen_at"
        presence_expr = "s.last_presence_at" if "last_presence_at" in session_cols else "s.last_seen_at"
        session_join = f"""
LEFT JOIN (
    SELECT
        s.user_id,
        MAX(s.last_seen_at) AS last_seen_at,
        MAX({access_expr}) AS last_access_at,
        MAX({presence_expr}) AS last_presence_at,
        SUM(CASE WHEN s.expires_at > %s {revoked_active_case} THEN 1 ELSE 0 END) AS active_session_count
    FROM `{session_table}` s
    GROUP BY s.user_id
) session_state ON session_state.user_id=u.id
"""
        session_params = [_utc_now()]
    else:
        session_join = "LEFT JOIN (SELECT NULL AS user_id, NULL AS last_seen_at, NULL AS last_access_at, NULL AS last_presence_at, 0 AS active_session_count) session_state ON 1=0"

    where_sql = " AND ".join(where)
    email_select = f"u.{email_col} AS primary_email" if email_col else "NULL AS primary_email"
    upload_select = f"u.{upload_col} AS upload_enabled" if upload_col else "1 AS upload_enabled"
    avatar_select = f"u.{avatar_col} AS avatar_path" if avatar_col else "NULL AS avatar_path"

    with conn.cursor() as cur:
        if support_status_value:
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
    session_state.last_seen_at,
    session_state.last_access_at,
    session_state.last_presence_at,
    session_state.active_session_count
FROM users u
{session_join}
WHERE {where_sql}
ORDER BY {order_sql}
""",
                [*session_params, *params],
            )
            all_rows = cur.fetchall()
            all_user_ids = [int(row.get("id")) for row in all_rows]
            all_supporter_map = _load_supporter_map(conn, all_user_ids)
            filtered_rows = [
                row for row in all_rows
                if str((all_supporter_map.get(int(row.get("id"))) or {}).get("status", {}).get("code") or "inactive") == support_status_value
            ]
            total = len(filtered_rows)
            rows = filtered_rows[offset:offset + per_page]
            supporter_map = {int(row.get("id")): all_supporter_map.get(int(row.get("id"))) for row in rows}
        else:
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
    session_state.last_seen_at,
    session_state.last_access_at,
    session_state.last_presence_at,
    session_state.active_session_count
FROM users u
{session_join}
WHERE {where_sql}
ORDER BY {order_sql}
LIMIT %s OFFSET %s
""",
                [*session_params, *params, per_page, offset],
            )
            rows = cur.fetchall()
            supporter_map = _load_supporter_map(conn, [int(row.get("id")) for row in rows])

    user_ids = [int(row.get("id")) for row in rows]
    providers_map = _load_user_providers_map(conn, user_ids)
    two_factor_map = _load_user_two_factor_map(conn, user_ids)

    items = [_serialize_user_list_item(row, providers_map, two_factor_map, supporter_map) for row in rows]
    pages = (total + per_page - 1) // per_page if total > 0 else 1
    return {
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "total": total,
        "items": items,
    }

def _users_has_bio(conn) -> bool:
    return _users_has_column(conn, "bio")


def _users_has_display_badges(conn) -> bool:
    return _users_has_column(conn, "display_badges")


def _users_has_hidden_from_search(conn) -> bool:
    return _users_has_column(conn, "is_hidden_from_search")


def _load_user_links_for_admin(conn, user_id: int) -> list[dict]:
    """Load all user links regardless of gallery."""
    conf = _get_conf()
    gallery = conf.get("gallery") or "felixxsv"
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, url, display_order FROM user_links WHERE user_id=%s AND gallery=%s ORDER BY display_order ASC, id ASC",
            (user_id, gallery),
        )
        return list(cur.fetchall() or [])


def _load_user_badges_for_admin(conn, user_id: int) -> list[dict]:
    if not _detect_table(conn, "user_badges"):
        return []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT badge_key, granted_by, granted_at FROM user_badges WHERE user_id=%s ORDER BY granted_at ASC",
            (user_id,),
        )
        rows = cur.fetchall() or []
    result = []
    for row in rows:
        s = serialize_badge(
            row["badge_key"],
            granted_at=_coerce_utc_text(row.get("granted_at")),
            granted_by=row.get("granted_by"),
            conn=conn,
        )
        result.append(s)
    return result


def _load_supporter_map(conn, user_ids: list[int]) -> dict[int, dict]:
    result: dict[int, dict] = {}
    conf = _get_conf()
    for user_id in user_ids:
        try:
            result[int(user_id)] = build_supporter_context(conn, int(user_id), conf=conf, include_private=True, include_admin=False)
        except Exception:
            logger.exception("failed to load supporter context", extra={"user_id": user_id})
            result[int(user_id)] = {
                "status": {"code": "inactive", "is_active": False},
                "achievement_summary": {"total_months": 0, "highest_code": None},
                "public_profile": {},
            }
    return result


def _load_user_detail(conn, user_id: int) -> dict | None:
    email_col = _users_email_column(conn)
    upload_col = _users_upload_column(conn)
    avatar_col = _users_avatar_column(conn)
    has_bio = _users_has_bio(conn)
    has_display_badges = _users_has_display_badges(conn)
    has_hidden_from_search = _users_has_hidden_from_search(conn)
    email_select = f"{email_col} AS primary_email" if email_col else "NULL AS primary_email"
    upload_select = f"{upload_col} AS upload_enabled" if upload_col else "1 AS upload_enabled"
    avatar_select = f"{avatar_col} AS avatar_path" if avatar_col else "NULL AS avatar_path"
    bio_select = "bio" if has_bio else "NULL AS bio"
    display_badges_select = "display_badges" if has_display_badges else "NULL AS display_badges"
    hidden_from_search_select = "is_hidden_from_search" if has_hidden_from_search else "0 AS is_hidden_from_search"

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
    {bio_select},
    {display_badges_select},
    {hidden_from_search_select},
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
    supporter_map = _load_supporter_map(conn, [user_id])
    # Fix: apply last_seen_map to row before passing to serializer (was causing 500)
    row = dict(row)
    row["last_seen_at"] = last_seen_map.get(int(row["id"]))
    item = _serialize_user_list_item(row, providers_map, two_factor_map, supporter_map)
    item["must_reset_password"] = bool(row.get("must_reset_password")) if row.get("must_reset_password") is not None else False
    item["deleted_at"] = _coerce_utc_text(row.get("deleted_at"))
    item["force_logout_after"] = _coerce_utc_text(row.get("force_logout_after"))
    item["bio"] = row.get("bio") or ""
    # display_badges: JSON string or None in DB
    raw_display = row.get("display_badges")
    if isinstance(raw_display, str):
        try:
            item["display_badges"] = json.loads(raw_display)
        except Exception:
            logger.exception("Unhandled error")
            item["display_badges"] = []
    elif isinstance(raw_display, list):
        item["display_badges"] = raw_display
    else:
        item["display_badges"] = []
    item["is_hidden_from_search"] = bool(row.get("is_hidden_from_search"))
    item["links"] = _load_user_links_for_admin(conn, user_id)
    item["badges"] = _load_user_badges_for_admin(conn, user_id)
    item["support"] = build_supporter_context(conn, user_id, conf=_get_conf(), include_private=True, include_admin=True)
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
            logger.exception("Unhandled error")
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

    if "is_hidden_from_search" in payload:
        normalized["is_hidden_from_search"] = bool(payload.get("is_hidden_from_search"))

    if "bio" in payload:
        bio_val = str(payload.get("bio") or "").strip()
        if len(bio_val) > 300:
            field_errors["bio"] = {"code": "too_long", "message": "自己紹介文は300文字以内で入力してください。"}
        else:
            normalized["bio"] = bio_val or None

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
        integrity_summary = _load_integrity_summary(conn)

        return _json_success(
            request_id=request_id,
            data={
                "clock_mode": clock_mode,
                "online_user_count": len(active_users),
                "active_users": active_users,
                "recent_audit_logs": recent_audit_logs,
                "latest_image": latest_image,
                "stats": stats,
                "integrity_summary": integrity_summary,
            },
            message="ダッシュボードデータを取得しました。",
        )
    except Exception:
        logger.exception("Unhandled error")
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
        logger.exception("Unhandled error")
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
    support_status: str | None = Query(default=None),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        data = _load_users_page(conn, page=page, per_page=per_page, q=q, role=role, status=status, provider=provider, sort=sort, support_status=support_status)
        return _json_success(request_id=request_id, data=data, message="ユーザー一覧を取得しました。")
    except Exception:
        logger.exception("Unhandled error")
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
        logger.exception("Unhandled error")
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
            if key == "upload_enabled":
                db_key = upload_col
            elif key == "bio":
                db_key = "bio" if _users_has_bio(conn) else None
            elif key == "is_hidden_from_search":
                db_key = "is_hidden_from_search" if _users_has_hidden_from_search(conn) else None
            else:
                db_key = key
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
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "ユーザー情報の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.put("/users/{user_id}/links")
def admin_user_update_links(
    user_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    """Bulk-replace all links for a user (admin). payload: {"links": [{"url": "..."}]}"""
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    raw_links = payload.get("links") or []
    if not isinstance(raw_links, list):
        return _json_error(400, request_id, "validation_error", "links must be a list.")
    if len(raw_links) > 5:
        return _json_error(400, request_id, "validation_error", "リンクは最大5件までです。")

    conf = _get_conf()
    gallery = conf.get("gallery") or "felixxsv"

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        if not conn.cursor().__class__:
            pass
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s LIMIT 1", (user_id,))
            if not cur.fetchone():
                return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
            cur.execute("DELETE FROM user_links WHERE user_id=%s AND gallery=%s", (user_id, gallery))
            for i, lnk in enumerate(raw_links):
                url = str(lnk.get("url") or "").strip()
                if url:
                    cur.execute(
                        "INSERT INTO user_links (user_id, gallery, url, display_order) VALUES (%s, %s, %s, %s)",
                        (user_id, gallery, url[:500], i),
                    )
        _log_audit_event(conn, int(actor.get("id") or 0) or None, "admin.users.update_links", "user", str(user_id), "success", "リンクを更新しました。", None)
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("SELECT id, url, display_order FROM user_links WHERE user_id=%s AND gallery=%s ORDER BY display_order ASC, id ASC", (user_id, gallery))
            links = list(cur.fetchall() or [])
        return _json_success(request_id=request_id, data={"links": [{"id": r["id"], "url": r["url"]} for r in links]}, message="リンクを更新しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn:
            try: conn.rollback()
            except Exception: pass
        return _json_error(500, request_id, "server_error", "リンクの更新に失敗しました。")
    finally:
        if conn: conn.close()


@router.get("/users/{user_id}/badges")
def admin_user_badges(
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
        badges = _load_user_badges_for_admin(conn, user_id)
        return _json_success(request_id=request_id, data={"badges": badges, "catalog": list_badge_catalog(conn)}, message="バッジ一覧を取得しました。")
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "バッジ情報の取得に失敗しました。")
    finally:
        if conn: conn.close()


@router.post("/users/{user_id}/badges")
def admin_user_grant_badge(
    user_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    badge_key = str(payload.get("badge_key") or "").strip()

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        if badge_key not in set(list_badge_keys(conn)):
            return _json_error(400, request_id, "validation_error", "無効なバッジキーです。")
        if not _detect_table(conn, "user_badges"):
            return _json_error(503, request_id, "not_available", "バッジ機能はまだ有効になっていません。")
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s LIMIT 1", (user_id,))
            if not cur.fetchone():
                return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
            cur.execute(
                "INSERT IGNORE INTO user_badges (user_id, badge_key, granted_by) VALUES (%s, %s, %s)",
                (user_id, badge_key, int(actor.get("id") or 0) or None),
            )
        _log_audit_event(conn, int(actor.get("id") or 0) or None, "admin.users.grant_badge", "user", str(user_id), "success", f"バッジを付与しました: {badge_key}", {"badge_key": badge_key})
        conn.commit()
        badges = _load_user_badges_for_admin(conn, user_id)
        return _json_success(request_id=request_id, data={"badges": badges}, message="バッジを付与しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn:
            try: conn.rollback()
            except Exception: pass
        return _json_error(500, request_id, "server_error", "バッジの付与に失敗しました。")
    finally:
        if conn: conn.close()


@router.delete("/users/{user_id}/badges/{badge_key}")
def admin_user_revoke_badge(
    user_id: int = Path(..., ge=1),
    badge_key: str = Path(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        if not _detect_table(conn, "user_badges"):
            return _json_error(503, request_id, "not_available", "バッジ機能はまだ有効になっていません。")
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_badges WHERE user_id=%s AND badge_key=%s", (user_id, badge_key))
            deleted = cur.rowcount
        if deleted == 0:
            conn.rollback()
            return _json_error(404, request_id, "not_found", "対象バッジが見つかりません。")
        # Also remove from display_badges if present
        if _users_has_display_badges(conn):
            with conn.cursor() as cur:
                cur.execute("SELECT display_badges FROM users WHERE id=%s LIMIT 1", (user_id,))
                row = cur.fetchone()
                if row:
                    raw = row.get("display_badges")
                    if isinstance(raw, str):
                        try: current_display = json.loads(raw)
                        except Exception: current_display = []
                    elif isinstance(raw, list):
                        current_display = raw
                    else:
                        current_display = []
                    if badge_key in current_display:
                        new_display = [k for k in current_display if k != badge_key]
                        cur.execute("UPDATE users SET display_badges=%s WHERE id=%s", (json.dumps(new_display), user_id))
        _log_audit_event(conn, int(actor.get("id") or 0) or None, "admin.users.revoke_badge", "user", str(user_id), "success", f"バッジを剥奪しました: {badge_key}", {"badge_key": badge_key})
        conn.commit()
        badges = _load_user_badges_for_admin(conn, user_id)
        return _json_success(request_id=request_id, data={"badges": badges}, message="バッジを剥奪しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn:
            try: conn.rollback()
            except Exception: pass
        return _json_error(500, request_id, "server_error", "バッジの剥奪に失敗しました。")
    finally:
        if conn: conn.close()


@router.get("/users/{user_id}/support")
def admin_user_support(
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
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s LIMIT 1", (user_id,))
            if not cur.fetchone():
                return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
        support = build_supporter_context(conn, user_id, conf=_get_conf(), include_private=True, include_admin=True)
        return _json_success(request_id=request_id, data={"support": support}, message="支援情報を取得しました。")
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "支援情報の取得に失敗しました。")
    finally:
        if conn: conn.close()


@router.post("/users/{user_id}/support/grants")
def admin_user_grant_support(
    user_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s LIMIT 1", (user_id,))
            if not cur.fetchone():
                return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
        support = grant_supporter_access(conn, user_id, int(actor.get("id") or 0) or None, payload or {})
        _log_audit_event(
            conn,
            int(actor.get("id") or 0) or None,
            "admin.users.grant_support",
            "user",
            str(user_id),
            "success",
            "支援特典を付与しました。",
            {
                "grant_type": payload.get("grant_type") or "months",
                "months": int(payload.get("months") or 0),
                "is_permanent": bool(payload.get("is_permanent")),
                "reason": str(payload.get("reason") or ""),
            },
        )
        conn.commit()
        return _json_success(request_id=request_id, data={"support": support}, message="支援特典を付与しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn:
            try: conn.rollback()
            except Exception: pass
        return _json_error(500, request_id, "server_error", "支援特典の付与に失敗しました。")
    finally:
        if conn: conn.close()


@router.post("/users/{user_id}/support/grants/{grant_id}/revoke")
def admin_user_revoke_support_grant(
    user_id: int = Path(..., ge=1),
    grant_id: int = Path(..., ge=1),
    payload: dict = Body(default={}),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        revoked_user_id, support = revoke_supporter_grant(
            conn,
            grant_id=grant_id,
            actor_user_id=int(actor.get("id") or 0) or None,
            revoke_reason=str((payload or {}).get("revoke_reason") or ""),
        )
        if revoked_user_id is None or revoked_user_id != user_id or support is None:
            return _json_error(404, request_id, "not_found", "対象付与が見つかりません。")
        _log_audit_event(
            conn,
            int(actor.get("id") or 0) or None,
            "admin.users.revoke_support",
            "user",
            str(user_id),
            "success",
            "支援特典を停止しました。",
            {
                "grant_id": grant_id,
                "revoke_reason": str((payload or {}).get("revoke_reason") or ""),
            },
        )
        conn.commit()
        return _json_success(request_id=request_id, data={"support": support}, message="支援特典を停止しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn:
            try: conn.rollback()
            except Exception: pass
        return _json_error(500, request_id, "server_error", "支援特典の停止に失敗しました。")
    finally:
        if conn: conn.close()


@router.post("/users/{user_id}/support/subscription")
def admin_user_upsert_support_subscription(
    user_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s LIMIT 1", (user_id,))
            if not cur.fetchone():
                return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
        support = upsert_supporter_subscription(conn, user_id, payload or {})
        _log_audit_event(
            conn,
            int(actor.get("id") or 0) or None,
            "admin.users.upsert_support_subscription",
            "user",
            str(user_id),
            "success",
            "支援サブスクリプション状態を更新しました。",
            {
                "status": str((payload or {}).get("status") or ""),
                "provider": str((payload or {}).get("provider") or ""),
                "provider_subscription_id": str((payload or {}).get("provider_subscription_id") or ""),
            },
        )
        conn.commit()
        return _json_success(request_id=request_id, data={"support": support}, message="支援サブスクリプション状態を更新しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn:
            try: conn.rollback()
            except Exception: pass
        return _json_error(500, request_id, "server_error", "支援サブスクリプション状態の更新に失敗しました。")
    finally:
        if conn: conn.close()


@router.post("/users/{user_id}/support/events")
def admin_user_record_support_event(
    user_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id=%s LIMIT 1", (user_id,))
            if not cur.fetchone():
                return _json_error(404, request_id, "not_found", "対象ユーザーが見つかりません。")
        event_payload = {
            "provider": str((payload or {}).get("provider") or "stripe").strip() or "stripe",
            "event_type": str((payload or {}).get("event_type") or "").strip(),
            "provider_event_id": str((payload or {}).get("provider_event_id") or "").strip() or None,
            "provider_customer_id": str((payload or {}).get("provider_customer_id") or "").strip() or None,
            "provider_subscription_id": str((payload or {}).get("provider_subscription_id") or "").strip() or None,
            "process_status": str((payload or {}).get("process_status") or "received").strip() or "received",
            "error_summary": str((payload or {}).get("error_summary") or "").strip() or None,
            "related_user_id": user_id,
            "mismatch_flag": bool((payload or {}).get("mismatch_type")),
            "mismatch_type": str((payload or {}).get("mismatch_type") or "").strip() or None,
            "payload": (payload or {}).get("payload") if isinstance((payload or {}).get("payload"), dict) else {},
        }
        event = record_supporter_provider_event(conn, event_payload)
        support = build_supporter_context(conn, user_id, conf=_get_conf(), include_private=True, include_admin=True)
        _log_audit_event(
            conn,
            int(actor.get("id") or 0) or None,
            "admin.users.record_support_event",
            "user",
            str(user_id),
            "success",
            "支援イベントを記録しました。",
            {
                "provider": event_payload["provider"],
                "event_type": event_payload["event_type"],
                "process_status": event_payload["process_status"],
                "mismatch_type": event_payload["mismatch_type"] or "",
            },
        )
        conn.commit()
        return _json_success(request_id=request_id, data={"event": event, "support": support}, message="支援イベントを記録しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn:
            try: conn.rollback()
            except Exception: pass
        return _json_error(500, request_id, "server_error", "支援イベントの記録に失敗しました。")
    finally:
        if conn: conn.close()


@router.get("/badges")
def admin_badge_catalog(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    _, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    return _json_success(request_id=request_id, data={"catalog": list_badge_catalog()}, message="バッジカタログを取得しました。")


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
        logger.exception("Unhandled error")
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
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "ユーザー削除に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


def _images_columns(conn) -> set[str]:
    return _table_columns(conn, "images")


def _image_sources_table(conn) -> str | None:
    return _detect_table(conn, "image_sources")


def _image_stats_table(conn) -> str | None:
    return _detect_table(conn, "image_stats")


def _image_tags_table(conn) -> str | None:
    return _detect_table(conn, "image_tags")


def _tags_table(conn) -> str | None:
    return _detect_table(conn, "tags")


def _image_colors_table(conn) -> str | None:
    return _detect_table(conn, "image_colors")


def _content_palette_items() -> list[dict]:
    items = []
    for color in load_palette_from_conf(_get_conf()):
        hex_value = "#{:02x}{:02x}{:02x}".format(*tuple(int(v) for v in color.rgb))
        items.append({
            "id": int(color.id),
            "name": str(color.name),
            "hex": hex_value,
        })
    items.sort(key=lambda item: int(item["id"]))
    return items


def _content_palette_map() -> dict[int, dict]:
    return {int(item["id"]): item for item in _content_palette_items()}


def _images_visibility_column(conn) -> str | None:
    cols = _images_columns(conn)
    if "is_public" in cols:
        return "is_public"
    return None


def _images_uploader_column(conn) -> str | None:
    cols = _images_columns(conn)
    if "uploader_user_id" in cols:
        return "uploader_user_id"
    if "owner_user_id" in cols:
        return "owner_user_id"
    return None


def _images_uploader_expr(conn) -> str | None:
    cols = _images_columns(conn)
    if "uploader_user_id" in cols and "owner_user_id" in cols:
        return "COALESCE(i.uploader_user_id, i.owner_user_id)"
    col = _images_uploader_column(conn)
    return f"i.{col}" if col else None


def _ensure_admin_content_row(conn, image_id: int) -> None:
    _ensure_admin_content_states_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO admin_content_states (image_id, moderation_status, previous_is_public, updated_by_user_id)
VALUES (%s, 'normal', NULL, NULL)
ON DUPLICATE KEY UPDATE image_id=image_id
""",
            (image_id,),
        )


def _content_preview_url(row: dict) -> str | None:
    return (
        row.get("preview_url")
        or _build_preview_url(row.get("preview_path"))
        or _build_preview_url(row.get("thumb_path_960"))
        or _build_preview_url(row.get("thumb_path_480"))
        or _build_preview_url(row.get("thumb_path"))
    )


def _build_content_list_item(row: dict) -> dict:
    moderation_status = str(row.get("moderation_status") or "normal")
    visibility = bool(row.get("is_public")) if row.get("is_public") is not None else True
    nested_uploader = row.get("uploader") if isinstance(row.get("uploader"), dict) else {}
    return {
        "image_id": int(row.get("image_id")),
        "id": int(row.get("image_id")),
        "title": row.get("title") or "(無題)",
        "alt": row.get("alt") or "",
        "preview_url": _content_preview_url(row),
        "posted_at": _coerce_local_text(row.get("posted_at")),
        "shot_at": _coerce_local_text(row.get("shot_at")),
        "visibility": "public" if visibility else "private",
        "status": moderation_status,
        "like_count": int(row.get("like_count") or 0),
        "view_count": int(row.get("view_count") or 0),
        "like_count_text": _format_count_short(row.get("like_count")),
        "view_count_text": _format_count_short(row.get("view_count")),
        "upload_source": str(row.get("upload_source") or "web"),
        "focal_x": float(row.get("focal_x") if row.get("focal_x") is not None else 50),
        "focal_y": float(row.get("focal_y") if row.get("focal_y") is not None else 50),
        "uploader": {
            "user_id": row.get("uploader_user_id") if row.get("uploader_user_id") is not None else nested_uploader.get("user_id"),
            "display_name": row.get("uploader_display_name") or nested_uploader.get("display_name"),
            "user_key": row.get("uploader_user_key") or nested_uploader.get("user_key"),
            "avatar_url": _build_preview_url(row.get("uploader_avatar_path")) or nested_uploader.get("avatar_url"),
        },
    }


def _content_group_key_expr() -> str:
    return "COALESCE(CONCAT('c-', gci.content_id), CONCAT('i-', i.id))"


def _content_group_status_expr() -> str:
    return """
CASE
    WHEN SUM(CASE WHEN COALESCE(acs.moderation_status, 'normal')='deleted' THEN 1 ELSE 0 END) > 0 THEN 'deleted'
    WHEN SUM(CASE WHEN COALESCE(acs.moderation_status, 'normal')='quarantined' THEN 1 ELSE 0 END) > 0 THEN 'quarantined'
    ELSE 'normal'
END
"""


def _build_content_group_item(row: dict, children: list[dict]) -> dict:
    item = _build_content_list_item(row)
    content_key = str(row.get("content_key") or f"i-{item['image_id']}")
    image_count = int(row.get("image_count") or len(children) or 1)
    item.update(
        {
            "content_id": content_key,
            "content_key": content_key,
            "image_count": image_count,
            "children": children,
            "is_group": image_count > 1,
        }
    )
    return item


def _load_content_page(conn, page: int, per_page: int, q: str | None, visibility: str | None, status: str | None, uploader_user_id: int | None, sort: str | None) -> dict:
    _ensure_admin_content_states_table(conn)

    page = max(1, int(page or 1))
    per_page = max(1, min(100, int(per_page or 20)))
    offset = (page - 1) * per_page

    q_value = str(q or "").strip()
    visibility_value = str(visibility or "").strip().lower() or None
    status_value = str(status or "").strip().lower() or None
    sort_value = str(sort or "posted_desc").strip().lower()

    image_cols = _images_columns(conn)
    visibility_col = _images_visibility_column(conn)
    uploader_expr = _images_uploader_expr(conn)
    avatar_col = _users_avatar_column(conn)
    has_stats = _image_stats_table(conn) is not None
    has_tags = _image_tags_table(conn) is not None and _tags_table(conn) is not None
    has_content_tables = _detect_table(conn, "gallery_contents") is not None and _detect_table(conn, "gallery_content_images") is not None

    where = ["1=1"]
    params: list = []

    if q_value:
        like = f"%{q_value}%"
        q_parts = [
            "COALESCE(i.title, '') LIKE %s",
            "COALESCE(i.alt, '') LIKE %s",
            "COALESCE(gc.title, '') LIKE %s",
            "COALESCE(gc.alt, '') LIKE %s",
        ]
        q_params = [like, like, like, like]
        if has_tags:
            q_parts.append("EXISTS (SELECT 1 FROM image_tags it JOIN tags t ON t.id=it.tag_id WHERE it.image_id=i.id AND t.name LIKE %s)")
            q_params.append(like)
        where.append("(" + " OR ".join(q_parts) + ")")
        params.extend(q_params)

    if visibility_value in {"public", "private"} and visibility_col:
        where.append(f"COALESCE(i.{visibility_col}, 1)=%s")
        params.append(1 if visibility_value == "public" else 0)

    if status_value in {"normal", "quarantined", "deleted"}:
        where.append("COALESCE(acs.moderation_status, 'normal')=%s")
        params.append(status_value)

    if uploader_user_id:
        if uploader_expr:
            where.append(f"{uploader_expr}=%s")
            params.append(int(uploader_user_id))
        else:
            where.append("1=0")

    if sort_value == "posted_asc":
        order_sql = "posted_at ASC, content_key ASC"
    elif sort_value == "likes_desc" and has_stats:
        order_sql = "like_count DESC, content_key DESC"
    elif sort_value == "views_desc" and has_stats:
        order_sql = "view_count DESC, content_key DESC"
    elif sort_value == "title_asc":
        order_sql = "title ASC, content_key ASC"
    else:
        order_sql = "posted_at DESC, content_key DESC"

    where_sql = " AND ".join(where)
    stats_join = "LEFT JOIN image_stats st ON st.image_id=i.id" if has_stats else "LEFT JOIN (SELECT NULL AS image_id, 0 AS like_count, 0 AS view_count) st ON st.image_id=i.id"
    content_join = """
LEFT JOIN gallery_content_images gci ON gci.image_id=i.id
LEFT JOIN gallery_contents gc ON gc.id=gci.content_id AND gc.gallery=i.gallery
""" if has_content_tables else """
LEFT JOIN (SELECT NULL AS image_id, NULL AS content_id, NULL AS is_thumbnail, NULL AS sort_order) gci ON gci.image_id=i.id
LEFT JOIN (SELECT NULL AS id, NULL AS gallery, NULL AS title, NULL AS alt, NULL AS shot_at, NULL AS created_at, NULL AS thumbnail_image_id) gc ON gc.id=gci.content_id
"""
    content_key_expr = _content_group_key_expr()
    status_expr = _content_group_status_expr()

    uploader_join = ""
    uploader_select = "NULL AS uploader_user_id, NULL AS uploader_display_name, NULL AS uploader_user_key, NULL AS uploader_avatar_path"
    if uploader_expr:
        uploader_join = f"LEFT JOIN users u ON u.id={uploader_expr}"
        parts = [f"{uploader_expr} AS uploader_user_id", "u.display_name AS uploader_display_name", "u.user_key AS uploader_user_key"]
        if avatar_col:
            parts.append(f"u.{avatar_col} AS uploader_avatar_path")
        else:
            parts.append("NULL AS uploader_avatar_path")
        uploader_select = ", ".join(parts)

    visibility_expr = f"COALESCE(i.{visibility_col}, 1)" if visibility_col else "1"
    visibility_select = f"{visibility_expr} AS is_public"

    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT COUNT(*) AS c
FROM (
    SELECT {content_key_expr} AS content_key
    FROM images i
    LEFT JOIN admin_content_states acs ON acs.image_id=i.id
    {stats_join}
    {content_join}
    {uploader_join}
    WHERE {where_sql}
    GROUP BY content_key
) grouped
""",
            params,
        )
        total = int((cur.fetchone() or {}).get("c") or 0)

        cur.execute(
            f"""
SELECT
    {content_key_expr} AS content_key,
    COALESCE(gc.thumbnail_image_id, MIN(i.id)) AS thumbnail_image_id,
    COUNT(DISTINCT i.id) AS image_count,
    MAX(COALESCE(NULLIF(gc.title, ''), i.title, i.alt, CONCAT('image-', i.id))) AS title,
    MAX(COALESCE(gc.alt, i.alt, '')) AS alt,
    MAX(COALESCE(gc.shot_at, i.shot_at)) AS shot_at,
    MAX(COALESCE(gc.created_at, i.created_at, i.shot_at)) AS posted_at,
    MIN({visibility_expr}) AS is_public,
    {status_expr} AS moderation_status,
    SUM(COALESCE(st.like_count, 0)) AS like_count,
    SUM(COALESCE(st.view_count, 0)) AS view_count,
    MAX(COALESCE(gc.upload_source, 'web')) AS upload_source
FROM images i
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
{stats_join}
{content_join}
{uploader_join}
WHERE {where_sql}
GROUP BY content_key, gc.thumbnail_image_id
ORDER BY {order_sql}
LIMIT %s OFFSET %s
""",
            [*params, per_page, offset],
        )
        group_rows = cur.fetchall()

    content_keys = [str(row.get("content_key")) for row in group_rows if row.get("content_key")]
    children_by_key: dict[str, list[dict]] = {key: [] for key in content_keys}

    if content_keys:
        placeholders = ",".join(["%s"] * len(content_keys))
        child_order_sql = """
CASE WHEN gc.thumbnail_image_id=i.id THEN 0 ELSE 1 END,
CASE WHEN COALESCE(gci.is_thumbnail, 0)=1 THEN 0 ELSE 1 END,
CASE WHEN gci.sort_order IS NULL THEN 1 ELSE 0 END,
COALESCE(gci.sort_order, 2147483647),
i.id ASC
"""
        with conn.cursor() as cur:
            cur.execute(
                f"""
SELECT
    {content_key_expr} AS content_key,
    i.id AS image_id,
    i.title,
    i.alt,
    i.preview_path,
    i.thumb_path_960,
    i.thumb_path_480,
    {visibility_select},
    COALESCE(acs.moderation_status, 'normal') AS moderation_status,
    COALESCE(i.created_at, i.shot_at) AS posted_at,
    i.shot_at,
    COALESCE(st.like_count, 0) AS like_count,
    COALESCE(st.view_count, 0) AS view_count,
    COALESCE(gc.upload_source, 'web') AS upload_source,
    COALESCE(i.focal_x, 50) AS focal_x,
    COALESCE(i.focal_y, 50) AS focal_y,
    {uploader_select}
FROM images i
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
{stats_join}
{content_join}
{uploader_join}
WHERE {content_key_expr} IN ({placeholders})
ORDER BY content_key ASC, {child_order_sql}
""",
                content_keys,
            )
            child_rows = cur.fetchall()

        for child in child_rows:
            key = str(child.get("content_key") or "")
            if key not in children_by_key:
                continue
            children_by_key[key].append(_build_content_list_item(child))

    rows: list[dict] = []
    for row in group_rows:
        key = str(row.get("content_key") or "")
        children = children_by_key.get(key, [])
        thumbnail_id = row.get("thumbnail_image_id")
        parent_row = None
        if thumbnail_id is not None:
            for child in children:
                if int(child.get("image_id") or 0) == int(thumbnail_id):
                    parent_row = child
                    break
        if parent_row is None and children:
            parent_row = children[0]
        merged = dict(parent_row or {})
        merged.update(row)
        merged["image_id"] = int((parent_row or {}).get("image_id") or row.get("thumbnail_image_id") or 0)
        merged["preview_path"] = (parent_row or {}).get("preview_path")
        merged["thumb_path_960"] = (parent_row or {}).get("thumb_path_960")
        merged["thumb_path_480"] = (parent_row or {}).get("thumb_path_480")
        rows.append(_build_content_group_item(merged, children))

    pages = (total + per_page - 1) // per_page if total > 0 else 1
    return {
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "total": total,
        "items": rows,
    }


def _load_content_tags(conn, image_id: int) -> list[str]:
    if _image_tags_table(conn) is None or _tags_table(conn) is None:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT t.name
FROM image_tags it
JOIN tags t ON t.id=it.tag_id
WHERE it.image_id=%s
ORDER BY t.name ASC
""",
            (image_id,),
        )
        rows = cur.fetchall()
    return [str(row.get("name") or "") for row in rows if str(row.get("name") or "").strip()]


def _load_content_colors(conn, image_id: int) -> list[dict]:
    if _image_colors_table(conn) is None:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT color_id, ratio, rank_no
FROM image_colors
WHERE image_id=%s
ORDER BY rank_no ASC
""",
            (image_id,),
        )
        rows = cur.fetchall()
    palette_map = _content_palette_map()
    colors = []
    for row in rows:
        color_id = row.get("color_id")
        palette_item = palette_map.get(int(color_id)) if color_id is not None else None
        colors.append({
            "color_id": color_id,
            "ratio": float(row.get("ratio") or 0),
            "rank_no": int(row.get("rank_no") or 0),
            "label": (palette_item or {}).get("name") or (f"Color {color_id}" if color_id is not None else "Color"),
        })
    return colors


def _parse_admin_content_tags(value) -> list[str]:
    raw_items = value if isinstance(value, list) else str(value or "").split(",")
    out: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        name = str(item or "").strip()
        if not name:
            continue
        name = name[:80]
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out[:50]


def _parse_admin_content_shot_at(value) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    for fmt in (
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d-%H:%M",
        "%Y/%m/%d %H:%M",
        "%Y/%m/%d-%H:%M:%S",
        "%Y/%m/%d %H:%M:%S",
    ):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _parse_admin_content_posted_at(value) -> datetime | None:
    return _parse_admin_content_shot_at(value)


def _parse_admin_content_color_ids(value) -> list[int]:
    raw_items = value if isinstance(value, list) else str(value or "").split(",")
    if not raw_items:
        return []
    palette_items = _content_palette_items()
    by_id = {int(item["id"]): item for item in palette_items}
    by_name = {str(item["name"]).casefold(): int(item["id"]) for item in palette_items}
    out: list[int] = []
    seen: set[int] = set()
    for raw_item in raw_items:
        text = str(raw_item or "").strip()
        if not text:
            continue
        color_id = None
        if text.isdigit():
            maybe = int(text)
            if maybe in by_id:
                color_id = maybe
        if color_id is None:
            color_id = by_name.get(text.casefold())
        if color_id is None or color_id in seen:
            continue
        seen.add(color_id)
        out.append(color_id)
    return out[:3]


def _load_content_file_meta(conn, image_id: int) -> dict:
    source_table = _image_sources_table(conn)
    if source_table is None:
        return {"file_size_bytes": None, "file_name": None, "source_path": None}
    cols = _table_columns(conn, source_table)
    size_col = "size_bytes" if "size_bytes" in cols else None
    path_col = "source_path" if "source_path" in cols else None
    primary_where = "AND is_primary=1" if "is_primary" in cols else ""
    select_parts = []
    if size_col:
        select_parts.append(f"{size_col} AS file_size_bytes")
    else:
        select_parts.append("NULL AS file_size_bytes")
    if path_col:
        select_parts.append(f"{path_col} AS source_path")
    else:
        select_parts.append("NULL AS source_path")
    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT {', '.join(select_parts)}
FROM `{source_table}`
WHERE image_id=%s
  {primary_where}
ORDER BY id ASC
LIMIT 1
""",
            (image_id,),
        )
        row = cur.fetchone() or {}
    source_path = row.get("source_path")
    file_name = None
    if source_path:
        file_name = str(source_path).split("/")[-1]
    return {
        "file_size_bytes": int(row.get("file_size_bytes") or 0) if row.get("file_size_bytes") is not None else None,
        "file_name": file_name,
        "source_path": source_path,
    }


def _load_content_detail(conn, image_id: int) -> dict | None:
    _ensure_admin_content_states_table(conn)

    image_cols = _images_columns(conn)
    visibility_col = _images_visibility_column(conn)
    uploader_expr = _images_uploader_expr(conn)
    avatar_col = _users_avatar_column(conn)
    has_stats = _image_stats_table(conn) is not None
    has_content_tables = _detect_table(conn, "gallery_contents") is not None and _detect_table(conn, "gallery_content_images") is not None

    stats_join = "LEFT JOIN image_stats st ON st.image_id=i.id" if has_stats else "LEFT JOIN (SELECT NULL AS image_id, 0 AS like_count, 0 AS view_count) st ON st.image_id=i.id"
    content_join = """
LEFT JOIN gallery_content_images gci ON gci.image_id=i.id
LEFT JOIN gallery_contents gc ON gc.id=gci.content_id
""" if has_content_tables else ""
    upload_source_select = "COALESCE(gc.upload_source, 'web') AS upload_source" if has_content_tables else "'web' AS upload_source"

    uploader_join = ""
    uploader_select = "NULL AS uploader_user_id, NULL AS uploader_display_name, NULL AS uploader_user_key, NULL AS uploader_avatar_path"
    if uploader_expr:
        uploader_join = f"LEFT JOIN users u ON u.id={uploader_expr}"
        parts = [f"{uploader_expr} AS uploader_user_id", "u.display_name AS uploader_display_name", "u.user_key AS uploader_user_key"]
        if avatar_col:
            parts.append(f"u.{avatar_col} AS uploader_avatar_path")
        else:
            parts.append("NULL AS uploader_avatar_path")
        uploader_select = ", ".join(parts)

    visibility_select = f"COALESCE(i.{visibility_col}, 1) AS is_public" if visibility_col else "1 AS is_public"
    focal_select = "i.focal_x, i.focal_y" if "focal_x" in _images_columns(conn) else "50 AS focal_x, 50 AS focal_y"

    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT
    i.id AS image_id,
    i.title,
    i.alt,
    i.preview_path,
    i.thumb_path_960,
    i.thumb_path_480,
    i.width AS image_width,
    i.height AS image_height,
    {visibility_select},
    COALESCE(acs.moderation_status, 'normal') AS moderation_status,
    COALESCE(i.created_at, i.shot_at) AS posted_at,
    i.shot_at,
    COALESCE(st.like_count, 0) AS like_count,
    COALESCE(st.view_count, 0) AS view_count,
    {focal_select},
    {upload_source_select},
    {uploader_select}
FROM images i
LEFT JOIN admin_content_states acs ON acs.image_id=i.id
{stats_join}
{content_join}
{uploader_join}
WHERE i.id=%s
LIMIT 1
""",
            (image_id,),
        )
        row = cur.fetchone()

    if not row:
        return None

    file_meta = _load_content_file_meta(conn, image_id)
    return {
        "image_id": int(row.get("image_id")),
        "title": row.get("title") or "(無題)",
        "alt": row.get("alt") or "",
        "preview_url": _content_preview_url(row),
        "original_url": f"/media/original/{int(row.get('image_id'))}",
        "posted_at": _coerce_local_text(row.get("posted_at")),
        "shot_at": _coerce_local_text(row.get("shot_at")),
        "visibility": "public" if bool(row.get("is_public")) else "private",
        "status": str(row.get("moderation_status") or "normal"),
        "upload_source": str(row.get("upload_source") or "web"),
        "focal_x": float(row.get("focal_x") if row.get("focal_x") is not None else 50),
        "focal_y": float(row.get("focal_y") if row.get("focal_y") is not None else 50),
        "image_width": row.get("image_width"),
        "image_height": row.get("image_height"),
        "file_size_bytes": file_meta.get("file_size_bytes"),
        "tags": _load_content_tags(conn, image_id),
        "color_tags": _load_content_colors(conn, image_id),
        "like_count": int(row.get("like_count") or 0),
        "view_count": int(row.get("view_count") or 0),
        "like_count_text": _format_count_short(row.get("like_count")),
        "view_count_text": _format_count_short(row.get("view_count")),
        "uploader": {
            "user_id": row.get("uploader_user_id"),
            "display_name": row.get("uploader_display_name"),
            "user_key": row.get("uploader_user_key"),
            "avatar_url": _build_preview_url(row.get("uploader_avatar_path")),
        },
        "admin_meta": {
            "is_public": bool(row.get("is_public")),
            "file_name": file_meta.get("file_name"),
        },
        "color_palette": _content_palette_items(),
    }


def _update_content_visibility(conn, image_id: int, actor_user_id: int | None, is_public: bool) -> dict | None:
    visibility_col = _images_visibility_column(conn)
    if not visibility_col:
        raise ValueError("visibility_unsupported")

    current = _load_content_detail(conn, image_id)
    if current is None:
        return None

    with conn.cursor() as cur:
        cur.execute(f"UPDATE images SET {visibility_col}=%s WHERE id=%s", (1 if is_public else 0, image_id))
        _ensure_admin_content_row(conn, image_id)
        cur.execute(
            """
UPDATE admin_content_states
SET updated_by_user_id=%s, updated_at=CURRENT_TIMESTAMP(6)
WHERE image_id=%s
""",
            (actor_user_id, image_id),
        )

    _log_audit_event(
        conn,
        actor_user_id=actor_user_id,
        action_type="admin.content.visibility",
        target_type="image",
        target_id=str(image_id),
        result="success",
        summary="コンテンツの公開状態を更新しました。",
        meta_json={"is_public": bool(is_public)},
    )
    return _load_content_detail(conn, image_id)


def _update_content_metadata(conn, image_id: int, actor_user_id: int | None, payload: dict) -> dict | None:
    current = _load_content_detail(conn, image_id)
    if current is None:
        return None

    data = payload or {}
    title = str(data.get("title") or "").strip()
    alt = str(data.get("alt") or "").strip()
    tags = _parse_admin_content_tags(data.get("tags"))
    shot_at = _parse_admin_content_shot_at(data.get("shot_at"))
    posted_at = _parse_admin_content_posted_at(data.get("posted_at"))
    color_ids = _parse_admin_content_color_ids(data.get("color_tags"))

    if not title:
        raise ValueError("title_required")
    if len(title) > 255:
        raise ValueError("title_too_long")
    if shot_at is None:
        raise ValueError("shot_at_invalid")
    if posted_at is None:
        raise ValueError("posted_at_invalid")

    focal_x_raw = data.get("focal_x")
    focal_y_raw = data.get("focal_y")
    focal_x = max(0.0, min(100.0, float(focal_x_raw))) if focal_x_raw is not None else None
    focal_y = max(0.0, min(100.0, float(focal_y_raw))) if focal_y_raw is not None else None

    image_cols = _images_columns(conn)
    update_cols = ["title=%s", "alt=%s", "shot_at=%s", "created_at=%s"]
    params: list = [title, alt, shot_at, posted_at]
    if focal_x is not None and "focal_x" in image_cols:
        update_cols.append("focal_x=%s")
        params.append(focal_x)
    if focal_y is not None and "focal_y" in image_cols:
        update_cols.append("focal_y=%s")
        params.append(focal_y)
    if "updated_at" in image_cols:
        update_cols.append("updated_at=CURRENT_TIMESTAMP(6)")
    params.append(image_id)

    with conn.cursor() as cur:
        cur.execute(f"UPDATE images SET {', '.join(update_cols)} WHERE id=%s", params)

        if _image_tags_table(conn) is not None and _tags_table(conn) is not None:
            cur.execute("DELETE FROM image_tags WHERE image_id=%s", (image_id,))
            if tags:
                cur.execute("SELECT gallery FROM images WHERE id=%s LIMIT 1", (image_id,))
                image_row = cur.fetchone() or {}
                gallery = image_row.get("gallery") or _get_conf().get("gallery") or "default"
                for tag_name in tags:
                    cur.execute(
                        "INSERT INTO tags (gallery, name) VALUES (%s,%s) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
                        (gallery, tag_name),
                    )
                    cur.execute("SELECT LAST_INSERT_ID() AS id")
                    tag_id = int((cur.fetchone() or {}).get("id") or 0)
                    if tag_id:
                        cur.execute("INSERT IGNORE INTO image_tags (image_id, tag_id) VALUES (%s,%s)", (image_id, tag_id))

        if _image_colors_table(conn) is not None:
            cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
            for rank_no, color_id in enumerate(color_ids, start=1):
                cur.execute(
                    "INSERT INTO image_colors (image_id, rank_no, color_id, ratio) VALUES (%s,%s,%s,%s)",
                    (image_id, rank_no, color_id, 1.0 / float(len(color_ids) or 1)),
                )

        if _detect_table(conn, "gallery_contents") is not None and _detect_table(conn, "gallery_content_images") is not None:
            cur.execute(
                """
UPDATE gallery_contents gc
JOIN gallery_content_images gci ON gci.content_id=gc.id
SET gc.title=%s,
    gc.alt=%s,
    gc.shot_at=%s,
    gc.created_at=%s,
    gc.updated_at=CURRENT_TIMESTAMP(6)
WHERE gci.image_id=%s
  AND (gc.thumbnail_image_id=%s OR COALESCE(gci.is_thumbnail, 0)=1 OR gc.image_count <= 1)
""",
                (title, alt, shot_at, posted_at, image_id, image_id),
            )

        _ensure_admin_content_row(conn, image_id)
        cur.execute(
            """
UPDATE admin_content_states
SET updated_by_user_id=%s, updated_at=CURRENT_TIMESTAMP(6)
WHERE image_id=%s
""",
            (actor_user_id, image_id),
        )

    _log_audit_event(
        conn,
        actor_user_id=actor_user_id,
        action_type="admin.content.update",
        target_type="image",
        target_id=str(image_id),
        result="success",
        summary="コンテンツ情報を更新しました。",
        meta_json={"title": title, "tags": tags, "shot_at": shot_at.isoformat(), "posted_at": posted_at.isoformat(), "color_ids": color_ids},
    )
    return _load_content_detail(conn, image_id)


def _set_content_moderation_status(conn, image_id: int, actor_user_id: int | None, moderation_status: str) -> dict | None:
    current = _load_content_detail(conn, image_id)
    if current is None:
        return None

    visibility_col = _images_visibility_column(conn)
    _ensure_admin_content_row(conn, image_id)

    with conn.cursor() as cur:
        if moderation_status == "quarantined":
            prev_visibility = 1 if current.get("visibility") == "public" else 0
            cur.execute(
                """
UPDATE admin_content_states
SET moderation_status='quarantined',
    previous_is_public=%s,
    updated_by_user_id=%s,
    updated_at=CURRENT_TIMESTAMP(6)
WHERE image_id=%s
""",
                (prev_visibility, actor_user_id, image_id),
            )
            if visibility_col:
                cur.execute(f"UPDATE images SET {visibility_col}=0 WHERE id=%s", (image_id,))
            action_type = "admin.content.quarantine"
            summary = "コンテンツを隔離しました。"
        elif moderation_status == "normal":
            cur.execute(
                """
SELECT previous_is_public
FROM admin_content_states
WHERE image_id=%s
LIMIT 1
""",
                (image_id,),
            )
            row = cur.fetchone() or {}
            prev_visibility = row.get("previous_is_public")
            cur.execute(
                """
UPDATE admin_content_states
SET moderation_status='normal',
    previous_is_public=NULL,
    updated_by_user_id=%s,
    updated_at=CURRENT_TIMESTAMP(6)
WHERE image_id=%s
""",
                (actor_user_id, image_id),
            )
            if visibility_col and prev_visibility is not None:
                cur.execute(f"UPDATE images SET {visibility_col}=%s WHERE id=%s", (1 if prev_visibility else 0, image_id))
            action_type = "admin.content.restore"
            summary = "コンテンツを復元しました。"
        else:
            prev_visibility = 1 if current.get("visibility") == "public" else 0
            cur.execute(
                """
UPDATE admin_content_states
SET moderation_status='deleted',
    previous_is_public=%s,
    updated_by_user_id=%s,
    updated_at=CURRENT_TIMESTAMP(6)
WHERE image_id=%s
""",
                (prev_visibility, actor_user_id, image_id),
            )
            if visibility_col:
                cur.execute(f"UPDATE images SET {visibility_col}=0 WHERE id=%s", (image_id,))
            action_type = "admin.content.delete"
            summary = "コンテンツを管理画面から非表示にしました。"

    _log_audit_event(
        conn,
        actor_user_id=actor_user_id,
        action_type=action_type,
        target_type="image",
        target_id=str(image_id),
        result="success",
        summary=summary,
        meta_json={"status": moderation_status},
    )
    return _load_content_detail(conn, image_id)


@router.get("/content")
def admin_content_list(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    visibility: str | None = Query(default=None),
    status: str | None = Query(default=None),
    uploader_user_id: int | None = Query(default=None),
    sort: str | None = Query(default="posted_desc"),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        data = _load_content_page(
            conn,
            page=page,
            per_page=per_page,
            q=q,
            visibility=visibility,
            status=status,
            uploader_user_id=uploader_user_id,
            sort=sort,
        )
        return _json_success(request_id=request_id, data=data, message="コンテンツ一覧を取得しました。")
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "コンテンツ一覧の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/content/{image_id}")
def admin_content_detail(
    image_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        data = _load_content_detail(conn, image_id)
        if data is None:
            return _json_error(404, request_id, "not_found", "対象コンテンツが見つかりません。")
        return _json_success(request_id=request_id, data={"content": data}, message="コンテンツ詳細を取得しました。")
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "コンテンツ詳細の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/content/{image_id}")
def admin_content_update(
    image_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        updated = _update_content_metadata(conn, image_id, int(actor.get("id") or 0) or None, payload or {})
        if updated is None:
            return _json_error(404, request_id, "not_found", "対象コンテンツが見つかりません。")
        conn.commit()
        return _json_success(request_id=request_id, data={"content": updated}, message="コンテンツ情報を更新しました。")
    except ValueError as exc:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        code = str(exc)
        messages = {
            "title_required": "タイトルを入力してください。",
            "title_too_long": "タイトルは255文字以内で入力してください。",
            "shot_at_invalid": "撮影日を正しい形式で入力してください。",
            "posted_at_invalid": "投稿日を正しい形式で入力してください。",
        }
        return _json_error(400, request_id, "validation_error", messages.get(code, "入力内容を確認してください。"))
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "コンテンツ情報の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/content/{image_id}/visibility")
def admin_content_visibility_update(
    image_id: int = Path(..., ge=1),
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    if "is_public" not in (payload or {}):
        return _json_error(400, request_id, "validation_error", "is_public の値が必要です。", field_errors={"is_public": {"code": "required", "message": "is_public の値が必要です。"}})

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        updated = _update_content_visibility(conn, image_id, int(actor.get("id") or 0) or None, bool(payload.get("is_public")))
        if updated is None:
            return _json_error(404, request_id, "not_found", "対象コンテンツが見つかりません。")
        conn.commit()
        return _json_success(request_id=request_id, data={"content": updated}, message="公開状態を更新しました。")
    except ValueError:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(409, request_id, "visibility_unsupported", "この環境では公開状態の変更に対応していません。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "公開状態の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.post("/content/{image_id}/quarantine")
def admin_content_quarantine(
    image_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        updated = _set_content_moderation_status(conn, image_id, int(actor.get("id") or 0) or None, "quarantined")
        if updated is None:
            return _json_error(404, request_id, "not_found", "対象コンテンツが見つかりません。")
        conn.commit()
        return _json_success(request_id=request_id, data={"content": updated}, message="コンテンツを隔離しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "コンテンツの隔離に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.post("/content/{image_id}/restore")
def admin_content_restore(
    image_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        updated = _set_content_moderation_status(conn, image_id, int(actor.get("id") or 0) or None, "normal")
        if updated is None:
            return _json_error(404, request_id, "not_found", "対象コンテンツが見つかりません。")
        conn.commit()
        return _json_success(request_id=request_id, data={"content": updated}, message="コンテンツを復元しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "コンテンツの復元に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.post("/content/{image_id}/delete")
def admin_content_delete(
    image_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result.get("data") or {}).get("user") or {}

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        updated = _set_content_moderation_status(conn, image_id, int(actor.get("id") or 0) or None, "deleted")
        if updated is None:
            return _json_error(404, request_id, "not_found", "対象コンテンツが見つかりません。")
        conn.commit()
        return _json_success(request_id=request_id, data={"content": updated}, message="コンテンツを削除状態にしました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "コンテンツの削除に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


def _normalize_ip_value(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        try:
            return str(ipaddress.ip_address(value))
        except Exception:
            try:
                return value.decode("utf-8", errors="ignore")
            except Exception:
                logger.exception("Unhandled error")
                return None
    text = str(value).strip()
    return text or None


def _normalize_meta_json(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, (str, bytes)):
        try:
            text = value.decode("utf-8") if isinstance(value, bytes) else value
            return json.loads(text)
        except Exception:
            logger.exception("Unhandled error")
            return value.decode("utf-8", errors="ignore") if isinstance(value, bytes) else value
    return value




def _resolve_audit_target_label(conn, target_type: str | None, target_id) -> str:
    normalized_type = str(target_type or '').strip()
    if target_id in (None, ''):
        return normalized_type or '-'

    target_id_text = str(target_id).strip()
    if not target_id_text:
        return normalized_type or '-'

    try:
        if normalized_type == 'user':
            with conn.cursor() as cur:
                cur.execute(
                    """
SELECT display_name, user_key
FROM users
WHERE id=%s
LIMIT 1
""",
                    (target_id_text,),
                )
                row = cur.fetchone()
            if row:
                display_name = str(row.get('display_name') or '').strip()
                user_key = str(row.get('user_key') or '').strip()
                if display_name and user_key:
                    return f'ユーザー:{display_name} ({user_key})'
                if display_name:
                    return f'ユーザー:{display_name}'
                if user_key:
                    return f'ユーザー:{user_key}'
            return f'ユーザー:{target_id_text}'

        if normalized_type in {'image', 'content'}:
            with conn.cursor() as cur:
                cur.execute(
                    """
SELECT title
FROM images
WHERE id=%s
LIMIT 1
""",
                    (target_id_text,),
                )
                row = cur.fetchone()
            if row and row.get('title'):
                return f'画像:{row.get("title")}'
            return f'画像:{target_id_text}'
    except Exception:
        pass

    return f'{normalized_type}:{target_id_text}' if normalized_type else target_id_text

def _load_audit_logs_page(
    conn,
    page: int,
    per_page: int,
    date_from: str | None,
    date_to: str | None,
    actor_user_id: int | None,
    action_type: str | None,
    result_value: str | None,
    q: str | None,
) -> dict:
    table = _detect_table(conn, "audit_logs")
    if table is None:
        return {"page": 1, "per_page": per_page, "pages": 1, "total": 0, "items": []}

    page = max(1, int(page or 1))
    per_page = max(1, min(100, int(per_page or 20)))
    offset = (page - 1) * per_page

    q_value = str(q or "").strip()
    action_value = str(action_type or "").strip()
    result_filter = str(result_value or "").strip()
    date_from_value = str(date_from or "").strip()
    date_to_value = str(date_to or "").strip()

    columns = _table_columns(conn, table)
    where = ["1=1"]
    params: list = []

    if date_from_value:
        where.append("a.created_at >= %s")
        params.append(f"{date_from_value} 00:00:00")
    if date_to_value:
        where.append("a.created_at < DATE_ADD(%s, INTERVAL 1 DAY)")
        params.append(date_to_value)
    if actor_user_id:
        where.append("a.actor_user_id = %s")
        params.append(int(actor_user_id))
    if action_value:
        where.append("a.action_type = %s")
        params.append(action_value)
    if result_filter:
        where.append("a.result = %s")
        params.append(result_filter)
    if q_value:
        like = f"%{q_value}%"
        q_parts = [
            "a.action_type LIKE %s",
            "a.target_type LIKE %s",
            "COALESCE(a.summary, '') LIKE %s",
            "COALESCE(u.display_name, '') LIKE %s",
            "COALESCE(u.user_key, '') LIKE %s",
        ]
        q_params = [like, like, like, like, like]
        if "target_id" in columns:
            q_parts.append("COALESCE(a.target_id, '') LIKE %s")
            q_params.append(like)
        if "ip_address" in columns:
            q_parts.append("CAST(COALESCE(a.ip_address, '') AS CHAR) LIKE %s")
            q_params.append(like)
        where.append("(" + " OR ".join(q_parts) + ")")
        params.extend(q_params)

    where_sql = " AND ".join(where)

    select_cols = [
        "a.id",
        "a.created_at",
        "a.action_type",
        "a.target_type",
        "a.result",
        "COALESCE(a.summary, '') AS summary",
        "u.id AS actor_user_id",
        "u.display_name AS actor_display_name",
        "u.user_key AS actor_user_key",
    ]
    if "target_id" in columns:
        select_cols.append("a.target_id")
    else:
        select_cols.append("NULL AS target_id")
    if "ip_address" in columns:
        select_cols.append("a.ip_address")
    else:
        select_cols.append("NULL AS ip_address")
    if "meta_json" in columns:
        select_cols.append("a.meta_json")
    else:
        select_cols.append("NULL AS meta_json")

    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT COUNT(*) AS c
FROM `{table}` a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE {where_sql}
""",
            params,
        )
        total_row = cur.fetchone() or {}
        total = int(total_row.get("c") or 0)

        cur.execute(
            f"""
SELECT {", ".join(select_cols)}
FROM `{table}` a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE {where_sql}
ORDER BY a.created_at DESC, a.id DESC
LIMIT %s OFFSET %s
""",
            [*params, per_page, offset],
        )
        rows = cur.fetchall()

    items = []
    for row in rows:
        target_id = row.get("target_id")
        target_label = _resolve_audit_target_label(conn, row.get("target_type"), target_id)
        items.append(
            {
                "id": int(row.get("id")),
                "created_at": _coerce_utc_text(row.get("created_at")),
                "action_type": row.get("action_type"),
                "target_type": row.get("target_type"),
                "target_id": target_id,
                "target_label": target_label,
                "result": row.get("result"),
                "summary": row.get("summary") or "",
                "ip_address": _normalize_ip_value(row.get("ip_address")),
                "actor": {
                    "user_id": row.get("actor_user_id"),
                    "display_name": row.get("actor_display_name"),
                    "user_key": row.get("actor_user_key"),
                },
                "meta_json": _normalize_meta_json(row.get("meta_json")),
            }
        )

    pages = max(1, (total + per_page - 1) // per_page)
    return {
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "total": total,
        "items": items,
    }


def _load_audit_log_detail(conn, log_id: int) -> dict | None:
    table = _detect_table(conn, "audit_logs")
    if table is None:
        return None
    columns = _table_columns(conn, table)

    select_cols = [
        "a.id",
        "a.created_at",
        "a.action_type",
        "a.target_type",
        "a.result",
        "COALESCE(a.summary, '') AS summary",
        "u.id AS actor_user_id",
        "u.display_name AS actor_display_name",
        "u.user_key AS actor_user_key",
    ]
    if "target_id" in columns:
        select_cols.append("a.target_id")
    else:
        select_cols.append("NULL AS target_id")
    if "ip_address" in columns:
        select_cols.append("a.ip_address")
    else:
        select_cols.append("NULL AS ip_address")
    if "user_agent" in columns:
        select_cols.append("a.user_agent")
    else:
        select_cols.append("NULL AS user_agent")
    if "meta_json" in columns:
        select_cols.append("a.meta_json")
    else:
        select_cols.append("NULL AS meta_json")

    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT {", ".join(select_cols)}
FROM `{table}` a
LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.id=%s
LIMIT 1
""",
            (log_id,),
        )
        row = cur.fetchone()

    if not row:
        return None

    target_id = row.get("target_id")
    target_label = _resolve_audit_target_label(conn, row.get("target_type"), target_id)

    return {
        "id": int(row.get("id")),
        "created_at": _coerce_utc_text(row.get("created_at")),
        "action_type": row.get("action_type"),
        "target_type": row.get("target_type"),
        "target_id": target_id,
        "target_label": target_label,
        "result": row.get("result"),
        "summary": row.get("summary") or "",
        "ip_address": _normalize_ip_value(row.get("ip_address")),
        "user_agent": row.get("user_agent"),
        "meta_json": _normalize_meta_json(row.get("meta_json")),
        "actor": {
            "user_id": row.get("actor_user_id"),
            "display_name": row.get("actor_display_name"),
            "user_key": row.get("actor_user_key"),
        },
    }


def _build_audit_logs_csv(items: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "created_at", "actor_display_name", "actor_user_key", "action_type", "target_type", "target_id", "target_label", "result", "summary", "ip_address"])
    for item in items:
        actor = item.get("actor") or {}
        writer.writerow(
            [
                item.get("id"),
                item.get("created_at"),
                actor.get("display_name"),
                actor.get("user_key"),
                item.get("action_type"),
                item.get("target_type"),
                item.get("target_id"),
                item.get("target_label"),
                item.get("result"),
                item.get("summary"),
                item.get("ip_address"),
            ]
        )
    return buf.getvalue()


@router.get("/audit-logs")
def admin_audit_logs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    actor_user_id: int | None = Query(default=None, ge=1),
    action_type: str | None = Query(default=None),
    result: str | None = Query(default=None),
    q: str | None = Query(default=None),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_audit_logs_page(conn, page, per_page, date_from, date_to, actor_user_id, action_type, result, q)
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "監査ログ一覧の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/audit-logs/{log_id}")
def admin_audit_log_detail(
    log_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection()
        item = _load_audit_log_detail(conn, log_id)
        if item is None:
            return _json_error(404, request_id, "not_found", "監査ログが見つかりません。")
        return _json_success(request_id=request_id, data={"item": item}, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "監査ログ詳細の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/audit-logs/export")
def admin_audit_logs_export(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    actor_user_id: int | None = Query(default=None, ge=1),
    action_type: str | None = Query(default=None),
    result: str | None = Query(default=None),
    q: str | None = Query(default=None),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_audit_logs_page(conn, 1, 1000, date_from, date_to, actor_user_id, action_type, result, q)
        csv_text = _build_audit_logs_csv(payload.get("items") or [])
        filename = f"audit-logs-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.csv"
        return Response(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            },
        )
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "監査ログCSVの出力に失敗しました。")
    finally:
        if conn is not None:
            conn.close()



def _ensure_admin_notifications_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sender_user_id BIGINT UNSIGNED NULL,
    sender_email VARCHAR(255) NULL,
    sender_name VARCHAR(255) NULL,
    channel VARCHAR(50) NOT NULL DEFAULT 'email',
    recipient_scope VARCHAR(50) NOT NULL,
    recipient_summary VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body MEDIUMTEXT NOT NULL,
    success_count INT UNSIGNED NOT NULL DEFAULT 0,
    failure_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    sent_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_admin_notifications_sender_user_id (sender_user_id),
    KEY idx_admin_notifications_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_notification_recipients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    notification_id BIGINT UNSIGNED NOT NULL,
    recipient_user_id BIGINT UNSIGNED NULL,
    recipient_email VARCHAR(255) NULL,
    recipient_label VARCHAR(255) NOT NULL,
    delivery_status VARCHAR(20) NOT NULL,
    error_message TEXT NULL,
    delivered_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_admin_notification_recipients_notification_id (notification_id),
    KEY idx_admin_notification_recipients_recipient_user_id (recipient_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )



def _ensure_admin_mail_drafts_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_mail_drafts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    recipient_scope VARCHAR(50) NOT NULL DEFAULT 'selected',
    recipient_user_ids_json JSON NOT NULL,
    subject VARCHAR(255) NOT NULL DEFAULT '',
    body MEDIUMTEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_mail_drafts_user_id (user_id),
    KEY idx_admin_mail_drafts_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )


def _normalize_draft_scope(value) -> str:
    scope = str(value or "selected").strip().lower()
    return scope if scope in {"selected", "everyone"} else "selected"


def _normalize_draft_recipient_ids(value) -> list[int]:
    if not isinstance(value, list):
        return []
    out: list[int] = []
    for item in value:
        try:
            user_id = int(item)
        except Exception:
            logger.exception("Unhandled error")
            continue
        if user_id > 0 and user_id not in out:
            out.append(user_id)
    return out


def _build_mail_draft_payload(payload: dict | None) -> tuple[dict, dict]:
    data = payload or {}
    field_errors: dict = {}

    scope = _normalize_draft_scope(data.get("recipient_scope"))
    recipient_ids = _normalize_draft_recipient_ids(data.get("recipient_user_ids"))
    subject = str(data.get("subject") or "")
    body = str(data.get("body") or "")

    if len(subject) > 255:
        field_errors["subject"] = {"code": "too_long", "message": "件名が長すぎます。"}

    return {
        "recipient_scope": scope,
        "recipient_user_ids": recipient_ids,
        "subject": subject[:255],
        "body": body,
    }, field_errors


def _mail_draft_is_empty(draft: dict) -> bool:
    return (
        str(draft.get("recipient_scope") or "selected") == "selected"
        and not (draft.get("recipient_user_ids") or [])
        and str(draft.get("subject") or "").strip() == ""
        and str(draft.get("body") or "").strip() == ""
    )


def _resolve_mail_draft_recipients(conn, recipient_ids: list[int]) -> list[dict]:
    if not recipient_ids:
        return []
    placeholders = ",".join(["%s"] * len(recipient_ids))
    email_col = _users_email_column(conn)
    select_cols = ["id", "display_name", "user_key"]
    if email_col:
        select_cols.append(f"{email_col} AS primary_email")
    else:
        select_cols.append("NULL AS primary_email")
    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT {", ".join(select_cols)}
FROM users
WHERE id IN ({placeholders})
ORDER BY display_name ASC, id ASC
""",
            recipient_ids,
        )
        rows = cur.fetchall()
    items = []
    for row in rows:
        items.append(
            {
                "user_id": int(row.get("id")),
                "display_name": row.get("display_name") or "",
                "user_key": row.get("user_key") or "",
                "primary_email": row.get("primary_email") or None,
            }
        )
    return items


def _load_admin_mail_draft(conn, user_id: int) -> dict:
    _ensure_admin_mail_drafts_table(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT recipient_scope, recipient_user_ids_json, subject, body, created_at, updated_at
FROM admin_mail_drafts
WHERE user_id=%s
LIMIT 1
""",
            (user_id,),
        )
        row = cur.fetchone()

    if not row:
        return {
            "recipient_scope": "selected",
            "recipient_user_ids": [],
            "subject": "",
            "body": "",
            "created_at": None,
            "updated_at": None,
            "selected_recipients": [],
            "selected_count": 0,
        }

    recipient_user_ids = row.get("recipient_user_ids_json")
    if isinstance(recipient_user_ids, str):
        try:
            recipient_user_ids = json.loads(recipient_user_ids)
        except Exception:
            logger.exception("Unhandled error")
            recipient_user_ids = []
    recipient_user_ids = _normalize_draft_recipient_ids(recipient_user_ids)
    selected_recipients = _resolve_mail_draft_recipients(conn, recipient_user_ids)

    return {
        "recipient_scope": _normalize_draft_scope(row.get("recipient_scope")),
        "recipient_user_ids": recipient_user_ids,
        "subject": row.get("subject") or "",
        "body": row.get("body") or "",
        "created_at": _coerce_utc_text(row.get("created_at")),
        "updated_at": _coerce_utc_text(row.get("updated_at")),
        "selected_recipients": selected_recipients,
        "selected_count": len(recipient_user_ids),
    }


def _save_admin_mail_draft(conn, user_id: int, draft: dict) -> dict:
    _ensure_admin_mail_drafts_table(conn)

    if _mail_draft_is_empty(draft):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM admin_mail_drafts WHERE user_id=%s", (user_id,))
        return _load_admin_mail_draft(conn, user_id)

    recipient_ids_json = json.dumps(draft.get("recipient_user_ids") or [], ensure_ascii=False)
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO admin_mail_drafts (
    user_id,
    recipient_scope,
    recipient_user_ids_json,
    subject,
    body
)
VALUES (%s, %s, CAST(%s AS JSON), %s, %s)
ON DUPLICATE KEY UPDATE
    recipient_scope=VALUES(recipient_scope),
    recipient_user_ids_json=VALUES(recipient_user_ids_json),
    subject=VALUES(subject),
    body=VALUES(body),
    updated_at=CURRENT_TIMESTAMP(6)
""",
            (
                user_id,
                _normalize_draft_scope(draft.get("recipient_scope")),
                recipient_ids_json,
                str(draft.get("subject") or "")[:255],
                str(draft.get("body") or ""),
            ),
        )
    return _load_admin_mail_draft(conn, user_id)


def _delete_admin_mail_draft(conn, user_id: int) -> None:
    _ensure_admin_mail_drafts_table(conn)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM admin_mail_drafts WHERE user_id=%s", (user_id,))

def _mail_sender_settings() -> dict:
    conf = _get_conf()
    smtp = conf.get("smtp") or {}
    app = conf.get("app") or {}
    base_url = str(
        app.get("base_url")
        or app.get("public_base_url")
        or app.get("site_url")
        or "https://gallery.felixxsv.net"
    ).strip()
    return {
        "host": smtp.get("host") or "127.0.0.1",
        "port": int(smtp.get("port") or 25),
        "use_starttls": bool(smtp.get("use_starttls", False)),
        "from_email": str(smtp.get("from_email") or "noreply@felixxsv.net").strip(),
        "from_name": str(smtp.get("from_name") or "Felixxsv Gallery").strip(),
        "username": smtp.get("username"),
        "password": smtp.get("password"),
        "use_auth": smtp.get("use_auth"),
        "base_url": base_url,
    }


def _mail_sender_payload() -> dict:
    settings = _mail_sender_settings()
    return {
        "from_email": settings.get("from_email") or "noreply@felixxsv.net",
        "from_name": settings.get("from_name") or "Felixxsv Gallery",
    }


def _build_mail_templates_payload(conn) -> list[dict]:
    table = _detect_table(conn, "mail_templates")
    if table is None:
        return []
    cols = _table_columns(conn, table)
    select_cols = ["id"]
    if "template_key" in cols:
        select_cols.append("template_key")
    else:
        select_cols.append("NULL AS template_key")
    if "subject_template" in cols:
        select_cols.append("subject_template")
    else:
        select_cols.append("NULL AS subject_template")
    if "body_template" in cols:
        select_cols.append("body_template")
    else:
        select_cols.append("NULL AS body_template")
    if "is_enabled" in cols:
        select_cols.append("is_enabled")
    else:
        select_cols.append("1 AS is_enabled")
    with conn.cursor() as cur:
        cur.execute(f"SELECT {', '.join(select_cols)} FROM `{table}` ORDER BY id ASC")
        rows = cur.fetchall()
    items = []
    for row in rows:
        items.append({
            "id": int(row.get("id")),
            "template_key": row.get("template_key"),
            "subject_template": row.get("subject_template") or "",
            "body_template": row.get("body_template") or "",
            "is_enabled": bool(row.get("is_enabled")),
        })
    return items


def _build_mail_recipient_item(row: dict) -> dict:
    normalized = _normalize_user_row_runtime(row)
    email = str(normalized.get("primary_email") or "").strip()
    status = str(normalized.get("status") or "active")
    is_disabled = bool(normalized.get("is_disabled")) if normalized.get("is_disabled") is not None else False
    can_receive_mail = bool(email) and status != "deleted" and not is_disabled
    return {
        "user_id": int(normalized.get("id")),
        "display_name": normalized.get("display_name") or "",
        "user_key": normalized.get("user_key") or "",
        "primary_email": email or None,
        "role": normalized.get("role") or "user",
        "status": status,
        "can_receive_mail": can_receive_mail,
    }


def _load_mail_recipients_page(conn, page: int, per_page: int, q: str | None, role: str | None, status: str | None) -> dict:
    page = max(1, int(page or 1))
    per_page = max(1, min(100, int(per_page or 20)))
    offset = (page - 1) * per_page
    email_col = _users_email_column(conn)
    avatar_col = _users_avatar_column(conn)
    upload_col = _users_upload_column(conn)
    where = ["1=1"]
    params: list = []
    q_value = str(q or "").strip()
    if q_value:
        like = f"%{q_value}%"
        if email_col:
            where.append(f"(display_name LIKE %s OR user_key LIKE %s OR COALESCE({email_col}, '') LIKE %s)")
            params.extend([like, like, like])
        else:
            where.append("(display_name LIKE %s OR user_key LIKE %s)")
            params.extend([like, like])
    role_value = str(role or "").strip().lower()
    if role_value in _ALLOWED_ROLES:
        where.append("role=%s")
        params.append(role_value)
    status_value = str(status or "").strip().lower()
    if status_value in _ALLOWED_STATUSES:
        where.append("status=%s")
        params.append(status_value)
    where_sql = " AND ".join(where)
    select_cols = ["id", "user_key", "display_name", "role", "status", "created_at", "updated_at"]
    if email_col:
        select_cols.append(f"{email_col} AS primary_email")
    else:
        select_cols.append("NULL AS primary_email")
    if avatar_col:
        select_cols.append(f"{avatar_col} AS avatar_path")
    else:
        select_cols.append("NULL AS avatar_path")
    if upload_col:
        select_cols.append(f"{upload_col} AS upload_enabled")
    else:
        select_cols.append("1 AS upload_enabled")
    if _users_has_column(conn, "can_upload"):
        select_cols.append("can_upload")
    else:
        select_cols.append("NULL AS can_upload")
    if _users_has_column(conn, "is_disabled"):
        select_cols.append("is_disabled")
    else:
        select_cols.append("NULL AS is_disabled")
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS c FROM users WHERE {where_sql}", params)
        total = int((cur.fetchone() or {}).get("c") or 0)
        cur.execute(
            f"SELECT {', '.join(select_cols)} FROM users WHERE {where_sql} ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
            [*params, per_page, offset],
        )
        rows = cur.fetchall()
    items = [_build_mail_recipient_item(row) for row in rows]
    pages = max(1, (total + per_page - 1) // per_page)
    return {"page": page, "per_page": per_page, "pages": pages, "total": total, "items": items}


def _load_mail_history_page(conn, page: int, per_page: int) -> dict:
    _ensure_admin_notifications_tables(conn)
    page = max(1, int(page or 1))
    per_page = max(1, min(100, int(per_page or 10)))
    offset = (page - 1) * per_page
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM admin_notifications")
        total = int((cur.fetchone() or {}).get("c") or 0)
        cur.execute(
            """
SELECT
    n.id,
    n.sender_user_id,
    n.sender_email,
    n.sender_name,
    n.recipient_scope,
    n.recipient_summary,
    n.subject,
    n.body,
    n.success_count,
    n.failure_count,
    n.created_at,
    n.sent_at,
    u.display_name AS sender_display_name,
    u.user_key AS sender_user_key
FROM admin_notifications n
LEFT JOIN users u ON u.id = n.sender_user_id
ORDER BY COALESCE(n.sent_at, n.created_at) DESC, n.id DESC
LIMIT %s OFFSET %s
""",
            (per_page, offset),
        )
        rows = cur.fetchall()
    items = []
    for row in rows:
        items.append({
            "id": int(row.get("id")),
            "subject": row.get("subject") or "",
            "body": row.get("body") or "",
            "recipient_scope": row.get("recipient_scope") or "selected",
            "recipient_summary": row.get("recipient_summary") or "-",
            "success_count": int(row.get("success_count") or 0),
            "failure_count": int(row.get("failure_count") or 0),
            "created_at": _coerce_utc_text(row.get("created_at")),
            "sent_at": _coerce_utc_text(row.get("sent_at")),
            "sender": {
                "user_id": row.get("sender_user_id"),
                "display_name": row.get("sender_display_name") or row.get("sender_name") or "-",
                "user_key": row.get("sender_user_key") or "",
                "from_email": row.get("sender_email") or "",
                "from_name": row.get("sender_name") or "",
            },
        })
    pages = max(1, (total + per_page - 1) // per_page)
    return {"page": page, "per_page": per_page, "pages": pages, "total": total, "items": items}


def _build_mail_send_payload(payload: dict | None) -> tuple[dict, dict]:
    field_errors: dict = {}
    data = payload or {}
    scope = str(data.get("recipient_scope") or "selected").strip().lower()
    if scope not in {"selected", "everyone"}:
        field_errors["recipient_scope"] = {"code": "invalid", "message": "宛先種別が正しくありません。"}
    raw_ids = data.get("recipient_user_ids") or []
    ids: list[int] = []
    if isinstance(raw_ids, list):
        for value in raw_ids:
            try:
                iv = int(value)
            except Exception:
                logger.exception("Unhandled error")
                continue
            if iv > 0 and iv not in ids:
                ids.append(iv)
    subject = str(data.get("subject") or "").strip()
    body = str(data.get("body") or "")
    if subject == "":
        field_errors["subject"] = {"code": "required", "message": "件名を入力してください。"}
    elif len(subject) > 255:
        field_errors["subject"] = {"code": "too_long", "message": "件名が長すぎます。"}
    if body.strip() == "":
        field_errors["body"] = {"code": "required", "message": "本文を入力してください。"}
    if scope == "selected" and not ids:
        field_errors["recipient_user_ids"] = {"code": "required", "message": "送信先を選択してください。"}
    return {"recipient_scope": scope, "recipient_user_ids": ids, "subject": subject, "body": body}, field_errors


def _load_mail_recipients_by_scope(conn, recipient_scope: str, recipient_user_ids: list[int]) -> list[dict]:
    email_col = _users_email_column(conn)
    avatar_col = _users_avatar_column(conn)
    upload_col = _users_upload_column(conn)
    select_cols = ["id", "user_key", "display_name", "role", "status", "created_at", "updated_at"]
    if email_col:
        select_cols.append(f"{email_col} AS primary_email")
    else:
        select_cols.append("NULL AS primary_email")
    if avatar_col:
        select_cols.append(f"{avatar_col} AS avatar_path")
    else:
        select_cols.append("NULL AS avatar_path")
    if upload_col:
        select_cols.append(f"{upload_col} AS upload_enabled")
    else:
        select_cols.append("1 AS upload_enabled")
    if _users_has_column(conn, "can_upload"):
        select_cols.append("can_upload")
    else:
        select_cols.append("NULL AS can_upload")
    if _users_has_column(conn, "is_disabled"):
        select_cols.append("is_disabled")
    else:
        select_cols.append("NULL AS is_disabled")
    where = ["status <> 'deleted'"]
    params: list = []
    if recipient_scope == "selected":
        if not recipient_user_ids:
            return []
        placeholders = ",".join(["%s"] * len(recipient_user_ids))
        where.append(f"id IN ({placeholders})")
        params.extend(recipient_user_ids)
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT {', '.join(select_cols)} FROM users WHERE {' AND '.join(where)} ORDER BY display_name ASC, id ASC",
            params,
        )
        rows = cur.fetchall()
    return [_build_mail_recipient_item(row) for row in rows]


def _recipient_label(item: dict) -> str:
    display_name = str(item.get("display_name") or "").strip()
    user_key = str(item.get("user_key") or "").strip()
    if display_name and user_key:
        return f"{display_name} ({user_key})"
    return display_name or user_key or f"user:{item.get('user_id')}"


def _recipient_summary(scope: str, recipients: list[dict]) -> str:
    if scope == "everyone":
        return "@everyone"
    if not recipients:
        return "-"
    if len(recipients) == 1:
        return _recipient_label(recipients[0])
    return f"{_recipient_label(recipients[0])} ほか{len(recipients) - 1}名"


def _send_admin_notification(conn, actor_user: dict, payload: dict) -> tuple[dict, dict]:
    _ensure_admin_notifications_tables(conn)
    recipients = _load_mail_recipients_by_scope(conn, payload["recipient_scope"], payload["recipient_user_ids"])
    if payload["recipient_scope"] == "selected" and not recipients:
        raise ValueError("selected_recipients_not_found")

    emailable = [item for item in recipients if item.get("can_receive_mail")]
    if not emailable:
        raise ValueError("no_emailable_recipients")

    sender = _mail_sender_payload()
    actor_id = int(actor_user.get("id") or 0) or None
    summary = _recipient_summary(payload["recipient_scope"], recipients)

    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO admin_notifications (
    sender_user_id,
    sender_email,
    sender_name,
    channel,
    recipient_scope,
    recipient_summary,
    subject,
    body,
    success_count,
    failure_count,
    created_at,
    sent_at
)
VALUES (%s, %s, %s, 'email', %s, %s, %s, %s, 0, 0, CURRENT_TIMESTAMP(6), NULL)
""",
            (
                actor_id,
                sender["from_email"],
                sender.get("from_name") or "",
                payload["recipient_scope"],
                summary,
                payload["subject"],
                payload["body"],
            ),
        )
        notification_id = int(cur.lastrowid)

    smtp_settings = _mail_sender_settings()
    success_count = 0
    failure_count = 0

    for item in recipients:
        label = _recipient_label(item)
        recipient_email = item.get("primary_email")
        delivery_status = "failed"
        error_message = None
        delivered_at = None
        if item.get("can_receive_mail") and recipient_email:
            try:
                message = build_text_message(
                    smtp_settings=smtp_settings,
                    to_email=recipient_email,
                    subject=payload["subject"],
                    body_text=payload["body"],
                )
                send_message(smtp_settings, message)
                delivery_status = "sent"
                delivered_at = _utc_now()
                success_count += 1
            except AuthMailError as exc:
                error_message = f"{exc.code}: {exc.message}"
                failure_count += 1
            except Exception as exc:
                error_message = str(exc)
                failure_count += 1
        else:
            error_message = "recipient_email_not_available"
            failure_count += 1

        with conn.cursor() as cur:
            cur.execute(
                """
INSERT INTO admin_notification_recipients (
    notification_id,
    recipient_user_id,
    recipient_email,
    recipient_label,
    delivery_status,
    error_message,
    delivered_at,
    created_at
)
VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP(6))
""",
                (
                    notification_id,
                    item.get("user_id"),
                    recipient_email,
                    label,
                    delivery_status,
                    error_message,
                    delivered_at,
                ),
            )

    with conn.cursor() as cur:
        cur.execute(
            """
UPDATE admin_notifications
SET success_count=%s,
    failure_count=%s,
    sent_at=CURRENT_TIMESTAMP(6)
WHERE id=%s
""",
            (success_count, failure_count, notification_id),
        )

    _log_audit_event(
        conn,
        actor_id,
        "admin.mail.send",
        "notification",
        str(notification_id),
        "success" if success_count > 0 else "failure",
        f"mail sent to {summary}",
        {
            "notification_id": notification_id,
            "recipient_scope": payload["recipient_scope"],
            "recipient_summary": summary,
            "subject": payload["subject"],
            "body": payload["body"],
            "success_count": success_count,
            "failure_count": failure_count,
        },
    )

    if actor_id is not None:
        _delete_admin_mail_draft(conn, actor_id)

    history = _load_mail_history_page(conn, 1, 1)
    item = (history.get("items") or [{}])[0]
    return item, {"success_count": success_count, "failure_count": failure_count, "recipient_summary": summary}



@router.get("/mail/draft")
def admin_mail_draft(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    conn = None
    try:
        conn = _get_db_connection()
        draft = _load_admin_mail_draft(conn, int(actor.get("id") or 0))
        return _json_success(request_id=request_id, data={"draft": draft}, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "メール下書きの取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.put("/mail/draft")
def admin_mail_draft_save(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}

    normalized, field_errors = _build_mail_draft_payload(payload)
    if field_errors:
        return _json_error(400, request_id, "validation_error", "下書きの保存に失敗しました。", field_errors=field_errors)

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        draft = _save_admin_mail_draft(conn, int(actor.get("id") or 0), normalized)
        conn.commit()
        return _json_success(request_id=request_id, data={"draft": draft}, message="下書きを保存しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "下書きの保存に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/mail/templates")
def admin_mail_templates(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        items = _build_mail_templates_payload(conn)
        return _json_success(
            request_id=request_id,
            data={
                "items": items,
                "sender": _mail_sender_payload(),
            },
            message=None,
        )
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "メール設定の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/mail/recipients")
def admin_mail_recipients(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    q: str | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_mail_recipients_page(conn, page, per_page, q, role, status)
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "宛先一覧の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/mail/history")
def admin_mail_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_mail_history_page(conn, page, per_page)
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "送信履歴の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.post("/mail/send")
def admin_mail_send(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    normalized, field_errors = _build_mail_send_payload(payload)
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力値に誤りがあります。", field_errors=field_errors)
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        try:
            history_item, stats = _send_admin_notification(conn, actor, normalized)
        except ValueError as exc:
            msg = str(exc)
            if msg == "selected_recipients_not_found":
                return _json_error(400, request_id, "validation_error", "選択された送信先が見つかりません。")
            if msg == "no_emailable_recipients":
                return _json_error(400, request_id, "validation_error", "送信可能な宛先がありません。")
            raise
        conn.commit()
        return _json_success(
            request_id=request_id,
            data={
                "item": history_item,
                "sender": _mail_sender_payload(),
                "success_count": stats["success_count"],
                "failure_count": stats["failure_count"],
                "recipient_summary": stats["recipient_summary"],
            },
            message="メールを送信しました。",
        )
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "メール送信に失敗しました。")
    finally:
        if conn is not None:
            conn.close()



def _ensure_admin_site_settings_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_site_settings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    setting_group VARCHAR(50) NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    value_json JSON NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_site_settings_group_key (setting_group, setting_key),
    KEY idx_admin_site_settings_group (setting_group),
    KEY idx_admin_site_settings_updated_by (updated_by_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_site_setting_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    setting_group VARCHAR(50) NOT NULL,
    before_json JSON NOT NULL,
    after_json JSON NOT NULL,
    changed_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_admin_site_setting_history_group (setting_group),
    KEY idx_admin_site_setting_history_changed_by (changed_by_user_id),
    KEY idx_admin_site_setting_history_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )


def _decode_setting_json(value, fallback=None):
    if value is None:
        return fallback
    if isinstance(value, (dict, list, bool, int, float)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            logger.exception("Unhandled error")
            return fallback if fallback is not None else value
    return fallback if fallback is not None else value


def _coerce_bool_setting(value, default=False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return bool(default)


def _coerce_int_setting(value, default=0, min_value=None, max_value=None) -> int:
    try:
        n = int(value)
    except Exception:
        logger.exception("Unhandled error")
        n = int(default)
    if min_value is not None and n < min_value:
        n = min_value
    if max_value is not None and n > max_value:
        n = max_value
    return n


def _coerce_text_setting(value, default="", max_length=None) -> str:
    text = str(value if value is not None else default).strip()
    if max_length is not None:
        text = text[:max_length]
    return text


def _settings_general_defaults() -> dict:
    conf = _get_conf()
    app = conf.get("app") or {}
    return {
        "site_name": _coerce_text_setting(app.get("site_name") or "Felixxsv Gallery", "Felixxsv Gallery", 120),
        "gallery_key": _coerce_text_setting(app.get("gallery") or "vrchat", "vrchat", 64),
        "deleted_user_display_name": _coerce_text_setting(app.get("deleted_user_display_name") or "Deleted User", "Deleted User", 120),
        "default_image_open_behavior": "modal",
        "default_image_backdrop_close": True,
        "default_image_meta_bar_pinned": False,
        "support_ui_enabled": True,
    }


def _settings_security_defaults() -> dict:
    return {
        "password_min_length": 12,
        "password_require_uppercase": True,
        "password_require_lowercase": True,
        "password_require_number": True,
        "login_rate_limit_per_10_min": 10,
        "session_idle_timeout_minutes": 1440,
        "admin_2fa_recommended": True,
    }


def _settings_smtp_defaults_from_conf() -> dict:
    conf = _get_conf()
    smtp = conf.get("smtp") or {}
    return {
        "host": _coerce_text_setting(smtp.get("host") or "127.0.0.1", "127.0.0.1", 255),
        "port": _coerce_int_setting(smtp.get("port") or 25, 25, 1, 65535),
        "use_starttls": _coerce_bool_setting(smtp.get("use_starttls"), False),
        "from_email": _coerce_text_setting(smtp.get("from_email") or "noreply@felixxsv.net", "noreply@felixxsv.net", 255),
        "from_name": _coerce_text_setting(smtp.get("from_name") or "Felixxsv Gallery", "Felixxsv Gallery", 255),
    }


def _settings_storage_defaults() -> dict:
    conf = _get_conf()
    paths = conf.get("paths") or {}
    return {
        "source_root": _coerce_text_setting(paths.get("source_root") or "", "", 500),
        "storage_root": _coerce_text_setting(paths.get("storage_root") or "/data/felixxsv-gallery/www/storage", "/data/felixxsv-gallery/www/storage", 500),
        "original_cache_root": _coerce_text_setting(paths.get("original_cache_root") or "", "", 500),
        "max_upload_files": 20,
        "max_upload_size_mb": 100,
    }


def _settings_integrity_defaults() -> dict:
    return {
        "enabled": True,
        "schedule_type": "daily",
        "run_at_hhmm": "05:00",
        "interval_days": 1,
        "weekly_days": ["mon"],
        "report_retention_days": 30,
    }


_SETTINGS_GROUP_DEFAULT_FACTORIES = {
    "general": _settings_general_defaults,
    "security": _settings_security_defaults,
    "smtp": _settings_smtp_defaults_from_conf,
    "storage": _settings_storage_defaults,
    "integrity": _settings_integrity_defaults,
}


def _settings_group_defaults(group: str) -> dict:
    factory = _SETTINGS_GROUP_DEFAULT_FACTORIES.get(group)
    if not factory:
        return {}
    return dict(factory())


def _load_site_settings_group(conn, group: str) -> dict:
    defaults = _settings_group_defaults(group)
    _ensure_admin_site_settings_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT setting_key, value_json, updated_at, updated_by_user_id
FROM admin_site_settings
WHERE setting_group=%s
ORDER BY setting_key ASC
""",
            (group,),
        )
        rows = cur.fetchall()

    values = dict(defaults)
    updated_at = None
    updated_by_user_id = None
    for row in rows:
        key = str(row.get("setting_key") or "")
        if not key:
            continue
        values[key] = _decode_setting_json(row.get("value_json"), defaults.get(key))
        row_updated_at = row.get("updated_at")
        if updated_at is None or (row_updated_at and row_updated_at > updated_at):
            updated_at = row_updated_at
            updated_by_user_id = row.get("updated_by_user_id")

    return {
        "group": group,
        "scope": "site",
        "settings": values,
        "updated_at": _coerce_utc_text(updated_at),
        "updated_by_user_id": int(updated_by_user_id) if updated_by_user_id else None,
        "defaults": defaults,
    }


def _normalize_settings_group_payload(group: str, payload: dict) -> tuple[dict, dict]:
    data = payload or {}
    field_errors: dict = {}

    if group == "general":
        open_behavior = str(data.get("default_image_open_behavior") or "modal").strip().lower()
        if open_behavior not in {"modal", "new_tab"}:
            field_errors["default_image_open_behavior"] = "invalid"
            open_behavior = "modal"
        normalized = {
            "site_name": _coerce_text_setting(data.get("site_name"), "Felixxsv Gallery", 120),
            "gallery_key": _coerce_text_setting(data.get("gallery_key"), "vrchat", 64),
            "deleted_user_display_name": _coerce_text_setting(data.get("deleted_user_display_name"), "Deleted User", 120),
            "default_image_open_behavior": open_behavior,
            "default_image_backdrop_close": _coerce_bool_setting(data.get("default_image_backdrop_close"), True),
            "default_image_meta_bar_pinned": _coerce_bool_setting(data.get("default_image_meta_bar_pinned"), False),
            "support_ui_enabled": _coerce_bool_setting(data.get("support_ui_enabled"), True),
        }
        if not normalized["site_name"]:
            field_errors["site_name"] = "required"
        if not normalized["gallery_key"]:
            field_errors["gallery_key"] = "required"
        return normalized, field_errors

    if group == "security":
        return {
            "password_min_length": _coerce_int_setting(data.get("password_min_length"), 12, 8, 128),
            "password_require_uppercase": _coerce_bool_setting(data.get("password_require_uppercase"), True),
            "password_require_lowercase": _coerce_bool_setting(data.get("password_require_lowercase"), True),
            "password_require_number": _coerce_bool_setting(data.get("password_require_number"), True),
            "login_rate_limit_per_10_min": _coerce_int_setting(data.get("login_rate_limit_per_10_min"), 10, 1, 1000),
            "session_idle_timeout_minutes": _coerce_int_setting(data.get("session_idle_timeout_minutes"), 1440, 5, 10080),
            "admin_2fa_recommended": _coerce_bool_setting(data.get("admin_2fa_recommended"), True),
        }, field_errors

    if group == "smtp":
        normalized = {
            "host": _coerce_text_setting(data.get("host"), "127.0.0.1", 255),
            "port": _coerce_int_setting(data.get("port"), 25, 1, 65535),
            "use_starttls": _coerce_bool_setting(data.get("use_starttls"), False),
            "from_email": _coerce_text_setting(data.get("from_email"), "noreply@felixxsv.net", 255),
            "from_name": _coerce_text_setting(data.get("from_name"), "Felixxsv Gallery", 255),
        }
        if not normalized["host"]:
            field_errors["host"] = "required"
        if not normalized["from_email"]:
            field_errors["from_email"] = "required"
        return normalized, field_errors

    if group == "storage":
        normalized = {
            "source_root": _coerce_text_setting(data.get("source_root"), "", 500),
            "storage_root": _coerce_text_setting(data.get("storage_root"), "/data/felixxsv-gallery/www/storage", 500),
            "original_cache_root": _coerce_text_setting(data.get("original_cache_root"), "", 500),
            "max_upload_files": _coerce_int_setting(data.get("max_upload_files"), 20, 1, 1000),
            "max_upload_size_mb": _coerce_int_setting(data.get("max_upload_size_mb"), 100, 1, 10240),
        }
        if not normalized["storage_root"]:
            field_errors["storage_root"] = "required"
        return normalized, field_errors


    if group == "integrity":
        schedule_type = str(data.get("schedule_type") or "daily").strip().lower()
        if schedule_type not in {"daily", "every_n_days", "weekly"}:
            field_errors["schedule_type"] = "invalid"
            schedule_type = "daily"
        run_at_hhmm = _coerce_text_setting(data.get("run_at_hhmm"), "05:00", 5)
        if len(run_at_hhmm) != 5 or run_at_hhmm[2] != ":":
            field_errors["run_at_hhmm"] = "invalid"
            run_at_hhmm = "05:00"
        else:
            try:
                hour = int(run_at_hhmm[:2])
                minute = int(run_at_hhmm[3:])
                if hour < 0 or hour > 23 or minute < 0 or minute > 59:
                    raise ValueError("invalid")
            except Exception:
                logger.exception("Unhandled error")
                field_errors["run_at_hhmm"] = "invalid"
                run_at_hhmm = "05:00"
        raw_weekly_days = data.get("weekly_days")
        if isinstance(raw_weekly_days, str):
            weekly_days = [part.strip().lower() for part in raw_weekly_days.split(",") if part.strip()]
        elif isinstance(raw_weekly_days, (list, tuple, set)):
            weekly_days = [str(part).strip().lower() for part in raw_weekly_days if str(part).strip()]
        else:
            weekly_days = []
        valid_weekdays = [day for day in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] if day in weekly_days]
        normalized = {
            "enabled": _coerce_bool_setting(data.get("enabled"), True),
            "schedule_type": schedule_type,
            "run_at_hhmm": run_at_hhmm,
            "interval_days": _coerce_int_setting(data.get("interval_days"), 1, 1, 365),
            "weekly_days": valid_weekdays or ["mon"],
            "report_retention_days": _coerce_int_setting(data.get("report_retention_days"), 30, 1, 3650),
        }
        return normalized, field_errors


    return {}, {"group": "unsupported"}


def _save_site_settings_group(conn, group: str, values: dict, actor_user_id: int) -> dict:
    _ensure_admin_site_settings_tables(conn)
    before_payload = _load_site_settings_group(conn, group)
    before_settings = before_payload.get("settings") or {}

    with conn.cursor() as cur:
        for key, value in values.items():
            value_json = json.dumps(value, ensure_ascii=False)
            cur.execute(
                """
INSERT INTO admin_site_settings (setting_group, setting_key, value_json, updated_by_user_id)
VALUES (%s, %s, CAST(%s AS JSON), %s)
ON DUPLICATE KEY UPDATE
    value_json=CAST(%s AS JSON),
    updated_by_user_id=VALUES(updated_by_user_id),
    updated_at=CURRENT_TIMESTAMP(6)
""",
                (group, key, value_json, actor_user_id, value_json),
            )

    after_payload = _load_site_settings_group(conn, group)
    after_settings = after_payload.get("settings") or {}

    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO admin_site_setting_history (setting_group, before_json, after_json, changed_by_user_id)
VALUES (%s, CAST(%s AS JSON), CAST(%s AS JSON), %s)
""",
            (
                group,
                json.dumps(before_settings, ensure_ascii=False),
                json.dumps(after_settings, ensure_ascii=False),
                actor_user_id,
            ),
        )

    _log_audit_event(
        conn,
        actor_user_id,
        f"admin.settings.{group}.update",
        "site_settings",
        group,
        "success",
        f"{group} 設定を更新しました。",
        meta_json={
            "before": before_settings,
            "after": after_settings,
        },
    )
    return after_payload




def _ensure_integrity_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS integrity_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_uuid CHAR(36) NOT NULL,
    trigger_source ENUM('schedule', 'manual') NOT NULL DEFAULT 'schedule',
    status ENUM('queued', 'running', 'ok', 'warning', 'error', 'failed') NOT NULL DEFAULT 'queued',
    requested_by_user_id BIGINT UNSIGNED NULL,
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    scheduled_for DATETIME(6) NULL,
    started_at DATETIME(6) NULL,
    finished_at DATETIME(6) NULL,
    exit_code TINYINT UNSIGNED NULL,
    summary_json JSON NULL,
    report_path VARCHAR(2048) NULL,
    message TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_integrity_runs_uuid (run_uuid),
    KEY idx_integrity_runs_status (status),
    KEY idx_integrity_runs_trigger_source (trigger_source),
    KEY idx_integrity_runs_scheduled_for (scheduled_for),
    KEY idx_integrity_runs_requested_at (requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS integrity_issues (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_id BIGINT UNSIGNED NOT NULL,
    severity ENUM('warning', 'error') NOT NULL,
    issue_code VARCHAR(64) NOT NULL,
    gallery VARCHAR(64) NULL,
    image_id BIGINT UNSIGNED NULL,
    source_id BIGINT UNSIGNED NULL,
    file_path VARCHAR(2048) NULL,
    derivative_kind VARCHAR(32) NULL,
    detail_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_integrity_issues_run_id (run_id),
    KEY idx_integrity_issues_issue_code (issue_code),
    KEY idx_integrity_issues_image_id (image_id),
    CONSTRAINT fk_integrity_issues_run_id
      FOREIGN KEY (run_id) REFERENCES integrity_runs(id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )


def _decode_json_field(value, fallback=None):
    if value is None:
        return fallback
    if isinstance(value, (dict, list, bool, int, float)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            logger.exception("Unhandled error")
            return fallback if fallback is not None else value
    return fallback if fallback is not None else value


def _serialize_integrity_run(row: dict | None) -> dict | None:
    if not row:
        return None
    summary = _decode_json_field(row.get("summary_json"), {}) or {}
    return {
        "run_id": int(row.get("id")),
        "run_uuid": row.get("run_uuid"),
        "trigger_source": row.get("trigger_source") or "schedule",
        "status": row.get("status") or "queued",
        "requested_by_user_id": int(row.get("requested_by_user_id")) if row.get("requested_by_user_id") else None,
        "requested_at": _coerce_utc_text(row.get("requested_at")),
        "scheduled_for": _coerce_utc_text(row.get("scheduled_for")),
        "started_at": _coerce_utc_text(row.get("started_at")),
        "finished_at": _coerce_utc_text(row.get("finished_at")),
        "exit_code": int(row.get("exit_code")) if row.get("exit_code") is not None else None,
        "message": row.get("message"),
        "report_path": row.get("report_path"),
        "summary": summary,
    }


def _serialize_integrity_issue(row: dict) -> dict:
    detail = _decode_json_field(row.get("detail_json"), {}) or {}
    return {
        "issue_id": int(row.get("id")),
        "run_id": int(row.get("run_id")),
        "severity": row.get("severity") or "warning",
        "issue_code": row.get("issue_code") or "unknown",
        "gallery": row.get("gallery"),
        "image_id": int(row.get("image_id")) if row.get("image_id") is not None else None,
        "source_id": int(row.get("source_id")) if row.get("source_id") is not None else None,
        "file_path": row.get("file_path"),
        "derivative_kind": row.get("derivative_kind"),
        "detail": detail,
        "created_at": _coerce_utc_text(row.get("created_at")),
    }


def _load_integrity_run(conn, run_id: int) -> dict | None:
    _ensure_integrity_tables(conn)
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM integrity_runs WHERE id=%s LIMIT 1", (run_id,))
        row = cur.fetchone()
    return _serialize_integrity_run(row)


def _load_integrity_issues(conn, run_id: int, limit: int | None = None) -> list[dict]:
    _ensure_integrity_tables(conn)
    sql = """
SELECT *
FROM integrity_issues
WHERE run_id=%s
ORDER BY FIELD(severity, 'error', 'warning'), id ASC
"""
    params: list = [run_id]
    if limit is not None:
        sql += " LIMIT %s"
        params.append(int(limit))
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [_serialize_integrity_issue(row) for row in rows]


def _find_pending_integrity_run(conn) -> dict | None:
    _ensure_integrity_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT *
FROM integrity_runs
WHERE status IN ('queued', 'running')
ORDER BY requested_at ASC, id ASC
LIMIT 1
"""
        )
        row = cur.fetchone()
    return _serialize_integrity_run(row)


def _create_integrity_run(conn, trigger_source: str, requested_by_user_id: int | None = None) -> dict:
    _ensure_integrity_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO integrity_runs (
    run_uuid,
    trigger_source,
    status,
    requested_by_user_id,
    requested_at
)
VALUES (%s, %s, 'queued', %s, %s)
""",
            (str(uuid.uuid4()), trigger_source, requested_by_user_id, _utc_now().replace(tzinfo=None)),
        )
        run_id = int(cur.lastrowid)
    return _load_integrity_run(conn, run_id) or {"run_id": run_id}


def _load_integrity_runs_page(conn, page: int, per_page: int) -> dict:
    _ensure_integrity_tables(conn)
    page = max(1, int(page or 1))
    per_page = max(1, min(100, int(per_page or 20)))
    offset = (page - 1) * per_page
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM integrity_runs")
        total = int((cur.fetchone() or {}).get("c") or 0)
        cur.execute(
            """
SELECT *
FROM integrity_runs
ORDER BY COALESCE(finished_at, started_at, requested_at) DESC, id DESC
LIMIT %s OFFSET %s
""",
            (per_page, offset),
        )
        rows = cur.fetchall()
    items = [_serialize_integrity_run(row) for row in rows]
    pages = (total + per_page - 1) // per_page if total > 0 else 1
    return {
        "page": page,
        "per_page": per_page,
        "pages": pages,
        "total": total,
        "items": items,
    }


def _load_integrity_summary(conn) -> dict:
    _ensure_integrity_tables(conn)
    last_run = None
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT *
FROM integrity_runs
ORDER BY COALESCE(finished_at, started_at, requested_at) DESC, id DESC
LIMIT 1
"""
        )
        row = cur.fetchone()
        if row:
            last_run = _serialize_integrity_run(row)

        cur.execute(
            """
SELECT finished_at
FROM integrity_runs
WHERE status IN ('ok', 'warning') AND finished_at IS NOT NULL
ORDER BY finished_at DESC, id DESC
LIMIT 1
"""
        )
        success_row = cur.fetchone() or {}

        cur.execute(
            """
SELECT finished_at
FROM integrity_runs
WHERE status IN ('error', 'failed') AND finished_at IS NOT NULL
ORDER BY finished_at DESC, id DESC
LIMIT 1
"""
        )
        error_row = cur.fetchone() or {}

    pending_run = _find_pending_integrity_run(conn)
    issue_items = _load_integrity_issues(conn, int(last_run["run_id"]), limit=5) if last_run else []
    latest_status = (last_run or {}).get("status") or "never"
    latest_summary = (last_run or {}).get("summary") or {}
    severity_counts = latest_summary.get("severity_counts") or {}
    issue_counts = latest_summary.get("issue_counts") or {}
    return {
        "latest_status": latest_status,
        "last_run": last_run,
        "last_success_at": _coerce_utc_text(success_row.get("finished_at")),
        "last_error_at": _coerce_utc_text(error_row.get("finished_at")),
        "pending_run": pending_run,
        "has_pending": pending_run is not None,
        "severity_counts": {
            "warning": int(severity_counts.get("warning") or 0),
            "error": int(severity_counts.get("error") or 0),
        },
        "issue_counts": issue_counts,
        "issue_items": issue_items,
    }


def _mail_sender_settings(conn=None) -> dict:
    conf = _get_conf()
    smtp_conf = conf.get("smtp") or {}
    app_conf = conf.get("app") or {}
    base_url = str(
        app_conf.get("base_url")
        or app_conf.get("public_base_url")
        or app_conf.get("site_url")
        or "https://gallery.felixxsv.net"
    ).strip()

    effective = _settings_smtp_defaults_from_conf()
    if conn is None:
        close_conn = True
        conn = _get_db_connection()
    else:
        close_conn = False
    try:
        payload = _load_site_settings_group(conn, "smtp")
        settings = payload.get("settings") or {}
        effective.update({
            "host": _coerce_text_setting(settings.get("host"), effective.get("host"), 255),
            "port": _coerce_int_setting(settings.get("port"), effective.get("port") or 25, 1, 65535),
            "use_starttls": _coerce_bool_setting(settings.get("use_starttls"), effective.get("use_starttls")),
            "from_email": _coerce_text_setting(settings.get("from_email"), effective.get("from_email"), 255),
            "from_name": _coerce_text_setting(settings.get("from_name"), effective.get("from_name"), 255),
        })
    except Exception:
        pass
    finally:
        if close_conn and conn is not None:
            conn.close()

    return {
        "host": effective.get("host") or smtp_conf.get("host") or "127.0.0.1",
        "port": int(effective.get("port") or smtp_conf.get("port") or 25),
        "use_starttls": bool(effective.get("use_starttls", smtp_conf.get("use_starttls", False))),
        "from_email": str(effective.get("from_email") or smtp_conf.get("from_email") or "noreply@felixxsv.net").strip(),
        "from_name": str(effective.get("from_name") or smtp_conf.get("from_name") or "Felixxsv Gallery").strip(),
        "username": smtp_conf.get("username"),
        "password": smtp_conf.get("password"),
        "use_auth": smtp_conf.get("use_auth"),
        "base_url": base_url,
    }



@router.get("/settings/integrity")
def admin_settings_integrity(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_site_settings_group(conn, "integrity")
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "整合性チェック設定の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/settings/integrity")
def admin_settings_integrity_update(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    normalized, field_errors = _normalize_settings_group_payload("integrity", payload)
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力値に誤りがあります。", field_errors=field_errors)
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        result = _save_site_settings_group(conn, "integrity", normalized, int(actor.get("id") or 0))
        conn.commit()
        return _json_success(request_id=request_id, data=result, message="整合性チェック設定を更新しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "整合性チェック設定の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/integrity/summary")
def admin_integrity_summary(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        data = _load_integrity_summary(conn)
        return _json_success(request_id=request_id, data=data, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "整合性チェック結果の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.post("/integrity/run")
def admin_integrity_run(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        pending = _find_pending_integrity_run(conn)
        if pending is not None:
            conn.rollback()
            return _json_success(
                request_id=request_id,
                data={
                    "run": pending,
                    "already_pending": True,
                },
                message="既に実行待ちまたは実行中の整合性チェックがあります。",
            )
        run = _create_integrity_run(conn, trigger_source="manual", requested_by_user_id=int(actor.get("id") or 0))
        _log_audit_event(
            conn,
            int(actor.get("id") or 0),
            "admin.integrity.run.request",
            "integrity_run",
            str(run.get("run_id") or ""),
            "success",
            "整合性チェックを手動実行キューへ追加しました。",
            meta_json={"run": run},
        )
        conn.commit()
        return _json_success(
            request_id=request_id,
            data={"run": run, "already_pending": False},
            message="整合性チェックを実行キューへ追加しました。",
        )
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "整合性チェックの手動実行予約に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/integrity/runs")
def admin_integrity_runs(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        data = _load_integrity_runs_page(conn, page, per_page)
        return _json_success(request_id=request_id, data=data, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "整合性チェック履歴の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/integrity/runs/{run_id}")
def admin_integrity_run_detail(
    run_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        run = _load_integrity_run(conn, run_id)
        if run is None:
            return _json_error(404, request_id, "not_found", "指定された整合性チェック実行が見つかりません。")
        return _json_success(request_id=request_id, data={"run": run}, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "整合性チェック実行の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/integrity/runs/{run_id}/issues")
def admin_integrity_run_issues(
    run_id: int = Path(..., ge=1),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        run = _load_integrity_run(conn, run_id)
        if run is None:
            return _json_error(404, request_id, "not_found", "指定された整合性チェック実行が見つかりません。")
        issues = _load_integrity_issues(conn, run_id)
        return _json_success(request_id=request_id, data={"run": run, "issues": issues}, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "整合性チェック問題一覧の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/settings/general")
def admin_settings_general(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_site_settings_group(conn, "general")
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "全般設定の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/settings/general")
def admin_settings_general_update(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    normalized, field_errors = _normalize_settings_group_payload("general", payload)
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力値に誤りがあります。", field_errors=field_errors)
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        result = _save_site_settings_group(conn, "general", normalized, int(actor.get("id") or 0))
        conn.commit()
        return _json_success(request_id=request_id, data=result, message="全般設定を更新しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "全般設定の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/settings/security")
def admin_settings_security(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_site_settings_group(conn, "security")
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "セキュリティ設定の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/settings/security")
def admin_settings_security_update(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    normalized, field_errors = _normalize_settings_group_payload("security", payload)
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力値に誤りがあります。", field_errors=field_errors)
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        result = _save_site_settings_group(conn, "security", normalized, int(actor.get("id") or 0))
        conn.commit()
        return _json_success(request_id=request_id, data=result, message="セキュリティ設定を更新しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "セキュリティ設定の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/settings/smtp")
def admin_settings_smtp(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_site_settings_group(conn, "smtp")
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "SMTP 設定の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/settings/smtp")
def admin_settings_smtp_update(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    normalized, field_errors = _normalize_settings_group_payload("smtp", payload)
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力値に誤りがあります。", field_errors=field_errors)
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        result = _save_site_settings_group(conn, "smtp", normalized, int(actor.get("id") or 0))
        conn.commit()
        return _json_success(request_id=request_id, data=result, message="SMTP 設定を更新しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "SMTP 設定の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/settings/storage")
def admin_settings_storage(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_site_settings_group(conn, "storage")
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "ストレージ設定の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.get("/settings/storage/usage")
def admin_settings_storage_usage(
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    conn = None
    try:
        conn = _get_db_connection()
        payload = _load_storage_usage_payload(conn)
        return _json_success(request_id=request_id, data=payload, message=None)
    except Exception:
        logger.exception("Unhandled error")
        return _json_error(500, request_id, "server_error", "ストレージ使用状況の取得に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


@router.patch("/settings/storage")
def admin_settings_storage_update(
    payload: dict = Body(...),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error
    actor = (result_auth.get("data") or {}).get("user") or {}
    normalized, field_errors = _normalize_settings_group_payload("storage", payload)
    if field_errors:
        return _json_error(400, request_id, "validation_error", "入力値に誤りがあります。", field_errors=field_errors)
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        result = _save_site_settings_group(conn, "storage", normalized, int(actor.get("id") or 0))
        conn.commit()
        return _json_success(request_id=request_id, data=result, message="ストレージ設定を更新しました。")
    except Exception:
        logger.exception("Unhandled error")
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        return _json_error(500, request_id, "server_error", "ストレージ設定の更新に失敗しました。")
    finally:
        if conn is not None:
            conn.close()


# ── Contact inquiries ──────────────────────────────────────────────────────────

@router.get("/contacts")
def admin_contacts_list(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = _get_db_connection(autocommit=True)
    try:
        where_clauses = []
        params = []
        if status in ("open", "done"):
            where_clauses.append("ci.status = %s")
            params.append(status)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        offset = (page - 1) * per_page

        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS total FROM contact_inquiries ci {where_sql}",
                params,
            )
            total = (cur.fetchone() or {}).get("total") or 0

        avatar_col = _users_avatar_column(conn)
        avatar_select = f"u.{avatar_col} AS user_avatar_path" if avatar_col else "NULL AS user_avatar_path"

        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT ci.id, ci.user_id, ci.category, ci.message, ci.status,
                       ci.created_at, ci.updated_at,
                       u.display_name, u.user_key, u.role, {avatar_select}
                FROM contact_inquiries ci
                LEFT JOIN users u ON u.id = ci.user_id
                {where_sql}
                ORDER BY ci.created_at DESC
                LIMIT %s OFFSET %s
                """,
                [*params, per_page, offset],
            )
            rows = cur.fetchall() or []

        items = []
        for row in rows:
            items.append({
                "id": int(row["id"]),
                "user_id": int(row["user_id"]),
                "user_display_name": row.get("display_name") or "",
                "user_key": row.get("user_key") or "",
                "user_role": row.get("role") or "user",
                "user_avatar_url": _build_preview_url(row.get("user_avatar_path")) or None,
                "category": row.get("category") or "",
                "message": row.get("message") or "",
                "status": row.get("status") or "open",
                "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
                "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
            })

        return _json_success(
            request_id=request_id,
            data={
                "items": items,
                "total": int(total),
                "page": page,
                "per_page": per_page,
                "pages": max(1, -(-int(total) // per_page)),
            },
        )
    except Exception:
        logger.exception("Unhandled error in admin_contacts_list")
        return _json_error(500, request_id, "server_error", "お問い合わせ一覧の取得に失敗しました。")
    finally:
        conn.close()


@router.patch("/contacts/{contact_id}/done")
def admin_contacts_done(
    contact_id: int,
    session_token: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = _request_id()
    result_auth, error = _get_admin_profile(session_token, request_id)
    if error is not None:
        return error

    conn = _get_db_connection(autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE contact_inquiries SET status='done' WHERE id=%s AND status='open'",
                (contact_id,),
            )
            affected = cur.rowcount

        if affected == 0:
            return _json_error(404, request_id, "not_found", "対象のお問い合わせが見つかりません。")

        return _json_success(request_id=request_id, data={"id": contact_id, "status": "done"}, message="完了にしました。")
    except Exception:
        logger.exception("Unhandled error in admin_contacts_done")
        return _json_error(500, request_id, "server_error", "更新に失敗しました。")
    finally:
        conn.close()
