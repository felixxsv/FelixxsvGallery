import { byId } from "../core/dom.js";

const GRID_COLS_STORAGE_KEY = "gallery.home.gridCols";
const MOBILE_GRID_MEDIA = "(max-width: 820px)";
const DEFAULT_GRID_COLS = 3;
const DEFAULT_ROW_COUNT = 30;

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
      perPage: DEFAULT_ROW_COUNT * DEFAULT_GRID_COLS,
      total: 0,
      hasNext: false,
    };
  }

  const items = root.items || root.images || root.records || root.results || [];
  const page = Number(root.page || root.current_page || 1);
  const perPage = Number(root.per_page || root.perPage || items.length || DEFAULT_ROW_COUNT * DEFAULT_GRID_COLS);
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function todayLocal() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function formatYmd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function monthRange(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    from: formatYmd(start),
    to: formatYmd(end),
  };
}

function thisMonthRange() {
  const now = todayLocal();
  return monthRange(now.getFullYear(), now.getMonth() + 1);
}

function thisYearRange() {
  const now = todayLocal();
  return {
    from: `${now.getFullYear()}-01-01`,
    to: `${now.getFullYear()}-12-31`,
  };
}

function rangeForPreset(preset) {
  if (preset === "this_month") {
    return thisMonthRange();
  }
  if (preset === "this_year") {
    return thisYearRange();
  }
  return { from: "", to: "" };
}

function monthKey(year, month) {
  return `${year}-${pad2(month)}`;
}

function detectMonthKey(from, to) {
  if (!from || !to) {
    return null;
  }
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return null;
  }
  if (
    fromDate.getFullYear() !== toDate.getFullYear() ||
    fromDate.getMonth() !== toDate.getMonth() ||
    fromDate.getDate() !== 1
  ) {
    return null;
  }
  const lastDay = new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0).getDate();
  if (toDate.getDate() !== lastDay) {
    return null;
  }
  return monthKey(fromDate.getFullYear(), fromDate.getMonth() + 1);
}

function maxPageFor(total, perPage) {
  if (!Number.isFinite(total) || total <= 0) {
    return 1;
  }
  if (!Number.isFinite(perPage) || perPage <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / perPage));
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

function createRandomSeed() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function activateSingleSelectButton(container, button, selector = "[data-ui-segment-button], [data-ui-option], [data-ui-shortcut]") {
  if (!container) {
    return;
  }
  const buttons = container.querySelectorAll(selector);
  for (const item of buttons) {
    const active = item === button;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  }
}

function clearSingleSelect(container, selector = "[data-ui-segment-button], [data-ui-option], [data-ui-shortcut]") {
  if (!container) {
    return;
  }
  for (const item of container.querySelectorAll(selector)) {
    item.classList.remove("is-active");
    item.setAttribute("aria-pressed", "false");
  }
}

function readActiveButton(container, selector = "[data-ui-segment-button], [data-ui-option], [data-ui-shortcut]") {
  return container?.querySelector(`${selector}.is-active`) || null;
}

export function initHomePage(app) {
  const refs = {
    searchInput: byId("homeSearchInput"),
    sortSelect: byId("homeSortSelect"),
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
    clearFiltersButton: byId("homeClearFiltersButton"),
    tagSearchInput: byId("homeTagSearchInput"),
    shortcutList: byId("homeShortcutList"),
    tagChipList: byId("homeTagChipList"),
    colorList: byId("homeColorList"),
    shotDateFrom: byId("homeShotDateFrom"),
    shotDateTo: byId("homeShotDateTo"),
    postedDateFrom: byId("homePostedDateFrom"),
    postedDateTo: byId("homePostedDateTo"),
    archiveList: byId("homeArchiveList"),
    archiveKindSegment: byId("homeArchiveKindSegment"),
  };

  const gridMedia = window.matchMedia(MOBILE_GRID_MEDIA);

  const state = {
    page: 1,
    rowCount: DEFAULT_ROW_COUNT,
    perPage: 0,
    sort: refs.sortSelect?.value || "latest",
    q: "",
    total: 0,
    hasNext: false,
    debounceTimer: null,
    items: [],
    gridCols: readStoredGridCols(),
    randomSeed: createRandomSeed(),
    archiveKind: "shot",
    archiveSelected: {
      shot: null,
      posted: null,
    },
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

  function computePerPage() {
    return state.rowCount * effectiveGridCols();
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

  function applyLayoutPageSize({ preserveAnchor = false } = {}) {
    const nextPerPage = computePerPage();
    const previousPerPage = state.perPage > 0 ? state.perPage : nextPerPage;

    if (state.perPage === nextPerPage) {
      return false;
    }

    const anchorIndex = preserveAnchor ? Math.max(0, (state.page - 1) * previousPerPage) : 0;
    state.perPage = nextPerPage;
    state.page = Math.min(maxPageFor(state.total, nextPerPage), Math.floor(anchorIndex / nextPerPage) + 1);
    return true;
  }

  function getSelectedValues(selector, attributeName = "value") {
    return Array.from(document.querySelectorAll(selector))
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset[attributeName] || "")
      .filter(Boolean);
  }

  function getFilterSnapshot() {
    const tagsModeButton = document.querySelector("[data-filter-mode='tags'] .home-segmented__button.is-active");
    const colorsModeButton = document.querySelector("[data-filter-mode='colors'] .home-segmented__button.is-active");
    const shortcutButton = readActiveButton(refs.shortcutList, "[data-ui-shortcut]");
    const archiveKindButton = readActiveButton(refs.archiveKindSegment, "[data-archive-kind]");

    return {
      q: refs.searchInput?.value.trim() || "",
      sort: refs.sortSelect?.value || "latest",
      shortcut: shortcutButton?.dataset.shortcut || null,
      tagsMode: tagsModeButton?.dataset.mode || "or",
      tagsSelected: getSelectedValues("[data-ui-chip][aria-pressed='true']", "value"),
      colorsMode: colorsModeButton?.dataset.mode || "or",
      colorsSelected: getSelectedValues("[data-ui-color][aria-pressed='true']", "value"),
      shotDateFrom: refs.shotDateFrom?.value || "",
      shotDateTo: refs.shotDateTo?.value || "",
      postedDateFrom: refs.postedDateFrom?.value || "",
      postedDateTo: refs.postedDateTo?.value || "",
      archiveKind: archiveKindButton?.dataset.archiveKind || state.archiveKind || "shot",
    };
  }

  function applyFiltersToQuery(query, filters, options = {}) {
    const {
      includeShot = true,
      includePosted = true,
      includeShortcut = true,
    } = options;

    if (filters.q) {
      query.set("q", filters.q);
    }

    if (filters.tagsSelected.length) {
      const key = filters.tagsMode === "and" ? "tags_all" : "tags_any";
      query.set(key, filters.tagsSelected.join(","));
    }

    if (filters.colorsSelected.length) {
      const key = filters.colorsMode === "and" ? "colors_all" : "colors_any";
      query.set(key, filters.colorsSelected.join(","));
    }

    if (includeShot) {
      if (filters.shotDateFrom) {
        query.set("shot_date_from", filters.shotDateFrom);
      }
      if (filters.shotDateTo) {
        query.set("shot_date_to", filters.shotDateTo);
      }
    }

    if (includePosted) {
      if (filters.postedDateFrom) {
        query.set("posted_date_from", filters.postedDateFrom);
      }
      if (filters.postedDateTo) {
        query.set("posted_date_to", filters.postedDateTo);
      }
    }

    if (includeShortcut && filters.shortcut && filters.shortcut !== "favorites") {
      query.set("shortcut", filters.shortcut);
    }
  }

  function setDateInputs(kind, from, to) {
    const fromInput = kind === "shot" ? refs.shotDateFrom : refs.postedDateFrom;
    const toInput = kind === "shot" ? refs.shotDateTo : refs.postedDateTo;
    if (fromInput) {
      fromInput.value = from || "";
    }
    if (toInput) {
      toInput.value = to || "";
    }
  }

  function clearArchiveSelection(kind) {
    state.archiveSelected[kind] = null;
    refs.archiveList?.querySelectorAll(`[data-archive-kind="${kind}"]`).forEach((button) => {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    });
  }

  function syncArchiveSelectionFromInputs(kind) {
    const from = kind === "shot" ? refs.shotDateFrom?.value || "" : refs.postedDateFrom?.value || "";
    const to = kind === "shot" ? refs.shotDateTo?.value || "" : refs.postedDateTo?.value || "";
    const key = detectMonthKey(from, to);
    state.archiveSelected[kind] = key;

    refs.archiveList?.querySelectorAll(`[data-archive-kind="${kind}"]`).forEach((button) => {
      const active = key === monthKey(Number(button.dataset.year || 0), Number(button.dataset.month || 0));
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function clearDatePresetSelection(kind) {
    const container = document.querySelector(`[data-date-presets="${kind}"]`);
    clearSingleSelect(container, "[data-ui-option]");
  }

  function setDatePresetSelection(kind, preset) {
    const container = document.querySelector(`[data-date-presets="${kind}"]`);
    const button = container?.querySelector(`[data-preset="${preset}"]`) || null;
    activateSingleSelectButton(container, button, "[data-ui-option]");
  }

  function applyDatePreset(kind, preset) {
    const range = rangeForPreset(preset);
    setDateInputs(kind, range.from, range.to);
    if (preset === "none") {
      setDatePresetSelection(kind, "none");
    } else {
      setDatePresetSelection(kind, preset);
    }
    clearArchiveSelection(kind);
    if (preset !== "none") {
      syncArchiveSelectionFromInputs(kind);
    }
  }

  function resetUiOnlyFilters() {
    document.querySelectorAll("[data-ui-segment][data-filter-mode], [data-date-presets]").forEach((container) => {
      const defaultButton = container.querySelector("[data-default]") || null;
      activateSingleSelectButton(container, defaultButton);
    });

    const archiveKindDefault = refs.archiveKindSegment?.querySelector("[data-default]") || null;
    activateSingleSelectButton(refs.archiveKindSegment, archiveKindDefault, "[data-archive-kind]");

    document.querySelectorAll("[data-ui-chip], [data-ui-color]").forEach((button) => {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
      button.hidden = false;
    });

    clearSingleSelect(refs.shortcutList, "[data-ui-shortcut]");
    refs.tagSearchInput.value = "";
    setDateInputs("shot", "", "");
    setDateInputs("posted", "", "");
    clearArchiveSelection("shot");
    clearArchiveSelection("posted");
    state.randomSeed = createRandomSeed();
  }

  function renderTagChips(items) {
    const selected = new Set(getSelectedValues("[data-ui-chip][aria-pressed='true']", "value"));
    refs.tagChipList.textContent = "";

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-filter-chip";
      button.dataset.uiChip = "";
      button.dataset.value = String(item.name || "");
      button.setAttribute("aria-pressed", selected.has(String(item.name || "")) ? "true" : "false");
      button.classList.toggle("is-active", selected.has(String(item.name || "")));
      button.textContent = String(item.name || "");
      if (Number.isFinite(Number(item.c))) {
        button.title = `${item.name} (${Number(item.c)}件)`;
      }
      fragment.appendChild(button);
    }

    refs.tagChipList.appendChild(fragment);
  }

  function renderColorButtons(items) {
    const selected = new Set(getSelectedValues("[data-ui-color][aria-pressed='true']", "value"));
    refs.colorList.textContent = "";

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const value = String(item.id ?? "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-filter-color";
      button.dataset.uiColor = "";
      button.dataset.value = value;
      button.style.setProperty("--filter-color", String(item.hex || "#94a3b8"));
      button.setAttribute("aria-label", String(item.name || value));
      button.setAttribute("title", String(item.name || value));
      button.setAttribute("aria-pressed", selected.has(value) ? "true" : "false");
      button.classList.toggle("is-active", selected.has(value));
      fragment.appendChild(button);
    }

    refs.colorList.appendChild(fragment);
  }

  function renderArchives(groups, kind) {
    refs.archiveList.textContent = "";

    if (!Array.isArray(groups) || !groups.length) {
      const empty = document.createElement("div");
      empty.className = "home-state-card";
      empty.textContent = "アーカイブ対象がありません。";
      refs.archiveList.appendChild(empty);
      return;
    }

    const selectedKey = state.archiveSelected[kind];
    const fragment = document.createDocumentFragment();

    groups.forEach((group, index) => {
      const details = document.createElement("details");
      details.className = "home-archive-year";
      details.open = index === 0;

      const summary = document.createElement("summary");
      summary.className = "home-archive-year__summary";
      summary.textContent = String(group.year);
      details.appendChild(summary);

      const months = document.createElement("div");
      months.className = "home-archive-months";
      months.dataset.uiOptionGroup = "";

      (group.months || []).forEach((monthInfo) => {
        const year = Number(group.year);
        const month = Number(monthInfo.month);
        const key = monthKey(year, month);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "home-archive-month";
        button.dataset.uiOption = "";
        button.dataset.archiveKind = kind;
        button.dataset.year = String(year);
        button.dataset.month = String(month);
        button.setAttribute("aria-pressed", String(selectedKey === key));
        button.classList.toggle("is-active", selectedKey === key);
        button.textContent = String(month);
        months.appendChild(button);
      });

      details.appendChild(months);
      fragment.appendChild(details);
    });

    refs.archiveList.appendChild(fragment);
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
    if (!item) {
      return;
    }

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

  async function loadArchives() {
    const filters = getFilterSnapshot();
    state.archiveKind = filters.archiveKind;

    const query = new URLSearchParams({
      kind: filters.archiveKind,
    });

    applyFiltersToQuery(query, filters, {
      includeShot: filters.archiveKind !== "shot",
      includePosted: filters.archiveKind !== "posted",
      includeShortcut: !(filters.archiveKind === "posted" && filters.shortcut === "current_month"),
    });

    try {
      const payload = await app.api.get(`/api/image-archives?${query.toString()}`);
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data?.items) ? payload.data.items : [];
      renderArchives(items, filters.archiveKind);
      syncArchiveSelectionFromInputs(filters.archiveKind);
    } catch {
      refs.archiveList.textContent = "";
      const empty = document.createElement("div");
      empty.className = "home-state-card home-state-card--error";
      empty.textContent = "アーカイブを取得できませんでした。";
      refs.archiveList.appendChild(empty);
    }
  }

  async function load({ retryIfPageOverflow = true } = {}) {
    setLoading(true);
    setError("");
    setEmpty(false);

    try {
      const filters = getFilterSnapshot();
      state.q = filters.q;
      state.sort = filters.sort;
      state.archiveKind = filters.archiveKind;

      const query = new URLSearchParams({
        page: String(state.page),
        per_page: String(state.perPage || computePerPage()),
        sort: filters.shortcut === "random" ? "random" : filters.sort,
      });

      applyFiltersToQuery(query, filters);

      if (filters.shortcut === "random") {
        query.set("random_seed", state.randomSeed);
      }

      const payload = await app.api.get(`/api/images?${query.toString()}`);
      const list = extractListPayload(payload);
      const actualPerPage = Number(list.perPage || state.perPage || computePerPage());
      const actualTotal = Number(list.total || 0);
      const actualPage = Number(list.page || state.page || 1);

      if (!list.items.length && actualTotal > 0 && actualPage > 1 && retryIfPageOverflow) {
        state.perPage = actualPerPage;
        state.total = actualTotal;
        state.page = maxPageFor(actualTotal, actualPerPage);
        await load({ retryIfPageOverflow: false });
        return;
      }

      state.page = actualPage;
      state.perPage = actualPerPage;
      state.items = list.items;
      state.total = actualTotal;
      state.hasNext = Boolean(list.hasNext ?? (state.page * state.perPage < state.total));

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

  async function reloadFromFilters() {
    state.page = 1;
    await Promise.all([load(), loadArchives()]);
  }

  function scheduleSearch() {
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = window.setTimeout(() => {
      reloadFromFilters();
    }, 300);
  }

  async function hydrateSidebarOptions() {
    try {
      const [tagsPayload, palettePayload] = await Promise.all([
        app.api.get("/api/tags?limit=200"),
        app.api.get("/api/palette"),
      ]);
      renderTagChips(Array.isArray(tagsPayload?.items) ? tagsPayload.items : []);
      renderColorButtons(Array.isArray(palettePayload?.items) ? palettePayload.items : []);
    } catch {
      renderTagChips([]);
      renderColorButtons([]);
    }
  }

  function bindSidebarEvents() {
    document.querySelectorAll("[data-ui-segment][data-filter-mode]").forEach((container) => {
      container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-ui-segment-button]");
        if (!button || !container.contains(button)) {
          return;
        }
        activateSingleSelectButton(container, button, "[data-ui-segment-button]");
        reloadFromFilters();
      });
    });

    document.querySelectorAll("[data-date-presets]").forEach((container) => {
      container.addEventListener("click", (event) => {
        const button = event.target.closest("[data-ui-option]");
        if (!button || !container.contains(button)) {
          return;
        }
        const kind = container.dataset.datePresets;
        applyDatePreset(kind, button.dataset.preset || "none");
        reloadFromFilters();
      });
    });

    refs.shortcutList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-ui-shortcut]");
      if (!button || !refs.shortcutList.contains(button)) {
        return;
      }

      const shortcut = button.dataset.shortcut || "";
      const alreadyActive = button.classList.contains("is-active");

      if (shortcut === "favorites") {
        refs.statusText.textContent = "お気に入りは後続対応予定です。";
        return;
      }

      if (shortcut === "random" && alreadyActive) {
        state.randomSeed = createRandomSeed();
        reloadFromFilters();
        return;
      }

      if (alreadyActive) {
        clearSingleSelect(refs.shortcutList, "[data-ui-shortcut]");
      } else {
        activateSingleSelectButton(refs.shortcutList, button, "[data-ui-shortcut]");
      }

      if (shortcut === "random") {
        state.randomSeed = createRandomSeed();
      }

      reloadFromFilters();
    });

    refs.tagChipList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-ui-chip]");
      if (!button || !refs.tagChipList.contains(button)) {
        return;
      }
      const next = button.getAttribute("aria-pressed") !== "true";
      button.classList.toggle("is-active", next);
      button.setAttribute("aria-pressed", String(next));
      reloadFromFilters();
    });

    refs.colorList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-ui-color]");
      if (!button || !refs.colorList.contains(button)) {
        return;
      }
      const next = button.getAttribute("aria-pressed") !== "true";
      button.classList.toggle("is-active", next);
      button.setAttribute("aria-pressed", String(next));
      reloadFromFilters();
    });

    refs.tagSearchInput?.addEventListener("input", () => {
      const needle = refs.tagSearchInput.value.trim().toLowerCase();
      refs.tagChipList?.querySelectorAll("[data-ui-chip]").forEach((button) => {
        const visible = !needle || button.textContent.toLowerCase().includes(needle);
        button.hidden = !visible;
      });
    });

    refs.clearFiltersButton?.addEventListener("click", () => {
      resetUiOnlyFilters();
      reloadFromFilters();
    });

    refs.archiveKindSegment?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-archive-kind]");
      if (!button || !refs.archiveKindSegment.contains(button)) {
        return;
      }
      activateSingleSelectButton(refs.archiveKindSegment, button, "[data-archive-kind]");
      state.archiveKind = button.dataset.archiveKind || "shot";
      loadArchives();
    });

    refs.archiveList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-archive-kind][data-year][data-month]");
      if (!button || !refs.archiveList.contains(button)) {
        return;
      }

      const kind = button.dataset.archiveKind || "shot";
      const year = Number(button.dataset.year || 0);
      const month = Number(button.dataset.month || 0);
      if (!year || !month) {
        return;
      }

      const key = monthKey(year, month);
      const alreadyActive = state.archiveSelected[kind] === key;

      if (alreadyActive) {
        state.archiveSelected[kind] = null;
        setDateInputs(kind, "", "");
        refs.archiveList.querySelectorAll(`[data-archive-kind="${kind}"]`).forEach((item) => {
          item.classList.remove("is-active");
          item.setAttribute("aria-pressed", "false");
        });
        setDatePresetSelection(kind, "none");
      } else {
        const range = monthRange(year, month);
        state.archiveSelected[kind] = key;
        setDateInputs(kind, range.from, range.to);
        clearDatePresetSelection(kind);
        refs.archiveList.querySelectorAll(`[data-archive-kind="${kind}"]`).forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
      }

      reloadFromFilters();
    });

    [refs.shotDateFrom, refs.shotDateTo].forEach((input) => {
      input?.addEventListener("change", () => {
        clearDatePresetSelection("shot");
        syncArchiveSelectionFromInputs("shot");
        reloadFromFilters();
      });
    });

    [refs.postedDateFrom, refs.postedDateTo].forEach((input) => {
      input?.addEventListener("change", () => {
        clearDatePresetSelection("posted");
        syncArchiveSelectionFromInputs("posted");
        reloadFromFilters();
      });
    });
  }

  refs.galleryGrid.addEventListener("click", (event) => {
    const link = event.target.closest("[data-action='open-image']");
    if (!link) {
      return;
    }
    const article = link.closest(".home-gallery-card");
    const index = Number(article?.dataset.imageIndex);
    if (!Number.isFinite(index)) {
      return;
    }
    event.preventDefault();
    openImageFromCard(index);
  });

  refs.gridControls?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-grid-cols]");
    if (!button) {
      return;
    }
    const cols = Number(button.dataset.gridCols || 0);
    if (![1, 2, 3, 4].includes(cols) || state.gridCols === cols) {
      return;
    }
    state.gridCols = cols;
    writeStoredGridCols(cols);
    applyLayoutPageSize({ preserveAnchor: true });
    syncGridColumnsUi();
    load();
  });

  refs.searchInput?.addEventListener("input", scheduleSearch);
  refs.sortSelect?.addEventListener("change", () => {
    state.page = 1;
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
    applyLayoutPageSize({ preserveAnchor: true });
    syncGridColumnsUi();
    load();
  });

  resetUiOnlyFilters();
  bindSidebarEvents();
  applyLayoutPageSize();
  syncGridColumnsUi();

  Promise.all([hydrateSidebarOptions(), loadArchives()]).finally(() => {
    load();
  });
}
