from __future__ import annotations

import json
import os
import shutil
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Cookie, Query
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


def _request_id() -> str:
    return str(uuid.uuid4())


def _json_error(status_code: int, request_id: str, code: str, message: str, clear_session_cookie: bool = False) -> JSONResponse:
    response = JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "request_id": request_id,
            "error": {
                "code": code,
                "message": message,
            },
            "field_errors": {},
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

    select_parts = [
        "u.id AS user_id",
        "u.user_key",
        "u.display_name",
        "u.primary_email",
        "u.avatar_path",
        "MAX(s.last_seen_at) AS last_seen_at",
        "MIN(s.created_at) AS session_started_at",
    ]

    if "revoked_at" in session_cols:
        revoked_where = "AND s.revoked_at IS NULL"
    else:
        revoked_where = ""

    sql = f"""
SELECT {", ".join(select_parts)}
FROM `{session_table}` s
JOIN users u ON u.id=s.user_id
WHERE s.expires_at > %s
  {revoked_where}
  AND s.last_seen_at >= DATE_SUB(%s, INTERVAL 10 MINUTE)
  AND u.status='active'
GROUP BY u.id, u.user_key, u.display_name, u.primary_email, u.avatar_path
ORDER BY MAX(s.last_seen_at) DESC
LIMIT 8
"""
    with conn.cursor() as cur:
        cur.execute(sql, (now_dt, now_dt))
        rows = cur.fetchall()

    items = []
    for row in rows:
        session_started_at = _coerce_utc_datetime(row.get("session_started_at"))
        last_seen_at = _coerce_utc_datetime(row.get("last_seen_at"))
        elapsed = 0
        if session_started_at is not None:
            elapsed = max(0, int((now_dt - session_started_at).total_seconds()))
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
ORDER BY a.created_at DESC
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

    user_join = ""
    if uploader_key:
        user_join = f"LEFT JOIN users u ON u.id=i.{uploader_key}"

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
    {", u.display_name AS user_display_name, u.user_key AS user_user_key, u.avatar_path AS user_avatar_path" if user_join else ""}
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
        "posted_at": _coerce_utc_text(row.get("posted_at")),
        "shot_at": _coerce_utc_text(row.get("shot_at")),
        "like_count": int(row.get("like_count") or 0),
        "like_count_short": _format_count_short(int(row.get("like_count") or 0)),
        "view_count": int(row.get("view_count") or 0),
        "view_count_short": _format_count_short(int(row.get("view_count") or 0)),
        "user": {
            "display_name": row.get("user_display_name"),
            "user_key": row.get("user_user_key"),
            "avatar_url": _build_preview_url(row.get("user_avatar_path")),
        } if "user_display_name" in row else None,
        "admin_meta": {
            "is_public": bool(row.get("is_public")) if row.get("is_public") is not None else True,
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
