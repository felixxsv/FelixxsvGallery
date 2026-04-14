from __future__ import annotations

from datetime import datetime, timezone
import json


SUPPORTER_PLAN_CODE = "supporter_monthly_500"
SUPPORTER_AMOUNT = 500
SUPPORTER_CURRENCY = "JPY"
SUPPORTER_PROVIDER = "external"
SUPPORTER_STATUS_CODES = {
    "inactive",
    "active",
    "canceled",
    "past_due",
    "unpaid",
    "expired",
    "gift_active",
    "permanent_active",
    "scheduled",
}
SUPPORTER_ACHIEVEMENT_THRESHOLDS = [
    ("1m", 1),
    ("3m", 3),
    ("6m", 6),
    ("1y", 12),
    ("2y", 24),
]
SUPPORTER_ICON_FRAMES = {
    "none": {
        "label_key": "support.common.none",
        "preview_class": "",
    },
    "aurora_ring": {
        "label_key": "support.icon_frame.aurora_ring",
        "preview_class": "supporter-icon-frame--aurora-ring",
    },
    "amber_ring": {
        "label_key": "support.icon_frame.amber_ring",
        "preview_class": "supporter-icon-frame--amber-ring",
    },
}
SUPPORTER_PROFILE_DECORS = {
    "none": {
        "label_key": "support.common.none",
        "preview_class": "",
    },
    "aurora_glow": {
        "label_key": "support.profile_decor.aurora_glow",
        "preview_class": "supporter-profile-decor--aurora-glow",
    },
    "sunrise_wave": {
        "label_key": "support.profile_decor.sunrise_wave",
        "preview_class": "supporter-profile-decor--sunrise-wave",
    },
}
SUPPORTER_ENTITLEMENTS = (
    "badge",
    "duration_badge",
    "icon_frame",
    "profile_decor",
)


def _default_supporter_catalog() -> dict[str, list[dict]]:
    return {
        "icon_frames": [
            {"key": key, **value}
            for key, value in SUPPORTER_ICON_FRAMES.items()
        ],
        "profile_decors": [
            {"key": key, **value}
            for key, value in SUPPORTER_PROFILE_DECORS.items()
        ],
    }


def get_supporter_catalog(conn) -> dict[str, list[dict]]:
    fallback = _default_supporter_catalog()
    if not _table_exists(conn, "supporter_decoration_catalog"):
        return fallback
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT decoration_kind, decoration_key, label_key, preview_class, sort_order
FROM supporter_decoration_catalog
WHERE is_active=1
ORDER BY decoration_kind ASC, sort_order ASC, id ASC
"""
        )
        rows = list(cur.fetchall() or [])
    if not rows:
        return fallback
    catalog = {
        "icon_frames": [],
        "profile_decors": [],
    }
    kind_map = {
        "icon_frame": "icon_frames",
        "profile_decor": "profile_decors",
    }
    for row in rows:
        bucket = kind_map.get(str(row.get("decoration_kind") or "").strip())
        if not bucket:
            continue
        key = str(row.get("decoration_key") or "").strip()
        if not key:
            continue
        catalog[bucket].append(
            {
                "key": key,
                "label_key": str(row.get("label_key") or "").strip(),
                "preview_class": str(row.get("preview_class") or "").strip(),
                "sort_order": int(row.get("sort_order") or 0),
            }
        )
    for bucket, defaults in fallback.items():
        if not catalog[bucket]:
            catalog[bucket] = defaults
        else:
            existing_keys = {str(item.get("key") or "").strip() for item in catalog[bucket]}
            for default_item in defaults:
                default_key = str(default_item.get("key") or "").strip()
                if default_key and default_key not in existing_keys:
                    catalog[bucket].insert(0, default_item)
    return catalog


def _catalog_keys(catalog: dict[str, list[dict]], kind: str) -> set[str]:
    return {
        str(item.get("key") or "").strip()
        for item in (catalog.get(kind) or [])
        if str(item.get("key") or "").strip()
    }


def _catalog_default_key(catalog: dict[str, list[dict]], kind: str, fallback_key: str) -> str:
    items = catalog.get(kind) or []
    first_key = str(items[0].get("key") or "").strip() if items else ""
    return first_key or fallback_key


def is_support_ui_enabled(conn, default: bool = True) -> bool:
    if not _table_exists(conn, "admin_site_settings"):
        return bool(default)
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT value_json
FROM admin_site_settings
WHERE setting_group='general' AND setting_key='support_ui_enabled'
LIMIT 1
"""
        )
        row = cur.fetchone()
    if not row:
        return bool(default)
    value = _json_loads(row.get("value_json"), default)
    return bool(value if isinstance(value, bool) else default)


def _table_exists(conn, table_name: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES LIKE %s", (table_name,))
        return cur.fetchone() is not None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_datetime(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return None


def _isoformat(value) -> str | None:
    dt = _coerce_datetime(value)
    return dt.isoformat() if dt else None


def _json_loads(value, default):
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return default
    return default


def get_support_urls(conf: dict | None) -> dict:
    support_conf = (conf or {}).get("support") or {}
    return {
        "checkout_url": str(support_conf.get("checkout_url") or "").strip() or None,
        "portal_url": str(support_conf.get("portal_url") or "").strip() or None,
        "status_url": str(support_conf.get("status_url") or "").strip() or None,
    }


def get_supporter_settings(conn, user_id: int, create: bool = False) -> dict:
    catalog = get_supporter_catalog(conn)
    defaults = {
        "supporter_visible": True,
        "supporter_badge_visible": True,
        "supporter_duration_badge_visible": True,
        "supporter_icon_frame_visible": True,
        "supporter_profile_decor_visible": True,
        "selected_icon_frame": _catalog_default_key(catalog, "icon_frames", "none"),
        "selected_profile_decor": _catalog_default_key(catalog, "profile_decors", "none"),
    }
    if not _table_exists(conn, "supporter_profile_settings"):
        return defaults.copy()
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT
  supporter_visible,
  supporter_badge_visible,
  supporter_duration_badge_visible,
  supporter_icon_frame_visible,
  supporter_profile_decor_visible,
  selected_icon_frame,
  selected_profile_decor
FROM supporter_profile_settings
WHERE user_id=%s
LIMIT 1
""",
            (user_id,),
        )
        row = cur.fetchone()
        if not row and create:
            cur.execute(
                """
INSERT INTO supporter_profile_settings (
  user_id,
  supporter_visible,
  supporter_badge_visible,
  supporter_duration_badge_visible,
  supporter_icon_frame_visible,
  supporter_profile_decor_visible,
  selected_icon_frame,
  selected_profile_decor
) VALUES (%s,1,1,1,1,1,%s,%s)
""",
                (user_id, defaults["selected_icon_frame"], defaults["selected_profile_decor"]),
            )
            cur.execute(
                """
SELECT
  supporter_visible,
  supporter_badge_visible,
  supporter_duration_badge_visible,
  supporter_icon_frame_visible,
  supporter_profile_decor_visible,
  selected_icon_frame,
  selected_profile_decor
FROM supporter_profile_settings
WHERE user_id=%s
LIMIT 1
""",
                (user_id,),
            )
            row = cur.fetchone()
    if not row:
        return defaults.copy()
    settings = defaults.copy()
    settings.update(
        {
            "supporter_visible": bool(row.get("supporter_visible")),
            "supporter_badge_visible": bool(row.get("supporter_badge_visible")),
            "supporter_duration_badge_visible": bool(row.get("supporter_duration_badge_visible")),
            "supporter_icon_frame_visible": bool(row.get("supporter_icon_frame_visible")),
            "supporter_profile_decor_visible": bool(row.get("supporter_profile_decor_visible")),
            "selected_icon_frame": row.get("selected_icon_frame") or defaults["selected_icon_frame"],
            "selected_profile_decor": row.get("selected_profile_decor") or defaults["selected_profile_decor"],
        }
    )
    icon_frame_keys = _catalog_keys(catalog, "icon_frames")
    profile_decor_keys = _catalog_keys(catalog, "profile_decors")
    if settings["selected_icon_frame"] not in icon_frame_keys:
        settings["selected_icon_frame"] = defaults["selected_icon_frame"]
    if settings["selected_profile_decor"] not in profile_decor_keys:
        settings["selected_profile_decor"] = defaults["selected_profile_decor"]
    settings["supporter_icon_frame_visible"] = settings["selected_icon_frame"] != "none"
    settings["supporter_profile_decor_visible"] = settings["selected_profile_decor"] != "none"
    return settings


def update_supporter_settings(conn, user_id: int, payload: dict) -> dict:
    catalog = get_supporter_catalog(conn)
    settings = get_supporter_settings(conn, user_id, create=True)
    selected_icon_frame = str(payload.get("selected_icon_frame") or settings["selected_icon_frame"]).strip() or settings["selected_icon_frame"]
    selected_profile_decor = str(payload.get("selected_profile_decor") or settings["selected_profile_decor"]).strip() or settings["selected_profile_decor"]
    updates = {
        "supporter_visible": bool(payload.get("supporter_visible", settings["supporter_visible"])),
        "supporter_badge_visible": bool(payload.get("supporter_badge_visible", settings["supporter_badge_visible"])),
        "supporter_duration_badge_visible": bool(payload.get("supporter_duration_badge_visible", settings["supporter_duration_badge_visible"])),
        "supporter_icon_frame_visible": selected_icon_frame != "none",
        "supporter_profile_decor_visible": selected_profile_decor != "none",
        "selected_icon_frame": selected_icon_frame,
        "selected_profile_decor": selected_profile_decor,
    }
    icon_frame_keys = _catalog_keys(catalog, "icon_frames")
    profile_decor_keys = _catalog_keys(catalog, "profile_decors")
    if updates["selected_icon_frame"] not in icon_frame_keys:
        updates["selected_icon_frame"] = settings["selected_icon_frame"]
    if updates["selected_profile_decor"] not in profile_decor_keys:
        updates["selected_profile_decor"] = settings["selected_profile_decor"]
    with conn.cursor() as cur:
        cur.execute(
            """
UPDATE supporter_profile_settings
SET
  supporter_visible=%s,
  supporter_badge_visible=%s,
  supporter_duration_badge_visible=%s,
  supporter_icon_frame_visible=%s,
  supporter_profile_decor_visible=%s,
  selected_icon_frame=%s,
  selected_profile_decor=%s
WHERE user_id=%s
""",
            (
                1 if updates["supporter_visible"] else 0,
                1 if updates["supporter_badge_visible"] else 0,
                1 if updates["supporter_duration_badge_visible"] else 0,
                1 if updates["supporter_icon_frame_visible"] else 0,
                1 if updates["supporter_profile_decor_visible"] else 0,
                updates["selected_icon_frame"],
                updates["selected_profile_decor"],
                user_id,
            ),
        )
    return updates


def _load_subscription_rows(conn, user_id: int) -> list[dict]:
    if not _table_exists(conn, "supporter_subscriptions"):
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT
  id,
  provider,
  provider_customer_id,
  provider_subscription_id,
  status,
  plan_code,
  amount,
  currency,
  started_at,
  current_period_start,
  current_period_end,
  canceled_at,
  ended_at,
  scheduled_start_at,
  first_billing_at,
  credited_months,
  metadata_json,
  created_at,
  updated_at
FROM supporter_subscriptions
WHERE user_id=%s
ORDER BY updated_at DESC, id DESC
""",
            (user_id,),
        )
        return list(cur.fetchall() or [])


def _load_grant_rows(conn, user_id: int) -> list[dict]:
    if not _table_exists(conn, "supporter_grants"):
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT
  id,
  grant_type,
  source_type,
  months,
  starts_at,
  ends_at,
  is_permanent,
  is_active,
  reason,
  granted_by_user_id,
  granted_at,
  revoked_by_user_id,
  revoked_at,
  revoke_reason,
  created_at,
  updated_at
FROM supporter_grants
WHERE user_id=%s
ORDER BY created_at DESC, id DESC
""",
            (user_id,),
        )
        return list(cur.fetchall() or [])


def _load_achievement_rows(conn, user_id: int) -> list[dict]:
    if not _table_exists(conn, "supporter_achievements"):
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT achievement_code, unlocked_at
FROM supporter_achievements
WHERE user_id=%s
ORDER BY unlocked_at ASC, achievement_code ASC
""",
            (user_id,),
        )
        return list(cur.fetchall() or [])


def _load_event_rows(conn, user_id: int, limit: int = 20) -> list[dict]:
    if not _table_exists(conn, "supporter_provider_events"):
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT
  id,
  provider,
  event_type,
  provider_event_id,
  provider_customer_id,
  provider_subscription_id,
  received_at,
  processed_at,
  process_status,
  error_summary,
  mismatch_flag,
  mismatch_type,
  resolved_at,
  resolved_by_user_id,
  created_at,
  updated_at
FROM supporter_provider_events
WHERE related_user_id=%s
ORDER BY received_at DESC, id DESC
LIMIT %s
""",
            (user_id, int(limit)),
        )
        return list(cur.fetchall() or [])


def _serialize_subscription(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "provider": row.get("provider") or SUPPORTER_PROVIDER,
        "provider_customer_id": row.get("provider_customer_id"),
        "provider_subscription_id": row.get("provider_subscription_id"),
        "status": str(row.get("status") or "inactive"),
        "plan_code": row.get("plan_code") or SUPPORTER_PLAN_CODE,
        "amount": int(row.get("amount") or SUPPORTER_AMOUNT),
        "currency": row.get("currency") or SUPPORTER_CURRENCY,
        "started_at": _isoformat(row.get("started_at")),
        "current_period_start": _isoformat(row.get("current_period_start")),
        "current_period_end": _isoformat(row.get("current_period_end")),
        "canceled_at": _isoformat(row.get("canceled_at")),
        "ended_at": _isoformat(row.get("ended_at")),
        "scheduled_start_at": _isoformat(row.get("scheduled_start_at")),
        "first_billing_at": _isoformat(row.get("first_billing_at")),
        "credited_months": int(row.get("credited_months") or 0),
        "metadata": _json_loads(row.get("metadata_json"), {}),
    }


def _serialize_grant(row: dict) -> dict:
    return {
        "id": int(row.get("id") or 0),
        "grant_type": row.get("grant_type") or "months",
        "source_type": row.get("source_type") or "admin_gift",
        "months": int(row.get("months") or 0),
        "starts_at": _isoformat(row.get("starts_at")),
        "ends_at": _isoformat(row.get("ends_at")),
        "is_permanent": bool(row.get("is_permanent")),
        "is_active": bool(row.get("is_active")),
        "reason": row.get("reason") or "",
        "granted_by_user_id": row.get("granted_by_user_id"),
        "granted_at": _isoformat(row.get("granted_at")),
        "revoked_by_user_id": row.get("revoked_by_user_id"),
        "revoked_at": _isoformat(row.get("revoked_at")),
        "revoke_reason": row.get("revoke_reason") or "",
    }


def _serialize_event(row: dict) -> dict:
    return {
        "id": int(row.get("id") or 0),
        "provider": row.get("provider") or "",
        "event_type": row.get("event_type") or "",
        "provider_event_id": row.get("provider_event_id") or "",
        "provider_customer_id": row.get("provider_customer_id") or "",
        "provider_subscription_id": row.get("provider_subscription_id") or "",
        "received_at": _isoformat(row.get("received_at")),
        "processed_at": _isoformat(row.get("processed_at")),
        "process_status": row.get("process_status") or "received",
        "error_summary": row.get("error_summary") or "",
        "mismatch_flag": bool(row.get("mismatch_flag")),
        "mismatch_type": row.get("mismatch_type") or "",
        "resolved_at": _isoformat(row.get("resolved_at")),
        "resolved_by_user_id": row.get("resolved_by_user_id"),
        "created_at": _isoformat(row.get("created_at")),
        "updated_at": _isoformat(row.get("updated_at")),
    }


def _pick_primary_subscription(rows: list[dict], now: datetime) -> dict | None:
    if not rows:
        return None
    def sort_key(row: dict):
        status = str(row.get("status") or "")
        current_period_end = _coerce_datetime(row.get("current_period_end"))
        scheduled_start = _coerce_datetime(row.get("scheduled_start_at"))
        priority = 50
        if status == "active":
            priority = 0
        elif status == "canceled" and current_period_end and current_period_end >= now:
            priority = 1
        elif status == "past_due":
            priority = 2
        elif status == "unpaid":
            priority = 3
        elif status == "scheduled" or (scheduled_start and scheduled_start > now):
            priority = 4
        elif status == "expired":
            priority = 5
        return (
            priority,
            -(int(current_period_end.timestamp()) if current_period_end else -1),
            -(int(_coerce_datetime(row.get("updated_at")).timestamp()) if _coerce_datetime(row.get("updated_at")) else -1),
        )
    return sorted(rows, key=sort_key)[0]


def _compute_paid_state(subscription: dict | None, now: datetime) -> tuple[str, bool]:
    if not subscription:
        return "inactive", False
    status = str(subscription.get("status") or "inactive")
    current_period_end = _coerce_datetime(subscription.get("current_period_end"))
    scheduled_start = _coerce_datetime(subscription.get("scheduled_start_at"))
    if status == "active":
        return "active", True
    if status == "canceled" and current_period_end and current_period_end >= now:
        return "cancelScheduled", True
    if status == "past_due":
        return "past_due", False
    if status == "unpaid":
        return "unpaid", False
    if status == "scheduled" or (scheduled_start and scheduled_start > now):
        return "scheduled", False
    if status in {"expired", "canceled"}:
        return "expired", False
    return "inactive", False


def _compute_grant_state(grants: list[dict], now: datetime) -> dict:
    active_gift = None
    permanent = None
    for row in grants:
        if not bool(row.get("is_active")) or row.get("revoked_at") is not None:
            continue
        starts_at = _coerce_datetime(row.get("starts_at"))
        ends_at = _coerce_datetime(row.get("ends_at"))
        if bool(row.get("is_permanent")):
            permanent = row
            continue
        if starts_at and starts_at > now:
            continue
        if ends_at and ends_at < now:
            continue
        active_gift = row
        break
    return {
        "gift_active": active_gift,
        "permanent_active": permanent,
    }


def _calculate_awarded_months(subscription_rows: list[dict], grant_rows: list[dict], now: datetime) -> int:
    months = 0
    for row in subscription_rows:
        months += int(row.get("credited_months") or 0)
    for row in grant_rows:
        if row.get("revoked_at") is not None:
            continue
        if bool(row.get("is_permanent")):
            continue
        starts_at = _coerce_datetime(row.get("starts_at"))
        if starts_at and starts_at > now:
            continue
        months += int(row.get("months") or 0)
    return months


def ensure_supporter_achievements(conn, user_id: int, total_months: int, now: datetime | None = None) -> list[dict]:
    now = now or _utc_now()
    rows = _load_achievement_rows(conn, user_id)
    existing = {str(row.get("achievement_code") or "") for row in rows}
    if _table_exists(conn, "supporter_achievements"):
        with conn.cursor() as cur:
            for code, threshold in SUPPORTER_ACHIEVEMENT_THRESHOLDS:
                if total_months < threshold or code in existing:
                    continue
                cur.execute(
                    """
INSERT INTO supporter_achievements (user_id, achievement_code, unlocked_at)
VALUES (%s, %s, %s)
ON DUPLICATE KEY UPDATE unlocked_at=VALUES(unlocked_at)
""",
                    (user_id, code, now),
                )
        rows = _load_achievement_rows(conn, user_id)
    return [
        {
            "code": str(row.get("achievement_code") or ""),
            "label_key": f"support.achievements.{str(row.get('achievement_code') or '').lower()}",
            "unlocked_at": _isoformat(row.get("unlocked_at")),
        }
        for row in rows
    ]


def _highest_achievement_code(achievements: list[dict]) -> str | None:
    unlocked = {str(item.get("code") or "").lower() for item in achievements}
    highest = None
    for code, _threshold in SUPPORTER_ACHIEVEMENT_THRESHOLDS:
        if code in unlocked:
            highest = code
    return highest


def build_supporter_context(conn, user_id: int, conf: dict | None = None, include_private: bool = True, include_admin: bool = False) -> dict:
    now = _utc_now()
    ui_enabled = is_support_ui_enabled(conn, default=True)
    settings = get_supporter_settings(conn, user_id, create=False)
    subscription_rows = _load_subscription_rows(conn, user_id)
    subscription_row = _pick_primary_subscription(subscription_rows, now)
    subscription = _serialize_subscription(subscription_row)
    grant_rows = _load_grant_rows(conn, user_id)
    grant_state = _compute_grant_state(grant_rows, now)
    paid_status_code, paid_effective = _compute_paid_state(subscription_row, now)
    total_months = _calculate_awarded_months(subscription_rows, grant_rows, now)
    achievements = ensure_supporter_achievements(conn, user_id, total_months, now=now)
    highest_achievement = _highest_achievement_code(achievements)

    permanent_active = grant_state["permanent_active"] is not None
    gift_active = grant_state["gift_active"] is not None
    effective_active = bool(permanent_active or gift_active or paid_effective)

    display_status = "inactive"
    if permanent_active:
        display_status = "permanentActive"
    elif gift_active:
        display_status = "giftActive"
    elif paid_status_code == "active":
        display_status = "active"
    elif paid_status_code == "cancelScheduled":
        display_status = "cancelScheduled"
    elif paid_status_code in {"past_due", "unpaid", "scheduled"}:
        display_status = paid_status_code
    elif paid_status_code == "expired" or total_months > 0:
        display_status = "expired"

    gift_first_billing_at = None
    if grant_state["gift_active"] is not None and subscription:
        gift_first_billing_at = subscription.get("first_billing_at") or _isoformat(grant_state["gift_active"].get("ends_at"))

    has_visible_support = ui_enabled and settings["supporter_visible"] and effective_active
    public_profile = {
        "status": display_status,
        "is_supporter": bool(ui_enabled and effective_active),
        "ui_enabled": ui_enabled,
        "badge_visible": bool(has_visible_support and settings["supporter_badge_visible"]),
        "duration_badge_visible": bool(ui_enabled and settings["supporter_visible"] and settings["supporter_duration_badge_visible"] and highest_achievement),
        "icon_frame_visible": bool(has_visible_support and settings["supporter_icon_frame_visible"]),
        "profile_decor_visible": bool(has_visible_support and settings["supporter_profile_decor_visible"]),
        "badge_label_key": "support.common.supporter_badge",
        "duration_badge_code": highest_achievement,
        "selected_icon_frame": settings["selected_icon_frame"] if has_visible_support and settings["supporter_icon_frame_visible"] else None,
        "selected_profile_decor": settings["selected_profile_decor"] if has_visible_support and settings["supporter_profile_decor_visible"] else None,
    }
    entitlements = {
        "badge": effective_active,
        "duration_badge": bool(highest_achievement),
        "icon_frame": effective_active,
        "profile_decor": effective_active,
        "desktop_wallpaper": effective_active,
        "desktop_slideshow": effective_active,
        "desktop_avatar": effective_active,
    }
    urls = get_support_urls(conf)
    actions = {
        **urls,
        "checkout_available": bool(urls["checkout_url"]),
        "portal_available": bool(urls["portal_url"]),
        "status_available": bool(urls["status_url"]),
    }

    status = {
        "code": display_status,
        "is_active": effective_active,
        "source_type": (
            "admin_permanent"
            if permanent_active and not (gift_active or paid_effective)
            else "admin_gift"
            if gift_active and not paid_effective
            else "paid_subscription"
            if paid_effective and not (gift_active or permanent_active)
            else "mixed"
            if effective_active
            else "none"
        ),
        "plan_code": subscription.get("plan_code") if subscription else SUPPORTER_PLAN_CODE,
        "amount": subscription.get("amount") if subscription else SUPPORTER_AMOUNT,
        "currency": subscription.get("currency") if subscription else SUPPORTER_CURRENCY,
        "started_at": subscription.get("started_at") if subscription else None,
        "current_period_start": subscription.get("current_period_start") if subscription else None,
        "current_period_end": subscription.get("current_period_end") if subscription else None,
        "canceled_at": subscription.get("canceled_at") if subscription else None,
        "ended_at": subscription.get("ended_at") if subscription else None,
        "scheduled_start_at": subscription.get("scheduled_start_at") if subscription else None,
        "first_billing_at": gift_first_billing_at or (subscription.get("first_billing_at") if subscription else None),
        "gift_ends_at": _isoformat(grant_state["gift_active"].get("ends_at")) if grant_state["gift_active"] else None,
        "gift_started_at": _isoformat(grant_state["gift_active"].get("starts_at")) if grant_state["gift_active"] else None,
        "is_permanent": permanent_active,
        "is_gift": gift_active,
        "is_paid": paid_effective,
        "monthly_price": SUPPORTER_AMOUNT,
        "next_billing_at": subscription.get("current_period_end") if subscription and display_status == "active" else None,
        "supporter_since": subscription.get("started_at") if subscription else None,
    }

    result = {
        "ui_enabled": ui_enabled,
        "status": status,
        "subscription": subscription,
        "settings": settings if include_private else None,
        "achievements": achievements,
        "achievement_summary": {
            "total_months": total_months,
            "highest_code": highest_achievement,
        },
        "entitlements": entitlements,
        "public_profile": public_profile,
        "actions": actions,
        "catalog": get_supporter_catalog(conn),
    }
    if include_admin:
        result["grants"] = [_serialize_grant(row) for row in grant_rows]
        result["events"] = [_serialize_event(row) for row in _load_event_rows(conn, user_id)]
        result["subscription_history"] = [_serialize_subscription(row) for row in subscription_rows]
    return result


def get_public_supporter_profile(conn, user_id: int, conf: dict | None = None) -> dict:
    context = build_supporter_context(conn, user_id, conf=conf, include_private=False, include_admin=False)
    return context["public_profile"]


def upsert_supporter_subscription(conn, user_id: int, payload: dict) -> dict:
    now = _utc_now()
    provider = str(payload.get("provider") or SUPPORTER_PROVIDER).strip() or SUPPORTER_PROVIDER
    provider_customer_id = str(payload.get("provider_customer_id") or "").strip() or None
    provider_subscription_id = str(payload.get("provider_subscription_id") or "").strip() or None
    status = str(payload.get("status") or "inactive").strip().lower()
    if status not in SUPPORTER_STATUS_CODES:
        status = "inactive"
    plan_code = str(payload.get("plan_code") or SUPPORTER_PLAN_CODE).strip() or SUPPORTER_PLAN_CODE
    amount = int(payload.get("amount") or SUPPORTER_AMOUNT)
    currency = str(payload.get("currency") or SUPPORTER_CURRENCY).strip() or SUPPORTER_CURRENCY
    started_at = payload.get("started_at") or None
    current_period_start = payload.get("current_period_start") or None
    current_period_end = payload.get("current_period_end") or None
    canceled_at = payload.get("canceled_at") or None
    ended_at = payload.get("ended_at") or None
    scheduled_start_at = payload.get("scheduled_start_at") or None
    first_billing_at = payload.get("first_billing_at") or None
    credited_months = max(0, int(payload.get("credited_months") or 0))
    metadata_json = json.dumps(payload.get("metadata") or {}, ensure_ascii=False)
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO supporter_subscriptions (
  user_id,
  provider,
  provider_customer_id,
  provider_subscription_id,
  status,
  plan_code,
  amount,
  currency,
  started_at,
  current_period_start,
  current_period_end,
  canceled_at,
  ended_at,
  scheduled_start_at,
  first_billing_at,
  credited_months,
  metadata_json,
  created_at,
  updated_at
) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE
  status=VALUES(status),
  plan_code=VALUES(plan_code),
  amount=VALUES(amount),
  currency=VALUES(currency),
  started_at=VALUES(started_at),
  current_period_start=VALUES(current_period_start),
  current_period_end=VALUES(current_period_end),
  canceled_at=VALUES(canceled_at),
  ended_at=VALUES(ended_at),
  scheduled_start_at=VALUES(scheduled_start_at),
  first_billing_at=VALUES(first_billing_at),
  credited_months=VALUES(credited_months),
  metadata_json=VALUES(metadata_json),
  updated_at=VALUES(updated_at)
""",
            (
                user_id,
                provider,
                provider_customer_id,
                provider_subscription_id,
                status,
                plan_code,
                amount,
                currency,
                started_at,
                current_period_start,
                current_period_end,
                canceled_at,
                ended_at,
                scheduled_start_at,
                first_billing_at,
                credited_months,
                metadata_json,
                now,
                now,
            ),
        )
    return build_supporter_context(conn, user_id, include_private=True, include_admin=True)


def grant_supporter_access(conn, user_id: int, actor_user_id: int | None, payload: dict) -> dict:
    grant_type = str(payload.get("grant_type") or "months").strip() or "months"
    months = max(0, int(payload.get("months") or 0))
    is_permanent = bool(payload.get("is_permanent"))
    reason = str(payload.get("reason") or "").strip()
    source_type = "admin_permanent" if is_permanent else "admin_gift"
    now = _utc_now()
    current = build_supporter_context(conn, user_id, include_private=True, include_admin=True)
    starts_at = now
    ends_at = None
    if not is_permanent:
        active_until_candidates = []
        if current["status"].get("current_period_end"):
            active_until_candidates.append(_coerce_datetime(datetime.fromisoformat(current["status"]["current_period_end"])))
        gift_ends = current["status"].get("gift_ends_at")
        if gift_ends:
            active_until_candidates.append(_coerce_datetime(datetime.fromisoformat(gift_ends)))
        active_until_candidates = [item for item in active_until_candidates if item is not None and item > now]
        if active_until_candidates:
            starts_at = max(active_until_candidates)
        ends_at = starts_at
        if months > 0:
            month_count = months
            year = ends_at.year
            month = ends_at.month
            day = ends_at.day
            hour = ends_at.hour
            minute = ends_at.minute
            second = ends_at.second
            microsecond = ends_at.microsecond
            month += month_count
            year += (month - 1) // 12
            month = ((month - 1) % 12) + 1
            while True:
                try:
                    ends_at = ends_at.replace(year=year, month=month, day=day, hour=hour, minute=minute, second=second, microsecond=microsecond)
                    break
                except ValueError:
                    day -= 1
                    if day <= 0:
                        ends_at = ends_at.replace(year=year, month=month, day=1, hour=hour, minute=minute, second=second, microsecond=microsecond)
                        break
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO supporter_grants (
  user_id,
  grant_type,
  source_type,
  months,
  starts_at,
  ends_at,
  is_permanent,
  is_active,
  reason,
  granted_by_user_id,
  granted_at,
  created_at,
  updated_at
) VALUES (%s,%s,%s,%s,%s,%s,%s,1,%s,%s,%s,%s,%s)
""",
            (
                user_id,
                grant_type,
                source_type,
                months,
                starts_at,
                ends_at,
                1 if is_permanent else 0,
                reason,
                actor_user_id,
                now,
                now,
                now,
            ),
        )
    return build_supporter_context(conn, user_id, include_private=True, include_admin=True)


def revoke_supporter_grant(conn, grant_id: int, actor_user_id: int | None, revoke_reason: str = "") -> tuple[int | None, dict | None]:
    if not _table_exists(conn, "supporter_grants"):
        return None, None
    now = _utc_now()
    with conn.cursor() as cur:
        cur.execute("SELECT user_id FROM supporter_grants WHERE id=%s LIMIT 1", (grant_id,))
        row = cur.fetchone()
        if not row:
            return None, None
        user_id = int(row.get("user_id"))
        cur.execute(
            """
UPDATE supporter_grants
SET is_active=0, revoked_by_user_id=%s, revoked_at=%s, revoke_reason=%s, updated_at=%s
WHERE id=%s
""",
            (actor_user_id, now, revoke_reason, now, grant_id),
        )
    return user_id, build_supporter_context(conn, user_id, include_private=True, include_admin=True)


def record_supporter_provider_event(conn, payload: dict) -> dict | None:
    if not _table_exists(conn, "supporter_provider_events"):
        return None
    now = _utc_now()
    provider = str(payload.get("provider") or SUPPORTER_PROVIDER).strip() or SUPPORTER_PROVIDER
    with conn.cursor() as cur:
        cur.execute(
            """
INSERT INTO supporter_provider_events (
  provider,
  event_type,
  provider_event_id,
  provider_customer_id,
  provider_subscription_id,
  payload_json,
  received_at,
  processed_at,
  process_status,
  error_summary,
  related_user_id,
  mismatch_flag,
  mismatch_type,
  resolved_at,
  resolved_by_user_id,
  created_at,
  updated_at
) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
""",
            (
                provider,
                str(payload.get("event_type") or "").strip(),
                str(payload.get("provider_event_id") or "").strip() or None,
                str(payload.get("provider_customer_id") or "").strip() or None,
                str(payload.get("provider_subscription_id") or "").strip() or None,
                json.dumps(payload.get("payload") or {}, ensure_ascii=False),
                payload.get("received_at") or now,
                payload.get("processed_at"),
                str(payload.get("process_status") or "received").strip(),
                str(payload.get("error_summary") or "").strip() or None,
                payload.get("related_user_id"),
                1 if payload.get("mismatch_flag") else 0,
                str(payload.get("mismatch_type") or "").strip() or None,
                payload.get("resolved_at"),
                payload.get("resolved_by_user_id"),
                now,
                now,
            ),
        )
        event_id = cur.lastrowid
        cur.execute(
            """
SELECT
  id,
  provider,
  event_type,
  provider_event_id,
  provider_customer_id,
  provider_subscription_id,
  received_at,
  processed_at,
  process_status,
  error_summary,
  mismatch_flag,
  mismatch_type,
  resolved_at,
  resolved_by_user_id,
  created_at,
  updated_at
FROM supporter_provider_events
WHERE id=%s
LIMIT 1
""",
            (event_id,),
        )
        row = cur.fetchone()
    return _serialize_event(row) if row else None
