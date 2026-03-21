import { createImageDetailModal } from "./image-detail-modal.js";

const STYLE_ID = "felixxsv-image-modal-style";

function ensureStylesheet(appBase) {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = `${appBase}/assets/css/image-modal.css`;
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
    item?.original_url ||
    item?.preview_url ||
    item?.preview_path ||
    item?.thumb_path_960 ||
    item?.thumb_path_480 ||
    item?.thumb_path ||
    item?.image_url ||
    item?.url ||
    (normalized.image_id ? `/media/original/${normalized.image_id}` : "")
  );
  normalized.original_url = withAppBase(
    item?.original_url ||
    item?.image_url ||
    item?.url ||
    (normalized.image_id ? `/media/original/${normalized.image_id}` : normalized.preview_url)
  );
  normalized.posted_at = item?.posted_at || item?.created_at || item?.shot_at || null;
  normalized.shot_at = item?.shot_at || null;
  normalized.like_count = Number(item?.like_count || 0);
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

export function createImageModalController({ app, body = document.body } = {}) {
  ensureStylesheet(app.appBase);

  const root = document.createElement("section");
  root.className = "image-modal";
  root.hidden = true;
  root.innerHTML = `
    <div class="image-modal__backdrop"></div>
    <div class="image-modal__viewport">
      <button type="button" class="image-modal__close" aria-label="閉じる">×</button>
      <div class="image-modal__stage">
        <img class="image-modal__image" alt="">
      </div>
      <div class="image-modal__slider-wrap" hidden>
        <input class="image-modal__slider" type="range" min="100" max="300" step="10" value="100" orient="vertical" aria-label="拡大率">
      </div>
      <div class="image-modal__footer">
        <div class="image-modal__meta">
          <div class="image-modal__title">-</div>
          <div class="image-modal__submeta">
            <span class="image-modal__posted-at">-</span>
            <span class="image-modal__user">
              <span class="image-modal__user-avatar"></span>
              <span class="image-modal__user-text">-</span>
            </span>
          </div>
        </div>
        <div class="image-modal__actions">
          <span class="image-modal__stat">♥ <span class="image-modal__like-count">0</span></span>
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
  const sliderWrap = root.querySelector(".image-modal__slider-wrap");
  const slider = root.querySelector(".image-modal__slider");
  const titleNode = root.querySelector(".image-modal__title");
  const postedAtNode = root.querySelector(".image-modal__posted-at");
  const userAvatarNode = root.querySelector(".image-modal__user-avatar");
  const userTextNode = root.querySelector(".image-modal__user-text");
  const likeCountNode = root.querySelector(".image-modal__like-count");

  const state = {
    current: null,
    detailCache: null,
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
    detailOpen: false,
  };

  const detailModal = createImageDetailModal({
    host: viewport,
    app,
    onOpen() {
      state.detailOpen = true;
      clearHideTimer();
      updateControlsVisibility(true);
    },
    onClose() {
      state.detailOpen = false;
      updateControlsVisibility(true);
      scheduleAutoHide();
    },
  });

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

  function populateFooter() {
    const item = state.current || {};
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
    likeCountNode.textContent = formatCompactCount(item.like_count || 0);
  }

  function bodyLock(lock) {
    body.classList.toggle("is-image-modal-open", lock);
  }

  async function openDetail() {
    if (!state.current) return;
    if (!state.detailCache && typeof state.current.detailLoader === "function") {
      try {
        state.detailCache = normalizePayload(await state.current.detailLoader(state.current), {
          detailLoader: state.current.detailLoader,
        });
      } catch {
        state.detailCache = normalizePayload(state.current, {
          detailLoader: state.current.detailLoader,
        });
      }
    }
    detailModal.open(state.detailCache || normalizePayload(state.current));
  }

  function open(payload, options = {}) {
    state.current = normalizePayload(payload, options);
    state.detailCache = options.detail || null;
    state.detailOpen = false;
    image.src = state.current.preview_url;
    image.alt = state.current.alt || state.current.title || "";
    populateFooter();
    resetView();
    detailModal.close();
    root.hidden = false;
    bodyLock(true);
    updateControlsVisibility(true);
    scheduleAutoHide();
  }

  function close() {
    clearHideTimer();
    detailModal.close();
    state.detailOpen = false;
    root.hidden = true;
    bodyLock(false);
    state.current = null;
    state.detailCache = null;
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

  root.querySelector(".image-modal__backdrop").addEventListener("click", () => {
    if (state.detailOpen) return;
    if (!app.settings.getImageBackdropClose()) return;
    close();
  });

  closeButton.addEventListener("click", () => {
    if (state.detailOpen) {
      detailModal.close();
      return;
    }
    close();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (detailModal.isOpen()) {
        detailModal.close();
        return;
      }
      close();
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
    if (!state.current?.original_url) return;
    window.open(state.current.original_url, "_blank", "noopener,noreferrer");
  });

  viewport.querySelector("[data-action='detail']").addEventListener("click", () => {
    openDetail();
  });

  return {
    open,
    close,
    isOpen: () => !root.hidden,
    openByPreference(payload, options = {}) {
      if (app.settings.getImageOpenBehavior() === "new_tab") {
        const normalized = normalizePayload(payload, options);
        if (normalized.original_url) {
          window.open(normalized.original_url, "_blank", "noopener,noreferrer");
          return;
        }
      }
      open(payload, options);
    },
  };
}