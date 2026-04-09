from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
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
    gallery: str
    source_root: Path | None
    storage_root: Path | None
    db: DbCfg


def _load_cfg(path: str) -> Cfg:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    app = raw.get("app") or {}
    db = raw.get("db") or {}
    paths = raw.get("paths") or {}

    source_root_raw = str(paths.get("source_root") or "").strip()
    storage_root_raw = str(paths.get("storage_root") or "").strip()

    return Cfg(
        gallery=str(app.get("gallery") or "vrchat"),
        source_root=Path(source_root_raw) if source_root_raw else None,
        storage_root=Path(storage_root_raw) if storage_root_raw else None,
        db=DbCfg(
            host=str(db.get("host") or "127.0.0.1"),
            port=int(db.get("port") or 3306),
            user=str(db.get("user") or "gallery"),
            password=str(db.get("password") or ""),
            database=str(db.get("database") or "felixxsv_gallery"),
        ),
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


def _collect_storage_paths(conn: pymysql.Connection, gallery: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT thumb_path_480, thumb_path_960, preview_path
FROM images
WHERE gallery=%s
""",
            (gallery,),
        )
        rows = cur.fetchall() or []

    rels: set[str] = set()
    for row in rows:
        for key in ("thumb_path_480", "thumb_path_960", "preview_path"):
            rel = str(row.get(key) or "").strip()
            if rel:
                rels.add(rel.lstrip("/"))
    return rels


def _collect_source_paths(conn: pymysql.Connection, gallery: str) -> set[str]:
    if not _table_exists(conn, "image_sources"):
        return set()
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT source_path
FROM image_sources
WHERE gallery=%s
""",
            (gallery,),
        )
        rows = cur.fetchall() or []
    return {str(row.get("source_path") or "").strip().lstrip("/") for row in rows if str(row.get("source_path") or "").strip()}


def _delete_relative_files(root: Path | None, rel_paths: set[str], dry_run: bool) -> tuple[int, int]:
    if root is None:
        return 0, 0
    deleted = 0
    missing = 0
    for rel in sorted(rel_paths):
        target = (root / rel).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            continue
        if not target.exists():
            missing += 1
            continue
        if target.is_file():
            if not dry_run:
                target.unlink()
            deleted += 1
    return deleted, missing


def _prune_empty_dirs(root: Path | None, dry_run: bool) -> int:
    if root is None or not root.exists():
        return 0
    removed = 0
    for path in sorted((p for p in root.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        try:
            next(path.iterdir())
        except StopIteration:
            if not dry_run:
                path.rmdir()
            removed += 1
        except OSError:
            continue
    return removed


def _count(conn: pymysql.Connection, sql: str, params: tuple[Any, ...]) -> int:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        row = cur.fetchone() or {}
    return int(row.get("cnt") or 0)


def run_wipe_gallery(
    config_path: str,
    dry_run: bool,
    delete_storage: bool,
    delete_source: bool,
    delete_tags: bool,
) -> int:
    t0 = time.time()
    cfg = _load_cfg(config_path)
    conn = _db_connect(cfg)

    storage_rels: set[str] = set()
    source_rels: set[str] = set()
    image_count = 0
    content_count = 0
    source_count = 0
    stats_count = 0
    admin_state_count = 0
    tag_count = 0

    try:
        if delete_storage:
            storage_rels = _collect_storage_paths(conn, cfg.gallery)
        if delete_source:
            source_rels = _collect_source_paths(conn, cfg.gallery)

        image_count = _count(conn, "SELECT COUNT(*) AS cnt FROM images WHERE gallery=%s", (cfg.gallery,))
        content_count = _count(conn, "SELECT COUNT(*) AS cnt FROM gallery_contents WHERE gallery=%s", (cfg.gallery,)) if _table_exists(conn, "gallery_contents") else 0
        source_count = _count(conn, "SELECT COUNT(*) AS cnt FROM image_sources WHERE gallery=%s", (cfg.gallery,)) if _table_exists(conn, "image_sources") else 0
        stats_count = (
            _count(
                conn,
                """
SELECT COUNT(*) AS cnt
FROM image_stats st
JOIN images i ON i.id=st.image_id
WHERE i.gallery=%s
""",
                (cfg.gallery,),
            )
            if _table_exists(conn, "image_stats")
            else 0
        )
        admin_state_count = (
            _count(
                conn,
                """
SELECT COUNT(*) AS cnt
FROM admin_content_states acs
JOIN images i ON i.id=acs.image_id
WHERE i.gallery=%s
""",
                (cfg.gallery,),
            )
            if _table_exists(conn, "admin_content_states")
            else 0
        )
        tag_count = (
            _count(
                conn,
                """
SELECT COUNT(*) AS cnt
FROM tags
WHERE gallery=%s
""",
                (cfg.gallery,),
            )
            if delete_tags and _table_exists(conn, "tags")
            else 0
        )

        if not dry_run:
            with conn.cursor() as cur:
                if _table_exists(conn, "admin_content_states"):
                    cur.execute(
                        """
DELETE acs
FROM admin_content_states acs
JOIN images i ON i.id=acs.image_id
WHERE i.gallery=%s
""",
                        (cfg.gallery,),
                    )
                if _table_exists(conn, "image_stats"):
                    cur.execute(
                        """
DELETE st
FROM image_stats st
JOIN images i ON i.id=st.image_id
WHERE i.gallery=%s
""",
                        (cfg.gallery,),
                    )
                if _table_exists(conn, "gallery_contents"):
                    cur.execute("DELETE FROM gallery_contents WHERE gallery=%s", (cfg.gallery,))
                if _table_exists(conn, "image_sources"):
                    cur.execute("DELETE FROM image_sources WHERE gallery=%s", (cfg.gallery,))
                cur.execute("DELETE FROM images WHERE gallery=%s", (cfg.gallery,))
                if delete_tags and _table_exists(conn, "tags"):
                    cur.execute("DELETE FROM tags WHERE gallery=%s", (cfg.gallery,))
            conn.commit()
        else:
            conn.rollback()

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    storage_deleted = 0
    storage_missing = 0
    storage_dirs_removed = 0
    source_deleted = 0
    source_missing = 0
    source_dirs_removed = 0

    if delete_storage:
        storage_deleted, storage_missing = _delete_relative_files(cfg.storage_root, storage_rels, dry_run=dry_run)
        storage_dirs_removed = _prune_empty_dirs(cfg.storage_root, dry_run=dry_run)
    if delete_source:
        source_deleted, source_missing = _delete_relative_files(cfg.source_root, source_rels, dry_run=dry_run)
        source_dirs_removed = _prune_empty_dirs(cfg.source_root, dry_run=dry_run)

    elapsed = time.time() - t0
    print(
        "wipe-gallery done "
        f"gallery={cfg.gallery} "
        f"dry_run={1 if dry_run else 0} "
        f"images={image_count} "
        f"contents={content_count} "
        f"sources={source_count} "
        f"image_stats={stats_count} "
        f"admin_states={admin_state_count} "
        f"tags={tag_count} "
        f"storage_targets={len(storage_rels)} "
        f"storage_deleted={storage_deleted} "
        f"storage_missing={storage_missing} "
        f"storage_dirs_removed={storage_dirs_removed} "
        f"source_targets={len(source_rels)} "
        f"source_deleted={source_deleted} "
        f"source_missing={source_missing} "
        f"source_dirs_removed={source_dirs_removed} "
        f"elapsed_sec={elapsed:.2f}"
    )
    return 0
