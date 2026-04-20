import { byId } from "./dom.js";
import { resolveBadgeText } from "./badge-i18n.js";

const BADGE_DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='6'/%3E%3Cpath d='M8 14l-3 7 7-3 7 3-3-7'/%3E%3C/svg%3E";
let currentAvatarPayload = null;
let currentBadgePayload = null;
let supportPresentationListenerBound = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureLayer(app, id, titleId, titleText, bodyHtml) {
  if (document.querySelector(`[data-modal-id='${id}']`)) return;
  const root = byId("appModalRoot");
  if (!root) return;
  const section = document.createElement("section");
  section.className = "app-modal-layer";
  section.dataset.modalLayer = "";
  section.dataset.modalId = id;
  section.hidden = true;
  section.innerHTML = `
    <div class="app-modal-backdrop" data-modal-backdrop="${id}"></div>
    <div class="app-modal-dialog profile-media-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
      <div class="app-modal-header">
        <h2 id="${titleId}" class="app-modal-title">${escapeHtml(titleText)}</h2>
      </div>
      <div class="app-modal-body">
        ${bodyHtml}
      </div>
    </div>
  `;
  root.appendChild(section);
  app.modal?.refresh?.();
}

export function ensureProfileMediaModals(app) {
  ensureLayer(
    app,
    "avatar-detail",
    "avatarDetailTitle",
    app.i18n?.t?.("shell.static.avatar_preview", "Avatar") || "Avatar",
    `
      <div class="profile-media-modal__avatar" id="avatarDetailVisual"></div>
      <div class="profile-media-modal__primary" id="avatarDetailName">-</div>
      <div class="profile-media-modal__secondary" id="avatarDetailUserKey">-</div>
    `,
  );
  ensureLayer(
    app,
    "badge-detail",
    "badgeDetailTitle",
    app.i18n?.t?.("shell.static.badge_preview", "Badge") || "Badge",
    `
      <div class="profile-media-modal__badge" id="badgeDetailVisual"></div>
      <div class="profile-media-modal__primary profile-media-modal__primary--normal" id="badgeDetailName">-</div>
      <div class="profile-media-modal__secondary" id="badgeDetailAcquisition">-</div>
    `,
  );
  if (!supportPresentationListenerBound) {
    document.addEventListener("app:support-presentation-updated", (event) => {
      const userKey = String(event.detail?.userKey || "").trim();
      if (!currentAvatarPayload || !userKey) return;
      const currentUserKey = String(currentAvatarPayload.userKey || "").replace(/^@/, "").trim();
      if (currentUserKey !== userKey) return;
      currentAvatarPayload = {
        ...currentAvatarPayload,
        selectedIconFrame: event.detail?.publicProfile?.selected_icon_frame || null,
        selectedIconFrameAssetPath: event.detail?.publicProfile?.selected_icon_frame_asset_path || null,
      };
      if (!document.querySelector("[data-modal-id='avatar-detail']")?.hidden) {
        showAvatarDetail(currentAvatarPayload, app);
      }
    });
    supportPresentationListenerBound = true;
  }
}

export function refreshProfileMediaModalTexts(app) {
  const avatarTitle = byId("avatarDetailTitle");
  if (avatarTitle) avatarTitle.textContent = app.i18n?.t?.("shell.static.avatar_preview", "Avatar") || "Avatar";
  const badgeTitle = byId("badgeDetailTitle");
  if (badgeTitle) badgeTitle.textContent = app.i18n?.t?.("shell.static.badge_preview", "Badge") || "Badge";
  if (currentAvatarPayload && !document.querySelector("[data-modal-id='avatar-detail']")?.hidden) {
    showAvatarDetail(currentAvatarPayload, app);
  }
  if (currentBadgePayload && !document.querySelector("[data-modal-id='badge-detail']")?.hidden) {
    showBadgeDetail(currentBadgePayload, app);
  }
}

export function showAvatarDetail(payload, app) {
  ensureProfileMediaModals(app);
  currentAvatarPayload = payload || null;
  const visual = byId("avatarDetailVisual");
  const nameEl = byId("avatarDetailName");
  const userKeyEl = byId("avatarDetailUserKey");
  if (!visual || !nameEl || !userKeyEl) return;

  const name = String(payload?.displayName || "-");
  const userKey = String(payload?.userKey || "-");
  const avatarUrl = String(payload?.avatarUrl || "");
  const initial = String(payload?.initial || name || userKey || "?").trim().slice(0, 1).toUpperCase() || "?";
  visual.className = "profile-media-modal__avatar";
  if (avatarUrl) {
    visual.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="" aria-hidden="true">`;
  } else {
    visual.innerHTML = `<span class="profile-media-modal__initial">${escapeHtml(initial)}</span>`;
  }
  const frameAsset = String(payload?.selectedIconFrameAssetPath || "").trim();
  let frameOverlay = visual.querySelector(".avatar-frame-overlay");
  if (frameAsset) {
    if (!frameOverlay) {
      frameOverlay = document.createElement("img");
      frameOverlay.className = "avatar-frame-overlay";
      frameOverlay.alt = "";
      frameOverlay.setAttribute("aria-hidden", "true");
      visual.appendChild(frameOverlay);
    }
    frameOverlay.src = `/storage/${frameAsset}`;
  } else {
    frameOverlay?.remove();
  }
  nameEl.textContent = name;
  userKeyEl.textContent = userKey.startsWith("@") ? userKey : `@${userKey}`;
  app.modal.open("avatar-detail");
}

export function showBadgeDetail(badge, app) {
  ensureProfileMediaModals(app);
  currentBadgePayload = badge || null;
  const visual = byId("badgeDetailVisual");
  const nameEl = byId("badgeDetailName");
  const acquisitionEl = byId("badgeDetailAcquisition");
  if (!visual || !nameEl || !acquisitionEl) return;

  const icon = badge?.icon ? String(badge.icon).replace(/^badge_/, "").replace(/\.svg$/i, ".png") : "";
  const iconUrl = icon ? `${app.appBase}/assets/icons/badges/${icon}?v=20260413-crop` : BADGE_DEFAULT_ICON;
  const name = resolveBadgeText(app.i18n, badge, "name") || badge?.name || badge?.key || "";
  const acquisition = app.i18n?.t?.(`badges.${String(badge?.key || "").trim()}.acquisition`, "")
    || resolveBadgeText(app.i18n, badge, "description")
    || badge?.acquisition
    || badge?.description
    || "";

  visual.className = "profile-media-modal__badge";
  visual.innerHTML = `<img src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true" onerror="this.onerror=null;this.src=window._BADGE_DEFAULT_ICON">`;
  nameEl.textContent = name;
  acquisitionEl.textContent = acquisition;
  app.modal.open("badge-detail");
}
