from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone


DEFAULT_VERIFY_TICKET_EXPIRES_SEC = 900
DEFAULT_CHALLENGE_TOKEN_EXPIRES_SEC = 300
DEFAULT_REGISTRATION_TOKEN_EXPIRES_SEC = 900
DEFAULT_RESET_TOKEN_EXPIRES_SEC = 1800
DEFAULT_EMAIL_REGISTRATION_TOKEN_EXPIRES_SEC = 1800

_RESERVED_PAYLOAD_KEYS = {"kind", "sub", "iat", "exp", "jti"}
_VERIFY_PURPOSES = {"signup", "email_signup", "email_change", "2fa_setup", "2fa_disable"}
_CHALLENGE_PURPOSE = "login"
_REGISTRATION_PROVIDER = "discord"


class AuthTokenError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class InvalidAuthTokenError(AuthTokenError):
    def __init__(self, message: str = "トークンが不正です。") -> None:
        super().__init__("invalid_token", message)


class ExpiredAuthTokenError(AuthTokenError):
    def __init__(self, message: str = "トークンの有効期限が切れています。") -> None:
        super().__init__("expired_token", message)


class WrongTokenKindError(AuthTokenError):
    def __init__(self, expected_kind: str, actual_kind: str | None) -> None:
        self.expected_kind = expected_kind
        self.actual_kind = actual_kind
        super().__init__("wrong_token_kind", "トークン種別が正しくありません。")


def _get_token_secret() -> bytes:
    secret = os.environ.get("GALLERY_AUTH_TOKEN_SECRET", "").strip()
    if not secret:
        raise AuthTokenError(
            "missing_token_secret",
            "トークン署名鍵が設定されていません。",
        )
    return secret.encode("utf-8")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode((value + padding).encode("ascii"))
    except Exception as exc:
        raise InvalidAuthTokenError() from exc


def _build_now_ts(now: int | float | datetime | None = None) -> int:
    if now is None:
        return int(datetime.now(timezone.utc).timestamp())
    if isinstance(now, datetime):
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        else:
            now = now.astimezone(timezone.utc)
        return int(now.timestamp())
    if isinstance(now, (int, float)):
        return int(now)
    raise AuthTokenError("invalid_now", "現在時刻の形式が正しくありません。")


def _build_jti() -> str:
    return str(uuid.uuid4())


def _extract_required(payload: dict, key: str):
    if key not in payload:
        raise InvalidAuthTokenError()
    value = payload[key]
    if value is None:
        raise InvalidAuthTokenError()
    return value


def _coerce_user_id(value) -> int:
    try:
        return int(value)
    except Exception as exc:
        raise InvalidAuthTokenError() from exc


def _ensure_non_empty_string(value, code: str = "invalid_token_payload") -> str:
    if not isinstance(value, str):
        raise AuthTokenError(code, "トークンpayloadの形式が正しくありません。")
    normalized = value.strip()
    if normalized == "":
        raise AuthTokenError(code, "トークンpayloadの形式が正しくありません。")
    return normalized


def _parse_and_validate_token(
    token: str,
    expected_kind: str,
    now: int | float | datetime | None = None,
) -> dict:
    payload = unsign_token(token)
    assert_token_kind(payload, expected_kind)
    assert_token_not_expired(payload, now=now)
    return payload


def build_token_payload(
    kind: str,
    subject: str | int,
    expires_in_sec: int,
    extra: dict | None = None,
    now: int | float | datetime | None = None,
) -> dict:
    if not isinstance(kind, str) or kind.strip() == "":
        raise AuthTokenError("invalid_kind", "トークン種別が不正です。")
    if isinstance(subject, str):
        if subject.strip() == "":
            raise AuthTokenError("invalid_subject", "トークン対象が不正です。")
        normalized_subject: str | int = subject
    elif isinstance(subject, int):
        if subject <= 0:
            raise AuthTokenError("invalid_subject", "トークン対象が不正です。")
        normalized_subject = subject
    else:
        raise AuthTokenError("invalid_subject", "トークン対象が不正です。")
    if not isinstance(expires_in_sec, int) or expires_in_sec <= 0:
        raise AuthTokenError("invalid_expiry", "トークン有効期限が不正です。")

    iat = _build_now_ts(now)
    exp = iat + expires_in_sec
    payload = {
        "kind": kind,
        "sub": normalized_subject,
        "iat": iat,
        "exp": exp,
        "jti": _build_jti(),
    }

    if extra is not None:
        if not isinstance(extra, dict):
            raise AuthTokenError("invalid_extra_payload", "追加payloadの形式が不正です。")
        for key in extra:
            if key in _RESERVED_PAYLOAD_KEYS:
                raise AuthTokenError(
                    "reserved_payload_key",
                    "予約済みpayloadキーは上書きできません。",
                )
        payload.update(extra)

    return payload


def sign_payload(payload: dict) -> str:
    if not isinstance(payload, dict):
        raise InvalidAuthTokenError()
    for key in ("kind", "sub", "iat", "exp", "jti"):
        _extract_required(payload, key)

    try:
        raw_payload = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except Exception as exc:
        raise AuthTokenError("payload_serialize_failed", "トークンpayloadの生成に失敗しました。") from exc

    payload_b64 = _b64url_encode(raw_payload)
    secret = _get_token_secret()
    signature = hmac.new(
        secret,
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    signature_b64 = _b64url_encode(signature)
    return f"{payload_b64}.{signature_b64}"


def unsign_token(token: str) -> dict:
    if not isinstance(token, str) or token.strip() == "":
        raise InvalidAuthTokenError()

    parts = token.split(".")
    if len(parts) != 2:
        raise InvalidAuthTokenError()

    payload_b64, signature_b64 = parts
    if payload_b64 == "" or signature_b64 == "":
        raise InvalidAuthTokenError()

    secret = _get_token_secret()
    expected_signature = hmac.new(
        secret,
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    actual_signature = _b64url_decode(signature_b64)

    if not hmac.compare_digest(expected_signature, actual_signature):
        raise InvalidAuthTokenError()

    raw_payload = _b64url_decode(payload_b64)
    try:
        payload = json.loads(raw_payload.decode("utf-8"))
    except Exception as exc:
        raise InvalidAuthTokenError() from exc

    if not isinstance(payload, dict):
        raise InvalidAuthTokenError()

    return payload


def assert_token_kind(payload: dict, expected_kind: str) -> None:
    actual_kind = payload.get("kind")
    if actual_kind is None:
        raise InvalidAuthTokenError()
    if actual_kind != expected_kind:
        raise WrongTokenKindError(expected_kind, actual_kind)


def assert_token_not_expired(
    payload: dict,
    now: int | float | datetime | None = None,
) -> None:
    exp = _extract_required(payload, "exp")
    try:
        exp_ts = int(exp)
    except Exception as exc:
        raise InvalidAuthTokenError() from exc

    now_ts = _build_now_ts(now)
    if exp_ts <= now_ts:
        raise ExpiredAuthTokenError()


def build_expires_in_sec(
    payload: dict,
    now: int | float | datetime | None = None,
) -> int:
    exp = _extract_required(payload, "exp")
    try:
        exp_ts = int(exp)
    except Exception as exc:
        raise InvalidAuthTokenError() from exc

    now_ts = _build_now_ts(now)
    remaining = exp_ts - now_ts
    return remaining if remaining > 0 else 0


def create_verify_ticket(
    user_id: int,
    purpose: str,
    email: str,
    preferred_language: str | None = None,
    expires_in_sec: int = DEFAULT_VERIFY_TICKET_EXPIRES_SEC,
    now: int | float | datetime | None = None,
) -> str:
    if not isinstance(user_id, int) or user_id <= 0:
        raise AuthTokenError("invalid_user_id", "ユーザーIDが不正です。")
    if purpose not in _VERIFY_PURPOSES:
        raise AuthTokenError("invalid_verify_purpose", "verify用途が不正です。")
    normalized_email = _ensure_non_empty_string(email, "invalid_email")
    payload = build_token_payload(
        kind="verify_ticket",
        subject=user_id,
        expires_in_sec=expires_in_sec,
        extra={
            "purpose": purpose,
            "email": normalized_email,
            "preferred_language": preferred_language,
        },
        now=now,
    )
    return sign_payload(payload)


def parse_verify_ticket(
    token: str,
    now: int | float | datetime | None = None,
) -> dict:
    payload = _parse_and_validate_token(token, "verify_ticket", now=now)
    purpose = _extract_required(payload, "purpose")
    email = _extract_required(payload, "email")
    preferred_language = payload.get("preferred_language")

    if purpose not in _VERIFY_PURPOSES:
        raise InvalidAuthTokenError()
    if not isinstance(email, str) or email.strip() == "":
        raise InvalidAuthTokenError()

    return {
        "kind": "verify_ticket",
        "user_id": _coerce_user_id(_extract_required(payload, "sub")),
        "purpose": purpose,
        "email": email,
        "preferred_language": preferred_language if isinstance(preferred_language, str) and preferred_language.strip() != "" else None,
        "jti": str(_extract_required(payload, "jti")),
        "iat": int(_extract_required(payload, "iat")),
        "exp": int(_extract_required(payload, "exp")),
    }


def create_challenge_token(
    user_id: int,
    auth_flow_id: str,
    email: str,
    preferred_language: str | None = None,
    expires_in_sec: int = DEFAULT_CHALLENGE_TOKEN_EXPIRES_SEC,
    now: int | float | datetime | None = None,
) -> str:
    if not isinstance(user_id, int) or user_id <= 0:
        raise AuthTokenError("invalid_user_id", "ユーザーIDが不正です。")
    normalized_flow_id = _ensure_non_empty_string(auth_flow_id, "invalid_auth_flow_id")
    normalized_email = _ensure_non_empty_string(email, "invalid_email")
    payload = build_token_payload(
        kind="challenge_token",
        subject=user_id,
        expires_in_sec=expires_in_sec,
        extra={
            "auth_flow_id": normalized_flow_id,
            "email": normalized_email,
            "purpose": _CHALLENGE_PURPOSE,
            "preferred_language": preferred_language,
        },
        now=now,
    )
    return sign_payload(payload)


def parse_challenge_token(
    token: str,
    now: int | float | datetime | None = None,
) -> dict:
    payload = _parse_and_validate_token(token, "challenge_token", now=now)
    auth_flow_id = _extract_required(payload, "auth_flow_id")
    email = _extract_required(payload, "email")
    purpose = _extract_required(payload, "purpose")
    preferred_language = payload.get("preferred_language")

    if not isinstance(auth_flow_id, str) or auth_flow_id.strip() == "":
        raise InvalidAuthTokenError()
    if not isinstance(email, str) or email.strip() == "":
        raise InvalidAuthTokenError()
    if purpose != _CHALLENGE_PURPOSE:
        raise InvalidAuthTokenError()

    return {
        "kind": "challenge_token",
        "user_id": _coerce_user_id(_extract_required(payload, "sub")),
        "auth_flow_id": auth_flow_id,
        "email": email,
        "purpose": purpose,
        "preferred_language": preferred_language if isinstance(preferred_language, str) and preferred_language.strip() != "" else None,
        "jti": str(_extract_required(payload, "jti")),
        "iat": int(_extract_required(payload, "iat")),
        "exp": int(_extract_required(payload, "exp")),
    }



def create_email_registration_token(
    user_id: int,
    email: str | None,
    expires_in_sec: int = DEFAULT_EMAIL_REGISTRATION_TOKEN_EXPIRES_SEC,
    now: int | float | datetime | None = None,
) -> str:
    if not isinstance(user_id, int) or user_id <= 0:
        raise AuthTokenError("invalid_user_id", "ユーザーIDが不正です。")

    payload = build_token_payload(
        kind="email_registration_token",
        subject=user_id,
        expires_in_sec=expires_in_sec,
        extra={
            "email": email,
        },
        now=now,
    )
    return sign_payload(payload)


def parse_email_registration_token(
    token: str,
    now: int | float | datetime | None = None,
) -> dict:
    payload = _parse_and_validate_token(token, "email_registration_token", now=now)
    email = payload.get("email")
    if email is not None and not isinstance(email, str):
        raise InvalidAuthTokenError()

    return {
        "kind": "email_registration_token",
        "user_id": _coerce_user_id(_extract_required(payload, "sub")),
        "email": email,
        "jti": str(_extract_required(payload, "jti")),
        "iat": int(_extract_required(payload, "iat")),
        "exp": int(_extract_required(payload, "exp")),
    }

def create_registration_token(
    provider_user_id: str,
    provider_email: str | None,
    provider_display_name: str | None,
    provider_username: str | None,
    provider_avatar_hash: str | None = None,
    expires_in_sec: int = DEFAULT_REGISTRATION_TOKEN_EXPIRES_SEC,
    now: int | float | datetime | None = None,
) -> str:
    normalized_provider_user_id = _ensure_non_empty_string(
        provider_user_id,
        "invalid_provider_user_id",
    )
    payload = build_token_payload(
        kind="registration_token",
        subject=normalized_provider_user_id,
        expires_in_sec=expires_in_sec,
        extra={
            "provider": _REGISTRATION_PROVIDER,
            "provider_user_id": normalized_provider_user_id,
            "provider_email": provider_email,
            "provider_display_name": provider_display_name,
            "provider_username": provider_username,
            "provider_avatar_hash": provider_avatar_hash,
        },
        now=now,
    )
    return sign_payload(payload)


def parse_registration_token(
    token: str,
    now: int | float | datetime | None = None,
) -> dict:
    payload = _parse_and_validate_token(token, "registration_token", now=now)
    provider = _extract_required(payload, "provider")
    provider_user_id = _extract_required(payload, "provider_user_id")

    if provider != _REGISTRATION_PROVIDER:
        raise InvalidAuthTokenError()
    if not isinstance(provider_user_id, str) or provider_user_id.strip() == "":
        raise InvalidAuthTokenError()

    provider_email = payload.get("provider_email")
    provider_display_name = payload.get("provider_display_name")
    provider_username = payload.get("provider_username")
    provider_avatar_hash = payload.get("provider_avatar_hash")

    if provider_email is not None and not isinstance(provider_email, str):
        raise InvalidAuthTokenError()
    if provider_display_name is not None and not isinstance(provider_display_name, str):
        raise InvalidAuthTokenError()
    if provider_username is not None and not isinstance(provider_username, str):
        raise InvalidAuthTokenError()
    if provider_avatar_hash is not None and not isinstance(provider_avatar_hash, str):
        raise InvalidAuthTokenError()

    return {
        "kind": "registration_token",
        "provider": provider,
        "provider_user_id": provider_user_id,
        "provider_email": provider_email,
        "provider_display_name": provider_display_name,
        "provider_username": provider_username,
        "provider_avatar_hash": provider_avatar_hash,
        "jti": str(_extract_required(payload, "jti")),
        "iat": int(_extract_required(payload, "iat")),
        "exp": int(_extract_required(payload, "exp")),
    }


def create_reset_token(
    user_id: int,
    email: str | None,
    preferred_language: str | None = None,
    expires_in_sec: int = DEFAULT_RESET_TOKEN_EXPIRES_SEC,
    now: int | float | datetime | None = None,
) -> str:
    if not isinstance(user_id, int) or user_id <= 0:
        raise AuthTokenError("invalid_user_id", "ユーザーIDが不正です。")
    payload = build_token_payload(
        kind="reset_token",
        subject=user_id,
        expires_in_sec=expires_in_sec,
        extra={
            "email": email,
            "preferred_language": preferred_language,
        },
        now=now,
    )
    return sign_payload(payload)


def parse_reset_token(
    token: str,
    now: int | float | datetime | None = None,
) -> dict:
    payload = _parse_and_validate_token(token, "reset_token", now=now)
    email = payload.get("email")
    preferred_language = payload.get("preferred_language")
    if email is not None and not isinstance(email, str):
        raise InvalidAuthTokenError()

    return {
        "kind": "reset_token",
        "user_id": _coerce_user_id(_extract_required(payload, "sub")),
        "email": email,
        "preferred_language": preferred_language if isinstance(preferred_language, str) and preferred_language.strip() != "" else None,
        "jti": str(_extract_required(payload, "jti")),
        "iat": int(_extract_required(payload, "iat")),
        "exp": int(_extract_required(payload, "exp")),
    }


def get_token_meta(
    token: str,
    expected_kind: str,
    now: int | float | datetime | None = None,
) -> dict:
    payload = _parse_and_validate_token(token, expected_kind, now=now)
    return {
        "payload": payload,
        "expires_in_sec": build_expires_in_sec(payload, now=now),
    }
