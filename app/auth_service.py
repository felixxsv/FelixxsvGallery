from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import urlencode, quote
import hmac as _hmac
import json as _json
import logging
import os
import re
import secrets
import urllib.error as _urllib_error
import urllib.request as _urllib_request
import uuid

logger = logging.getLogger(__name__)

from db import db_conn, load_conf
from auth_mail import AuthMailError, send_password_reset_email, send_two_factor_code_email, send_verification_email
from badge_defs import serialize_badge, _parse_display_badges_py, ensure_auto_badges
from auth_models import (
    clear_password_failed_attempts,
    consume_email_verification,
    consume_password_reset_token,
    consume_two_factor_challenge,
    create_auth_identity,
    create_email_verification,
    create_password_credentials,
    create_password_reset_token,
    create_session,
    create_two_factor_challenge,
    create_two_factor_settings,
    create_user,
    expire_active_email_verifications,
    expire_active_password_reset_tokens,
    expire_active_two_factor_challenges,
    get_active_two_factor_challenge,
    get_identity_by_provider_user_id,
    get_identity_by_user_and_provider,
    get_latest_active_email_verification,
    get_password_credentials_by_user_id,
    get_password_reset_token_by_hash,
    get_session_by_token_hash,
    get_two_factor_settings_by_user_id,
    get_user_by_id,
    get_user_by_primary_email,
    get_user_by_user_key,
    increment_email_verification_attempts,
    increment_two_factor_challenge_attempts,
    mark_user_email_verified,
    revoke_session_by_id,
    revoke_sessions_by_user_id,
    update_session_last_seen,
    update_session_presence,
    update_auth_identity_last_used,
    update_auth_identity_enabled,
    reactivate_auth_identity,
    reassign_auth_identity,
    update_password_failed_attempts,
    update_password_hash,
    update_two_factor_settings,
    update_user_profile,
    update_user_registration_profile,
    set_user_must_reset_password,
    create_audit_log,
    get_user_links,
    count_user_links,
    create_user_link,
    delete_user_link,
    reorder_user_links,
)
from auth_security import (
    AuthSecurityError,
    build_login_locked_until,
    build_refreshed_session_expiry,
    build_session_expiry,
    build_two_factor_remember_until,
    generate_session_id,
    generate_session_token,
    hash_password,
    hash_session_token,
    hash_token_value,
    is_login_locked,
    needs_session_refresh,
    should_lock_login_attempt,
    verify_password,
)
from auth_tokens import (
    AuthTokenError,
    create_challenge_token,
    create_reset_token,
    create_verify_ticket,
    create_registration_token,
    create_email_registration_token,
    parse_challenge_token,
    parse_registration_token,
    parse_email_registration_token,
    parse_reset_token,
    parse_verify_ticket,
)
from auth_validators import (
    AuthValidationError,
    AuthValidationErrors,
    validate_discord_register_input,
    validate_discord_registration_status_query,
    validate_forgot_password_input,
    validate_login_input,
    validate_register_input,
    validate_register_start_input,
    validate_register_complete_input,
    validate_reset_password_input,
    validate_reset_status_query,
    validate_user_key_availability_input,
    validate_verify_2fa_input,
    validate_verify_2fa_resend_input,
    validate_verify_email_input,
    validate_verify_email_resend_input,
    validate_verify_status_query,
    validate_display_name,
    validate_user_key,
)


DEFAULT_VERIFY_CODE_EXPIRES_SEC = 900
DEFAULT_TWO_FACTOR_CODE_EXPIRES_SEC = 300
DEFAULT_RESET_TOKEN_EXPIRES_SEC = 1800
DEFAULT_VERIFY_RESEND_COOLDOWN_SEC = 60
DEFAULT_TWO_FACTOR_RESEND_COOLDOWN_SEC = 60
DEFAULT_VERIFY_MAX_ATTEMPTS = 5
DEFAULT_TWO_FACTOR_MAX_ATTEMPTS = 5
# Fallback used when base_url is not set in gallery.conf [app] or [site] section
DEFAULT_BASE_URL = "https://felixxsv.net"
SUPPORTED_LANGUAGE_CODES = {"ja", "en-us", "de", "fr", "ru", "es", "zh-cn", "ko"}


def build_service_success(
    data: dict | None = None,
    next_kind: str = "none",
    next_to: str | None = None,
    message: str = "",
    session_token: str | None = None,
    clear_session_cookie: bool = False,
) -> dict:
    return {
        "ok": True,
        "data": data or {},
        "next_kind": next_kind,
        "next_to": next_to,
        "message": message,
        "session_token": session_token,
        "clear_session_cookie": clear_session_cookie,
    }


def build_service_error(
    error_code: str,
    message: str,
    field_errors: list[dict] | None = None,
    retry_after_sec: int | None = None,
    clear_session_cookie: bool = False,
) -> dict:
    return {
        "ok": False,
        "error_code": error_code,
        "message": message,
        "field_errors": field_errors or [],
        "retry_after_sec": retry_after_sec,
        "clear_session_cookie": clear_session_cookie,
    }


def convert_validation_error_to_result(exc: Exception) -> dict:
    if isinstance(exc, AuthValidationError):
        return build_service_error(
            error_code="validation_error",
            message="入力内容を確認してください。",
            field_errors=[exc.to_dict()],
        )
    if isinstance(exc, AuthValidationErrors):
        return build_service_error(
            error_code="validation_error",
            message="入力内容を確認してください。",
            field_errors=exc.to_list(),
        )
    return build_service_error(
        error_code="validation_error",
        message="入力内容を確認してください。",
    )


def mask_email_address(email: str | None) -> str | None:
    if email is None:
        return None
    normalized = str(email).strip()
    if normalized == "" or "@" not in normalized:
        return None
    local_part, domain = normalized.split("@", 1)
    if local_part == "":
        return f"***@{domain}"
    if len(local_part) == 1:
        masked_local = f"{local_part}***"
    else:
        masked_local = f"{local_part[0]}***"
    return f"{masked_local}@{domain}"


def normalize_preferred_language(value: str | None) -> str | None:
    raw = str(value or "").strip().lower().replace("_", "-")
    if raw == "":
        return None
    aliases = {
        "ja": "ja",
        "ja-jp": "ja",
        "en": "en-us",
        "en-us": "en-us",
        "en-gb": "en-us",
        "de": "de",
        "de-de": "de",
        "fr": "fr",
        "fr-fr": "fr",
        "ru": "ru",
        "ru-ru": "ru",
        "es": "es",
        "es-es": "es",
        "es-419": "es",
        "zh": "zh-cn",
        "zh-cn": "zh-cn",
        "zh-hans": "zh-cn",
        "zh-sg": "zh-cn",
        "ko": "ko",
        "ko-kr": "ko",
    }
    normalized = aliases.get(raw)
    if normalized is None and "-" in raw:
        normalized = aliases.get(raw.split("-", 1)[0])
    if normalized not in SUPPORTED_LANGUAGE_CODES:
        return None
    return normalized


def build_gallery_url(path: str) -> str:
    conf = _get_conf()
    base_url = _get_base_url(conf)
    base = base_url.rstrip("/")
    suffix = path if path.startswith("/") else f"/{path}"
    return f"{base}{suffix}"


def generate_auth_flow_id() -> str:
    return str(uuid.uuid4())


def log_auth_event(
    conn,
    actor_user_id: int | None,
    action_type: str,
    target_type: str,
    target_id: str | None = None,
    result: str = "success",
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    summary: str | None = None,
    meta_json: dict | None = None,
) -> None:
    try:
        create_audit_log(
            conn=conn,
            actor_user_id=actor_user_id,
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            result=result,
            ip_address=ip_address,
            user_agent=user_agent,
            summary=summary,
            meta_json=meta_json,
        )
    except Exception:
        return


def login_with_email_password(
    email: str | None,
    password: str | None,
    preferred_language: str | None = None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_login_input(email, password)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    resolved_preferred_language = normalize_preferred_language(preferred_language)

    try:
        conn = _get_db_connection(autocommit=False)
        user = get_user_by_primary_email(conn, validated["email"])

        if user is None:
            log_auth_event(
                conn=conn,
                actor_user_id=None,
                action_type="auth.login",
                target_type="user",
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="ログインに失敗しました。",
                meta_json={"reason": "user_not_found", "email": validated["email"]},
            )
            conn.commit()
            return build_service_error(
                error_code="invalid_credentials",
                message="メールアドレスまたはパスワードが正しくありません。",
            )

        credentials = get_password_credentials_by_user_id(conn, user["id"])
        if credentials is None:
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.login",
                target_type="user",
                target_id=str(user["id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="ログインに失敗しました。",
                meta_json={"reason": "password_credentials_not_found"},
            )
            conn.commit()
            return build_service_error(
                error_code="invalid_credentials",
                message="メールアドレスまたはパスワードが正しくありません。",
            )

        status_result = _check_user_login_status(
            user,
            credentials,
            now_dt,
        )
        if status_result is not None:
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.login",
                target_type="user",
                target_id=str(user["id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="ログインに失敗しました。",
                meta_json={"reason": status_result["error_code"]},
            )
            conn.commit()
            return status_result

        matched = verify_password(validated["password"], credentials["password_hash"])
        if not matched:
            new_failed_attempts = int(credentials["failed_attempts"] or 0) + 1
            locked_until = None
            should_lock = should_lock_login_attempt(new_failed_attempts)
            if should_lock:
                locked_until = build_login_locked_until(now=now_dt)
            update_password_failed_attempts(
                conn=conn,
                user_id=user["id"],
                failed_attempts=new_failed_attempts,
                locked_until=locked_until,
            )
            error_code = "account_locked" if should_lock else "invalid_credentials"
            message = "アカウントが一時的にロックされています。" if should_lock else "メールアドレスまたはパスワードが正しくありません。"
            retry_after_sec = _remaining_seconds(locked_until, now_dt) if locked_until is not None else None
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.login",
                target_type="user",
                target_id=str(user["id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="ログインに失敗しました。",
                meta_json={"reason": error_code, "failed_attempts": new_failed_attempts},
            )
            conn.commit()
            return build_service_error(
                error_code=error_code,
                message=message,
                retry_after_sec=retry_after_sec,
            )

        clear_password_failed_attempts(conn, user["id"])

        verify_result = _build_login_verify_result(
            conn=conn,
            user=user,
            ip_address=ip_address,
            user_agent=user_agent,
            now_dt=now_dt,
            preferred_language=resolved_preferred_language,
        )
        if verify_result is not None:
            conn.commit()
            _dispatch_mail_job(verify_result["mail_job"])
            return verify_result["result"]

        if bool(user.get("must_reset_password")):
            reset_result = _build_login_reset_result(
                conn=conn,
                user=user,
                ip_address=ip_address,
                user_agent=user_agent,
                now_dt=now_dt,
                preferred_language=resolved_preferred_language,
            )
            conn.commit()
            _dispatch_mail_job(reset_result["mail_job"])
            return reset_result["result"]

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if _is_two_factor_required(two_factor_settings):
            two_factor_result = _build_login_two_factor_result(
                conn=conn,
                user=user,
                ip_address=ip_address,
                user_agent=user_agent,
                now_dt=now_dt,
                preferred_language=resolved_preferred_language,
            )
            conn.commit()
            _dispatch_mail_job(two_factor_result["mail_job"])
            return two_factor_result["result"]

        session_result = _create_authenticated_session_result(
            conn=conn,
            user=user,
            ip_address=ip_address,
            user_agent=user_agent,
            now_dt=now_dt,
            action_type="auth.login",
            summary="ログインしました。",
        )
        email_identity = get_identity_by_user_and_provider(conn, user["id"], "email_password")
        if email_identity is not None:
            update_auth_identity_last_used(conn, email_identity["id"], now_dt)
        conn.commit()
        return session_result
    except (AuthSecurityError, AuthTokenError) as exc:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message=exc.message,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="認証処理に失敗しました。",
        )
    finally:
        _safe_close(conn)


def logout_by_session_token(
    session_token: str | None,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        return build_service_success(
            message="ログアウトしました。",
            clear_session_cookie=True,
        )

    conn = None
    now_dt = _utc_now(now)

    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)
        if session_row is not None:
            update_session_presence(
                conn=conn,
                session_id=session_row["id"],
                now_dt=now_dt,
                visible=False,
            )
            revoke_session_by_id(conn, session_row["id"], now_dt)
            log_auth_event(
                conn=conn,
                actor_user_id=session_row["user_id"],
                action_type="auth.logout",
                target_type="session",
                target_id=str(session_row["id"]),
                result="success",
                summary="ログアウトしました。",
            )
        conn.commit()
        return build_service_success(
            message="ログアウトしました。",
            clear_session_cookie=True,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="ログアウト処理に失敗しました。",
        )
    finally:
        _safe_close(conn)


def logout_all_sessions_for_user(
    user_id: int,
    actor_user_id: int | None = None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    conn = None
    now_dt = _utc_now(now)

    try:
        conn = _get_db_connection(autocommit=False)
        revoked_count = revoke_sessions_by_user_id(conn, user_id, now_dt)
        log_auth_event(
            conn=conn,
            actor_user_id=actor_user_id or user_id,
            action_type="auth.logout_all",
            target_type="user",
            target_id=str(user_id),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="全端末からログアウトしました。",
            meta_json={"revoked_sessions": revoked_count},
        )
        conn.commit()
        return build_service_success(
            data={"revoked_sessions": revoked_count},
            message="全端末からログアウトしました。",
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="全端末ログアウトに失敗しました。",
        )
    finally:
        _safe_close(conn)

def logout_all_for_current_session(
    session_token: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    conn = None
    now_dt = _utc_now(now)

    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)

        if session_row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        if session_row.get("revoked_at") is not None or _is_expired(session_row["expires_at"], now_dt):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        force_logout_after = user.get("force_logout_after")
        if force_logout_after is not None and _coerce_utc_datetime(session_row["created_at"]) < _coerce_utc_datetime(force_logout_after):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if _is_two_factor_required(two_factor_settings):
            if session_row.get("two_factor_verified_at") is None:
                _safe_rollback(conn)
                return build_service_error(
                    error_code="not_authenticated",
                    message="ログインが必要です。",
                    clear_session_cookie=True,
                )

        update_session_presence(
            conn=conn,
            session_id=session_row["id"],
            now_dt=now_dt,
            visible=False,
        )
        revoked_count = revoke_sessions_by_user_id(conn, user["id"], now_dt)

        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.logout_all",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="全端末からログアウトしました。",
            meta_json={"revoked_sessions": revoked_count},
        )

        conn.commit()
        return build_service_success(
            data={"revoked_sessions": revoked_count},
            message="全端末からログアウトしました。",
            clear_session_cookie=True,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="全端末ログアウトに失敗しました。",
        )
    finally:
        _safe_close(conn)

def check_user_key_availability(
    user_key: str | None,
) -> dict:
    try:
        validated = validate_user_key_availability_input(user_key)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        row = get_user_by_user_key(conn, validated["user_key"])
        available = row is None
        return build_service_success(
            data={
                "user_key": validated["user_key"],
                "available": available,
            },
            message="確認しました。",
        )
    except Exception:
        return build_service_error(
            error_code="server_error",
            message="user_key の確認に失敗しました。",
        )
    finally:
        _safe_close(conn)




def start_registration(
    email: str | None,
    preferred_language: str | None = None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    resolved_language = normalize_preferred_language(preferred_language) or "en-us"
    try:
        validated = validate_register_start_input(email=email)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    verify_code = None
    verify_ticket = None
    response_expires_in_sec = auth_conf["verify_code_expires_sec"]
    response_resend_cooldown_sec = auth_conf["verify_resend_cooldown_sec"]
    response_message = "確認コードを送信しました。"
    should_send_mail = False

    try:
        conn = _get_db_connection(autocommit=False)

        existing_user = get_user_by_primary_email(conn, validated["email"])
        if existing_user is not None:
            existing_identity = get_identity_by_user_and_provider(conn, existing_user["id"], "email_password")
            if existing_identity is not None or bool(existing_user.get("is_email_verified")):
                _safe_rollback(conn)
                return build_service_error(
                    error_code="email_already_used",
                    message="このメールアドレスはすでに使用されています。",
                    field_errors=[
                        {
                            "field": "email",
                            "code": "email_already_used",
                            "message": "このメールアドレスはすでに使用されています。",
                        }
                    ],
                )
            user_id = existing_user["id"]
        else:
            pending_user_key = None
            for _ in range(10):
                candidate = _build_pending_user_key()
                if get_user_by_user_key(conn, candidate) is None:
                    pending_user_key = candidate
                    break
            if pending_user_key is None:
                raise RuntimeError("pending_user_key_generation_failed")

            user_id = create_user(
                conn=conn,
                user_key=pending_user_key,
                display_name="仮登録",
                primary_email=validated["email"],
                password_hash=None,
                role="user",
                status="active",
                upload_enabled=True,
                is_email_verified=False,
                must_reset_password=True,
                avatar_path=None,
            )

        latest = get_latest_active_email_verification(
            conn=conn,
            user_id=user_id,
            purpose="email_signup",
            now=now_dt,
        )
        if latest is not None:
            response_expires_in_sec = _remaining_seconds(latest["expires_at"], now_dt)
            response_resend_cooldown_sec = _remaining_cooldown(
                latest["created_at"],
                auth_conf["verify_resend_cooldown_sec"],
                now_dt,
            )
            verify_ticket = create_verify_ticket(
                user_id=user_id,
                purpose="email_signup",
                email=validated["email"],
                preferred_language=resolved_language,
                expires_in_sec=response_expires_in_sec,
                now=now_dt,
            )
            response_message = "送信済みの確認コードを入力してください。"
            log_auth_event(
                conn=conn,
                actor_user_id=user_id,
                action_type="auth.register.start",
                target_type="user",
                target_id=str(user_id),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="登録開始用の確認コードを再利用しました。",
                meta_json={"reused": True},
            )
            conn.commit()
        else:
            verify_code = _generate_otp_code()
            create_email_verification(
                conn=conn,
                user_id=user_id,
                email=validated["email"],
                code_hash=hash_token_value(verify_code),
                purpose="email_signup",
                expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
            )
            verify_ticket = create_verify_ticket(
                user_id=user_id,
                purpose="email_signup",
                email=validated["email"],
                preferred_language=resolved_language,
                expires_in_sec=auth_conf["verify_code_expires_sec"],
                now=now_dt,
            )
            should_send_mail = True
            log_auth_event(
                conn=conn,
                actor_user_id=user_id,
                action_type="auth.register.start",
                target_type="user",
                target_id=str(user_id),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="登録開始用の確認コードを送信しました。",
                meta_json={"reused": False},
            )
            conn.commit()
    except (AuthSecurityError, AuthTokenError) as exc:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message=exc.message,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="登録開始処理に失敗しました。",
        )
    finally:
        _safe_close(conn)

    if should_send_mail and verify_code is not None:
        _try_send_verification_email(
            to_email=validated["email"],
            code=verify_code,
            purpose="email_signup",
            expires_in_sec=auth_conf["verify_code_expires_sec"],
            display_name=None,
            preferred_language=resolved_language,
        )

    return build_service_success(
        data={
            "verify_ticket": verify_ticket,
            "masked_email": mask_email_address(validated["email"]),
            "expires_in_sec": response_expires_in_sec,
            "resend_cooldown_sec": response_resend_cooldown_sec,
            "sent_now": should_send_mail,
        },
        next_kind="verify_email",
        next_to=_build_register_verify_path(verify_ticket),
        message=response_message,
    )

def register_user(
    user_key: str | None,
    display_name: str | None,
    email: str | None,
    password: str | None,
    terms_agreed,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_register_input(
            user_key=user_key,
            display_name=display_name,
            email=email,
            password=password,
            terms_agreed=terms_agreed,
        )
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    verify_code = _generate_otp_code()
    verify_ticket = None

    try:
        conn = _get_db_connection(autocommit=False)

        if get_user_by_user_key(conn, validated["user_key"]) is not None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="user_key_unavailable",
                message="この user_key はすでに使用されています。",
                field_errors=[
                    {
                        "field": "user_key",
                        "code": "user_key_unavailable",
                        "message": "この user_key はすでに使用されています。",
                    }
                ],
            )

        if get_user_by_primary_email(conn, validated["email"]) is not None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="email_already_used",
                message="このメールアドレスはすでに使用されています。",
                field_errors=[
                    {
                        "field": "email",
                        "code": "email_already_used",
                        "message": "このメールアドレスはすでに使用されています。",
                    }
                ],
            )

        password_hash = hash_password(validated["password"])

        user_id = create_user(
            conn=conn,
            user_key=validated["user_key"],
            display_name=validated["display_name"],
            primary_email=validated["email"],
            password_hash=password_hash,
            role="user",
            status="active",
            upload_enabled=True,
            is_email_verified=False,
            must_reset_password=False,
            avatar_path=None,
        )

        create_auth_identity(
            conn=conn,
            user_id=user_id,
            provider="email_password",
            provider_user_id=None,
            provider_email=validated["email"],
            provider_display_name=validated["display_name"],
            is_enabled=True,
        )

        create_password_credentials(
            conn=conn,
            user_id=user_id,
            password_hash=password_hash,
        )

        create_two_factor_settings(
            conn=conn,
            user_id=user_id,
            method="email",
            is_enabled=False,
            is_required=False,
        )

        create_email_verification(
            conn=conn,
            user_id=user_id,
            email=validated["email"],
            code_hash=hash_token_value(verify_code),
            purpose="signup",
            expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
        )

        verify_ticket = create_verify_ticket(
            user_id=user_id,
            purpose="signup",
            email=validated["email"],
            expires_in_sec=auth_conf["verify_code_expires_sec"],
            now=now_dt,
        )

        log_auth_event(
            conn=conn,
            actor_user_id=user_id,
            action_type="auth.register",
            target_type="user",
            target_id=str(user_id),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="アカウントを登録しました。",
        )

        conn.commit()
    except (AuthSecurityError, AuthTokenError) as exc:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message=exc.message,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="登録処理に失敗しました。",
        )
    finally:
        _safe_close(conn)

    _try_send_verification_email(
        to_email=validated["email"],
        code=verify_code,
        purpose="signup",
        expires_in_sec=auth_conf["verify_code_expires_sec"],
        display_name=validated["display_name"],
    )

    return build_service_success(
        data={
            "verify_ticket": verify_ticket,
            "masked_email": mask_email_address(validated["email"]),
            "expires_in_sec": auth_conf["verify_code_expires_sec"],
            "resend_cooldown_sec": auth_conf["verify_resend_cooldown_sec"],
        },
        next_kind="verify_email",
        next_to=_build_verify_email_path(verify_ticket),
        message="確認コードを送信しました。",
    )


def get_verify_status(
    mode: str | None,
    ticket: str | None = None,
    challenge: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_verify_status_query(mode=mode, ticket=ticket, challenge=challenge)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()

    try:
        conn = _get_db_connection(autocommit=True)

        if validated["mode"] == "email":
            parsed = parse_verify_ticket(validated["ticket"], now=now_dt)
            row = get_latest_active_email_verification(
                conn=conn,
                user_id=parsed["user_id"],
                purpose=parsed["purpose"],
                now=now_dt,
            )
            if row is None:
                return build_service_error(
                    error_code="ticket_expired",
                    message="確認トークンの有効期限が切れています。",
                )
            return build_service_success(
                data={
                    "mode": "email",
                    "purpose": parsed["purpose"],
                    "masked_email": mask_email_address(parsed["email"]),
                    "expires_in_sec": _remaining_seconds(row["expires_at"], now_dt),
                    "resend_cooldown_sec": _remaining_cooldown(row["created_at"], auth_conf["verify_resend_cooldown_sec"], now_dt),
                },
                message="確認状態を取得しました。",
            )

        parsed = parse_challenge_token(validated["challenge"], now=now_dt)
        row = get_active_two_factor_challenge(
            conn=conn,
            user_id=parsed["user_id"],
            purpose="login",
            now=now_dt,
        )
        if row is None:
            return build_service_error(
                error_code="challenge_expired",
                message="2段階認証トークンの有効期限が切れています。",
            )
        return build_service_success(
            data={
                "mode": "2fa",
                "purpose": "login",
                "masked_email": mask_email_address(parsed["email"]),
                "expires_in_sec": _remaining_seconds(row["expires_at"], now_dt),
                "resend_cooldown_sec": _remaining_cooldown(row["created_at"], auth_conf["two_factor_resend_cooldown_sec"], now_dt),
            },
            message="確認状態を取得しました。",
        )
    except AuthTokenError as exc:
        return _token_error_to_result(exc, "ticket")
    except Exception:
        return build_service_error(
            error_code="server_error",
            message="確認状態の取得に失敗しました。",
        )
    finally:
        _safe_close(conn)


def send_email_verification_again(
    verify_ticket: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_verify_email_resend_input(verify_ticket)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    new_verify_code = _generate_otp_code()
    new_verify_ticket = None
    parsed = None

    try:
        parsed = parse_verify_ticket(validated["verify_ticket"], now=now_dt)
        conn = _get_db_connection(autocommit=False)
        latest = get_latest_active_email_verification(
            conn=conn,
            user_id=parsed["user_id"],
            purpose=parsed["purpose"],
            now=now_dt,
        )
        if latest is not None:
            cooldown = _remaining_cooldown(latest["created_at"], auth_conf["verify_resend_cooldown_sec"], now_dt)
            if cooldown > 0:
                _safe_rollback(conn)
                return build_service_error(
                    error_code="resend_cooldown",
                    message="しばらく待ってから再送してください。",
                    retry_after_sec=cooldown,
                )

        expire_active_email_verifications(
            conn=conn,
            user_id=parsed["user_id"],
            purpose=parsed["purpose"],
            now=now_dt,
        )
        create_email_verification(
            conn=conn,
            user_id=parsed["user_id"],
            email=parsed["email"],
            code_hash=hash_token_value(new_verify_code),
            purpose=parsed["purpose"],
            expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
        )
        new_verify_ticket = create_verify_ticket(
            user_id=parsed["user_id"],
            purpose=parsed["purpose"],
            email=parsed["email"],
            preferred_language=parsed.get("preferred_language"),
            expires_in_sec=auth_conf["verify_code_expires_sec"],
            now=now_dt,
        )
        log_auth_event(
            conn=conn,
            actor_user_id=parsed["user_id"],
            action_type="auth.verify_email.resend",
            target_type="user",
            target_id=str(parsed["user_id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="メール確認コードを再送しました。",
        )
        conn.commit()
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "ticket")
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="確認コードの再送に失敗しました。",
        )
    finally:
        _safe_close(conn)

    _try_send_verification_email(
        to_email=parsed["email"],
        code=new_verify_code,
        purpose=parsed["purpose"],
        expires_in_sec=auth_conf["verify_code_expires_sec"],
        preferred_language=parsed.get("preferred_language"),
    )

    next_to = _build_verify_email_path(new_verify_ticket)
    if parsed["purpose"] == "email_signup":
        next_to = _build_register_verify_path(new_verify_ticket)

    return build_service_success(
        data={
            "verify_ticket": new_verify_ticket,
            "masked_email": mask_email_address(parsed["email"]),
            "expires_in_sec": auth_conf["verify_code_expires_sec"],
            "resend_cooldown_sec": auth_conf["verify_resend_cooldown_sec"],
        },
        next_kind="verify_email",
        next_to=next_to,
        message="確認コードを再送しました。",
    )


def confirm_email_verification(
    verify_ticket: str | None,
    code: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_verify_email_input(verify_ticket=verify_ticket, code=code)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    entered_code_hash = hash_token_value(validated["code"])

    try:
        parsed = parse_verify_ticket(validated["verify_ticket"], now=now_dt)
        conn = _get_db_connection(autocommit=False)
        row = get_latest_active_email_verification(
            conn=conn,
            user_id=parsed["user_id"],
            purpose=parsed["purpose"],
            now=now_dt,
        )
        if row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="ticket_expired",
                message="確認トークンの有効期限が切れています。",
            )

        if int(row["attempt_count"] or 0) >= _get_auth_conf()["verify_max_attempts"]:
            _safe_rollback(conn)
            return build_service_error(
                error_code="too_many_attempts",
                message="確認コードの入力回数が上限に達しました。",
            )

        if row["code_hash"] != entered_code_hash:
            increment_email_verification_attempts(conn, row["id"])
            log_auth_event(
                conn=conn,
                actor_user_id=parsed["user_id"],
                action_type="auth.verify_email.confirm",
                target_type="user",
                target_id=str(parsed["user_id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="メール確認に失敗しました。",
                meta_json={"reason": "invalid_code"},
            )
            conn.commit()
            return build_service_error(
                error_code="invalid_code",
                message="確認コードが正しくありません。",
            )

        consume_email_verification(conn, row["id"], now_dt)

        if parsed["purpose"] == "email_signup":
            mark_user_email_verified(conn, parsed["user_id"], True)

            registration_token = create_email_registration_token(
                user_id=parsed["user_id"],
                email=parsed["email"],
                now=now_dt,
            )

            log_auth_event(
                conn=conn,
                actor_user_id=parsed["user_id"],
                action_type="auth.verify_email.confirm",
                target_type="user",
                target_id=str(parsed["user_id"]),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="登録開始メールの確認を完了しました。",
                meta_json={"purpose": "email_signup"},
            )

            conn.commit()
            return build_service_success(
                data={
                    "registration_token": registration_token,
                    "email": parsed["email"],
                    "expires_in_sec": 1800,
                },
                next_kind="complete_profile",
                next_to=_build_register_complete_path(registration_token),
                message="メール認証が完了しました。",
            )

        if parsed["purpose"] == "signup":
            mark_user_email_verified(conn, parsed["user_id"], True)
            user = get_user_by_id(conn, parsed["user_id"])
            result = _create_authenticated_session_result(
                conn=conn,
                user=user,
                ip_address=ip_address,
                user_agent=user_agent,
                now_dt=now_dt,
                action_type="auth.verify_email.confirm",
                summary="メール確認を完了しました。",
                meta_json={"purpose": "signup"},
            )
            conn.commit()
            return result

        if parsed["purpose"] == "email_change":
            update_user_profile(
                conn=conn,
                user_id=parsed["user_id"],
                primary_email=row["email"],
            )
            log_auth_event(
                conn=conn,
                actor_user_id=parsed["user_id"],
                action_type="auth.verify_email.confirm",
                target_type="user",
                target_id=str(parsed["user_id"]),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="メールアドレス変更を確認しました。",
                meta_json={"purpose": "email_change"},
            )
            conn.commit()
            return build_service_success(
                next_kind="redirect",
                next_to="/",
                message="メールアドレスの変更を完了しました。",
            )

        two_factor_settings = get_two_factor_settings_by_user_id(conn, parsed["user_id"])
        if two_factor_settings is None:
            create_two_factor_settings(
                conn=conn,
                user_id=parsed["user_id"],
                method="email",
                is_enabled=True,
                is_required=False,
            )
        else:
            update_two_factor_settings(
                conn=conn,
                user_id=parsed["user_id"],
                is_enabled=True,
                enabled_at=now_dt,
            )
        log_auth_event(
            conn=conn,
            actor_user_id=parsed["user_id"],
            action_type="auth.verify_email.confirm",
            target_type="user",
            target_id=str(parsed["user_id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="2段階認証のメール確認を完了しました。",
            meta_json={"purpose": "2fa_setup"},
        )
        conn.commit()
        return build_service_success(
            next_kind="redirect",
            next_to="/",
            message="2段階認証の設定を完了しました。",
        )
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "ticket")
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="メール確認に失敗しました。",
        )
    finally:
        _safe_close(conn)


def send_two_factor_challenge_again(
    challenge_token: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_verify_2fa_resend_input(challenge_token)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    new_code = _generate_otp_code()
    new_challenge_token = None
    parsed = None

    try:
        parsed = parse_challenge_token(validated["challenge_token"], now=now_dt)
        conn = _get_db_connection(autocommit=False)
        latest = get_active_two_factor_challenge(
            conn=conn,
            user_id=parsed["user_id"],
            purpose="login",
            now=now_dt,
        )
        if latest is not None:
            cooldown = _remaining_cooldown(latest["created_at"], auth_conf["two_factor_resend_cooldown_sec"], now_dt)
            if cooldown > 0:
                _safe_rollback(conn)
                return build_service_error(
                    error_code="resend_cooldown",
                    message="しばらく待ってから再送してください。",
                    retry_after_sec=cooldown,
                )

        expire_active_two_factor_challenges(
            conn=conn,
            user_id=parsed["user_id"],
            purpose="login",
            now=now_dt,
        )
        create_two_factor_challenge(
            conn=conn,
            user_id=parsed["user_id"],
            session_id=None,
            purpose="login",
            code_hash=hash_token_value(new_code),
            expires_at=_shift_seconds(now_dt, auth_conf["two_factor_code_expires_sec"]),
        )
        new_challenge_token = create_challenge_token(
            user_id=parsed["user_id"],
            auth_flow_id=parsed["auth_flow_id"],
            email=parsed["email"],
            preferred_language=parsed.get("preferred_language"),
            expires_in_sec=auth_conf["two_factor_code_expires_sec"],
            now=now_dt,
        )
        log_auth_event(
            conn=conn,
            actor_user_id=parsed["user_id"],
            action_type="auth.2fa.resend",
            target_type="user",
            target_id=str(parsed["user_id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="2段階認証コードを再送しました。",
        )
        conn.commit()
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "challenge")
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="2段階認証コードの再送に失敗しました。",
        )
    finally:
        _safe_close(conn)

    user = _get_user_quick(parsed["user_id"])
    _try_send_two_factor_email(
        to_email=parsed["email"],
        code=new_code,
        expires_in_sec=auth_conf["two_factor_code_expires_sec"],
        display_name=user["display_name"] if user else None,
        preferred_language=parsed.get("preferred_language"),
    )

    return build_service_success(
        data={
            "challenge_token": new_challenge_token,
            "masked_email": mask_email_address(parsed["email"]),
            "expires_in_sec": auth_conf["two_factor_code_expires_sec"],
            "resend_cooldown_sec": auth_conf["two_factor_resend_cooldown_sec"],
        },
        next_kind="verify_2fa",
        next_to=_build_verify_2fa_path(new_challenge_token),
        message="2段階認証コードを再送しました。",
    )


def confirm_two_factor_challenge(
    challenge_token: str | None,
    code: str | None,
    remember_for_30_days=False,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_verify_2fa_input(
            challenge_token=challenge_token,
            code=code,
            remember_for_30_days=remember_for_30_days,
        )
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    entered_code_hash = hash_token_value(validated["code"])

    try:
        parsed = parse_challenge_token(validated["challenge_token"], now=now_dt)
        conn = _get_db_connection(autocommit=False)
        row = get_active_two_factor_challenge(
            conn=conn,
            user_id=parsed["user_id"],
            purpose="login",
            now=now_dt,
        )
        if row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="challenge_expired",
                message="2段階認証トークンの有効期限が切れています。",
            )

        if int(row["attempt_count"] or 0) >= auth_conf["two_factor_max_attempts"]:
            _safe_rollback(conn)
            return build_service_error(
                error_code="too_many_attempts",
                message="認証コードの入力回数が上限に達しました。",
            )

        if row["code_hash"] != entered_code_hash:
            increment_two_factor_challenge_attempts(conn, row["id"])
            log_auth_event(
                conn=conn,
                actor_user_id=parsed["user_id"],
                action_type="auth.2fa.confirm",
                target_type="user",
                target_id=str(parsed["user_id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="2段階認証に失敗しました。",
                meta_json={"reason": "invalid_code"},
            )
            conn.commit()
            return build_service_error(
                error_code="invalid_code",
                message="認証コードが正しくありません。",
            )

        consume_two_factor_challenge(conn, row["id"], now_dt)

        remember_until = None
        if validated["remember_for_30_days"]:
            remember_until = build_two_factor_remember_until(now=now_dt)

        user = get_user_by_id(conn, parsed["user_id"])
        session_token = generate_session_token()
        session_id = generate_session_id()
        create_session(
            conn=conn,
            session_id=session_id,
            user_id=user["id"],
            session_token_hash=hash_session_token(session_token),
            ip_address=ip_address,
            user_agent=user_agent,
            expires_at=build_session_expiry(now=now_dt),
            now_dt=now_dt,
            two_factor_verified_at=now_dt,
            two_factor_remember_until=remember_until,
        )
        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.2fa.confirm",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="2段階認証を完了しました。",
        )
        conn.commit()
        return build_service_success(
            data={},
            next_kind="redirect",
            next_to="/",
            message="ログインしました。",
            session_token=session_token,
        )
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "challenge")
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="2段階認証に失敗しました。",
        )
    finally:
        _safe_close(conn)


def request_password_reset(
    email: str | None,
    preferred_language: str | None = None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_forgot_password_input(email)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    reset_token = None
    user = None

    try:
        conn = _get_db_connection(autocommit=False)
        user = get_user_by_primary_email(conn, validated["email"])

        if user is None:
            log_auth_event(
                conn=conn,
                actor_user_id=None,
                action_type="auth.password_reset.request",
                target_type="user",
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="パスワード再設定受付を処理しました。",
                meta_json={"email": validated["email"], "user_found": False},
            )
            conn.commit()
            return build_service_success(
                message="メールアドレスが登録されていれば、再設定案内を送信しました。",
            )

        expire_active_password_reset_tokens(
            conn=conn,
            user_id=user["id"],
            now=now_dt,
        )

        resolved_language = normalize_preferred_language(preferred_language) or "en-us"
        reset_token = create_reset_token(
            user_id=user["id"],
            email=user["primary_email"],
            preferred_language=resolved_language,
            expires_in_sec=auth_conf["reset_token_expires_sec"],
            now=now_dt,
        )
        create_password_reset_token(
            conn=conn,
            user_id=user["id"],
            token_hash=hash_token_value(reset_token),
            requested_ip=ip_address,
            expires_at=_shift_seconds(now_dt, auth_conf["reset_token_expires_sec"]),
        )
        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.password_reset.request",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="パスワード再設定受付を処理しました。",
        )
        conn.commit()
    except (AuthSecurityError, AuthTokenError) as exc:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message=exc.message,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="パスワード再設定受付に失敗しました。",
        )
    finally:
        _safe_close(conn)

    reset_url = build_gallery_url(f"/auth/reset?token={reset_token}")
    _try_send_password_reset_email(
        to_email=user["primary_email"],
        reset_url=reset_url,
        expires_in_sec=auth_conf["reset_token_expires_sec"],
        display_name=user["display_name"],
        preferred_language=normalize_preferred_language(preferred_language) or "en-us",
    )

    return build_service_success(
        message="メールアドレスが登録されていれば、再設定案内を送信しました。",
    )


def get_password_reset_status(
    reset_token: str | None,
    now=None,
) -> dict:
    try:
        validated = validate_reset_status_query(reset_token)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)

    try:
        parse_reset_token(validated["token"], now=now_dt)
        conn = _get_db_connection(autocommit=True)
        row = get_password_reset_token_by_hash(
            conn=conn,
            token_hash=hash_token_value(validated["token"]),
        )
        if row is None:
            return build_service_error(
                error_code="invalid_reset_token",
                message="再設定トークンが無効です。",
            )
        if _is_expired(row["expires_at"], now_dt):
            return build_service_error(
                error_code="reset_token_expired",
                message="再設定トークンの有効期限が切れています。",
            )
        return build_service_success(
            data={
                "valid": True,
                "expires_in_sec": _remaining_seconds(row["expires_at"], now_dt),
            },
            message="再設定トークンを確認しました。",
        )
    except AuthTokenError as exc:
        return _token_error_to_result(exc, "reset")
    except Exception:
        return build_service_error(
            error_code="server_error",
            message="再設定トークンの確認に失敗しました。",
        )
    finally:
        _safe_close(conn)

def change_password_for_current_session(
    session_token: str | None,
    current_password: str | None,
    new_password: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    current_password_value = "" if current_password is None else str(current_password)
    new_password_value = "" if new_password is None else str(new_password)

    field_errors: list[dict] = []

    if current_password_value.strip() == "":
        field_errors.append(
            {
                "field": "current_password",
                "code": "required",
                "message": "現在のパスワードを入力してください。",
            }
        )

    if new_password_value.strip() == "":
        field_errors.append(
            {
                "field": "new_password",
                "code": "required",
                "message": "新しいパスワードを入力してください。",
            }
        )
    else:
        if len(new_password_value) < 8:
            field_errors.append(
                {
                    "field": "new_password",
                    "code": "too_short",
                    "message": "新しいパスワードは8文字以上で入力してください。",
                }
            )
        if len(new_password_value) > 32:
            field_errors.append(
                {
                    "field": "new_password",
                    "code": "too_long",
                    "message": "新しいパスワードは32文字以内で入力してください。",
                }
            )
        if current_password_value != "" and new_password_value == current_password_value:
            field_errors.append(
                {
                    "field": "new_password",
                    "code": "password_reuse",
                    "message": "現在のパスワードとは別のパスワードを設定してください。",
                }
            )

    if field_errors:
        return build_service_error(
            error_code="validation_error",
            message="入力内容を確認してください。",
            field_errors=field_errors,
        )

    if session_token is None or str(session_token).strip() == "":
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    conn = None
    now_dt = _utc_now(now)

    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)

        if session_row is None:
            _safe_rollback(conn)
            result = build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
            )
            result["clear_session_cookie"] = True
            return result

        if session_row.get("revoked_at") is not None or _is_expired(session_row["expires_at"], now_dt):
            _safe_rollback(conn)
            result = build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
            )
            result["clear_session_cookie"] = True
            return result

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            result = build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
            )
            result["clear_session_cookie"] = True
            return result

        force_logout_after = user.get("force_logout_after")
        if force_logout_after is not None and _coerce_utc_datetime(session_row["created_at"]) < _coerce_utc_datetime(force_logout_after):
            _safe_rollback(conn)
            result = build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
            )
            result["clear_session_cookie"] = True
            return result

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if _is_two_factor_required(two_factor_settings):
            if session_row.get("two_factor_verified_at") is None:
                _safe_rollback(conn)
                result = build_service_error(
                    error_code="not_authenticated",
                    message="ログインが必要です。",
                )
                result["clear_session_cookie"] = True
                return result

        credentials = get_password_credentials_by_user_id(conn, user["id"])
        if credentials is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="server_error",
                message="パスワード変更に失敗しました。",
            )

        if not verify_password(current_password_value, credentials["password_hash"]):
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.password_change",
                target_type="user",
                target_id=str(user["id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="パスワード変更に失敗しました。",
                meta_json={"reason": "current_password_incorrect"},
            )
            conn.commit()
            return build_service_error(
                error_code="current_password_incorrect",
                message="現在のパスワードが正しくありません。",
                field_errors=[
                    {
                        "field": "current_password",
                        "code": "current_password_incorrect",
                        "message": "現在のパスワードが正しくありません。",
                    }
                ],
            )

        new_password_hash = hash_password(new_password_value)

        update_password_hash(
            conn=conn,
            user_id=user["id"],
            password_hash=new_password_hash,
            password_updated_at=now_dt,
        )
        clear_password_failed_attempts(conn, user["id"])
        set_user_must_reset_password(conn, user["id"], False)

        revoked_count = revoke_sessions_by_user_id(conn, user["id"], now_dt)

        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.password_change",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="パスワードを変更しました。",
            meta_json={"revoked_sessions": revoked_count},
        )

        conn.commit()
        return build_service_success(
            data={"revoked_sessions": revoked_count},
            next_kind="redirect",
            next_to="/auth",
            message="パスワードを変更しました。再度ログインしてください。",
            clear_session_cookie=True,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="パスワード変更に失敗しました。",
        )
    finally:
        _safe_close(conn)

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def start_email_change_for_session(
    session_token: str | None,
    new_email: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    preferred_language: str | None = None,
    now=None,
) -> dict:
    new_email_value = str(new_email or "").strip().lower()

    if not new_email_value:
        return build_service_error(
            error_code="validation_error",
            message="入力内容を確認してください。",
            field_errors=[{"field": "new_email", "code": "required", "message": "メールアドレスを入力してください。"}],
        )
    if not _EMAIL_RE.match(new_email_value):
        return build_service_error(
            error_code="validation_error",
            message="入力内容を確認してください。",
            field_errors=[{"field": "new_email", "code": "invalid", "message": "有効なメールアドレスを入力してください。"}],
        )
    if len(new_email_value) > 255:
        return build_service_error(
            error_code="validation_error",
            message="入力内容を確認してください。",
            field_errors=[{"field": "new_email", "code": "too_long", "message": "メールアドレスが長すぎます。"}],
        )

    if session_token is None or str(session_token).strip() == "":
        result = build_service_error(error_code="not_authenticated", message="ログインが必要です。")
        result["clear_session_cookie"] = True
        return result

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    new_verify_code = _generate_otp_code()
    verify_ticket = None

    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)

        if session_row is None or session_row.get("revoked_at") is not None or _is_expired(session_row["expires_at"], now_dt):
            _safe_rollback(conn)
            result = build_service_error(error_code="not_authenticated", message="ログインが必要です。")
            result["clear_session_cookie"] = True
            return result

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            result = build_service_error(error_code="not_authenticated", message="ログインが必要です。")
            result["clear_session_cookie"] = True
            return result

        current_email = (user.get("primary_email") or "").strip().lower()
        if current_email == new_email_value:
            _safe_rollback(conn)
            return build_service_error(
                error_code="validation_error",
                message="入力内容を確認してください。",
                field_errors=[{"field": "new_email", "code": "same_email", "message": "現在と同じメールアドレスです。"}],
            )

        existing = get_user_by_primary_email(conn, new_email_value)
        if existing is not None and int(existing["id"]) != int(user["id"]):
            _safe_rollback(conn)
            return build_service_error(
                error_code="validation_error",
                message="入力内容を確認してください。",
                field_errors=[{"field": "new_email", "code": "already_in_use", "message": "このメールアドレスはすでに使用されています。"}],
            )

        # Cooldown check
        latest = get_latest_active_email_verification(conn, user_id=int(user["id"]), purpose="email_change", now=now_dt)
        if latest is not None:
            cooldown = _remaining_cooldown(latest["created_at"], auth_conf["verify_resend_cooldown_sec"], now_dt)
            if cooldown > 0:
                _safe_rollback(conn)
                return build_service_error(
                    error_code="resend_cooldown",
                    message="しばらく待ってから再度お試しください。",
                    retry_after_sec=cooldown,
                )

        expire_active_email_verifications(conn, user_id=int(user["id"]), purpose="email_change", now=now_dt)
        create_email_verification(
            conn=conn,
            user_id=int(user["id"]),
            email=new_email_value,
            code_hash=hash_token_value(new_verify_code),
            purpose="email_change",
            expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
        )
        verify_ticket = create_verify_ticket(
            user_id=int(user["id"]),
            purpose="email_change",
            email=new_email_value,
            preferred_language=preferred_language,
            expires_in_sec=auth_conf["verify_code_expires_sec"],
            now=now_dt,
        )
        log_auth_event(
            conn=conn,
            actor_user_id=int(user["id"]),
            action_type="auth.email_change.start",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="メールアドレス変更を開始しました。",
            meta_json={"new_email": mask_email_address(new_email_value)},
        )
        conn.commit()
    except Exception:
        logger.exception("Unhandled error")
        _safe_rollback(conn)
        return build_service_error(error_code="server_error", message="メールアドレス変更の開始に失敗しました。")
    finally:
        _safe_close(conn)

    _try_send_verification_email(
        to_email=new_email_value,
        code=new_verify_code,
        purpose="email_change",
        expires_in_sec=auth_conf["verify_code_expires_sec"],
        display_name=user.get("display_name"),
        preferred_language="en-us",
    )

    return build_service_success(
        data={
            "verify_ticket": verify_ticket,
            "masked_email": mask_email_address(new_email_value),
            "expires_in_sec": auth_conf["verify_code_expires_sec"],
            "resend_cooldown_sec": auth_conf["verify_resend_cooldown_sec"],
        },
        message="確認コードを送信しました。",
    )


def reset_password(
    reset_token: str | None,
    password: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_reset_password_input(
            reset_token=reset_token,
            password=password,
        )
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)

    try:
        parsed = parse_reset_token(validated["reset_token"], now=now_dt)
        conn = _get_db_connection(autocommit=False)
        row = get_password_reset_token_by_hash(
            conn=conn,
            token_hash=hash_token_value(validated["reset_token"]),
        )
        if row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="invalid_reset_token",
                message="再設定トークンが無効です。",
            )
        if _is_expired(row["expires_at"], now_dt):
            _safe_rollback(conn)
            return build_service_error(
                error_code="reset_token_expired",
                message="再設定トークンの有効期限が切れています。",
            )

        update_password_hash(
            conn=conn,
            user_id=parsed["user_id"],
            password_hash=hash_password(validated["password"]),
            password_updated_at=now_dt,
        )
        clear_password_failed_attempts(conn, parsed["user_id"])
        set_user_must_reset_password(conn, parsed["user_id"], False)
        consume_password_reset_token(conn, row["id"], now_dt)
        revoke_sessions_by_user_id(conn, parsed["user_id"], now_dt)
        log_auth_event(
            conn=conn,
            actor_user_id=parsed["user_id"],
            action_type="auth.password_reset.confirm",
            target_type="user",
            target_id=str(parsed["user_id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="パスワードを再設定しました。",
        )
        conn.commit()
        return build_service_success(
            next_kind="redirect",
            next_to="/auth/reset/done",
            message="パスワードを再設定しました。",
            clear_session_cookie=True,
        )
    except (AuthSecurityError, AuthTokenError) as exc:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message=exc.message,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="パスワード再設定に失敗しました。",
        )
    finally:
        _safe_close(conn)


def start_discord_link(session_token: str | None, now=None) -> dict:
    """ログイン済みユーザーがDiscordを後から連携する"""
    if not session_token or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
    current = get_current_user_by_session_token(session_token=session_token, now=now)
    if current is None:
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
    now_dt = _utc_now(now)
    try:
        discord_conf = _get_discord_conf()
    except Exception:
        return build_service_error(
            error_code="discord_not_configured",
            message="Discord連携が設定されていません。",
        )
    client_id = discord_conf.get("client_id", "")
    redirect_uri = discord_conf.get("redirect_uri", "")
    if not client_id or not redirect_uri:
        return build_service_error(
            error_code="discord_not_configured",
            message="Discord連携が設定されていません。",
        )
    try:
        state = _make_discord_state_token(now_dt, action="link")
    except Exception:
        logger.exception("Discord link state token generation failed")
        return build_service_error(
            error_code="server_error",
            message="Discord連携の開始に失敗しました。",
        )
    oauth_url = (
        "https://discord.com/oauth2/authorize?"
        + urlencode({
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "identify email",
            "state": state,
        }, quote_via=quote)
    )
    logger.info("Discord link OAuth URL generated: redirect_uri=%s", redirect_uri)
    return build_service_success(
        next_kind="redirect",
        next_to=oauth_url,
        message="Discordの認証ページに移動します。",
    )


def unlink_discord_for_session(
    session_token: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    if not session_token or str(session_token).strip() == "":
        return build_service_error(error_code="not_authenticated", message="ログインが必要です。")
    now_dt = _utc_now(now)
    current = get_current_user_by_session_token(session_token=session_token, now=now_dt)
    if current is None:
        return build_service_error(error_code="not_authenticated", message="ログインが必要です。")
    user_id = current["user"]["id"]
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        identity = get_identity_by_user_and_provider(conn, user_id, "discord")
        if identity is None or not bool(identity.get("is_enabled")):
            _safe_rollback(conn)
            return build_service_error(error_code="not_linked", message="Discordアカウントが連携されていません。")
        # パスワードがない場合は解除不可（ログイン手段がなくなる）
        pw_creds = get_password_credentials_by_user_id(conn, user_id)
        if pw_creds is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="cannot_unlink",
                message="パスワードが設定されていないため、Discord連携を解除できません。先にパスワードを設定してください。",
            )
        update_auth_identity_enabled(conn, identity["id"], False)
        log_auth_event(
            conn=conn,
            actor_user_id=user_id,
            action_type="auth.discord_unlink",
            target_type="user",
            target_id=str(user_id),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="Discord連携を解除しました。",
            meta_json={"identity_id": identity["id"]},
        )
        conn.commit()
        return build_service_success(message="Discord連携を解除しました。")
    except Exception:
        logger.exception("unlink_discord_for_session error")
        _safe_rollback(conn)
        return build_service_error(error_code="server_error", message="Discord連携解除中にエラーが発生しました。")
    finally:
        _safe_close(conn)


def set_password_for_session(
    session_token: str | None,
    password: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    """Discord登録ユーザーが後からパスワードを設定する"""
    from auth_validators import validate_password as _validate_password
    if not session_token or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
    current = get_current_user_by_session_token(session_token=session_token, now=now)
    if current is None:
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    try:
        from auth_validators import AuthValidationError as _AVE
        _validate_password(password, "password")
    except Exception as exc:
        if hasattr(exc, "to_dict"):
            return build_service_error(
                error_code="validation_error",
                message="パスワードの形式が正しくありません。",
                field_errors=[exc.to_dict()],
            )
        return build_service_error(
            error_code="validation_error",
            message="パスワードの形式が正しくありません。",
        )

    user = current["user"]
    now_dt = _utc_now(now)
    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        existing = get_password_credentials_by_user_id(conn, user["id"])
        password_hash = hash_password(str(password))
        if existing is not None:
            update_password_hash(conn, user["id"], password_hash)
        else:
            create_password_credentials(conn=conn, user_id=user["id"], password_hash=password_hash)
        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.password_set",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="パスワードを設定しました。",
        )
        conn.commit()
        return build_service_success(message="パスワードを設定しました。")
    except Exception:
        logger.exception("set_password_for_session failed")
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="パスワードの設定に失敗しました。",
        )
    finally:
        _safe_close(conn)


def start_discord_oauth(now=None) -> dict:
    now_dt = _utc_now(now)
    try:
        discord_conf = _get_discord_conf()
    except Exception:
        logger.exception("Discord conf load failed")
        return build_service_error(
            error_code="discord_not_configured",
            message="Discord連携が設定されていません。",
        )

    client_id = discord_conf.get("client_id", "")
    redirect_uri = discord_conf.get("redirect_uri", "")
    if not client_id or not redirect_uri:
        return build_service_error(
            error_code="discord_not_configured",
            message="Discord連携が設定されていません。",
        )

    try:
        state = _make_discord_state_token(now_dt)
    except Exception:
        logger.exception("Discord state token generation failed")
        return build_service_error(
            error_code="server_error",
            message="Discord認証の開始に失敗しました。",
        )

    oauth_url = (
        "https://discord.com/oauth2/authorize?"
        + urlencode({
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "identify email",
            "state": state,
        }, quote_via=quote)
    )
    logger.info("Discord login OAuth URL generated: redirect_uri=%s", redirect_uri)
    return build_service_success(
        next_kind="redirect",
        next_to=oauth_url,
        message="Discordの認証ページに移動します。",
    )


def start_two_factor_setup_for_current_session(
    session_token: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    preferred_language: str | None = None,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    current = get_current_user_by_session_token(session_token=session_token, now=now)
    if current is None:
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    user = current["user"]
    primary_email = user.get("primary_email")
    if primary_email is None or str(primary_email).strip() == "":
        return build_service_error(
            error_code="email_not_available",
            message="利用可能なメールアドレスが設定されていません。",
        )

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    verify_code = None
    verify_ticket = None
    response_expires_in_sec = auth_conf["verify_code_expires_sec"]
    response_resend_cooldown_sec = auth_conf["verify_resend_cooldown_sec"]
    response_message = "2段階認証の確認コードを送信しました。"
    should_send_mail = False

    try:
        conn = _get_db_connection(autocommit=False)

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if two_factor_settings is not None and bool(two_factor_settings.get("is_enabled")):
            _safe_rollback(conn)
            return build_service_error(
                error_code="already_enabled",
                message="2段階認証はすでに有効です。",
            )

        latest = get_latest_active_email_verification(
            conn=conn,
            user_id=user["id"],
            purpose="2fa_setup",
            now=now_dt,
        )
        if latest is not None:
            response_expires_in_sec = _remaining_seconds(latest["expires_at"], now_dt)
            response_resend_cooldown_sec = _remaining_cooldown(
                latest["created_at"],
                auth_conf["verify_resend_cooldown_sec"],
                now_dt,
            )
            verify_ticket = create_verify_ticket(
                user_id=user["id"],
                purpose="2fa_setup",
                email=primary_email,
                preferred_language=preferred_language,
                expires_in_sec=response_expires_in_sec,
                now=now_dt,
            )
            response_message = "送信済みの確認コードを入力してください。"
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.2fa.setup.start",
                target_type="user",
                target_id=str(user["id"]),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="2段階認証設定コードを再利用しました。",
                meta_json={"reused": True},
            )
            conn.commit()
        else:
            verify_code = _generate_otp_code()
            create_email_verification(
                conn=conn,
                user_id=user["id"],
                email=primary_email,
                code_hash=hash_token_value(verify_code),
                purpose="2fa_setup",
                expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
            )
            verify_ticket = create_verify_ticket(
                user_id=user["id"],
                purpose="2fa_setup",
                email=primary_email,
                preferred_language=preferred_language,
                expires_in_sec=auth_conf["verify_code_expires_sec"],
                now=now_dt,
            )
            should_send_mail = True
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.2fa.setup.start",
                target_type="user",
                target_id=str(user["id"]),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="2段階認証設定コードを送信しました。",
                meta_json={"reused": False},
            )
            conn.commit()
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="2段階認証の開始に失敗しました。",
        )
    finally:
        _safe_close(conn)

    if should_send_mail and verify_code is not None:
        _try_send_verification_email(
            to_email=primary_email,
            code=verify_code,
            purpose="2fa_setup",
            expires_in_sec=auth_conf["verify_code_expires_sec"],
            display_name=user.get("display_name"),
            preferred_language=preferred_language,
        )

    return build_service_success(
        data={
            "verify_ticket": verify_ticket,
            "masked_email": mask_email_address(primary_email),
            "expires_in_sec": response_expires_in_sec,
            "resend_cooldown_sec": response_resend_cooldown_sec,
            "sent_now": should_send_mail,
        },
        next_kind="verify_2fa_setup",
        next_to=None,
        message=response_message,
    )

def confirm_two_factor_setup_for_current_session(
    session_token: str | None,
    verify_ticket: str | None,
    code: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    current = get_current_user_by_session_token(session_token=session_token, now=now)
    if current is None:
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    try:
        validated = validate_verify_email_input(verify_ticket=verify_ticket, code=code)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    user = current["user"]
    now_dt = _utc_now(now)
    entered_code_hash = hash_token_value(validated["code"])
    conn = None

    try:
        parsed = parse_verify_ticket(validated["verify_ticket"], now=now_dt)

        if parsed["purpose"] != "2fa_setup":
            return build_service_error(
                error_code="invalid_ticket",
                message="確認トークンが無効です。",
            )

        if int(parsed["user_id"]) != int(user["id"]):
            result = build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
            )
            result["clear_session_cookie"] = True
            return result

        conn = _get_db_connection(autocommit=False)

        row = get_latest_active_email_verification(
            conn=conn,
            user_id=user["id"],
            purpose="2fa_setup",
            now=now_dt,
        )
        if row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="ticket_expired",
                message="確認トークンの有効期限が切れています。",
            )

        if int(row["attempt_count"] or 0) >= _get_auth_conf()["verify_max_attempts"]:
            _safe_rollback(conn)
            return build_service_error(
                error_code="too_many_attempts",
                message="確認コードの入力回数が上限に達しました。",
            )

        if row["code_hash"] != entered_code_hash:
            increment_email_verification_attempts(conn, row["id"])
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.2fa.setup.confirm",
                target_type="user",
                target_id=str(user["id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="2段階認証設定確認に失敗しました。",
                meta_json={"reason": "invalid_code"},
            )
            conn.commit()
            return build_service_error(
                error_code="invalid_code",
                message="確認コードが正しくありません。",
            )

        consume_email_verification(conn, row["id"], now_dt)

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if two_factor_settings is None:
            create_two_factor_settings(
                conn=conn,
                user_id=user["id"],
                method="email",
                is_enabled=True,
                is_required=False,
            )
        else:
            update_two_factor_settings(
                conn=conn,
                user_id=user["id"],
                is_enabled=True,
                enabled_at=now_dt,
            )

        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.2fa.setup.confirm",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="2段階認証を有効化しました。",
        )

        conn.commit()
        return build_service_success(
            data={
                "two_factor": {
                    "is_enabled": True,
                    "is_required": False,
                }
            },
            next_kind="none",
            next_to=None,
            message="2段階認証を有効化しました。",
        )
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "ticket")
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="2段階認証の有効化に失敗しました。",
        )
    finally:
        _safe_close(conn)



def start_two_factor_disable_for_current_session(
    session_token: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    preferred_language: str | None = None,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    current = get_current_user_by_session_token(session_token=session_token, now=now)
    if current is None:
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    user = current["user"]
    primary_email = user.get("primary_email")
    if primary_email is None or str(primary_email).strip() == "":
        return build_service_error(
            error_code="email_not_available",
            message="利用可能なメールアドレスが設定されていません。",
        )

    conn = None
    now_dt = _utc_now(now)
    auth_conf = _get_auth_conf()
    verify_code = None
    verify_ticket = None
    response_expires_in_sec = auth_conf["verify_code_expires_sec"]
    response_resend_cooldown_sec = auth_conf["verify_resend_cooldown_sec"]
    response_message = "2段階認証の無効化コードを送信しました。"
    should_send_mail = False

    try:
        conn = _get_db_connection(autocommit=False)

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if two_factor_settings is None or not bool(two_factor_settings.get("is_enabled")):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_enabled",
                message="2段階認証は有効ではありません。",
            )

        latest = get_latest_active_email_verification(
            conn=conn,
            user_id=user["id"],
            purpose="2fa_disable",
            now=now_dt,
        )
        if latest is not None:
            response_expires_in_sec = _remaining_seconds(latest["expires_at"], now_dt)
            response_resend_cooldown_sec = _remaining_cooldown(
                latest["created_at"],
                auth_conf["verify_resend_cooldown_sec"],
                now_dt,
            )
            verify_ticket = create_verify_ticket(
                user_id=user["id"],
                purpose="2fa_disable",
                email=primary_email,
                preferred_language=preferred_language,
                expires_in_sec=response_expires_in_sec,
                now=now_dt,
            )
            response_message = "送信済みの確認コードを入力してください。"
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.2fa.disable.start",
                target_type="user",
                target_id=str(user["id"]),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="2段階認証無効化コードを再利用しました。",
                meta_json={"reused": True},
            )
            conn.commit()
        else:
            verify_code = _generate_otp_code()
            create_email_verification(
                conn=conn,
                user_id=user["id"],
                email=primary_email,
                code_hash=hash_token_value(verify_code),
                purpose="2fa_disable",
                expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
            )
            verify_ticket = create_verify_ticket(
                user_id=user["id"],
                purpose="2fa_disable",
                email=primary_email,
                preferred_language=preferred_language,
                expires_in_sec=auth_conf["verify_code_expires_sec"],
                now=now_dt,
            )
            should_send_mail = True
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.2fa.disable.start",
                target_type="user",
                target_id=str(user["id"]),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="2段階認証無効化コードを送信しました。",
                meta_json={"reused": False},
            )
            conn.commit()
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="2段階認証の無効化開始に失敗しました。",
        )
    finally:
        _safe_close(conn)

    if should_send_mail and verify_code is not None:
        _try_send_verification_email(
            to_email=primary_email,
            code=verify_code,
            purpose="2fa_disable",
            expires_in_sec=auth_conf["verify_code_expires_sec"],
            display_name=user.get("display_name"),
            preferred_language=preferred_language,
        )

    return build_service_success(
        data={
            "verify_ticket": verify_ticket,
            "masked_email": mask_email_address(primary_email),
            "expires_in_sec": response_expires_in_sec,
            "resend_cooldown_sec": response_resend_cooldown_sec,
            "sent_now": should_send_mail,
        },
        next_kind="verify_2fa_disable",
        next_to=None,
        message=response_message,
    )

def confirm_two_factor_disable_for_current_session(
    session_token: str | None,
    verify_ticket: str | None,
    code: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    current = get_current_user_by_session_token(session_token=session_token, now=now)
    if current is None:
        result = build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
        )
        result["clear_session_cookie"] = True
        return result

    try:
        validated = validate_verify_email_input(verify_ticket=verify_ticket, code=code)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    user = current["user"]
    now_dt = _utc_now(now)
    entered_code_hash = hash_token_value(validated["code"])
    conn = None

    try:
        parsed = parse_verify_ticket(validated["verify_ticket"], now=now_dt)

        if parsed["purpose"] != "2fa_disable":
            return build_service_error(
                error_code="invalid_ticket",
                message="確認トークンが無効です。",
            )

        if int(parsed["user_id"]) != int(user["id"]):
            result = build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
            )
            result["clear_session_cookie"] = True
            return result

        conn = _get_db_connection(autocommit=False)

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if two_factor_settings is None or not bool(two_factor_settings.get("is_enabled")):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_enabled",
                message="2段階認証は有効ではありません。",
            )

        row = get_latest_active_email_verification(
            conn=conn,
            user_id=user["id"],
            purpose="2fa_disable",
            now=now_dt,
        )
        if row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="ticket_expired",
                message="確認トークンの有効期限が切れています。",
            )

        if int(row["attempt_count"] or 0) >= _get_auth_conf()["verify_max_attempts"]:
            _safe_rollback(conn)
            return build_service_error(
                error_code="too_many_attempts",
                message="確認コードの入力回数が上限に達しました。",
            )

        if row["code_hash"] != entered_code_hash:
            increment_email_verification_attempts(conn, row["id"])
            log_auth_event(
                conn=conn,
                actor_user_id=user["id"],
                action_type="auth.2fa.disable.confirm",
                target_type="user",
                target_id=str(user["id"]),
                result="failure",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="2段階認証無効化確認に失敗しました。",
                meta_json={"reason": "invalid_code"},
            )
            conn.commit()
            return build_service_error(
                error_code="invalid_code",
                message="確認コードが正しくありません。",
            )

        consume_email_verification(conn, row["id"], now_dt)

        update_two_factor_settings(
            conn=conn,
            user_id=user["id"],
            is_enabled=False,
            is_required=False,
        )

        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.2fa.disable.confirm",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="2段階認証を無効化しました。",
        )

        conn.commit()
        return build_service_success(
            data={
                "two_factor": {
                    "is_enabled": False,
                    "is_required": False,
                }
            },
            next_kind="none",
            next_to=None,
            message="2段階認証を無効化しました。",
        )
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "ticket")
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="2段階認証の無効化に失敗しました。",
        )
    finally:
        _safe_close(conn)

def handle_discord_callback(
    code: str | None,
    state: str | None,
    session_token: str | None = None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    now_dt = _utc_now(now)

    if not code or not state:
        return build_service_error(
            error_code="invalid_callback",
            message="Discord認証パラメータが不正です。",
        )

    try:
        is_valid, action = _verify_discord_state_token(str(state), now_dt)
        if not is_valid:
            return build_service_error(
                error_code="invalid_state",
                message="Discord認証のstateが無効または期限切れです。",
            )
    except Exception:
        logger.exception("Discord state verification failed")
        return build_service_error(
            error_code="server_error",
            message="Discord認証の確認に失敗しました。",
        )

    try:
        discord_conf = _get_discord_conf()
    except Exception:
        logger.exception("Discord conf load failed in callback")
        return build_service_error(
            error_code="discord_not_configured",
            message="Discord連携が設定されていません。",
        )

    client_id = discord_conf.get("client_id", "")
    client_secret = discord_conf.get("client_secret", "")
    redirect_uri = discord_conf.get("redirect_uri", "")
    if not client_id or not client_secret or not redirect_uri:
        return build_service_error(
            error_code="discord_not_configured",
            message="Discord連携が設定されていません。",
        )

    # Exchange code for access token
    try:
        token_body = urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "authorization_code",
            "code": str(code),
            "redirect_uri": redirect_uri,
        }).encode("utf-8")
        token_req = _urllib_request.Request(
            "https://discord.com/api/oauth2/token",
            data=token_body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "FelixxsvGallery/1.0",
            },
            method="POST",
        )
        with _urllib_request.urlopen(token_req, timeout=10) as resp:
            token_data = _json.loads(resp.read().decode("utf-8"))
    except _urllib_error.HTTPError as exc:
        try:
            raw_body = exc.read().decode("utf-8")
        except Exception:
            raw_body = ""
        try:
            token_data = _json.loads(raw_body)
        except Exception:
            token_data = {}
        logger.error("Discord token exchange HTTP error: status=%s body=%r parsed=%s", exc.code, raw_body, token_data)
        return build_service_error(
            error_code="discord_token_error",
            message="Discordトークンの取得に失敗しました。",
        )
    except Exception:
        logger.exception("Discord token exchange failed")
        return build_service_error(
            error_code="discord_api_error",
            message="Discordトークンの取得に失敗しました。",
        )

    if "access_token" not in token_data:
        logger.error("Discord token exchange missing access_token: %s", token_data)
        return build_service_error(
            error_code="discord_token_error",
            message="Discordトークンの取得に失敗しました。",
        )

    access_token = token_data["access_token"]

    # Fetch Discord user info
    try:
        user_req = _urllib_request.Request(
            "https://discord.com/api/users/@me",
            headers={
                "Authorization": f"Bearer {access_token}",
                "User-Agent": "FelixxsvGallery/1.0",
            },
            method="GET",
        )
        with _urllib_request.urlopen(user_req, timeout=10) as resp:
            discord_user = _json.loads(resp.read().decode("utf-8"))
    except _urllib_error.HTTPError as exc:
        logger.error("Discord user fetch HTTP error: %s", exc.code)
        return build_service_error(
            error_code="discord_user_error",
            message="Discordユーザー情報の取得に失敗しました。",
        )
    except Exception:
        logger.exception("Discord user fetch failed")
        return build_service_error(
            error_code="discord_api_error",
            message="Discordユーザー情報の取得に失敗しました。",
        )

    if "id" not in discord_user:
        logger.error("Discord user fetch missing id: %s", discord_user)
        return build_service_error(
            error_code="discord_user_error",
            message="Discordユーザー情報の取得に失敗しました。",
        )

    provider_user_id = str(discord_user["id"])
    provider_display_name = discord_user.get("global_name") or discord_user.get("username") or ""
    provider_username = discord_user.get("username") or ""
    provider_email = discord_user.get("email") or None
    if provider_email and not discord_user.get("verified", False):
        provider_email = None
    provider_avatar_hash = discord_user.get("avatar") or None

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)

        identity = get_identity_by_provider_user_id(conn, "discord", provider_user_id)

        # --- Link action: attach Discord to existing logged-in account ---
        if action == "link":
            current = None
            if session_token:
                current = get_current_user_by_session_token(session_token=session_token, now=now_dt)
            if current is None:
                _safe_rollback(conn)
                conf = _get_conf()
                base_url = _get_base_url(conf)
                return build_service_success(
                    next_kind="redirect",
                    next_to=f"{base_url}/auth/?error=discord_link_not_authenticated",
                    message="連携にはログインが必要です。",
                )
            link_user = current["user"]
            if identity is not None:
                already_enabled = bool(identity.get("is_enabled"))
                same_user = identity["user_id"] == link_user["id"]
                if same_user and already_enabled:
                    _safe_rollback(conn)
                    conf = _get_conf()
                    base_url = _get_base_url(conf)
                    return build_service_success(
                        next_kind="redirect",
                        next_to=f"{base_url}/?discord_link=already",
                        message="このDiscordアカウントはすでに連携済みです。",
                    )
                if not same_user and already_enabled:
                    _safe_rollback(conn)
                    conf = _get_conf()
                    base_url = _get_base_url(conf)
                    return build_service_success(
                        next_kind="redirect",
                        next_to=f"{base_url}/?discord_link=conflict",
                        message="このDiscordアカウントは別のアカウントに紐付いています。",
                    )
                # disabled identity (same or different user) → reactivate
                reactivate_auth_identity(
                    conn=conn,
                    identity_id=identity["id"],
                    user_id=link_user["id"],
                    provider_email=provider_email,
                    provider_display_name=provider_display_name or provider_username,
                )
            else:
                # identity=None for this Discord ID, but the user may have an old disabled identity
                user_existing = get_identity_by_user_and_provider(conn, link_user["id"], "discord")
                if user_existing is not None and not bool(user_existing.get("is_enabled")):
                    # Reuse the old row, replacing Discord ID
                    reassign_auth_identity(
                        conn=conn,
                        identity_id=user_existing["id"],
                        user_id=link_user["id"],
                        provider_user_id=provider_user_id,
                        provider_email=provider_email,
                        provider_display_name=provider_display_name or provider_username,
                    )
                else:
                    create_auth_identity(
                        conn=conn,
                        user_id=link_user["id"],
                        provider="discord",
                        provider_user_id=provider_user_id,
                        provider_email=provider_email,
                        provider_display_name=provider_display_name or provider_username,
                        is_enabled=True,
                    )
            log_auth_event(
                conn=conn,
                actor_user_id=link_user["id"],
                action_type="auth.discord_link",
                target_type="user",
                target_id=str(link_user["id"]),
                result="success",
                ip_address=ip_address,
                user_agent=user_agent,
                summary="Discordアカウントを連携しました。",
                meta_json={"provider_user_id": provider_user_id},
            )
            conn.commit()
            conf = _get_conf()
            base_url = _get_base_url(conf)
            return build_service_success(
                next_kind="redirect",
                next_to=f"{base_url}/?discord_link=ok",
                message="Discordアカウントを連携しました。",
            )

        # --- Login action ---
        if identity is not None:
            # Existing Discord user — log them in
            if not bool(identity.get("is_enabled")):
                _safe_rollback(conn)
                return build_service_error(
                    error_code="identity_disabled",
                    message="このDiscordアカウントは無効化されています。",
                )

            user = get_user_by_id(conn, identity["user_id"])
            if user is None or user.get("status") != "active":
                _safe_rollback(conn)
                return build_service_error(
                    error_code="account_inactive",
                    message="アカウントが無効または停止されています。",
                )

            update_auth_identity_last_used(conn, identity["id"], now_dt)

            two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
            if _is_two_factor_required(two_factor_settings):
                two_factor_result = _build_login_two_factor_result(
                    conn=conn,
                    user=user,
                    ip_address=ip_address,
                    user_agent=user_agent,
                    now_dt=now_dt,
                )
                conn.commit()
                _dispatch_mail_job(two_factor_result["mail_job"])
                return two_factor_result["result"]

            result = _create_authenticated_session_result(
                conn=conn,
                user=user,
                ip_address=ip_address,
                user_agent=user_agent,
                now_dt=now_dt,
                action_type="auth.discord_login",
                summary="Discordでログインしました。",
                meta_json={"provider_user_id": provider_user_id},
            )
            conn.commit()
            return result

        else:
            # New Discord user — check if email already exists on another account
            registration_token = create_registration_token(
                provider_user_id=provider_user_id,
                provider_email=provider_email,
                provider_display_name=provider_display_name,
                provider_username=provider_username,
                provider_avatar_hash=provider_avatar_hash,
            )
            conf = _get_conf()
            base_url = _get_base_url(conf)

            if provider_email:
                existing_user = get_user_by_primary_email(conn, provider_email)
                if existing_user is not None and existing_user.get("status") == "active":
                    # Email conflict: offer to link Discord to existing account
                    _safe_rollback(conn)
                    redirect_path = _build_register_complete_path(registration_token)
                    return build_service_success(
                        next_kind="redirect",
                        next_to=f"{base_url}{redirect_path}&provider=discord&conflict=email_exists",
                        message="このメールアドレスは既に登録されています。既存のアカウントにDiscordを連携できます。",
                    )

            _safe_rollback(conn)
            redirect_path = _build_register_complete_path(registration_token)
            return build_service_success(
                next_kind="redirect",
                next_to=f"{base_url}{redirect_path}&provider=discord",
                message="Discordアカウントが見つかりませんでした。アカウントを作成してください。",
            )

    except Exception:
        logger.exception("Discord callback DB error")
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="Discord認証処理中にエラーが発生しました。",
        )
    finally:
        _safe_close(conn)


def get_discord_registration_status(
    registration_token: str | None,
    now=None,
) -> dict:
    try:
        validated = validate_discord_registration_status_query(registration_token)
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    now_dt = _utc_now(now)
    try:
        parsed = parse_registration_token(validated["registration_token"], now=now_dt)
        prefill_user_key = _build_candidate_user_key(
            parsed.get("provider_username"),
            parsed.get("provider_display_name"),
            parsed["provider_user_id"],
        )
        prefill_display_name = parsed.get("provider_display_name") or parsed.get("provider_username") or prefill_user_key
        avatar_hash = parsed.get("provider_avatar_hash")
        avatar_url = (
            f"https://cdn.discordapp.com/avatars/{parsed['provider_user_id']}/{avatar_hash}.png?size=256"
            if avatar_hash else None
        )
        return build_service_success(
            data={
                "discord_profile": {
                    "provider_user_id": parsed["provider_user_id"],
                    "provider_email": parsed.get("provider_email"),
                    "provider_display_name": parsed.get("provider_display_name"),
                    "provider_username": parsed.get("provider_username"),
                    "provider_avatar_url": avatar_url,
                },
                "prefill": {
                    "user_key": prefill_user_key,
                    "display_name": prefill_display_name,
                },
                "expires_in_sec": max(0, parsed["exp"] - int(now_dt.timestamp())),
            },
            message="Discord登録情報を取得しました。",
        )
    except AuthTokenError as exc:
        return _token_error_to_result(exc, "registration")
    except Exception:
        return build_service_error(
            error_code="server_error",
            message="Discord登録情報の取得に失敗しました。",
        )


def link_discord_via_registration_token(
    session_token: str | None,
    registration_token: str | None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    """メール衝突後にログインして、registrationトークンのDiscordアカウントを連携する"""
    if not session_token or str(session_token).strip() == "":
        return build_service_error(error_code="not_authenticated", message="ログインが必要です。")
    if not registration_token or str(registration_token).strip() == "":
        return build_service_error(error_code="invalid_token", message="registrationトークンが無効です。")

    now_dt = _utc_now(now)
    current = get_current_user_by_session_token(session_token=session_token, now=now_dt)
    if current is None:
        return build_service_error(error_code="not_authenticated", message="ログインが必要です。")

    try:
        parsed = parse_registration_token(str(registration_token).strip(), now=now_dt)
    except Exception:
        return build_service_error(error_code="invalid_token", message="registrationトークンが無効または期限切れです。")

    provider_user_id = parsed["provider_user_id"]
    provider_email = parsed.get("provider_email")
    provider_display_name = parsed.get("provider_display_name") or parsed.get("provider_username") or ""
    user_id = current["user"]["id"]

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)

        existing_identity = get_identity_by_provider_user_id(conn, "discord", provider_user_id)
        if existing_identity is not None:
            already_enabled = bool(existing_identity.get("is_enabled"))
            same_user = existing_identity["user_id"] == user_id
            if same_user and already_enabled:
                _safe_rollback(conn)
                return build_service_error(error_code="already_linked", message="このDiscordアカウントはすでに連携済みです。")
            if not same_user and already_enabled:
                _safe_rollback(conn)
                return build_service_error(error_code="discord_conflict", message="このDiscordアカウントは別のアカウントに連携されています。")
            # disabled → reactivate
            reactivate_auth_identity(
                conn=conn,
                identity_id=existing_identity["id"],
                user_id=user_id,
                provider_email=provider_email,
                provider_display_name=provider_display_name,
            )
        else:
            user_existing = get_identity_by_user_and_provider(conn, user_id, "discord")
            if user_existing is not None and not bool(user_existing.get("is_enabled")):
                reassign_auth_identity(
                    conn=conn,
                    identity_id=user_existing["id"],
                    user_id=user_id,
                    provider_user_id=provider_user_id,
                    provider_email=provider_email,
                    provider_display_name=provider_display_name,
                )
            else:
                create_auth_identity(
                    conn=conn,
                    user_id=user_id,
                    provider="discord",
                    provider_user_id=provider_user_id,
                    provider_email=provider_email,
                    provider_display_name=provider_display_name,
                    is_enabled=True,
                )
        log_auth_event(
            conn=conn,
            actor_user_id=user_id,
            action_type="auth.discord_link",
            target_type="user",
            target_id=str(user_id),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="メール衝突後にDiscordアカウントを連携しました。",
            meta_json={"provider_user_id": provider_user_id},
        )
        conn.commit()
        return build_service_success(message="Discordアカウントを連携しました。")
    except Exception:
        logger.exception("link_discord_via_registration_token DB error")
        _safe_rollback(conn)
        return build_service_error(error_code="server_error", message="Discord連携中にエラーが発生しました。")
    finally:
        _safe_close(conn)


def complete_discord_registration(
    registration_token: str | None,
    user_key: str | None,
    display_name: str | None,
    preferred_language: str | None = None,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_discord_register_input(
            registration_token=registration_token,
            user_key=user_key,
            display_name=display_name,
        )
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)
    parsed = None

    try:
        parsed = parse_registration_token(validated["registration_token"], now=now_dt)
        conn = _get_db_connection(autocommit=False)

        if get_user_by_user_key(conn, validated["user_key"]) is not None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="user_key_unavailable",
                message="この user_key はすでに使用されています。",
                field_errors=[
                    {
                        "field": "user_key",
                        "code": "user_key_unavailable",
                        "message": "この user_key はすでに使用されています。",
                    }
                ],
            )

        user_id = create_user(
            conn=conn,
            user_key=validated["user_key"],
            display_name=validated["display_name"],
            primary_email=parsed.get("provider_email"),
            password_hash=None,
            role="user",
            status="active",
            upload_enabled=True,
            is_email_verified=True,
            must_reset_password=False,
            avatar_path=None,
        )

        create_auth_identity(
            conn=conn,
            user_id=user_id,
            provider="discord",
            provider_user_id=parsed["provider_user_id"],
            provider_email=parsed.get("provider_email"),
            provider_display_name=parsed.get("provider_display_name") or parsed.get("provider_username"),
            is_enabled=True,
        )

        create_two_factor_settings(
            conn=conn,
            user_id=user_id,
            method="email",
            is_enabled=False,
            is_required=False,
        )

        log_auth_event(
            conn=conn,
            actor_user_id=user_id,
            action_type="auth.discord_register",
            target_type="user",
            target_id=str(user_id),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="Discord登録を完了しました。",
        )

        conn.commit()
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "registration")
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="Discord登録の完了に失敗しました。",
        )
    finally:
        _safe_close(conn)

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        user = get_user_by_user_key(conn, validated["user_key"])
        result = _create_authenticated_session_result(
            conn=conn,
            user=user,
            ip_address=ip_address,
            user_agent=user_agent,
            now_dt=now_dt,
            action_type="auth.discord_login",
            summary="Discord登録後にログインしました。",
        )
        conn.commit()
        return result
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="Discord登録後のログインに失敗しました。",
        )
    finally:
        _safe_close(conn)



def complete_registration(
    registration_token: str | None,
    user_key: str | None,
    display_name: str | None,
    password: str | None,
    terms_agreed,
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    try:
        validated = validate_register_complete_input(
            registration_token=registration_token,
            user_key=user_key,
            display_name=display_name,
            password=password,
            terms_agreed=terms_agreed,
        )
    except (AuthValidationError, AuthValidationErrors) as exc:
        return convert_validation_error_to_result(exc)

    conn = None
    now_dt = _utc_now(now)

    try:
        parsed = parse_email_registration_token(validated["registration_token"], now=now_dt)
        conn = _get_db_connection(autocommit=False)

        user = get_user_by_id(conn, parsed["user_id"])
        if user is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="invalid_registration_token",
                message="登録トークンが正しくありません。",
            )

        duplicate_user = get_user_by_user_key(conn, validated["user_key"])
        if duplicate_user is not None and duplicate_user["id"] != parsed["user_id"]:
            _safe_rollback(conn)
            return build_service_error(
                error_code="user_key_unavailable",
                message="この user_key はすでに使用されています。",
                field_errors=[
                    {
                        "field": "user_key",
                        "code": "user_key_unavailable",
                        "message": "この user_key はすでに使用されています。",
                    }
                ],
            )

        password_hash = hash_password(validated["password"])

        update_user_registration_profile(
            conn=conn,
            user_id=parsed["user_id"],
            user_key=validated["user_key"],
            display_name=validated["display_name"],
            primary_email=parsed.get("email"),
            is_email_verified=True,
            status="active",
            upload_enabled=True,
        )

        identity = get_identity_by_user_and_provider(conn, parsed["user_id"], "email_password")
        if identity is None:
            create_auth_identity(
                conn=conn,
                user_id=parsed["user_id"],
                provider="email_password",
                provider_user_id=None,
                provider_email=parsed.get("email"),
                provider_display_name=validated["display_name"],
                is_enabled=True,
            )

        create_password_credentials(
            conn=conn,
            user_id=parsed["user_id"],
            password_hash=password_hash,
        )

        if get_two_factor_settings_by_user_id(conn, parsed["user_id"]) is None:
            create_two_factor_settings(
                conn=conn,
                user_id=parsed["user_id"],
                method="email",
                is_enabled=False,
                is_required=False,
            )

        set_user_must_reset_password(conn, parsed["user_id"], False)

        log_auth_event(
            conn=conn,
            actor_user_id=parsed["user_id"],
            action_type="auth.register.complete",
            target_type="user",
            target_id=str(parsed["user_id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="アカウント登録を完了しました。",
        )

        conn.commit()
        return build_service_success(
            next_kind="redirect",
            next_to="/auth",
            message="アカウントを作成しました。ログインしてください。",
        )
    except AuthTokenError as exc:
        _safe_rollback(conn)
        return _token_error_to_result(exc, "registration")
    except (AuthSecurityError,) as exc:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message=exc.message,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="登録完了処理に失敗しました。",
        )
    finally:
        _safe_close(conn)

def get_current_user_by_session_token(
    session_token: str | None,
    now=None,
) -> dict | None:
    if session_token is None or str(session_token).strip() == "":
        return None

    conn = None
    now_dt = _utc_now(now)

    try:
        conn = _get_db_connection(autocommit=True)
        session_row = get_session_by_token_hash(conn, hash_session_token(str(session_token)))
        if session_row is None:
            return None
        if session_row.get("revoked_at") is not None:
            return None
        if _is_expired(session_row["expires_at"], now_dt):
            return None

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None:
            return None
        if user["status"] in {"deleted", "disabled"}:
            return None

        force_logout_after = user.get("force_logout_after")
        if force_logout_after is not None and _coerce_utc_datetime(session_row["created_at"]) < _coerce_utc_datetime(force_logout_after):
            return None

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if _is_two_factor_required(two_factor_settings):
            if session_row.get("two_factor_verified_at") is None:
                return None

        should_refresh = needs_session_refresh(session_row["last_seen_at"], now=now_dt)
        new_expires_at = build_refreshed_session_expiry(now=now_dt) if should_refresh else None

        return {
            "user": user,
            "session": session_row,
            "should_refresh": should_refresh,
            "new_expires_at": new_expires_at,
        }
    except Exception:
        return None
    finally:
        _safe_close(conn)


def get_current_user_profile(
    session_token: str | None,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    conn = None
    now_dt = _utc_now(now)

    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)
        if session_row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )
        if session_row.get("revoked_at") is not None or _is_expired(session_row["expires_at"], now_dt):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        force_logout_after = user.get("force_logout_after")
        if force_logout_after is not None and _coerce_utc_datetime(session_row["created_at"]) < _coerce_utc_datetime(force_logout_after):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if _is_two_factor_required(two_factor_settings):
            if session_row.get("two_factor_verified_at") is None:
                _safe_rollback(conn)
                return build_service_error(
                    error_code="not_authenticated",
                    message="ログインが必要です。",
                    clear_session_cookie=True,
                )

        should_refresh = needs_session_refresh(session_row["last_seen_at"], now=now_dt)
        refreshed_session_token = None
        if should_refresh:
            refreshed_expires_at = build_refreshed_session_expiry(now=now_dt)
            update_session_last_seen(
                conn=conn,
                session_id=session_row["id"],
                last_seen_at=now_dt,
                expires_at=refreshed_expires_at,
            )
            conn.commit()
            refreshed_session_token = str(session_token)
        else:
            conn.commit()

        created_at = user.get("created_at")
        created_at_text = None
        if isinstance(created_at, datetime):
            created_at_text = _to_app_isoformat(created_at)

        can_open_admin = str(user.get("role") or "") == "admin"
        avatar_path = user.get("avatar_path") or None
        avatar_url = f"/api/auth/avatar/{user['id']}" if avatar_path else None
        links = get_user_links(conn, user["id"])

        # Auto-grant year/role badges; commit handled inside
        try:
            ensure_auto_badges(conn, user["id"], user.get("role"), created_at)
            conn.commit()
        except Exception:
            try: conn.rollback()
            except Exception: pass

        # Load badge pool and display selection
        badge_pool = []
        display_badge_keys = []
        try:
            with conn.cursor() as _cur:
                _cur.execute("SHOW TABLES LIKE 'user_badges'")
                _has_badge_table = bool(_cur.fetchone())
            if _has_badge_table:
                with conn.cursor() as _cur:
                    _cur.execute(
                        "SELECT badge_key, granted_by, granted_at FROM user_badges WHERE user_id=%s ORDER BY granted_at ASC",
                        (user["id"],),
                    )
                    badge_pool = [
                        serialize_badge(r["badge_key"], granted_at=None, granted_by=r.get("granted_by"))
                        for r in (_cur.fetchall() or [])
                    ]
                with conn.cursor() as _cur:
                    _cur.execute("SELECT display_badges FROM users WHERE id=%s LIMIT 1", (user["id"],))
                    _row = _cur.fetchone()
                display_badge_keys = _parse_display_badges_py((_row or {}).get("display_badges"))
        except Exception:
            pass

        pw_creds = get_password_credentials_by_user_id(conn, user["id"])
        email_identity = get_identity_by_user_and_provider(conn, user["id"], "email_password")
        discord_identity = get_identity_by_user_and_provider(conn, user["id"], "discord")
        enabled_auth_providers: list[str] = []
        if email_identity is not None and bool(email_identity.get("is_enabled")):
            enabled_auth_providers.append("email_password")
        if discord_identity is not None and bool(discord_identity.get("is_enabled")):
            enabled_auth_providers.append("discord")

        registration_route = "unknown"
        if "discord" in enabled_auth_providers and "email_password" in enabled_auth_providers:
            registration_route = "discord_and_email"
        elif "discord" in enabled_auth_providers:
            registration_route = "discord"
        elif "email_password" in enabled_auth_providers or pw_creds is not None:
            registration_route = "email"

        return build_service_success(
            data={
                "user": {
                    "id": user["id"],
                    "user_key": user["user_key"],
                    "display_name": user["display_name"],
                    "bio": user.get("bio"),
                    "links": [{"id": lnk["id"], "url": lnk["url"]} for lnk in links],
                    "primary_email": user.get("primary_email"),
                    "avatar_url": avatar_url,
                    "role": user.get("role"),
                    "upload_enabled": bool(user.get("upload_enabled")),
                    "is_email_verified": bool(user.get("is_email_verified")),
                    "created_at": created_at_text,
                    "badge_pool": badge_pool,
                    "display_badges": display_badge_keys,
                },
                "security": {
                    "two_factor": {
                        "is_enabled": bool(two_factor_settings.get("is_enabled")) if two_factor_settings else False,
                        "is_required": bool(two_factor_settings.get("is_required")) if two_factor_settings else False,
                    },
                    "has_password": pw_creds is not None,
                    "has_discord": discord_identity is not None and bool(discord_identity.get("is_enabled")),
                    "auth_providers": enabled_auth_providers,
                    "registration_route": registration_route,
                    "discord_email": discord_identity.get("provider_email") if discord_identity and bool(discord_identity.get("is_enabled")) else None,
                },
                "features": {
                    "can_open_admin": can_open_admin,
                },
            },
            message="ログイン中ユーザー情報を取得しました。",
            session_token=refreshed_session_token,
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="ユーザー情報の取得に失敗しました。",
        )
    finally:
        _safe_close(conn)



def update_profile_for_current_session(
    session_token: str | None,
    display_name: str | None,
    user_key: str | None,
    bio: str | None = None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    errors = []
    validated_display_name = None
    validated_user_key = None
    validated_bio = None
    clear_bio = False

    if display_name is not None:
        try:
            validated_display_name = validate_display_name(display_name)
        except AuthValidationError as exc:
            errors.append({"field": exc.field, "code": exc.code, "message": exc.message})

    if user_key is not None:
        try:
            validated_user_key = validate_user_key(user_key)
        except AuthValidationError as exc:
            errors.append({"field": exc.field, "code": exc.code, "message": exc.message})

    if bio is not None:
        bio_stripped = bio.strip()
        if len(bio_stripped) > 300:
            errors.append({"field": "bio", "code": "bio_too_long", "message": "自己紹介文は300文字以内で入力してください。"})
        elif bio_stripped:
            validated_bio = bio_stripped
        else:
            clear_bio = True

    if errors:
        return build_service_error(
            error_code="validation_error",
            message="入力内容を確認してください。",
            field_errors=errors,
        )

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)
        if session_row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        if validated_user_key is not None and validated_user_key != user["user_key"]:
            existing = get_user_by_user_key(conn, validated_user_key)
            if existing is not None and existing["id"] != user["id"]:
                _safe_rollback(conn)
                return build_service_error(
                    error_code="user_key_unavailable",
                    message="このユーザーIDは既に使用されています。",
                    field_errors=[{"field": "user_key", "code": "user_key_unavailable", "message": "このユーザーIDは既に使用されています。"}],
                )

        update_user_profile(
            conn=conn,
            user_id=user["id"],
            display_name=validated_display_name,
            user_key=validated_user_key,
            bio=validated_bio,
            clear_bio=clear_bio,
        )
        conn.commit()

        return build_service_success(
            data={},
            message="プロフィールを更新しました。",
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="プロフィールの更新に失敗しました。",
        )
    finally:
        _safe_close(conn)


def update_avatar_for_current_session(
    session_token: str | None,
    avatar_path: str,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)
        if session_row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        update_user_profile(
            conn=conn,
            user_id=user["id"],
            avatar_path=avatar_path,
        )
        conn.commit()

        return build_service_success(
            data={"avatar_path": avatar_path, "user_id": user["id"]},
            message="アイコンを更新しました。",
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="アイコンの更新に失敗しました。",
        )
    finally:
        _safe_close(conn)


def delete_avatar_for_current_session(
    session_token: str | None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)
        if session_row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        old_avatar = user.get("avatar_path")
        update_user_profile(
            conn=conn,
            user_id=user["id"],
            clear_avatar=True,
        )
        conn.commit()

        return build_service_success(
            data={"old_avatar_path": old_avatar, "user_id": user["id"]},
            message="アイコンを削除しました。",
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="アイコンの削除に失敗しました。",
        )
    finally:
        _safe_close(conn)


def update_current_session_presence(
    session_token: str | None,
    visible: bool = True,
    now=None,
) -> dict:
    if session_token is None or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    conn = None
    now_dt = _utc_now(now)

    try:
        conn = _get_db_connection(autocommit=False)
        session_token_hash = hash_session_token(str(session_token))
        session_row = get_session_by_token_hash(conn, session_token_hash)
        if session_row is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )
        if session_row.get("revoked_at") is not None or _is_expired(session_row["expires_at"], now_dt):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        user = get_user_by_id(conn, session_row["user_id"])
        if user is None or user["status"] in {"deleted", "disabled"}:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        force_logout_after = user.get("force_logout_after")
        if force_logout_after is not None and _coerce_utc_datetime(session_row["created_at"]) < _coerce_utc_datetime(force_logout_after):
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        two_factor_settings = get_two_factor_settings_by_user_id(conn, user["id"])
        if _is_two_factor_required(two_factor_settings) and session_row.get("two_factor_verified_at") is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        refreshed_expires_at = build_refreshed_session_expiry(now=now_dt) if needs_session_refresh(session_row["last_seen_at"], now=now_dt) else None
        update_session_presence(
            conn=conn,
            session_id=session_row["id"],
            now_dt=now_dt,
            visible=bool(visible),
            expires_at=refreshed_expires_at,
        )
        conn.commit()
        return build_service_success(data={"visible": bool(visible)})
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="画面状態の更新に失敗しました。",
        )
    finally:
        _safe_close(conn)

def _get_conf() -> dict:
    conf_path = os.environ.get(
        "GALLERY_CONF",
        str(Path(__file__).with_name("gallery.conf")),
    )
    return load_conf(conf_path)


def _get_db_connection(autocommit: bool):
    conf = _get_conf()
    return db_conn(conf, autocommit=autocommit)


def _get_base_url(conf: dict) -> str:
    direct = conf.get("base_url")
    if isinstance(direct, str) and direct.strip() != "":
        return direct.strip()
    app_section = conf.get("app")
    if isinstance(app_section, dict):
        base_url = app_section.get("base_url")
        if isinstance(base_url, str) and base_url.strip() != "":
            return base_url.strip()
    site_section = conf.get("site")
    if isinstance(site_section, dict):
        base_url = site_section.get("base_url")
        if isinstance(base_url, str) and base_url.strip() != "":
            return base_url.strip()
    return DEFAULT_BASE_URL


def _get_app_timezone() -> ZoneInfo:
    conf = _get_conf()
    app_section = conf.get("app")
    if isinstance(app_section, dict):
        timezone_name = app_section.get("timezone")
        if isinstance(timezone_name, str) and timezone_name.strip() != "":
            try:
                return ZoneInfo(timezone_name.strip())
            except Exception:
                return ZoneInfo("Asia/Tokyo")
    return ZoneInfo("Asia/Tokyo")


def _to_app_isoformat(value: datetime) -> str:
    if value.tzinfo is None:
        aware = value.replace(tzinfo=timezone.utc)
    else:
        aware = value.astimezone(timezone.utc)
    return aware.astimezone(_get_app_timezone()).isoformat()


def _get_auth_conf() -> dict:
    conf = _get_conf()
    auth_section = conf.get("auth")
    if not isinstance(auth_section, dict):
        auth_section = {}

    return {
        "verify_code_expires_sec": int(auth_section.get("verify_code_expires_sec", DEFAULT_VERIFY_CODE_EXPIRES_SEC)),
        "two_factor_code_expires_sec": int(auth_section.get("two_factor_code_expires_sec", DEFAULT_TWO_FACTOR_CODE_EXPIRES_SEC)),
        "reset_token_expires_sec": int(auth_section.get("reset_token_expires_sec", DEFAULT_RESET_TOKEN_EXPIRES_SEC)),
        "verify_resend_cooldown_sec": int(auth_section.get("verify_resend_cooldown_sec", DEFAULT_VERIFY_RESEND_COOLDOWN_SEC)),
        "two_factor_resend_cooldown_sec": int(auth_section.get("two_factor_resend_cooldown_sec", DEFAULT_TWO_FACTOR_RESEND_COOLDOWN_SEC)),
        "verify_max_attempts": int(auth_section.get("verify_max_attempts", DEFAULT_VERIFY_MAX_ATTEMPTS)),
        "two_factor_max_attempts": int(auth_section.get("two_factor_max_attempts", DEFAULT_TWO_FACTOR_MAX_ATTEMPTS)),
    }


def _get_smtp_settings() -> dict:
    conf = _get_conf()
    smtp = conf.get("smtp")
    if isinstance(smtp, dict):
        settings = dict(smtp)
        settings.setdefault("base_url", _get_base_url(conf))
        return settings

    mail_section = conf.get("mail")
    if isinstance(mail_section, dict):
        smtp_section = mail_section.get("smtp")
        if isinstance(smtp_section, dict):
            settings = dict(smtp_section)
            settings.setdefault("base_url", _get_base_url(conf))
            return settings

    return {
        "host": "",
        "port": 25,
        "use_starttls": False,
        "use_auth": False,
        "from_email": "",
        "from_name": "Felixxsv Gallery",
        "base_url": _get_base_url(conf),
    }


def _get_discord_conf() -> dict:
    conf = _get_conf()
    discord = conf.get("discord")
    if not isinstance(discord, dict):
        discord = {}
    return {
        "client_id": str(discord.get("client_id", "")).strip(),
        "client_secret": str(discord.get("client_secret", "")).strip(),
        "redirect_uri": str(discord.get("redirect_uri", "")).strip(),
    }


_DISCORD_OAUTH_STATE_EXPIRES_SEC = 600

def _make_discord_state_token(now_dt: "datetime", action: str = "login") -> str:
    nonce = secrets.token_hex(16)
    ts = int(now_dt.timestamp())
    payload = f"{nonce}.{ts}.{action}"
    secret = _get_token_secret_bytes()
    sig = _hmac.new(secret, payload.encode(), "sha256").hexdigest()
    return f"{payload}.{sig}"


def _verify_discord_state_token(state: str, now_dt: "datetime") -> tuple[bool, str]:
    """Returns (is_valid, action)"""
    try:
        parts = state.split(".")
        if len(parts) != 4:
            return False, ""
        nonce, ts_str, action, sig = parts
        if action not in {"login", "link"}:
            return False, ""
        ts = int(ts_str)
        if abs(int(now_dt.timestamp()) - ts) > _DISCORD_OAUTH_STATE_EXPIRES_SEC:
            return False, ""
        payload = f"{nonce}.{ts}.{action}"
        secret = _get_token_secret_bytes()
        expected = _hmac.new(secret, payload.encode(), "sha256").hexdigest()
        if not _hmac.compare_digest(sig, expected):
            return False, ""
        return True, action
    except Exception:
        return False, ""


def _get_token_secret_bytes() -> bytes:
    secret = os.environ.get("GALLERY_AUTH_TOKEN_SECRET", "").strip()
    if not secret:
        raise RuntimeError("GALLERY_AUTH_TOKEN_SECRET が設定されていません。")
    return secret.encode("utf-8")


def _utc_now(now=None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if isinstance(now, datetime):
        if now.tzinfo is None:
            return now.replace(tzinfo=timezone.utc)
        return now.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _coerce_utc_datetime(value) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    raise ValueError("invalid datetime value")


def _shift_seconds(base_dt: datetime, seconds: int) -> datetime:
    return base_dt + timedelta(seconds=seconds)


def _is_expired(target, now_dt: datetime) -> bool:
    return _coerce_utc_datetime(target) <= now_dt


def _remaining_seconds(target, now_dt: datetime) -> int:
    remaining = int((_coerce_utc_datetime(target) - now_dt).total_seconds())
    return remaining if remaining > 0 else 0


def _coerce_app_local_datetime(value) -> datetime:
    tz = _get_app_timezone()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=tz)
        return value.astimezone(tz)
    raise ValueError("invalid datetime value")


def _remaining_cooldown(created_at, cooldown_sec: int, now_dt: datetime) -> int:
    if cooldown_sec <= 0:
        return 0
    created_local = _coerce_app_local_datetime(created_at)
    now_local = _coerce_app_local_datetime(now_dt)
    until_local = created_local + timedelta(seconds=cooldown_sec)
    remaining = int((until_local - now_local).total_seconds())
    return remaining if remaining > 0 else 0


def _safe_rollback(conn) -> None:
    if conn is None:
        return
    try:
        conn.rollback()
    except Exception:
        return


def _safe_close(conn) -> None:
    if conn is None:
        return
    try:
        conn.close()
    except Exception:
        return


def _check_user_login_status(user: dict, credentials: dict, now_dt: datetime) -> dict | None:
    if user["status"] == "deleted":
        return build_service_error(
            error_code="account_deleted",
            message="このアカウントは削除されています。",
        )
    if user["status"] == "disabled":
        return build_service_error(
            error_code="account_disabled",
            message="このアカウントは無効化されています。",
        )
    if user["status"] == "locked":
        return build_service_error(
            error_code="account_locked",
            message="アカウントが一時的にロックされています。",
        )
    locked_until = credentials.get("locked_until")
    if locked_until is not None and is_login_locked(locked_until, now=now_dt):
        return build_service_error(
            error_code="account_locked",
            message="アカウントが一時的にロックされています。",
            retry_after_sec=_remaining_seconds(locked_until, now_dt),
        )
    return None


def _build_login_verify_result(conn, user: dict, ip_address: bytes | None, user_agent: str | None, now_dt: datetime, preferred_language: str | None = None) -> dict | None:
    resolved_language = normalize_preferred_language(preferred_language) or "en-us"
    if bool(user.get("is_email_verified")):
        return None

    auth_conf = _get_auth_conf()
    verify_code = _generate_otp_code()
    expire_active_email_verifications(
        conn=conn,
        user_id=user["id"],
        purpose="signup",
        now=now_dt,
    )
    create_email_verification(
        conn=conn,
        user_id=user["id"],
        email=user["primary_email"],
        code_hash=hash_token_value(verify_code),
        purpose="signup",
        expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
    )
    verify_ticket = create_verify_ticket(
        user_id=user["id"],
        purpose="signup",
        email=user["primary_email"],
        preferred_language=resolved_language,
        expires_in_sec=auth_conf["verify_code_expires_sec"],
        now=now_dt,
    )
    log_auth_event(
        conn=conn,
        actor_user_id=user["id"],
        action_type="auth.login",
        target_type="user",
        target_id=str(user["id"]),
        result="success",
        ip_address=ip_address,
        user_agent=user_agent,
        summary="メール確認が必要です。",
    )
    return {
        "result": build_service_success(
            data={
                "verify_ticket": verify_ticket,
                "masked_email": mask_email_address(user["primary_email"]),
                "expires_in_sec": auth_conf["verify_code_expires_sec"],
                "resend_cooldown_sec": auth_conf["verify_resend_cooldown_sec"],
            },
            next_kind="verify_email",
            next_to=_build_verify_email_path(verify_ticket),
            message="メールアドレスの確認が必要です。",
        ),
        "mail_job": {
            "kind": "verification",
            "to_email": user["primary_email"],
            "code": verify_code,
            "purpose": "signup",
            "expires_in_sec": auth_conf["verify_code_expires_sec"],
            "display_name": user["display_name"],
            "preferred_language": resolved_language,
        },
    }


def _build_login_reset_result(conn, user: dict, ip_address: bytes | None, user_agent: str | None, now_dt: datetime, preferred_language: str | None = None) -> dict:
    resolved_language = normalize_preferred_language(preferred_language) or "en-us"
    auth_conf = _get_auth_conf()
    expire_active_password_reset_tokens(
        conn=conn,
        user_id=user["id"],
        now=now_dt,
    )
    reset_token = create_reset_token(
        user_id=user["id"],
        email=user["primary_email"],
        preferred_language=resolved_language,
        expires_in_sec=auth_conf["reset_token_expires_sec"],
        now=now_dt,
    )
    create_password_reset_token(
        conn=conn,
        user_id=user["id"],
        token_hash=hash_token_value(reset_token),
        requested_ip=ip_address,
        expires_at=_shift_seconds(now_dt, auth_conf["reset_token_expires_sec"]),
    )
    log_auth_event(
        conn=conn,
        actor_user_id=user["id"],
        action_type="auth.login",
        target_type="user",
        target_id=str(user["id"]),
        result="success",
        ip_address=ip_address,
        user_agent=user_agent,
        summary="パスワード再設定が必要です。",
    )
    reset_url = build_gallery_url(f"/auth/reset?token={reset_token}")
    return {
        "result": build_service_success(
            data={"reset_token": reset_token},
            next_kind="reset_password",
            next_to=f"/auth/reset?token={reset_token}",
            message="パスワードの再設定が必要です。",
        ),
        "mail_job": {
            "kind": "password_reset",
            "to_email": user["primary_email"],
            "reset_url": reset_url,
            "expires_in_sec": auth_conf["reset_token_expires_sec"],
            "display_name": user["display_name"],
            "preferred_language": resolved_language,
        },
    }



def _build_login_two_factor_result(conn, user: dict, ip_address: bytes | None, user_agent: str | None, now_dt: datetime, preferred_language: str | None = None) -> dict:
    resolved_language = normalize_preferred_language(preferred_language) or "en-us"
    auth_conf = _get_auth_conf()
    latest = get_active_two_factor_challenge(
        conn=conn,
        user_id=user["id"],
        purpose="login",
        now=now_dt,
    )

    if latest is not None:
        challenge_token = create_challenge_token(
            user_id=user["id"],
            auth_flow_id=generate_auth_flow_id(),
            email=user["primary_email"],
            preferred_language=resolved_language,
            expires_in_sec=_remaining_seconds(latest["expires_at"], now_dt),
            now=now_dt,
        )
        log_auth_event(
            conn=conn,
            actor_user_id=user["id"],
            action_type="auth.login",
            target_type="user",
            target_id=str(user["id"]),
            result="success",
            ip_address=ip_address,
            user_agent=user_agent,
            summary="送信済みの2段階認証コードを再利用します。",
            meta_json={"reused": True},
        )
        return {
            "result": build_service_success(
                data={
                    "challenge_token": challenge_token,
                    "masked_email": mask_email_address(user["primary_email"]),
                    "expires_in_sec": _remaining_seconds(latest["expires_at"], now_dt),
                    "resend_cooldown_sec": _remaining_cooldown(
                        latest["created_at"],
                        auth_conf["two_factor_resend_cooldown_sec"],
                        now_dt,
                    ),
                    "sent_now": False,
                },
                next_kind="verify_2fa",
                next_to=_build_verify_2fa_path(challenge_token),
                message="送信済みの認証コードを入力してください。",
            ),
            "mail_job": None,
        }

    code = _generate_otp_code()
    create_two_factor_challenge(
        conn=conn,
        user_id=user["id"],
        session_id=None,
        purpose="login",
        code_hash=hash_token_value(code),
        expires_at=_shift_seconds(now_dt, auth_conf["two_factor_code_expires_sec"]),
    )
    challenge_token = create_challenge_token(
        user_id=user["id"],
        auth_flow_id=generate_auth_flow_id(),
        email=user["primary_email"],
        preferred_language=resolved_language,
        expires_in_sec=auth_conf["two_factor_code_expires_sec"],
        now=now_dt,
    )
    log_auth_event(
        conn=conn,
        actor_user_id=user["id"],
        action_type="auth.login",
        target_type="user",
        target_id=str(user["id"]),
        result="success",
        ip_address=ip_address,
        user_agent=user_agent,
        summary="2段階認証が必要です。",
        meta_json={"reused": False},
    )
    return {
        "result": build_service_success(
            data={
                "challenge_token": challenge_token,
                "masked_email": mask_email_address(user["primary_email"]),
                "expires_in_sec": auth_conf["two_factor_code_expires_sec"],
                "resend_cooldown_sec": auth_conf["two_factor_resend_cooldown_sec"],
                "sent_now": True,
            },
            next_kind="verify_2fa",
            next_to=_build_verify_2fa_path(challenge_token),
            message="2段階認証が必要です。",
        ),
        "mail_job": {
            "kind": "two_factor",
            "to_email": user["primary_email"],
            "code": code,
            "expires_in_sec": auth_conf["two_factor_code_expires_sec"],
            "display_name": user["display_name"],
            "preferred_language": resolved_language,
        },
    }

def _create_authenticated_session_result(conn, user: dict, ip_address: bytes | None, user_agent: str | None, now_dt: datetime, action_type: str, summary: str, meta_json: dict | None = None) -> dict:
    session_token = generate_session_token()
    create_session(
        conn=conn,
        session_id=hash_session_token(session_token),
        user_id=user["id"],
        session_token_hash=hash_session_token(session_token),
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=build_session_expiry(now=now_dt),
        now_dt=now_dt,
        two_factor_verified_at=now_dt,
        two_factor_remember_until=None,
    )
    log_auth_event(
        conn=conn,
        actor_user_id=user["id"],
        action_type=action_type,
        target_type="user",
        target_id=str(user["id"]),
        result="success",
        ip_address=ip_address,
        user_agent=user_agent,
        summary=summary,
        meta_json=meta_json,
    )
    return build_service_success(
        data={},
        next_kind="redirect",
        next_to="/",
        message="ログインしました。",
        session_token=session_token,
    )


def _is_two_factor_required(two_factor_settings: dict | None) -> bool:
    if two_factor_settings is None:
        return False
    return bool(two_factor_settings.get("is_enabled")) or bool(two_factor_settings.get("is_required"))


def _dispatch_mail_job(mail_job: dict | None) -> None:
    if not mail_job:
        return
    kind = mail_job.get("kind")
    try:
        if kind == "verification":
            send_verification_email(
                smtp_settings=_get_smtp_settings(),
                to_email=mail_job["to_email"],
                code=mail_job["code"],
                purpose=mail_job["purpose"],
                expires_in_sec=mail_job["expires_in_sec"],
                display_name=mail_job.get("display_name"),
                preferred_language=mail_job.get("preferred_language"),
            )
            return
        if kind == "two_factor":
            send_two_factor_code_email(
                smtp_settings=_get_smtp_settings(),
                to_email=mail_job["to_email"],
                code=mail_job["code"],
                expires_in_sec=mail_job["expires_in_sec"],
                display_name=mail_job.get("display_name"),
                preferred_language=mail_job.get("preferred_language"),
            )
            return
        if kind == "password_reset":
            send_password_reset_email(
                smtp_settings=_get_smtp_settings(),
                to_email=mail_job["to_email"],
                reset_url=mail_job["reset_url"],
                expires_in_sec=mail_job["expires_in_sec"],
                display_name=mail_job.get("display_name"),
                preferred_language=mail_job.get("preferred_language"),
            )
    except AuthMailError:
        return


def _try_send_verification_email(to_email: str, code: str, purpose: str, expires_in_sec: int, display_name: str | None = None, preferred_language: str | None = None) -> None:
    _dispatch_mail_job(
        {
            "kind": "verification",
            "to_email": to_email,
            "code": code,
            "purpose": purpose,
            "expires_in_sec": expires_in_sec,
            "display_name": display_name,
            "preferred_language": preferred_language,
        }
    )


def _try_send_two_factor_email(to_email: str, code: str, expires_in_sec: int, display_name: str | None = None, preferred_language: str | None = None) -> None:
    _dispatch_mail_job(
        {
            "kind": "two_factor",
            "to_email": to_email,
            "code": code,
            "expires_in_sec": expires_in_sec,
            "display_name": display_name,
            "preferred_language": preferred_language,
        }
    )


def _try_send_password_reset_email(to_email: str, reset_url: str, expires_in_sec: int, display_name: str | None = None, preferred_language: str | None = None) -> None:
    _dispatch_mail_job(
        {
            "kind": "password_reset",
            "to_email": to_email,
            "reset_url": reset_url,
            "expires_in_sec": expires_in_sec,
            "display_name": display_name,
            "preferred_language": preferred_language,
        }
    )


def _generate_otp_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def _build_pending_user_key() -> str:
    return f"r_{secrets.token_hex(6)}"[:20]


def _build_register_verify_path(verify_ticket: str) -> str:
    return f"/auth/?{urlencode({'step': 'verify-email', 'ticket': verify_ticket})}"


def _build_register_complete_path(registration_token: str) -> str:
    return f"/auth/?{urlencode({'step': 'complete-registration', 'registration': registration_token})}"


def _build_verify_email_path(verify_ticket: str) -> str:
    return f"/auth/?{urlencode({'step': 'verify-email', 'ticket': verify_ticket})}"


def _build_verify_2fa_path(challenge_token: str) -> str:
    return f"/auth/?{urlencode({'step': 'verify-2fa', 'challenge': challenge_token})}"


def _build_candidate_user_key(provider_username: str | None, provider_display_name: str | None, provider_user_id: str) -> str:
    base = provider_username or provider_display_name or f"user_{provider_user_id[-6:]}"
    normalized = []
    for ch in str(base):
        if ch.isascii() and (ch.isalnum() or ch in {"_", "-"}):
            normalized.append(ch)
    candidate = "".join(normalized).strip("_-")
    if candidate == "" or not candidate[0].isalpha():
        candidate = f"u_{provider_user_id[-6:]}"
    if len(candidate) < 4:
        candidate = f"{candidate}_{provider_user_id[-4:]}"
    return candidate[:20]


def _token_error_to_result(exc: AuthTokenError, token_type: str) -> dict:
    if exc.code == "expired_token":
        if token_type == "ticket":
            return build_service_error(
                error_code="ticket_expired",
                message="確認トークンの有効期限が切れています。",
            )
        if token_type == "challenge":
            return build_service_error(
                error_code="challenge_expired",
                message="2段階認証トークンの有効期限が切れています。",
            )
        if token_type == "reset":
            return build_service_error(
                error_code="reset_token_expired",
                message="再設定トークンの有効期限が切れています。",
            )
        if token_type == "registration":
            return build_service_error(
                error_code="registration_token_expired",
                message="登録トークンの有効期限が切れています。",
            )
    if token_type == "ticket":
        return build_service_error(
            error_code="invalid_ticket",
            message="確認トークンが無効です。",
        )
    if token_type == "challenge":
        return build_service_error(
            error_code="invalid_challenge",
            message="2段階認証トークンが無効です。",
        )
    if token_type == "reset":
        return build_service_error(
            error_code="invalid_reset_token",
            message="再設定トークンが無効です。",
        )
    return build_service_error(
        error_code="invalid_registration_token",
        message="登録トークンが無効です。",
    )


def _get_user_quick(user_id: int) -> dict | None:
    conn = None
    try:
        conn = _get_db_connection(autocommit=True)
        return get_user_by_id(conn, user_id)
    except Exception:
        return None
    finally:
        _safe_close(conn)

_MAX_USER_LINKS = 5
_ALLOWED_LINK_SCHEME = "https"


def _validate_link_url(url: str) -> str:
    """Validate a link URL. Returns the cleaned URL or raises ValueError."""
    from urllib.parse import urlparse
    url = url.strip()
    if not url:
        raise ValueError("URLを入力してください。")
    if len(url) > 500:
        raise ValueError("URLは500文字以内で入力してください。")
    try:
        parsed = urlparse(url)
    except Exception:
        raise ValueError("URLの形式が正しくありません。")
    if parsed.scheme != _ALLOWED_LINK_SCHEME:
        raise ValueError("URLは https:// から始まる必要があります。")
    if not parsed.netloc:
        raise ValueError("URLの形式が正しくありません。")
    return url


def _resolve_session_user(conn, session_token: str) -> dict | None:
    """Return user dict for session token, or None if invalid."""
    token_hash = hash_session_token(session_token)
    session_row = get_session_by_token_hash(conn, token_hash)
    if session_row is None:
        return None
    user = get_user_by_id(conn, session_row["user_id"])
    if user is None or user["status"] in {"deleted", "disabled"}:
        return None
    return user


def add_link_for_current_session(
    session_token: str | None,
    url: str,
) -> dict:
    if not session_token or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    try:
        validated_url = _validate_link_url(url)
    except ValueError as exc:
        return build_service_error(
            error_code="validation_error",
            message=str(exc),
            field_errors=[{"field": "url", "code": "invalid_url", "message": str(exc)}],
        )

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        user = _resolve_session_user(conn, str(session_token))
        if user is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        current_count = count_user_links(conn, user["id"])
        if current_count >= _MAX_USER_LINKS:
            _safe_rollback(conn)
            return build_service_error(
                error_code="links_limit_reached",
                message=f"リンクは{_MAX_USER_LINKS}件まで登録できます。",
            )

        create_user_link(conn, user["id"], validated_url, current_count)
        conn.commit()

        links = get_user_links(conn, user["id"])
        return build_service_success(
            data={"links": [{"id": lnk["id"], "url": lnk["url"]} for lnk in links]},
            message="リンクを追加しました。",
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="リンクの追加に失敗しました。",
        )
    finally:
        _safe_close(conn)


def delete_link_for_current_session(
    session_token: str | None,
    link_id: int,
) -> dict:
    if not session_token or str(session_token).strip() == "":
        return build_service_error(
            error_code="not_authenticated",
            message="ログインが必要です。",
            clear_session_cookie=True,
        )

    conn = None
    try:
        conn = _get_db_connection(autocommit=False)
        user = _resolve_session_user(conn, str(session_token))
        if user is None:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_authenticated",
                message="ログインが必要です。",
                clear_session_cookie=True,
            )

        deleted = delete_user_link(conn, link_id, user["id"])
        if deleted == 0:
            _safe_rollback(conn)
            return build_service_error(
                error_code="not_found",
                message="リンクが見つかりません。",
                http_status=404,
            )

        reorder_user_links(conn, user["id"])
        conn.commit()

        links = get_user_links(conn, user["id"])
        return build_service_success(
            data={"links": [{"id": lnk["id"], "url": lnk["url"]} for lnk in links]},
            message="リンクを削除しました。",
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="リンクの削除に失敗しました。",
        )
    finally:
        _safe_close(conn)
