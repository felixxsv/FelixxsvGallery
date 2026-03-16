import { byId } from "../core/dom.js";

function textOrDash(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return String(value);
}

function normalizeImageUrl(image) {
  const candidates = [
    image.preview_path,
    image.thumb_path_960,
    image.thumb_path_480,
    image.thumb_path,
    image.image_url,
    image.url
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "string") {
      continue;
    }

    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      return candidate;
    }

    if (candidate.startsWith("/")) {
      return candidate;
    }

    return `/${candidate.replace(/^\/+/, "")}`;
  }

  if (image.id !== undefined && image.id !== null) {
    return `/media/original/${image.id}`;
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
      hasNext: false
    };
  }

  if (!root || typeof root !== "object") {
    return {
      items: [],
      page: 1,
      perPage: 24,
      total: 0,
      hasNext: false
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
    hasNext: Boolean(hasNext)
  };
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
    cardTemplate: byId("homeImageCardTemplate")
  };

  const state = {
    page: 1,
    perPage: Number(refs.perPageSelect.value || 24),
    sort: refs.sortSelect.value || "latest",
    q: "",
    total: 0,
    hasNext: false,
    debounceTimer: null
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

  function updateStatus() {
    const start = state.total === 0 ? 0 : (state.page - 1) * state.perPage + 1;
    const end = Math.min(state.page * state.perPage, state.total);

    refs.statusText.textContent = `検索: ${state.q ? `"${state.q}"` : "なし"} / 並び順: ${state.sort} / ${start}-${end}件 / 総件数 ${state.total}件`;
    refs.paginationMeta.textContent = `Page ${state.page}`;
    refs.prevPageButton.disabled = state.page <= 1;
    refs.nextPageButton.disabled = !state.hasNext;
  }

  function createCard(image) {
    const fragment = refs.cardTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".home-gallery-card");
    const link = fragment.querySelector("[data-card-link]");
    const imageNode = fragment.querySelector("[data-card-image]");
    const emptyNode = fragment.querySelector("[data-card-empty]");
    const titleNode = fragment.querySelector("[data-card-title]");
    const metaNode = fragment.querySelector("[data-card-meta]");

    const imageUrl = normalizeImageUrl(image);

    if (imageUrl) {
      link.href = imageUrl;
      imageNode.src = imageUrl;
      imageNode.alt = textOrDash(image.alt || image.title || "");
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

    for (const item of items) {
      fragment.appendChild(createCard(item));
    }

    refs.galleryGrid.appendChild(fragment);
    setGridVisible(true);
    setEmpty(false);
  }

  async function load() {
    setLoading(true);
    setError("");
    setEmpty(false);

    try {
      const query = new URLSearchParams({
        page: String(state.page),
        per_page: String(state.perPage),
        sort: state.sort
      });

      if (state.q) {
        query.set("q", state.q);
      }

      const payload = await app.api.get(`/api/images?${query.toString()}`);
      const list = extractListPayload(payload);

      state.total = Number(list.total || 0);
      state.hasNext = Boolean(list.hasNext);

      renderItems(list.items);
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

  refs.searchInput.addEventListener("input", scheduleSearch);

  refs.sortSelect.addEventListener("change", () => {
    state.page = 1;
    state.sort = refs.sortSelect.value;
    load();
  });

  refs.perPageSelect.addEventListener("change", () => {
    state.page = 1;
    state.perPage = Number(refs.perPageSelect.value || 24);
    load();
  });

  refs.reloadButton.addEventListener("click", () => {
    load();
  });

  refs.prevPageButton.addEventListener("click", () => {
    if (state.page <= 1) {
      return;
    }
    state.page -= 1;
    load();
  });

  refs.nextPageButton.addEventListener("click", () => {
    if (!state.hasNext) {
      return;
    }
    state.page += 1;
    load();
  });

  load();
}