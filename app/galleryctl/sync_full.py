from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import hashlib
import shutil
import sys
import time
from typing import Any

import pymysql
import tomllib
from PIL import Image, UnidentifiedImageError

from galleryctl.colors import extract_top_colors, load_palette_from_conf, load_settings_from_conf


@dataclass(frozen=True)
class Paths:
    source_root: Path
    storage_root: Path
    quarantine_root: Path


@dataclass(frozen=True)
class DbCfg:
    host: str
    port: int
    user: str
    password: str
    database: str


@dataclass(frozen=True)
class AppCfg:
    gallery: str


@dataclass(frozen=True)
class Cfg:
    app: AppCfg
    db: DbCfg
    paths: Paths
    raw: dict[str, Any]


@dataclass(frozen=True)
class TableSchema:
    cols: dict[str, str]

    def has(self, name: str) -> bool:
        return name.lower() in self.cols

    def col_type(self, name: str) -> str | None:
        return self.cols.get(name.lower())


def _load_cfg(path: str) -> Cfg:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    app = raw.get("app") or {}
    db = raw.get("db") or {}
    paths = raw.get("paths") or {}

    gallery = str(app.get("gallery") or "vrchat")

    dbc = DbCfg(
        host=str(db.get("host") or "127.0.0.1"),
        port=int(db.get("port") or 3306),
        user=str(db.get("user") or "gallery"),
        password=str(db.get("password") or ""),
        database=str(db.get("database") or "felixxsv_gallery"),
    )

    pc = Paths(
        source_root=Path(str(paths.get("source_root") or "/data/felixxsv-gallery/source")),
        storage_root=Path(str(paths.get("storage_root") or "/data/felixxsv-gallery/www/storage")),
        quarantine_root=Path(str(paths.get("quarantine_root") or "/data/felixxsv-gallery/quarantine")),
    )

    return Cfg(app=AppCfg(gallery=gallery), db=dbc, paths=pc, raw=raw)


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


def _load_table_schema(conn: pymysql.Connection, table: str) -> TableSchema:
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM {table}")
        rows = cur.fetchall()
    cols: dict[str, str] = {}
    for r in rows:
        cols[str(r["Field"]).lower()] = str(r["Type"]).lower()
    return TableSchema(cols=cols)


def _sha256_file(p: Path) -> tuple[str, bytes]:
    h = hashlib.sha256()
    with p.open("rb") as f:
        while True:
            b = f.read(1024 * 1024)
            if not b:
                break
            h.update(b)
    digest = h.digest()
    return h.hexdigest(), digest


def _hash_value_for_col(col_type: str | None, hex_str: str, digest: bytes) -> Any:
    if not col_type:
        return hex_str
    t = col_type.lower()
    if "binary" in t or "varbinary" in t:
        return digest
    return hex_str


def _dbhash_to_hex(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (bytes, bytearray, memoryview)):
        return bytes(v).hex()
    if isinstance(v, str):
        return v.lower()
    return str(v).lower()


def _parse_shot_at_from_name(name: str) -> datetime | None:
    base = name.split("/")[-1].split("\\")[-1]
    if not base.startswith("VRChat_"):
        return None

    s = base[len("VRChat_") :]
    parts = s.split("_")
    if len(parts) >= 2:
        dt = f"{parts[0]}_{parts[1]}"
        dt = dt.split(".", 1)[0]
        try:
            return datetime.strptime(dt, "%Y-%m-%d_%H-%M-%S")
        except Exception:
            pass

    dt0 = parts[0].split(".", 1)[0] if parts else ""
    if dt0:
        try:
            return datetime.strptime(dt0, "%Y-%m-%d-%H-%M-%S")
        except Exception:
            pass

    return None


def _img_meta(p: Path) -> tuple[int, int, str]:
    img = Image.open(p)
    w, h = img.size
    fmt = (img.format or "").upper()
    if not fmt:
        ext = p.suffix.lower().lstrip(".")
        fmt = ext.upper() if ext else "BIN"
    return int(w), int(h), fmt


def _id_dir3(image_id: int) -> str:
    s = f"{image_id:08d}"
    return f"{s[0:2]}/{s[2:4]}/{s[4:6]}"


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _render_webp(src: Path, dst: Path, max_w: int) -> None:
    img = Image.open(src)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    w, h = img.size
    if w > max_w:
        scale = max_w / float(w)
        nw = max_w
        nh = int(h * scale)
        if nh < 1:
            nh = 1
        img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    _ensure_dir(dst.parent)
    img.save(dst, "WEBP", quality=82, method=6)


def _store_colors(conn: pymysql.Connection, image_id: int, colors: list[dict[str, Any]]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
        if not colors:
            return
        vals = []
        for c in colors:
            vals.append((image_id, int(c["rank_no"]), int(c["color_id"]), float(c["ratio"])))
        cur.executemany(
            "INSERT INTO image_colors (image_id, rank_no, color_id, ratio) VALUES (%s,%s,%s,%s)",
            vals,
        )


def _find_source_by_path(conn: pymysql.Connection, src_schema: TableSchema, gallery: str, rel_path: str) -> dict[str, Any] | None:
    cols = ["id", "image_id", "is_primary", "is_hidden", "source_path"]
    if src_schema.has("content_hash"):
        cols.append("content_hash")
    if src_schema.has("sha256"):
        cols.append("sha256")

    sql = f"SELECT {', '.join(cols)} FROM image_sources WHERE gallery=%s AND source_path=%s LIMIT 1"
    with conn.cursor() as cur:
        cur.execute(sql, (gallery, rel_path))
        return cur.fetchone()


def _find_existing_by_hash(conn: pymysql.Connection, src_schema: TableSchema, gallery: str, hex_str: str, digest: bytes) -> dict[str, Any] | None:
    col = None
    if src_schema.has("content_hash"):
        col = "content_hash"
    elif src_schema.has("sha256"):
        col = "sha256"
    else:
        return None

    val = _hash_value_for_col(src_schema.col_type(col), hex_str, digest)

    with conn.cursor() as cur:
        cur.execute(
            f"""
SELECT image_id, source_path, is_primary, is_hidden
FROM image_sources
WHERE gallery=%s AND {col}=%s
ORDER BY is_primary DESC, id ASC
LIMIT 1
""",
            (gallery, val),
        )
        return cur.fetchone()


def _insert_image(conn: pymysql.Connection, img_schema: TableSchema, gallery: str, shot_at: datetime, meta: tuple[int, int, str], hex_str: str, digest: bytes) -> int:
    w, h, fmt = meta

    cols = ["gallery", "shot_at", "title", "alt", "width", "height", "format", "thumb_path_480", "thumb_path_960", "preview_path"]
    vals = ["%s"] * len(cols)
    params: list[Any] = [gallery, shot_at, "", "", w, h, fmt, "", "", ""]

    if img_schema.has("is_public"):
        cols.append("is_public")
        vals.append("%s")
        params.append(1)

    if img_schema.has("content_hash"):
        cols.append("content_hash")
        vals.append("%s")
        params.append(_hash_value_for_col(img_schema.col_type("content_hash"), hex_str, digest))

    sql = f"INSERT INTO images ({', '.join(cols)}) VALUES ({', '.join(vals)})"

    with conn.cursor() as cur:
        cur.execute(sql, params)
        cur.execute("SELECT LAST_INSERT_ID() AS id")
        return int(cur.fetchone()["id"])


def _update_image(conn: pymysql.Connection, img_schema: TableSchema, image_id: int, shot_at: datetime, meta: tuple[int, int, str], hex_str: str, digest: bytes) -> None:
    w, h, fmt = meta
    sets = ["shot_at=%s", "width=%s", "height=%s", "format=%s"]
    params: list[Any] = [shot_at, w, h, fmt]

    if img_schema.has("content_hash"):
        sets.append("content_hash=%s")
        params.append(_hash_value_for_col(img_schema.col_type("content_hash"), hex_str, digest))

    params.append(image_id)
    sql = f"UPDATE images SET {', '.join(sets)} WHERE id=%s"
    with conn.cursor() as cur:
        cur.execute(sql, params)


def _update_derivative_paths(conn: pymysql.Connection, image_id: int, t480: str, t960: str, prev: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
UPDATE images
SET thumb_path_480=%s, thumb_path_960=%s, preview_path=%s
WHERE id=%s
""",
            (t480, t960, prev, image_id),
        )


def _insert_source(
    conn: pymysql.Connection,
    src_schema: TableSchema,
    gallery: str,
    image_id: int,
    rel_path: str,
    hex_str: str,
    digest: bytes,
    size_bytes: int,
    mtime_epoch: int,
    is_primary: int,
    is_hidden: int,
) -> None:
    cols = ["gallery", "image_id", "source_path"]
    vals = ["%s", "%s", "%s"]
    params: list[Any] = [gallery, image_id, rel_path]

    if src_schema.has("content_hash"):
        cols.append("content_hash")
        vals.append("%s")
        params.append(_hash_value_for_col(src_schema.col_type("content_hash"), hex_str, digest))

    if src_schema.has("sha256"):
        cols.append("sha256")
        vals.append("%s")
        params.append(_hash_value_for_col(src_schema.col_type("sha256"), hex_str, digest))

    if src_schema.has("size_bytes"):
        cols.append("size_bytes")
        vals.append("%s")
        params.append(int(size_bytes))

    if src_schema.has("mtime_epoch"):
        cols.append("mtime_epoch")
        vals.append("%s")
        params.append(int(mtime_epoch))

    cols.extend(["is_primary", "is_hidden"])
    vals.extend(["%s", "%s"])
    params.extend([int(is_primary), int(is_hidden)])

    sql = f"INSERT INTO image_sources ({', '.join(cols)}) VALUES ({', '.join(vals)})"

    with conn.cursor() as cur:
        cur.execute(sql, params)


def _update_source_row(
    conn: pymysql.Connection,
    src_schema: TableSchema,
    row_id: int,
    image_id: int,
    hex_str: str,
    digest: bytes,
    size_bytes: int,
    mtime_epoch: int,
    is_primary: int,
    is_hidden: int,
) -> None:
    sets = ["image_id=%s", "is_primary=%s", "is_hidden=%s"]
    params: list[Any] = [image_id, int(is_primary), int(is_hidden)]

    if src_schema.has("content_hash"):
        sets.append("content_hash=%s")
        params.append(_hash_value_for_col(src_schema.col_type("content_hash"), hex_str, digest))

    if src_schema.has("sha256"):
        sets.append("sha256=%s")
        params.append(_hash_value_for_col(src_schema.col_type("sha256"), hex_str, digest))

    if src_schema.has("size_bytes"):
        sets.append("size_bytes=%s")
        params.append(int(size_bytes))

    if src_schema.has("mtime_epoch"):
        sets.append("mtime_epoch=%s")
        params.append(int(mtime_epoch))

    params.append(row_id)
    sql = f"UPDATE image_sources SET {', '.join(sets)} WHERE id=%s"
    with conn.cursor() as cur:
        cur.execute(sql, params)


def _set_primary_source(conn: pymysql.Connection, gallery: str, image_id: int, source_row_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE image_sources SET is_primary=0 WHERE gallery=%s AND image_id=%s", (gallery, image_id))
        cur.execute("UPDATE image_sources SET is_primary=1, is_hidden=0 WHERE id=%s", (source_row_id,))


def _scan_files(root: Path) -> list[Path]:
    exts = {".png", ".jpg", ".jpeg", ".webp"}
    out: list[Path] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in exts:
            continue
        out.append(p)
    out.sort()
    return out


def _copy_to_quarantine(src: Path, qroot: Path, rel_path: str) -> None:
    dst = qroot / rel_path
    _ensure_dir(dst.parent)
    shutil.copy2(src, dst)


def _cleanup_partial(conn: pymysql.Connection, image_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM image_sources WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM images WHERE id=%s", (image_id,))


def _fetch_image_derivatives(conn: pymysql.Connection, image_id: int) -> tuple[str, str, str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT thumb_path_480, thumb_path_960, preview_path FROM images WHERE id=%s LIMIT 1",
            (image_id,),
        )
        r = cur.fetchone() or {}
    return str(r.get("thumb_path_480") or ""), str(r.get("thumb_path_960") or ""), str(r.get("preview_path") or "")


def _remove_derivatives(storage_root: Path, t480: str, t960: str, prev: str) -> None:
    for rel in (t480, t960, prev):
        if not rel:
            continue
        p = storage_root / rel
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass


def _pick_existing_source(conn: pymysql.Connection, gallery: str, image_id: int, src_root: Path) -> int | None:
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT id, source_path
FROM image_sources
WHERE gallery=%s AND image_id=%s AND is_hidden=0
ORDER BY is_primary DESC, id ASC
""",
            (gallery, image_id),
        )
        rows = cur.fetchall()

    for r in rows:
        sid = int(r["id"])
        rel = str(r["source_path"] or "")
        if not rel:
            continue
        if (src_root / rel).exists():
            return sid
    return None


def _hide_primary_source(conn: pymysql.Connection, source_row_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE image_sources SET is_hidden=1, is_primary=0 WHERE id=%s", (source_row_id,))


def _hard_delete_image(conn: pymysql.Connection, image_id: int, gallery: str) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM image_tags WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM image_sources WHERE gallery=%s AND image_id=%s", (gallery, image_id))
        cur.execute("DELETE FROM image_stats WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM images WHERE id=%s AND gallery=%s", (image_id, gallery))


def _count_visible_sources(conn: pymysql.Connection, gallery: str, image_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS c FROM image_sources WHERE gallery=%s AND image_id=%s AND is_hidden=0",
            (gallery, image_id),
        )
        r = cur.fetchone() or {}
    return int(r.get("c") or 0)


def run_sync_full(config_path: str, dry_run: bool, workers_override: int | None = None) -> int:
    t0 = time.time()
    cfg = _load_cfg(config_path)

    gallery = cfg.app.gallery
    src_root = cfg.paths.source_root
    storage = cfg.paths.storage_root
    quarantine_root = cfg.paths.quarantine_root / gallery

    files_on_disk = _scan_files(src_root)
    scanned_rel: set[str] = set()

    scanned = 0
    added = 0
    updated = 0
    deleted = 0
    duplicated = 0
    quarantined = 0
    failed = 0

    err_counts: dict[str, int] = {}
    err_samples: list[tuple[str, str]] = []

    palette = load_palette_from_conf(cfg.raw)
    cset = load_settings_from_conf(cfg.raw)

    conn = _db_connect(cfg)
    img_schema = _load_table_schema(conn, "images")
    src_schema = _load_table_schema(conn, "image_sources")

    try:
        for f in files_on_disk:
            scanned += 1
            rel = str(f.relative_to(src_root)).replace("\\", "/")
            scanned_rel.add(rel)

            st = f.stat()
            size_bytes = int(st.st_size)
            mtime_epoch = int(st.st_mtime)

            shot_at = _parse_shot_at_from_name(f.name)
            if shot_at is None:
                if not dry_run:
                    try:
                        _copy_to_quarantine(f, quarantine_root, rel)
                    except Exception as e:
                        k = f"{type(e).__name__}: {e}"
                        err_counts[k] = err_counts.get(k, 0) + 1
                        if len(err_samples) < 5:
                            err_samples.append((rel, k))
                        failed += 1
                        continue
                quarantined += 1
                continue

            hex_str, digest = _sha256_file(f)

            try:
                by_path = _find_source_by_path(conn, src_schema, gallery, rel)
            except Exception as e:
                k = f"{type(e).__name__}: {e}"
                err_counts[k] = err_counts.get(k, 0) + 1
                if len(err_samples) < 5:
                    err_samples.append((rel, k))
                failed += 1
                continue

            if by_path is not None:
                existing_hex = _dbhash_to_hex(by_path.get("content_hash")) or _dbhash_to_hex(by_path.get("sha256"))
                if existing_hex == hex_str.lower():
                    duplicated += 1
                    continue

                if dry_run:
                    updated += 1
                    continue

                try:
                    meta = _img_meta(f)
                    image_id = int(by_path["image_id"])
                    row_id = int(by_path["id"])

                    _update_image(conn, img_schema, image_id, shot_at, meta, hex_str, digest)

                    dir3 = _id_dir3(image_id)
                    t480_rel = f"thumbs/{gallery}/{dir3}/{image_id}_w480.webp"
                    t960_rel = f"thumbs/{gallery}/{dir3}/{image_id}_w960.webp"
                    prev_rel = f"previews/{gallery}/{dir3}/{image_id}_max2560.webp"

                    _render_webp(f, storage / t480_rel, 480)
                    _render_webp(f, storage / t960_rel, 960)
                    _render_webp(f, storage / prev_rel, 2560)

                    _update_derivative_paths(conn, image_id, t480_rel, t960_rel, prev_rel)

                    _update_source_row(conn, src_schema, row_id, image_id, hex_str, digest, size_bytes, mtime_epoch, 1, 0)
                    _set_primary_source(conn, gallery, image_id, row_id)

                    cols = extract_top_colors(f, palette, cset)
                    _store_colors(conn, image_id, cols)

                    updated += 1
                except Exception as e:
                    k = f"{type(e).__name__}: {e}"
                    err_counts[k] = err_counts.get(k, 0) + 1
                    if len(err_samples) < 5:
                        err_samples.append((rel, k))
                    failed += 1
                continue

            try:
                existing = _find_existing_by_hash(conn, src_schema, gallery, hex_str, digest)
            except Exception as e:
                k = f"{type(e).__name__}: {e}"
                err_counts[k] = err_counts.get(k, 0) + 1
                if len(err_samples) < 5:
                    err_samples.append((rel, k))
                failed += 1
                continue

            if existing is not None:
                if dry_run:
                    duplicated += 1
                    continue
                try:
                    _insert_source(conn, src_schema, gallery, int(existing["image_id"]), rel, hex_str, digest, size_bytes, mtime_epoch, 0, 1)
                    duplicated += 1
                except Exception as e:
                    k = f"{type(e).__name__}: {e}"
                    err_counts[k] = err_counts.get(k, 0) + 1
                    if len(err_samples) < 5:
                        err_samples.append((rel, k))
                    failed += 1
                continue

            if dry_run:
                added += 1
                continue

            image_id: int | None = None
            try:
                try:
                    meta = _img_meta(f)
                except (UnidentifiedImageError, OSError) as e:
                    _copy_to_quarantine(f, quarantine_root, rel)
                    quarantined += 1
                    k = f"{type(e).__name__}: {e}"
                    err_counts[k] = err_counts.get(k, 0) + 1
                    if len(err_samples) < 5:
                        err_samples.append((rel, k))
                    continue

                image_id = _insert_image(conn, img_schema, gallery, shot_at, meta, hex_str, digest)
                dir3 = _id_dir3(image_id)

                t480_rel = f"thumbs/{gallery}/{dir3}/{image_id}_w480.webp"
                t960_rel = f"thumbs/{gallery}/{dir3}/{image_id}_w960.webp"
                prev_rel = f"previews/{gallery}/{dir3}/{image_id}_max2560.webp"

                _render_webp(f, storage / t480_rel, 480)
                _render_webp(f, storage / t960_rel, 960)
                _render_webp(f, storage / prev_rel, 2560)

                _update_derivative_paths(conn, image_id, t480_rel, t960_rel, prev_rel)
                _insert_source(conn, src_schema, gallery, image_id, rel, hex_str, digest, size_bytes, mtime_epoch, 1, 0)

                cols = extract_top_colors(f, palette, cset)
                _store_colors(conn, image_id, cols)

                added += 1
            except Exception as e:
                if image_id is not None:
                    try:
                        _cleanup_partial(conn, image_id)
                    except Exception:
                        pass
                k = f"{type(e).__name__}: {e}"
                err_counts[k] = err_counts.get(k, 0) + 1
                if len(err_samples) < 5:
                    err_samples.append((rel, k))
                failed += 1
                continue

        with conn.cursor() as cur:
            cur.execute(
                """
SELECT id, image_id, source_path
FROM image_sources
WHERE gallery=%s AND is_primary=1 AND is_hidden=0
""",
                (gallery,),
            )
            primary_rows = cur.fetchall()

        for r in primary_rows:
            sid = int(r["id"])
            image_id = int(r["image_id"])
            rel = str(r["source_path"] or "")
            if not rel:
                continue
            if rel in scanned_rel:
                continue

            deleted += 1
            if dry_run:
                continue

            try:
                _hide_primary_source(conn, sid)
            except Exception as e:
                k = f"{type(e).__name__}: {e}"
                err_counts[k] = err_counts.get(k, 0) + 1
                if len(err_samples) < 8:
                    err_samples.append((rel, k))
                failed += 1
                continue

            try:
                cand = _pick_existing_source(conn, gallery, image_id, src_root)
                if cand is not None:
                    _set_primary_source(conn, gallery, image_id, cand)
                    continue

                visible = _count_visible_sources(conn, gallery, image_id)
                if visible > 0:
                    continue

                t480, t960, prev = _fetch_image_derivatives(conn, image_id)
                _hard_delete_image(conn, image_id, gallery)
                _remove_derivatives(storage, t480, t960, prev)
            except Exception as e:
                k = f"{type(e).__name__}: {e}"
                err_counts[k] = err_counts.get(k, 0) + 1
                if len(err_samples) < 8:
                    err_samples.append((rel, k))
                failed += 1

    finally:
        conn.close()

    elapsed = time.time() - t0
    print(
        f"sync-full done scanned={scanned} added={added} updated={updated} deleted={deleted} duplicated={duplicated} quarantined={quarantined} failed={failed} elapsed_sec={elapsed:.2f}"
    )

    if err_counts:
        top = sorted(err_counts.items(), key=lambda x: x[1], reverse=True)[:12]
        for msg0, cnt in top:
            print(f"sync-full error cnt={cnt} err={msg0}", file=sys.stderr)
        for rel0, msg0 in err_samples[:8]:
            print(f"sync-full error sample file={rel0} err={msg0}", file=sys.stderr)

    return 0