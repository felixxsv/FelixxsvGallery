from __future__ import annotations

from email.message import EmailMessage
from email.utils import formataddr
import smtplib
import ssl


_VERIFY_PURPOSES = {"signup", "email_signup", "email_change", "2fa_setup", "2fa_disable"}

_SUPPORTED_MAIL_LANGUAGES = {"ja", "en-us", "de", "fr", "ru", "es", "zh-cn", "ko"}


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
    if raw in {"ko", "ko-kr"}:
        return "ko"
    if raw in {"de", "de-de", "de-at", "de-ch"}:
        return "de"
    if raw in {"fr", "fr-fr", "fr-be", "fr-ch", "fr-ca"}:
        return "fr"
    if raw in {"ru", "ru-ru"}:
        return "ru"
    if raw in {"zh-cn", "zh", "zh-hans", "zh-sg"}:
        return "zh-cn"
    if raw in {"es", "es-es", "es-419"}:
        return "es"
    if raw.startswith("ja-"):
        return "ja"
    if raw.startswith("de-"):
        return "de"
    if raw.startswith("fr-"):
        return "fr"
    if raw.startswith("ru-"):
        return "ru"
    if raw.startswith("zh-"):
        return "zh-cn"
    if raw.startswith("ko-"):
        return "ko"
    if raw.startswith("es-"):
        return "es"
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
        if locale == "ja":
            return "1分未満"
        if locale == "ko":
            return "1분 미만"
        if locale == "de":
            return "weniger als 1 Minute"
        if locale == "fr":
            return "moins d'1 minute"
        if locale == "ru":
            return "менее 1 мин."
        if locale == "zh-cn":
            return "不足1分钟"
        if locale == "es":
            return "menos de 1 minuto"
        return "less than 1 minute"
    if locale == "ja":
        return f"{minutes}分"
    if locale == "ko":
        return f"{minutes}분"
    if locale == "de":
        return f"{minutes} Minuten"
    if locale == "fr":
        return f"{minutes} minutes"
    if locale == "ru":
        return f"{minutes} мин."
    if locale == "zh-cn":
        return f"{minutes} 分钟"
    if locale == "es":
        return f"{minutes} minutos"
    return f"{minutes} minutes"


def _build_greeting(display_name: str | None = None, language: str = "ja") -> str:
    if display_name is None:
        return ""
    normalized = _coerce_to_str(display_name).strip()
    if normalized == "":
        return ""
    locale = _normalize_mail_language(language)
    if locale == "ja":
        return f"{normalized} 様\n\n"
    if locale == "ko":
        return f"{normalized}님,\n\n"
    if locale == "de":
        return f"Hallo {normalized},\n\n"
    if locale == "fr":
        return f"Bonjour {normalized},\n\n"
    if locale == "ru":
        return f"Здравствуйте, {normalized},\n\n"
    if locale == "zh-cn":
        return f"您好，{normalized}，\n\n"
    if locale == "es":
        return f"Hola {normalized},\n\n"
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
    if locale == "de":
        if purpose in {"signup", "email_signup"}:
            return "[Felixxsv Gallery] E-Mail-Bestätigungscode"
        if purpose == "email_change":
            return "[Felixxsv Gallery] Bestätigungscode für E-Mail-Änderung"
        if purpose == "2fa_setup":
            return "[Felixxsv Gallery] Bestätigungscode für Zwei-Faktor-Einrichtung"
        if purpose == "2fa_disable":
            return "[Felixxsv Gallery] Bestätigungscode zum Deaktivieren der Zwei-Faktor-Authentifizierung"
    if locale == "fr":
        if purpose in {"signup", "email_signup"}:
            return "[Felixxsv Gallery] Code de vérification par e-mail"
        if purpose == "email_change":
            return "[Felixxsv Gallery] Code de vérification pour changement d'e-mail"
        if purpose == "2fa_setup":
            return "[Felixxsv Gallery] Code de vérification pour la configuration à deux facteurs"
        if purpose == "2fa_disable":
            return "[Felixxsv Gallery] Code de vérification pour la désactivation à deux facteurs"
    if locale == "ru":
        if purpose in {"signup", "email_signup"}:
            return "[Felixxsv Gallery] Код подтверждения e-mail"
        if purpose == "email_change":
            return "[Felixxsv Gallery] Код подтверждения для смены e-mail"
        if purpose == "2fa_setup":
            return "[Felixxsv Gallery] Код подтверждения для настройки двухфакторной аутентификации"
        if purpose == "2fa_disable":
            return "[Felixxsv Gallery] Код подтверждения для отключения двухфакторной аутентификации"
    if locale == "zh-cn":
        if purpose in {"signup", "email_signup"}:
            return "[Felixxsv Gallery] 电子邮件验证码"
        if purpose == "email_change":
            return "[Felixxsv Gallery] 邮件地址更改验证码"
        if purpose == "2fa_setup":
            return "[Felixxsv Gallery] 双因素认证设置验证码"
        if purpose == "2fa_disable":
            return "[Felixxsv Gallery] 双因素认证禁用验证码"
    if locale == "es":
        if purpose in {"signup", "email_signup"}:
            return "[Felixxsv Gallery] Codigo de verificacion de correo"
        if purpose == "email_change":
            return "[Felixxsv Gallery] Codigo de verificacion para cambio de correo"
        if purpose == "2fa_setup":
            return "[Felixxsv Gallery] Codigo de configuracion de autenticacion en dos pasos"
        if purpose == "2fa_disable":
            return "[Felixxsv Gallery] Codigo para desactivar la autenticacion en dos pasos"
    if locale == "ko":
        if purpose in {"signup", "email_signup"}:
            return "[Felixxsv Gallery] 이메일 인증 코드"
        if purpose == "email_change":
            return "[Felixxsv Gallery] 이메일 변경 인증 코드"
        if purpose == "2fa_setup":
            return "[Felixxsv Gallery] 2단계 인증 설정 코드"
        if purpose == "2fa_disable":
            return "[Felixxsv Gallery] 2단계 인증 해제 코드"
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

    if locale == "ko":
        if purpose in {"signup", "email_signup"}:
            purpose_text = "Felixxsv Gallery 계정 등록을 완료하려면 아래 인증 코드를 입력해 주세요."
        elif purpose == "email_change":
            purpose_text = "이메일 주소 변경을 완료하려면 아래 인증 코드를 입력해 주세요."
        elif purpose == "2fa_setup":
            purpose_text = "2단계 인증 설정을 완료하려면 아래 인증 코드를 입력해 주세요."
        else:
            purpose_text = "2단계 인증을 해제하려면 아래 인증 코드를 입력해 주세요."

        return (
            f"{greeting}"
            f"{purpose_text}\n\n"
            f"인증 코드\n"
            f"{normalized_code}\n\n"
            f"유효 시간\n"
            f"{expiry_text}\n\n"
            f"이 코드를 다른 사람과 공유하지 마세요.\n"
            f"본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.\n"
        )

    if locale == "de":
        if purpose in {"signup", "email_signup"}:
            purpose_text = "Gib den unten stehenden Bestätigungscode ein, um deine Felixxsv Gallery Kontoregistrierung abzuschließen."
        elif purpose == "email_change":
            purpose_text = "Gib den unten stehenden Bestätigungscode ein, um die Änderung deiner E-Mail-Adresse abzuschließen."
        elif purpose == "2fa_setup":
            purpose_text = "Gib den unten stehenden Bestätigungscode ein, um die Einrichtung der Zwei-Faktor-Authentifizierung abzuschließen."
        else:
            purpose_text = "Gib den unten stehenden Bestätigungscode ein, um die Zwei-Faktor-Authentifizierung zu deaktivieren."

        return (
            f"{greeting}"
            f"{purpose_text}\n\n"
            f"Bestätigungscode\n"
            f"{normalized_code}\n\n"
            f"Gültig für\n"
            f"{expiry_text}\n\n"
            f"Teile diesen Code nicht mit anderen.\n"
            f"Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.\n"
        )

    if locale == "fr":
        if purpose in {"signup", "email_signup"}:
            purpose_text = "Saisissez le code de vérification ci-dessous pour finaliser la création de votre compte Felixxsv Gallery."
        elif purpose == "email_change":
            purpose_text = "Saisissez le code de vérification ci-dessous pour finaliser le changement de votre adresse e-mail."
        elif purpose == "2fa_setup":
            purpose_text = "Saisissez le code de vérification ci-dessous pour finaliser la configuration de l'authentification à deux facteurs."
        else:
            purpose_text = "Saisissez le code de vérification ci-dessous pour désactiver l'authentification à deux facteurs."

        return (
            f"{greeting}"
            f"{purpose_text}\n\n"
            f"Code de vérification\n"
            f"{normalized_code}\n\n"
            f"Valide pendant\n"
            f"{expiry_text}\n\n"
            f"Ne partagez pas ce code avec d'autres personnes.\n"
            f"Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail.\n"
        )

    if locale == "ru":
        if purpose in {"signup", "email_signup"}:
            purpose_text = "Введите код подтверждения ниже, чтобы завершить регистрацию аккаунта Felixxsv Gallery."
        elif purpose == "email_change":
            purpose_text = "Введите код подтверждения ниже, чтобы завершить изменение адреса электронной почты."
        elif purpose == "2fa_setup":
            purpose_text = "Введите код подтверждения ниже, чтобы завершить настройку двухфакторной аутентификации."
        else:
            purpose_text = "Введите код подтверждения ниже, чтобы отключить двухфакторную аутентификацию."

        return (
            f"{greeting}"
            f"{purpose_text}\n\n"
            f"Код подтверждения\n"
            f"{normalized_code}\n\n"
            f"Действителен в течение\n"
            f"{expiry_text}\n\n"
            f"Не передавайте этот код другим людям.\n"
            f"Если вы не отправляли этот запрос, просто проигнорируйте это письмо.\n"
        )

    if locale == "zh-cn":
        if purpose in {"signup", "email_signup"}:
            purpose_text = "请输入以下验证码以完成 Felixxsv Gallery 账户注册。"
        elif purpose == "email_change":
            purpose_text = "请输入以下验证码以完成电子邮件地址更改。"
        elif purpose == "2fa_setup":
            purpose_text = "请输入以下验证码以完成双因素认证设置。"
        else:
            purpose_text = "请输入以下验证码以禁用双因素认证。"

        return (
            f"{greeting}"
            f"{purpose_text}\n\n"
            f"验证码\n"
            f"{normalized_code}\n\n"
            f"有效期\n"
            f"{expiry_text}\n\n"
            f"请勿将此验证码告知他人。\n"
            f"如果您没有发起此请求，请忽略此邮件。\n"
        )

    if locale == "es":
        if purpose in {"signup", "email_signup"}:
            purpose_text = "Introduce el codigo de verificacion de abajo para completar el registro de tu cuenta de Felixxsv Gallery."
        elif purpose == "email_change":
            purpose_text = "Introduce el codigo de verificacion de abajo para completar el cambio de tu direccion de correo."
        elif purpose == "2fa_setup":
            purpose_text = "Introduce el codigo de verificacion de abajo para terminar de activar la autenticacion en dos pasos."
        else:
            purpose_text = "Introduce el codigo de verificacion de abajo para desactivar la autenticacion en dos pasos."

        return (
            f"{greeting}"
            f"{purpose_text}\n\n"
            f"Codigo de verificacion\n"
            f"{normalized_code}\n\n"
            f"Caduca en\n"
            f"{expiry_text}\n\n"
            f"No compartas este codigo con nadie.\n"
            f"Si no reconoces esta solicitud, puedes ignorar este correo con seguridad.\n"
        )

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
    locale = _normalize_mail_language(language)
    if locale == "de":
        return "[Felixxsv Gallery] Zwei-Faktor-Authentifizierungscode"
    if locale == "fr":
        return "[Felixxsv Gallery] Code d'authentification à deux facteurs"
    if locale == "ru":
        return "[Felixxsv Gallery] Код двухфакторной аутентификации"
    if locale == "zh-cn":
        return "[Felixxsv Gallery] 双因素认证码"
    if locale == "es":
        return "[Felixxsv Gallery] Codigo de autenticacion en dos pasos"
    if locale == "ko":
        return "[Felixxsv Gallery] 2단계 인증 코드"
    if locale != "ja":
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

    if locale == "ko":
        return (
            f"{greeting}"
            f"Felixxsv Gallery 로그인 확인을 위해 아래 인증 코드를 입력해 주세요.\n\n"
            f"인증 코드\n"
            f"{normalized_code}\n\n"
            f"유효 시간\n"
            f"{expiry_text}\n\n"
            f"이 코드를 다른 사람과 공유하지 마세요.\n"
            f"본인이 요청하지 않았다면 비밀번호 변경을 검토해 주세요.\n"
        )

    if locale == "de":
        return (
            f"{greeting}"
            f"Gib den unten stehenden Authentifizierungscode ein, um dich bei Felixxsv Gallery anzumelden.\n\n"
            f"Authentifizierungscode\n"
            f"{normalized_code}\n\n"
            f"Gültig für\n"
            f"{expiry_text}\n\n"
            f"Teile diesen Code nicht mit anderen.\n"
            f"Falls du diese Anfrage nicht gestellt hast, erwäge dein Passwort zu ändern.\n"
        )

    if locale == "fr":
        return (
            f"{greeting}"
            f"Saisissez le code d'authentification ci-dessous pour finaliser votre connexion à Felixxsv Gallery.\n\n"
            f"Code d'authentification\n"
            f"{normalized_code}\n\n"
            f"Valide pendant\n"
            f"{expiry_text}\n\n"
            f"Ne partagez pas ce code avec d'autres personnes.\n"
            f"Si vous n'êtes pas à l'origine de cette demande, pensez à changer votre mot de passe.\n"
        )

    if locale == "ru":
        return (
            f"{greeting}"
            f"Введите код аутентификации ниже, чтобы завершить вход в Felixxsv Gallery.\n\n"
            f"Код аутентификации\n"
            f"{normalized_code}\n\n"
            f"Действителен в течение\n"
            f"{expiry_text}\n\n"
            f"Не передавайте этот код другим людям.\n"
            f"Если вы не отправляли этот запрос, рассмотрите возможность смены пароля.\n"
        )

    if locale == "zh-cn":
        return (
            f"{greeting}"
            f"请输入以下认证码以完成 Felixxsv Gallery 登录。\n\n"
            f"认证码\n"
            f"{normalized_code}\n\n"
            f"有效期\n"
            f"{expiry_text}\n\n"
            f"请勿将此认证码告知他人。\n"
            f"如果您没有发起此请求，请考虑更改密码。\n"
        )

    if locale == "es":
        return (
            f"{greeting}"
            f"Introduce el codigo de autenticacion de abajo para completar el inicio de sesion en Felixxsv Gallery.\n\n"
            f"Codigo de autenticacion\n"
            f"{normalized_code}\n\n"
            f"Caduca en\n"
            f"{expiry_text}\n\n"
            f"No compartas este codigo con nadie.\n"
            f"Si no reconoces esta solicitud, considera cambiar tu contrasena.\n"
        )

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
    locale = _normalize_mail_language(language)
    if locale == "de":
        return "[Felixxsv Gallery] Anleitung zum Zurücksetzen des Passworts"
    if locale == "fr":
        return "[Felixxsv Gallery] Instructions de réinitialisation du mot de passe"
    if locale == "ru":
        return "[Felixxsv Gallery] Инструкции по сбросу пароля"
    if locale == "zh-cn":
        return "[Felixxsv Gallery] 密码重置说明"
    if locale == "es":
        return "[Felixxsv Gallery] Instrucciones para restablecer la contrasena"
    if locale == "ko":
        return "[Felixxsv Gallery] 비밀번호 재설정 안내"
    if locale != "ja":
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

    if locale == "de":
        return (
            f"{greeting}"
            f"Für dein Felixxsv Gallery Konto wurde eine Passwortzurücksetzung angefordert.\n"
            f"Verwende den folgenden Link, um fortzufahren.\n\n"
            f"{normalized_reset_url}\n\n"
            f"Gültig für\n"
            f"{expiry_text}\n\n"
            f"Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.\n"
        )

    if locale == "fr":
        return (
            f"{greeting}"
            f"Une réinitialisation du mot de passe a été demandée pour votre compte Felixxsv Gallery.\n"
            f"Utilisez le lien ci-dessous pour continuer.\n\n"
            f"{normalized_reset_url}\n\n"
            f"Valide pendant\n"
            f"{expiry_text}\n\n"
            f"Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet e-mail.\n"
        )

    if locale == "ru":
        return (
            f"{greeting}"
            f"Для вашего аккаунта Felixxsv Gallery был запрошен сброс пароля.\n"
            f"Перейдите по ссылке ниже, чтобы продолжить.\n\n"
            f"{normalized_reset_url}\n\n"
            f"Действительна в течение\n"
            f"{expiry_text}\n\n"
            f"Если вы не отправляли этот запрос, просто проигнорируйте это письмо.\n"
        )

    if locale == "zh-cn":
        return (
            f"{greeting}"
            f"您的 Felixxsv Gallery 账户已请求密码重置。\n"
            f"请使用以下链接继续操作。\n\n"
            f"{normalized_reset_url}\n\n"
            f"有效期\n"
            f"{expiry_text}\n\n"
            f"如果您没有发起此请求，请忽略此邮件。\n"
        )

    if locale == "es":
        return (
            f"{greeting}"
            f"Hemos recibido una solicitud para restablecer la contrasena de tu cuenta de Felixxsv Gallery.\n\n"
            f"Abre el siguiente enlace para continuar:\n"
            f"{normalized_reset_url}\n\n"
            f"Caduca en\n"
            f"{expiry_text}\n\n"
            f"Si no has solicitado este cambio, puedes ignorar este correo.\n"
        )

    if locale == "ko":
        return (
            f"{greeting}"
            f"Felixxsv Gallery 계정의 비밀번호 재설정이 요청되었습니다.\n"
            f"아래 URL로 계속 진행해 주세요.\n\n"
            f"{normalized_reset_url}\n\n"
            f"유효 시간\n"
            f"{expiry_text}\n\n"
            f"본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.\n"
        )

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
