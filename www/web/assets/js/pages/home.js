import { byId } from "../core/dom.js";

const GRID_COLS_STORAGE_KEY = "gallery.home.gridCols";
const MOBILE_GRID_MEDIA = "(max-width: 820px)";
const DEFAULT_GRID_COLS = 3;

function textOrDash(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return String(value);
}

function withAppBase(path) {
  const appBase = document.body.dataset.appBase || "/gallery";
  if (!path) {
    return "";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("/gallery/")) {
    return path;
  }
  if (path.startsWith("/storage/") || path.startsWith("/media/") || path.startsWith("/api/")) {
    return `${appBase}${path}`;
  }
  if (path.startsWith("storage/") || path.startsWith("media/") || path.startsWith("api/")) {
    return `${appBase}/${path}`;
  }
  if (path.startsWith("/")) {
    return `${appBase}${path}`;
  }
  return `${appBase}/storage/${path.replace(/^\/+/, "")}`;
}

function normalizeImageUrl(image) {
  const candidates = [
    image.preview_path,
    image.thumb_path_960,
    image.thumb_path_480,
    image.thumb_path,
    image.image_url,
    image.url,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") {
      continue;
    }
    return withAppBase(candidate);
  }

  if (image.id !== undefined && image.id !== null) {
    return withAppBase(`/media/original/${image.id}`);
  }

  return "";
}

function extractListPayload(payload) {
  const root = payload?.data ?? payload;

  if (Array.isArray(root)) {
    return {
      items: root,
      page: 1,
      perPage: root.length,
      total: root.length,
      hasNext: false,
    };
  }

  if (!root || typeof root !== "object") {
    return {
      items: [],
      page: 1,
      perPage: 24,
      total: 0,
      hasNext: false,
    };
  }

  const items = root.items || root.images || root.records || root.results || [];
  const page = Number(root.page || root.current_page || 1);
  const perPage = Number(root.per_page || root.perPage || items.length || 24);
  const total = Number(root.total || root.total_count || items.length || 0);
  const hasNext = root.has_next ?? (page * perPage < total);

  return {
    items: Array.isArray(items) ? items : [],
    page,
    perPage,
    total,
    hasNext: Boolean(hasNext),
  };
}

function buildPublicDetail(image) {
  return {
    image_id: image.id ?? null,
    title: image.title || "タイトル未設定",
    alt: image.alt || "",
    posted_at: image.created_at || image.posted_at || image.shot_at || null,
    shot_at: image.shot_at || null,
    like_count: Number(image.like_count || 0),
    view_count: Number(image.view_count || 0),
    tags: Array.isArray(image.tags) ? image.tags : [],
    color_tags: Array.isArray(image.color_tags) ? image.color_tags : [],
    file_size_bytes: image.file_size_bytes ?? null,
    image_width: image.image_width ?? image.width ?? null,
    image_height: image.image_height ?? image.height ?? null,
    user: image.user || {
      display_name: image.uploader_display_name || image.display_name || "投稿者不明",
      user_key: image.uploader_user_key || image.user_key || "-",
      avatar_url: withAppBase(image.uploader_avatar_url || image.uploader_avatar_path || image.avatar_url || ""),
    },
  };
}

function readStoredGridCols() {
  try {
    const value = Number(window.localStorage.getItem(GRID_COLS_STORAGE_KEY) || DEFAULT_GRID_COLS);
    if ([1, 2, 3, 4].includes(value)) {
      return value;
    }
  } catch {
    return DEFAULT_GRID_COLS;
  }
  return DEFAULT_GRID_COLS;
}

function writeStoredGridCols(value) {
  try {
    window.localStorage.setItem(GRID_COLS_STORAGE_KEY, String(value));
  } catch {
    return;
  }
}

export function initHomePage(app) {
  const refs = {
    searchInput: byId("homeSearchInput"),
    sortSelect: byId("homeSortSelect"),
    perPageSelect: byId("homePerPageSelect"),
    reloadButton: byId("homeReloadButton"),
    statusText: byId("homeStatusText"),
    loadingState: byId("homeLoadingState"),
    errorState: byId("homeErrorState"),
    emptyState: byId("homeEmptyState"),
    galleryGrid: byId("homeGalleryGrid"),
    paginationMeta: byId("homePaginationMeta"),
    prevPageButton: byId("homePrevPageButton"),
    nextPageButton: byId("homeNextPageButton"),
    cardTemplate: byId("homeImageCardTemplate"),
    gridControls: byId("homeGridColumnsControls"),
  };

  const gridMedia = window.matchMedia(MOBILE_GRID_MEDIA);

  const state = {
    page: 1,
    perPage: Number(refs.perPageSelect?.value || 24),
    sort: refs.sortSelect?.value || "latest",
    q: "",
    total: 0,
    hasNext: false,
    debounceTimer: null,
    items: [],
    gridCols: readStoredGridCols(),
  };

  function setLoading(loading) {
    refs.loadingState.hidden = !loading;
  }

  function setError(message) {
    refs.errorState.hidden = !message;
    refs.errorState.textContent = message || "";
  }

  function setEmpty(visible) {
    refs.emptyState.hidden = !visible;
  }

  function setGridVisible(visible) {
    refs.galleryGrid.hidden = !visible;
  }

  function effectiveGridCols() {
    return gridMedia.matches ? 1 : state.gridCols;
  }

  function syncGridColumnsUi() {
    const cols = effectiveGridCols();
    refs.galleryGrid.dataset.gridCols = String(cols);

    if (!refs.gridControls) {
      return;
    }

    refs.gridControls.hidden = gridMedia.matches;

    const buttons = refs.gridControls.querySelectorAll("[data-grid-cols]");
    for (const button of buttons) {
      const active = Number(button.dataset.gridCols || 0) === cols;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function updateStatus() {
    const start = state.total === 0 ? 0 : (state.page - 1) * state.perPage + 1;
    const end = Math.min(state.page * state.perPage, state.total);
    refs.statusText.textContent = `検索: ${state.q ? `"${state.q}"` : "なし"} / 並び順: ${state.sort} / ${start}-${end}件 / 総件数 ${state.total}件`;
    refs.paginationMeta.textContent = `Page ${state.page}`;
    refs.prevPageButton.disabled = state.page <= 1;
    refs.nextPageButton.disabled = !state.hasNext;
  }

  function createCard(image, index) {
    const fragment = refs.cardTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".home-gallery-card");
    const link = fragment.querySelector("[data-card-link]");
    const imageNode = fragment.querySelector("[data-card-image]");
    const emptyNode = fragment.querySelector("[data-card-empty]");
    const titleNode = fragment.querySelector("[data-card-title]");
    const metaNode = fragment.querySelector("[data-card-meta]");
    const imageUrl = normalizeImageUrl(image);

    article.dataset.imageIndex = String(index);
    article.dataset.imageId = String(image.id ?? "");

    if (imageUrl) {
      link.href = imageUrl;
      link.dataset.action = "open-image";
      imageNode.src = imageUrl;
      imageNode.alt = textOrDash(image.alt || image.title || "");
      imageNode.hidden = false;
      emptyNode.hidden = true;
    } else {
      link.href = "#";
      imageNode.hidden = true;
      emptyNode.hidden = false;
    }

    titleNode.textContent = textOrDash(image.title || image.alt || `image-${image.id ?? ""}`);
    metaNode.textContent = textOrDash(image.shot_at || image.created_at || image.date || "");
    return article;
  }

  function renderItems(items) {
    refs.galleryGrid.textContent = "";

    if (!items.length) {
      setGridVisible(false);
      setEmpty(true);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      fragment.appendChild(createCard(item, index));
    });
    refs.galleryGrid.appendChild(fragment);
    setGridVisible(true);
    setEmpty(false);
  }

  async function openImageFromCard(index) {
    const item = state.items[index];
    if (!item) return;

    const payload = {
      ...item,
      preview_url: normalizeImageUrl(item),
      original_url: normalizeImageUrl(item),
      detailLoader: async () => buildPublicDetail(item),
    };

    app.imageModal.openByPreference(payload, {
      detail: buildPublicDetail(item),
      detailLoader: async () => buildPublicDetail(item),
    });
  }

  async function load() {
    setLoading(true);
    setError("");
    setEmpty(false);

    try {
      const query = new URLSearchParams({
        page: String(state.page),
        per_page: String(state.perPage),
        sort: state.sort,
      });

      if (state.q) {
        query.set("q", state.q);
      }

      const payload = await app.api.get(`/api/images?${query.toString()}`);
      const list = extractListPayload(payload);
      state.items = list.items;
      state.total = Number(list.total || 0);
      state.hasNext = Boolean(list.hasNext);
      renderItems(list.items);
      syncGridColumnsUi();
      updateStatus();
    } catch (error) {
      setGridVisible(false);
      setEmpty(false);
      setError(error.message || "画像一覧の取得に失敗しました。");
      refs.statusText.textContent = "画像一覧を取得できませんでした。";
      app.toast.error(error.message || "画像一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  function scheduleSearch() {
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => {
      state.page = 1;
      state.q = refs.searchInput.value.trim();
      load();
    }, 300);
  }

  refs.galleryGrid.addEventListener("click", (event) => {
    const link = event.target.closest("[data-action='open-image']");
    if (!link) return;
    const article = link.closest(".home-gallery-card");
    const index = Number(article?.dataset.imageIndex);
    if (!Number.isFinite(index)) return;
    event.preventDefault();
    openImageFromCard(index);
  });

  refs.gridControls?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-grid-cols]");
    if (!button) return;
    const cols = Number(button.dataset.gridCols || 0);
    if (![1, 2, 3, 4].includes(cols)) return;
    state.gridCols = cols;
    writeStoredGridCols(cols);
    syncGridColumnsUi();
  });

  refs.searchInput?.addEventListener("input", scheduleSearch);
  refs.sortSelect?.addEventListener("change", () => {
    state.page = 1;
    state.sort = refs.sortSelect.value;
    load();
  });
  refs.perPageSelect?.addEventListener("change", () => {
    state.page = 1;
    state.perPage = Number(refs.perPageSelect.value || 24);
    load();
  });
  refs.reloadButton?.addEventListener("click", () => {
    load();
  });
  refs.prevPageButton?.addEventListener("click", () => {
    if (state.page <= 1) {
      return;
    }
    state.page -= 1;
    load();
  });
  refs.nextPageButton?.addEventListener("click", () => {
    if (!state.hasNext) {
      return;
    }
    state.page += 1;
    load();
  });

  gridMedia.addEventListener?.("change", () => {
    syncGridColumnsUi();
  });

  syncGridColumnsUi();
  load();
}
