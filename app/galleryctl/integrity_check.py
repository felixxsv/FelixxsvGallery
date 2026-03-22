from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta, timezone
from pathlib import Path
import json
import os
import time
from typing import Any
import uuid

import pymysql
import tomllib
from PIL import Image, UnidentifiedImageError


JST = timezone(timedelta(hours=9))
VALID_WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
STATUS_EXIT_CODE = {
    "ok": 0,
    "warning": 1,
    "error": 2,
    "failed": 3,
}


@dataclass(frozen=True)
class Paths:
    source_root: Path
    storage_root: Path
    runtime_root: Path
    report_root: Path


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
    paths: Paths
    raw: dict[str, Any]


class IntegrityFailure(RuntimeError):
    pass


INTEGRITY_DEFAULTS = {
    "enabled": True,
    "schedule_type": "daily",
    "run_at_hhmm": "05:00",
    "interval_days": 1,
    "weekly_days": ["mon"],
    "report_retention_days": 30,
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _dbdt_to_utc(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return None


def _coerce_json(value, fallback=None):
    if value is None:
        return fallback
    if isinstance(value, (dict, list, bool, int, float)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="ignore")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return fallback if fallback is not None else value
    return fallback if fallback is not None else value


def _coerce_bool(value, default=False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return bool(default)


def _coerce_int(value, default=0, min_value=None, max_value=None) -> int:
    try:
        num = int(value)
    except Exception:
        num = int(default)
    if min_value is not None and num < min_value:
        num = min_value
    if max_value is not None and num > max_value:
        num = max_value
    return num


def _coerce_text(value, default="", max_length=None) -> str:
    text = str(value if value is not None else default).strip()
    if max_length is not None:
        text = text[:max_length]
    return text


def _normalize_weekdays(value) -> list[str]:
    if isinstance(value, str):
        items = [part.strip().lower() for part in value.split(",")]
    elif isinstance(value, (list, tuple, set)):
        items = [str(part).strip().lower() for part in value]
    else:
        items = []
    out: list[str] = []
    seen = set()
    for item in items:
        if item in VALID_WEEKDAYS and item not in seen:
            seen.add(item)
            out.append(item)
    if not out:
        out = ["mon"]
    return out


def _normalize_integrity_settings(data: dict | None) -> dict:
    raw = data or {}
    schedule_type = _coerce_text(raw.get("schedule_type"), INTEGRITY_DEFAULTS["schedule_type"], 32).lower()
    if schedule_type not in {"daily", "every_n_days", "weekly"}:
        schedule_type = INTEGRITY_DEFAULTS["schedule_type"]
    hhmm = _coerce_text(raw.get("run_at_hhmm"), INTEGRITY_DEFAULTS["run_at_hhmm"], 5)
    if not hhmm or len(hhmm) != 5 or hhmm[2] != ":":
        hhmm = INTEGRITY_DEFAULTS["run_at_hhmm"]
    else:
        try:
            hour = int(hhmm[:2])
            minute = int(hhmm[3:])
            if hour < 0 or hour > 23 or minute < 0 or minute > 59:
                raise ValueError("invalid")
        except Exception:
            hhmm = INTEGRITY_DEFAULTS["run_at_hhmm"]
    return {
        "enabled": _coerce_bool(raw.get("enabled"), INTEGRITY_DEFAULTS["enabled"]),
        "schedule_type": schedule_type,
        "run_at_hhmm": hhmm,
        "interval_days": _coerce_int(raw.get("interval_days"), INTEGRITY_DEFAULTS["interval_days"], 1, 365),
        "weekly_days": _normalize_weekdays(raw.get("weekly_days")),
        "report_retention_days": _coerce_int(raw.get("report_retention_days"), INTEGRITY_DEFAULTS["report_retention_days"], 1, 3650),
    }


def _load_cfg(path: str) -> Cfg:
    raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    app = raw.get("app") or {}
    db = raw.get("db") or {}
    paths = raw.get("paths") or {}

    gallery = str(app.get("gallery") or "vrchat")
    source_root = Path(str(paths.get("source_root") or "/data/felixxsv-gallery/source"))
    storage_root = Path(str(paths.get("storage_root") or "/data/felixxsv-gallery/www/storage"))
    runtime_root = Path(str(paths.get("runtime_root") or "/data/felixxsv-gallery/runtime"))
    report_root = runtime_root / "reports" / "integrity"

    dbc = DbCfg(
        host=str(db.get("host") or "127.0.0.1"),
        port=int(db.get("port") or 3306),
        user=str(db.get("user") or "gallery"),
        password=str(db.get("password") or ""),
        database=str(db.get("database") or "felixxsv_gallery"),
    )
    return Cfg(
        gallery=gallery,
        db=dbc,
        paths=Paths(
            source_root=source_root,
            storage_root=storage_root,
            runtime_root=runtime_root,
            report_root=report_root,
        ),
        raw=raw,
    )


def _db_connect(cfg: Cfg, autocommit: bool = True) -> pymysql.Connection:
    return pymysql.connect(
        host=cfg.db.host,
        port=cfg.db.port,
        user=cfg.db.user,
        password=cfg.db.password,
        database=cfg.db.database,
        charset="utf8mb4",
        autocommit=autocommit,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _ensure_admin_site_settings_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS admin_site_settings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    setting_group VARCHAR(50) NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    value_json JSON NOT NULL,
    updated_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_site_settings_group_key (setting_group, setting_key),
    KEY idx_admin_site_settings_group (setting_group),
    KEY idx_admin_site_settings_updated_by (updated_by_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )


def _ensure_integrity_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS integrity_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_uuid CHAR(36) NOT NULL,
    trigger_source ENUM('schedule', 'manual') NOT NULL DEFAULT 'schedule',
    status ENUM('queued', 'running', 'ok', 'warning', 'error', 'failed') NOT NULL DEFAULT 'queued',
    requested_by_user_id BIGINT UNSIGNED NULL,
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    scheduled_for DATETIME(6) NULL,
    started_at DATETIME(6) NULL,
    finished_at DATETIME(6) NULL,
    exit_code TINYINT UNSIGNED NULL,
    summary_json JSON NULL,
    report_path VARCHAR(2048) NULL,
    message TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_integrity_runs_uuid (run_uuid),
    KEY idx_integrity_runs_status (status),
    KEY idx_integrity_runs_trigger_source (trigger_source),
    KEY idx_integrity_runs_scheduled_for (scheduled_for),
    KEY idx_integrity_runs_requested_at (requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )
        cur.execute(
            """
CREATE TABLE IF NOT EXISTS integrity_issues (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    run_id BIGINT UNSIGNED NOT NULL,
    severity ENUM('warning', 'error') NOT NULL,
    issue_code VARCHAR(64) NOT NULL,
    gallery VARCHAR(64) NULL,
    image_id BIGINT UNSIGNED NULL,
    source_id BIGINT UNSIGNED NULL,
    file_path VARCHAR(2048) NULL,
    derivative_kind VARCHAR(32) NULL,
    detail_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_integrity_issues_run_id (run_id),
    KEY idx_integrity_issues_issue_code (issue_code),
    KEY idx_integrity_issues_image_id (image_id),
    CONSTRAINT fk_integrity_issues_run_id
      FOREIGN KEY (run_id) REFERENCES integrity_runs(id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""
        )


def _load_integrity_settings(conn) -> dict:
    _ensure_admin_site_settings_tables(conn)
    data = dict(INTEGRITY_DEFAULTS)
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT setting_key, value_json
FROM admin_site_settings
WHERE setting_group='integrity'
ORDER BY setting_key ASC
"""
        )
        rows = cur.fetchall()
    for row in rows:
        key = str(row.get("setting_key") or "")
        if not key:
            continue
        data[key] = _coerce_json(row.get("value_json"), data.get(key))
    return _normalize_integrity_settings(data)


def _save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_hhmm(value: str) -> dt_time:
    hour = int(value[:2])
    minute = int(value[3:5])
    return dt_time(hour=hour, minute=minute)


def _slot_for_date(date_value, hhmm: str) -> datetime:
    t = _parse_hhmm(hhmm)
    return datetime(date_value.year, date_value.month, date_value.day, t.hour, t.minute, tzinfo=JST)


def _find_pending_run(conn) -> dict | None:
    _ensure_integrity_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT *
FROM integrity_runs
WHERE status IN ('queued', 'running')
ORDER BY requested_at ASC, id ASC
LIMIT 1
"""
        )
        return cur.fetchone()


def _create_run(conn, trigger_source: str, requested_by_user_id: int | None = None, scheduled_for: datetime | None = None) -> dict:
    _ensure_integrity_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO integrity_runs (
    run_uuid,
    trigger_source,
    status,
    requested_by_user_id,
    requested_at,
    scheduled_for
)
VALUES (%s, %s, 'queued', %s, %s, %s)
""",
            (
                str(uuid.uuid4()),
                trigger_source,
                requested_by_user_id,
                _utc_naive(_utc_now()),
                _utc_naive(scheduled_for) if scheduled_for is not None else None,
            ),
        )
        run_id = int(cur.lastrowid)
        cur.execute("SELECT * FROM integrity_runs WHERE id=%s LIMIT 1", (run_id,))
        return cur.fetchone() or {"id": run_id}


def _latest_schedule_slot(conn) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT scheduled_for
FROM integrity_runs
WHERE trigger_source='schedule' AND scheduled_for IS NOT NULL
ORDER BY scheduled_for DESC, id DESC
LIMIT 1
"""
        )
        row = cur.fetchone() or {}
    return _dbdt_to_utc(row.get("scheduled_for"))


def _scheduled_slot_exists(conn, scheduled_for: datetime) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT id
FROM integrity_runs
WHERE trigger_source='schedule' AND scheduled_for=%s
LIMIT 1
""",
            (_utc_naive(scheduled_for),),
        )
        return cur.fetchone() is not None


def _queue_due_schedule_runs(conn, settings: dict) -> int:
    if not settings.get("enabled"):
        return 0
    now_utc = _utc_now()
    now_jst = now_utc.astimezone(JST)
    last_slot_utc = _latest_schedule_slot(conn)
    last_slot_jst = last_slot_utc.astimezone(JST) if last_slot_utc is not None else None
    schedule_type = settings.get("schedule_type") or "daily"
    slots: list[datetime] = []

    if schedule_type == "daily":
        if last_slot_jst is None:
            candidate = _slot_for_date(now_jst.date(), settings["run_at_hhmm"])
            if candidate <= now_jst:
                slots.append(candidate)
        else:
            candidate = last_slot_jst + timedelta(days=1)
            while candidate <= now_jst:
                slots.append(candidate)
                candidate += timedelta(days=1)

    elif schedule_type == "every_n_days":
        interval = int(settings.get("interval_days") or 1)
        if last_slot_jst is None:
            candidate = _slot_for_date(now_jst.date(), settings["run_at_hhmm"])
            if candidate <= now_jst:
                slots.append(candidate)
        else:
            candidate = last_slot_jst + timedelta(days=interval)
            while candidate <= now_jst:
                slots.append(candidate)
                candidate += timedelta(days=interval)

    else:
        weekly_days = set(_normalize_weekdays(settings.get("weekly_days")))
        if last_slot_jst is None:
            start_date = now_jst.date()
        else:
            start_date = last_slot_jst.date() + timedelta(days=1)
        current = start_date
        while current <= now_jst.date():
            candidate = _slot_for_date(current, settings["run_at_hhmm"])
            weekday_key = VALID_WEEKDAYS[candidate.weekday()]
            if weekday_key in weekly_days and candidate <= now_jst:
                slots.append(candidate)
            current += timedelta(days=1)

    created = 0
    for slot_jst in slots:
        slot_utc = slot_jst.astimezone(timezone.utc)
        if _scheduled_slot_exists(conn, slot_utc):
            continue
        _create_run(conn, trigger_source="schedule", requested_by_user_id=None, scheduled_for=slot_utc)
        created += 1
    return created


def _acquire_dispatch_lock(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT GET_LOCK(%s, 0) AS acquired", ("felixxsv_gallery_integrity_dispatch",))
        row = cur.fetchone() or {}
    return bool(row.get("acquired"))


def _release_dispatch_lock(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT RELEASE_LOCK(%s)", ("felixxsv_gallery_integrity_dispatch",))


def _cleanup_old_artifacts(conn, cfg: Cfg, retention_days: int) -> None:
    cutoff = _utc_naive(_utc_now() - timedelta(days=int(retention_days or 30)))
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT id, report_path
FROM integrity_runs
WHERE finished_at IS NOT NULL AND finished_at < %s
ORDER BY finished_at ASC
""",
            (cutoff,),
        )
        rows = cur.fetchall()
    for row in rows:
        report_path = str(row.get("report_path") or "").strip()
        if report_path:
            try:
                Path(report_path).unlink(missing_ok=True)
            except Exception:
                pass
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM integrity_runs WHERE finished_at IS NOT NULL AND finished_at < %s",
            (cutoff,),
        )


def _path_under_root(root: Path, rel_path: str) -> Path | None:
    raw = str(rel_path or "").strip().replace("\\", "/")
    if not raw:
        return None
    normalized = raw.lstrip("/")
    parts = [part for part in normalized.split("/") if part not in {"", "."}]
    if any(part == ".." for part in parts):
        return None
    return root.joinpath(*parts)


def _derivative_path_to_fs(storage_root: Path, value: str | None) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw.replace("\\", "/")
    prefixes = [
        "/gallery/storage/",
        "/storage/",
        "storage/",
        "/gallery/",
        "/",
    ]
    for prefix in prefixes:
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix):]
            break
    normalized = normalized.lstrip("/")
    if normalized.startswith("thumbs/") or normalized.startswith("previews/"):
        return _path_under_root(storage_root, normalized)
    return _path_under_root(storage_root, normalized)


def _to_rel_path(root: Path, path: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def _expected_derivatives(gallery: str, image_id: int) -> dict[str, str]:
    s = f"{image_id:08d}"
    dir3 = f"{s[0:2]}/{s[2:4]}/{s[4:6]}"
    return {
        "thumb_path_480": f"thumbs/{gallery}/{dir3}/{image_id}_w480.webp",
        "thumb_path_960": f"thumbs/{gallery}/{dir3}/{image_id}_w960.webp",
        "preview_path": f"previews/{gallery}/{dir3}/{image_id}_max2560.webp",
    }


def _serialize_dt(value) -> str | None:
    dt = _dbdt_to_utc(value)
    return dt.isoformat() if dt is not None else None


def _scan_integrity(cfg: Cfg) -> tuple[dict, list[dict]]:
    started_at = _utc_now()
    issues: list[dict] = []
    counts = {
        "images": 0,
        "source_rows": 0,
        "source_files": 0,
    }
    issue_counts: dict[str, int] = {}
    severity_counts = {"warning": 0, "error": 0}

    def add_issue(
        severity: str,
        issue_code: str,
        *,
        image_id: int | None = None,
        source_id: int | None = None,
        file_path: str | None = None,
        derivative_kind: str | None = None,
        detail: dict | None = None,
    ) -> None:
        issues.append(
            {
                "severity": severity,
                "issue_code": issue_code,
                "gallery": cfg.gallery,
                "image_id": image_id,
                "source_id": source_id,
                "file_path": file_path,
                "derivative_kind": derivative_kind,
                "detail": detail or {},
            }
        )
        severity_counts[severity] = severity_counts.get(severity, 0) + 1
        issue_counts[issue_code] = issue_counts.get(issue_code, 0) + 1

    if not cfg.paths.source_root.exists():
        add_issue("error", "missing_root", file_path=str(cfg.paths.source_root), detail={"root": "source_root"})
        source_files: set[str] = set()
    else:
        source_files = {
            _to_rel_path(cfg.paths.source_root, path)
            for path in cfg.paths.source_root.rglob("*")
            if path.is_file()
        }
    counts["source_files"] = len(source_files)

    if not cfg.paths.storage_root.exists():
        add_issue("error", "missing_root", file_path=str(cfg.paths.storage_root), detail={"root": "storage_root"})

    conn = _db_connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
SELECT
    i.id,
    i.gallery,
    i.shot_at,
    i.created_at,
    i.width,
    i.height,
    i.format,
    i.thumb_path_480,
    i.thumb_path_960,
    i.preview_path
FROM images i
WHERE i.gallery=%s
ORDER BY i.id ASC
""",
                (cfg.gallery,),
            )
            image_rows = cur.fetchall()
            cur.execute(
                """
SELECT
    s.id,
    s.image_id,
    s.source_path,
    s.is_primary,
    s.is_hidden
FROM image_sources s
WHERE s.gallery=%s
ORDER BY s.image_id ASC, s.is_primary DESC, s.id ASC
""",
                (cfg.gallery,),
            )
            source_rows = cur.fetchall()
            cur.execute(
                """
SELECT image_id, rank_no, color_id, ratio
FROM image_colors
WHERE image_id IN (SELECT id FROM images WHERE gallery=%s)
ORDER BY image_id ASC, rank_no ASC
""",
                (cfg.gallery,),
            )
            color_rows = cur.fetchall()
    finally:
        conn.close()

    counts["images"] = len(image_rows)
    counts["source_rows"] = len(source_rows)

    source_paths_visible: set[str] = set()
    primary_by_image: dict[int, dict] = {}
    sources_by_image: dict[int, list[dict]] = {}

    for row in source_rows:
        image_id = int(row.get("image_id"))
        rel = str(row.get("source_path") or "").strip().replace("\\", "/")
        is_hidden = bool(row.get("is_hidden"))
        if not is_hidden and rel:
            source_paths_visible.add(rel)
        sources_by_image.setdefault(image_id, []).append(row)
        if bool(row.get("is_primary")) and not is_hidden and image_id not in primary_by_image:
            primary_by_image[image_id] = row
        if not rel:
            add_issue(
                "error" if bool(row.get("is_primary")) and not is_hidden else "warning",
                "missing_source",
                image_id=image_id,
                source_id=int(row.get("id")),
                detail={"reason": "blank_source_path"},
            )
            continue
        if not is_hidden:
            source_fs = _path_under_root(cfg.paths.source_root, rel)
            if source_fs is None or not source_fs.exists():
                add_issue(
                    "error" if bool(row.get("is_primary")) else "warning",
                    "missing_source",
                    image_id=image_id,
                    source_id=int(row.get("id")),
                    file_path=rel,
                )

    for image in image_rows:
        image_id = int(image.get("id"))
        if image_id not in primary_by_image:
            add_issue(
                "error",
                "orphan_db",
                image_id=image_id,
                detail={"reason": "missing_primary_source"},
            )

    for rel in sorted(source_files):
        if rel not in source_paths_visible:
            add_issue("warning", "orphan_file", file_path=rel)

    colors_by_image: dict[int, list[dict]] = {}
    for row in color_rows:
        colors_by_image.setdefault(int(row.get("image_id")), []).append(row)

    for image in image_rows:
        image_id = int(image.get("id"))
        expected = _expected_derivatives(cfg.gallery, image_id)

        for field_name, expected_rel in expected.items():
            db_value = image.get(field_name)
            expected_fs = cfg.paths.storage_root / expected_rel
            actual_fs = _derivative_path_to_fs(cfg.paths.storage_root, db_value)
            if not db_value:
                if expected_fs.exists():
                    add_issue(
                        "warning",
                        "orphan_derivative",
                        image_id=image_id,
                        file_path=expected_rel,
                        derivative_kind=field_name,
                        detail={"reason": "db_path_missing_but_file_exists"},
                    )
                else:
                    add_issue(
                        "error",
                        "missing_derivative",
                        image_id=image_id,
                        file_path=expected_rel,
                        derivative_kind=field_name,
                        detail={"reason": "db_path_missing"},
                    )
                continue
            if actual_fs is None or not actual_fs.exists():
                add_issue(
                    "error",
                    "missing_derivative",
                    image_id=image_id,
                    file_path=str(db_value),
                    derivative_kind=field_name,
                )
            elif _to_rel_path(cfg.paths.storage_root, actual_fs) != expected_rel:
                add_issue(
                    "warning",
                    "unexpected_derivative_path",
                    image_id=image_id,
                    file_path=str(db_value),
                    derivative_kind=field_name,
                    detail={"expected": expected_rel, "actual": _to_rel_path(cfg.paths.storage_root, actual_fs)},
                )

        image_colors = colors_by_image.get(image_id, [])
        if not image_colors:
            add_issue("error", "missing_color", image_id=image_id)
        else:
            ranks = [int(row.get("rank_no") or 0) for row in image_colors]
            ratios = [float(row.get("ratio") or 0.0) for row in image_colors]
            if sorted(ranks) != list(range(1, len(ranks) + 1)):
                add_issue(
                    "error",
                    "invalid_color",
                    image_id=image_id,
                    detail={"reason": "non_sequential_ranks", "ranks": ranks},
                )
            if any(ratio <= 0 or ratio > 1 for ratio in ratios):
                add_issue(
                    "error",
                    "invalid_color",
                    image_id=image_id,
                    detail={"reason": "ratio_out_of_range", "ratios": ratios},
                )
            ratio_sum = sum(ratios)
            if ratio_sum > 1.05:
                add_issue(
                    "warning",
                    "invalid_color",
                    image_id=image_id,
                    detail={"reason": "ratio_sum_too_large", "ratio_sum": ratio_sum},
                )

        if not image.get("shot_at") or not image.get("created_at"):
            add_issue(
                "error",
                "meta_mismatch",
                image_id=image_id,
                detail={
                    "reason": "missing_datetime",
                    "shot_at": _serialize_dt(image.get("shot_at")),
                    "created_at": _serialize_dt(image.get("created_at")),
                },
            )

        primary = primary_by_image.get(image_id)
        if not primary:
            continue
        rel = str(primary.get("source_path") or "").strip().replace("\\", "/")
        source_fs = _path_under_root(cfg.paths.source_root, rel)
        if source_fs is None or not source_fs.exists():
            continue
        try:
            with Image.open(source_fs) as img:
                width, height = img.size
                fmt = (img.format or source_fs.suffix.lstrip(".") or "").upper()
        except (UnidentifiedImageError, OSError) as exc:
            add_issue(
                "error",
                "meta_mismatch",
                image_id=image_id,
                source_id=int(primary.get("id")),
                file_path=rel,
                detail={"reason": "image_open_failed", "error": f"{type(exc).__name__}: {exc}"},
            )
            continue

        db_width = int(image.get("width") or 0)
        db_height = int(image.get("height") or 0)
        db_format = str(image.get("format") or "").upper()
        mismatch = {}
        if db_width != int(width):
            mismatch["width"] = {"db": db_width, "file": int(width)}
        if db_height != int(height):
            mismatch["height"] = {"db": db_height, "file": int(height)}
        if db_format and fmt and db_format != fmt:
            mismatch["format"] = {"db": db_format, "file": fmt}
        if mismatch:
            add_issue(
                "warning",
                "meta_mismatch",
                image_id=image_id,
                source_id=int(primary.get("id")),
                file_path=rel,
                detail={"reason": "metadata_diff", "fields": mismatch},
            )

    ended_at = _utc_now()
    status = "ok"
    if severity_counts.get("error", 0) > 0:
        status = "error"
    elif severity_counts.get("warning", 0) > 0:
        status = "warning"

    report = {
        "gallery": cfg.gallery,
        "status": status,
        "started_at": started_at.isoformat(),
        "finished_at": ended_at.isoformat(),
        "elapsed_sec": round(max(0.0, (ended_at - started_at).total_seconds()), 3),
        "scanned": counts,
        "severity_counts": severity_counts,
        "issue_counts": issue_counts,
        "issues": issues,
    }
    return report, issues


def _store_run_issues(conn, run_id: int, issues: list[dict]) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM integrity_issues WHERE run_id=%s", (run_id,))
        if not issues:
            return
        rows = []
        for item in issues:
            rows.append(
                (
                    run_id,
                    item.get("severity") or "warning",
                    item.get("issue_code") or "unknown",
                    item.get("gallery"),
                    item.get("image_id"),
                    item.get("source_id"),
                    item.get("file_path"),
                    item.get("derivative_kind"),
                    json.dumps(item.get("detail") or {}, ensure_ascii=False),
                )
            )
        cur.executemany(
            """
INSERT INTO integrity_issues (
    run_id,
    severity,
    issue_code,
    gallery,
    image_id,
    source_id,
    file_path,
    derivative_kind,
    detail_json
)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CAST(%s AS JSON))
""",
            rows,
        )


def _write_report(cfg: Cfg, report: dict, run_id: int | None) -> Path:
    now = _utc_now().astimezone(JST)
    stamp = now.strftime("%Y%m%d-%H%M%S")
    suffix = f"-run{run_id}" if run_id is not None else "-adhoc"
    path = cfg.paths.report_root / now.strftime("%Y") / now.strftime("%m") / f"{stamp}{suffix}.json"
    _save_json(path, report)
    return path


def _print_summary_line(report: dict) -> None:
    issue_counts = report.get("issue_counts") or {}
    severity_counts = report.get("severity_counts") or {}
    scanned = report.get("scanned") or {}
    print(
        "integrity-check done"
        f" status={report.get('status') or 'failed'}"
        f" scanned_images={int(scanned.get('images') or 0)}"
        f" scanned_sources={int(scanned.get('source_rows') or 0)}"
        f" source_files={int(scanned.get('source_files') or 0)}"
        f" warnings={int(severity_counts.get('warning') or 0)}"
        f" errors={int(severity_counts.get('error') or 0)}"
        f" missing_source={int(issue_counts.get('missing_source') or 0)}"
        f" missing_derivative={int(issue_counts.get('missing_derivative') or 0)}"
        f" missing_color={int(issue_counts.get('missing_color') or 0)}"
        f" orphan_db={int(issue_counts.get('orphan_db') or 0)}"
        f" orphan_file={int(issue_counts.get('orphan_file') or 0)}"
    )


def _run_single_integrity_pass(config_path: str, run_id: int | None) -> tuple[int, dict, list[dict], Path]:
    cfg = _load_cfg(config_path)
    report, issues = _scan_integrity(cfg)
    report_path = _write_report(cfg, report, run_id)
    report["report_path"] = str(report_path)
    _save_json(report_path, report)
    exit_code = STATUS_EXIT_CODE.get(str(report.get("status") or "failed"), 3)
    return exit_code, report, issues, report_path


def run_integrity_check(config_path: str, run_id: int | None = None, print_summary: bool = True) -> int:
    try:
        exit_code, report, _, _ = _run_single_integrity_pass(config_path, run_id)
        if print_summary:
            _print_summary_line(report)
        return exit_code
    except Exception as exc:
        if print_summary:
            print(f"integrity-check failed error={type(exc).__name__}: {exc}")
        return 3


def _mark_running(conn, run_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
UPDATE integrity_runs
SET status='running',
    started_at=%s,
    finished_at=NULL,
    exit_code=NULL,
    message=NULL,
    summary_json=NULL,
    report_path=NULL,
    updated_at=CURRENT_TIMESTAMP(6)
WHERE id=%s
""",
            (_utc_naive(_utc_now()), run_id),
        )


def _mark_finished(conn, run_id: int, status: str, exit_code: int, report: dict, report_path: Path) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
UPDATE integrity_runs
SET status=%s,
    finished_at=%s,
    exit_code=%s,
    summary_json=CAST(%s AS JSON),
    report_path=%s,
    message=%s,
    updated_at=CURRENT_TIMESTAMP(6)
WHERE id=%s
""",
            (
                status,
                _utc_naive(_utc_now()),
                exit_code,
                json.dumps(
                    {
                        "status": report.get("status"),
                        "scanned": report.get("scanned") or {},
                        "severity_counts": report.get("severity_counts") or {},
                        "issue_counts": report.get("issue_counts") or {},
                        "started_at": report.get("started_at"),
                        "finished_at": report.get("finished_at"),
                        "elapsed_sec": report.get("elapsed_sec"),
                    },
                    ensure_ascii=False,
                ),
                str(report_path),
                None,
                run_id,
            ),
        )


def _mark_failed(conn, run_id: int, exc: Exception) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
UPDATE integrity_runs
SET status='failed',
    finished_at=%s,
    exit_code=3,
    message=%s,
    updated_at=CURRENT_TIMESTAMP(6)
WHERE id=%s
""",
            (_utc_naive(_utc_now()), f"{type(exc).__name__}: {exc}", run_id),
        )


def _next_queued_run(conn) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT *
FROM integrity_runs
WHERE status='queued'
ORDER BY
    CASE WHEN scheduled_for IS NULL THEN 1 ELSE 0 END ASC,
    COALESCE(scheduled_for, requested_at) ASC,
    id ASC
LIMIT 1
"""
        )
        return cur.fetchone()


def _recover_stale_running(conn) -> None:
    cutoff = _utc_naive(_utc_now() - timedelta(hours=6))
    with conn.cursor() as cur:
        cur.execute(
            """
UPDATE integrity_runs
SET status='failed',
    finished_at=%s,
    exit_code=3,
    message='dispatcher detected stale running job',
    updated_at=CURRENT_TIMESTAMP(6)
WHERE status='running' AND started_at IS NOT NULL AND started_at < %s
""",
            (_utc_naive(_utc_now()), cutoff),
        )


def run_integrity_dispatch(config_path: str, max_runs: int = 1) -> int:
    cfg = _load_cfg(config_path)
    conn = _db_connect(cfg, autocommit=False)
    processed = 0
    highest_exit = 0
    try:
        _ensure_admin_site_settings_tables(conn)
        _ensure_integrity_tables(conn)
        if not _acquire_dispatch_lock(conn):
            print("integrity-dispatch skipped reason=lock_not_acquired")
            conn.rollback()
            return 0
        try:
            _recover_stale_running(conn)
            settings = _load_integrity_settings(conn)
            queued = _queue_due_schedule_runs(conn, settings)
            _cleanup_old_artifacts(conn, cfg, int(settings.get("report_retention_days") or 30))
            conn.commit()
            if queued:
                print(f"integrity-dispatch queued_schedule_runs={queued}")

            while processed < max_runs:
                run_row = _next_queued_run(conn)
                if not run_row:
                    break
                run_id = int(run_row.get("id"))
                _mark_running(conn, run_id)
                conn.commit()
                try:
                    exit_code, report, issues, report_path = _run_single_integrity_pass(config_path, run_id)
                    _store_run_issues(conn, run_id, issues)
                    _mark_finished(conn, run_id, str(report.get("status") or "failed"), exit_code, report, report_path)
                    conn.commit()
                    processed += 1
                    highest_exit = max(highest_exit, exit_code)
                    _print_summary_line(report)
                except Exception as exc:
                    conn.rollback()
                    _mark_failed(conn, run_id, exc)
                    conn.commit()
                    processed += 1
                    highest_exit = max(highest_exit, 3)
                    print(f"integrity-dispatch run_id={run_id} failed error={type(exc).__name__}: {exc}")
        finally:
            try:
                _release_dispatch_lock(conn)
            except Exception:
                pass
    finally:
        conn.close()
    return highest_exit
