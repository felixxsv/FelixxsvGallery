import { createImageDetailModal } from "./image-detail-modal.js";
import { escapeHtml } from "./dom.js";

const STYLE_ID = "felixxsv-image-modal-style";
const BODY_SCROLL_LOCK_KEY = "__felixxsvBodyScrollLock";

function t(app, key, fallback) {
  return app?.i18n?.t?.(`image_modal.${key}`, fallback) || fallback;
}

function td(app, key, fallback) {
  return app?.i18n?.t?.(`image_detail.${key}`, fallback) || fallback;
}

function openSharedConfirm(app, { message, approveText, danger = false } = {}) {
  const modalRoot = document.getElementById("appModalRoot");
  const messageNode = document.getElementById("shellTwoFactorActionConfirmMessage");
  const approveButton = document.getElementById("shellTwoFactorActionConfirmApproveButton");
  if (!modalRoot || !messageNode || !approveButton || !app?.modal?.open || !app?.modal?.close) {
    return Promise.resolve(window.confirm(String(message || "")));
  }

  messageNode.textContent = String(message || "");
  approveButton.textContent = String(approveText || td(app, "confirm_approve", "Confirm"));
  approveButton.classList.toggle("app-button--danger", Boolean(danger));

  return new Promise((resolve) => {
    let settled = false;
    let approving = false;

    const cleanup = () => {
      approveButton.classList.remove("app-button--danger");
      approveButton.removeEventListener("click", handleApprove);
      modalRoot.removeEventListener("app:modal-close", handleClose);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Boolean(result));
    };

    const handleApprove = () => {
      approving = true;
      finish(true);
    };

    const handleClose = (event) => {
      if (event.detail?.id !== "twofactor-action-confirm") {
        return;
      }
      if (approving) {
        return;
      }
      finish(false);
    };

    approveButton.addEventListener("click", handleApprove, { capture: true });
    modalRoot.addEventListener("app:modal-close", handleClose);
    app.modal.open("twofactor-action-confirm");
  });
}

function ensureStylesheet(appBase) {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = `${appBase}/assets/css/components/image-modal.css`;
  document.head.appendChild(link);
}

function getBodyScrollLockState() {
  if (!window[BODY_SCROLL_LOCK_KEY]) {
    window[BODY_SCROLL_LOCK_KEY] = { count: 0, scrollY: 0 };
  }
  return window[BODY_SCROLL_LOCK_KEY];
}

function lockBodyScroll(body) {
  const state = getBodyScrollLockState();
  if (state.count === 0) {
    state.scrollY = window.scrollY || window.pageYOffset || 0;
    body.style.position = "fixed";
    body.style.top = `-${state.scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
  }
  state.count += 1;
}

function unlockBodyScroll(body) {
  const state = getBodyScrollLockState();
  if (state.count === 0) return;
  state.count -= 1;
  if (state.count > 0) return;
  const scrollY = state.scrollY || 0;
  body.style.position = "";
  body.style.top = "";
  body.style.left = "";
  body.style.right = "";
  body.style.width = "";
  body.style.overflow = "";
  window.scrollTo(0, scrollY);
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

function formatCompactCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(".0", "")}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(".0", "")}M`;
  return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1).replace(".0", "")}B`;
}

function normalizeUserKey(value) {
  const userKey = typeof value === "string" ? value.trim() : "";
  return userKey && userKey !== "-" ? userKey : "";
}

function normalizeLikeCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function withAppBase(path) {
  const appBase = document.body.dataset.appBase || "";
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/")) return path;
  if (path.startsWith("storage/") || path.startsWith("media/") || path.startsWith("api/")) return `${appBase}/${path}`;
  return `${appBase}/storage/${path.replace(/^\/+/, "")}`;
}

function normalizePayload(item, options = {}) {
  const normalized = { ...(item || {}) };
  normalized.image_id = item?.image_id ?? item?.id ?? null;
  const app = window.App || window.AdminApp || null;
  normalized.title = item?.title || item?.alt || t(app, "untitled", "Untitled");
  normalized.alt = item?.alt ?? "";
  normalized.preview_url = withAppBase(
    item?.preview_url ||
      item?.original_url ||
      item?.preview_path ||
      item?.thumb_path_960 ||
      item?.thumb_path_480 ||
      item?.thumb_path ||
      item?.image_url ||
      item?.url ||
      (normalized.image_id ? (item?.access_token ? `/img/${item.access_token}` : `/media/original/${normalized.image_id}`) : "")
  );
  normalized.original_url = withAppBase(
    item?.original_url || item?.image_url || item?.url || (item?.access_token ? `/view/${item.access_token}` : "")
  );
  normalized.posted_at = item?.posted_at || item?.created_at || item?.shot_at || null;
  normalized.shot_at = item?.shot_at || null;
  normalized.like_count = normalizeLikeCount(item?.like_count || 0);
  normalized.viewer_liked = Boolean(item?.viewer_liked);
  normalized.view_count = Number(item?.view_count || 0);
  const supporterProfile = item?.user?.supporter_profile || item?.supporter_profile || {};
  normalized.user = item?.user || {
    display_name: item?.uploader_display_name || item?.display_name || t(app, "unknown_user", "Unknown uploader"),
    user_key: normalizeUserKey(item?.uploader_user_key || item?.user_key),
    avatar_url: withAppBase(item?.uploader_avatar_url || item?.uploader_avatar_path || item?.avatar_url || ""),
    supporter_profile: supporterProfile,
  };
  if (normalized.user && !normalized.user.supporter_profile) {
    normalized.user.supporter_profile = supporterProfile;
  }
  normalized.tags = Array.isArray(item?.tags) ? item.tags : [];
  normalized.color_tags = Array.isArray(item?.color_tags) ? item.color_tags : [];
  normalized.file_size_bytes = item?.file_size_bytes ?? null;
  normalized.image_width = item?.image_width ?? item?.width ?? null;
  normalized.image_height = item?.image_height ?? item?.height ?? null;
  normalized.admin_meta = item?.admin_meta || {};
  normalized.viewer_permissions = item?.viewer_permissions || null;
  normalized.owner_meta = item?.owner_meta || null;
  normalized.content_id = item?.content_id || normalized.content_id || null;
  normalized.detailLoader = options.detailLoader || item?.detailLoader || null;
  return normalized;
}

function normalizeItems(payload, options = {}) {
  const rawItems = Array.isArray(options.items)
    ? options.items
    : Array.isArray(payload?.images)
      ? payload.images
      : Array.isArray(payload?.items)
        ? payload.items
        : [payload];
  return rawItems.map((item) => normalizePayload(item, { detailLoader: item?.detailLoader || options.detailLoader || payload?.detailLoader }));
}

export function createImageModalController({ app, body = document.body } = {}) {
  ensureStylesheet(app.appBase);
  const mobileImageMedia = window.matchMedia("(max-width: 720px)");
  const globalCloseButton = document.getElementById("appGlobalClose");
  let globalCloseHideTimer = null;

  const root = document.createElement("section");
  root.className = "image-modal";
  root.hidden = true;
  root.innerHTML = `
    <div class="image-modal__backdrop"></div>
    <div class="image-modal__viewport" tabindex="-1">
      <button type="button" class="image-modal__close" aria-label="${escapeHtml(t(app, "close", "Close"))}">×</button>
      <button type="button" class="image-modal__nav image-modal__nav--prev" data-action="prev" aria-label="${escapeHtml(t(app, "prev", "Previous image"))}">‹</button>
      <button type="button" class="image-modal__nav image-modal__nav--next" data-action="next" aria-label="${escapeHtml(t(app, "next", "Next image"))}">›</button>
      <div class="image-modal__stage">
        <img class="image-modal__image" alt="" draggable="false">
      </div>
      <div class="image-modal__slider-wrap" hidden>
        <input class="image-modal__slider" type="range" min="100" max="300" step="10" value="100" aria-label="${escapeHtml(t(app, "zoom", "Zoom"))}">
      </div>
      <div class="image-modal__footer">
        <div class="image-modal__meta">
          <div class="image-modal__title">-</div>
          <div class="image-modal__submeta">
            <span class="image-modal__posted-at">-</span>
            <span class="image-modal__pager" hidden>
              <span class="image-modal__pager-current">1</span>
              <span class="image-modal__pager-separator">/</span>
              <span class="image-modal__pager-total">1</span>
            </span>
            <span class="image-modal__user">
              <span class="image-modal__user-avatar"></span>
              <span class="image-modal__user-text">-</span>
            </span>
          </div>
        </div>
        <div class="image-modal__actions">
          <button type="button" class="image-modal__action image-modal__action--like" data-action="like" aria-label="${escapeHtml(t(app, "like", "Like"))}" aria-pressed="false">♡</button>
          <span class="image-modal__stat"><span class="image-modal__like-count">0</span></span>
          <button type="button" class="image-modal__action image-modal__action--ghost" data-action="new-tab" aria-label="${escapeHtml(t(app, "new_tab", "Open in new tab"))}">↗</button>
          <button type="button" class="image-modal__action image-modal__action--ghost" data-action="detail" aria-label="${escapeHtml(t(app, "detail", "Details"))}">…</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const viewport = root.querySelector(".image-modal__viewport");
  const stage = root.querySelector(".image-modal__stage");
  const image = root.querySelector(".image-modal__image");
  const closeButton = root.querySelector(".image-modal__close");
  const prevButton = root.querySelector("[data-action='prev']");
  const nextButton = root.querySelector("[data-action='next']");
  const sliderWrap = root.querySelector(".image-modal__slider-wrap");
  const slider = root.querySelector(".image-modal__slider");
  const titleNode = root.querySelector(".image-modal__title");
  const postedAtNode = root.querySelector(".image-modal__posted-at");
  const pagerNode = root.querySelector(".image-modal__pager");
  const pagerCurrentNode = root.querySelector(".image-modal__pager-current");
  const pagerTotalNode = root.querySelector(".image-modal__pager-total");
  const userAvatarNode = root.querySelector(".image-modal__user-avatar");
  const userTextNode = root.querySelector(".image-modal__user-text");
  const likeButton = root.querySelector("[data-action='like']");
  const likeCountNode = root.querySelector(".image-modal__like-count");

  const state = {
    items: [],
    current: null,
    currentIndex: 0,
    detailCache: null,
    detailOpen: false,
    onLikeChange: null,
    onOwnerAction: null,
    likePending: false,
    ownerActionPending: false,
    zoom: 100,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    hideTimer: null,
    controlsVisible: true,
    cursorVisible: true,
    touchStartX: 0,
    touchStartY: 0,
    touchDeltaX: 0,
    touchDeltaY: 0,
    touchTracking: false,
  };

  function syncDetailStateClass() {
    root.classList.toggle("is-detail-open", state.detailOpen);
  }

  const detailModal = createImageDetailModal({
    host: viewport,
    app,
    onLikeToggle() {
      toggleLike();
    },
    onOpen() {
      state.detailOpen = true;
      syncDetailStateClass();
      updateControlsVisibility(true);
    },
    onClose() {
      state.detailOpen = false;
      syncDetailStateClass();
      updateControlsVisibility(true);
      if (root.classList.contains("is-detail-standalone")) {
        root.classList.remove("is-detail-standalone");
        root.hidden = true;
        bodyLock(false);
        state.items = [];
        state.currentIndex = 0;
        state.onLikeChange = null;
        state.detailCache = null;
        syncGlobalCloseVisibility();
      }
    },
    onPreviewOpen() {
      if (root.classList.contains("is-detail-standalone")) {
        // Transition: standalone detail → full image viewer
        root.classList.remove("is-detail-standalone");
        // onClose will fire next, but is-detail-standalone is gone so cleanup is skipped
        detailModal.close();
        renderCurrentItem();
        updateControlsVisibility(true);
        viewport.focus?.();
      } else {
        detailModal.close();
        updateControlsVisibility(true);
        viewport.focus?.();
      }
    },
    onVisibilityToggle() {
      toggleOwnedContentVisibility();
    },
    onDeleteContent() {
      deleteOwnedContent();
    },
  });

  function syncGlobalCloseVisibility() {
    if (!globalCloseButton) return;
    const setVisible = (visible) => {
      if (globalCloseHideTimer !== null) {
        window.clearTimeout(globalCloseHideTimer);
        globalCloseHideTimer = null;
      }
      if (visible) {
        globalCloseButton.hidden = false;
        globalCloseButton.setAttribute("aria-hidden", "false");
        requestAnimationFrame(() => {
          globalCloseButton.classList.add("is-visible");
        });
        return;
      }
      globalCloseButton.classList.remove("is-visible");
      globalCloseButton.setAttribute("aria-hidden", "true");
      globalCloseHideTimer = window.setTimeout(() => {
        const modalStack = app?.modal?.getStack?.() || [];
        if (root.hidden && (!Array.isArray(modalStack) || modalStack.length === 0)) {
          globalCloseButton.hidden = true;
        }
        globalCloseHideTimer = null;
      }, 180);
    };

    if (!root.hidden && !mobileImageMedia.matches) {
      const visible = Boolean(state.controlsVisible || state.detailOpen);
      setVisible(visible);
      return;
    }
    const modalStack = app?.modal?.getStack?.() || [];
    const shouldShowForAppModal = Array.isArray(modalStack) && modalStack.length > 0 && !mobileImageMedia.matches;
    setVisible(shouldShowForAppModal);
  }

  function currentItem() {
    return state.items[state.currentIndex] || state.current || null;
  }

  function syncPagerUi() {
    const total = state.items.length;
    const multi = total > 1;
    const isFirst = state.currentIndex <= 0;
    const isLast = state.currentIndex >= total - 1;
    pagerNode.hidden = !multi;
    prevButton.hidden = !multi || isFirst;
    nextButton.hidden = !multi || isLast;
    prevButton.disabled = !multi || isFirst;
    nextButton.disabled = !multi || isLast;
    pagerCurrentNode.textContent = String(Math.min(total, state.currentIndex + 1));
    pagerTotalNode.textContent = String(total || 1);
  }

  function applyTransform() {
    image.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px) scale(${state.zoom / 100})`;
    slider.value = String(state.zoom);
    sliderWrap.hidden = state.zoom <= 100;
    stage.classList.toggle("is-zoomed", state.zoom > 100);
  }

  function resetView() {
    state.zoom = 100;
    state.offsetX = 0;
    state.offsetY = 0;
    applyTransform();
  }

  function setControlsVisible(visible) {
    root.classList.toggle("is-controls-visible", visible);
    root.classList.toggle("is-cursor-visible", visible);
    state.controlsVisible = visible;
    state.cursorVisible = visible;
    syncGlobalCloseVisibility();
  }

  function clearHideTimer() {
    if (!state.hideTimer) return;
    window.clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }

  function scheduleControlsAutoHide() {
    clearHideTimer();
    if (mobileImageMedia.matches) return;
    if (state.detailOpen) return;
    if (app.settings.getImageMetaPinned() && state.zoom <= 100) return;
    state.hideTimer = window.setTimeout(() => {
      state.hideTimer = null;
      if (root.hidden || state.detailOpen) return;
      if (app.settings.getImageMetaPinned() && state.zoom <= 100) return;
      setControlsVisible(false);
    }, 1800);
  }

  function updateControlsVisibility(forceVisible = false) {
    if (state.detailOpen) {
      clearHideTimer();
      setControlsVisible(true);
      return;
    }

    const metaPinned = app.settings.getImageMetaPinned();
    if (forceVisible) {
      setControlsVisible(true);
      scheduleControlsAutoHide();
      return;
    }

    if (metaPinned && state.zoom <= 100) {
      clearHideTimer();
      setControlsVisible(true);
      return;
    }

    clearHideTimer();
    setControlsVisible(false);
  }

  function toggleControlsVisibility() {
    if (state.detailOpen) return;
    const metaPinned = app.settings.getImageMetaPinned();
    if (metaPinned && state.zoom <= 100) {
      setControlsVisible(true);
      return;
    }
    setControlsVisible(!state.controlsVisible);
  }

  function syncLikeUi() {
    const current = currentItem() || {};
    const liked = Boolean(current.viewer_liked);
    likeButton.classList.toggle("is-active", liked);
    likeButton.classList.toggle("is-pending", state.likePending);
    likeButton.disabled = state.likePending;
    likeButton.setAttribute("aria-pressed", String(liked));
    likeButton.setAttribute("aria-label", liked ? t(app, "unlike", "Unlike") : t(app, "like", "Like"));
    likeButton.textContent = liked ? "♥" : "♡";
    likeCountNode.textContent = formatCompactCount(current.like_count || 0);
    detailModal.setLikePending(state.likePending);
  }

  function populateFooter() {
    const item = currentItem() || {};
    titleNode.textContent = item.title || t(app, "untitled", "Untitled");
    postedAtNode.textContent = formatDateTime(item.posted_at);
    const user = item.user || {};
    const avatarUrl = user.avatar_url ? withAppBase(user.avatar_url) : "";
    userAvatarNode.classList.remove("supporter-icon-frame--aurora-ring", "supporter-icon-frame--amber-ring");
    if (user?.supporter_profile?.selected_icon_frame === "aurora_ring") userAvatarNode.classList.add("supporter-icon-frame--aurora-ring");
    if (user?.supporter_profile?.selected_icon_frame === "amber_ring") userAvatarNode.classList.add("supporter-icon-frame--amber-ring");
    if (avatarUrl) {
      userAvatarNode.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="">`;
    } else {
      userAvatarNode.textContent = (user.display_name || "?").slice(0, 1);
    }
    userTextNode.textContent = `${textOrDash(user.display_name)} / @${textOrDash(user.user_key)}`;
    const userSpan = root.querySelector(".image-modal__user");
    if (userSpan) {
      const userKey = normalizeUserKey(user.user_key);
      userSpan.dataset.userKey = userKey;
      userSpan.classList.toggle("is-clickable", Boolean(userKey));
    }
    syncPagerUi();
    syncLikeUi();
  }

  document.addEventListener("app:support-presentation-updated", (event) => {
    const userKey = normalizeUserKey(event.detail?.userKey);
    if (!userKey) {
      return;
    }
    const publicProfile = event.detail?.publicProfile || {};
    let updated = false;
    state.items.forEach((item) => {
      const itemUserKey = normalizeUserKey(item?.user?.user_key || item?.uploader_user_key || item?.user_key);
      if (itemUserKey !== userKey) {
        return;
      }
      const targetUser = item.user || (item.user = {});
      targetUser.supporter_profile = {
        ...(targetUser.supporter_profile || {}),
        ...publicProfile,
      };
      updated = true;
    });
    if (state.detailCache) {
      const detailUserKey = normalizeUserKey(state.detailCache?.user?.user_key || state.detailCache?.uploader_user_key || state.detailCache?.user_key);
      if (detailUserKey === userKey) {
        const targetUser = state.detailCache.user || (state.detailCache.user = {});
        targetUser.supporter_profile = {
          ...(targetUser.supporter_profile || {}),
          ...publicProfile,
        };
        updated = true;
        detailModal.update(state.detailCache);
      }
    }
    if (updated && !root.hidden) {
      populateFooter();
    }
  });

  function bodyLock(lock) {
    body.classList.toggle("is-image-modal-open", lock);
    if (lock) {
      lockBodyScroll(body);
      return;
    }
    unlockBodyScroll(body);
  }

  function applyLikeState(nextState = {}) {
    const current = currentItem();
    if (!current) {
      return;
    }

    if (nextState.viewer_liked !== undefined) {
      current.viewer_liked = Boolean(nextState.viewer_liked);
    }
    if (nextState.like_count !== undefined) {
      current.like_count = normalizeLikeCount(nextState.like_count);
    }

    if (state.current) {
      state.current = current;
    }

    if (state.detailCache) {
      if (nextState.viewer_liked !== undefined) {
        state.detailCache.viewer_liked = Boolean(nextState.viewer_liked);
      }
      if (nextState.like_count !== undefined) {
        state.detailCache.like_count = normalizeLikeCount(nextState.like_count);
      }
      detailModal.update(state.detailCache);
    }
    syncLikeUi();
  }

  function applyOwnedContentState(nextState = {}) {
    const current = currentItem();
    const targetContentId = nextState.content_id || current?.content_id || (current?.image_id ? `i-${current.image_id}` : "");
    if (!targetContentId) {
      return;
    }

    state.items.forEach((item) => {
      const itemContentId = item.content_id || (item.image_id ? `i-${item.image_id}` : "");
      if (itemContentId !== targetContentId) {
        return;
      }
      item.content_id = targetContentId;
      item.viewer_permissions = nextState.viewer_permissions || item.viewer_permissions || null;
      item.owner_meta = {
        ...(item.owner_meta || {}),
        ...(nextState.owner_meta || {}),
      };
      item.admin_meta = {
        ...(item.admin_meta || {}),
        ...(nextState.visibility ? { is_public: nextState.visibility === "public" } : {}),
        ...(nextState.status ? { moderation_status: nextState.status } : {}),
      };
    });

    if (state.detailCache) {
      state.detailCache.content_id = targetContentId;
      state.detailCache.viewer_permissions = nextState.viewer_permissions || state.detailCache.viewer_permissions || null;
      state.detailCache.owner_meta = {
        ...(state.detailCache.owner_meta || {}),
        ...(nextState.owner_meta || {}),
      };
      state.detailCache.admin_meta = {
        ...(state.detailCache.admin_meta || {}),
        ...(nextState.visibility ? { is_public: nextState.visibility === "public" } : {}),
        ...(nextState.status ? { moderation_status: nextState.status } : {}),
      };
      detailModal.update(state.detailCache);
    }

    populateFooter();
  }

  async function openDetail() {
    const current = currentItem();
    if (!current) return;
    if (
      typeof current.detailLoader === "function" &&
      (!state.detailCache || state.detailCache.viewer_permissions == null || state.detailCache.owner_meta == null)
    ) {
      try {
        state.detailCache = normalizePayload(await current.detailLoader(current), {
          detailLoader: current.detailLoader,
        });
      } catch {
        state.detailCache = normalizePayload(current, {
          detailLoader: current.detailLoader,
        });
      }
    }
    detailModal.open(state.detailCache || normalizePayload(current));
  }

  async function toggleOwnedContentVisibility() {
    const current = currentItem();
    const contentId = current?.content_id || (current?.image_id ? `i-${current.image_id}` : "");
    const visibility = state.detailCache?.owner_meta?.visibility || current?.owner_meta?.visibility || "public";
    const nextPublic = visibility !== "public";
    if (!contentId || state.ownerActionPending) {
      return;
    }
    const confirmed = await openSharedConfirm(app, {
      message: nextPublic
        ? td(app, "confirm_make_public", "Make this content public?")
        : td(app, "confirm_make_private", "Make this content private?"),
      approveText: nextPublic
        ? td(app, "make_public", "Make Public")
        : td(app, "make_private", "Make Private"),
    });
    if (!confirmed) {
      return;
    }

    state.ownerActionPending = true;
    detailModal.setActionPending(true);
    try {
      const payload = await app.api.patch(`/api/contents/${encodeURIComponent(contentId)}/visibility`, { is_public: nextPublic });
      const nextState = payload?.data ?? payload ?? {};
      applyOwnedContentState(nextState);
      app.toast.success(
        nextPublic
          ? td(app, "made_public", "Content is now public.")
          : td(app, "made_private", "Content is now private.")
      );
      if (typeof state.onOwnerAction === "function") {
        state.onOwnerAction(nextState);
      }
    } catch (error) {
      app.toast.error(resolveLocalizedMessage(error, td(app, "action_error", "Failed to update content.")));
    } finally {
      state.ownerActionPending = false;
      detailModal.setActionPending(false);
    }
  }

  async function deleteOwnedContent() {
    const current = currentItem();
    const contentId = current?.content_id || (current?.image_id ? `i-${current.image_id}` : "");
    if (!contentId || state.ownerActionPending) {
      return;
    }
    const confirmed = await openSharedConfirm(app, {
      message: td(app, "confirm_delete", "Delete this content?"),
      approveText: td(app, "delete", "Delete"),
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    state.ownerActionPending = true;
    detailModal.setActionPending(true);
    try {
      const payload = await app.api.post(`/api/contents/${encodeURIComponent(contentId)}/delete`, {});
      const nextState = payload?.data ?? payload ?? {};
      applyOwnedContentState(nextState);
      app.toast.success(td(app, "deleted", "Content deleted."));
      if (typeof state.onOwnerAction === "function") {
        state.onOwnerAction(nextState);
      }
    } catch (error) {
      app.toast.error(resolveLocalizedMessage(error, td(app, "action_error", "Failed to update content.")));
    } finally {
      state.ownerActionPending = false;
      detailModal.setActionPending(false);
    }
  }

  async function toggleLike() {
    const current = currentItem();
    if (!current?.image_id) {
      return;
    }

    const sessionState = app.session?.getState?.() || { authenticated: false };
    if (!sessionState.authenticated) {
      app.toast.error(t(app, "like_auth", "Likes are available after login."));
      return;
    }

    if (state.likePending) {
      return;
    }

    state.likePending = true;
    syncLikeUi();

    const imageId = Number(current.image_id);
    const nextLiked = !Boolean(current.viewer_liked);
    const nextCount = Math.max(0, normalizeLikeCount(current.like_count) + (nextLiked ? 1 : -1));
    const previous = {
      viewer_liked: Boolean(current.viewer_liked),
      like_count: normalizeLikeCount(current.like_count),
    };

    applyLikeState({ viewer_liked: nextLiked, like_count: nextCount });

    try {
      const payload = nextLiked
        ? await app.api.post(`/api/images/${imageId}/like`, {})
        : await app.api.delete(`/api/images/${imageId}/like`, {});
      const responseState = payload?.data ?? payload ?? {};
      const resolved = {
        viewer_liked: responseState.viewer_liked ?? nextLiked,
        like_count: responseState.like_count ?? nextCount,
      };
      applyLikeState(resolved);
      if (typeof state.onLikeChange === "function") {
        state.onLikeChange({ image_id: imageId, ...resolved });
      }
    } catch (error) {
      applyLikeState(previous);
      app.toast.error(resolveLocalizedMessage(error, t(app, "like_error", "Failed to update like.")));
    } finally {
      state.likePending = false;
      syncLikeUi();
    }
  }

  function renderCurrentItem() {
    const current = currentItem();
    if (!current) {
      return;
    }
    state.current = current;
    state.detailCache = null;
    state.likePending = false;
    image.src = current.preview_url;
    image.alt = current.alt || current.title || "";
    populateFooter();
    resetView();
  }

  function goToIndex(nextIndex) {
    if (!state.items.length) {
      return;
    }
    const clamped = Math.min(state.items.length - 1, Math.max(0, nextIndex));
    if (clamped === state.currentIndex) {
      return;
    }
    state.currentIndex = clamped;
    if (detailModal.isOpen()) {
      detailModal.close();
    }
    renderCurrentItem();
    updateControlsVisibility(true);
  }

  function open(payload, options = {}) {
    state.items = normalizeItems(payload, options);
    if (!state.items.length) {
      state.items = [normalizePayload(payload, options)];
    }
    const initialIndexRaw = Number(options.currentIndex ?? payload?.currentIndex ?? 0);
    state.currentIndex = Number.isFinite(initialIndexRaw) ? Math.min(state.items.length - 1, Math.max(0, initialIndexRaw)) : 0;
    state.onLikeChange = typeof options.onLikeChange === "function" ? options.onLikeChange : null;
    state.onOwnerAction = typeof options.onOwnerAction === "function" ? options.onOwnerAction : null;
    state.detailCache = options.detail ? normalizePayload(options.detail, { detailLoader: options.detailLoader || state.items[state.currentIndex]?.detailLoader }) : null;
    state.detailOpen = false;
    state.ownerActionPending = false;
    syncDetailStateClass();
    renderCurrentItem();
    detailModal.close();
    root.hidden = false;
    bodyLock(true);
    syncGlobalCloseVisibility();
    viewport.focus?.();
    updateControlsVisibility(true);
  }

  function close() {
    detailModal.close();
    state.detailOpen = false;
    syncDetailStateClass();
    root.hidden = true;
    bodyLock(false);
    state.items = [];
    state.current = null;
    state.currentIndex = 0;
    state.detailCache = null;
    state.onLikeChange = null;
    state.likePending = false;
    resetView();
    clearHideTimer();
    root.classList.remove("is-controls-visible", "is-cursor-visible");
    syncGlobalCloseVisibility();
  }

  function zoomTo(nextZoom, clientX = null, clientY = null) {
    const clamped = Math.min(300, Math.max(100, Math.round(nextZoom / 10) * 10));
    const prevZoom = state.zoom;
    if (clamped === prevZoom) return;
    const rect = stage.getBoundingClientRect();
    const originX = clientX === null ? rect.left + rect.width / 2 : clientX;
    const originY = clientY === null ? rect.top + rect.height / 2 : clientY;
    const ratio = clamped / prevZoom;
    state.offsetX = (state.offsetX - (originX - (rect.left + rect.width / 2))) * ratio + (originX - (rect.left + rect.width / 2));
    state.offsetY = (state.offsetY - (originY - (rect.top + rect.height / 2))) * ratio + (originY - (rect.top + rect.height / 2));
    state.zoom = clamped;
    if (state.zoom <= 100) {
      state.offsetX = 0;
      state.offsetY = 0;
    }
    applyTransform();
    updateControlsVisibility(true);
  }

  function shouldCloseByBackdropClick(event) {
    if (state.detailOpen) return false;
    if (mobileImageMedia.matches) return false;
    if (!app.settings.getImageBackdropClose()) return false;
    const target = event.target;
    return target === viewport || target === stage;
  }

  root.querySelector(".image-modal__backdrop").addEventListener("click", () => {
    if (state.detailOpen) return;
    if (mobileImageMedia.matches) return;
    if (!app.settings.getImageBackdropClose()) return;
    close();
  });

  viewport.addEventListener("click", (event) => {
    if (shouldCloseByBackdropClick(event)) {
      close();
      return;
    }
    const interactive = event.target.closest("button, input, select, textarea, a, [data-detail-preview-open]");
    if (interactive) {
      return;
    }
    const clickedStage = event.target === stage || event.target === image;
    if (clickedStage && mobileImageMedia.matches) {
      toggleControlsVisibility();
    }
  });

  viewport.addEventListener("mousemove", () => {
    if (root.hidden || mobileImageMedia.matches || state.dragging) return;
    updateControlsVisibility(true);
  });

  closeButton.addEventListener("click", () => {
    if (state.detailOpen) {
      detailModal.close();
      return;
    }
    close();
  });

  globalCloseButton?.addEventListener("click", () => {
    if (root.hidden || mobileImageMedia.matches) return;
    if (state.detailOpen) {
      detailModal.close();
      return;
    }
    close();
  });

  mobileImageMedia.addEventListener?.("change", () => {
    syncGlobalCloseVisibility();
  });

  prevButton.addEventListener("click", (event) => {
    event.stopPropagation();
    goToIndex(state.currentIndex - 1);
  });

  nextButton.addEventListener("click", (event) => {
    event.stopPropagation();
    goToIndex(state.currentIndex + 1);
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (detailModal.isOpen()) {
        detailModal.close();
        return;
      }
      close();
      return;
    }
    if (state.detailOpen) {
      return;
    }
    if (event.key === "ArrowLeft") {
      if (state.items.length > 1) {
        goToIndex(state.currentIndex - 1);
      }
      return;
    }
    if (event.key === "ArrowRight") {
      if (state.items.length > 1) {
        goToIndex(state.currentIndex + 1);
      }
    }
  });

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (state.detailOpen) return;
    const delta = event.deltaY > 0 ? -10 : 10;
    zoomTo(state.zoom + delta, event.clientX, event.clientY);
  }, { passive: false });

  slider.addEventListener("input", (event) => {
    if (state.detailOpen) return;
    zoomTo(Number(event.target.value || 100));
  });

  stage.addEventListener("mousedown", (event) => {
    if (state.detailOpen) return;
    if (state.zoom <= 100) return;
    state.dragging = true;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragOriginX = state.offsetX;
    state.dragOriginY = state.offsetY;
    stage.classList.add("is-dragging");
  });

  window.addEventListener("mousemove", (event) => {
    if (!state.dragging) return;
    state.offsetX = state.dragOriginX + (event.clientX - state.dragStartX);
    state.offsetY = state.dragOriginY + (event.clientY - state.dragStartY);
    applyTransform();
  });

  window.addEventListener("mouseup", () => {
    if (!state.dragging) return;
    state.dragging = false;
    stage.classList.remove("is-dragging");
  });

  viewport.addEventListener("touchstart", (event) => {
    if (!mobileImageMedia.matches) return;
    if (state.detailOpen) return;
    if (state.zoom > 100) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    state.touchTracking = true;
    state.touchStartX = touch.clientX;
    state.touchStartY = touch.clientY;
    state.touchDeltaX = 0;
    state.touchDeltaY = 0;
  }, { passive: true });

  viewport.addEventListener("touchmove", (event) => {
    if (!state.touchTracking) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    state.touchDeltaX = touch.clientX - state.touchStartX;
    state.touchDeltaY = touch.clientY - state.touchStartY;
  }, { passive: true });

  viewport.addEventListener("touchend", () => {
    if (!state.touchTracking) return;
    const deltaX = state.touchDeltaX;
    const deltaY = state.touchDeltaY;
    state.touchTracking = false;
    state.touchDeltaX = 0;
    state.touchDeltaY = 0;
    if (deltaY < 96) return;
    if (Math.abs(deltaY) <= Math.abs(deltaX)) return;
    close();
  });

  viewport.querySelector("[data-action='new-tab']").addEventListener("click", () => {
    const current = currentItem();
    if (!current?.original_url) return;
    window.open(current.original_url, "_blank", "noopener,noreferrer");
  });

  viewport.querySelector("[data-action='detail']").addEventListener("click", () => {
    openDetail();
  });

  likeButton.addEventListener("click", () => {
    toggleLike();
  });

  root.querySelector(".image-modal__user").addEventListener("click", (event) => {
    const userKey = normalizeUserKey(event.currentTarget.dataset.userKey);
    if (!userKey) return;
    document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey } }));
  });

  image.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  return {
    open,
    close,
    isOpen: () => !root.hidden,
    setLikePending(imageId, pending) {
      const current = currentItem();
      if (!current || Number(current.image_id) !== Number(imageId)) {
        return;
      }
      state.likePending = Boolean(pending);
      syncLikeUi();
    },
    updateLikeState(imageId, nextState = {}) {
      const matched = state.items.find((item) => Number(item.image_id) === Number(imageId));
      if (!matched) {
        return;
      }
      if (nextState.viewer_liked !== undefined) {
        matched.viewer_liked = Boolean(nextState.viewer_liked);
      }
      if (nextState.like_count !== undefined) {
        matched.like_count = normalizeLikeCount(nextState.like_count);
      }
      if (Number(currentItem()?.image_id) === Number(imageId)) {
        applyLikeState(nextState);
      }
    },
    openByPreference(payload, options = {}) {
      if (app.settings.getImageOpenBehavior() === "new_tab") {
        const items = normalizeItems(payload, options);
        const initialIndexRaw = Number(options.currentIndex ?? payload?.currentIndex ?? 0);
        const initialIndex = Number.isFinite(initialIndexRaw) ? Math.min(items.length - 1, Math.max(0, initialIndexRaw)) : 0;
        const selected = items[initialIndex] || items[0] || normalizePayload(payload, options);
        if (selected.original_url) {
          window.open(selected.original_url, "_blank", "noopener,noreferrer");
          return;
        }
      }
      open(payload, options);
    },
    openDetail(payload, options = {}) {
      if (!root.hidden) return; // viewer already open — don't interfere
      const normalized = normalizePayload(payload, options);
      state.items = [normalized];
      state.currentIndex = 0;
      state.onLikeChange = typeof options.onLikeChange === "function" ? options.onLikeChange : null;
      state.detailCache = normalized;
      root.classList.add("is-detail-standalone");
      root.hidden = false;
      bodyLock(true);
      syncGlobalCloseVisibility();
      state.detailOpen = true;
      syncDetailStateClass();
      detailModal.open(normalized);
    },
  };
}
import { resolveLocalizedMessage } from "./i18n.js";
