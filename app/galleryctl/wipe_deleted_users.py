from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time
import tomllib

import pymysql


@dataclass(frozen=True)
class DbCfg:
    host: str
    port: int
    user: str
    password: str
    database: str


@dataclass(frozen=True)
class Cfg:
    db: DbCfg


def _load_cfg(path: str) -> Cfg:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    db = raw.get("db") or {}
    return Cfg(
        db=DbCfg(
            host=str(db.get("host") or "127.0.0.1"),
            port=int(db.get("port") or 3306),
            user=str(db.get("user") or "gallery"),
            password=str(db.get("password") or ""),
            database=str(db.get("database") or "felixxsv_gallery"),
        )
    )


def _db_connect(cfg: Cfg) -> pymysql.Connection:
    return pymysql.connect(
        host=cfg.db.host,
        port=cfg.db.port,
        user=cfg.db.user,
        password=cfg.db.password,
        database=cfg.db.database,
        charset="utf8mb4",
        autocommit=False,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _table_exists(conn: pymysql.Connection, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE %s", (table,))
        return cur.fetchone() is not None


def _detect_table(conn: pymysql.Connection, *names: str) -> str | None:
    for name in names:
        if _table_exists(conn, name):
            return name
    return None


def _fetch_deleted_user_ids(conn: pymysql.Connection) -> list[int]:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE status='deleted' ORDER BY id ASC")
        rows = cur.fetchall() or []
    return [int(row["id"]) for row in rows]


def _count_in_clause(conn: pymysql.Connection, sql_prefix: str, user_ids: list[int]) -> int:
    if not user_ids:
        return 0
    placeholders = ", ".join(["%s"] * len(user_ids))
    sql = f"{sql_prefix} ({placeholders})"
    with conn.cursor() as cur:
        cur.execute(sql, tuple(user_ids))
        row = cur.fetchone() or {}
    return int(row.get("cnt") or 0)


def run_wipe_deleted_users(config_path: str, dry_run: bool) -> int:
    t0 = time.time()
    cfg = _load_cfg(config_path)
    conn = _db_connect(cfg)

    deleted_user_ids: list[int] = []
    counts: dict[str, int] = {}

    try:
        if not _table_exists(conn, "users"):
            raise RuntimeError("users テーブルが存在しません。")

        deleted_user_ids = _fetch_deleted_user_ids(conn)
        if not deleted_user_ids:
            print("wipe-deleted-users done dry_run=1 deleted_users=0")
            conn.rollback()
            return 0

        targets = {
            "auth_identities": "SELECT COUNT(*) AS cnt FROM auth_identities WHERE user_id IN",
            "password_credentials": "SELECT COUNT(*) AS cnt FROM password_credentials WHERE user_id IN",
            "email_verifications": "SELECT COUNT(*) AS cnt FROM email_verifications WHERE user_id IN",
            "password_reset_tokens": "SELECT COUNT(*) AS cnt FROM password_reset_tokens WHERE user_id IN",
            "two_factor_settings": "SELECT COUNT(*) AS cnt FROM two_factor_settings WHERE user_id IN",
            "two_factor_challenges": "SELECT COUNT(*) AS cnt FROM two_factor_challenges WHERE user_id IN",
            "admin_user_preferences": "SELECT COUNT(*) AS cnt FROM admin_user_preferences WHERE user_id IN",
            "user_links": "SELECT COUNT(*) AS cnt FROM user_links WHERE user_id IN",
            "user_badges": "SELECT COUNT(*) AS cnt FROM user_badges WHERE user_id IN",
            "image_likes": "SELECT COUNT(*) AS cnt FROM image_likes WHERE user_id IN",
        }
        for table, sql_prefix in targets.items():
            counts[table] = _count_in_clause(conn, sql_prefix, deleted_user_ids) if _table_exists(conn, table) else 0

        session_table = _detect_table(conn, "user_sessions", "sessions")
        counts["sessions"] = (
            _count_in_clause(conn, f"SELECT COUNT(*) AS cnt FROM {session_table} WHERE user_id IN", deleted_user_ids)
            if session_table
            else 0
        )
        counts["audit_logs_actor"] = (
            _count_in_clause(conn, "SELECT COUNT(*) AS cnt FROM audit_logs WHERE actor_user_id IN", deleted_user_ids)
            if _table_exists(conn, "audit_logs")
            else 0
        )
        counts["user_invites_issuer"] = (
            _count_in_clause(conn, "SELECT COUNT(*) AS cnt FROM user_invites WHERE issued_by_user_id IN", deleted_user_ids)
            if _table_exists(conn, "user_invites")
            else 0
        )
        counts["user_badges_granted_by"] = (
            _count_in_clause(conn, "SELECT COUNT(*) AS cnt FROM user_badges WHERE granted_by IN", deleted_user_ids)
            if _table_exists(conn, "user_badges")
            else 0
        )
        counts["gallery_contents_uploader"] = (
            _count_in_clause(conn, "SELECT COUNT(*) AS cnt FROM gallery_contents WHERE uploader_user_id IN", deleted_user_ids)
            if _table_exists(conn, "gallery_contents")
            else 0
        )
        counts["images_owner"] = _count_in_clause(conn, "SELECT COUNT(*) AS cnt FROM images WHERE owner_user_id IN", deleted_user_ids)

        if not dry_run:
            placeholders = ", ".join(["%s"] * len(deleted_user_ids))
            params = tuple(deleted_user_ids)
            with conn.cursor() as cur:
                if _table_exists(conn, "gallery_contents"):
                    cur.execute(f"UPDATE gallery_contents SET uploader_user_id=NULL WHERE uploader_user_id IN ({placeholders})", params)
                cur.execute(f"UPDATE images SET owner_user_id=NULL WHERE owner_user_id IN ({placeholders})", params)
                if _table_exists(conn, "audit_logs"):
                    cur.execute(f"UPDATE audit_logs SET actor_user_id=NULL WHERE actor_user_id IN ({placeholders})", params)
                if _table_exists(conn, "user_invites"):
                    cur.execute(f"UPDATE user_invites SET issued_by_user_id=NULL WHERE issued_by_user_id IN ({placeholders})", params)
                if _table_exists(conn, "user_badges"):
                    cur.execute(f"UPDATE user_badges SET granted_by=NULL WHERE granted_by IN ({placeholders})", params)
                if _table_exists(conn, "image_likes"):
                    cur.execute(f"DELETE FROM image_likes WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "user_badges"):
                    cur.execute(f"DELETE FROM user_badges WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "user_links"):
                    cur.execute(f"DELETE FROM user_links WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "admin_user_preferences"):
                    cur.execute(f"DELETE FROM admin_user_preferences WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "two_factor_challenges"):
                    cur.execute(f"DELETE FROM two_factor_challenges WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "two_factor_settings"):
                    cur.execute(f"DELETE FROM two_factor_settings WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "password_reset_tokens"):
                    cur.execute(f"DELETE FROM password_reset_tokens WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "email_verifications"):
                    cur.execute(f"DELETE FROM email_verifications WHERE user_id IN ({placeholders})", params)
                if session_table:
                    cur.execute(f"DELETE FROM {session_table} WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "password_credentials"):
                    cur.execute(f"DELETE FROM password_credentials WHERE user_id IN ({placeholders})", params)
                if _table_exists(conn, "auth_identities"):
                    cur.execute(f"DELETE FROM auth_identities WHERE user_id IN ({placeholders})", params)
                cur.execute(f"DELETE FROM users WHERE id IN ({placeholders}) AND status='deleted'", params)
            conn.commit()
        else:
            conn.rollback()

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    elapsed = time.time() - t0
    print(
        "wipe-deleted-users done "
        f"dry_run={1 if dry_run else 0} "
        f"deleted_users={len(deleted_user_ids)} "
        f"auth_identities={counts.get('auth_identities', 0)} "
        f"password_credentials={counts.get('password_credentials', 0)} "
        f"sessions={counts.get('sessions', 0)} "
        f"email_verifications={counts.get('email_verifications', 0)} "
        f"password_reset_tokens={counts.get('password_reset_tokens', 0)} "
        f"two_factor_settings={counts.get('two_factor_settings', 0)} "
        f"two_factor_challenges={counts.get('two_factor_challenges', 0)} "
        f"admin_user_preferences={counts.get('admin_user_preferences', 0)} "
        f"user_links={counts.get('user_links', 0)} "
        f"user_badges={counts.get('user_badges', 0)} "
        f"user_badges_granted_by={counts.get('user_badges_granted_by', 0)} "
        f"image_likes={counts.get('image_likes', 0)} "
        f"gallery_contents_uploader={counts.get('gallery_contents_uploader', 0)} "
        f"images_owner={counts.get('images_owner', 0)} "
        f"user_invites_issuer={counts.get('user_invites_issuer', 0)} "
        f"audit_logs_actor={counts.get('audit_logs_actor', 0)} "
        f"elapsed_sec={elapsed:.2f}"
    )
    return 0
