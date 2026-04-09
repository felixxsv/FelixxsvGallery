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
    db: DbCfg


def _load_cfg(path: str) -> Cfg:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    app = raw.get("app") or {}
    db = raw.get("db") or {}

    return Cfg(
        gallery=str(app.get("gallery") or "vrchat"),
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


def _table_cols(conn: pymysql.Connection, table: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
        rows = cur.fetchall()
    return {str(row["Field"]).lower() for row in rows}


def _resolve_image_owner_column(cols: set[str]) -> str | None:
    if "owner_user_id" in cols:
        return "owner_user_id"
    if "uploader_user_id" in cols:
        return "uploader_user_id"
    return None


def _content_insert_values(image: dict[str, Any], content_cols: set[str], owner_col: str | None) -> tuple[list[str], list[Any]]:
    cols = ["gallery", "title"]
    vals: list[Any] = [str(image["gallery"]), str(image.get("title") or image.get("alt") or f"image-{image['id']}")]

    if "alt" in content_cols:
        cols.append("alt")
        vals.append(str(image.get("alt") or ""))
    if "shot_at" in content_cols:
        cols.append("shot_at")
        vals.append(image.get("shot_at"))
    if "is_public" in content_cols:
        cols.append("is_public")
        vals.append(int(image.get("is_public") or 0))
    if "uploader_user_id" in content_cols and owner_col:
        cols.append("uploader_user_id")
        vals.append(image.get(owner_col))
    if "thumbnail_image_id" in content_cols:
        cols.append("thumbnail_image_id")
        vals.append(int(image["id"]))
    if "image_count" in content_cols:
        cols.append("image_count")
        vals.append(1)

    return cols, vals


def _create_content_for_image(
    conn: pymysql.Connection,
    image: dict[str, Any],
    content_cols: set[str],
    map_cols: set[str],
    owner_col: str | None,
) -> int:
    cols, vals = _content_insert_values(image, content_cols, owner_col)
    with conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO gallery_contents ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
            vals,
        )
        cur.execute("SELECT LAST_INSERT_ID() AS id")
        content_id = int((cur.fetchone() or {})["id"])

        map_insert_cols = ["content_id", "image_id"]
        map_insert_vals: list[Any] = [content_id, int(image["id"])]
        if "sort_order" in map_cols:
            map_insert_cols.append("sort_order")
            map_insert_vals.append(1)
        if "is_thumbnail" in map_cols:
            map_insert_cols.append("is_thumbnail")
            map_insert_vals.append(1)

        cur.execute(
            f"INSERT INTO gallery_content_images ({', '.join(map_insert_cols)}) VALUES ({', '.join(['%s'] * len(map_insert_cols))})",
            map_insert_vals,
        )
    return content_id


def run_rebuild_contents(
    config_path: str,
    dry_run: bool,
    rebuild_all: bool,
    from_id: int | None,
    to_id: int | None,
    limit: int | None,
) -> int:
    t0 = time.time()
    cfg = _load_cfg(config_path)

    scanned = 0
    created = 0
    skipped = 0
    deleted_contents = 0
    deleted_mappings = 0

    conn = _db_connect(cfg)
    try:
        if not _table_exists(conn, "gallery_contents") or not _table_exists(conn, "gallery_content_images"):
            raise RuntimeError("gallery_contents / gallery_content_images テーブルが存在しません。先に migration を適用してください。")

        image_cols = _table_cols(conn, "images")
        content_cols = _table_cols(conn, "gallery_contents")
        map_cols = _table_cols(conn, "gallery_content_images")
        owner_col = _resolve_image_owner_column(image_cols)

        where = ["i.gallery=%s"]
        params: list[Any] = [cfg.gallery]

        if "is_public" in image_cols:
            where.append("i.is_public IN (0, 1)")

        if from_id is not None:
            where.append("i.id >= %s")
            params.append(int(from_id))
        if to_id is not None:
            where.append("i.id <= %s")
            params.append(int(to_id))

        if not rebuild_all:
            where.append("gci.image_id IS NULL")

        where_sql = " AND ".join(where)
        owner_select = f", i.{owner_col} AS {owner_col}" if owner_col else ""

        sql = f"""
SELECT
  i.id,
  i.gallery,
  i.title,
  i.alt,
  i.shot_at,
  i.created_at,
  i.is_public
  {owner_select}
FROM images i
LEFT JOIN gallery_content_images gci
  ON gci.image_id=i.id
WHERE {where_sql}
ORDER BY COALESCE(i.shot_at, i.created_at) ASC, i.id ASC
"""
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() or []

        if limit is not None and int(limit) > 0:
            rows = rows[: int(limit)]

        if rebuild_all:
            with conn.cursor() as cur:
                cur.execute(
                    """
SELECT COUNT(*) AS cnt
FROM gallery_content_images gci
JOIN gallery_contents gc ON gc.id=gci.content_id
WHERE gc.gallery=%s
""",
                    (cfg.gallery,),
                )
                deleted_mappings = int((cur.fetchone() or {}).get("cnt") or 0)
                cur.execute("SELECT COUNT(*) AS cnt FROM gallery_contents WHERE gallery=%s", (cfg.gallery,))
                deleted_contents = int((cur.fetchone() or {}).get("cnt") or 0)

            if not dry_run:
                with conn.cursor() as cur:
                    cur.execute(
                        """
DELETE gci
FROM gallery_content_images gci
JOIN gallery_contents gc ON gc.id=gci.content_id
WHERE gc.gallery=%s
""",
                        (cfg.gallery,),
                    )
                    cur.execute("DELETE FROM gallery_contents WHERE gallery=%s", (cfg.gallery,))

        for row in rows:
            scanned += 1
            if dry_run:
                created += 1
                continue

            _create_content_for_image(
                conn=conn,
                image=row,
                content_cols=content_cols,
                map_cols=map_cols,
                owner_col=owner_col,
            )
            created += 1

        if dry_run:
            conn.rollback()
        else:
            conn.commit()

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    elapsed = time.time() - t0
    mode = "rebuild-all" if rebuild_all else "append-missing"
    print(
        "rebuild-contents done "
        f"mode={mode} scanned={scanned} created={created} skipped={skipped} "
        f"deleted_mappings={deleted_mappings} deleted_contents={deleted_contents} elapsed_sec={elapsed:.2f}"
    )
    return 0
