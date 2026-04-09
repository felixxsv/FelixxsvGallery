export function resolveBadgeText(i18n, badge, field = "name") {
  const key = String(badge?.key || "").trim();
  const fallback = String(badge?.[field] || badge?.name || badge?.key || "").trim();
  if (!key) {
    return fallback;
  }
  return i18n?.t?.(`badges.${key}.${field}`, fallback) || fallback;
}
