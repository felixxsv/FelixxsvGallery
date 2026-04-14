import { byId, escapeHtml } from "../core/dom.js";
import { attachDatePicker } from "../core/date-picker.js";
import { languageToLocaleTag } from "../core/settings.js";

const GRID_COLS_STORAGE_KEY = "gallery.home.gridColumns";
const SORT_STORAGE_KEY = "gallery.home.sort";
const VALID_SORT_KEYS = ["popular", "shot_newest", "shot_oldest", "posted_newest", "posted_oldest"];
const MOBILE_GRID_MEDIA = "(max-width: 820px)";
const DEFAULT_GRID_COLS = 3;
const DEFAULT_ROW_COUNT = 30;

function normalizeUserKey(value) {
  const userKey = typeof value === "string" ? value.trim() : "";
  return userKey && userKey !== "-" ? userKey : "";
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, idx)) +
    `<mark class="home-tag-sug-mark">${escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
    escapeHtml(text.slice(idx + query.length))
  );
}

function getTagLetterGroup(tag) {
  const first = (tag || "")[0] || "";
  const code = first.charCodeAt(0);
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  const h = (code >= 0x30A1 && code <= 0x30F6) ? code - 0x60 : code;
  if (h >= 0x3041 && h <= 0x304A) return "あ";
  if (h >= 0x304B && h <= 0x3054) return "か";
  if (h >= 0x3055 && h <= 0x305E) return "さ";
  if (h >= 0x305F && h <= 0x3069) return "た";
  if (h >= 0x306A && h <= 0x306E) return "な";
  if (h >= 0x306F && h <= 0x307D) return "は";
  if (h >= 0x307E && h <= 0x3082) return "ま";
  if (h >= 0x3083 && h <= 0x3088) return "や";
  if (h >= 0x3089 && h <= 0x308D) return "ら";
  if (h >= 0x308E && h <= 0x3093) return "わ";
  return "#";
}

function buildTagChipGroups(items) {
  const order = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(
    ["あ","か","さ","た","な","は","ま","や","ら","わ","#"]
  );
  const sorted = [...items].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), ["ja", "en"], { sensitivity: "base" })
  );
  const map = new Map();
  for (const item of sorted) {
    const key = getTagLetterGroup(String(item.name || ""));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return order.filter((k) => map.has(k)).map((k) => ({ header: k, items: map.get(k) }));
}

function textOrDash(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }
  return String(value);
}

function formatDisplayDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return textOrDash(value);
  return new Intl.DateTimeFormat(languageToLocaleTag(document.documentElement.lang || "en-us"), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function withAppBase(path) {
  const appBase = document.body.dataset.appBase || "";
  if (!path) {
    return "";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("/")) {
    return path;
  }
  if (path.startsWith("storage/") || path.startsWith("media/") || path.startsWith("api/")) {
    return `${appBase}/${path}`;
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

function detectPreset(from, to) {
  if (!from && !to) {
    return "none";
  }

  const month = thisMonthRange();
  if (from === month.from && to === month.to) {
    return "this_month";
  }

  const year = thisYearRange();
  if (from === year.from && to === year.to) {
    return "this_year";
  }

  return null;
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
  const colorTags = Array.isArray(image.color_tags) && image.color_tags.length
    ? image.color_tags
    : Array.isArray(image.colors)
      ? image.colors.map((item) => ({
        id: item?.id ?? item?.color_id ?? null,
        label: item?.label || item?.name || (item?.color_id ? `Color ${item.color_id}` : "Color"),
        hex: item?.hex || item?.swatch || "",
        ratio: item?.ratio ?? null,
      }))
      : [];

  return {
    image_id: image.id ?? null,
    content_id: image.content_id || null,
    title: image.title || homeT("home.image.untitled", "Untitled"),
    alt: image.alt || "",
    posted_at: image.created_at || image.posted_at || image.shot_at || null,
    shot_at: image.shot_at || null,
    like_count: Number(image.like_count || 0),
    viewer_liked: Boolean(image.viewer_liked),
    view_count: Number(image.view_count || 0),
    tags: Array.isArray(image.tags) ? image.tags : [],
    color_tags: colorTags,
    file_size_bytes: image.file_size_bytes ?? null,
    image_width: image.image_width ?? image.width ?? null,
    image_height: image.image_height ?? image.height ?? null,
    user: image.user || {
      display_name: image.uploader_display_name || image.display_name || homeT("home.image.unknown_user", "Unknown uploader"),
      user_key: normalizeUserKey(image.uploader_user_key || image.user_key),
      avatar_url: withAppBase(image.uploader_avatar_url || image.uploader_avatar_path || image.avatar_url || ""),
    },
    viewer_permissions: image.viewer_permissions || null,
    owner_meta: image.owner_meta || null,
    admin_meta: image.admin_meta || null,
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

function readStoredSort() {
  try {
    const value = window.localStorage.getItem(SORT_STORAGE_KEY) || "";
    if (VALID_SORT_KEYS.includes(value)) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function writeStoredSort(value) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, String(value));
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

function isViewerLiked(image) {
  return Boolean(image?.viewer_liked);
}

function normalizeLikeCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function formatCount(value) {
  return normalizeLikeCount(value).toLocaleString(languageToLocaleTag(document.documentElement.lang || "en-us"));
}

function formatCompactCount(value) {
  const count = normalizeLikeCount(value);
  if (count < 1000) {
    return String(count);
  }
  if (count < 1_000_000) {
    return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1).replace(".0", "")}K`;
  }
  if (count < 1_000_000_000) {
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(".0", "")}M`;
  }
  return `${(count / 1_000_000_000).toFixed(count >= 10_000_000_000 ? 0 : 1).replace(".0", "")}B`;
}

function homeT(key, fallback, vars = {}) {
  try {
    return window.App?.i18n?.t?.(key, fallback, vars) || fallback;
  } catch {
    return fallback;
  }
}

function likeButtonLabel(liked) {
  return liked
    ? homeT("home.like.remove", "Unlike")
    : homeT("home.like.add", "Like");
}

function applyLikeButtonState(button, iconNode, countNode, image, pending = false) {
  if (!button) {
    return;
  }

  const liked = isViewerLiked(image);
  const count = normalizeLikeCount(image?.like_count);

  button.classList.toggle("is-active", liked);
  button.classList.toggle("is-pending", pending);
  button.setAttribute("aria-pressed", String(liked));
  button.setAttribute("aria-label", likeButtonLabel(liked));
  button.setAttribute("title", homeT("home.like.title", `${formatCount(count)} likes`, { count: formatCount(count) }));
  button.disabled = pending;

  if (iconNode) {
    iconNode.textContent = liked ? "♥" : "♡";
  }

  if (countNode) {
    countNode.textContent = formatCompactCount(count);
    countNode.dataset.countRaw = formatCount(count);
  }
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
    contentShell: document.querySelector(".home-shell-layout__content"),
    searchInput: byId("homeSearchInput"),
    sortSelect: byId("homeSortSelect"),
    sortField: byId("homeSortSelect")?.closest(".home-status__sort-field"),
    statusQuery: byId("homeStatusQuery"),
    statusSort: byId("homeStatusSort"),
    statusRange: byId("homeStatusRange"),
    statusTotal: byId("homeStatusTotal"),
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
    tagSugPanel: byId("homeTagSugPanel"),
    tagSugList: byId("homeTagSugList"),
    tagMoreBtn: byId("homeTagMoreBtn"),
    shortcutList: byId("homeShortcutList"),
    tagChipList: byId("homeTagChipList"),
    colorList: byId("homeColorList"),
    shotDateFrom: byId("homeShotDateFrom"),
    shotDateTo: byId("homeShotDateTo"),
    postedDateFrom: byId("homePostedDateFrom"),
    postedDateTo: byId("homePostedDateTo"),
    archiveList: byId("homeArchiveList"),
    archiveKindSegment: byId("homeArchiveKindSegment"),
    // Header search suggest
    searchSugPanel: byId("homeSearchSugPanel"),
    searchSugImages: byId("homeSearchSugImages"),
    searchSugImagesList: byId("homeSearchSugImagesList"),
    searchSugTags: byId("homeSearchSugTags"),
    searchSugTagsList: byId("homeSearchSugTagsList"),
    searchSugUsers: byId("homeSearchSugUsers"),
    searchSugUsersList: byId("homeSearchSugUsersList"),
    // Owner badge (desktop)
    searchOwnerBadge: byId("homeSearchOwnerBadge"),
    searchOwnerBadgeLabel: byId("homeSearchOwnerBadgeLabel"),
    searchOwnerBadgeClear: byId("homeSearchOwnerBadgeClear"),
    // Mobile toolbar + search modal
    mobileSearchBtn: byId("homeMobileSearchBtn"),
    mobileSortHost: byId("homeMobileSortHost"),
    mobileSearchModal: byId("homeMobileSearchModal"),
    mobileSearchInput: byId("homeMobileSearchInput"),
    mobileSearchClose: byId("homeMobileSearchClose"),
    mobileSearchSugPanel: byId("homeMobileSearchSugPanel"),
    mobileSearchSugImages: byId("homeMobileSearchSugImages"),
    mobileSearchSugImagesList: byId("homeMobileSearchSugImagesList"),
    mobileSearchSugTags: byId("homeMobileSearchSugTags"),
    mobileSearchSugTagsList: byId("homeMobileSearchSugTagsList"),
    mobileSearchSugUsers: byId("homeMobileSearchSugUsers"),
    mobileSearchSugUsersList: byId("homeMobileSearchSugUsersList"),
    mobileSearchOwnerBadge: byId("homeMobileSearchOwnerBadge"),
    mobileSearchOwnerBadgeLabel: byId("homeMobileSearchOwnerBadgeLabel"),
    mobileSearchOwnerBadgeClear: byId("homeMobileSearchOwnerBadgeClear"),
  };

  // Restore sort preference from localStorage
  const storedSort = readStoredSort();
  if (storedSort && refs.sortSelect) {
    refs.sortSelect.value = storedSort;
  }

  function updateSortVisibility() {
    const activeShortcut = readActiveButton(refs.shortcutList, "[data-ui-shortcut]")?.dataset.shortcut;
    if (refs.sortField) refs.sortField.style.visibility = activeShortcut === "random" ? "hidden" : "";
  }

  [
    refs.shotDateFrom,
    refs.shotDateTo,
    refs.postedDateFrom,
    refs.postedDateTo,
  ].forEach((input) => attachDatePicker(input, { getLocale: () => document.documentElement.lang || "en-US" }));

  function t(key, fallback = "", vars = {}) {
    return app.i18n?.t?.(key, fallback, vars) || fallback;
  }

  function applyStaticTranslations() {
    const uploadButton = byId("shellHeaderUploadButton");
    if (uploadButton) uploadButton.textContent = t("home.actions.upload", uploadButton.textContent || "Upload");
    if (refs.searchInput) refs.searchInput.placeholder = t("home.search.placeholder", refs.searchInput.placeholder || "");
    if (refs.mobileSearchInput) refs.mobileSearchInput.placeholder = t("home.search.placeholder", refs.mobileSearchInput.placeholder || "");
    if (refs.tagSearchInput) refs.tagSearchInput.placeholder = t("home.sidebar.tag_search", refs.tagSearchInput.placeholder || "");
    byId("homeSidebarToggle")?.setAttribute("aria-label", t("home.sidebar.open", "Open sidebar"));
    byId("homeSidebar")?.setAttribute("aria-label", t("home.sidebar.filter_aria", "Image list filters"));
    byId("homeSidebarClose")?.setAttribute("aria-label", t("home.sidebar.close", "Close sidebar"));

    const mappings = [
      [".home-sidebar__section-title", 0, "home.sidebar.shortcuts"],
      [".home-sidebar__section-title", 1, "home.sidebar.filters"],
      [".home-sidebar__section-title", 2, "home.sidebar.archive"],
      ["[data-shortcut][data-default]", 0, "home.sidebar.all"],
      ["[data-shortcut='current_month']", 0, "home.sidebar.current_month"],
      ["[data-shortcut='favorites']", 0, "home.sidebar.favorites"],
      ["[data-shortcut='random']", 0, "home.sidebar.random"],
      ["#homeClearFiltersButton", 0, "home.sidebar.clear"],
      [".home-filter-block__title", 0, "home.sidebar.tags"],
      [".home-filter-block__title", 1, "home.sidebar.colors"],
      [".home-filter-block__title", 2, "home.sidebar.shot_date"],
      [".home-filter-block__title", 3, "home.sidebar.posted_date"],
      ["[data-date-presets='shot'] [data-preset='none']", 0, "home.sidebar.none"],
      ["[data-date-presets='shot'] [data-preset='this_month']", 0, "home.sidebar.this_month"],
      ["[data-date-presets='shot'] [data-preset='this_year']", 0, "home.sidebar.this_year"],
      ["[data-date-presets='posted'] [data-preset='none']", 0, "home.sidebar.none"],
      ["[data-date-presets='posted'] [data-preset='this_month']", 0, "home.sidebar.this_month"],
      ["[data-date-presets='posted'] [data-preset='this_year']", 0, "home.sidebar.this_year"],
      ["[data-archive-kind='shot']", 0, "home.sidebar.archive_shot"],
      ["[data-archive-kind='posted']", 0, "home.sidebar.archive_posted"],
      [".home-mobile-toolbar__label", 0, "home.mobile.search"],
      [".home-mobile-toolbar__label", 1, "home.mobile.filter"],
      ["#homeSearchSugImages .home-search-sug-section__heading", 0, "home.search.images"],
      ["#homeSearchSugTags .home-search-sug-section__heading", 0, "home.search.tags"],
      ["#homeSearchSugUsers .home-search-sug-section__heading", 0, "home.search.users"],
      ["#homeMobileSearchSugImages .home-search-sug-section__heading", 0, "home.search.images"],
      ["#homeMobileSearchSugTags .home-search-sug-section__heading", 0, "home.search.tags"],
      ["#homeMobileSearchSugUsers .home-search-sug-section__heading", 0, "home.search.users"],
      [".home-status-chip__label", 0, "home.status.query"],
      [".home-status-chip__label", 1, "home.status.sort"],
      [".home-status-chip__label", 2, "home.status.showing"],
      [".home-status-chip__label", 3, "home.status.total"],
      ["#homeSortSelect option[value='popular']", 0, "home.sort.popular"],
      ["#homeSortSelect option[value='shot_newest']", 0, "home.sort.shot_newest"],
      ["#homeSortSelect option[value='shot_oldest']", 0, "home.sort.shot_oldest"],
      ["#homeSortSelect option[value='posted_newest']", 0, "home.sort.posted_newest"],
      ["#homeSortSelect option[value='posted_oldest']", 0, "home.sort.posted_oldest"],
      ["#homePrevPageButton", 0, "home.pagination.prev"],
      ["#homeNextPageButton", 0, "home.pagination.next"],
    ];

    for (const [selector, index, key] of mappings) {
      const node = Array.from(document.querySelectorAll(selector))[index];
      if (node) node.textContent = t(key, node.textContent || "");
    }

    const loadingMessage = refs.loadingState?.querySelector(".home-loading-state__message");
    if (loadingMessage) loadingMessage.textContent = t("home.loading", loadingMessage.textContent || "Loading");
    const emptyMessage = refs.emptyState?.querySelector(".home-empty-state__message");
    if (emptyMessage) emptyMessage.textContent = t("home.empty", emptyMessage.textContent || "No matching images found");

    for (const metaNode of refs.galleryGrid.querySelectorAll("[data-card-meta]")) {
      if (metaNode.dataset.date !== undefined) {
        metaNode.textContent = formatDisplayDateTime(metaNode.dataset.date);
      }
    }

    updateStatus();
  }

  const gridMedia = window.matchMedia(MOBILE_GRID_MEDIA);

  const state = {
    page: 1,
    rowCount: DEFAULT_ROW_COUNT,
    perPage: 0,
    sort: refs.sortSelect?.value || "popular",
    q: "",
    ownerUserKey: null,
    ownerDisplayName: null,
    total: 0,
    hasNext: false,
    debounceTimer: null,
    sugDebounceTimer: null,
    items: [],
    gridCols: readStoredGridCols(),
    randomSeed: createRandomSeed(),
    archiveKind: "shot",
    archiveSelected: {
      shot: null,
      posted: null,
    },
    pendingLikeIds: new Set(),
    tagPool: [],
    tagBrowseMounted: false,
  };

  function setLoading(loading) {
    refs.loadingState.hidden = !loading;
    syncEmptyLayoutClass();
  }

  function setError(message) {
    refs.errorState.hidden = !message;
    refs.errorState.textContent = message || "";
    syncEmptyLayoutClass();
  }

  function setEmpty(visible) {
    refs.emptyState.hidden = !visible;
    syncEmptyLayoutClass();
  }

  function setGridVisible(visible) {
    refs.galleryGrid.hidden = !visible;
    syncEmptyLayoutClass();
  }

  function syncEmptyLayoutClass() {
    if (!refs.contentShell) {
      return;
    }
    const hasGrid = !refs.galleryGrid.hidden;
    const hasLoading = !refs.loadingState.hidden;
    const hasError = !refs.errorState.hidden;
    const hasEmpty = !refs.emptyState.hidden;
    refs.contentShell.classList.toggle("is-home-empty-layout", !hasGrid && (hasLoading || hasError || hasEmpty));
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
      ownerUserKey: state.ownerUserKey || null,
      sort: refs.sortSelect?.value || "popular",
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

    if (filters.ownerUserKey) {
      query.set("owner_user_key", filters.ownerUserKey);
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

    if (includeShortcut && filters.shortcut) {
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

  function syncDateFilterUi(kind) {
    const from = kind === "shot" ? refs.shotDateFrom?.value || "" : refs.postedDateFrom?.value || "";
    const to = kind === "shot" ? refs.shotDateTo?.value || "" : refs.postedDateTo?.value || "";
    const preset = detectPreset(from, to);

    if (preset) {
      setDatePresetSelection(kind, preset);
    } else {
      clearDatePresetSelection(kind);
    }

    syncArchiveSelectionFromInputs(kind);
  }

  function setDatePresetSelection(kind, preset) {
    const container = document.querySelector(`[data-date-presets="${kind}"]`);
    const button = container?.querySelector(`[data-preset="${preset}"]`) || null;
    activateSingleSelectButton(container, button, "[data-ui-option]");
  }

  function applyDatePreset(kind, preset) {
    const range = rangeForPreset(preset);
    setDateInputs(kind, range.from, range.to);
    setDatePresetSelection(kind, preset === "none" ? "none" : preset);
    clearArchiveSelection(kind);
    syncDateFilterUi(kind);
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

    const shortcutDefault = refs.shortcutList?.querySelector("[data-default]") || null;
    activateSingleSelectButton(refs.shortcutList, shortcutDefault, "[data-ui-shortcut]");
    refs.tagSearchInput.value = "";
    setDateInputs("shot", "", "");
    setDateInputs("posted", "", "");
    clearArchiveSelection("shot");
    clearArchiveSelection("posted");
    state.randomSeed = createRandomSeed();
    clearOwnerFilter();
  }

  // ── Owner filter ────────────────────────────────────────────────────────

  function clearOwnerFilter() {
    state.ownerUserKey = null;
    state.ownerDisplayName = null;
    syncOwnerBadge();
  }

  function applyOwnerFilter(userKey, displayName) {
    state.ownerUserKey = userKey;
    state.ownerDisplayName = displayName || userKey;
    if (refs.searchInput) refs.searchInput.value = "";
    if (refs.mobileSearchInput) refs.mobileSearchInput.value = "";
    syncOwnerBadge();
    closeMobileSearchModal(false);
    closeSearchSug(refs.searchSugPanel);
    closeSearchSug(refs.mobileSearchSugPanel);
    reloadFromFilters();
  }

  function syncOwnerBadge() {
    const label = state.ownerDisplayName ? `@${state.ownerDisplayName}` : null;
    for (const [badge, badgeLabel] of [
      [refs.searchOwnerBadge, refs.searchOwnerBadgeLabel],
      [refs.mobileSearchOwnerBadge, refs.mobileSearchOwnerBadgeLabel],
    ]) {
      if (!badge) continue;
      badge.hidden = !label;
      if (badgeLabel) badgeLabel.textContent = label || "";
    }
    // Adjust input padding to accommodate badge width dynamically
    if (refs.searchOwnerBadge && refs.searchInput) {
      if (label) {
        const badgeWidth = refs.searchOwnerBadge.getBoundingClientRect().width || 0;
        refs.searchInput.style.paddingLeft = `${36 + badgeWidth + 8}px`;
      } else {
        refs.searchInput.style.paddingLeft = "";
      }
    }
  }

  // ── Search suggest ───────────────────────────────────────────────────────

  function closeSearchSug(panel) {
    if (panel) panel.hidden = true;
  }

  function renderSearchSug(data, panelRefs) {
    const { panel, imagesSection, imagesList, tagsSection, tagsList, usersSection, usersList } = panelRefs;
    if (!panel) return;

    const images = data?.images || [];
    const tags = data?.tags || [];
    const users = data?.users || [];
    const q = panel.dataset.query || "";
    const allEmpty = !images.length && !tags.length && !users.length;

    function renderSection(section, list, items, renderItem) {
      if (!section) return;
      section.hidden = false;
      if (!list) return;
      list.textContent = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "home-search-sug-empty";
        empty.textContent = t("home.search.none", "No matches");
        list.appendChild(empty);
      } else {
        for (const item of items) renderItem(list, item);
      }
    }

    if (allEmpty) {
      // Hide individual sections, show single "no results" message
      if (imagesSection) imagesSection.hidden = true;
      if (tagsSection) tagsSection.hidden = true;
      if (usersSection) usersSection.hidden = true;
      // Reuse imagesSection or create a fallback message inside panel
      let noResult = panel.querySelector(".home-search-sug-noresult");
      if (!noResult) {
        noResult = document.createElement("div");
        noResult.className = "home-search-sug-noresult";
        panel.appendChild(noResult);
      }
      noResult.hidden = false;
      noResult.textContent = t("home.search.no_results", `No images, tags, or users matched “${q}”.`, { query: q });
    } else {
      const noResult = panel.querySelector(".home-search-sug-noresult");
      if (noResult) noResult.hidden = true;

      renderSection(imagesSection, imagesList, images, (list, img) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "home-search-sug-item";
        btn.dataset.action = "sug-image";
        btn.dataset.title = img.title || "";
        if (img.thumb_path) {
          const thumbUrl = withAppBase(img.thumb_path);
          btn.innerHTML = `<img class="home-search-sug-item__thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy"><span class="home-search-sug-item__text">${highlightMatch(img.title || "", q)}</span>`;
        } else {
          btn.innerHTML = `<span class="home-search-sug-item__text">${highlightMatch(img.title || "", q)}</span>`;
        }
        list.appendChild(btn);
      });

      renderSection(tagsSection, tagsList, tags, (list, tag) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "home-search-sug-item";
        btn.dataset.action = "sug-tag";
        btn.dataset.tag = tag.name || "";
        const thumbHtml = tag.thumb_path
          ? `<img class="home-search-sug-item__thumb" src="${escapeHtml(withAppBase(tag.thumb_path))}" alt="" loading="lazy">`
          : `<span class="home-search-sug-item__thumb home-search-sug-item__thumb--tag">#</span>`;
        btn.innerHTML = `${thumbHtml}<span class="home-search-sug-item__text">${highlightMatch(tag.name || "", q)}</span><span class="home-search-sug-item__sub">${escapeHtml(String(tag.count || 0))}</span>`;
        list.appendChild(btn);
      });

      renderSection(usersSection, usersList, users, (list, user) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "home-search-sug-item";
        btn.dataset.action = "sug-user";
        btn.dataset.userKey = user.user_key || "";
        btn.dataset.displayName = user.display_name || "";
        const initial = escapeHtml((user.display_name || user.user_key || "?")[0].toUpperCase());
        const avatarHtml = user.avatar_path
          ? `<img class="home-search-sug-item__thumb home-search-sug-item__thumb--avatar" src="${escapeHtml(withAppBase(user.avatar_path))}" alt="">`
          : `<span class="home-search-sug-item__thumb home-search-sug-item__thumb--avatar home-search-sug-item__thumb--initial">${initial}</span>`;
        btn.innerHTML = `${avatarHtml}<span class="home-search-sug-item__text">${highlightMatch(user.display_name || "", q)}</span><span class="home-search-sug-item__sub">@${escapeHtml(user.user_key || "")}</span>`;
        list.appendChild(btn);
      });
    }

    panel.hidden = false;
  }

  function handleSugClick(event, panelRefs) {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "sug-image") {
      const title = btn.dataset.title || "";
      if (refs.searchInput) refs.searchInput.value = title;
      if (refs.mobileSearchInput) refs.mobileSearchInput.value = title;
      closeSearchSug(panelRefs.panel);
      closeMobileSearchModal(true);
      reloadFromFilters();
    } else if (action === "sug-tag") {
      const tagName = btn.dataset.tag || "";
      const chip = refs.tagChipList?.querySelector(`[data-ui-chip][data-value="${CSS.escape(tagName)}"]`);
      if (chip) {
        chip.classList.add("is-active");
        chip.setAttribute("aria-pressed", "true");
        renderTagChips(state.tagPool);
      }
      closeSearchSug(panelRefs.panel);
      closeMobileSearchModal(true);
      reloadFromFilters();
    } else if (action === "sug-user") {
      applyOwnerFilter(btn.dataset.userKey, btn.dataset.displayName);
    }
  }

  document.addEventListener("app:filter-by-owner", (event) => {
    const { userKey, displayName } = event.detail || {};
    if (userKey) applyOwnerFilter(userKey, displayName);
  });

  function scheduleSugFetch(q, panelRefs) {
    window.clearTimeout(state.sugDebounceTimer);
    if (!q || q.length < 1) {
      closeSearchSug(panelRefs.panel);
      return;
    }
    state.sugDebounceTimer = window.setTimeout(async () => {
      try {
        const data = await app.api.get(`/api/search-suggest?q=${encodeURIComponent(q)}`);
        if (panelRefs.panel) panelRefs.panel.dataset.query = q;
        renderSearchSug(data, panelRefs);
      } catch {
        closeSearchSug(panelRefs.panel);
      }
    }, 250);
  }

  // ── Mobile search modal ─────────────────────────────────────────────────

  function openMobileSearchModal() {
    if (!refs.mobileSearchModal) return;
    refs.mobileSearchModal.hidden = false;
    document.body.classList.add("is-home-mobile-search-open");
    syncOwnerBadge();
    setTimeout(() => refs.mobileSearchInput?.focus(), 40);
  }

  function closeMobileSearchModal(executeSearch) {
    if (!refs.mobileSearchModal) return;
    refs.mobileSearchModal.hidden = true;
    document.body.classList.remove("is-home-mobile-search-open");
    closeSearchSug(refs.mobileSearchSugPanel);
    if (executeSearch && refs.mobileSearchInput && refs.searchInput) {
      refs.searchInput.value = refs.mobileSearchInput.value;
    }
  }

  // ── Tag chips ─────────────────────────────────────────────────────────────

  function renderTagChips(items) {
    const selected = new Set(getSelectedValues("[data-ui-chip][aria-pressed='true']", "value"));
    refs.tagChipList.textContent = "";

    // Selected tags first, then rest in popularity order (API already returns by count DESC)
    const sorted = [
      ...items.filter((t) => selected.has(String(t.name || ""))),
      ...items.filter((t) => !selected.has(String(t.name || ""))),
    ];

    const fragment = document.createDocumentFragment();
    for (const item of sorted) {
      const name = String(item.name || "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "home-filter-chip";
      button.dataset.uiChip = "";
      button.dataset.value = name;
      button.setAttribute("aria-pressed", selected.has(name) ? "true" : "false");
      button.classList.toggle("is-active", selected.has(name));
      button.textContent = name;
      button.title = Number.isFinite(Number(item.c))
        ? t("home.tags.count", "{name} ({count} items)", { name, count: Number(item.c) })
        : name;
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

  // ── Tag suggestion & browse modal ─────────────────────────────────────────

  function renderHomeSug(needle) {
    if (!refs.tagSugList) return;
    const q = (needle || "").trim().toLowerCase();
    if (!q) {
      if (refs.tagSugPanel) refs.tagSugPanel.hidden = true;
      return;
    }
    const selected = new Set(getSelectedValues("[data-ui-chip][aria-pressed='true']", "value"));
    const results = state.tagPool
      .filter((t) => !selected.has(String(t.name || "")) && String(t.name || "").toLowerCase().includes(q))
      .slice(0, 12);
    refs.tagSugList.innerHTML = "";
    for (const item of results) {
      const name = String(item.name || "");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "home-tag-sug-item";
      btn.dataset.tag = name;
      btn.innerHTML = highlightMatch(name, q);
      refs.tagSugList.appendChild(btn);
    }
    if (refs.tagSugPanel) refs.tagSugPanel.hidden = results.length === 0;
  }

  function closeHomeSug() {
    if (refs.tagSugPanel) refs.tagSugPanel.hidden = true;
  }

  const HOME_TAG_BROWSE_ID = "home-tag-browse-modal";

  function ensureHomeBrowseMounted() {
    if (state.tagBrowseMounted) return;
    const modalRoot = document.getElementById("appModalRoot");
    if (!modalRoot) return;
    if (!modalRoot.querySelector(`[data-modal-id="${HOME_TAG_BROWSE_ID}"]`)) {
      const layer = document.createElement("section");
      layer.className = "app-modal-layer";
      layer.setAttribute("data-modal-layer", "");
      layer.setAttribute("data-modal-id", HOME_TAG_BROWSE_ID);
      layer.hidden = true;
      layer.innerHTML = `
        <div class="app-modal-backdrop" data-modal-backdrop="${HOME_TAG_BROWSE_ID}"></div>
        <div class="app-modal-dialog app-modal-dialog--tag-browse" role="dialog" aria-modal="true" tabindex="-1">
          <div class="app-modal-header">
            <h2 class="app-modal-title">${escapeHtml(t("home.tags.browse_title", "Select Tags"))}</h2>
            <button type="button" class="app-modal-close" id="homeTagBrowseClose" aria-label="${escapeHtml(t("home.tags.browse_close", "Close"))}">×</button>
          </div>
          <div class="tag-browse-modal__search-wrap">
            <input id="homeTagBrowseSearch" class="app-input tag-browse-modal__search" type="search" placeholder="${escapeHtml(t("home.tags.browse_search", "Search tags..."))}" autocomplete="off">
            <div class="tag-browse-modal__sug" id="homeTagBrowseSug" hidden>
              <div class="tag-browse-modal__sug-list" id="homeTagBrowseSugList"></div>
            </div>
          </div>
          <div class="app-modal-body tag-browse-modal">
            <div id="homeTagBrowseList" class="tag-browse-modal__list"></div>
          </div>
        </div>
      `;
      modalRoot.appendChild(layer);
    }
    app.modal?.refresh?.();

    const layer = modalRoot.querySelector(`[data-modal-id="${HOME_TAG_BROWSE_ID}"]`);
    if (!layer) return;

    const browseSearch = document.getElementById("homeTagBrowseSearch");
    const browseSug = document.getElementById("homeTagBrowseSug");
    const browseSugList = document.getElementById("homeTagBrowseSugList");
    const browseList = document.getElementById("homeTagBrowseList");
    const browseClose = document.getElementById("homeTagBrowseClose");
    const browseBackdrop = modalRoot.querySelector(`[data-modal-backdrop="${HOME_TAG_BROWSE_ID}"]`);

    function renderBrowseSug(q) {
      if (!browseSugList) return;
      const needle = (q || "").trim().toLowerCase();
      if (!needle) { if (browseSug) browseSug.hidden = true; return; }
      const selected = new Set(getSelectedValues("[data-ui-chip][aria-pressed='true']", "value"));
      const results = state.tagPool
        .filter((t) => String(t.name || "").toLowerCase().includes(needle))
        .slice(0, 10);
      browseSugList.innerHTML = "";
      for (const item of results) {
        const name = String(item.name || "");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `tag-browse-modal__sug-item${selected.has(name) ? " is-selected" : ""}`;
        btn.dataset.tag = name;
        btn.innerHTML = highlightMatch(name, needle);
        browseSugList.appendChild(btn);
      }
      if (browseSug) browseSug.hidden = results.length === 0;
    }

    function renderBrowseList(q) {
      if (!browseList) return;
      const needle = (q || "").trim().toLowerCase();
      const pool = needle
        ? state.tagPool.filter((t) => String(t.name || "").toLowerCase().includes(needle))
        : state.tagPool;
      const sorted = [...pool].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), ["ja", "en"], { sensitivity: "base" })
      );
      browseList.innerHTML = "";
      if (!sorted.length) {
        browseList.innerHTML = `<p class="tag-browse-modal__empty">${escapeHtml(t("home.tags.browse_empty", "No tags found"))}</p>`;
        return;
      }
      const groups = buildTagChipGroups(sorted);
      const frag = document.createDocumentFragment();
      for (const { header, items: groupItems } of groups) {
        const section = document.createElement("div");
        section.className = "tag-browse-modal__group";
        const h = document.createElement("div");
        h.className = "tag-browse-modal__group-header";
        h.textContent = header;
        section.appendChild(h);
        const row = document.createElement("div");
        row.className = "tag-browse-modal__group-tags";
        const selected = new Set(getSelectedValues("[data-ui-chip][aria-pressed='true']", "value"));
        for (const item of groupItems) {
          const name = String(item.name || "");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `tag-browse-modal__tag-btn${selected.has(name) ? " is-selected" : ""}`;
          btn.dataset.tag = name;
          btn.setAttribute("aria-pressed", selected.has(name) ? "true" : "false");
          btn.innerHTML = needle ? highlightMatch(name, needle) : escapeHtml(name);
          row.appendChild(btn);
        }
        section.appendChild(row);
        frag.appendChild(section);
      }
      browseList.appendChild(frag);
    }

    function toggleBrowseTag(name) {
      const chip = refs.tagChipList?.querySelector(`[data-ui-chip][data-value="${CSS.escape(name)}"]`);
      if (chip) {
        const next = chip.getAttribute("aria-pressed") !== "true";
        chip.classList.toggle("is-active", next);
        chip.setAttribute("aria-pressed", String(next));
        renderTagChips(state.tagPool);
        reloadFromFilters();
      }
    }

    browseSearch?.addEventListener("input", () => {
      const q = browseSearch.value || "";
      renderBrowseSug(q);
      renderBrowseList(q);
    });
    browseSugList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag]");
      if (!btn) return;
      toggleBrowseTag(btn.dataset.tag);
      renderBrowseList(browseSearch?.value || "");
      renderBrowseSug(browseSearch?.value || "");
    });
    browseList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag]");
      if (!btn) return;
      toggleBrowseTag(btn.dataset.tag);
      renderBrowseList(browseSearch?.value || "");
    });
    browseClose?.addEventListener("click", () => app.modal?.close?.(HOME_TAG_BROWSE_ID));
    browseBackdrop?.addEventListener("click", () => app.modal?.close?.(HOME_TAG_BROWSE_ID));

    layer.dataset.browseReady = "1";
    state.tagBrowseMounted = true;

    // Save render functions on layer for reuse
    layer._renderList = renderBrowseList;
    layer._renderSug = renderBrowseSug;
    const searchEl = browseSearch;
    layer._open = () => {
      if (searchEl) searchEl.value = "";
      renderBrowseSug("");
      renderBrowseList("");
      app.modal?.open?.(HOME_TAG_BROWSE_ID);
      setTimeout(() => searchEl?.focus(), 60);
    };
  }

  function openHomeBrowseModal() {
    ensureHomeBrowseMounted();
    const layer = document.getElementById("appModalRoot")?.querySelector(`[data-modal-id="${HOME_TAG_BROWSE_ID}"]`);
    if (layer?._open) layer._open();
  }

  function renderArchives(groups, kind) {
    refs.archiveList.textContent = "";

    if (!Array.isArray(groups) || !groups.length) {
      const empty = document.createElement("div");
      empty.className = "home-state-card";
      empty.textContent = t("home.archive.empty", "No archive entries available.");
      refs.archiveList.appendChild(empty);
      return;
    }

    const selectedKey = state.archiveSelected[kind];
    const fragment = document.createDocumentFragment();

    groups.forEach((group) => {
      const details = document.createElement("details");
      details.className = "home-archive-year";
      const hasSelectedMonth = Array.isArray(group.months)
        ? group.months.some((monthInfo) => monthKey(Number(group.year), Number(monthInfo.month)) === selectedKey)
        : false;
      details.open = Boolean(selectedKey && hasSelectedMonth);

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
    const maxPage = Math.max(1, Math.ceil(state.total / Math.max(1, state.perPage)));
    const sortLabels = {
      popular: t("home.sort.popular", "Popular"),
      shot_newest: t("home.sort.shot_newest", "Shot date (newest)"),
      shot_oldest: t("home.sort.shot_oldest", "Shot date (oldest)"),
      posted_newest: t("home.sort.posted_newest", "Posted date (newest)"),
      posted_oldest: t("home.sort.posted_oldest", "Posted date (oldest)"),
      random: t("home.sort.random", "Random"),
    };
    if (refs.statusQuery) {
      refs.statusQuery.textContent = state.q ? `"${state.q}"` : t("home.status.none", "None");
    }
    if (refs.statusSort) {
      refs.statusSort.textContent = sortLabels[state.sort] || state.sort || t("home.sort.latest", "Latest");
    }
    if (refs.statusRange) {
      refs.statusRange.textContent = t("home.status.range", `${start}-${end} items`, { start, end });
    }
    if (refs.statusTotal) {
      refs.statusTotal.textContent = t("home.status.total_count", `${state.total} items`, { count: state.total });
    }
    refs.paginationMeta.textContent = t("home.pagination.meta", `${state.page} / ${maxPage} pages`, { page: state.page, maxPage });
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
    const userButton = fragment.querySelector("[data-card-user]");
    const likeButton = fragment.querySelector("[data-action='toggle-like']");
    const likeIcon = fragment.querySelector("[data-card-like-icon]");
    const likeCount = fragment.querySelector("[data-card-like-count]");
    const badge = fragment.querySelector("[data-card-badge]");
    const badgeCount = fragment.querySelector("[data-card-image-count]");
    const visibilityBadge = fragment.querySelector("[data-card-visibility-badge]");
    const imageUrl = normalizeImageUrl(image);
    const imageCount = Math.max(1, Number(image.image_count || 1));

    article.dataset.imageIndex = String(index);
    article.dataset.imageId = String(image.thumbnail_image_id ?? image.id ?? "");
    article.dataset.contentId = String(image.content_id ?? `i-${image.id ?? ""}`);

    if (imageUrl) {
      link.href = imageUrl;
      link.dataset.action = "open-image";
      imageNode.src = imageUrl;
      imageNode.alt = textOrDash(image.alt || image.title || "");
      imageNode.style.objectPosition = `${image.focal_x ?? 50}% ${image.focal_y ?? 50}%`;
      imageNode.hidden = false;
      emptyNode.hidden = true;
    } else {
      link.href = "#";
      imageNode.hidden = true;
      emptyNode.hidden = false;
    }

    if (badge && badgeCount) {
      badge.hidden = imageCount <= 1;
      badgeCount.textContent = String(imageCount);
      badge.setAttribute("aria-label", t("home.image.count", `${imageCount} images`, { count: imageCount }));
    }
    if (visibilityBadge) {
      visibilityBadge.hidden = image.visibility !== "private";
    }

    titleNode.textContent = textOrDash(image.title || image.alt || `image-${image.id ?? ""}`);
    const rawDate = image.shot_at || image.created_at || image.date || "";
    metaNode.dataset.date = rawDate;
    metaNode.textContent = formatDisplayDateTime(rawDate);

    const detail = buildPublicDetail(image);
    const user = detail.user || {};
    if (userButton) {
      const userKey = normalizeUserKey(user.user_key);
      if (userKey) {
        userButton.dataset.userKey = userKey;
        userButton.setAttribute("aria-label", t("home.profile.open", `${user.display_name || userKey}'s profile`, { name: user.display_name || userKey }));
        userButton.hidden = false;
        const avatarEl = userButton.querySelector("[data-card-user-avatar]");
        if (avatarEl) {
          if (user.avatar_url) {
            avatarEl.innerHTML = `<img src="${escapeHtml(user.avatar_url)}" alt="">`;
          } else {
            avatarEl.textContent = (user.display_name || "?").slice(0, 1).toUpperCase();
          }
        }
      } else {
        userButton.dataset.userKey = "";
        userButton.hidden = true;
      }
    }

    applyLikeButtonState(likeButton, likeIcon, likeCount, image, state.pendingLikeIds.has(String(image.id ?? "")));
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


  function getItemById(imageId) {
    return state.items.find((item) => Number(item.id) === Number(imageId)) || null;
  }

  function syncCardLikeState(imageId) {
    const item = getItemById(imageId);
    if (!item) {
      return;
    }

    refs.galleryGrid.querySelectorAll(`.home-gallery-card[data-image-id="${CSS.escape(String(imageId))}"]`).forEach((article) => {
      const button = article.querySelector("[data-action='toggle-like']");
      const iconNode = article.querySelector("[data-card-like-icon]");
      const countNode = article.querySelector("[data-card-like-count]");
      applyLikeButtonState(button, iconNode, countNode, item, state.pendingLikeIds.has(String(imageId)));
    });
  }

  function syncImageLikeState(imageId, nextState = {}) {
    const item = getItemById(imageId);
    if (!item) {
      return null;
    }

    if (nextState.viewer_liked !== undefined) {
      item.viewer_liked = Boolean(nextState.viewer_liked);
    }

    if (nextState.like_count !== undefined) {
      item.like_count = normalizeLikeCount(nextState.like_count);
    }

    syncCardLikeState(imageId);

    if (typeof app.imageModal?.updateLikeState === "function") {
      app.imageModal.updateLikeState(imageId, {
        viewer_liked: item.viewer_liked,
        like_count: item.like_count,
      });
    }

    return item;
  }

  function syncOwnedContentState(nextState = {}) {
    const contentId = String(nextState.content_id || "").trim();
    if (!contentId) {
      return;
    }

    let changed = false;
    state.items = state.items.filter((item) => {
      const itemContentId = String(item.content_id || `i-${item.id ?? ""}`);
      if (itemContentId !== contentId) {
        return true;
      }
      changed = true;
      if (nextState.status === "deleted") {
        return false;
      }
      item.visibility = nextState.visibility || item.visibility || "public";
      item.owner_meta = {
        ...(item.owner_meta || {}),
        ...(nextState.owner_meta || {}),
      };
      item.viewer_permissions = nextState.viewer_permissions || item.viewer_permissions || null;
      return true;
    });

    if (!changed) {
      return;
    }

    state.total = nextState.status === "deleted" ? Math.max(0, state.total - 1) : state.total;
    renderItems(state.items);
    updateStatus();
  }

  async function fetchImageDetail(item) {
    if (!item?.id) {
      return buildPublicDetail(item || {});
    }

    try {
      const payload = await app.api.get(`/api/images/${item.id}`);
      const detail = {
        ...item,
        ...(payload?.data ?? payload ?? {}),
      };
      return buildPublicDetail(detail);
    } catch {
      return buildPublicDetail(item);
    }
  }

  function requireLikeAuth() {
    const sessionState = app.session?.getState?.() || { authenticated: false };
    if (sessionState.authenticated) {
      return true;
    }
    app.toast.error(t("home.like.auth_required", "Likes are available after login."));
    return false;
  }

  async function toggleLikeById(imageId) {
    const item = getItemById(imageId);
    if (!item) {
      return;
    }

    if (!requireLikeAuth()) {
      return;
    }

    const key = String(imageId);
    if (state.pendingLikeIds.has(key)) {
      return;
    }

    const nextLiked = !isViewerLiked(item);
    const nextCount = Math.max(0, normalizeLikeCount(item.like_count) + (nextLiked ? 1 : -1));

    state.pendingLikeIds.add(key);
    syncCardLikeState(imageId);
    if (typeof app.imageModal?.setLikePending === "function") {
      app.imageModal.setLikePending(imageId, true);
    }

    const previousState = {
      viewer_liked: Boolean(item.viewer_liked),
      like_count: normalizeLikeCount(item.like_count),
    };

    syncImageLikeState(imageId, { viewer_liked: nextLiked, like_count: nextCount });

    try {
      const payload = nextLiked
        ? await app.api.post(`/api/images/${imageId}/like`, {})
        : await app.api.delete(`/api/images/${imageId}/like`, {});

      const responseState = payload?.data ?? payload ?? {};
      syncImageLikeState(imageId, {
        viewer_liked: responseState.viewer_liked ?? nextLiked,
        like_count: responseState.like_count ?? nextCount,
      });

      if (getFilterSnapshot().shortcut === "favorites" && !Boolean(responseState.viewer_liked ?? nextLiked)) {
        await reloadFromFilters();
      }
    } catch (error) {
      syncImageLikeState(imageId, previousState);
      app.toast.error(resolveLocalizedMessage(error, t("home.like.error", "Failed to update like.")));
    } finally {
      state.pendingLikeIds.delete(key);
      syncCardLikeState(imageId);
      if (typeof app.imageModal?.setLikePending === "function") {
        app.imageModal.setLikePending(imageId, false);
      }
    }
  }

  async function fetchContentDetail(item) {
    if (!item?.content_id) {
      return {
        content_id: `i-${item?.id ?? ""}`,
        title: item?.title || t("home.image.untitled", "Untitled"),
        alt: item?.alt || "",
        image_count: 1,
        thumbnail_image_id: item?.id ?? null,
        images: [
          {
            ...item,
            image_id: item?.id ?? null,
            id: item?.id ?? null,
            preview_url: normalizeImageUrl(item || {}),
            original_url: item?.id ? withAppBase(`/media/original/${item.id}`) : normalizeImageUrl(item || {}),
            viewer_liked: Boolean(item?.viewer_liked),
            detailLoader: async () => fetchImageDetail(item),
          },
        ],
      };
    }

    try {
      const payload = await app.api.get(`/api/contents/${encodeURIComponent(item.content_id)}`);
      const detailRoot = payload?.data ?? payload ?? {};
      const contentTitle = detailRoot.title || item.title || t("home.image.untitled", "Untitled");
      const contentAlt = detailRoot.alt ?? item.alt ?? "";
      const imagesSource = Array.isArray(detailRoot.images) && detailRoot.images.length ? detailRoot.images : [item];
      const images = imagesSource.map((image, imageIndex) => {
        const imageId = image.image_id ?? image.id ?? null;
        const merged = {
          ...item,
          ...image,
          id: imageId,
          image_id: imageId,
          title: contentTitle,
          alt: contentAlt,
          posted_at: image.posted_at || image.created_at || detailRoot.created_at || item.created_at || item.shot_at || null,
          preview_url: normalizeImageUrl(image),
          original_url: imageId ? withAppBase(`/media/original/${imageId}`) : normalizeImageUrl(image),
          viewer_liked: Boolean(image.viewer_liked),
        };
        merged.detailLoader = async () => fetchImageDetail(merged);
        merged.content_id = detailRoot.content_id || item.content_id || `i-${imageId ?? imageIndex}`;
        return merged;
      });

      return {
        ...detailRoot,
        content_id: detailRoot.content_id || item.content_id || `i-${item.id ?? ""}`,
        title: contentTitle,
        alt: contentAlt,
        image_count: Number(detailRoot.image_count || images.length || 1),
        thumbnail_image_id: detailRoot.thumbnail_image_id ?? item.thumbnail_image_id ?? item.id ?? null,
        images,
      };
    } catch {
      return {
        content_id: item.content_id || `i-${item.id ?? ""}`,
        title: item.title || t("home.image.untitled", "Untitled"),
        alt: item.alt || "",
        image_count: Number(item.image_count || 1),
        thumbnail_image_id: item.thumbnail_image_id ?? item.id ?? null,
        images: [
          {
            ...item,
            image_id: item.id ?? null,
            id: item.id ?? null,
            preview_url: normalizeImageUrl(item),
            original_url: item.id ? withAppBase(`/media/original/${item.id}`) : normalizeImageUrl(item),
            viewer_liked: Boolean(item.viewer_liked),
            detailLoader: async () => fetchImageDetail(item),
          },
        ],
      };
    }
  }

  async function openImageFromCard(index) {
    const item = state.items[index];
    if (!item) {
      return;
    }

    const contentDetail = await fetchContentDetail(item);
    const images = Array.isArray(contentDetail.images) ? contentDetail.images : [];
    const initialIndex = Math.max(0, images.findIndex((image) => Number(image.image_id ?? image.id) === Number(contentDetail.thumbnail_image_id ?? item.id)));

    const payload = {
      ...item,
      ...contentDetail,
      image_id: images[initialIndex]?.image_id ?? item.id ?? null,
      preview_url: images[initialIndex]?.preview_url || normalizeImageUrl(item),
      original_url: images[initialIndex]?.original_url || (item.id ? withAppBase(`/media/original/${item.id}`) : normalizeImageUrl(item)),
      images,
      currentIndex: initialIndex,
      viewer_liked: Boolean(images[initialIndex]?.viewer_liked ?? item.viewer_liked),
      detailLoader: images[initialIndex]?.detailLoader || (async () => fetchImageDetail(item)),
    };

    app.imageModal.openByPreference(payload, {
      items: images,
      currentIndex: initialIndex,
      detail: buildPublicDetail(images[initialIndex] || item),
      detailLoader: images[initialIndex]?.detailLoader || (async () => fetchImageDetail(item)),
      onLikeChange(nextState) {
        if (nextState?.image_id) {
          syncImageLikeState(nextState.image_id, nextState || {});
        }
        if (getFilterSnapshot().shortcut === "favorites") {
          reloadFromFilters();
        }
      },
      onOwnerAction(nextState) {
        syncOwnedContentState(nextState || {});
        if (nextState?.status === "deleted") {
          reloadFromFilters();
        }
      },
    });
  }

  async function loadArchives() {
    const filters = getFilterSnapshot();
    state.archiveKind = filters.archiveKind;

    const query = new URLSearchParams({
      kind: filters.archiveKind,
    });

    applyFiltersToQuery(query, filters);

    try {
      const payload = await app.api.get(`/api/content-archives?${query.toString()}`);
      const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data?.items) ? payload.data.items : [];
      renderArchives(items, filters.archiveKind);
      syncDateFilterUi(filters.archiveKind);
    } catch {
      refs.archiveList.textContent = "";
      const empty = document.createElement("div");
      empty.className = "home-state-card home-state-card--error";
      empty.textContent = t("home.archive.error", "Failed to load archives.");
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

      const payload = await app.api.get(`/api/contents?${query.toString()}`);
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
      setError(error.message || t("home.list.error", "Failed to load images."));
      app.toast.error(resolveLocalizedMessage(error, t("home.list.error", "Failed to load images.")));
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
        app.api.get("/api/tags?limit=500"),
        app.api.get("/api/palette"),
      ]);
      state.tagPool = Array.isArray(tagsPayload?.items) ? tagsPayload.items : [];
      renderTagChips(state.tagPool);
      renderColorButtons(Array.isArray(palettePayload?.items) ? palettePayload.items : []);
    } catch {
      state.tagPool = [];
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

      if (shortcut === "favorites" && !requireLikeAuth()) {
        return;
      }

      if (shortcut === "random" && alreadyActive) {
        state.randomSeed = createRandomSeed();
        reloadFromFilters();
        return;
      }

      activateSingleSelectButton(refs.shortcutList, button, "[data-ui-shortcut]");

      if (shortcut === "random") {
        state.randomSeed = createRandomSeed();
      }

      updateSortVisibility();
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
      // Re-render to move selected to top
      renderTagChips(state.tagPool);
      reloadFromFilters();
      // Sync browse modal selection state if it's currently open
      if (app.modal?.isOpen?.(HOME_TAG_BROWSE_ID)) {
        const layer = document.getElementById("appModalRoot")?.querySelector(`[data-modal-id="${HOME_TAG_BROWSE_ID}"]`);
        layer?._renderList?.(layer.querySelector?.("#tagBrowseSearch")?.value || "");
      }
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
      renderHomeSug(needle);
    });
    refs.tagSearchInput?.addEventListener("blur", () => {
      setTimeout(() => closeHomeSug(), 160);
    });
    refs.tagSugList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag]");
      if (!btn) return;
      const name = btn.dataset.tag;
      // Activate the chip
      const chip = refs.tagChipList?.querySelector(`[data-ui-chip][data-value="${CSS.escape(name)}"]`);
      if (chip) {
        chip.setAttribute("aria-pressed", "true");
        chip.classList.add("is-active");
      }
      if (refs.tagSearchInput) refs.tagSearchInput.value = "";
      closeHomeSug();
      renderTagChips(state.tagPool);
      reloadFromFilters();
    });
    refs.tagMoreBtn?.addEventListener("click", () => openHomeBrowseModal());

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
        syncDateFilterUi(kind);
      } else {
        const range = monthRange(year, month);
        state.archiveSelected[kind] = key;
        setDateInputs(kind, range.from, range.to);
        refs.archiveList.querySelectorAll(`[data-archive-kind="${kind}"]`).forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        syncDateFilterUi(kind);
      }

      reloadFromFilters();
    });

    [refs.shotDateFrom, refs.shotDateTo].forEach((input) => {
      input?.addEventListener("change", () => {
        syncDateFilterUi("shot");
        reloadFromFilters();
      });
    });

    [refs.postedDateFrom, refs.postedDateTo].forEach((input) => {
      input?.addEventListener("change", () => {
        syncDateFilterUi("posted");
        reloadFromFilters();
      });
    });
  }

  refs.galleryGrid.addEventListener("click", (event) => {
    const likeButton = event.target.closest("[data-action='toggle-like']");
    if (likeButton && refs.galleryGrid.contains(likeButton)) {
      const article = likeButton.closest(".home-gallery-card");
      const imageId = Number(article?.dataset.imageId || 0);
      if (imageId) {
        event.preventDefault();
        event.stopPropagation();
        toggleLikeById(imageId);
      }
      return;
    }

    const userButton = event.target.closest("[data-card-user]");
    if (userButton && refs.galleryGrid.contains(userButton)) {
      const userKey = normalizeUserKey(userButton.dataset.userKey);
      if (userKey) {
        event.preventDefault();
        event.stopPropagation();
        document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey } }));
      }
      return;
    }

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

  // ── Header search suggest ─────────────────────────────────────────────

  const desktopSugRefs = {
    panel: refs.searchSugPanel,
    imagesSection: refs.searchSugImages,
    imagesList: refs.searchSugImagesList,
    tagsSection: refs.searchSugTags,
    tagsList: refs.searchSugTagsList,
    usersSection: refs.searchSugUsers,
    usersList: refs.searchSugUsersList,
  };

  const mobileSugRefs = {
    panel: refs.mobileSearchSugPanel,
    imagesSection: refs.mobileSearchSugImages,
    imagesList: refs.mobileSearchSugImagesList,
    tagsSection: refs.mobileSearchSugTags,
    tagsList: refs.mobileSearchSugTagsList,
    usersSection: refs.mobileSearchSugUsers,
    usersList: refs.mobileSearchSugUsersList,
  };

  refs.searchInput?.addEventListener("input", () => {
    scheduleSugFetch(refs.searchInput.value.trim(), desktopSugRefs);
  });

  refs.searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      closeSearchSug(refs.searchSugPanel);
      reloadFromFilters();
    } else if (event.key === "Escape") {
      closeSearchSug(refs.searchSugPanel);
    }
  });

  refs.searchInput?.addEventListener("blur", () => {
    window.setTimeout(() => closeSearchSug(refs.searchSugPanel), 150);
  });

  refs.searchSugPanel?.addEventListener("click", (event) => {
    handleSugClick(event, desktopSugRefs);
  });

  refs.searchOwnerBadgeClear?.addEventListener("click", () => {
    clearOwnerFilter();
    reloadFromFilters();
  });

  // ── Mobile search modal ─────────────────────────────────────────────

  refs.mobileSearchBtn?.addEventListener("click", () => openMobileSearchModal());

  refs.mobileSearchClose?.addEventListener("click", () => closeMobileSearchModal(false));

  refs.mobileSearchInput?.addEventListener("input", () => {
    scheduleSugFetch(refs.mobileSearchInput.value.trim(), mobileSugRefs);
  });

  refs.mobileSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      closeMobileSearchModal(true);
      reloadFromFilters();
    } else if (event.key === "Escape") {
      closeMobileSearchModal(false);
    }
  });

  refs.mobileSearchSugPanel?.addEventListener("click", (event) => {
    handleSugClick(event, mobileSugRefs);
  });

  refs.mobileSearchOwnerBadgeClear?.addEventListener("click", () => {
    clearOwnerFilter();
    reloadFromFilters();
  });

  refs.sortSelect?.addEventListener("change", () => {
    writeStoredSort(refs.sortSelect.value);
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

  const mobileToolbarMedia = window.matchMedia("(max-width: 980px)");
  const originalSortParent = refs.sortField?.parentElement || null;
  const originalSortNextSibling = refs.sortField?.nextElementSibling || null;
  let mobileChromeLastY = window.scrollY || 0;
  let mobileChromeHidden = false;
  let mobileChromeTicking = false;
  function setMobileChromeHidden(hidden) {
    if (mobileChromeHidden === hidden) return;
    mobileChromeHidden = hidden;
    document.body.classList.toggle("is-home-mobile-chrome-hidden", hidden);
  }
  function syncMobileChromeVisibility() {
    const isMobile = mobileToolbarMedia.matches;
    if (!isMobile) {
      setMobileChromeHidden(false);
      mobileChromeLastY = window.scrollY || 0;
      return;
    }
    const nextY = Math.max(window.scrollY || 0, 0);
    const delta = nextY - mobileChromeLastY;
    mobileChromeLastY = nextY;
    if (nextY <= 16) {
      setMobileChromeHidden(false);
      return;
    }
    if (Math.abs(delta) < 8) {
      return;
    }
    setMobileChromeHidden(delta > 0);
  }
  function handleMobileChromeScroll() {
    if (mobileChromeTicking) return;
    mobileChromeTicking = true;
    window.requestAnimationFrame(() => {
      mobileChromeTicking = false;
      syncMobileChromeVisibility();
    });
  }
  function syncMobileSortPlacement() {
    if (!refs.sortField || !refs.mobileSortHost || !originalSortParent) return;
    if (mobileToolbarMedia.matches) {
      refs.mobileSortHost.hidden = false;
      if (refs.sortField.parentElement !== refs.mobileSortHost) {
        refs.mobileSortHost.appendChild(refs.sortField);
      }
      return;
    }
    refs.mobileSortHost.hidden = true;
    if (refs.sortField.parentElement === originalSortParent) return;
    if (originalSortNextSibling && originalSortNextSibling.parentElement === originalSortParent) {
      originalSortParent.insertBefore(refs.sortField, originalSortNextSibling);
    } else {
      originalSortParent.appendChild(refs.sortField);
    }
  }
  syncMobileSortPlacement();
  syncMobileChromeVisibility();
  mobileToolbarMedia.addEventListener?.("change", () => {
    syncMobileSortPlacement();
    syncMobileChromeVisibility();
  });
  window.addEventListener("scroll", handleMobileChromeScroll, { passive: true });

  resetUiOnlyFilters();
  bindSidebarEvents();
  applyLayoutPageSize();
  syncGridColumnsUi();
  applyStaticTranslations();
  window.addEventListener("gallery:language-changed", applyStaticTranslations);
  document.addEventListener("gallery:uploaded", () => reloadFromFilters());

  updateSortVisibility();
  Promise.all([hydrateSidebarOptions(), loadArchives()]).finally(() => {
    load();
  });
}
import { resolveLocalizedMessage } from "../core/i18n.js";
