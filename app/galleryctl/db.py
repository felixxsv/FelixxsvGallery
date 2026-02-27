from dataclasses import dataclass
import pymysql


@dataclass(frozen=True)
class SourceRow:
    id: int
    image_id: int
    source_path: str
    size_bytes: int
    mtime_epoch: int
    content_hash: str
    is_primary: int
    is_hidden: int
    status: int


class Db:
    def __init__(self, conn: pymysql.Connection):
        self.conn = conn

    @staticmethod
    def connect(host: str, port: int, user: str, password: str, database: str) -> "Db":
        conn = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            charset="utf8mb4",
            autocommit=False,
            cursorclass=pymysql.cursors.DictCursor,
        )
        return Db(conn)

    def close(self) -> None:
        self.conn.close()

    def commit(self) -> None:
        self.conn.commit()

    def rollback(self) -> None:
        self.conn.rollback()

    def fetch_sources(self, gallery: str) -> list[SourceRow]:
        sql = """
SELECT id, image_id, source_path, size_bytes, mtime_epoch, content_hash, is_primary, is_hidden, status
FROM image_sources
WHERE gallery=%s
"""
        with self.conn.cursor() as cur:
            cur.execute(sql, (gallery,))
            rows = cur.fetchall()
        return [
            SourceRow(
                id=int(r["id"]),
                image_id=int(r["image_id"]),
                source_path=str(r["source_path"]),
                size_bytes=int(r["size_bytes"]),
                mtime_epoch=int(r["mtime_epoch"]),
                content_hash=str(r["content_hash"]),
                is_primary=int(r["is_primary"]),
                is_hidden=int(r["is_hidden"]),
                status=int(r["status"]),
            )
            for r in rows
        ]

    def find_image_by_hash(self, gallery: str, content_hash: str) -> dict | None:
        sql = """
SELECT id, content_hash, shot_at, width, height, format, thumb_path_480, thumb_path_960, preview_path
FROM images
WHERE gallery=%s AND content_hash=%s
"""
        with self.conn.cursor() as cur:
            cur.execute(sql, (gallery, content_hash))
            return cur.fetchone()

    def insert_image(
        self,
        gallery: str,
        content_hash: str,
        shot_at,
        title,
        alt,
        width: int,
        height: int,
        fmt: str,
    ) -> int:
        sql = """
INSERT INTO images (gallery, content_hash, shot_at, title, alt, width, height, format, thumb_path_480, thumb_path_960, preview_path)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL,NULL,NULL)
"""
        with self.conn.cursor() as cur:
            cur.execute(sql, (gallery, content_hash, shot_at, title, alt, width, height, fmt))
            return int(cur.lastrowid)

    def update_image_paths(self, image_id: int, thumb480: str, thumb960: str, preview: str) -> None:
        sql = "UPDATE images SET thumb_path_480=%s, thumb_path_960=%s, preview_path=%s WHERE id=%s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (thumb480, thumb960, preview, image_id))

    def delete_image_colors(self, image_id: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM image_colors WHERE image_id=%s", (image_id,))

    def insert_image_color(self, image_id: int, rank_no: int, color_id: int, ratio: float) -> None:
        sql = "INSERT INTO image_colors (image_id, rank_no, color_id, ratio) VALUES (%s,%s,%s,%s)"
        with self.conn.cursor() as cur:
            cur.execute(sql, (image_id, rank_no, color_id, ratio))

    def insert_source(
        self,
        image_id: int,
        gallery: str,
        source_path: str,
        size_bytes: int,
        mtime_epoch: int,
        content_hash: str,
        status: int,
    ) -> None:
        sql = """
INSERT INTO image_sources (image_id, gallery, source_path, size_bytes, mtime_epoch, content_hash, is_primary, is_hidden, status)
VALUES (%s,%s,%s,%s,%s,%s,0,1,%s)
"""
        with self.conn.cursor() as cur:
            cur.execute(sql, (image_id, gallery, source_path, size_bytes, mtime_epoch, content_hash, status))

    def update_source_meta(self, source_id: int, size_bytes: int, mtime_epoch: int) -> None:
        sql = "UPDATE image_sources SET size_bytes=%s, mtime_epoch=%s WHERE id=%s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (size_bytes, mtime_epoch, source_id))

    def relink_source(self, source_id: int, new_image_id: int, size_bytes: int, mtime_epoch: int, content_hash: str) -> None:
        sql = "UPDATE image_sources SET image_id=%s, size_bytes=%s, mtime_epoch=%s, content_hash=%s WHERE id=%s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (new_image_id, size_bytes, mtime_epoch, content_hash, source_id))

    def delete_source(self, source_id: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM image_sources WHERE id=%s", (source_id,))

    def list_sources_by_image(self, image_id: int) -> list[dict]:
        sql = "SELECT id, source_path FROM image_sources WHERE image_id=%s ORDER BY source_path ASC"
        with self.conn.cursor() as cur:
            cur.execute(sql, (image_id,))
            return list(cur.fetchall())

    def set_source_flags(self, source_id: int, is_primary: int, is_hidden: int) -> None:
        sql = "UPDATE image_sources SET is_primary=%s, is_hidden=%s WHERE id=%s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (is_primary, is_hidden, source_id))

    def count_sources(self, image_id: int) -> int:
        sql = "SELECT COUNT(*) AS c FROM image_sources WHERE image_id=%s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (image_id,))
            r = cur.fetchone()
        return int(r["c"])

    def get_image_paths(self, image_id: int) -> dict:
        sql = "SELECT thumb_path_480, thumb_path_960, preview_path FROM images WHERE id=%s"
        with self.conn.cursor() as cur:
            cur.execute(sql, (image_id,))
            r = cur.fetchone()
        return dict(r) if r else {"thumb_path_480": None, "thumb_path_960": None, "preview_path": None}

    def delete_image(self, image_id: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM images WHERE id=%s", (image_id,))
