from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import urlencode
import os
import secrets
import uuid

from db import db_conn, load_conf
from auth_mail import AuthMailError, send_password_reset_email, send_two_factor_code_email, send_verification_email
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
    update_auth_identity_last_used,
    update_password_failed_attempts,
    update_password_hash,
    update_two_factor_settings,
    update_user_profile,
    update_user_registration_profile,
    set_user_must_reset_password,
    create_audit_log,
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
    DEFAULT_SESSION_REFRESH_INTERVAL_SEC,
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
)


DEFAULT_VERIFY_CODE_EXPIRES_SEC = 900
DEFAULT_TWO_FACTOR_CODE_EXPIRES_SEC = 300
DEFAULT_RESET_TOKEN_EXPIRES_SEC = 1800
DEFAULT_VERIFY_RESEND_COOLDOWN_SEC = 60
DEFAULT_TWO_FACTOR_RESEND_COOLDOWN_SEC = 60
DEFAULT_VERIFY_MAX_ATTEMPTS = 5
DEFAULT_TWO_FACTOR_MAX_ATTEMPTS = 5
DEFAULT_BASE_URL = "https://felixxsv.net"
DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_SEC = 30
DEFAULT_PRESENCE_ONLINE_THRESHOLD_SEC = 90




def _build_presence_payload(conf: dict | None = None) -> dict:
    resolved = conf or _get_auth_conf()
    return {
        "heartbeat_interval_sec": int(resolved.get("presence_heartbeat_interval_sec") or DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_SEC),
        "online_threshold_sec": int(resolved.get("presence_online_threshold_sec") or DEFAULT_PRESENCE_ONLINE_THRESHOLD_SEC),
    }


def _should_refresh_session_expiry(expires_at, now_dt: datetime) -> bool:
    try:
        expires_dt = _coerce_utc_datetime(expires_at)
    except Exception:
        return True
    return (expires_dt - now_dt).total_seconds() <= DEFAULT_SESSION_REFRESH_INTERVAL_SEC


def get_presence_runtime_conf() -> dict:
    return _build_presence_payload()

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

        status_result = _check_user_login_status(user, credentials, now_dt)
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
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
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
                next_to="/gallery/",
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
            next_to="/gallery/",
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
            next_to="/gallery/",
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

        reset_token = create_reset_token(
            user_id=user["id"],
            email=user["primary_email"],
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

    reset_url = build_gallery_url(f"/gallery/auth/reset?token={reset_token}")
    _try_send_password_reset_email(
        to_email=user["primary_email"],
        reset_url=reset_url,
        expires_in_sec=auth_conf["reset_token_expires_sec"],
        display_name=user["display_name"],
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
            next_to="/gallery/auth",
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
            next_to="/gallery/auth/reset/done",
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


def start_discord_oauth(now=None) -> dict:
    return build_service_error(
        error_code="discord_oauth_not_implemented",
        message="Discord OAuth はまだ未実装です。",
    )


def start_two_factor_setup_for_current_session(
    session_token: str | None,
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
    ip_address: bytes | None = None,
    user_agent: str | None = None,
    now=None,
) -> dict:
    return build_service_error(
        error_code="discord_oauth_not_implemented",
        message="Discord OAuth callback はまだ未実装です。",
    )


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
        return build_service_success(
            data={
                "discord_profile": {
                    "provider_user_id": parsed["provider_user_id"],
                    "provider_email": parsed.get("provider_email"),
                    "provider_display_name": parsed.get("provider_display_name"),
                    "provider_username": parsed.get("provider_username"),
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


def complete_discord_registration(
    registration_token: str | None,
    user_key: str | None,
    display_name: str | None,
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
    auth_conf = _get_auth_conf()
    verify_code = None
    verify_ticket = None
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
            is_email_verified=False,
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

        if parsed.get("provider_email"):
            verify_code = _generate_otp_code()
            create_email_verification(
                conn=conn,
                user_id=user_id,
                email=parsed["provider_email"],
                code_hash=hash_token_value(verify_code),
                purpose="signup",
                expires_at=_shift_seconds(now_dt, auth_conf["verify_code_expires_sec"]),
            )
            verify_ticket = create_verify_ticket(
                user_id=user_id,
                purpose="signup",
                email=parsed["provider_email"],
                expires_in_sec=auth_conf["verify_code_expires_sec"],
                now=now_dt,
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

    if parsed.get("provider_email") and verify_ticket is not None and verify_code is not None:
        _try_send_verification_email(
            to_email=parsed["provider_email"],
            code=verify_code,
            purpose="signup",
            expires_in_sec=auth_conf["verify_code_expires_sec"],
            display_name=validated["display_name"],
        )
        return build_service_success(
            data={
                "verify_ticket": verify_ticket,
                "masked_email": mask_email_address(parsed["provider_email"]),
                "expires_in_sec": auth_conf["verify_code_expires_sec"],
                "resend_cooldown_sec": auth_conf["verify_resend_cooldown_sec"],
            },
            next_kind="verify_email",
            next_to=_build_verify_email_path(verify_ticket),
            message="確認コードを送信しました。",
        )

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
            next_to="/gallery/auth",
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



def touch_current_session_presence(
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
    auth_conf = _get_auth_conf()

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

        refreshed_expires_at = build_refreshed_session_expiry(now=now_dt) if _should_refresh_session_expiry(session_row.get("expires_at"), now_dt) else None
        update_session_last_seen(
            conn=conn,
            session_id=session_row["id"],
            last_seen_at=now_dt,
            expires_at=refreshed_expires_at,
        )
        conn.commit()

        return build_service_success(
            data={
                "presence": _build_presence_payload(auth_conf),
            },
            message="presence updated",
        )
    except Exception:
        _safe_rollback(conn)
        return build_service_error(
            error_code="server_error",
            message="接続状態の更新に失敗しました。",
        )
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
        return build_service_success(
            data={
                "user": {
                    "id": user["id"],
                    "user_key": user["user_key"],
                    "display_name": user["display_name"],
                    "primary_email": user.get("primary_email"),
                    "role": user.get("role"),
                    "upload_enabled": bool(user.get("upload_enabled")),
                    "is_email_verified": bool(user.get("is_email_verified")),
                    "created_at": created_at_text,
                },
                "security": {
                    "two_factor": {
                        "is_enabled": bool(two_factor_settings.get("is_enabled")) if two_factor_settings else False,
                        "is_required": bool(two_factor_settings.get("is_required")) if two_factor_settings else False,
                    }
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
        "presence_heartbeat_interval_sec": max(10, int(auth_section.get("presence_heartbeat_interval_sec", DEFAULT_PRESENCE_HEARTBEAT_INTERVAL_SEC))),
        "presence_online_threshold_sec": max(20, int(auth_section.get("presence_online_threshold_sec", DEFAULT_PRESENCE_ONLINE_THRESHOLD_SEC))),
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


def _build_login_verify_result(conn, user: dict, ip_address: bytes | None, user_agent: str | None, now_dt: datetime) -> dict | None:
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
        },
    }


def _build_login_reset_result(conn, user: dict, ip_address: bytes | None, user_agent: str | None, now_dt: datetime) -> dict:
    auth_conf = _get_auth_conf()
    expire_active_password_reset_tokens(
        conn=conn,
        user_id=user["id"],
        now=now_dt,
    )
    reset_token = create_reset_token(
        user_id=user["id"],
        email=user["primary_email"],
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
    reset_url = build_gallery_url(f"/gallery/auth/reset?token={reset_token}")
    return {
        "result": build_service_success(
            data={"reset_token": reset_token},
            next_kind="reset_password",
            next_to=f"/gallery/auth/reset?token={reset_token}",
            message="パスワードの再設定が必要です。",
        ),
        "mail_job": {
            "kind": "password_reset",
            "to_email": user["primary_email"],
            "reset_url": reset_url,
            "expires_in_sec": auth_conf["reset_token_expires_sec"],
            "display_name": user["display_name"],
        },
    }



def _build_login_two_factor_result(conn, user: dict, ip_address: bytes | None, user_agent: str | None, now_dt: datetime) -> dict:
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
        next_to="/gallery/",
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
            )
            return
        if kind == "two_factor":
            send_two_factor_code_email(
                smtp_settings=_get_smtp_settings(),
                to_email=mail_job["to_email"],
                code=mail_job["code"],
                expires_in_sec=mail_job["expires_in_sec"],
                display_name=mail_job.get("display_name"),
            )
            return
        if kind == "password_reset":
            send_password_reset_email(
                smtp_settings=_get_smtp_settings(),
                to_email=mail_job["to_email"],
                reset_url=mail_job["reset_url"],
                expires_in_sec=mail_job["expires_in_sec"],
                display_name=mail_job.get("display_name"),
            )
    except AuthMailError:
        return


def _try_send_verification_email(to_email: str, code: str, purpose: str, expires_in_sec: int, display_name: str | None = None) -> None:
    _dispatch_mail_job(
        {
            "kind": "verification",
            "to_email": to_email,
            "code": code,
            "purpose": purpose,
            "expires_in_sec": expires_in_sec,
            "display_name": display_name,
        }
    )


def _try_send_two_factor_email(to_email: str, code: str, expires_in_sec: int, display_name: str | None = None) -> None:
    _dispatch_mail_job(
        {
            "kind": "two_factor",
            "to_email": to_email,
            "code": code,
            "expires_in_sec": expires_in_sec,
            "display_name": display_name,
        }
    )


def _try_send_password_reset_email(to_email: str, reset_url: str, expires_in_sec: int, display_name: str | None = None) -> None:
    _dispatch_mail_job(
        {
            "kind": "password_reset",
            "to_email": to_email,
            "reset_url": reset_url,
            "expires_in_sec": expires_in_sec,
            "display_name": display_name,
        }
    )


def _generate_otp_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def _build_pending_user_key() -> str:
    return f"r_{secrets.token_hex(6)}"[:20]


def _build_register_verify_path(verify_ticket: str) -> str:
    return f"/gallery/auth/?{urlencode({'step': 'verify-email', 'ticket': verify_ticket})}"


def _build_register_complete_path(registration_token: str) -> str:
    return f"/gallery/auth/?{urlencode({'step': 'complete-registration', 'registration': registration_token})}"


def _build_verify_email_path(verify_ticket: str) -> str:
    return f"/gallery/auth/verify?{urlencode({'mode': 'email', 'ticket': verify_ticket})}"


def _build_verify_2fa_path(challenge_token: str) -> str:
    return f"/gallery/auth/verify?{urlencode({'mode': '2fa', 'challenge': challenge_token})}"


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