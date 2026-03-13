from __future__ import annotations

import ipaddress
import uuid

from fastapi import APIRouter, Cookie, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from auth_security import (
    DEFAULT_COOKIE_NAME,
    build_clear_session_cookie_options,
    build_session_cookie_max_age,
    build_session_cookie_options,
)
from auth_service import (
    check_user_key_availability,
    complete_discord_registration,
    confirm_email_verification,
    confirm_two_factor_challenge,
    get_discord_registration_status,
    get_password_reset_status,
    get_verify_status,
    handle_discord_callback,
    login_with_email_password,
    logout_by_session_token,
    register_user,
    request_password_reset,
    reset_password,
    send_email_verification_again,
    send_two_factor_challenge_again,
    start_discord_oauth,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    user_key: str
    display_name: str
    email: str
    password: str
    terms_agreed: bool


class VerifyEmailResendRequest(BaseModel):
    verify_ticket: str


class VerifyEmailConfirmRequest(BaseModel):
    verify_ticket: str
    code: str


class TwoFactorResendRequest(BaseModel):
    challenge_token: str


class TwoFactorConfirmRequest(BaseModel):
    challenge_token: str
    code: str
    remember_for_30_days: bool = False


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    reset_token: str
    password: str


class DiscordRegisterRequest(BaseModel):
    registration_token: str
    user_key: str
    display_name: str


def build_request_id() -> str:
    return str(uuid.uuid4())


def build_success_response(
    request_id: str,
    data: dict | None = None,
    next_kind: str = "none",
    next_to: str | None = None,
    message: str = "",
) -> JSONResponse:
    payload = {
        "ok": True,
        "request_id": request_id,
        "data": data or {},
        "next": {
            "kind": next_kind,
            "to": next_to,
        },
        "message": message,
    }
    return JSONResponse(status_code=200, content=payload)


def build_error_response(
    request_id: str,
    error_code: str,
    message: str,
    field_errors: list[dict] | None = None,
    retry_after_sec: int | None = None,
    http_status: int = 400,
) -> JSONResponse:
    payload = {
        "ok": False,
        "request_id": request_id,
        "error": {
            "code": error_code,
            "message": message,
            "field_errors": field_errors or [],
            "retry_after_sec": retry_after_sec,
        },
    }
    return JSONResponse(status_code=http_status, content=payload)


def map_error_code_to_http_status(error_code: str) -> int:
    mapping = {
        "validation_error": 400,
        "invalid_ticket": 400,
        "invalid_challenge": 400,
        "invalid_reset_token": 400,
        "invalid_registration_token": 400,
        "invalid_code": 400,
        "invalid_credentials": 401,
        "account_disabled": 403,
        "account_deleted": 403,
        "user_key_unavailable": 409,
        "email_already_used": 409,
        "ticket_expired": 410,
        "challenge_expired": 410,
        "reset_token_expired": 410,
        "registration_token_expired": 410,
        "account_locked": 423,
        "rate_limited": 429,
        "resend_cooldown": 429,
        "too_many_attempts": 429,
        "server_error": 500,
        "discord_oauth_not_implemented": 501,
    }
    return mapping.get(error_code, 400)


def extract_request_context(request: Request) -> dict:
    client_host = None
    if request.client is not None:
        client_host = request.client.host

    ip_address_bytes = None
    if client_host:
        try:
            ip_address_bytes = ipaddress.ip_address(client_host).packed
        except ValueError:
            ip_address_bytes = None

    user_agent = request.headers.get("user-agent")
    if user_agent is not None:
        user_agent = user_agent.strip() or None

    return {
        "ip_address": ip_address_bytes,
        "user_agent": user_agent,
    }


def apply_session_cookie_if_needed(response, result: dict) -> None:
    session_token = result.get("session_token")
    if not session_token:
        return
    max_age_sec = build_session_cookie_max_age()
    options = build_session_cookie_options(max_age_sec=max_age_sec)
    response.set_cookie(
        key=DEFAULT_COOKIE_NAME,
        value=session_token,
        **options,
    )


def clear_session_cookie(response) -> None:
    options = build_clear_session_cookie_options()
    response.delete_cookie(
        key=DEFAULT_COOKIE_NAME,
        **options,
    )


def _build_response_from_service_result(request_id: str, result: dict):
    if result.get("ok"):
        response = build_success_response(
            request_id=request_id,
            data=result.get("data"),
            next_kind=result.get("next_kind", "none"),
            next_to=result.get("next_to"),
            message=result.get("message", ""),
        )
        apply_session_cookie_if_needed(response, result)
        if result.get("clear_session_cookie"):
            clear_session_cookie(response)
        return response

    response = build_error_response(
        request_id=request_id,
        error_code=result.get("error_code", "server_error"),
        message=result.get("message", "処理に失敗しました。"),
        field_errors=result.get("field_errors"),
        retry_after_sec=result.get("retry_after_sec"),
        http_status=map_error_code_to_http_status(result.get("error_code", "server_error")),
    )
    if result.get("clear_session_cookie"):
        clear_session_cookie(response)
    return response


@router.post("/login")
async def login(
    payload: LoginRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = login_with_email_password(
            email=payload.email,
            password=payload.password,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="ログイン処理に失敗しました。",
            http_status=500,
        )


@router.post("/logout")
async def logout(
    request: Request,
    gallery_session: str | None = Cookie(default=None, alias=DEFAULT_COOKIE_NAME),
):
    request_id = build_request_id()
    try:
        result = logout_by_session_token(session_token=gallery_session)
        return _build_response_from_service_result(request_id, result)
    except Exception:
        response = build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="ログアウト処理に失敗しました。",
            http_status=500,
        )
        clear_session_cookie(response)
        return response


@router.post("/register")
async def register(
    payload: RegisterRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = register_user(
            user_key=payload.user_key,
            display_name=payload.display_name,
            email=payload.email,
            password=payload.password,
            terms_agreed=payload.terms_agreed,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="登録処理に失敗しました。",
            http_status=500,
        )


@router.get("/user-key/availability")
async def user_key_availability(
    user_key: str = Query(...),
):
    request_id = build_request_id()
    try:
        result = check_user_key_availability(user_key=user_key)
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="user_key の確認に失敗しました。",
            http_status=500,
        )


@router.get("/verify/status")
async def verify_status(
    mode: str = Query(...),
    ticket: str | None = Query(default=None),
    challenge: str | None = Query(default=None),
):
    request_id = build_request_id()
    try:
        result = get_verify_status(
            mode=mode,
            ticket=ticket,
            challenge=challenge,
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="確認状態の取得に失敗しました。",
            http_status=500,
        )


@router.post("/verify/email/send")
async def verify_email_send(
    payload: VerifyEmailResendRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = send_email_verification_again(
            verify_ticket=payload.verify_ticket,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="確認コードの再送に失敗しました。",
            http_status=500,
        )


@router.post("/verify/email/confirm")
async def verify_email_confirm(
    payload: VerifyEmailConfirmRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = confirm_email_verification(
            verify_ticket=payload.verify_ticket,
            code=payload.code,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="メール確認に失敗しました。",
            http_status=500,
        )


@router.post("/2fa/challenge/send")
async def two_factor_send(
    payload: TwoFactorResendRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = send_two_factor_challenge_again(
            challenge_token=payload.challenge_token,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="2段階認証コードの再送に失敗しました。",
            http_status=500,
        )


@router.post("/2fa/challenge/verify")
async def two_factor_verify(
    payload: TwoFactorConfirmRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = confirm_two_factor_challenge(
            challenge_token=payload.challenge_token,
            code=payload.code,
            remember_for_30_days=payload.remember_for_30_days,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="2段階認証に失敗しました。",
            http_status=500,
        )


@router.post("/password/forgot")
async def password_forgot(
    payload: ForgotPasswordRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = request_password_reset(
            email=payload.email,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="パスワード再設定受付に失敗しました。",
            http_status=500,
        )


@router.get("/password/reset/status")
async def password_reset_status(
    token: str = Query(...),
):
    request_id = build_request_id()
    try:
        result = get_password_reset_status(reset_token=token)
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="再設定トークンの確認に失敗しました。",
            http_status=500,
        )


@router.post("/password/reset")
async def password_reset(
    payload: ResetPasswordRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = reset_password(
            reset_token=payload.reset_token,
            password=payload.password,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        response = build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="パスワード再設定に失敗しました。",
            http_status=500,
        )
        clear_session_cookie(response)
        return response


@router.post("/discord/start")
async def discord_start():
    request_id = build_request_id()
    try:
        result = start_discord_oauth()
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="Discord OAuth 開始に失敗しました。",
            http_status=500,
        )


@router.get("/discord/callback")
async def discord_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
):
    context = extract_request_context(request)
    try:
        result = handle_discord_callback(
            code=code,
            state=state,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        if result.get("ok") and result.get("next_to"):
            response = RedirectResponse(url=result["next_to"], status_code=302)
            apply_session_cookie_if_needed(response, result)
            if result.get("clear_session_cookie"):
                clear_session_cookie(response)
            return response

        request_id = build_request_id()
        return _build_response_from_service_result(request_id, result)
    except Exception:
        request_id = build_request_id()
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="Discord callback の処理に失敗しました。",
            http_status=500,
        )


@router.get("/register/discord/status")
async def discord_registration_status(
    registration: str = Query(...),
):
    request_id = build_request_id()
    try:
        result = get_discord_registration_status(registration_token=registration)
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="Discord登録情報の取得に失敗しました。",
            http_status=500,
        )


@router.post("/register/discord")
async def discord_register(
    payload: DiscordRegisterRequest,
    request: Request,
):
    request_id = build_request_id()
    context = extract_request_context(request)
    try:
        result = complete_discord_registration(
            registration_token=payload.registration_token,
            user_key=payload.user_key,
            display_name=payload.display_name,
            ip_address=context["ip_address"],
            user_agent=context["user_agent"],
        )
        return _build_response_from_service_result(request_id, result)
    except Exception:
        return build_error_response(
            request_id=request_id,
            error_code="server_error",
            message="Discord登録の完了に失敗しました。",
            http_status=500,
        )