from __future__ import annotations

from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import os
import re
import shutil
import uuid
import hashlib
import tempfile

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
import pymysql
from pymysql.err import IntegrityError
import tomllib
from PIL import Image, UnidentifiedImageError

from galleryctl.colors import extract_top_colors, load_palette_from_conf, load_settings_from_conf


def load_conf(path: str) -> dict:
    return tomllib.loads(Path(path).read_text(encoding="utf-8"))


def db_conn(conf: dict, autocommit: bool = True) -> pymysql.Connection:
    db = conf["db"]
    return pymysql.connect(
        host=db["host"],
        port=int(db["port"]),
        user=db["user"],
        password=db["password"],
        database=db["database"],
        charset="utf8mb4",
        autocommit=autocommit,
        cursorclass=pymysql.cursors.DictCursor,
    )


def clamp_per_page(n: int) -> int:
    return n if n in (50, 100, 150, 200) else 100


def parse_csv_strs(s: str | None) -> list[str]:
    if not s:
        return []
    out: list[str] = []
    for x in s.split(","):
        x = x.strip()
        if x:
            out.append(x)
    return out


def parse_csv_ints(s: str | None) -> list[int]:
    if not s:
        return []
    out: list[int] = []
    for x in s.split(","):
        x = x.strip()
        if not x:
            continue
        try:
            out.append(int(x))
        except ValueError:
            continue
    return out


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def cache_path(cache_root: Path, image_id: int, ext: str) -> Path:
    s = f"{image_id:010d}"
    return cache_root / s[0:2] / s[2:4] / s[4:6] / f"{image_id}.{ext}"


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = rgb
    r = 0 if r < 0 else 255 if r > 255 else r
    g = 0 if g < 0 else 255 if g > 255 else g
    b = 0 if b < 0 else 255 if b > 255 else b
    return f"#{r:02x}{g:02x}{b:02x}"


def _default_palette() -> list[dict]:
    base = [
        (1, "Red", (255, 75, 75)),
        (2, "Orange", (255, 159, 26)),
        (3, "Yellow", (255, 210, 26)),
        (4, "Green", (52, 211, 153)),
        (5, "Cyan", (34, 211, 238)),
        (6, "Blue", (96, 165, 250)),
        (7, "Purple", (167, 139, 250)),
        (8, "Pink", (251, 113, 133)),
        (9, "White", (229, 231, 235)),
        (10, "Black", (17, 24, 39)),
    ]
    return [{"id": cid, "name": name, "hex": _rgb_to_hex(rgb)} for cid, name, rgb in base]


def _palette_from_conf(conf: dict) -> list[dict]:
    colors = conf.get("colors") or {}
    pal = colors.get("palette")
    if not pal:
        return _default_palette()

    out: list[dict] = []
    for item in pal:
        try:
            cid = int(item["id"])
            name = str(item.get("name") or f"c{cid}")
            rgb = item.get("rgb")
            if not isinstance(rgb, (list, tuple)) or len(rgb) != 3:
                continue
            r = int(rgb[0])
            g = int(rgb[1])
            b = int(rgb[2])
            out.append({"id": cid, "name": name, "hex": _rgb_to_hex((r, g, b))})
        except Exception:
            continue

    if not out:
        return _default_palette()

    out.sort(key=lambda x: int(x["id"]))
    return out


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_text_search_sql(gallery: str, q: str | None) -> tuple[str, list]:
    if not q:
        return "", []
    q = q.strip()
    if not q:
        return "", []
    like = f"%{_escape_like(q)}%"
    sql = """
 AND (
   i.title LIKE %s ESCAPE '\\\\'
   OR i.alt LIKE %s ESCAPE '\\\\'
   OR EXISTS (
     SELECT 1
     FROM image_tags it
     JOIN tags t ON t.id=it.tag_id
     WHERE it.image_id=i.id AND t.gallery=%s AND t.name LIKE %s ESCAPE '\\\\'
   )
 )
"""
    return sql, [like, like, gallery, like]


def build_tag_filter_sql(gallery: str, tags_any: list[str], tags_all: list[str]) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    if tags_any:
        ph = ",".join(["%s"] * len(tags_any))
        clauses.append(
            f"""EXISTS (
                SELECT 1
                FROM image_tags it
                JOIN tags t ON t.id=it.tag_id
                WHERE it.image_id=i.id AND t.gallery=%s AND t.name IN ({ph})
            )"""
        )
        params.append(gallery)
        params.extend(tags_any)

    for tname in tags_all:
        clauses.append(
            """EXISTS (
                SELECT 1
                FROM image_tags it
                JOIN tags t ON t.id=it.tag_id
                WHERE it.image_id=i.id AND t.gallery=%s AND t.name=%s
            )"""
        )
        params.append(gallery)
        params.append(tname)

    if not clauses:
        return "", []

    return " AND " + " AND ".join(clauses), params


def build_color_filter_sql(colors_any: list[int], colors_all: list[int]) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    if colors_any:
        ph = ",".join(["%s"] * len(colors_any))
        clauses.append(
            f"""EXISTS (
                SELECT 1
                FROM image_colors ic
                WHERE ic.image_id=i.id AND ic.rank_no BETWEEN 1 AND 3 AND ic.color_id IN ({ph})
            )"""
        )
        params.extend(colors_any)

    for cid in colors_all:
        clauses.append(
            """EXISTS (
                SELECT 1
                FROM image_colors ic
                WHERE ic.image_id=i.id AND ic.rank_no BETWEEN 1 AND 3 AND ic.color_id=%s
            )"""
        )
        params.append(cid)

    if not clauses:
        return "", []

    return " AND " + " AND ".join(clauses), params


def build_date_filter_sql(date_from: str | None, date_to: str | None) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    if date_from:
        clauses.append("i.shot_at >= %s")
        params.append(f"{date_from} 00:00:00")

    if date_to:
        clauses.append("i.shot_at < DATE_ADD(%s, INTERVAL 1 DAY)")
        params.append(date_to)

    if not clauses:
        return "", []

    return " AND " + " AND ".join(clauses), params


def _table_cols(conn: pymysql.Connection, table: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM {table}")
        rows = cur.fetchall()
    return {str(r["Field"]).lower() for r in rows}


def _img_meta(path: Path) -> tuple[int, int, str]:
    with Image.open(path) as im:
        w, h = im.size
        fmt = (im.format or path.suffix.lstrip(".")).upper()
        return int(w), int(h), str(fmt)


def _id_dir3(image_id: int) -> str:
    s = f"{image_id:08d}"
    return f"{s[0:2]}/{s[2:4]}/{s[4:6]}"


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
    ensure_dir(dst.parent)
    img.save(dst, "WEBP", quality=82, method=6)


_VRCHAT_RE = re.compile(r"^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:\.\d+)?_")


def _parse_vrchat_shot_at(name: str) -> datetime | None:
    m = _VRCHAT_RE.match(name)
    if not m:
        return None
    y, mo, d, hh, mm, ss = map(int, m.groups())
    return datetime(y, mo, d, hh, mm, ss)


def _now_local(conf: dict) -> datetime:
    tz = str((conf.get("app") or {}).get("timezone") or "Asia/Tokyo")
    try:
        dt = datetime.now(ZoneInfo(tz))
        return dt.replace(tzinfo=None)
    except Exception:
        return datetime.now()


def _make_vrchat_filename(dt: datetime, ext: str) -> str:
    token = uuid.uuid4().hex
    base = dt.strftime("%Y-%m-%d_%H-%M-%S")
    return f"VRChat_{base}.000_{token}.{ext}"


def _sha256_copy(upload: UploadFile, dst: Path) -> tuple[str, bytes, int]:
    h = hashlib.sha256()
    ensure_dir(dst.parent)
    total = 0
    with dst.open("wb") as w:
        while True:
            b = upload.file.read(1024 * 1024)
            if not b:
                break
            total += len(b)
            h.update(b)
            w.write(b)
    digest = h.digest()
    return h.hexdigest(), digest, total


def _hash_param_value(col_type: str | None, hex_str: str, digest: bytes) -> object:
    if not col_type:
        return hex_str
    t = col_type.lower()
    if "binary" in t or "varbinary" in t:
        return digest
    return hex_str


def _upsert_tag_id(conn: pymysql.Connection, gallery: str, name: str) -> int:
    name = name.strip()
    if not name:
        raise ValueError("empty tag")
    with conn.cursor() as cur:
        try:
            cur.execute("INSERT INTO tags (gallery, name) VALUES (%s,%s)", (gallery, name))
            cur.execute("SELECT LAST_INSERT_ID() AS id")
            return int(cur.fetchone()["id"])
        except IntegrityError:
            cur.execute("SELECT id FROM tags WHERE gallery=%s AND name=%s LIMIT 1", (gallery, name))
            r = cur.fetchone()
            if not r:
                raise
            return int(r["id"])


def _insert_image_tag(conn: pymysql.Connection, image_id: int, tag_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("INSERT IGNORE INTO image_tags (image_id, tag_id) VALUES (%s,%s)", (image_id, tag_id))


def _store_colors(conn: pymysql.Connection, image_id: int, colors: list[dict]) -> None:
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


def _delete_image_everywhere(conn: pymysql.Connection, image_id: int, gallery: str, storage_root: Path) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT thumb_path_480, thumb_path_960, preview_path FROM images WHERE id=%s AND gallery=%s LIMIT 1", (image_id, gallery))
        row = cur.fetchone() or {}

    for rel in (str(row.get("thumb_path_480") or ""), str(row.get("thumb_path_960") or ""), str(row.get("preview_path") or "")):
        if not rel:
            continue
        p = storage_root / rel
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass

    with conn.cursor() as cur:
        cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM image_tags WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM image_stats WHERE image_id=%s", (image_id,))
        cur.execute("DELETE FROM image_sources WHERE gallery=%s AND image_id=%s", (gallery, image_id))
        cur.execute("DELETE FROM images WHERE id=%s AND gallery=%s", (image_id, gallery))


app = FastAPI()

CONF_PATH = os.environ.get("GALLERY_CONFIG", "/etc/felixxsv-gallery/gallery.conf")
CONF = load_conf(CONF_PATH)
GALLERY = CONF["app"]["gallery"]

SOURCE_ROOT = Path(CONF["paths"]["source_root"])
CACHE_ROOT = Path(CONF["paths"]["original_cache_root"])
STORAGE_ROOT = Path((CONF.get("paths") or {}).get("storage_root") or "/data/felixxsv-gallery/www/storage")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/palette")
def palette():
    return {"items": _palette_from_conf(CONF)}


@app.get("/api/images")
def list_images(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1),
    sort: str = Query("latest"),
    q: str | None = None,
    tags_any: str | None = None,
    tags_all: str | None = None,
    colors_any: str | None = None,
    colors_all: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    per_page = clamp_per_page(per_page)
    offset = (page - 1) * per_page

    tags_any_list = parse_csv_strs(tags_any)
    tags_all_list = parse_csv_strs(tags_all)
    colors_any_list = parse_csv_ints(colors_any)
    colors_all_list = parse_csv_ints(colors_all)

    tag_sql, tag_params = build_tag_filter_sql(GALLERY, tags_any_list, tags_all_list)
    color_sql, color_params = build_color_filter_sql(colors_any_list, colors_all_list)
    date_sql, date_params = build_date_filter_sql(date_from, date_to)
    text_sql, text_params = build_text_search_sql(GALLERY, q)

    where_extra_sql = f"{tag_sql}{color_sql}{date_sql}{text_sql}"
    where_extra_params = [*tag_params, *color_params, *date_params, *text_params]

    sort_key = (sort or "latest").lower()
    join_stats = "LEFT JOIN image_stats st ON st.image_id=i.id"

    if sort_key == "popular":
        order_sql = "ORDER BY COALESCE(st.view_count,0) DESC, i.shot_at DESC"
    elif sort_key == "oldest":
        order_sql = "ORDER BY i.shot_at ASC"
    else:
        order_sql = "ORDER BY i.shot_at DESC"

    sql_count = f"""
SELECT COUNT(*)
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
{join_stats}
WHERE i.gallery=%s
{where_extra_sql}
"""

    sql_list = f"""
SELECT
  i.id, i.shot_at, i.title, i.alt, i.width, i.height, i.format,
  i.thumb_path_480, i.thumb_path_960, i.preview_path,
  COALESCE(st.view_count,0) AS view_count
FROM images i
JOIN image_sources s ON s.image_id=i.id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
{join_stats}
WHERE i.gallery=%s
{where_extra_sql}
{order_sql}
LIMIT %s OFFSET %s
"""

    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(sql_count, [GALLERY, GALLERY, *where_extra_params])
            total = int(cur.fetchone()["COUNT(*)"])

            cur.execute(sql_list, [GALLERY, GALLERY, *where_extra_params, per_page, offset])
            items = cur.fetchall()

        pages = (total + per_page - 1) // per_page
        return {"page": page, "per_page": per_page, "pages": pages, "total": total, "items": items}
    finally:
        conn.close()


@app.post("/api/images/{image_id}/view")
def inc_view(image_id: int):
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO image_stats (image_id, view_count) VALUES (%s, 1) "
                "ON DUPLICATE KEY UPDATE view_count=view_count+1",
                (image_id,),
            )
        return {"ok": True}
    finally:
        conn.close()


@app.get("/api/images/{image_id}")
def get_image(image_id: int):
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT
  i.id, i.shot_at, i.title, i.alt, i.width, i.height, i.format,
  i.thumb_path_480, i.thumb_path_960, i.preview_path,
  COALESCE(st.view_count,0) AS view_count,
  COALESCE(st.like_count,0) AS like_count,
  COALESCE(st.x_like_count,0) AS x_like_count
FROM images i
LEFT JOIN image_stats st ON st.image_id=i.id
WHERE i.gallery=%s AND i.id=%s
""",
                (GALLERY, image_id),
            )
            img = cur.fetchone()
            if not img:
                raise HTTPException(status_code=404, detail="not found")

            cur.execute(
                """
SELECT t.name
FROM image_tags it
JOIN tags t ON t.id=it.tag_id
WHERE it.image_id=%s AND t.gallery=%s
ORDER BY t.name ASC
""",
                (image_id, GALLERY),
            )
            img["tags"] = [r["name"] for r in cur.fetchall()]

            cur.execute(
                """
SELECT rank_no, color_id, ratio
FROM image_colors
WHERE image_id=%s
ORDER BY rank_no ASC
""",
                (image_id,),
            )
            img["colors"] = cur.fetchall()

        return img
    finally:
        conn.close()


@app.get("/api/tags")
def list_tags(limit: int = Query(200, ge=1, le=2000)):
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT t.name, COUNT(*) AS c
FROM tags t
JOIN image_tags it ON it.tag_id=t.id
JOIN image_sources s ON s.image_id=it.image_id AND s.gallery=%s AND s.is_primary=1 AND s.is_hidden=0
WHERE t.gallery=%s
GROUP BY t.name
ORDER BY c DESC, t.name ASC
LIMIT %s
""",
                (GALLERY, GALLERY, limit),
            )
            rows = cur.fetchall()
        return {"items": rows}
    finally:
        conn.close()


@app.post("/api/upload")
def upload_images(
    title: str = Form(...),
    alt: str = Form(""),
    tags: str = Form(""),
    is_public: str = Form("true"),
    files: list[UploadFile] = File(...),
):
    t = str(title or "").strip()
    if not t:
        raise HTTPException(status_code=400, detail="title required")
    if not files:
        raise HTTPException(status_code=400, detail="files required")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="too many files (max 20)")

    tz_name = str((CONF.get("app") or {}).get("timezone") or "Asia/Tokyo")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = None

    def now_local_naive() -> datetime:
        if tz is None:
            return datetime.now()
        return datetime.now(tz).replace(tzinfo=None)

    vr_re = re.compile(r"^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})")
    def parse_shot_at(name: str) -> datetime:
        base = (name or "").split("/")[-1].split("\\")[-1]
        m = vr_re.match(base)
        if not m:
            return now_local_naive()
        y, mo, d, hh, mm, ss = map(int, m.groups())
        try:
            return datetime(y, mo, d, hh, mm, ss)
        except Exception:
            return now_local_naive()

    is_pub = str(is_public or "true").strip().lower() in ("1", "true", "yes", "on")
    tag_list = [x for x in parse_csv_strs(tags) if x]

    storage_root = Path((CONF.get("paths") or {}).get("storage_root") or "/data/felixxsv-gallery/www/storage")

    conn = db_conn(CONF)
    try:
        src_cols = set()
        with conn.cursor() as cur:
            cur.execute("SHOW COLUMNS FROM image_sources")
            src_cols = {str(r["Field"]) for r in cur.fetchall()}

        staged = []
        tmp_dir = Path(tempfile.mkdtemp(prefix="felixxsv_gallery_upload_"))
        try:
            for idx, uf in enumerate(files):
                name = uf.filename or f"file{idx}"
                shot_at = parse_shot_at(name)

                ext = Path(name).suffix.lower().lstrip(".")
                if ext not in ("png", "jpg", "jpeg", "webp"):
                    ext = "png"

                tmp_path = tmp_dir / f"{idx:03d}_{uuid.uuid4().hex}.{ext}"

                h = hashlib.sha256()
                size = 0
                try:
                    try:
                        uf.file.seek(0)
                    except Exception:
                        pass
                    with tmp_path.open("wb") as f:
                        while True:
                            b = uf.file.read(1024 * 1024)
                            if not b:
                                break
                            f.write(b)
                            h.update(b)
                            size += len(b)
                except Exception as e:
                    raise HTTPException(status_code=500, detail=f"save failed: {type(e).__name__}: {e}")

                sha_hex = h.hexdigest()

                try:
                    with Image.open(tmp_path) as im:
                        w, h2 = im.size
                        fmt = (im.format or ext).upper()
                except (UnidentifiedImageError, OSError):
                    raise HTTPException(status_code=400, detail=f"invalid image: {name}")

                staged.append({
                    "index": idx,
                    "filename": name,
                    "shot_at": shot_at,
                    "ext": ext,
                    "tmp_path": tmp_path,
                    "sha_hex": sha_hex,
                    "size_bytes": int(size),
                    "width": int(w),
                    "height": int(h2),
                    "format": str(fmt),
                })

            hashes = [x["sha_hex"] for x in staged]
            uniq_hashes = sorted(set(hashes))

            existing_map = {}
            if uniq_hashes:
                ph = ",".join(["%s"] * len(uniq_hashes))
                with conn.cursor() as cur:
                    cur.execute(
                        f"SELECT id, content_hash FROM images WHERE gallery=%s AND content_hash IN ({ph})",
                        [GALLERY, *uniq_hashes],
                    )
                    for r in cur.fetchall():
                        existing_map[str(r["content_hash"])] = int(r["id"])

            seen = set()
            items = []
            any_dup = False
            for x in staged:
                sha = x["sha_hex"]
                dup = False
                exid = existing_map.get(sha)
                if exid is not None:
                    dup = True
                if sha in seen:
                    dup = True
                seen.add(sha)
                if dup:
                    any_dup = True
                items.append({
                    "index": int(x["index"]),
                    "filename": x["filename"],
                    "duplicate": bool(dup),
                    "existing_id": exid,
                })

            if any_dup:
                return {"ok": True, "has_duplicates": True, "count": 0, "items": items}

            conn.autocommit(False)

            created_items = []
            created_orig_paths = []
            created_deriv_paths = []

            def id_dir3(image_id: int) -> str:
                s = f"{image_id:08d}"
                return f"{s[0:2]}/{s[2:4]}/{s[4:6]}"

            def render_webp(src: Path, dst: Path, max_w: int):
                img = Image.open(src)
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGBA")
                w0, h0 = img.size
                if w0 > max_w:
                    scale = max_w / float(w0)
                    nw = max_w
                    nh = int(h0 * scale)
                    if nh < 1:
                        nh = 1
                    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
                ensure_dir(dst.parent)
                img.save(dst, "WEBP", quality=82, method=6)

            try:
                from galleryctl.colors import extract_top_colors, load_palette_from_conf, load_settings_from_conf
                palette = load_palette_from_conf(CONF)
                cset = load_settings_from_conf(CONF)
            except Exception:
                extract_top_colors = None
                palette = None
                cset = None

            try:
                for x in staged:
                    shot_at = x["shot_at"]
                    rel_dir = Path("uploads") / shot_at.strftime("%Y/%m/%d")
                    fname = f"VRChat_{shot_at.strftime('%Y-%m-%d_%H-%M-%S')}_{uuid.uuid4().hex[:8]}.{x['ext']}"
                    rel_path = str((rel_dir / fname).as_posix())
                    abs_path = SOURCE_ROOT / rel_path

                    ensure_dir(abs_path.parent)
                    tmp_path = x["tmp_path"]
                    tmp_path.replace(abs_path)
                    created_orig_paths.append(abs_path)

                    st = abs_path.stat()
                    mtime_epoch = int(st.st_mtime)

                    with conn.cursor() as cur:
                        cur.execute(
                            """
INSERT INTO images
(gallery, shot_at, title, alt, width, height, format, thumb_path_480, thumb_path_960, preview_path, content_hash)
VALUES
(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
""",
                            (GALLERY, shot_at, t, str(alt or ""), x["width"], x["height"], x["format"], "", "", "", x["sha_hex"]),
                        )
                        cur.execute("SELECT LAST_INSERT_ID() AS id")
                        image_id = int(cur.fetchone()["id"])

                    dir3 = id_dir3(image_id)
                    t480_rel = f"thumbs/{GALLERY}/{dir3}/{image_id}_w480.webp"
                    t960_rel = f"thumbs/{GALLERY}/{dir3}/{image_id}_w960.webp"
                    prev_rel = f"previews/{GALLERY}/{dir3}/{image_id}_max2560.webp"

                    render_webp(abs_path, storage_root / t480_rel, 480)
                    render_webp(abs_path, storage_root / t960_rel, 960)
                    render_webp(abs_path, storage_root / prev_rel, 2560)

                    created_deriv_paths.extend([storage_root / t480_rel, storage_root / t960_rel, storage_root / prev_rel])

                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE images SET thumb_path_480=%s, thumb_path_960=%s, preview_path=%s WHERE id=%s AND gallery=%s",
                            (t480_rel, t960_rel, prev_rel, image_id, GALLERY),
                        )

                    cols = ["gallery", "image_id", "source_path", "size_bytes", "mtime_epoch", "content_hash", "is_primary", "is_hidden", "status"]
                    vals = [GALLERY, image_id, rel_path, int(x["size_bytes"]), int(mtime_epoch), x["sha_hex"], 1, 0 if is_pub else 1, 0]
                    if "sha256" in src_cols:
                        cols.append("sha256")
                        vals.append(x["sha_hex"])

                    with conn.cursor() as cur:
                        cur.execute(
                            f"INSERT INTO image_sources ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
                            vals,
                        )

                    if tag_list:
                        for name in tag_list:
                            with conn.cursor() as cur:
                                cur.execute(
                                    "INSERT INTO tags (gallery, name) VALUES (%s,%s) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
                                    (GALLERY, name),
                                )
                                cur.execute("SELECT LAST_INSERT_ID() AS id")
                                tag_id = int(cur.fetchone()["id"])
                                cur.execute("INSERT IGNORE INTO image_tags (image_id, tag_id) VALUES (%s,%s)", (image_id, tag_id))

                    if extract_top_colors is not None:
                        try:
                            colors = extract_top_colors(abs_path, palette, cset)
                        except Exception:
                            colors = []
                        with conn.cursor() as cur:
                            cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))
                            if colors:
                                vals2 = [(image_id, int(c["rank_no"]), int(c["color_id"]), float(c["ratio"])) for c in colors]
                                cur.executemany(
                                    "INSERT INTO image_colors (image_id, rank_no, color_id, ratio) VALUES (%s,%s,%s,%s)",
                                    vals2,
                                )

                    created_items.append({"image_id": image_id, "duplicate": False})

                conn.commit()
                conn.autocommit(True)
                return {"ok": True, "has_duplicates": False, "count": len(created_items), "items": created_items}

            except Exception as e:
                try:
                    conn.rollback()
                except Exception:
                    pass
                try:
                    conn.autocommit(True)
                except Exception:
                    pass

                for p in created_deriv_paths:
                    try:
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass
                for p in created_orig_paths:
                    try:
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass

                raise HTTPException(status_code=500, detail=f"upload failed: {type(e).__name__}: {e}")

        finally:
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass

    finally:
        conn.close()


@app.get("/media/original/{image_id}")
def get_original(image_id: int):
    conn = db_conn(CONF)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT s.source_path
FROM image_sources s
WHERE s.gallery=%s AND s.image_id=%s AND s.is_primary=1
LIMIT 1
""",
                (GALLERY, image_id),
            )
            r = cur.fetchone()
            if not r:
                raise HTTPException(status_code=404, detail="not found")
            rel = str(r["source_path"])
    finally:
        conn.close()

    src = SOURCE_ROOT / rel
    if not src.exists():
        raise HTTPException(status_code=404, detail="source missing")

    ext = src.suffix.lstrip(".").lower() or "bin"
    dst = cache_path(CACHE_ROOT, image_id, ext)
    ensure_dir(dst.parent)

    if not dst.exists():
        shutil.copy2(src, dst)

    return FileResponse(str(dst))