import { escapeHtml } from "./dom.js";
import { languageToLocaleTag } from "./settings.js";

function td(app, key, fallback) {
  return app?.i18n?.t?.(`image_detail.${key}`, fallback) || fallback;
}

function textOrDash(value) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return textOrDash(value);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1).replace(".0", "")} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1).replace(".0", "")} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / (1024 ** 3)).toFixed(1).replace(".0", "")} GB`;
  return `${(bytes / (1024 ** 4)).toFixed(1).replace(".0", "")} TB`;
}

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "-";
  return n.toLocaleString(languageToLocaleTag(document.documentElement.lang || "en-us"));
}

function formatImageSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "-";
  const locale = languageToLocaleTag(document.documentElement.lang || "en-us");
  return `${w.toLocaleString(locale)} × ${h.toLocaleString(locale)}`;
}

function normalizeColorTag(item) {
  if (!item) return null;
  if (typeof item === "string") {
    return { label: item, swatch: "" };
  }
  const label = item.label || item.name || item.hex || item.color_id || "Color";
  const swatch = item.hex || item.swatch || "";
  return { label: String(label), swatch: String(swatch) };
}

export function createImageDetailModal({
  host,
  app,
  onOpen = null,
  onClose = null,
  onLikeToggle = null,
  onPreviewOpen = null,
  onVisibilityToggle = null,
  onDeleteContent = null,
}) {
  const mobileModalMedia = window.matchMedia("(max-width: 720px)");
  const overlay = document.createElement("section");
  overlay.className = "image-detail-modal";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="image-detail-modal__backdrop"></div>
    <div class="image-detail-modal__dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(td(app, "title", "Image Details"))}" tabindex="-1">
      <div class="image-detail-modal__header">
        <h2 class="image-detail-modal__title">${escapeHtml(td(app, "title", "Image Details"))}</h2>
        <div class="image-detail-modal__header-actions">
          <button type="button" class="image-detail-modal__like" aria-label="${escapeHtml(td(app, "like", "Like"))}" aria-pressed="false">
            <span class="image-detail-modal__like-icon" aria-hidden="true">♡</span>
            <span class="image-detail-modal__like-count">0</span>
          </button>
          <button type="button" class="image-detail-modal__close" aria-label="${escapeHtml(td(app, "close", "Close details"))}">×</button>
        </div>
      </div>
      <div class="image-detail-modal__body"></div>
    </div>
  `;
  host.appendChild(overlay);

  const body = overlay.querySelector(".image-detail-modal__body");
  const closeButton = overlay.querySelector(".image-detail-modal__close");
  const likeButton = overlay.querySelector(".image-detail-modal__like");
  const likeIcon = overlay.querySelector(".image-detail-modal__like-icon");
  const likeCount = overlay.querySelector(".image-detail-modal__like-count");

  let currentDetail = null;
  let likePending = false;
  let actionPending = false;

  function syncLikeUi() {
    const detail = currentDetail || {};
    const authenticated = Boolean(app?.session?.getState?.()?.authenticated);
    const liked = Boolean(detail.viewer_liked);
    likeButton.classList.toggle("is-active", liked);
    likeButton.classList.toggle("is-pending", likePending);
    likeButton.disabled = likePending;
    likeButton.hidden = !authenticated;
    likeButton.setAttribute("aria-pressed", String(liked));
    likeButton.setAttribute("aria-label", liked ? td(app, "unlike", "Unlike") : td(app, "like", "Like"));
    likeIcon.textContent = liked ? "♥" : "♡";
    likeCount.textContent = formatCount(detail.like_count ?? 0);
  }

  function syncActionUi() {
    const canManage = Boolean(currentDetail?.viewer_permissions?.can_manage_content);
    body.querySelectorAll("[data-detail-owner-action]").forEach((button) => {
      button.hidden = !canManage;
      button.disabled = actionPending;
    });
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    if (typeof onClose === "function") {
      onClose();
    }
  }

  function renderRow(label, value) {
    return `
      <div class="image-detail-modal__row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `;
  }

  function renderTagList(items) {
    if (!items?.length) return `<div class="image-detail-modal__empty">${escapeHtml(td(app, "no_tags", "No tags."))}</div>`;
    return `<div class="image-detail-modal__chips">${items.map((item) => `<span class="image-detail-modal__chip">${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function renderColorTags(items) {
    if (!items?.length) return `<div class="image-detail-modal__empty">${escapeHtml(td(app, "no_colors", "No color tags."))}</div>`;
    return `<div class="image-detail-modal__chips image-detail-modal__chips--colors">${items.map((item) => {
      const color = normalizeColorTag(item);
      if (!color) return "";
      return `<span class="image-detail-modal__chip image-detail-modal__chip--color">${color.swatch ? `<span class="image-detail-modal__swatch" style="background:${escapeHtml(color.swatch)};"></span>` : ""}${escapeHtml(color.label)}</span>`;
    }).join("")}</div>`;
  }


  function handlePreviewOpen() {
    if (!currentDetail) {
      return;
    }
    if (typeof onPreviewOpen === "function") {
      onPreviewOpen(currentDetail);
    }
  }

  function renderPreview(detail) {
    const previewUrl = detail.original_url || detail.preview_url || "";
    if (!previewUrl) {
      return "";
    }

    const buttonAttrs = typeof onPreviewOpen === "function"
      ? ` type="button" class="image-detail-modal__preview-button" data-detail-preview-open="" aria-label="${escapeHtml(td(app, "preview_open", "Open in image modal"))}"`
      : ' type="button" class="image-detail-modal__preview-button is-static" disabled aria-hidden="true" tabindex="-1"';

    return `
      <section class="image-detail-modal__section image-detail-modal__section--preview">
        <button${buttonAttrs}>
          <span class="image-detail-modal__preview-frame">
            <span class="image-detail-modal__preview-media">
              <img class="image-detail-modal__preview-image" src="${escapeHtml(previewUrl)}" alt="${escapeHtml(detail.alt || detail.title || td(app, "preview_alt", "Image preview"))}">
            </span>
          </span>
          <span class="image-detail-modal__preview-meta">
            <span class="image-detail-modal__preview-label">${escapeHtml(td(app, "preview_label", "Image Preview"))}</span>
            <span class="image-detail-modal__preview-hint">${escapeHtml(td(app, "preview_hint", "Click to return to image view"))}</span>
          </span>
        </button>
      </section>
    `;
  }

  function render(detail) {
    const sessionData = app?.session?.getState?.()?.data || {};
    const currentUser = sessionData.user || sessionData || {};
    const isAdmin = currentUser.role === "admin";
    const user = detail.user || {};
    const adminMeta = detail.admin_meta || {};

    const previewBlock = renderPreview(detail);

    const summaryBlock = `
      <section class="image-detail-modal__section image-detail-modal__section--summary">
        <div class="image-detail-modal__summary-group image-detail-modal__summary-group--user">
          <div class="image-detail-modal__summary-label">${escapeHtml(td(app, "user_info", "User"))}</div>
          <button type="button" class="image-detail-modal__user image-detail-modal__user--compact${user.user_key ? " is-clickable" : ""}" data-user-key="${escapeHtml(user.user_key || "")}">
            ${user.avatar_url ? `<img class="image-detail-modal__avatar" src="${escapeHtml(user.avatar_url)}" alt="">` : `<div class="image-detail-modal__avatar image-detail-modal__avatar--fallback">${escapeHtml((user.display_name || "?").slice(0, 1))}</div>`}
            <div class="image-detail-modal__user-meta">
              <div class="image-detail-modal__user-name">${escapeHtml(textOrDash(user.display_name))}</div>
              <div class="image-detail-modal__user-id">@${escapeHtml(textOrDash(user.user_key))}</div>
            </div>
          </button>
        </div>
        <div class="image-detail-modal__summary-divider"></div>
        <div class="image-detail-modal__summary-group">
          <div class="image-detail-modal__summary-label">${escapeHtml(td(app, "image_title", "Title"))}</div>
          <div class="image-detail-modal__summary-value">${escapeHtml(textOrDash(detail.title))}</div>
        </div>
        <div class="image-detail-modal__summary-group">
          <div class="image-detail-modal__summary-label">${escapeHtml(td(app, "alt", "Description (ALT)"))}</div>
          <div class="image-detail-modal__summary-value image-detail-modal__summary-value--multiline">${escapeHtml(textOrDash(detail.alt))}</div>
        </div>
      </section>
    `;

    const heroBlock = previewBlock
      ? `<div class="image-detail-modal__hero">${previewBlock}${summaryBlock}</div>`
      : summaryBlock;

    const infoBlock = `
      <section class="image-detail-modal__section">
        <h3 class="image-detail-modal__section-title">${escapeHtml(td(app, "basic", "Basic Info"))}</h3>
        <dl class="image-detail-modal__list">
          ${renderRow(td(app, "posted_at", "Posted At"), formatDateTime(detail.posted_at))}
          ${renderRow(td(app, "shot_at", "Shot At"), formatDateTime(detail.shot_at))}
          ${renderRow(td(app, "file_size", "File Size"), formatBytes(detail.file_size_bytes))}
          ${renderRow(td(app, "image_size", "Image Size"), formatImageSize(detail.image_width, detail.image_height))}
          ${renderRow(td(app, "likes", "Likes"), formatCount(detail.like_count))}
          ${renderRow(td(app, "views", "Views"), formatCount(detail.view_count))}
        </dl>
      </section>
    `;

    const ownerMeta = detail.owner_meta || {};
    const isOwner = Boolean(ownerMeta.is_owner);
    const canManage = Boolean(detail.viewer_permissions?.can_manage_content);
    const visibility = ownerMeta.visibility || (adminMeta.is_public === false ? "private" : "public");
    const status = ownerMeta.status || "normal";
    const ownerBlock = isOwner
      ? `
        <section class="image-detail-modal__section">
          <h3 class="image-detail-modal__section-title">${escapeHtml(td(app, "owner_actions", "Your Content"))}</h3>
          <dl class="image-detail-modal__list">
            ${renderRow(td(app, "visibility", "Visibility"), visibility === "public" ? td(app, "public", "Public") : td(app, "private", "Private"))}
            ${renderRow(td(app, "moderation", "Moderation"), status)}
          </dl>
          <div class="image-detail-modal__owner-actions">
            <button type="button" class="image-detail-modal__owner-button" data-detail-owner-action="visibility">
              ${escapeHtml(visibility === "public" ? td(app, "make_private", "Make Private") : td(app, "make_public", "Make Public"))}
            </button>
            <button type="button" class="image-detail-modal__owner-button image-detail-modal__owner-button--danger" data-detail-owner-action="delete">
              ${escapeHtml(td(app, "delete", "Delete"))}
            </button>
          </div>
        </section>
      `
      : "";

    const tagsBlock = `
      <section class="image-detail-modal__section">
        <h3 class="image-detail-modal__section-title">${escapeHtml(td(app, "tags", "Tags"))}</h3>
        ${renderTagList(detail.tags || [])}
      </section>
    `;

    const colorsBlock = `
      <section class="image-detail-modal__section">
        <h3 class="image-detail-modal__section-title">${escapeHtml(td(app, "color_tags", "Color Tags"))}</h3>
        ${renderColorTags(detail.color_tags || [])}
      </section>
    `;

    const adminBlock = isAdmin && (adminMeta.is_public !== undefined || adminMeta.file_name || adminMeta.moderation_status)
      ? `
        <section class="image-detail-modal__section">
          <h3 class="image-detail-modal__section-title">${escapeHtml(td(app, "admin_meta", "Internal Metadata"))}</h3>
          <dl class="image-detail-modal__list">
            ${adminMeta.is_public !== undefined ? renderRow(td(app, "visibility", "Visibility"), adminMeta.is_public ? td(app, "public", "Public") : td(app, "private", "Private")) : ""}
            ${adminMeta.file_name ? renderRow(td(app, "file_name", "File Name"), adminMeta.file_name) : ""}
            ${adminMeta.moderation_status ? renderRow(td(app, "moderation", "Moderation"), adminMeta.moderation_status) : ""}
          </dl>
        </section>
      `
      : "";

    body.innerHTML = `${heroBlock}${infoBlock}${ownerBlock}${tagsBlock}${colorsBlock}${adminBlock}`;
    syncLikeUi();
    syncActionUi();
  }

  function open(detail) {
    currentDetail = detail || {};
    likePending = false;
    actionPending = false;
    render(currentDetail);
    overlay.hidden = false;
    if (typeof onOpen === "function") {
      onOpen();
    }
    overlay.querySelector(".image-detail-modal__dialog")?.focus();
  }

  function update(detail) {
    currentDetail = detail || currentDetail || {};
    if (overlay.hidden) {
      return;
    }
    render(currentDetail);
  }

  function setLikePending(pending) {
    likePending = Boolean(pending);
    if (!overlay.hidden) {
      syncLikeUi();
    }
  }

  function setActionPending(pending) {
    actionPending = Boolean(pending);
    if (!overlay.hidden) {
      syncActionUi();
    }
  }

  closeButton.addEventListener("click", close);
  likeButton.addEventListener("click", () => {
    if (typeof onLikeToggle === "function") {
      onLikeToggle();
    }
  });
  overlay.querySelector(".image-detail-modal__backdrop")?.addEventListener("click", () => {
    if (mobileModalMedia.matches) return;
    close();
  });
  body.addEventListener("click", (event) => {
    const ownerAction = event.target.closest("[data-detail-owner-action]");
    if (ownerAction) {
      const kind = ownerAction.dataset.detailOwnerAction;
      if (kind === "visibility" && typeof onVisibilityToggle === "function") {
        onVisibilityToggle();
      }
      if (kind === "delete" && typeof onDeleteContent === "function") {
        onDeleteContent();
      }
      return;
    }
    const previewBtn = event.target.closest("[data-detail-preview-open]");
    if (previewBtn) {
      handlePreviewOpen();
      return;
    }
    const userBtn = event.target.closest("[data-user-key]");
    if (userBtn) {
      const userKey = userBtn.dataset.userKey;
      if (userKey) {
        document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey } }));
      }
    }
  });

  return { open, update, close, isOpen: () => !overlay.hidden, setLikePending, setActionPending };
}
