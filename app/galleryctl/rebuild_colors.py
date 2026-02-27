from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time
from typing import Any

import pymysql
import tomllib

from galleryctl.colors import extract_top_colors, load_palette_from_conf, load_settings_from_conf


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
    source_root: Path
    db: DbCfg
    raw: dict[str, Any]


def _load_cfg(path: str) -> Cfg:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    app = raw.get("app") or {}
    db = raw.get("db") or {}
    paths = raw.get("paths") or {}

    gallery = str(app.get("gallery") or "vrchat")
    source_root = Path(str(paths.get("source_root") or "/data/felixxsv-gallery/source"))

    dbc = DbCfg(
        host=str(db.get("host") or "127.0.0.1"),
        port=int(db.get("port") or 3306),
        user=str(db.get("user") or "gallery"),
        password=str(db.get("password") or ""),
        database=str(db.get("database") or "felixxsv_gallery"),
    )
    return Cfg(gallery=gallery, source_root=source_root, db=dbc, raw=raw)


def _db_connect(cfg: Cfg) -> pymysql.Connection:
    return pymysql.connect(
        host=cfg.db.host,
        port=cfg.db.port,
        user=cfg.db.user,
        password=cfg.db.password,
        database=cfg.db.database,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _store_colors(conn: pymysql.Connection, image_id: int, colors: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
        if not colors:
            return
        vals = []
        for c in colors:
            cid = int(c["color_id"])
            if cid < 1 or cid > 10:
                continue
            vals.append((image_id, int(c["rank_no"]), cid, float(c["ratio"])))
        if not vals:
            return
        cur.executemany(
            "INSERT INTO image_colors (image_id, rank_no, color_id, ratio) VALUES (%s,%s,%s,%s)",
            vals,
        )


def run_rebuild_colors(
    config_path: str,
    dry_run: bool,
    rebuild_all: bool,
    from_id: int | None,
    to_id: int | None,
    limit: int | None,
) -> int:
    t0 = time.time()
    cfg = _load_cfg(config_path)

    palette = load_palette_from_conf(cfg.raw)
    cset = load_settings_from_conf(cfg.raw)

    scanned = 0
    rebuilt = 0
    skipped = 0
    missing = 0
    failed = 0

    conn = _db_connect(cfg)
    try:
        where = ["i.gallery=%s"]
        params: list[Any] = [cfg.gallery]

        if from_id is not None:
            where.append("i.id >= %s")
            params.append(int(from_id))
        if to_id is not None:
            where.append("i.id <= %s")
            params.append(int(to_id))

        where_sql = " AND ".join(where)

        sql = f"""
SELECT
  i.id AS image_id,
  s.source_path AS source_path,
  COUNT(ic.image_id) AS color_rows,
  SUM(CASE WHEN ic.color_id=0 OR ic.color_id IS NULL THEN 1 ELSE 0 END) AS bad0_rows,
  SUM(CASE WHEN ic.color_id BETWEEN 1 AND 10 THEN 1 ELSE 0 END) AS ok_rows
FROM images i
JOIN image_sources s
  ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1
LEFT JOIN image_colors ic
  ON ic.image_id=i.id
WHERE {where_sql}
GROUP BY i.id, s.source_path
ORDER BY i.id ASC
"""
        with conn.cursor() as cur:
            cur.execute(sql, [cfg.gallery, *params])
            rows = cur.fetchall()

        if limit is not None and limit > 0:
            rows = rows[: int(limit)]

        for r in rows:
            scanned += 1
            image_id = int(r["image_id"])
            rel = str(r["source_path"])
            color_rows = int(r["color_rows"] or 0)
            bad0 = int(r["bad0_rows"] or 0)
            ok = int(r["ok_rows"] or 0)

            needs = rebuild_all or (color_rows == 0) or (bad0 > 0) or (ok == 0)
            if not needs:
                skipped += 1
                continue

            src = cfg.source_root / rel
            if not src.exists():
                missing += 1
                continue

            if dry_run:
                rebuilt += 1
                continue

            try:
                colors = extract_top_colors(src, palette, cset)
                _store_colors(conn, image_id, colors)
                rebuilt += 1
            except Exception:
                failed += 1

    finally:
        conn.close()

    elapsed = time.time() - t0
    print(
        f"rebuild-colors done scanned={scanned} rebuilt={rebuilt} skipped={skipped} missing={missing} failed={failed} elapsed_sec={elapsed:.2f}"
    )
    return 0
