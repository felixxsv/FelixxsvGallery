from __future__ import annotations

import uuid

from fastapi import APIRouter, Cookie, Query
from fastapi.responses import JSONResponse

from auth_security import DEFAULT_COOKIE_NAME, build_clear_session_cookie_options
from auth_service import get_current_user_profile


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
