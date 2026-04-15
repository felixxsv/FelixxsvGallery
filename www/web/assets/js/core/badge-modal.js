import { byId } from "./dom.js";
import { resolveBadgeText } from "./badge-i18n.js";

const BADGE_DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='6'/%3E%3Cpath d='M8 14l-3 7 7-3 7 3-3-7'/%3E%3C/svg%3E";

export function showBadgeDetail(badge, app) {
  const iconEl = byId("badgeDetailIcon");
  const nameEl = byId("badgeDetailName");
  const descEl = byId("badgeDetailDescription");
  if (!iconEl || !nameEl) return;

  const name = resolveBadgeText(app.i18n, badge, "name") || badge.name || badge.key || "";
  const desc = resolveBadgeText(app.i18n, badge, "description") || badge.description || "";
  const icon = badge.icon ? String(badge.icon).replace(/^badge_/, "").replace(/\.svg$/i, ".png") : null;
  const src = icon
    ? `${app.appBase}/assets/icons/badges/${icon}?v=20260413-crop`
    : (window._BADGE_DEFAULT_ICON || BADGE_DEFAULT_ICON);

  iconEl.innerHTML = `<img src="${src.replace(/"/g, "&quot;")}" alt="" aria-hidden="true" onerror="this.onerror=null;this.src=window._BADGE_DEFAULT_ICON">`;
  nameEl.textContent = name;
  if (descEl) {
    descEl.textContent = desc;
    descEl.hidden = !desc;
  }

  app.modal.open("badge-detail");
}
