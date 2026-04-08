from __future__ import annotations

from email.message import EmailMessage
from email.utils import formataddr
import smtplib
import ssl


_VERIFY_PURPOSES = {"signup", "email_signup", "email_change", "2fa_setup", "2fa_disable"}

_SUPPORTED_MAIL_LANGUAGES = {"ja", "en-us"}


class AuthMailError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _coerce_to_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _normalize_mail_language(value: str | None) -> str:
    raw = _coerce_to_str(value).strip().lower().replace("_", "-")
    if raw in {"", "en", "en-gb"}:
        return "en-us"
    if raw in {"ja", "ja-jp"}:
        return "ja"
    if raw.startswith("ja-"):
        return "ja"
    if raw.startswith("en-"):
        return "en-us"
    if raw in _SUPPORTED_MAIL_LANGUAGES:
        return raw
    return "en-us"


def _ensure_non_empty_string(value, field: str) -> str:
    normalized = _coerce_to_str(value).strip()
    if normalized == "":
        raise AuthMailError(
            "invalid_mail_argument",
            f"{field} の値が正しくありません。",
        )
    return normalized


def _ensure_positive_int(value, field: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise AuthMailError(
            "invalid_mail_argument",
            f"{field} の値が正しくありません。",
        )
    return value


def _coerce_bool(value, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        if value in (0, 1):
            return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise AuthMailError(
        "invalid_mail_argument",
        f"{field} の値が正しくありません。",
    )


def _format_expiry_minutes(expires_in_sec: int, language: str = "ja") -> str:
    seconds = _ensure_positive_int(expires_in_sec, "expires_in_sec")
    minutes = (seconds + 59) // 60
    locale = _normalize_mail_language(language)
    if minutes <= 0:
        return "less than 1 minute" if locale != "ja" else "1分未満"
    return f"{minutes} minutes" if locale != "ja" else f"{minutes}分"


def _build_greeting(display_name: str | None = None, language: str = "ja") -> str:
    if display_name is None:
        return ""
    normalized = _coerce_to_str(display_name).strip()
    if normalized == "":
        return ""
    if _normalize_mail_language(language) == "ja":
        return f"{normalized} 様\n\n"
    return f"Hello {normalized},\n\n"


def validate_smtp_settings(smtp_settings: dict) -> dict:
    if not isinstance(smtp_settings, dict):
        raise AuthMailError(
            "invalid_smtp_settings",
            "SMTP設定の形式が正しくありません。",
        )

    normalized = {
        "host": _ensure_non_empty_string(smtp_settings.get("host"), "host"),
        "port": _ensure_positive_int(smtp_settings.get("port"), "port"),
        "username": None,
        "password": None,
        "use_starttls": _coerce_bool(smtp_settings.get("use_starttls", False), "use_starttls"),
        "from_email": _ensure_non_empty_string(smtp_settings.get("from_email"), "from_email"),
        "base_url": _ensure_non_empty_string(smtp_settings.get("base_url"), "base_url"),
        "from_name": None,
        "use_auth": False,
    }

    username = smtp_settings.get("username")
    password = smtp_settings.get("password")
    if username is not None:
        normalized_username = _coerce_to_str(username).strip()
        normalized["username"] = normalized_username if normalized_username != "" else None
    if password is not None:
        normalized_password = _coerce_to_str(password)
        normalized["password"] = normalized_password if normalized_password != "" else None

    use_auth = smtp_settings.get("use_auth")
    if use_auth is None:
        normalized["use_auth"] = bool(normalized["username"] and normalized["password"])
    else:
        normalized["use_auth"] = _coerce_bool(use_auth, "use_auth")

    if normalized["use_auth"]:
        if not normalized["username"]:
            raise AuthMailError(
                "invalid_smtp_settings",
                "SMTP認証を使う場合は username が必要です。",
            )
        if normalized["password"] is None:
            raise AuthMailError(
                "invalid_smtp_settings",
                "SMTP認証を使う場合は password が必要です。",
            )

    from_name = smtp_settings.get("from_name")
    if from_name is not None:
        normalized_from_name = _coerce_to_str(from_name).strip()
        normalized["from_name"] = normalized_from_name if normalized_from_name != "" else None

    return normalized


def build_text_message(
    smtp_settings: dict,
    to_email: str,
    subject: str,
    body_text: str,
) -> EmailMessage:
    settings = validate_smtp_settings(smtp_settings)
    normalized_to_email = _ensure_non_empty_string(to_email, "to_email")
    normalized_subject = _ensure_non_empty_string(subject, "subject")
    normalized_body_text = _ensure_non_empty_string(body_text, "body_text")

    message = EmailMessage()
    if settings["from_name"]:
        message["From"] = formataddr((settings["from_name"], settings["from_email"]))
    else:
        message["From"] = settings["from_email"]
    message["To"] = normalized_to_email
    message["Subject"] = normalized_subject
    message.set_content(normalized_body_text, subtype="plain", charset="utf-8")
    return message


def send_message(smtp_settings: dict, message: EmailMessage) -> None:
    settings = validate_smtp_settings(smtp_settings)
    if not isinstance(message, EmailMessage):
        raise AuthMailError(
            "invalid_mail_message",
            "メールメッセージの形式が正しくありません。",
        )

    try:
        with smtplib.SMTP(settings["host"], settings["port"], timeout=10) as smtp:
            smtp.ehlo()
            if settings["use_starttls"]:
                context = ssl.create_default_context()
                smtp.starttls(context=context)
                smtp.ehlo()
            if settings["use_auth"]:
                smtp.login(settings["username"], settings["password"])
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError as exc:
        raise AuthMailError(
            "smtp_auth_failed",
            "SMTP認証に失敗しました。",
        ) from exc
    except smtplib.SMTPConnectError as exc:
        raise AuthMailError(
            "smtp_connect_failed",
            "SMTPサーバーへの接続に失敗しました。",
        ) from exc
    except smtplib.SMTPException as exc:
        raise AuthMailError(
            "smtp_send_failed",
            "メール送信に失敗しました。",
        ) from exc
    except OSError as exc:
        raise AuthMailError(
            "smtp_connect_failed",
            "SMTPサーバーへの接続に失敗しました。",
        ) from exc


def build_verification_subject(purpose: str, language: str = "ja") -> str:
    locale = _normalize_mail_language(language)
    if locale != "ja":
        if purpose in {"signup", "email_signup"}:
            return "[Felixxsv Gallery] Email Verification Code"
        if purpose == "email_change":
            return "[Felixxsv Gallery] Email Change Verification Code"
        if purpose == "2fa_setup":
            return "[Felixxsv Gallery] Two-Factor Setup Verification Code"
        if purpose == "2fa_disable":
            return "[Felixxsv Gallery] Two-Factor Disable Verification Code"
    if purpose in {"signup", "email_signup"}:
        return "【Felixxsv Gallery】メールアドレス確認コード"
    if purpose == "email_change":
        return "【Felixxsv Gallery】メールアドレス変更確認コード"
    if purpose == "2fa_setup":
        return "【Felixxsv Gallery】2段階認証設定確認コード"
    if purpose == "2fa_disable":
        return "【Felixxsv Gallery】2段階認証無効化確認コード"
    raise AuthMailError(
        "invalid_verify_purpose",
        "メール確認用途が正しくありません。",
    )


def build_verification_body_text(
    code: str,
    purpose: str,
    expires_in_sec: int,
    display_name: str | None = None,
    language: str = "ja",
) -> str:
    normalized_code = _ensure_non_empty_string(code, "code")
    if purpose not in _VERIFY_PURPOSES:
        raise AuthMailError(
            "invalid_verify_purpose",
            "メール確認用途が正しくありません。",
        )
    locale = _normalize_mail_language(language)
    expiry_text = _format_expiry_minutes(expires_in_sec, locale)
    greeting = _build_greeting(display_name, locale)

    if locale != "ja":
        if purpose in {"signup", "email_signup"}:
            purpose_text = "Enter the verification code below to complete your Felixxsv Gallery account registration."
        elif purpose == "email_change":
            purpose_text = "Enter the verification code below to complete your email address change."
        elif purpose == "2fa_setup":
            purpose_text = "Enter the verification code below to finish enabling two-factor authentication."
        else:
            purpose_text = "Enter the verification code below to disable two-factor authentication."

        return (
            f"{greeting}"
            f"{purpose_text}\n\n"
            f"Verification Code\n"
            f"{normalized_code}\n\n"
            f"Expires In\n"
            f"{expiry_text}\n\n"
            f"Do not share this code with anyone.\n"
            f"If you do not recognize this request, you can safely ignore this email.\n"
        )

    if purpose in {"signup", "email_signup"}:
        purpose_text = "Felixxsv Gallery のアカウント登録を完了するため、下記の確認コードを入力してください。"
    elif purpose == "email_change":
        purpose_text = "メールアドレス変更を完了するため、下記の確認コードを入力してください。"
    elif purpose == "2fa_setup":
        purpose_text = "2段階認証の設定を完了するため、下記の確認コードを入力してください。"
    else:
        purpose_text = "2段階認証を無効化するため、下記の確認コードを入力してください。"

    return (
        f"{greeting}"
        f"{purpose_text}\n\n"
        f"確認コード\n"
        f"{normalized_code}\n\n"
        f"有効期限\n"
        f"{expiry_text}\n\n"
        f"このコードは他の人に共有しないでください。\n"
        f"心当たりがない場合は、このメールを無視してください。\n"
    )


def build_two_factor_subject(language: str = "ja") -> str:
    if _normalize_mail_language(language) != "ja":
        return "[Felixxsv Gallery] Two-Factor Authentication Code"
    return "【Felixxsv Gallery】2段階認証コード"


def build_two_factor_body_text(
    code: str,
    expires_in_sec: int,
    display_name: str | None = None,
    language: str = "ja",
) -> str:
    normalized_code = _ensure_non_empty_string(code, "code")
    locale = _normalize_mail_language(language)
    expiry_text = _format_expiry_minutes(expires_in_sec, locale)
    greeting = _build_greeting(display_name, locale)

    if locale != "ja":
        return (
            f"{greeting}"
            f"Enter the authentication code below to complete your Felixxsv Gallery sign-in.\n\n"
            f"Authentication Code\n"
            f"{normalized_code}\n\n"
            f"Expires In\n"
            f"{expiry_text}\n\n"
            f"Do not share this code with anyone.\n"
            f"If you do not recognize this request, consider changing your password.\n"
        )

    return (
        f"{greeting}"
        f"Felixxsv Gallery へのログイン確認のため、下記の認証コードを入力してください。\n\n"
        f"認証コード\n"
        f"{normalized_code}\n\n"
        f"有効期限\n"
        f"{expiry_text}\n\n"
        f"このコードは他の人に共有しないでください。\n"
        f"心当たりがない場合は、パスワードの変更を検討してください。\n"
    )


def build_password_reset_subject(language: str = "ja") -> str:
    if _normalize_mail_language(language) != "ja":
        return "[Felixxsv Gallery] Password Reset Instructions"
    return "【Felixxsv Gallery】パスワード再設定のご案内"


def build_password_reset_body_text(
    reset_url: str,
    expires_in_sec: int,
    display_name: str | None = None,
    language: str = "ja",
) -> str:
    normalized_reset_url = _ensure_non_empty_string(reset_url, "reset_url")
    locale = _normalize_mail_language(language)
    expiry_text = _format_expiry_minutes(expires_in_sec, locale)
    greeting = _build_greeting(display_name, locale)

    if locale != "ja":
        return (
            f"{greeting}"
            f"A password reset was requested for your Felixxsv Gallery account.\n"
            f"Use the URL below to continue.\n\n"
            f"{normalized_reset_url}\n\n"
            f"Expires In\n"
            f"{expiry_text}\n\n"
            f"If you do not recognize this request, you can safely ignore this email.\n"
        )

    return (
        f"{greeting}"
        f"Felixxsv Gallery のパスワード再設定が要求されました。\n"
        f"下記のURLから再設定を行ってください。\n\n"
        f"{normalized_reset_url}\n\n"
        f"有効期限\n"
        f"{expiry_text}\n\n"
        f"心当たりがない場合は、このメールを無視してください。\n"
    )


def send_verification_email(
    smtp_settings: dict,
    to_email: str,
    code: str,
    purpose: str,
    expires_in_sec: int,
    display_name: str | None = None,
    preferred_language: str | None = None,
) -> None:
    locale = _normalize_mail_language(preferred_language)
    subject = build_verification_subject(purpose, locale)
    body_text = build_verification_body_text(
        code=code,
        purpose=purpose,
        expires_in_sec=expires_in_sec,
        display_name=display_name,
        language=locale,
    )
    message = build_text_message(
        smtp_settings=smtp_settings,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
    )
    send_message(smtp_settings, message)


def send_two_factor_code_email(
    smtp_settings: dict,
    to_email: str,
    code: str,
    expires_in_sec: int,
    display_name: str | None = None,
    preferred_language: str | None = None,
) -> None:
    locale = _normalize_mail_language(preferred_language)
    subject = build_two_factor_subject(locale)
    body_text = build_two_factor_body_text(
        code=code,
        expires_in_sec=expires_in_sec,
        display_name=display_name,
        language=locale,
    )
    message = build_text_message(
        smtp_settings=smtp_settings,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
    )
    send_message(smtp_settings, message)


def send_password_reset_email(
    smtp_settings: dict,
    to_email: str,
    reset_url: str,
    expires_in_sec: int,
    display_name: str | None = None,
    preferred_language: str | None = None,
) -> None:
    locale = _normalize_mail_language(preferred_language)
    subject = build_password_reset_subject(locale)
    body_text = build_password_reset_body_text(
        reset_url=reset_url,
        expires_in_sec=expires_in_sec,
        display_name=display_name,
        language=locale,
    )
    message = build_text_message(
        smtp_settings=smtp_settings,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
    )
    send_message(smtp_settings, message)
