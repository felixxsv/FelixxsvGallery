from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
import hashlib
import hmac
import os
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from db import load_conf


DEFAULT_COOKIE_NAME = "gallery_session"
DEFAULT_COOKIE_PATH = "/gallery"
DEFAULT_COOKIE_HTTPONLY = True
DEFAULT_COOKIE_SAMESITE = "lax"
DEFAULT_COOKIE_SECURE = True
DEFAULT_SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30
DEFAULT_SESSION_REFRESH_INTERVAL_SEC = 60 * 15
DEFAULT_LOGIN_LOCK_THRESHOLD = 5
DEFAULT_LOGIN_LOCK_SEC = 60 * 15
DEFAULT_TWO_FACTOR_REMEMBER_DAYS = 30


class AuthSecurityError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@lru_cache(maxsize=1)
def _get_conf() -> dict:
    conf_path = os.environ.get(
        "GALLERY_CONF",
        str(Path(__file__).with_name("gallery.conf")),
    )
    return load_conf(conf_path)


def _get_app_conf() -> dict:
    conf = _get_conf()
    app_conf = conf.get("app")
    if isinstance(app_conf, dict):
        return app_conf
    return {}


def _coerce_bool(value, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return default


def _utc_now(now=None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if isinstance(now, datetime):
        if now.tzinfo is None:
            return now.replace(tzinfo=timezone.utc)
        return now.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _get_password_hasher() -> PasswordHasher:
    return PasswordHasher()


def get_cookie_secure() -> bool:
    app_conf = _get_app_conf()
    return _coerce_bool(app_conf.get("cookie_secure"), DEFAULT_COOKIE_SECURE)


def build_session_cookie_max_age() -> int:
    return DEFAULT_SESSION_MAX_AGE_SEC


def build_session_cookie_options(max_age_sec: int | None = None) -> dict:
    resolved_max_age = int(max_age_sec or build_session_cookie_max_age())
    return {
        "max_age": resolved_max_age,
        "path": DEFAULT_COOKIE_PATH,
        "httponly": DEFAULT_COOKIE_HTTPONLY,
        "samesite": DEFAULT_COOKIE_SAMESITE,
        "secure": get_cookie_secure(),
    }


def build_clear_session_cookie_options() -> dict:
    return {
        "path": DEFAULT_COOKIE_PATH,
        "httponly": DEFAULT_COOKIE_HTTPONLY,
        "samesite": DEFAULT_COOKIE_SAMESITE,
        "secure": get_cookie_secure(),
    }


def generate_session_id() -> str:
    return secrets.token_urlsafe(24)


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(session_token: str) -> str:
    if not isinstance(session_token, str) or session_token.strip() == "":
        raise AuthSecurityError(
            "invalid_session_token",
            "セッショントークンが正しくありません。",
        )
    return hashlib.sha256(session_token.encode("utf-8")).hexdigest()


def hash_token_value(token_value: str) -> str:
    if not isinstance(token_value, str) or token_value.strip() == "":
        raise AuthSecurityError(
            "invalid_token_value",
            "トークン値が正しくありません。",
        )
    return hashlib.sha256(token_value.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    if not isinstance(password, str) or password == "":
        raise AuthSecurityError(
            "invalid_password",
            "パスワードが正しくありません。",
        )
    try:
        return _get_password_hasher().hash(password)
    except Exception as exc:
        raise AuthSecurityError(
            "password_hash_failed",
            "パスワードのハッシュ化に失敗しました。",
        ) from exc


def verify_password(password: str, password_hash: str) -> bool:
    if not isinstance(password, str) or password == "":
        return False
    if not isinstance(password_hash, str) or password_hash.strip() == "":
        return False
    try:
        return bool(_get_password_hasher().verify(password_hash, password))
    except VerifyMismatchError:
        return False
    except InvalidHashError:
        return False
    except Exception as exc:
        raise AuthSecurityError(
            "password_verify_failed",
            "パスワード確認に失敗しました。",
        ) from exc


def build_session_expiry(now=None) -> datetime:
    base_now = _utc_now(now)
    return base_now + timedelta(seconds=DEFAULT_SESSION_MAX_AGE_SEC)


def build_refreshed_session_expiry(now=None) -> datetime:
    return build_session_expiry(now=now)


def needs_session_refresh(last_seen_at, now=None) -> bool:
    if not isinstance(last_seen_at, datetime):
        return True
    last_seen = last_seen_at
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    else:
        last_seen = last_seen.astimezone(timezone.utc)
    current = _utc_now(now)
    return (current - last_seen).total_seconds() >= DEFAULT_SESSION_REFRESH_INTERVAL_SEC


def should_lock_login_attempt(failed_attempts: int) -> bool:
    return int(failed_attempts) >= DEFAULT_LOGIN_LOCK_THRESHOLD


def build_login_locked_until(now=None) -> datetime:
    base_now = _utc_now(now)
    return base_now + timedelta(seconds=DEFAULT_LOGIN_LOCK_SEC)


def is_login_locked(locked_until, now=None) -> bool:
    if locked_until is None:
        return False
    if not isinstance(locked_until, datetime):
        return False
    current = _utc_now(now)
    target = locked_until
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    else:
        target = target.astimezone(timezone.utc)
    return target > current


def build_two_factor_remember_until(now=None) -> datetime:
    base_now = _utc_now(now)
    return base_now + timedelta(days=DEFAULT_TWO_FACTOR_REMEMBER_DAYS)


def constant_time_equals(left: str, right: str) -> bool:
    if not isinstance(left, str) or not isinstance(right, str):
        return False
    return hmac.compare_digest(left, right)