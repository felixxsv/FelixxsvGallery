from dataclasses import dataclass
from pathlib import Path
import tomllib


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: int
    database: str
    user: str
    password: str


@dataclass(frozen=True)
class PathsConfig:
    source_root: Path
    thumb_root: Path
    preview_root: Path
    original_cache_root: Path
    quarantine_root: Path


@dataclass(frozen=True)
class ThumbConfig:
    sizes: list[int]
    format: str


@dataclass(frozen=True)
class PreviewConfig:
    max_edge: int
    format: str


@dataclass(frozen=True)
class SyncConfig:
    extensions: list[str]
    workers: int


@dataclass(frozen=True)
class CacheConfig:
    max_bytes: int


@dataclass(frozen=True)
class ColorsConfig:
    max_colors: int
    min_ratio: float
    residual_threshold: float
    palette: list[str]


@dataclass(frozen=True)
class AppConfig:
    gallery: str
    timezone: str
    db: DbConfig
    paths: PathsConfig
    thumb: ThumbConfig
    preview: PreviewConfig
    sync: SyncConfig
    cache: CacheConfig
    colors: ColorsConfig


def load_config(path: str) -> AppConfig:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))

    return AppConfig(
        gallery=str(raw["app"]["gallery"]),
        timezone=str(raw["app"]["timezone"]),
        db=DbConfig(
            host=str(raw["db"]["host"]),
            port=int(raw["db"]["port"]),
            database=str(raw["db"]["database"]),
            user=str(raw["db"]["user"]),
            password=str(raw["db"]["password"]),
        ),
        paths=PathsConfig(
            source_root=Path(raw["paths"]["source_root"]),
            thumb_root=Path(raw["paths"]["thumb_root"]),
            preview_root=Path(raw["paths"]["preview_root"]),
            original_cache_root=Path(raw["paths"]["original_cache_root"]),
            quarantine_root=Path(raw["paths"]["quarantine_root"]),
        ),
        thumb=ThumbConfig(
            sizes=list(map(int, raw["thumb"]["sizes"])),
            format=str(raw["thumb"]["format"]),
        ),
        preview=PreviewConfig(
            max_edge=int(raw["preview"]["max_edge"]),
            format=str(raw["preview"]["format"]),
        ),
        sync=SyncConfig(
            extensions=[str(x).lower() for x in raw["sync"]["extensions"]],
            workers=int(raw["sync"]["workers"]),
        ),
        cache=CacheConfig(
            max_bytes=int(raw["cache"]["max_bytes"]),
        ),
        colors=ColorsConfig(
            max_colors=int(raw["colors"]["max_colors"]),
            min_ratio=float(raw["colors"]["min_ratio"]),
            residual_threshold=float(raw["colors"]["residual_threshold"]),
            palette=list(map(str, raw["colors"]["palette"])),
        ),
    )
