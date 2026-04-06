import { createImageDetailModal } from "./image-detail-modal.js";

const STYLE_ID = "felixxsv-image-modal-style";

function ensureStylesheet(appBase) {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = `${appBase}/assets/css/components/image-modal.css`;
  document.head.appendChild(link);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textOrDash(value) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return textOrDash(value);
  return date.toLocaleString("ja-JP");
}

function formatCompactCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(".0", "")}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(".0", "")}M`;
  return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1).replace(".0", "")}B`;
}

function normalizeLikeCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function withAppBase(path) {
  const appBase = document.body.dataset.appBase || "/gallery";
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith("/gallery/")) return path;
  if (path.startsWith("/storage/") || path.startsWith("/media/") || path.startsWith("/api/")) return `${appBase}${path}`;
  if (path.startsWith("storage/") || path.startsWith("media/") || path.startsWith("api/")) return `${appBase}/${path}`;
  if (path.startsWith("/")) return `${appBase}${path}`;
  return `${appBase}/storage/${path.replace(/^\/+/, "")}`;
}

function normalizePayload(item, options = {}) {
  const normalized = { ...(item || {}) };
  normalized.image_id = item?.image_id ?? item?.id ?? null;
  normalized.title = item?.title || item?.alt || "タイトル未設定";
  normalized.alt = item?.alt || item?.title || "";
  normalized.preview_url = withAppBase(
    item?.preview_url ||
      item?.original_url ||
      item?.preview_path ||
      item?.thumb_path_960 ||
      item?.thumb_path_480 ||
      item?.thumb_path ||
      item?.image_url ||
      item?.url ||
      (normalized.image_id ? `/media/original/${normalized.image_id}` : "")
  );
  normalized.original_url = withAppBase(
    item?.original_url || item?.image_url || item?.url || (normalized.image_id ? `/media/original/${normalized.image_id}` : normalized.preview_url)
  );
  normalized.posted_at = item?.posted_at || item?.created_at || item?.shot_at || null;
  normalized.shot_at = item?.shot_at || null;
  normalized.like_count = normalizeLikeCount(item?.like_count || 0);
  normalized.viewer_liked = Boolean(item?.viewer_liked);
  normalized.view_count = Number(item?.view_count || 0);
  normalized.user = item?.user || {
    display_name: item?.uploader_display_name || item?.display_name || "投稿者不明",
    user_key: item?.uploader_user_key || item?.user_key || "-",
    avatar_url: withAppBase(item?.uploader_avatar_url || item?.uploader_avatar_path || item?.avatar_url || ""),
  };
  normalized.tags = Array.isArray(item?.tags) ? item.tags : [];
  normalized.color_tags = Array.isArray(item?.color_tags) ? item.color_tags : [];
  normalized.file_size_bytes = item?.file_size_bytes ?? null;
  normalized.image_width = item?.image_width ?? item?.width ?? null;
  normalized.image_height = item?.image_height ?? item?.height ?? null;
  normalized.admin_meta = item?.admin_meta || {};
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

  const root = document.createElement("section");
  root.className = "image-modal";
  root.hidden = true;
  root.innerHTML = `
    <div class="image-modal__backdrop"></div>
    <div class="image-modal__viewport" tabindex="-1">
      <button type="button" class="image-modal__close" aria-label="閉じる">×</button>
      <button type="button" class="image-modal__nav image-modal__nav--prev" data-action="prev" aria-label="前の画像">‹</button>
      <button type="button" class="image-modal__nav image-modal__nav--next" data-action="next" aria-label="次の画像">›</button>
      <div class="image-modal__stage">
        <img class="image-modal__image" alt="">
      </div>
      <div class="image-modal__slider-wrap" hidden>
        <input class="image-modal__slider" type="range" min="100" max="300" step="10" value="100" aria-label="拡大率">
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
          <button type="button" class="image-modal__action image-modal__action--like" data-action="like" aria-label="いいねする" aria-pressed="false">♡</button>
          <span class="image-modal__stat"><span class="image-modal__like-count">0</span></span>
          <button type="button" class="image-modal__action image-modal__action--ghost" data-action="new-tab" aria-label="別タブで表示">↗</button>
          <button type="button" class="image-modal__action image-modal__action--ghost" data-action="detail" aria-label="詳細">…</button>
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
    likePending: false,
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
      clearHideTimer();
      updateControlsVisibility(true);
    },
    onClose() {
      state.detailOpen = false;
      syncDetailStateClass();
      updateControlsVisibility(true);
      scheduleAutoHide();
    },
    onPreviewOpen() {
      detailModal.close();
      updateControlsVisibility(true);
      scheduleAutoHide();
      viewport.focus?.();
    },
  });

  function currentItem() {
    return state.items[state.currentIndex] || state.current || null;
  }

  function syncPagerUi() {
    const total = state.items.length;
    const multi = total > 1;
    pagerNode.hidden = !multi;
    prevButton.hidden = !multi;
    nextButton.hidden = !multi;
    prevButton.disabled = !multi || state.currentIndex <= 0;
    nextButton.disabled = !multi || state.currentIndex >= total - 1;
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

  function updateControlsVisibility(forceVisible = false, pointer = null) {
    if (state.detailOpen) {
      root.classList.add("is-controls-visible");
      root.classList.add("is-cursor-visible");
      state.controlsVisible = true;
      state.cursorVisible = true;
      return;
    }

    const metaPinned = app.settings.getImageMetaPinned();
    if (forceVisible) {
      root.classList.add("is-controls-visible");
      root.classList.add("is-cursor-visible");
      state.controlsVisible = true;
      state.cursorVisible = true;
      return;
    }

    if (metaPinned && state.zoom <= 100) {
      root.classList.add("is-controls-visible");
      root.classList.add("is-cursor-visible");
      state.controlsVisible = true;
      state.cursorVisible = true;
      return;
    }

    if (state.zoom > 100 && pointer) {
      const rect = viewport.getBoundingClientRect();
      const nearRight = pointer.clientX >= rect.right - 96;
      const nearBottom = pointer.clientY >= rect.bottom - 132;
      const nearClose = pointer.clientX >= rect.right - 108 && pointer.clientY <= rect.top + 96;
      const showControls = nearRight || nearBottom || nearClose;
      root.classList.toggle("is-controls-visible", showControls);
      root.classList.add("is-cursor-visible");
      state.controlsVisible = showControls;
      state.cursorVisible = true;
      return;
    }

    root.classList.remove("is-controls-visible");
    root.classList.remove("is-cursor-visible");
    state.controlsVisible = false;
    state.cursorVisible = false;
  }

  function clearHideTimer() {
    if (state.hideTimer) {
      window.clearTimeout(state.hideTimer);
      state.hideTimer = null;
    }
  }

  function scheduleAutoHide() {
    clearHideTimer();
    if (state.detailOpen) return;
    const metaPinned = app.settings.getImageMetaPinned();
    if (metaPinned && state.zoom <= 100) return;
    state.hideTimer = window.setTimeout(() => {
      if (state.detailOpen) return;
      updateControlsVisibility(false, null);
    }, 2200);
  }

  function syncLikeUi() {
    const current = currentItem() || {};
    const liked = Boolean(current.viewer_liked);
    likeButton.classList.toggle("is-active", liked);
    likeButton.classList.toggle("is-pending", state.likePending);
    likeButton.disabled = state.likePending;
    likeButton.setAttribute("aria-pressed", String(liked));
    likeButton.setAttribute("aria-label", liked ? "いいねを取り消す" : "いいねする");
    likeButton.textContent = liked ? "♥" : "♡";
    likeCountNode.textContent = formatCompactCount(current.like_count || 0);
    detailModal.setLikePending(state.likePending);
  }

  function populateFooter() {
    const item = currentItem() || {};
    titleNode.textContent = item.title || "タイトル未設定";
    postedAtNode.textContent = formatDateTime(item.posted_at);
    const user = item.user || {};
    const avatarUrl = user.avatar_url ? withAppBase(user.avatar_url) : "";
    if (avatarUrl) {
      userAvatarNode.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="">`;
    } else {
      userAvatarNode.textContent = (user.display_name || "?").slice(0, 1);
    }
    userTextNode.textContent = `${textOrDash(user.display_name)} / @${textOrDash(user.user_key)}`;
    const userSpan = root.querySelector(".image-modal__user");
    if (userSpan) {
      userSpan.dataset.userKey = user.user_key || "";
      userSpan.classList.toggle("is-clickable", Boolean(user.user_key));
    }
    syncPagerUi();
    syncLikeUi();
  }

  function bodyLock(lock) {
    body.classList.toggle("is-image-modal-open", lock);
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

  async function openDetail() {
    const current = currentItem();
    if (!current) return;
    if (!state.detailCache && typeof current.detailLoader === "function") {
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

  async function toggleLike() {
    const current = currentItem();
    if (!current?.image_id) {
      return;
    }

    const sessionState = app.session?.getState?.() || { authenticated: false };
    if (!sessionState.authenticated) {
      app.toast.error("いいね機能はログイン後に利用できます。");
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
      app.toast.error(error.message || "いいねの更新に失敗しました。");
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
    scheduleAutoHide();
  }

  function open(payload, options = {}) {
    state.items = normalizeItems(payload, options);
    if (!state.items.length) {
      state.items = [normalizePayload(payload, options)];
    }
    const initialIndexRaw = Number(options.currentIndex ?? payload?.currentIndex ?? 0);
    state.currentIndex = Number.isFinite(initialIndexRaw) ? Math.min(state.items.length - 1, Math.max(0, initialIndexRaw)) : 0;
    state.onLikeChange = typeof options.onLikeChange === "function" ? options.onLikeChange : null;
    state.detailCache = options.detail ? normalizePayload(options.detail, { detailLoader: options.detailLoader || state.items[state.currentIndex]?.detailLoader }) : null;
    state.detailOpen = false;
    syncDetailStateClass();
    renderCurrentItem();
    detailModal.close();
    root.hidden = false;
    bodyLock(true);
    viewport.focus?.();
    updateControlsVisibility(true);
    scheduleAutoHide();
  }

  function close() {
    clearHideTimer();
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
    root.classList.remove("is-controls-visible", "is-cursor-visible");
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
    scheduleAutoHide();
  }

  function shouldCloseByBackdropClick(event) {
    if (state.detailOpen) return false;
    if (!app.settings.getImageBackdropClose()) return false;
    const target = event.target;
    return target === viewport || target === stage;
  }

  root.querySelector(".image-modal__backdrop").addEventListener("click", () => {
    if (state.detailOpen) return;
    if (!app.settings.getImageBackdropClose()) return;
    close();
  });

  viewport.addEventListener("click", (event) => {
    if (shouldCloseByBackdropClick(event)) {
      close();
    }
  });

  closeButton.addEventListener("click", () => {
    if (state.detailOpen) {
      detailModal.close();
      return;
    }
    close();
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

  viewport.addEventListener("mousemove", (event) => {
    if (root.hidden) return;
    if (state.detailOpen) {
      updateControlsVisibility(true);
      return;
    }
    if (state.zoom > 100) {
      updateControlsVisibility(false, event);
    } else {
      updateControlsVisibility(true);
    }
    scheduleAutoHide();
  });

  viewport.addEventListener("mouseleave", () => {
    if (state.detailOpen) return;
    if (state.zoom > 100) {
      clearHideTimer();
      updateControlsVisibility(false, null);
      return;
    }
    scheduleAutoHide();
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
    clearHideTimer();
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
    scheduleAutoHide();
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
    const userKey = event.currentTarget.dataset.userKey;
    if (!userKey) return;
    document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey } }));
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
  };
}
