from __future__ import annotations

import re


USER_KEY_MIN_LENGTH = 4
USER_KEY_MAX_LENGTH = 20
DISPLAY_NAME_MAX_LENGTH = 100
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 32
OTP_LENGTH = 6
TOKEN_MIN_LENGTH = 8
TOKEN_MAX_LENGTH = 2048

EMAIL_PATTERN = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$"
)
USER_KEY_ALLOWED_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
OTP_PATTERN = re.compile(r"^[0-9]+$")
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
ASCII_LETTER_PATTERN = re.compile(r"[A-Za-z]")
DIGIT_PATTERN = re.compile(r"[0-9]")


class AuthValidationError(Exception):
    def __init__(self, field: str, code: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.code = code
        self.message = message

    def to_dict(self) -> dict:
        return {
            "field": self.field,
            "code": self.code,
            "message": self.message,
        }


class AuthValidationErrors(Exception):
    def __init__(self, errors: list[AuthValidationError]) -> None:
        self.errors = errors
        message = "入力内容を確認してください。"
        if errors:
            message = errors[0].message
        super().__init__(message)

    def to_list(self) -> list[dict]:
        return [error.to_dict() for error in self.errors]


def _coerce_to_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _raise_required(field: str, message: str | None = None) -> None:
    raise AuthValidationError(field, "required", message or "入力してください。")


def _contains_letter(value: str) -> bool:
    return ASCII_LETTER_PATTERN.search(value) is not None


def _contains_digit(value: str) -> bool:
    return DIGIT_PATTERN.search(value) is not None


def _contains_newline(value: str) -> bool:
    return "\n" in value or "\r" in value


def _collect_errors(errors: list[AuthValidationError]) -> None:
    if errors:
        raise AuthValidationErrors(errors)


def normalize_email(value: str | None) -> str:
    return _coerce_to_str(value).strip().lower()


def normalize_display_name(value: str | None) -> str:
    return _coerce_to_str(value).strip()


def normalize_user_key(value: str | None) -> str:
    return _coerce_to_str(value).strip()


def validate_email(value: str | None, field: str = "email") -> str:
    normalized = normalize_email(value)
    if normalized == "":
        _raise_required(field)
    if not EMAIL_PATTERN.fullmatch(normalized):
        raise AuthValidationError(field, "invalid_format", "メールアドレスの形式が正しくありません。")
    return normalized


def validate_user_key(value: str | None, field: str = "user_key") -> str:
    normalized = normalize_user_key(value)
    if normalized == "":
        _raise_required(field)
    if len(normalized) < USER_KEY_MIN_LENGTH:
        raise AuthValidationError(
            field,
            "too_short",
            f"{USER_KEY_MIN_LENGTH}文字以上で入力してください。",
        )
    if len(normalized) > USER_KEY_MAX_LENGTH:
        raise AuthValidationError(
            field,
            "too_long",
            f"{USER_KEY_MAX_LENGTH}文字以下で入力してください。",
        )
    if not normalized[0].isalpha() or not normalized[0].isascii():
        raise AuthValidationError(
            field,
            "invalid_start",
            "先頭は英字で入力してください。",
        )
    if not USER_KEY_ALLOWED_PATTERN.fullmatch(normalized):
        raise AuthValidationError(
            field,
            "invalid_characters",
            "使用できる文字は英数字、アンダースコア、ハイフンのみです。",
        )
    return normalized


def validate_display_name(value: str | None, field: str = "display_name") -> str:
    normalized = normalize_display_name(value)
    if normalized == "":
        _raise_required(field)
    if len(normalized) > DISPLAY_NAME_MAX_LENGTH:
        raise AuthValidationError(
            field,
            "too_long",
            f"{DISPLAY_NAME_MAX_LENGTH}文字以下で入力してください。",
        )
    if _contains_newline(normalized):
        raise AuthValidationError(
            field,
            "invalid_newline",
            "改行は使用できません。",
        )
    return normalized


def validate_password(value: str | None, field: str = "password") -> str:
    password = "" if value is None else _coerce_to_str(value)
    if password == "":
        _raise_required(field)
    if len(password) < PASSWORD_MIN_LENGTH:
        raise AuthValidationError(
            field,
            "too_short",
            f"{PASSWORD_MIN_LENGTH}文字以上で入力してください。",
        )
    if len(password) > PASSWORD_MAX_LENGTH:
        raise AuthValidationError(
            field,
            "too_long",
            f"{PASSWORD_MAX_LENGTH}文字以下で入力してください。",
        )
    if not _contains_letter(password):
        raise AuthValidationError(
            field,
            "missing_letter",
            "英字を1文字以上含めてください。",
        )
    if not _contains_digit(password):
        raise AuthValidationError(
            field,
            "missing_digit",
            "数字を1文字以上含めてください。",
        )
    return password


def validate_login_password(value: str | None, field: str = "password") -> str:
    password = "" if value is None else _coerce_to_str(value)
    if password == "":
        _raise_required(field)
    return password


def validate_otp_code(value: str | None, field: str = "code") -> str:
    code = _coerce_to_str(value).strip()
    if code == "":
        _raise_required(field)
    if not OTP_PATTERN.fullmatch(code):
        raise AuthValidationError(field, "invalid_format", "認証コードは数字のみで入力してください。")
    if len(code) != OTP_LENGTH:
        raise AuthValidationError(
            field,
            "invalid_length",
            f"認証コードは{OTP_LENGTH}桁で入力してください。",
        )
    return code


def validate_token_like(value: str | None, field: str) -> str:
    token = _coerce_to_str(value).strip()
    if token == "":
        _raise_required(field)
    if len(token) < TOKEN_MIN_LENGTH or len(token) > TOKEN_MAX_LENGTH:
        raise AuthValidationError(field, "invalid_format", "トークンの形式が正しくありません。")
    if not TOKEN_PATTERN.fullmatch(token):
        raise AuthValidationError(field, "invalid_format", "トークンの形式が正しくありません。")
    return token


def coerce_bool(value: object, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        if value in (0, 1):
            return bool(value)
        raise AuthValidationError(field, "invalid_format", "真偽値の形式が正しくありません。")
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("true", "1", "yes", "on"):
            return True
        if normalized in ("false", "0", "no", "off"):
            return False
        raise AuthValidationError(field, "invalid_format", "真偽値の形式が正しくありません。")
    raise AuthValidationError(field, "invalid_format", "真偽値の形式が正しくありません。")


def validate_login_input(email: str | None, password: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_email = ""
    normalized_password = ""

    try:
        normalized_email = validate_email(email, "email")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_password = validate_login_password(password, "password")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "email": normalized_email,
        "password": normalized_password,
    }


def validate_register_input(
    user_key: str | None,
    display_name: str | None,
    email: str | None,
    password: str | None,
    terms_agreed,
) -> dict:
    errors: list[AuthValidationError] = []
    normalized_user_key = ""
    normalized_display_name = ""
    normalized_email = ""
    normalized_password = ""
    normalized_terms_agreed = False

    try:
        normalized_user_key = validate_user_key(user_key, "user_key")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_display_name = validate_display_name(display_name, "display_name")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_email = validate_email(email, "email")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_password = validate_password(password, "password")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_terms_agreed = coerce_bool(terms_agreed, "terms_agreed")
        if not normalized_terms_agreed:
            errors.append(
                AuthValidationError(
                    "terms_agreed",
                    "terms_not_agreed",
                    "利用規約への同意が必要です。",
                )
            )
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "user_key": normalized_user_key,
        "display_name": normalized_display_name,
        "email": normalized_email,
        "password": normalized_password,
        "terms_agreed": normalized_terms_agreed,
    }


def validate_forgot_password_input(email: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_email = ""

    try:
        normalized_email = validate_email(email, "email")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "email": normalized_email,
    }


def validate_reset_password_input(reset_token: str | None, password: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_reset_token = ""
    normalized_password = ""

    try:
        normalized_reset_token = validate_token_like(reset_token, "reset_token")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_password = validate_password(password, "password")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "reset_token": normalized_reset_token,
        "password": normalized_password,
    }


def validate_verify_email_input(verify_ticket: str | None, code: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_verify_ticket = ""
    normalized_code = ""

    try:
        normalized_verify_ticket = validate_token_like(verify_ticket, "verify_ticket")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_code = validate_otp_code(code, "code")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "verify_ticket": normalized_verify_ticket,
        "code": normalized_code,
    }


def validate_verify_email_resend_input(verify_ticket: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_verify_ticket = ""

    try:
        normalized_verify_ticket = validate_token_like(verify_ticket, "verify_ticket")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "verify_ticket": normalized_verify_ticket,
    }


def validate_verify_2fa_input(
    challenge_token: str | None,
    code: str | None,
    remember_for_30_days,
) -> dict:
    errors: list[AuthValidationError] = []
    normalized_challenge_token = ""
    normalized_code = ""
    normalized_remember = False

    try:
        normalized_challenge_token = validate_token_like(challenge_token, "challenge_token")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_code = validate_otp_code(code, "code")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_remember = coerce_bool(remember_for_30_days, "remember_for_30_days")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "challenge_token": normalized_challenge_token,
        "code": normalized_code,
        "remember_for_30_days": normalized_remember,
    }


def validate_verify_2fa_resend_input(challenge_token: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_challenge_token = ""

    try:
        normalized_challenge_token = validate_token_like(challenge_token, "challenge_token")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "challenge_token": normalized_challenge_token,
    }


def validate_discord_register_input(
    registration_token: str | None,
    user_key: str | None,
    display_name: str | None,
) -> dict:
    errors: list[AuthValidationError] = []
    normalized_registration_token = ""
    normalized_user_key = ""
    normalized_display_name = ""

    try:
        normalized_registration_token = validate_token_like(registration_token, "registration_token")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_user_key = validate_user_key(user_key, "user_key")
    except AuthValidationError as exc:
        errors.append(exc)

    try:
        normalized_display_name = validate_display_name(display_name, "display_name")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "registration_token": normalized_registration_token,
        "user_key": normalized_user_key,
        "display_name": normalized_display_name,
    }


def validate_user_key_availability_input(user_key: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_user_key = ""

    try:
        normalized_user_key = validate_user_key(user_key, "user_key")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "user_key": normalized_user_key,
    }


def validate_verify_status_query(
    mode: str | None,
    ticket: str | None = None,
    challenge: str | None = None,
) -> dict:
    errors: list[AuthValidationError] = []
    normalized_mode = _coerce_to_str(mode).strip().lower()

    if normalized_mode == "":
        errors.append(AuthValidationError("mode", "required", "入力してください。"))
    elif normalized_mode not in ("email", "2fa"):
        errors.append(AuthValidationError("mode", "invalid_mode", "mode の指定が正しくありません。"))

    if normalized_mode == "email":
        try:
            normalized_ticket = validate_token_like(ticket, "ticket")
        except AuthValidationError:
            errors.append(AuthValidationError("ticket", "missing_ticket", "ticket が必要です。"))
            normalized_ticket = ""
        _collect_errors(errors)
        return {
            "mode": "email",
            "ticket": normalized_ticket,
        }

    if normalized_mode == "2fa":
        try:
            normalized_challenge = validate_token_like(challenge, "challenge")
        except AuthValidationError:
            errors.append(AuthValidationError("challenge", "missing_challenge", "challenge が必要です。"))
            normalized_challenge = ""
        _collect_errors(errors)
        return {
            "mode": "2fa",
            "challenge": normalized_challenge,
        }

    _collect_errors(errors)
    return {}


def validate_reset_status_query(token: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_token = ""

    try:
        normalized_token = validate_token_like(token, "token")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "token": normalized_token,
    }


def validate_discord_registration_status_query(registration: str | None) -> dict:
    errors: list[AuthValidationError] = []
    normalized_registration_token = ""

    try:
        normalized_registration_token = validate_token_like(registration, "registration_token")
    except AuthValidationError as exc:
        errors.append(exc)

    _collect_errors(errors)

    return {
        "registration_token": normalized_registration_token,
    }