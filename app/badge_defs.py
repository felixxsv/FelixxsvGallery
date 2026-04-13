"""
Badge catalog helpers shared across admin_router, gallery_api, and auth_service.

Runtime behavior:
- Prefer the `badges` master table when it exists.
- Fall back to the in-code defaults below when the table is absent.
"""

from __future__ import annotations

import json as _json


DEFAULT_BADGE_CATALOG: dict[str, dict] = {
    "year_1": {
        "name": "1年生",
        "description": "アカウント作成から1年以上",
        "acquisition": "アカウント作成から1年以上経過する",
        "color": "blue",
        "type": "auto",
        "icon": "year_1.png",
        "sort_order": 10,
        "auto_grant_kind": "account_age_years",
        "auto_grant_value": 1,
    },
    "year_2": {
        "name": "2年生",
        "description": "アカウント作成から2年以上",
        "acquisition": "アカウント作成から2年以上経過する",
        "color": "blue",
        "type": "auto",
        "icon": "year_2.png",
        "sort_order": 11,
        "auto_grant_kind": "account_age_years",
        "auto_grant_value": 2,
    },
    "year_3": {
        "name": "3年生",
        "description": "アカウント作成から3年以上",
        "acquisition": "アカウント作成から3年以上経過する",
        "color": "blue",
        "type": "auto",
        "icon": "year_3.png",
        "sort_order": 12,
        "auto_grant_kind": "account_age_years",
        "auto_grant_value": 3,
    },
    "year_4": {
        "name": "4年生",
        "description": "アカウント作成から4年以上",
        "acquisition": "アカウント作成から4年以上経過する",
        "color": "blue",
        "type": "auto",
        "icon": "year_4.png",
        "sort_order": 13,
        "auto_grant_kind": "account_age_years",
        "auto_grant_value": 4,
    },
    "year_5": {
        "name": "5年生",
        "description": "アカウント作成から5年以上",
        "acquisition": "アカウント作成から5年以上経過する",
        "color": "blue",
        "type": "auto",
        "icon": "year_5.png",
        "sort_order": 14,
        "auto_grant_kind": "account_age_years",
        "auto_grant_value": 5,
    },
    "role_admin": {
        "name": "管理者",
        "description": "ギャラリー管理者",
        "acquisition": "管理者権限を持つ",
        "color": "red",
        "type": "auto",
        "icon": "role_admin.png",
        "sort_order": 1,
        "auto_grant_kind": "role",
        "auto_grant_value": None,
    },
    "post_first": {
        "name": "はじめの一歩",
        "description": "初めての投稿",
        "acquisition": "1件以上投稿する",
        "color": "green",
        "type": "auto",
        "icon": "post_first.png",
        "sort_order": 20,
        "auto_grant_kind": "post_count",
        "auto_grant_value": 1,
    },
    "post_50": {
        "name": "50投稿",
        "description": "投稿数50件以上",
        "acquisition": "50件以上投稿する",
        "color": "green",
        "type": "auto",
        "icon": "post_50.png",
        "sort_order": 21,
        "auto_grant_kind": "post_count",
        "auto_grant_value": 50,
    },
    "post_100": {
        "name": "100投稿",
        "description": "投稿数100件以上",
        "acquisition": "100件以上投稿する",
        "color": "green",
        "type": "auto",
        "icon": "post_100.png",
        "sort_order": 22,
        "auto_grant_kind": "post_count",
        "auto_grant_value": 100,
    },
    "post_500": {
        "name": "500投稿",
        "description": "投稿数500件以上",
        "acquisition": "500件以上投稿する",
        "color": "green",
        "type": "auto",
        "icon": "post_500.png",
        "sort_order": 23,
        "auto_grant_kind": "post_count",
        "auto_grant_value": 500,
    },
    "post_1000": {
        "name": "1000投稿",
        "description": "投稿数1000件以上",
        "acquisition": "1000件以上投稿する",
        "color": "green",
        "type": "auto",
        "icon": "post_1000.png",
        "sort_order": 24,
        "auto_grant_kind": "post_count",
        "auto_grant_value": 1000,
    },
    "pioneer": {
        "name": "先駆者",
        "description": "初期メンバーとして特別に認定されたユーザー",
        "acquisition": "管理者から付与される",
        "color": "gold",
        "type": "manual",
        "icon": "pioneer.png",
        "sort_order": 30,
        "auto_grant_kind": "none",
        "auto_grant_value": None,
    },
    "photographer": {
        "name": "写真家",
        "description": "質の高い写真を投稿すると認定されたユーザー",
        "acquisition": "管理者から付与される",
        "color": "gold",
        "type": "manual",
        "icon": "photographer.png",
        "sort_order": 31,
        "auto_grant_kind": "none",
        "auto_grant_value": None,
    },
    "regular": {
        "name": "常連",
        "description": "長期にわたって活発に活動しているユーザー",
        "acquisition": "管理者から付与される",
        "color": "gold",
        "type": "manual",
        "icon": "regular.png",
        "sort_order": 32,
        "auto_grant_kind": "none",
        "auto_grant_value": None,
    },
    "notable": {
        "name": "注目の人",
        "description": "コミュニティで特に注目されているユーザー",
        "acquisition": "管理者から付与される",
        "color": "gold",
        "type": "manual",
        "icon": "notable.png",
        "sort_order": 33,
        "auto_grant_kind": "none",
        "auto_grant_value": None,
    },
    "supporter": {
        "name": "サポーター",
        "description": "ギャラリーを支援したユーザー",
        "acquisition": "管理者から付与される",
        "color": "gold",
        "type": "manual",
        "icon": "supporter.png",
        "sort_order": 34,
        "auto_grant_kind": "none",
        "auto_grant_value": None,
    },
    "tester": {
        "name": "テスター",
        "description": "機能改善に協力したユーザー",
        "acquisition": "管理者から付与される",
        "color": "blue",
        "type": "manual",
        "icon": "tester.png",
        "sort_order": 35,
        "auto_grant_kind": "none",
        "auto_grant_value": None,
    },
}

BADGE_CATALOG: dict[str, dict] = DEFAULT_BADGE_CATALOG
AUTO_BADGE_KEYS: set[str] = {k for k, v in DEFAULT_BADGE_CATALOG.items() if v["type"] == "auto"}
POST_COUNT_BADGES: list[tuple[int, str]] = sorted(
    [
        (int(v["auto_grant_value"]), k)
        for k, v in DEFAULT_BADGE_CATALOG.items()
        if v.get("auto_grant_kind") == "post_count" and v.get("auto_grant_value") is not None
    ],
    key=lambda x: x[0],
)


def _has_badges_table(conn) -> bool:
    try:
        with conn.cursor() as cur:
            cur.execute("SHOW TABLES LIKE 'badges'")
            return bool(cur.fetchone())
    except Exception:
        return False


def _row_to_badge_def(row: dict) -> dict:
    return {
        "name": row.get("name") or row.get("badge_key") or "",
        "description": row.get("description") or "",
        "acquisition": row.get("acquisition") or "",
        "color": row.get("color") or "gray",
        "type": row.get("badge_type") or row.get("type") or "manual",
        "icon": row.get("icon"),
        "sort_order": int(row.get("sort_order") or 0),
        "auto_grant_kind": row.get("auto_grant_kind") or "none",
        "auto_grant_value": row.get("auto_grant_value"),
        "is_active": bool(row.get("is_active", True)),
    }


def load_badge_catalog(conn=None) -> dict[str, dict]:
    if conn is None or not _has_badges_table(conn):
        return {k: dict(v) for k, v in DEFAULT_BADGE_CATALOG.items()}
    with conn.cursor() as cur:
        cur.execute(
            """
SELECT
    badge_key,
    name,
    description,
    acquisition,
    color,
    badge_type,
    icon,
    sort_order,
    auto_grant_kind,
    auto_grant_value,
    is_active
FROM badges
WHERE is_active = 1
ORDER BY sort_order ASC, badge_key ASC
"""
        )
        rows = cur.fetchall() or []
    if not rows:
        return {k: dict(v) for k, v in DEFAULT_BADGE_CATALOG.items()}
    return {str(row["badge_key"]): _row_to_badge_def(row) for row in rows}


def list_badge_keys(conn=None) -> list[str]:
    return list(load_badge_catalog(conn).keys())


def get_badge_def(badge_key: str, conn=None) -> dict | None:
    return load_badge_catalog(conn).get(badge_key)


def _parse_display_badges_py(raw, conn=None) -> list[str]:
    valid_keys = set(list_badge_keys(conn))
    if isinstance(raw, list):
        return [str(k) for k in raw if str(k) in valid_keys][:3]
    if isinstance(raw, str):
        try:
            parsed = _json.loads(raw)
            if isinstance(parsed, list):
                return [str(k) for k in parsed if str(k) in valid_keys][:3]
        except Exception:
            pass
    return []


def get_auto_badge_keys(conn=None) -> set[str]:
    return {
        key
        for key, value in load_badge_catalog(conn).items()
        if str(value.get("type") or "manual") == "auto"
    }


def get_post_count_badges(conn=None) -> list[tuple[int, str]]:
    items: list[tuple[int, str]] = []
    for key, value in load_badge_catalog(conn).items():
        if str(value.get("auto_grant_kind") or "none") != "post_count":
            continue
        try:
            threshold = int(value.get("auto_grant_value"))
        except Exception:
            continue
        items.append((threshold, key))
    return sorted(items, key=lambda x: x[0])


def ensure_auto_badges(conn, user_id: int, user_role: str | None, created_at) -> None:
    try:
        with conn.cursor() as cur:
            cur.execute("SHOW TABLES LIKE 'user_badges'")
            if not cur.fetchone():
                return
    except Exception:
        return

    from datetime import datetime, timezone

    catalog = load_badge_catalog(conn)
    badges_to_grant: list[str] = []

    if str(user_role or "") == "admin":
        for key, value in catalog.items():
            if value.get("auto_grant_kind") == "role":
                badges_to_grant.append(key)

    if created_at is not None:
        try:
            if isinstance(created_at, datetime):
                created_dt = created_at.replace(tzinfo=timezone.utc) if created_at.tzinfo is None else created_at
            else:
                from datetime import datetime as _dt
                created_dt = _dt.fromisoformat(str(created_at).replace("Z", "+00:00"))
            now_dt = datetime.now(timezone.utc)
            years = (now_dt - created_dt).days // 365
            for key, value in catalog.items():
                if value.get("auto_grant_kind") != "account_age_years":
                    continue
                try:
                    threshold = int(value.get("auto_grant_value"))
                except Exception:
                    continue
                if years >= threshold:
                    badges_to_grant.append(key)
        except Exception:
            pass

    if not badges_to_grant:
        return

    try:
        for badge_key in sorted(set(badges_to_grant)):
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT IGNORE INTO user_badges (user_id, badge_key, granted_by) VALUES (%s, %s, NULL)",
                    (user_id, badge_key),
                )
    except Exception:
        pass


def serialize_badge(badge_key: str, granted_at: str | None = None, granted_by: int | None = None, conn=None) -> dict:
    defn = get_badge_def(badge_key, conn) or {}
    return {
        "key": badge_key,
        "name": defn.get("name", badge_key),
        "description": defn.get("description", ""),
        "acquisition": defn.get("acquisition", ""),
        "color": defn.get("color", "gray"),
        "type": defn.get("type", "manual"),
        "icon": defn.get("icon"),
        "granted_at": granted_at,
        "granted_by_admin": granted_by is not None,
    }


def list_catalog(conn=None) -> list[dict]:
    return [
        {
            "key": key,
            "name": value.get("name", key),
            "description": value.get("description", ""),
            "acquisition": value.get("acquisition", ""),
            "color": value.get("color", "gray"),
            "type": value.get("type", "manual"),
            "icon": value.get("icon"),
        }
        for key, value in sorted(load_badge_catalog(conn).items(), key=lambda item: int(item[1].get("sort_order") or 0))
    ]
