from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import uuid

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError


SESSION_TOKEN_BYTES = 32
DEFAULT_SESSION_EXPIRES_DAYS = 30
DEFAULT_SESSION_REFRESH_MINUTES = 30
DEFAULT_TWO_FACTOR_REMEMBER_DAYS = 30

DEFAULT_COOKIE_NAME = "gallery_session"
DEFAULT_COOKIE_PATH = "/gallery"
DEFAULT_COOKIE_SAMESITE = "lax"
DEFAULT_COOKIE_SECURE = True
DEFAULT_COOKIE_HTTPONLY = True

MAX_LOGIN_FAILED_ATTEMPTS = 5
DEFAULT_LOGIN_LOCK_MINUTES = 10

_PASSWORD_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


class AuthSecurityError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _ensure_positive_int(value: int, field: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise AuthSecurityError(
            "invalid_argument",
            f"{field} の値が正しくありません。",
        )
    return value


def _ensure_bool(value: bool, field: str) -> bool:
    if not isinstance(value, bool):
        raise AuthSecurityError(
            "invalid_argument",
            f"{field} の値が正しくありません。",
        )
    return value


def _ensure_timezone_aware(value: datetime) -> datetime:
    if not isinstance(value, datetime):
        raise AuthSecurityError(
            "invalid_datetime",
            "日時の形式が正しくありません。",
        )
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _utc_now(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    return _ensure_timezone_aware(now)


def _validate_cookie_samesite(value: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise AuthSecurityError(
            "invalid_cookie_samesite",
            "SameSite の値が正しくありません。",
        )
    normalized = value.strip().lower()
    if normalized not in {"lax", "strict", "none"}:
        raise AuthSecurityError(
            "invalid_cookie_samesite",
            "SameSite の値が正しくありません。",
        )
    return normalized


def hash_password(password: str) -> str:
    if not isinstance(password, str):
        raise AuthSecurityError(
            "invalid_password",
            "パスワードの形式が正しくありません。",
        )
    try:
        return _PASSWORD_HASHER.hash(password)
    except Exception as exc:
        raise AuthSecurityError(
            "password_hash_failed",
            "パスワードのハッシュ化に失敗しました。",
        ) from exc


def verify_password(password: str, password_hash: str) -> bool:
    if not isinstance(password, str):
        raise AuthSecurityError(
            "invalid_password",
            "パスワードの形式が正しくありません。",
        )
    if not isinstance(password_hash, str) or password_hash.strip() == "":
        raise AuthSecurityError(
            "invalid_password_hash",
            "保存済みパスワードの形式が正しくありません。",
        )
    try:
        return _PASSWORD_HASHER.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except (InvalidHash, VerificationError) as exc:
        raise AuthSecurityError(
            "password_verify_failed",
            "パスワード照合に失敗しました。",
        ) from exc
    except Exception as exc:
        raise AuthSecurityError(
            "password_verify_failed",
            "パスワード照合に失敗しました。",
        ) from exc


def needs_password_rehash(password_hash: str) -> bool:
    if not isinstance(password_hash, str) or password_hash.strip() == "":
        raise AuthSecurityError(
            "invalid_password_hash",
            "保存済みパスワードの形式が正しくありません。",
        )
    try:
        return _PASSWORD_HASHER.check_needs_rehash(password_hash)
    except (InvalidHash, VerificationError) as exc:
        raise AuthSecurityError(
            "password_rehash_check_failed",
            "パスワードハッシュの確認に失敗しました。",
        ) from exc
    except Exception as exc:
        raise AuthSecurityError(
            "password_rehash_check_failed",
            "パスワードハッシュの確認に失敗しました。",
        ) from exc


def generate_session_token(token_bytes: int = SESSION_TOKEN_BYTES) -> str:
    size = _ensure_positive_int(token_bytes, "token_bytes")
    try:
        return secrets.token_urlsafe(size)
    except Exception as exc:
        raise AuthSecurityError(
            "session_token_generate_failed",
            "セッショントークンの生成に失敗しました。",
        ) from exc


def hash_token_value(token_value: str) -> str:
    if not isinstance(token_value, str) or token_value == "":
        raise AuthSecurityError(
            "invalid_token_value",
            "トークン値の形式が正しくありません。",
        )
    try:
        return hashlib.sha256(token_value.encode("utf-8")).hexdigest()
    except Exception as exc:
        raise AuthSecurityError(
            "token_hash_failed",
            "トークンのハッシュ化に失敗しました。",
        ) from exc


def hash_session_token(session_token: str) -> str:
    return hash_token_value(session_token)


def generate_session_id() -> str:
    try:
        return str(uuid.uuid4())
    except Exception as exc:
        raise AuthSecurityError(
            "session_id_generate_failed",
            "セッションIDの生成に失敗しました。",
        ) from exc


def build_session_expiry(
    now: datetime | None = None,
    expires_days: int = DEFAULT_SESSION_EXPIRES_DAYS,
) -> datetime:
    days = _ensure_positive_int(expires_days, "expires_days")
    return _utc_now(now) + timedelta(days=days)


def needs_session_refresh(
    last_seen_at: datetime,
    now: datetime | None = None,
    refresh_after_minutes: int = DEFAULT_SESSION_REFRESH_MINUTES,
) -> bool:
    refresh_minutes = _ensure_positive_int(refresh_after_minutes, "refresh_after_minutes")
    last_seen = _ensure_timezone_aware(last_seen_at)
    now_dt = _utc_now(now)
    return last_seen + timedelta(minutes=refresh_minutes) <= now_dt


def build_refreshed_session_expiry(
    now: datetime | None = None,
    expires_days: int = DEFAULT_SESSION_EXPIRES_DAYS,
) -> datetime:
    return build_session_expiry(now=now, expires_days=expires_days)


def build_two_factor_remember_until(
    now: datetime | None = None,
    remember_days: int = DEFAULT_TWO_FACTOR_REMEMBER_DAYS,
) -> datetime:
    days = _ensure_positive_int(remember_days, "remember_days")
    return _utc_now(now) + timedelta(days=days)


def is_two_factor_remember_valid(
    remember_until: datetime | None,
    now: datetime | None = None,
) -> bool:
    if remember_until is None:
        return False
    remember_dt = _ensure_timezone_aware(remember_until)
    now_dt = _utc_now(now)
    return remember_dt > now_dt


def build_session_cookie_max_age(
    expires_days: int = DEFAULT_SESSION_EXPIRES_DAYS,
) -> int:
    days = _ensure_positive_int(expires_days, "expires_days")
    return days * 24 * 60 * 60


def build_session_cookie_options(
    max_age_sec: int,
    path: str = DEFAULT_COOKIE_PATH,
    secure: bool = DEFAULT_COOKIE_SECURE,
    httponly: bool = DEFAULT_COOKIE_HTTPONLY,
    samesite: str = DEFAULT_COOKIE_SAMESITE,
) -> dict:
    max_age = _ensure_positive_int(max_age_sec, "max_age_sec")
    if not isinstance(path, str) or path.strip() == "" or not path.startswith("/"):
        raise AuthSecurityError(
            "invalid_cookie_path",
            "Cookie path の値が正しくありません。",
        )
    secure_value = _ensure_bool(secure, "secure")
    httponly_value = _ensure_bool(httponly, "httponly")
    samesite_value = _validate_cookie_samesite(samesite)
    if samesite_value == "none" and not secure_value:
        raise AuthSecurityError(
            "invalid_cookie_options",
            "SameSite=None の場合は Secure=true が必要です。",
        )
    return {
        "max_age": max_age,
        "path": path,
        "secure": secure_value,
        "httponly": httponly_value,
        "samesite": samesite_value,
    }


def build_clear_session_cookie_options(
    path: str = DEFAULT_COOKIE_PATH,
    secure: bool = DEFAULT_COOKIE_SECURE,
    httponly: bool = DEFAULT_COOKIE_HTTPONLY,
    samesite: str = DEFAULT_COOKIE_SAMESITE,
) -> dict:
    if not isinstance(path, str) or path.strip() == "" or not path.startswith("/"):
        raise AuthSecurityError(
            "invalid_cookie_path",
            "Cookie path の値が正しくありません。",
        )
    secure_value = _ensure_bool(secure, "secure")
    httponly_value = _ensure_bool(httponly, "httponly")
    samesite_value = _validate_cookie_samesite(samesite)
    if samesite_value == "none" and not secure_value:
        raise AuthSecurityError(
            "invalid_cookie_options",
            "SameSite=None の場合は Secure=true が必要です。",
        )
    return {
        "path": path,
        "secure": secure_value,
        "httponly": httponly_value,
        "samesite": samesite_value,
    }


def is_login_locked(
    locked_until: datetime | None,
    now: datetime | None = None,
) -> bool:
    if locked_until is None:
        return False
    locked_dt = _ensure_timezone_aware(locked_until)
    now_dt = _utc_now(now)
    return locked_dt > now_dt


def build_login_locked_until(
    now: datetime | None = None,
    lock_minutes: int = DEFAULT_LOGIN_LOCK_MINUTES,
) -> datetime:
    minutes = _ensure_positive_int(lock_minutes, "lock_minutes")
    return _utc_now(now) + timedelta(minutes=minutes)


def should_lock_login_attempt(
    failed_attempts: int,
    max_failed_attempts: int = MAX_LOGIN_FAILED_ATTEMPTS,
) -> bool:
    if not isinstance(failed_attempts, int) or failed_attempts < 0:
        raise AuthSecurityError(
            "invalid_argument",
            "failed_attempts の値が正しくありません。",
        )
    max_attempts = _ensure_positive_int(max_failed_attempts, "max_failed_attempts")
    return failed_attempts >= max_attempts