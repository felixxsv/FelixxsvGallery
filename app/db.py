from __future__ import annotations

from pathlib import Path
import pymysql
import tomllib


def load_conf(path: str) -> dict:
    return tomllib.loads(Path(path).read_text(encoding="utf-8"))


def db_conn(conf: dict, autocommit: bool = True) -> pymysql.Connection:
    db = conf["db"]
    conn = pymysql.connect(
        host=db["host"],
        port=int(db["port"]),
        user=db["user"],
        password=db["password"],
        database=db["database"],
        charset="utf8mb4",
        autocommit=autocommit,
        cursorclass=pymysql.cursors.DictCursor,
    )
    with conn.cursor() as cursor:
        cursor.execute("SET time_zone = '+00:00'")
    return conn
