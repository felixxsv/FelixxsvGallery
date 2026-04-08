from __future__ import annotations

import ipaddress
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from db import load_conf


# Cached for process lifetime; config changes require server restart anyway
@lru_cache(maxsize=1)
def _get_gallery_name() -> str:
    conf_path = os.environ.get(
        "GALLERY_CONF",
        str(Path(__file__).with_name("gallery.conf")),
    )
    conf = load_conf(conf_path)
    return conf["app"]["gallery"]


def _fetch_one_dict(cursor) -> dict | None:
    row = cursor.fetchone()
    if row is None:
        return None
    return dict(row)


def _fetch_all_dict(cursor) -> list[dict]:
    rows = cursor.fetchall()
    if not rows:
        return []
    return [dict(row) for row in rows]


def _rows_affected(cursor) -> int:
    return int(cursor.rowcount or 0)


def _last_insert_id(cursor) -> int:
    return int(cursor.lastrowid or 0)


def _to_json_or_none(value: dict | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _ip_bytes_to_text(value: bytes | None) -> str | None:
    if value is None:
        return None
    try:
        return ipaddress.ip_address(value).compressed
    except Exception:
        return None


def get_user_by_id(conn, user_id: int) -> dict | None:
    sql = """
        SELECT
            id,
            gallery,
            user_key,
            display_name,
            email AS primary_email,
            avatar_path,
            bio,
            role,
            status,
            can_upload AS upload_enabled,
            is_email_verified,
            must_reset_password,
            force_logout_after,
            deleted_at,
            created_at,
            updated_at
        FROM users
        WHERE id = %s
          AND gallery = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, _get_gallery_name()))
        return _fetch_one_dict(cursor)


def get_user_by_user_key(conn, user_key: str) -> dict | None:
    sql = """
        SELECT
            id,
            gallery,
            user_key,
            display_name,
            email AS primary_email,
            avatar_path,
            bio,
            role,
            status,
            can_upload AS upload_enabled,
            is_email_verified,
            must_reset_password,
            force_logout_after,
            deleted_at,
            created_at,
            updated_at
        FROM users
        WHERE gallery = %s
          AND user_key = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (_get_gallery_name(), user_key))
        return _fetch_one_dict(cursor)


def get_user_by_primary_email(conn, email: str) -> dict | None:
    sql = """
        SELECT
            id,
            gallery,
            user_key,
            display_name,
            email AS primary_email,
            avatar_path,
            bio,
            role,
            status,
            can_upload AS upload_enabled,
            is_email_verified,
            must_reset_password,
            force_logout_after,
            deleted_at,
            created_at,
            updated_at
        FROM users
        WHERE gallery = %s
          AND email = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (_get_gallery_name(), email))
        return _fetch_one_dict(cursor)


def create_user(
    conn,
    user_key: str,
    display_name: str,
    primary_email: str | None,
    password_hash: str | None = None,
    role: str = "user",
    status: str = "active",
    upload_enabled: bool = True,
    is_email_verified: bool = False,
    must_reset_password: bool = False,
    avatar_path: str | None = None,
) -> int:
    sql = """
        INSERT INTO users (
            gallery,
            user_key,
            display_name,
            email,
            password_hash,
            role,
            status,
            can_upload,
            is_disabled,
            is_email_verified,
            must_reset_password
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    params = (
        _get_gallery_name(),
        user_key,
        display_name,
        primary_email,
        password_hash or "!",
        role,
        status,
        1 if upload_enabled else 0,
        1 if status in {"disabled", "locked", "deleted"} else 0,
        1 if is_email_verified else 0,
        1 if must_reset_password else 0,
    )
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _last_insert_id(cursor)


def update_user_profile(
    conn,
    user_id: int,
    display_name: str | None = None,
    primary_email: str | None = None,
    user_key: str | None = None,
    avatar_path: str | None = None,
    clear_avatar: bool = False,
    bio: str | None = None,
    clear_bio: bool = False,
) -> int:
    fields: list[str] = []
    params: list[Any] = []

    if display_name is not None:
        fields.append("display_name = %s")
        params.append(display_name)
    if primary_email is not None:
        fields.append("email = %s")
        params.append(primary_email)
    if user_key is not None:
        fields.append("user_key = %s")
        params.append(user_key)
    if avatar_path is not None:
        fields.append("avatar_path = %s")
        params.append(avatar_path)
    elif clear_avatar:
        fields.append("avatar_path = NULL")
    if bio is not None:
        fields.append("bio = %s")
        params.append(bio)
    elif clear_bio:
        fields.append("bio = NULL")

    if not fields:
        return 0

    sql = f"""
        UPDATE users
        SET {", ".join(fields)}
        WHERE id = %s
          AND gallery = %s
    """
    params.append(user_id)
    params.append(_get_gallery_name())

    with conn.cursor() as cursor:
        cursor.execute(sql, tuple(params))
        return _rows_affected(cursor)



def get_user_links(conn, user_id: int) -> list[dict]:
    sql = """
        SELECT id, url, display_order
        FROM user_links
        WHERE user_id = %s AND gallery = %s
        ORDER BY display_order ASC, id ASC
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, _get_gallery_name()))
        return _fetch_all_dict(cursor)


def count_user_links(conn, user_id: int) -> int:
    sql = """
        SELECT COUNT(*) AS cnt
        FROM user_links
        WHERE user_id = %s AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, _get_gallery_name()))
        row = _fetch_one_dict(cursor)
        return int(row["cnt"]) if row else 0


def create_user_link(conn, user_id: int, url: str, display_order: int) -> int:
    sql = """
        INSERT INTO user_links (user_id, gallery, url, display_order)
        VALUES (%s, %s, %s, %s)
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, _get_gallery_name(), url, display_order))
        return _last_insert_id(cursor)


def delete_user_link(conn, link_id: int, user_id: int) -> int:
    sql = """
        DELETE FROM user_links
        WHERE id = %s AND user_id = %s AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (link_id, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def reorder_user_links(conn, user_id: int) -> None:
    """Compact display_order values after a deletion."""
    sql = """
        SELECT id FROM user_links
        WHERE user_id = %s AND gallery = %s
        ORDER BY display_order ASC, id ASC
    """
    update_sql = """
        UPDATE user_links SET display_order = %s WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, _get_gallery_name()))
        rows = _fetch_all_dict(cursor)
    with conn.cursor() as cursor:
        for i, row in enumerate(rows):
            cursor.execute(update_sql, (i, row["id"]))


def update_user_registration_profile(
    conn,
    user_id: int,
    user_key: str,
    display_name: str,
    primary_email: str | None,
    is_email_verified: bool,
    status: str = "active",
    upload_enabled: bool = True,
) -> int:
    sql = """
        UPDATE users
        SET
            user_key = %s,
            display_name = %s,
            email = %s,
            status = %s,
            can_upload = %s,
            is_disabled = %s,
            is_email_verified = %s
        WHERE id = %s
          AND gallery = %s
    """
    params = (
        user_key,
        display_name,
        primary_email,
        status,
        1 if upload_enabled else 0,
        1 if status in {"disabled", "locked", "deleted"} else 0,
        1 if is_email_verified else 0,
        user_id,
        _get_gallery_name(),
    )
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _rows_affected(cursor)

def update_user_status(
    conn,
    user_id: int,
    status: str,
    deleted_at=None,
) -> int:
    sql = """
        UPDATE users
        SET
            status = %s,
            is_disabled = %s,
            deleted_at = %s
        WHERE id = %s
          AND gallery = %s
    """
    disabled = 1 if status in {"disabled", "locked", "deleted"} else 0
    with conn.cursor() as cursor:
        cursor.execute(sql, (status, disabled, deleted_at, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def update_user_role(conn, user_id: int, role: str) -> int:
    sql = """
        UPDATE users
        SET role = %s
        WHERE id = %s
          AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (role, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def update_user_upload_enabled(conn, user_id: int, upload_enabled: bool) -> int:
    sql = """
        UPDATE users
        SET can_upload = %s
        WHERE id = %s
          AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (1 if upload_enabled else 0, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def mark_user_email_verified(conn, user_id: int, verified: bool = True) -> int:
    sql = """
        UPDATE users
        SET is_email_verified = %s
        WHERE id = %s
          AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (1 if verified else 0, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def set_user_must_reset_password(conn, user_id: int, must_reset_password: bool = True) -> int:
    sql = """
        UPDATE users
        SET must_reset_password = %s
        WHERE id = %s
          AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (1 if must_reset_password else 0, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def set_user_force_logout_after(conn, user_id: int, force_logout_after) -> int:
    sql = """
        UPDATE users
        SET force_logout_after = %s
        WHERE id = %s
          AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (force_logout_after, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def get_identity_by_provider_user_id(
    conn,
    provider: str,
    provider_user_id: str,
) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            provider,
            provider_user_id,
            provider_email,
            provider_display_name,
            is_enabled,
            linked_at,
            last_used_at,
            created_at,
            updated_at
        FROM auth_identities
        WHERE provider = %s
          AND provider_user_id = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (provider, provider_user_id))
        return _fetch_one_dict(cursor)


def get_identity_by_user_and_provider(
    conn,
    user_id: int,
    provider: str,
) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            provider,
            provider_user_id,
            provider_email,
            provider_display_name,
            is_enabled,
            linked_at,
            last_used_at,
            created_at,
            updated_at
        FROM auth_identities
        WHERE user_id = %s
          AND provider = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, provider))
        return _fetch_one_dict(cursor)


def list_identities_by_user_id(conn, user_id: int) -> list[dict]:
    sql = """
        SELECT
            id,
            user_id,
            provider,
            provider_user_id,
            provider_email,
            provider_display_name,
            is_enabled,
            linked_at,
            last_used_at,
            created_at,
            updated_at
        FROM auth_identities
        WHERE user_id = %s
        ORDER BY id ASC
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id,))
        return _fetch_all_dict(cursor)


def create_auth_identity(
    conn,
    user_id: int,
    provider: str,
    provider_user_id: str | None = None,
    provider_email: str | None = None,
    provider_display_name: str | None = None,
    is_enabled: bool = True,
) -> int:
    sql = """
        INSERT INTO auth_identities (
            user_id,
            provider,
            provider_user_id,
            provider_email,
            provider_display_name,
            is_enabled
        ) VALUES (%s, %s, %s, %s, %s, %s)
    """
    params = (
        user_id,
        provider,
        provider_user_id,
        provider_email,
        provider_display_name,
        1 if is_enabled else 0,
    )
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _last_insert_id(cursor)


def update_auth_identity_last_used(conn, identity_id: int, last_used_at) -> int:
    sql = """
        UPDATE auth_identities
        SET last_used_at = %s
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (last_used_at, identity_id))
        return _rows_affected(cursor)


def update_auth_identity_enabled(conn, identity_id: int, is_enabled: bool) -> int:
    sql = """
        UPDATE auth_identities
        SET is_enabled = %s
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (1 if is_enabled else 0, identity_id))
        return _rows_affected(cursor)


def reactivate_auth_identity(
    conn,
    identity_id: int,
    user_id: int,
    provider_email: str | None = None,
    provider_display_name: str | None = None,
) -> int:
    """無効化済みのidentityを別ユーザーも含めて再有効化する"""
    sql = """
        UPDATE auth_identities
        SET user_id = %s,
            provider_email = %s,
            provider_display_name = %s,
            is_enabled = 1
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, provider_email, provider_display_name, identity_id))
        return _rows_affected(cursor)


def reassign_auth_identity(
    conn,
    identity_id: int,
    user_id: int,
    provider_user_id: str,
    provider_email: str | None = None,
    provider_display_name: str | None = None,
) -> int:
    """無効化済みのidentityをDiscord IDごと差し替えて再有効化する（別Discordアカウントへの切り替え用）"""
    sql = """
        UPDATE auth_identities
        SET user_id = %s,
            provider_user_id = %s,
            provider_email = %s,
            provider_display_name = %s,
            is_enabled = 1
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, provider_user_id, provider_email, provider_display_name, identity_id))
        return _rows_affected(cursor)


def get_password_credentials_by_user_id(conn, user_id: int) -> dict | None:
    sql = """
        SELECT
            user_id,
            password_hash,
            password_updated_at,
            failed_attempts,
            locked_until,
            created_at,
            updated_at
        FROM password_credentials
        WHERE user_id = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id,))
        row = _fetch_one_dict(cursor)
        if row is not None:
            return row

    fallback_sql = """
        SELECT
            id AS user_id,
            password_hash,
            created_at AS password_updated_at,
            0 AS failed_attempts,
            NULL AS locked_until,
            created_at,
            updated_at
        FROM users
        WHERE id = %s
          AND gallery = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(fallback_sql, (user_id, _get_gallery_name()))
        return _fetch_one_dict(cursor)


def create_password_credentials(
    conn,
    user_id: int,
    password_hash: str,
) -> int:
    sql = """
        INSERT INTO password_credentials (
            user_id,
            password_hash
        ) VALUES (%s, %s)
        ON DUPLICATE KEY UPDATE
            password_hash = VALUES(password_hash),
            password_updated_at = CURRENT_TIMESTAMP(6),
            updated_at = CURRENT_TIMESTAMP(6)
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, password_hash))
        update_user_sql = """
            UPDATE users
            SET password_hash = %s
            WHERE id = %s
              AND gallery = %s
        """
        cursor.execute(update_user_sql, (password_hash, user_id, _get_gallery_name()))
        return 1


def update_password_hash(
    conn,
    user_id: int,
    password_hash: str,
    password_updated_at,
) -> int:
    sql = """
        INSERT INTO password_credentials (
            user_id,
            password_hash,
            password_updated_at,
            failed_attempts,
            locked_until
        ) VALUES (%s, %s, %s, 0, NULL)
        ON DUPLICATE KEY UPDATE
            password_hash = VALUES(password_hash),
            password_updated_at = VALUES(password_updated_at),
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = CURRENT_TIMESTAMP(6)
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, password_hash, password_updated_at))
        update_user_sql = """
            UPDATE users
            SET password_hash = %s
            WHERE id = %s
              AND gallery = %s
        """
        cursor.execute(update_user_sql, (password_hash, user_id, _get_gallery_name()))
        return 1


def update_password_failed_attempts(
    conn,
    user_id: int,
    failed_attempts: int,
    locked_until=None,
) -> int:
    sql = """
        INSERT INTO password_credentials (
            user_id,
            password_hash,
            password_updated_at,
            failed_attempts,
            locked_until
        )
        SELECT
            id,
            password_hash,
            updated_at,
            %s,
            %s
        FROM users
        WHERE id = %s
          AND gallery = %s
        ON DUPLICATE KEY UPDATE
            failed_attempts = VALUES(failed_attempts),
            locked_until = VALUES(locked_until),
            updated_at = CURRENT_TIMESTAMP(6)
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (failed_attempts, locked_until, user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def clear_password_failed_attempts(conn, user_id: int) -> int:
    sql = """
        INSERT INTO password_credentials (
            user_id,
            password_hash,
            password_updated_at,
            failed_attempts,
            locked_until
        )
        SELECT
            id,
            password_hash,
            updated_at,
            0,
            NULL
        FROM users
        WHERE id = %s
          AND gallery = %s
        ON DUPLICATE KEY UPDATE
            failed_attempts = 0,
            locked_until = NULL,
            updated_at = CURRENT_TIMESTAMP(6)
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, _get_gallery_name()))
        return _rows_affected(cursor)


def get_session_by_token_hash(conn, session_token_hash: str) -> dict | None:
    sql = """
        SELECT
            sid AS id,
            user_id,
            sid AS session_token_hash,
            ip_addr AS ip_address,
            user_agent,
            created_at,
            last_seen_at,
            expires_at,
            two_factor_verified_at,
            two_factor_remember_until,
            revoked_at
        FROM user_sessions
        WHERE sid = %s
          AND gallery = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (session_token_hash, _get_gallery_name()))
        return _fetch_one_dict(cursor)


def get_session_by_id(conn, session_id: str) -> dict | None:
    sql = """
        SELECT
            sid AS id,
            user_id,
            sid AS session_token_hash,
            ip_addr AS ip_address,
            user_agent,
            created_at,
            last_seen_at,
            expires_at,
            two_factor_verified_at,
            two_factor_remember_until,
            revoked_at
        FROM user_sessions
        WHERE sid = %s
          AND gallery = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (session_id, _get_gallery_name()))
        return _fetch_one_dict(cursor)


def list_active_sessions_by_user_id(conn, user_id: int, now) -> list[dict]:
    sql = """
        SELECT
            sid AS id,
            user_id,
            sid AS session_token_hash,
            ip_addr AS ip_address,
            user_agent,
            created_at,
            last_seen_at,
            expires_at,
            two_factor_verified_at,
            two_factor_remember_until,
            revoked_at
        FROM user_sessions
        WHERE gallery = %s
          AND user_id = %s
          AND revoked_at IS NULL
          AND expires_at > %s
        ORDER BY created_at DESC
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (_get_gallery_name(), user_id, now))
        return _fetch_all_dict(cursor)


def create_session(
    conn,
    session_id: str,
    user_id: int,
    session_token_hash: str,
    ip_address: bytes | None,
    user_agent: str | None,
    expires_at,
    now_dt,
    two_factor_verified_at=None,
    two_factor_remember_until=None,
) -> str:
    sql = """
        INSERT INTO user_sessions (
            sid,
            gallery,
            user_id,
            created_at,
            last_seen_at,
            last_access_at,
            last_presence_at,
            expires_at,
            two_factor_verified_at,
            two_factor_remember_until,
            user_agent,
            ip_addr
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    params = (
        session_token_hash,
        _get_gallery_name(),
        user_id,
        now_dt,
        now_dt,
        now_dt,
        now_dt,
        expires_at,
        two_factor_verified_at,
        two_factor_remember_until,
        user_agent or "",
        _ip_bytes_to_text(ip_address) or "",
    )
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return session_token_hash


def update_session_last_seen(
    conn,
    session_id: str,
    last_seen_at,
    expires_at=None,
) -> int:
    fields = ["last_seen_at = %s"]
    params: list[Any] = [last_seen_at]

    if expires_at is not None:
        fields.append("expires_at = %s")
        params.append(expires_at)

    sql = f"""
        UPDATE user_sessions
        SET {", ".join(fields)}
        WHERE sid = %s
          AND gallery = %s
    """
    params.append(session_id)
    params.append(_get_gallery_name())

    with conn.cursor() as cursor:
        cursor.execute(sql, tuple(params))
        return _rows_affected(cursor)


def update_session_presence(
    conn,
    session_id: str,
    now_dt,
    visible: bool,
    expires_at=None,
) -> int:
    fields = ["last_seen_at = %s", "last_access_at = %s"]
    params: list[Any] = [now_dt, now_dt]

    if visible:
        fields.append("last_presence_at = %s")
        params.append(now_dt)
    else:
        fields.append("last_presence_at = NULL")

    if expires_at is not None:
        fields.append("expires_at = %s")
        params.append(expires_at)

    sql = f"""
        UPDATE user_sessions
        SET {", ".join(fields)}
        WHERE sid = %s
          AND gallery = %s
          AND revoked_at IS NULL
    """
    params.append(session_id)
    params.append(_get_gallery_name())

    with conn.cursor() as cursor:
        cursor.execute(sql, tuple(params))
        return _rows_affected(cursor)


def mark_session_two_factor_verified(
    conn,
    session_id: str,
    verified_at,
    remember_until=None,
) -> int:
    sql = """
        UPDATE user_sessions
        SET
            two_factor_verified_at = %s,
            two_factor_remember_until = %s
        WHERE sid = %s
          AND gallery = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (verified_at, remember_until, session_id, _get_gallery_name()))
        return _rows_affected(cursor)


def revoke_session_by_id(conn, session_id: str, revoked_at) -> int:
    sql = """
        UPDATE user_sessions
        SET revoked_at = %s
        WHERE sid = %s
          AND gallery = %s
          AND revoked_at IS NULL
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (revoked_at, session_id, _get_gallery_name()))
        return _rows_affected(cursor)


def revoke_sessions_by_user_id(conn, user_id: int, revoked_at) -> int:
    sql = """
        UPDATE user_sessions
        SET revoked_at = %s
        WHERE gallery = %s
          AND user_id = %s
          AND revoked_at IS NULL
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (revoked_at, _get_gallery_name(), user_id))
        return _rows_affected(cursor)


def revoke_sessions_before(conn, user_id: int, force_logout_after) -> int:
    sql = """
        UPDATE user_sessions
        SET revoked_at = %s
        WHERE gallery = %s
          AND user_id = %s
          AND created_at < %s
          AND revoked_at IS NULL
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (force_logout_after, _get_gallery_name(), user_id, force_logout_after))
        return _rows_affected(cursor)


def get_latest_active_email_verification(
    conn,
    user_id: int,
    purpose: str,
    now,
) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            email,
            code_hash,
            purpose,
            attempt_count,
            expires_at,
            consumed_at,
            created_at
        FROM email_verifications
        WHERE user_id = %s
          AND purpose = %s
          AND consumed_at IS NULL
          AND expires_at > %s
        ORDER BY created_at DESC
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, purpose, now))
        return _fetch_one_dict(cursor)


def get_email_verification_by_id(conn, verification_id: int) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            email,
            code_hash,
            purpose,
            attempt_count,
            expires_at,
            consumed_at,
            created_at
        FROM email_verifications
        WHERE id = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (verification_id,))
        return _fetch_one_dict(cursor)


def create_email_verification(
    conn,
    user_id: int,
    email: str,
    code_hash: str,
    purpose: str,
    expires_at,
) -> int:
    sql = """
        INSERT INTO email_verifications (
            user_id,
            email,
            code_hash,
            purpose,
            expires_at
        ) VALUES (%s, %s, %s, %s, %s)
    """
    params = (user_id, email, code_hash, purpose, expires_at)
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _last_insert_id(cursor)


def increment_email_verification_attempts(conn, verification_id: int) -> int:
    sql = """
        UPDATE email_verifications
        SET attempt_count = attempt_count + 1
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (verification_id,))
        return _rows_affected(cursor)


def consume_email_verification(conn, verification_id: int, consumed_at) -> int:
    sql = """
        UPDATE email_verifications
        SET consumed_at = %s
        WHERE id = %s
          AND consumed_at IS NULL
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (consumed_at, verification_id))
        return _rows_affected(cursor)


def expire_active_email_verifications(
    conn,
    user_id: int,
    purpose: str,
    now,
) -> int:
    sql = """
        UPDATE email_verifications
        SET expires_at = %s
        WHERE user_id = %s
          AND purpose = %s
          AND consumed_at IS NULL
          AND expires_at > %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (now, user_id, purpose, now))
        return _rows_affected(cursor)


def get_active_password_reset_token(
    conn,
    user_id: int,
    now,
) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            token_hash,
            requested_ip,
            expires_at,
            consumed_at,
            created_at
        FROM password_reset_tokens
        WHERE user_id = %s
          AND consumed_at IS NULL
          AND expires_at > %s
        ORDER BY created_at DESC
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, now))
        return _fetch_one_dict(cursor)


def get_password_reset_token_by_hash(
    conn,
    token_hash: str,
    now=None,
) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            token_hash,
            requested_ip,
            expires_at,
            consumed_at,
            created_at
        FROM password_reset_tokens
        WHERE token_hash = %s
          AND consumed_at IS NULL
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (token_hash,))
        return _fetch_one_dict(cursor)


def get_password_reset_token_by_id(conn, token_id: int) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            token_hash,
            requested_ip,
            expires_at,
            consumed_at,
            created_at
        FROM password_reset_tokens
        WHERE id = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (token_id,))
        return _fetch_one_dict(cursor)


def create_password_reset_token(
    conn,
    user_id: int,
    token_hash: str,
    requested_ip: bytes | None,
    expires_at,
) -> int:
    sql = """
        INSERT INTO password_reset_tokens (
            user_id,
            token_hash,
            requested_ip,
            expires_at
        ) VALUES (%s, %s, %s, %s)
    """
    params = (user_id, token_hash, _ip_bytes_to_text(requested_ip), expires_at)
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _last_insert_id(cursor)


def consume_password_reset_token(conn, token_id: int, consumed_at) -> int:
    sql = """
        UPDATE password_reset_tokens
        SET consumed_at = %s
        WHERE id = %s
          AND consumed_at IS NULL
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (consumed_at, token_id))
        return _rows_affected(cursor)


def expire_active_password_reset_tokens(
    conn,
    user_id: int,
    now,
) -> int:
    sql = """
        UPDATE password_reset_tokens
        SET expires_at = %s
        WHERE user_id = %s
          AND consumed_at IS NULL
          AND expires_at > %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (now, user_id, now))
        return _rows_affected(cursor)


def get_two_factor_settings_by_user_id(conn, user_id: int) -> dict | None:
    sql = """
        SELECT
            user_id,
            method,
            is_enabled,
            is_required,
            enabled_at,
            updated_at
        FROM two_factor_settings
        WHERE user_id = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id,))
        return _fetch_one_dict(cursor)


def create_two_factor_settings(
    conn,
    user_id: int,
    method: str = "email",
    is_enabled: bool = False,
    is_required: bool = False,
) -> int:
    sql = """
        INSERT INTO two_factor_settings (
            user_id,
            method,
            is_enabled,
            is_required
        ) VALUES (%s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            method = VALUES(method),
            is_enabled = VALUES(is_enabled),
            is_required = VALUES(is_required),
            updated_at = CURRENT_TIMESTAMP(6)
    """
    params = (user_id, method, 1 if is_enabled else 0, 1 if is_required else 0)
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return 1


def update_two_factor_settings(
    conn,
    user_id: int,
    is_enabled: bool | None = None,
    is_required: bool | None = None,
    enabled_at=None,
) -> int:
    fields: list[str] = []
    params: list[Any] = []

    if is_enabled is not None:
        fields.append("is_enabled = %s")
        params.append(1 if is_enabled else 0)
    if is_required is not None:
        fields.append("is_required = %s")
        params.append(1 if is_required else 0)
    if enabled_at is not None:
        fields.append("enabled_at = %s")
        params.append(enabled_at)

    if not fields:
        return 0

    sql = f"""
        UPDATE two_factor_settings
        SET {", ".join(fields)}
        WHERE user_id = %s
    """
    params.append(user_id)

    with conn.cursor() as cursor:
        cursor.execute(sql, tuple(params))
        return _rows_affected(cursor)


def get_active_two_factor_challenge(
    conn,
    user_id: int,
    purpose: str,
    now,
) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            session_id,
            purpose,
            code_hash,
            attempt_count,
            expires_at,
            consumed_at,
            created_at
        FROM two_factor_challenges
        WHERE user_id = %s
          AND purpose = %s
          AND consumed_at IS NULL
          AND expires_at > %s
        ORDER BY created_at DESC
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (user_id, purpose, now))
        return _fetch_one_dict(cursor)


def get_two_factor_challenge_by_session_id(
    conn,
    session_id: str,
    now=None,
) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            session_id,
            purpose,
            code_hash,
            attempt_count,
            expires_at,
            consumed_at,
            created_at
        FROM two_factor_challenges
        WHERE session_id = %s
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (session_id,))
        return _fetch_one_dict(cursor)


def get_two_factor_challenge_by_id(conn, challenge_id: int) -> dict | None:
    sql = """
        SELECT
            id,
            user_id,
            session_id,
            purpose,
            code_hash,
            attempt_count,
            expires_at,
            consumed_at,
            created_at
        FROM two_factor_challenges
        WHERE id = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (challenge_id,))
        return _fetch_one_dict(cursor)


def create_two_factor_challenge(
    conn,
    user_id: int,
    session_id: str | None,
    purpose: str,
    code_hash: str,
    expires_at,
) -> int:
    sql = """
        INSERT INTO two_factor_challenges (
            user_id,
            session_id,
            purpose,
            code_hash,
            expires_at
        ) VALUES (%s, %s, %s, %s, %s)
    """
    params = (user_id, session_id, purpose, code_hash, expires_at)
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _last_insert_id(cursor)


def increment_two_factor_challenge_attempts(conn, challenge_id: int) -> int:
    sql = """
        UPDATE two_factor_challenges
        SET attempt_count = attempt_count + 1
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (challenge_id,))
        return _rows_affected(cursor)


def consume_two_factor_challenge(conn, challenge_id: int, consumed_at) -> int:
    sql = """
        UPDATE two_factor_challenges
        SET consumed_at = %s
        WHERE id = %s
          AND consumed_at IS NULL
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (consumed_at, challenge_id))
        return _rows_affected(cursor)


def expire_active_two_factor_challenges(
    conn,
    user_id: int,
    purpose: str,
    now,
) -> int:
    sql = """
        UPDATE two_factor_challenges
        SET expires_at = %s
        WHERE user_id = %s
          AND purpose = %s
          AND consumed_at IS NULL
          AND expires_at > %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (now, user_id, purpose, now))
        return _rows_affected(cursor)


def get_user_invite_by_code(conn, invite_code: str, now=None) -> dict | None:
    sql = """
        SELECT
            id,
            issued_by_user_id,
            invite_code,
            email,
            role,
            status,
            expires_at,
            used_at,
            created_at
        FROM user_invites
        WHERE invite_code = %s
        LIMIT 1
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (invite_code,))
        return _fetch_one_dict(cursor)


def list_user_invites(
    conn,
    status: str | None = None,
    email: str | None = None,
) -> list[dict]:
    conditions: list[str] = []
    params: list[Any] = []

    if status is not None:
        conditions.append("status = %s")
        params.append(status)
    if email is not None:
        conditions.append("email = %s")
        params.append(email)

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    sql = f"""
        SELECT
            id,
            issued_by_user_id,
            invite_code,
            email,
            role,
            status,
            expires_at,
            used_at,
            created_at
        FROM user_invites
        {where_clause}
        ORDER BY created_at DESC
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, tuple(params))
        return _fetch_all_dict(cursor)


def create_user_invite(
    conn,
    issued_by_user_id: int | None,
    invite_code: str,
    email: str | None,
    role: str,
    expires_at,
) -> int:
    sql = """
        INSERT INTO user_invites (
            issued_by_user_id,
            invite_code,
            email,
            role,
            expires_at
        ) VALUES (%s, %s, %s, %s, %s)
    """
    params = (issued_by_user_id, invite_code, email, role, expires_at)
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _last_insert_id(cursor)


def mark_user_invite_used(conn, invite_id: int, used_at) -> int:
    sql = """
        UPDATE user_invites
        SET
            status = 'used',
            used_at = %s
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (used_at, invite_id))
        return _rows_affected(cursor)


def update_user_invite_status(conn, invite_id: int, status: str) -> int:
    sql = """
        UPDATE user_invites
        SET status = %s
        WHERE id = %s
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, (status, invite_id))
        return _rows_affected(cursor)


def create_audit_log(
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
) -> int:
    sql = """
        INSERT INTO audit_logs (
            actor_user_id,
            action_type,
            target_type,
            target_id,
            result,
            ip_address,
            user_agent,
            summary,
            meta_json
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    params = (
        actor_user_id,
        action_type,
        target_type,
        target_id,
        result,
        _ip_bytes_to_text(ip_address),
        user_agent,
        summary,
        _to_json_or_none(meta_json),
    )
    with conn.cursor() as cursor:
        cursor.execute(sql, params)
        return _last_insert_id(cursor)
