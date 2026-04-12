"""
Badge catalog shared across admin_router, gallery_api, and auth_service.

PNG icon files should be placed in:
  www/web/assets/icons/badges/<icon_file>

Badge keys and expected icon filenames:
  year_1         → year_1.png
  year_2         → year_2.png
  year_3         → year_3.png
  year_4         → year_4.png
  year_5         → year_5.png
  role_admin     → role_admin.png
  post_first     → post_first.png
  post_50        → post_50.png
  post_100       → post_100.png
  post_500       → post_500.png
  post_1000      → post_1000.png
  pioneer        → pioneer.png
  photographer   → photographer.png
  regular        → regular.png
  notable        → notable.png
  supporter      → supporter.png
  tester         → tester.png
"""

from __future__ import annotations

# color values used as CSS class suffixes and theme references
BADGE_CATALOG: dict[str, dict] = {
    # --- Anniversary (auto) ---
    "year_1": {
        "name": "1年生",
        "description": "アカウント作成から1年以上",
        "color": "blue",
        "type": "auto",
        "icon": "year_1.png",
        "sort_order": 10,
    },
    "year_2": {
        "name": "2年生",
        "description": "アカウント作成から2年以上",
        "color": "blue",
        "type": "auto",
        "icon": "year_2.png",
        "sort_order": 11,
    },
    "year_3": {
        "name": "3年生",
        "description": "アカウント作成から3年以上",
        "color": "blue",
        "type": "auto",
        "icon": "year_3.png",
        "sort_order": 12,
    },
    "year_4": {
        "name": "4年生",
        "description": "アカウント作成から4年以上",
        "color": "blue",
        "type": "auto",
        "icon": "year_4.png",
        "sort_order": 13,
    },
    "year_5": {
        "name": "5年生",
        "description": "アカウント作成から5年以上",
        "color": "blue",
        "type": "auto",
        "icon": "year_5.png",
        "sort_order": 14,
    },
    # --- Role (auto) ---
    "role_admin": {
        "name": "管理者",
        "description": "ギャラリー管理者",
        "color": "red",
        "type": "auto",
        "icon": "role_admin.png",
        "sort_order": 1,
    },
    # --- Post count (auto) ---
    "post_first": {
        "name": "はじめの一歩",
        "description": "初めての投稿",
        "color": "green",
        "type": "auto",
        "icon": "post_first.png",
        "sort_order": 20,
    },
    "post_50": {
        "name": "50投稿",
        "description": "投稿数50件以上",
        "color": "green",
        "type": "auto",
        "icon": "post_50.png",
        "sort_order": 21,
    },
    "post_100": {
        "name": "100投稿",
        "description": "投稿数100件以上",
        "color": "green",
        "type": "auto",
        "icon": "post_100.png",
        "sort_order": 22,
    },
    "post_500": {
        "name": "500投稿",
        "description": "投稿数500件以上",
        "color": "green",
        "type": "auto",
        "icon": "post_500.png",
        "sort_order": 23,
    },
    "post_1000": {
        "name": "1000投稿",
        "description": "投稿数1000件以上",
        "color": "green",
        "type": "auto",
        "icon": "post_1000.png",
        "sort_order": 24,
    },
    # --- Manual (admin grants) ---
    "pioneer": {
        "name": "先駆者",
        "description": "初期メンバーとして特別に認定されたユーザー",
        "color": "gold",
        "type": "manual",
        "icon": "pioneer.png",
        "sort_order": 30,
    },
    "photographer": {
        "name": "写真家",
        "description": "質の高い写真を投稿すると認定されたユーザー",
        "color": "gold",
        "type": "manual",
        "icon": "photographer.png",
        "sort_order": 31,
    },
    "regular": {
        "name": "常連",
        "description": "長期にわたって活発に活動しているユーザー",
        "color": "gold",
        "type": "manual",
        "icon": "regular.png",
        "sort_order": 32,
    },
    "notable": {
        "name": "注目の人",
        "description": "コミュニティで特に注目されているユーザー",
        "color": "gold",
        "type": "manual",
        "icon": "notable.png",
        "sort_order": 33,
    },
    "star": {
        "name": "スター",
        "description": "特別な貢献をしたユーザー",
        "color": "gold",
        "type": "manual",
        "icon": None,
        "sort_order": 34,
    },
    "supporter": {
        "name": "サポーター",
        "description": "ギャラリーを支援したユーザー",
        "color": "gold",
        "type": "manual",
        "icon": "supporter.png",
        "sort_order": 35,
    },
    "tester": {
        "name": "テスター",
        "description": "機能改善に協力したユーザー",
        "color": "blue",
        "type": "manual",
        "icon": "tester.png",
        "sort_order": 36,
    },
}

# Auto-granted badge keys (by type)
AUTO_BADGE_KEYS: set[str] = {k for k, v in BADGE_CATALOG.items() if v["type"] == "auto"}

# Post count thresholds → badge_key (sorted descending for efficient check)
POST_COUNT_BADGES: list[tuple[int, str]] = sorted(
    [(1, "post_first"), (50, "post_50"), (100, "post_100"), (500, "post_500"), (1000, "post_1000")],
    key=lambda x: x[0],
)


def get_badge_def(badge_key: str) -> dict | None:
    return BADGE_CATALOG.get(badge_key)


def _parse_display_badges_py(raw) -> list[str]:
    """Parse display_badges JSON column value to a list of valid badge keys."""
    import json as _json
    if isinstance(raw, list):
        return [str(k) for k in raw if k in BADGE_CATALOG][:3]
    if isinstance(raw, str):
        try:
            parsed = _json.loads(raw)
            if isinstance(parsed, list):
                return [str(k) for k in parsed if k in BADGE_CATALOG][:3]
        except Exception:
            pass
    return []


def ensure_auto_badges(conn, user_id: int, user_role: str | None, created_at) -> None:
    """
    Auto-grant year/role badges based on account age and role.
    Safe to call on every session load — uses INSERT IGNORE.
    """
    try:
        with conn.cursor() as cur:
            cur.execute("SHOW TABLES LIKE 'user_badges'")
            if not cur.fetchone():
                return
    except Exception:
        return

    from datetime import datetime, timezone

    badges_to_grant: list[str] = []

    # Role badge
    if str(user_role or "") == "admin":
        badges_to_grant.append("role_admin")

    # Anniversary badges
    if created_at is not None:
        try:
            if isinstance(created_at, datetime):
                created_dt = created_at.replace(tzinfo=timezone.utc) if created_at.tzinfo is None else created_at
            else:
                from datetime import datetime as _dt
                created_dt = _dt.fromisoformat(str(created_at).replace("Z", "+00:00"))
            now_dt = datetime.now(timezone.utc)
            years = (now_dt - created_dt).days // 365
            if years >= 5:
                badges_to_grant += ["year_1", "year_2", "year_3", "year_4", "year_5"]
            elif years >= 4:
                badges_to_grant += ["year_1", "year_2", "year_3", "year_4"]
            elif years >= 3:
                badges_to_grant += ["year_1", "year_2", "year_3"]
            elif years >= 2:
                badges_to_grant += ["year_1", "year_2"]
            elif years >= 1:
                badges_to_grant.append("year_1")
        except Exception:
            pass

    if not badges_to_grant:
        return

    try:
        for badge_key in badges_to_grant:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT IGNORE INTO user_badges (user_id, badge_key, granted_by) VALUES (%s, %s, NULL)",
                    (user_id, badge_key),
                )
    except Exception:
        pass


def serialize_badge(badge_key: str, granted_at: str | None = None, granted_by: int | None = None) -> dict:
    defn = BADGE_CATALOG.get(badge_key) or {}
    return {
        "key": badge_key,
        "name": defn.get("name", badge_key),
        "description": defn.get("description", ""),
        "color": defn.get("color", "gray"),
        "type": defn.get("type", "manual"),
        "icon": defn.get("icon"),
        "granted_at": granted_at,
        "granted_by_admin": granted_by is not None,
    }


def list_catalog() -> list[dict]:
    return [
        {
            "key": k,
            "name": v["name"],
            "description": v["description"],
            "color": v["color"],
            "type": v["type"],
            "icon": v["icon"],
        }
        for k, v in sorted(BADGE_CATALOG.items(), key=lambda x: x[1]["sort_order"])
    ]
