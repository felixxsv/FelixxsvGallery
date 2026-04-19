const LS_KEY = "gallery.slideshow.v1";
const FETCH_PER_PAGE = 30;
const PRELOAD_AHEAD = 2;
const CURSOR_HIDE_MS = 2500;
const FLASH_DURATION_MS = 700;
const TRANSITION_DURATION_MS = 420;

function t(app, key, fallback) {
  return app?.i18n?.t?.(`slideshow.${key}`, fallback) || fallback;
}

const SOURCES = [
  { id: "all",             key: "source.all",             label: "All Images" },
  { id: "mine",            key: "source.mine",            label: "My Posts",          requiresAuth: true },
  { id: "this_month_all",  key: "source.this_month_all",  label: "This Month (All)" },
  { id: "this_month_mine", key: "source.this_month_mine", label: "This Month (Mine)", requiresAuth: true },
  { id: "liked",           key: "source.liked",           label: "Liked",             requiresAuth: true },
  { id: "random",          key: "source.random",          label: "Random" },
];

const INTERVALS = [3, 5, 10, 30];
const TRANSITIONS_LIST = ["fade", "crossfade", "slide", "none"];
const FIT_MODES = ["cover", "contain"];
const META_MODES = ["cursor", "always", "hidden"];

function defaultSettings() {
  return {
    interval: 5,
    transition: "fade",
    fit: "cover",
    meta: "cursor",
    autoAdvance: true,
    shuffle: false,
    loop: true,
    kenBurns: false,
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultSettings();
    const data = JSON.parse(raw);
    const def = defaultSettings();
    return {
      interval: INTERVALS.includes(Number(data.interval)) ? Number(data.interval) : def.interval,
      transition: TRANSITIONS_LIST.includes(data.transition) ? data.transition : def.transition,
      fit: FIT_MODES.includes(data.fit) ? data.fit : def.fit,
      meta: META_MODES.includes(data.meta) ? data.meta : def.meta,
      autoAdvance: data.autoAdvance !== false,
      shuffle: Boolean(data.shuffle),
      loop: data.loop !== false,
      kenBurns: Boolean(data.kenBurns),
    };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function createSlideshowController({ app }) {
  let settings = loadSettings();
  let currentSourceId = null;
  let items = [];
  let displayOrder = [];
  let currentLogicalIdx = 0;
  let fetchPageNum = 1;
  let isFetching = false;
  let hasMore = true;
  let isPlaying = false;
  let isSettingsOpen = false;
  let cursorTimer = null;
  let flashTimer = null;
  let progressRaf = null;
  let progressElapsed = 0;
  let progressStartTs = null;
  let isTransitioning = false;
  let currentSlideEl = null;
  let currentItem = null;
  let preloadCache = new Map();
  let likesPending = new Set();
  let randomSeed = null;

  // Playback overlay (full-screen, separate from modal system)
  const overlay = document.createElement("div");
  overlay.className = "slideshow";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t(app, "aria.slideshow", "Slideshow"));
  overlay.innerHTML = buildPlaybackHTML();
  document.body.appendChild(overlay);

  // Picker elements live in index.html inside #appModalRoot
  const pickerEl = {
    sourceGrid:     document.getElementById("slideshowSourceGrid"),
    settingsRows:   document.getElementById("slideshowPickerSettingsRows"),
    startBtn:       document.getElementById("slideshowStartBtn"),
  };

  // Playback elements
  const $ = (sel) => overlay.querySelector(sel);
  const el = {
    playback:       overlay,
    stage:          $("[data-ss-stage]"),
    progressFill:   $("[data-ss-progress-fill]"),
    progress:       $("[data-ss-progress]"),

    zonePrev:       $("[data-ss-zone-prev]"),
    zoneNext:       $("[data-ss-zone-next]"),
    flash:          $("[data-ss-flash]"),
    flashIcon:      $("[data-ss-flash-icon]"),

    metaTitle:      $("[data-ss-meta-title]"),
    metaDate:       $("[data-ss-meta-date]"),
    sourceLabel:    $("[data-ss-source-label]"),
    likeBtn:        $("[data-ss-like]"),
    likeIcon:       $("[data-ss-like-icon]"),
    likeCount:      $("[data-ss-like-count]"),
    detailBtn:      $("[data-ss-detail]"),
    prevBtn:        $("[data-ss-prev]"),
    playPauseBtn:   $("[data-ss-playpause]"),
    nextBtn:        $("[data-ss-next]"),
    settingsToggle: $("[data-ss-settings-toggle]"),
    fullscreenBtn:  $("[data-ss-fullscreen]"),
    playbackClose:  $("[data-ss-playback-close]"),

    settingsPanel:  $("[data-ss-settings-panel]"),
    settingsBody:   $("[data-ss-settings-body]"),
    emptyMsg:       $("[data-ss-empty]"),
    loadingMsg:     $("[data-ss-loading]"),
  };

  // ─── Playback HTML ───────────────────────────────────────────────

  function buildPlaybackHTML() {
    const lb  = esc(t(app, "aria.close",          "Close"));
    const lp  = esc(t(app, "aria.previous",        "Previous"));
    const ln  = esc(t(app, "aria.next",            "Next"));
    const lpp = esc(t(app, "aria.play_pause",      "Play/Pause"));
    const llk = esc(t(app, "aria.like",            "Like"));
    const ldt = esc(t(app, "aria.details",         "Details"));
    const lst = esc(t(app, "aria.settings",        "Settings"));
    const lfs = esc(t(app, "aria.fullscreen",      "Fullscreen"));
    const lcs = esc(t(app, "aria.close_settings",  "Close settings"));
    const ltt = esc(t(app, "settings.title",       "Settings"));
    return `
<div class="slideshow__stage" data-ss-stage></div>

<button type="button" class="slideshow__zone slideshow__zone--prev" data-ss-zone-prev aria-label="${lp}"></button>
<button type="button" class="slideshow__zone slideshow__zone--next" data-ss-zone-next aria-label="${ln}"></button>

<div class="slideshow__flash" data-ss-flash hidden>
  <span class="slideshow__flash-icon" data-ss-flash-icon></span>
</div>

<button type="button" class="slideshow__close" data-ss-playback-close aria-label="${lb}"></button>

<div class="slideshow__bar" data-ss-hud>
  <div class="slideshow__progress" data-ss-progress hidden>
    <div class="slideshow__progress-fill" data-ss-progress-fill></div>
  </div>
  <div class="slideshow__bar-inner">
    <div class="slideshow__bar-left">
      <span class="slideshow__bar-title" data-ss-meta-title></span>
      <span class="slideshow__bar-date" data-ss-meta-date></span>
      <span class="slideshow__bar-source" data-ss-source-label></span>
    </div>
    <div class="slideshow__bar-center">
      <button type="button" class="slideshow__nav-btn" data-ss-prev aria-label="${lp}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button type="button" class="slideshow__nav-btn slideshow__nav-btn--play" data-ss-playpause aria-label="${lpp}">
        <span data-ss-playpause-icon></span>
      </button>
      <button type="button" class="slideshow__nav-btn" data-ss-next aria-label="${ln}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="slideshow__bar-right">
      <button type="button" class="slideshow__bar-action slideshow__bar-like" data-ss-like aria-label="${llk}" hidden>
        <span data-ss-like-icon>♡</span>
        <span data-ss-like-count>0</span>
      </button>
      <button type="button" class="slideshow__bar-action" data-ss-detail aria-label="${ldt}" title="${ldt}">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="16" cy="10" r="1.6"/></svg>
      </button>
      <button type="button" class="slideshow__bar-action" data-ss-settings-toggle aria-label="${lst}" title="${lst}">
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="3"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.22 3.22l1.42 1.42M15.36 15.36l1.42 1.42M3.22 16.78l1.42-1.42M15.36 4.64l1.42-1.42"/></svg>
      </button>
      <button type="button" class="slideshow__bar-action" data-ss-fullscreen aria-label="${lfs}" title="${lfs}">
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5"/></svg>
      </button>
    </div>
  </div>
</div>

<div class="slideshow__settings-panel" data-ss-settings-panel hidden>
  <div class="slideshow__settings-panel-header">
    <span data-ss-settings-panel-title>${ltt}</span>
    <button type="button" class="slideshow__toolbar-btn" data-ss-settings-close aria-label="${lcs}">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="17" y2="17"/><line x1="17" y1="3" x2="3" y2="17"/></svg>
    </button>
  </div>
  <div class="slideshow__settings-rows" data-ss-settings-body></div>
</div>

<div class="slideshow__overlay-msg" data-ss-empty hidden></div>
<div class="slideshow__overlay-msg" data-ss-loading hidden></div>`;
  }

  function applyTranslations() {
    overlay.setAttribute("aria-label", t(app, "aria.slideshow", "Slideshow"));
    const set = (sel, attr, key, fallback, extra) => {
      const el2 = overlay.querySelector(sel) || (sel.startsWith("[data") ? null : null);
      if (el2) {
        el2.setAttribute(attr, t(app, key, fallback));
        if (extra) el2[extra] = t(app, key, fallback);
      }
    };
    if (el.zonePrev)     el.zonePrev.setAttribute("aria-label",     t(app, "aria.previous",       "Previous"));
    if (el.zoneNext)     el.zoneNext.setAttribute("aria-label",     t(app, "aria.next",            "Next"));
    if (el.playbackClose)el.playbackClose.setAttribute("aria-label",t(app, "aria.close",           "Close"));
    if (el.prevBtn)      el.prevBtn.setAttribute("aria-label",      t(app, "aria.previous",        "Previous"));
    if (el.nextBtn)      el.nextBtn.setAttribute("aria-label",      t(app, "aria.next",            "Next"));
    if (el.likeBtn)      el.likeBtn.setAttribute("aria-label",      t(app, "aria.like",            "Like"));
    if (el.detailBtn) {
      const ldt = t(app, "aria.details", "Details");
      el.detailBtn.setAttribute("aria-label", ldt);
      el.detailBtn.title = ldt;
    }
    if (el.settingsToggle) {
      const lst = t(app, "aria.settings", "Settings");
      el.settingsToggle.setAttribute("aria-label", lst);
      el.settingsToggle.title = lst;
    }
    if (el.fullscreenBtn) {
      const lfs = t(app, "aria.fullscreen", "Fullscreen");
      el.fullscreenBtn.setAttribute("aria-label", lfs);
      el.fullscreenBtn.title = lfs;
    }
    const closeSettingsBtn = el.settingsPanel?.querySelector("[data-ss-settings-close]");
    if (closeSettingsBtn) closeSettingsBtn.setAttribute("aria-label", t(app, "aria.close_settings", "Close settings"));
    const titleEl = el.settingsPanel?.querySelector("[data-ss-settings-panel-title]");
    if (titleEl) titleEl.textContent = t(app, "settings.title", "Settings");
    syncPlayPauseBtn();
    if (el.settingsBody && !el.settingsPanel?.hidden) buildSettingsRows(el.settingsBody);
  }

  // ─── Settings UI ────────────────────────────────────────────────

  function buildSettingsRows(container) {
    if (!container) return;
    container.innerHTML = "";

    const intervalRow = makeSettingRow(t(app, "settings.interval", "Interval"),
      `<div class="slideshow__seg" data-ss-seg="interval">
        ${INTERVALS.map(v => `<button type="button" class="slideshow__seg-btn${settings.interval === v ? " is-active" : ""}" data-val="${v}">${v}s</button>`).join("")}
      </div>`
    );
    container.appendChild(intervalRow);

    const transLabels = {
      fade: t(app, "transition.fade", "Fade"),
      crossfade: t(app, "transition.crossfade", "Crossfade"),
      slide: t(app, "transition.slide", "Slide"),
      none: t(app, "transition.none", "None"),
    };
    const transRow = makeSettingRow(t(app, "settings.transition", "Transition"),
      `<div class="slideshow__seg" data-ss-seg="transition">
        ${TRANSITIONS_LIST.map(v => `<button type="button" class="slideshow__seg-btn${settings.transition === v ? " is-active" : ""}" data-val="${v}">${esc(transLabels[v])}</button>`).join("")}
      </div>`
    );
    container.appendChild(transRow);

    const fitLabels = { cover: t(app, "fit.cover", "Fill"), contain: t(app, "fit.contain", "Fit") };
    const fitRow = makeSettingRow(t(app, "settings.fit", "Fit"),
      `<div class="slideshow__seg" data-ss-seg="fit">
        ${FIT_MODES.map(v => `<button type="button" class="slideshow__seg-btn${settings.fit === v ? " is-active" : ""}" data-val="${v}">${esc(fitLabels[v])}</button>`).join("")}
      </div>`
    );
    container.appendChild(fitRow);

    const metaLabels = {
      cursor: t(app, "meta.cursor", "On cursor"),
      always: t(app, "meta.always", "Always"),
      hidden: t(app, "meta.hidden", "Hidden"),
    };
    const metaRow = makeSettingRow(t(app, "settings.meta", "Info"),
      `<div class="slideshow__seg" data-ss-seg="meta">
        ${META_MODES.map(v => `<button type="button" class="slideshow__seg-btn${settings.meta === v ? " is-active" : ""}" data-val="${v}">${esc(metaLabels[v])}</button>`).join("")}
      </div>`
    );
    container.appendChild(metaRow);

    const toggles = [
      { key: "autoAdvance", label: t(app, "settings.auto_advance", "Auto-advance") },
      { key: "shuffle",     label: t(app, "settings.shuffle", "Shuffle") },
      { key: "loop",        label: t(app, "settings.loop", "Loop") },
      { key: "kenBurns",    label: t(app, "settings.ken_burns", "Ken Burns") },
    ];
    for (const tog of toggles) {
      const row = makeSettingRow(tog.label,
        `<button type="button" class="slideshow__toggle${settings[tog.key] ? " is-on" : ""}" data-ss-toggle="${tog.key}" role="switch" aria-checked="${settings[tog.key]}">
          <span class="slideshow__toggle-knob"></span>
        </button>`
      );
      container.appendChild(row);
    }

    attachSettingsEvents(container);
  }

  function makeSettingRow(label, controlHtml) {
    const div = document.createElement("div");
    div.className = "slideshow__setting-row";
    div.innerHTML = `<span class="slideshow__setting-label">${esc(label)}</span><div class="slideshow__setting-ctrl">${controlHtml}</div>`;
    return div;
  }

  function attachSettingsEvents(container) {
    container.querySelectorAll("[data-ss-seg]").forEach((seg) => {
      const key = seg.dataset.ssSeg;
      seg.querySelectorAll("[data-val]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.dataset.val;
          if (key === "interval") settings.interval = Number(val);
          else settings[key] = val;
          saveSettings(settings);
          seg.querySelectorAll("[data-val]").forEach((b) => b.classList.toggle("is-active", b === btn));
          onSettingChanged(key);
        });
      });
    });
    container.querySelectorAll("[data-ss-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.ssToggle;
        settings[key] = !settings[key];
        saveSettings(settings);
        btn.classList.toggle("is-on", settings[key]);
        btn.setAttribute("aria-checked", String(settings[key]));
        onSettingChanged(key);
      });
    });
  }

  function onSettingChanged(key) {
    if (key === "autoAdvance") {
      if (isPlaying) {
        if (settings.autoAdvance) { resetProgress(); startProgress(); }
        else { pauseProgress(); resetProgress(); }
      }
    }
    if (key === "interval" && isPlaying && settings.autoAdvance) {
      resetProgress(); startProgress();
    }
    if (key === "fit" && currentSlideEl) {
      currentSlideEl.querySelector(".slideshow__slide-img")?.classList.toggle("fit-contain", settings.fit === "contain");
    }
    if (key === "kenBurns" && currentSlideEl) {
      syncKenBurns(currentSlideEl.querySelector(".slideshow__slide-img"), currentItem);
    }
    if (key === "meta") applyMetaSetting();
    if (key === "shuffle") rebuildDisplayOrder();
    el.progress.hidden = !settings.autoAdvance;
    syncPlaybackSettingsUI();
  }

  function syncPlaybackSettingsUI() {
    if (!el.settingsBody) return;
    el.settingsBody.querySelectorAll("[data-ss-seg]").forEach((seg) => {
      const key = seg.dataset.ssSeg;
      seg.querySelectorAll("[data-val]").forEach((btn) => {
        const val = key === "interval" ? Number(btn.dataset.val) : btn.dataset.val;
        btn.classList.toggle("is-active", settings[key] === val);
      });
    });
    el.settingsBody.querySelectorAll("[data-ss-toggle]").forEach((btn) => {
      const key = btn.dataset.ssToggle;
      btn.classList.toggle("is-on", settings[key]);
      btn.setAttribute("aria-checked", String(settings[key]));
    });
  }

  // ─── Source picker ───────────────────────────────────────────────

  function renderPicker() {
    if (!pickerEl.sourceGrid) return;
    pickerEl.sourceGrid.innerHTML = "";

    const isAuth = Boolean(app.session?.getState?.()?.authenticated);

    for (const src of SOURCES) {
      const locked = src.requiresAuth && !isAuth;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slideshow__source-btn" + (locked ? " is-locked" : "");
      btn.dataset.sourceId = src.id;
      btn.disabled = locked;
      btn.innerHTML = `
        <span class="slideshow__source-icon">${sourceIcon(src.id)}</span>
        <span class="slideshow__source-name">${esc(t(app, src.key, src.label))}</span>
        ${locked ? `<span class="slideshow__source-lock" aria-hidden="true">🔒</span>` : ""}
      `;
      btn.addEventListener("click", () => {
        if (locked) return;
        selectSource(src.id);
      });
      pickerEl.sourceGrid.appendChild(btn);
    }

    buildSettingsRows(pickerEl.settingsRows);
  }

  function sourceIcon(id) {
    const icons = {
      all: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="7" height="7" rx="1"/><rect x="11" y="2" width="7" height="7" rx="1"/><rect x="2" y="11" width="7" height="7" rx="1"/><rect x="11" y="11" width="7" height="7" rx="1"/></svg>`,
      mine: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="7" r="4"/><path d="M3 18c0-3.87 3.13-7 7-7s7 3.13 7 7"/></svg>`,
      this_month_all: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="16" height="14" rx="2"/><line x1="6" y1="2" x2="6" y2="6"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="2" y1="9" x2="18" y2="9"/></svg>`,
      this_month_mine: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="16" height="14" rx="2"/><line x1="6" y1="2" x2="6" y2="6"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="2" y1="9" x2="18" y2="9"/><circle cx="10" cy="14" r="2" fill="currentColor" stroke="none"/></svg>`,
      liked: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 17s-7-4.5-7-9a5 5 0 0 1 7-4.58A5 5 0 0 1 17 8c0 4.5-7 9-7 9z"/></svg>`,
      random: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="17 4 17 8 13 8"/><polyline points="3 16 3 12 7 12"/><path d="M17 8 C13 8 10 12 7 12 L3 12"/><path d="M3 4 C7 4 10 8 13 8 L17 8"/></svg>`,
    };
    return icons[id] || "";
  }

  function selectSource(sourceId) {
    currentSourceId = sourceId;
    pickerEl.sourceGrid?.querySelectorAll(".slideshow__source-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.sourceId === sourceId);
    });
    if (pickerEl.startBtn) pickerEl.startBtn.disabled = false;
  }

  // ─── Data fetching ───────────────────────────────────────────────

  function imageUrl(item) {
    if (!item) return null;
    const path = item.preview_path || item.thumb_path_960 || item.thumb_path_480;
    if (!path) return null;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (path.startsWith("/")) return `${app.appBase}${path}`;
    if (path.startsWith("storage/") || path.startsWith("media/") || path.startsWith("api/")) return `${app.appBase}/${path}`;
    return `${app.appBase}/storage/${path}`;
  }

  function buildApiParams(page) {
    const userKey = app.session?.getState?.()?.data?.user?.user_key || "";
    const base = { page: String(page), per_page: String(FETCH_PER_PAGE) };
    switch (currentSourceId) {
      case "all":             return { ...base };
      case "mine":            return userKey ? { ...base, owner_user_key: userKey } : null;
      case "this_month_all":  return { ...base, shortcut: "current_month" };
      case "this_month_mine": return userKey ? { ...base, shortcut: "current_month", owner_user_key: userKey } : null;
      case "liked":           return { ...base, liked_only: "true" };
      case "random":          return { ...base, sort: "random", random_seed: randomSeed };
      default:                return null;
    }
  }

  async function fetchNextPage() {
    if (isFetching || !hasMore) return;
    const params = buildApiParams(fetchPageNum);
    if (!params) return;
    isFetching = true;
    try {
      const query = new URLSearchParams(params);
      const data = await app.api.get(`/api/images?${query}`);
      const newItems = Array.isArray(data?.items) ? data.items : [];
      const total = Number(data?.total) || 0;
      const prevCount = items.length;
      items = [...items, ...newItems];
      hasMore = items.length < total;
      fetchPageNum++;
      extendDisplayOrder(prevCount, newItems.length);
    } catch {
      // network error
    } finally {
      isFetching = false;
    }
  }

  function rebuildDisplayOrder() {
    displayOrder = Array.from({ length: items.length }, (_, i) => i);
    if (settings.shuffle) {
      for (let i = displayOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [displayOrder[i], displayOrder[j]] = [displayOrder[j], displayOrder[i]];
      }
    }
    currentLogicalIdx = 0;
  }

  function extendDisplayOrder(prevCount, newCount) {
    if (!settings.shuffle) {
      for (let i = prevCount; i < prevCount + newCount; i++) displayOrder.push(i);
      return;
    }
    const newIndices = Array.from({ length: newCount }, (_, i) => prevCount + i);
    for (let i = newIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newIndices[i], newIndices[j]] = [newIndices[j], newIndices[i]];
    }
    displayOrder.splice(Math.max(currentLogicalIdx + 1, displayOrder.length - newCount), 0, ...newIndices);
  }

  function getEffectiveItem(logicalIdx) {
    const physIdx = displayOrder[logicalIdx];
    return physIdx !== undefined ? items[physIdx] : null;
  }

  async function ensureItemsFor(logicalIdx) {
    const needed = logicalIdx + PRELOAD_AHEAD + 1;
    if (needed > displayOrder.length && hasMore && !isFetching) {
      await fetchNextPage();
    }
  }

  // ─── Preloading ──────────────────────────────────────────────────

  function preloadAround(logicalIdx) {
    const urls = new Set();
    for (let delta = -1; delta <= PRELOAD_AHEAD; delta++) {
      let idx = logicalIdx + delta;
      if (idx < 0) { if (settings.loop) idx = displayOrder.length + idx; else continue; }
      if (idx >= displayOrder.length) { if (settings.loop) idx = idx % displayOrder.length; else continue; }
      const u = imageUrl(getEffectiveItem(idx));
      if (u) urls.add(u);
    }
    for (const [url] of preloadCache) {
      if (!urls.has(url)) preloadCache.delete(url);
    }
    for (const url of urls) {
      if (!preloadCache.has(url)) {
        const img = new Image();
        img.src = url;
        preloadCache.set(url, img);
      }
    }
  }

  // ─── Progress bar ────────────────────────────────────────────────

  function startProgress() {
    if (!settings.autoAdvance) return;
    el.progress.hidden = false;
    progressStartTs = performance.now();
    runProgress();
  }

  function runProgress() {
    if (!isPlaying || !settings.autoAdvance) return;
    const elapsed = progressElapsed + (performance.now() - progressStartTs);
    const total = settings.interval * 1000;
    const pct = Math.min(100, (elapsed / total) * 100);
    if (el.progressFill) el.progressFill.style.width = `${pct}%`;
    if (elapsed >= total) {
      progressElapsed = 0;
      progressStartTs = null;
      advanceSlide(1);
      return;
    }
    progressRaf = requestAnimationFrame(runProgress);
  }

  function pauseProgress() {
    if (progressRaf) { cancelAnimationFrame(progressRaf); progressRaf = null; }
    if (progressStartTs !== null) {
      progressElapsed += performance.now() - progressStartTs;
      progressStartTs = null;
    }
  }

  function resetProgress() {
    pauseProgress();
    progressElapsed = 0;
    if (el.progressFill) el.progressFill.style.width = "0%";
  }

  // ─── Slide transitions ───────────────────────────────────────────

  function createSlideElement(item) {
    const el_ = document.createElement("div");
    el_.className = "slideshow__slide";
    const img = document.createElement("img");
    img.className = "slideshow__slide-img" + (settings.fit === "contain" ? " fit-contain" : "");
    img.src = imageUrl(item) || "";
    img.alt = item.title || "";
    img.draggable = false;
    syncKenBurns(img, item);
    el_.appendChild(img);
    return el_;
  }

  function syncKenBurns(img, item) {
    if (!img) return;
    const fx = Number(item?.focal_x ?? 50);
    const fy = Number(item?.focal_y ?? 50);
    if (settings.kenBurns) {
      img.classList.add("has-ken-burns");
      img.style.setProperty("--ss-kb-ox", `${fx}%`);
      img.style.setProperty("--ss-kb-oy", `${fy}%`);
      img.style.setProperty("--ss-interval", `${settings.interval}s`);
      img.style.animation = "none";
      img.getBoundingClientRect();
      img.style.animation = "";
    } else {
      img.classList.remove("has-ken-burns");
      img.style.removeProperty("--ss-kb-ox");
      img.style.removeProperty("--ss-kb-oy");
      img.style.removeProperty("--ss-interval");
      img.style.animation = "";
    }
  }

  async function showSlide(item, direction) {
    if (!item) return;
    if (isTransitioning) return;
    isTransitioning = true;

    const newEl = createSlideElement(item);
    el.stage.appendChild(newEl);

    const oldEl = currentSlideEl;
    const trans = settings.transition;

    if (!oldEl || trans === "none") {
      oldEl?.remove();
      newEl.classList.add("is-current");
      currentSlideEl = newEl;
      currentItem = item;
      isTransitioning = false;
      onSlideShown(item);
      return;
    }

    if (trans === "fade") {
      newEl.classList.add("ss-enter-fade");
      oldEl.classList.add("ss-leave-fade");
    } else if (trans === "crossfade") {
      newEl.classList.add("ss-enter-fade");
      oldEl.classList.add("ss-leave-cross");
    } else if (trans === "slide") {
      newEl.classList.add(direction >= 0 ? "ss-enter-slide-right" : "ss-enter-slide-left");
      oldEl.classList.add(direction >= 0 ? "ss-leave-slide-left" : "ss-leave-slide-right");
    }

    await new Promise((r) => setTimeout(r, TRANSITION_DURATION_MS));

    oldEl.remove();
    newEl.classList.remove("ss-enter-fade", "ss-enter-slide-right", "ss-enter-slide-left");
    newEl.classList.add("is-current");
    currentSlideEl = newEl;
    currentItem = item;
    isTransitioning = false;
    onSlideShown(item);
  }

  function onSlideShown(item) {
    updateMeta(item);
    preloadAround(currentLogicalIdx);
    if (isPlaying && settings.autoAdvance) startProgress();
  }

  // ─── Navigation ──────────────────────────────────────────────────

  async function advanceSlide(delta) {
    if (isTransitioning) return;
    resetProgress();
    let next = currentLogicalIdx + delta;
    const count = displayOrder.length;

    if (next >= count) {
      if (hasMore) { await fetchNextPage(); next = Math.min(next, displayOrder.length - 1); }
      else if (settings.loop) { next = 0; }
      else { pause(); return; }
    } else if (next < 0) {
      next = settings.loop ? count - 1 : 0;
    }

    currentLogicalIdx = next;
    await ensureItemsFor(next);
    const item = getEffectiveItem(next);
    if (!item) { if (isPlaying && settings.autoAdvance) startProgress(); return; }
    await showSlide(item, delta);

    if (next >= displayOrder.length - PRELOAD_AHEAD - 1 && hasMore) fetchNextPage();
  }

  // ─── Play / Pause ────────────────────────────────────────────────

  function play() {
    if (isPlaying) return;
    isPlaying = true;
    syncPlayPauseBtn();
    if (settings.autoAdvance) startProgress();
  }

  function pause() {
    if (!isPlaying) return;
    isPlaying = false;
    pauseProgress();
    syncPlayPauseBtn();
  }

  function togglePlayPause() {
    if (isPlaying) { pause(); showFlash(pauseIconSvg()); }
    else { play(); showFlash(playIconSvg()); }
  }

  function playIconSvg() {
    return `<svg width="36" height="36" viewBox="0 0 36 36" fill="white"><polygon points="8,4 32,18 8,32"/></svg>`;
  }

  function pauseIconSvg() {
    return `<svg width="36" height="36" viewBox="0 0 36 36" fill="white"><rect x="7" y="4" width="8" height="28"/><rect x="21" y="4" width="8" height="28"/></svg>`;
  }

  function syncPlayPauseBtn() {
    if (!el.playPauseBtn) return;
    const iconEl = el.playPauseBtn.querySelector("[data-ss-playpause-icon]");
    if (iconEl) iconEl.innerHTML = isPlaying ? pauseIconSvg() : playIconSvg();
    el.playPauseBtn.setAttribute("aria-label", isPlaying
      ? t(app, "action.pause", "Pause")
      : t(app, "action.play", "Play"));
  }

  // ─── Flash icon ──────────────────────────────────────────────────

  function showFlash(html) {
    if (!el.flash || !el.flashIcon) return;
    el.flashIcon.innerHTML = html;
    el.flash.hidden = false;
    el.flash.classList.add("is-visible");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      el.flash.classList.remove("is-visible");
      setTimeout(() => { if (el.flash) el.flash.hidden = true; }, 300);
      flashTimer = null;
    }, FLASH_DURATION_MS);
  }

  // ─── HUD visibility ──────────────────────────────────────────────

  function showHud() {
    overlay.classList.add("is-hud-active");
    if (cursorTimer) clearTimeout(cursorTimer);
    if (settings.meta === "cursor") {
      cursorTimer = setTimeout(hideHud, CURSOR_HIDE_MS);
    }
  }

  function hideHud() {
    if (settings.meta === "always") return;
    overlay.classList.remove("is-hud-active");
    if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null; }
  }

  function applyMetaSetting() {
    if (settings.meta === "always") {
      overlay.classList.add("is-hud-active");
      if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null; }
    } else if (settings.meta === "hidden") {
      overlay.classList.remove("is-hud-active");
      if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null; }
    }
    overlay.classList.toggle("is-meta-hidden", settings.meta === "hidden");
  }

  // ─── Meta / like ─────────────────────────────────────────────────

  function updateMeta(item) {
    if (!item) return;
    if (el.metaTitle) el.metaTitle.textContent = item.title || "";
    if (el.metaDate) el.metaDate.textContent = formatDate(item.shot_at);
    if (el.sourceLabel) {
      const src = SOURCES.find((s) => s.id === currentSourceId);
      el.sourceLabel.textContent = src ? t(app, src.key, src.label) : "";
    }
    syncLikeUI(item);
  }

  function syncLikeUI(item) {
    if (!item) return;
    const isAuth = Boolean(app.session?.getState?.()?.authenticated);
    if (el.likeBtn) {
      el.likeBtn.hidden = !isAuth;
      const liked = Boolean(item.viewer_liked);
      el.likeBtn.classList.toggle("is-liked", liked);
      el.likeBtn.disabled = likesPending.has(item.id);
      if (el.likeIcon) el.likeIcon.textContent = liked ? "♥" : "♡";
      if (el.likeCount) el.likeCount.textContent = String(item.like_count ?? 0);
    }
  }

  async function toggleLike() {
    const item = currentItem;
    if (!item || likesPending.has(item.id)) return;
    if (!Boolean(app.session?.getState?.()?.authenticated)) return;

    likesPending.add(item.id);
    syncLikeUI(item);
    const nextLiked = !item.viewer_liked;
    try {
      const res = nextLiked
        ? await app.api.post(`/api/images/${item.id}/like`, {})
        : await app.api.delete(`/api/images/${item.id}/like`, {});
      const state = res?.data ?? res ?? {};
      item.viewer_liked = Boolean(state.viewer_liked ?? nextLiked);
      item.like_count = Number(state.like_count ?? item.like_count ?? 0);
    } catch {
      // revert on error
    } finally {
      likesPending.delete(item.id);
      syncLikeUI(item);
    }
  }

  // ─── Detail modal ────────────────────────────────────────────────

  function openDetail() {
    if (!currentItem) return;
    if (isPlaying) pause();
    const item = currentItem;
    app.imageModal?.openDetail({
      id: item.id,
      image_id: item.id,
      preview_url: imageUrl(item),
      original_url: imageUrl(item),
      title: item.title,
      alt: item.alt,
      shot_at: item.shot_at,
      width: item.width,
      height: item.height,
      viewer_liked: item.viewer_liked,
      like_count: item.like_count,
      focal_x: item.focal_x,
      focal_y: item.focal_y,
      uploader_user_key: item.uploader_user_key,
      uploader_display_name: item.uploader_display_name,
      uploader_avatar_url: item.uploader_avatar_url,
    }, {
      onLikeChange(nextState) {
        if (nextState?.image_id != null && Number(nextState.image_id) === Number(item.id)) {
          item.viewer_liked = Boolean(nextState.viewer_liked);
          item.like_count = Number(nextState.like_count ?? item.like_count ?? 0);
          syncLikeUI(item);
        }
      },
    });
  }

  // ─── Settings panel (playback) ───────────────────────────────────

  function toggleSettingsPanel() {
    isSettingsOpen = !isSettingsOpen;
    if (!el.settingsPanel) return;
    el.settingsPanel.hidden = !isSettingsOpen;
    if (isSettingsOpen) {
      const titleEl = el.settingsPanel.querySelector("[data-ss-settings-panel-title]");
      if (titleEl) titleEl.textContent = t(app, "settings.title", "Settings");
      buildSettingsRows(el.settingsBody);
    }
    el.settingsToggle?.classList.toggle("is-active", isSettingsOpen);
  }

  // ─── Fullscreen ──────────────────────────────────────────────────

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      overlay.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }

  function syncFullscreenBtn() {
    if (!el.fullscreenBtn) return;
    const isFs = Boolean(document.fullscreenElement);
    el.fullscreenBtn.innerHTML = isFs
      ? `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 3H3v5M12 3h5v5M8 17H3v-5M12 17h5v-5"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5"/></svg>`;
  }

  // ─── Keyboard ────────────────────────────────────────────────────

  function handleKeyDown(e) {
    if (overlay.hidden) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;

    switch (e.key) {
      case " ":
        e.preventDefault(); togglePlayPause(); break;
      case "ArrowLeft": case "j": case "J":
        e.preventDefault(); advanceSlide(-1); break;
      case "ArrowRight": case "l": case "L":
        e.preventDefault(); advanceSlide(1); break;
      case "f": case "F":
        e.preventDefault(); toggleFullscreen(); break;
      case "m": case "M":
        e.preventDefault(); cycleMetaMode(); break;
      case "Escape":
        e.preventDefault();
        if (isSettingsOpen) { toggleSettingsPanel(); }
        else { close(); }
        break;
    }
  }

  function cycleMetaMode() {
    const idx = META_MODES.indexOf(settings.meta);
    settings.meta = META_MODES[(idx + 1) % META_MODES.length];
    saveSettings(settings);
    applyMetaSetting();
    syncPlaybackSettingsUI();
  }

  // ─── Open / Close ────────────────────────────────────────────────

  function open() {
    // Reset source selection state
    currentSourceId = null;
    if (pickerEl.startBtn) pickerEl.startBtn.disabled = true;
    renderPicker();
    // Open via app modal system
    app.modal?.open("slideshow-picker");
  }

  async function startPlayback() {
    if (!currentSourceId) return;

    // Close the picker modal, show the full-screen playback overlay
    app.modal?.close("slideshow-picker");

    randomSeed = String(Date.now());
    items = [];
    displayOrder = [];
    currentLogicalIdx = 0;
    fetchPageNum = 1;
    hasMore = true;
    isFetching = false;
    currentSlideEl?.remove();
    currentSlideEl = null;
    currentItem = null;
    preloadCache.clear();
    likesPending.clear();
    isTransitioning = false;

    overlay.hidden = false;
    document.body.classList.add("is-slideshow-open");

    el.emptyMsg.hidden = true;
    el.loadingMsg.hidden = false;
    el.loadingMsg.textContent = t(app, "loading", "Loading…");

    await fetchNextPage();

    el.loadingMsg.hidden = true;

    if (!items.length) {
      el.emptyMsg.hidden = false;
      el.emptyMsg.textContent = t(app, "empty", "No images found.");
      return;
    }

    rebuildDisplayOrder();
    applyMetaSetting();
    syncPlayPauseBtn();
    el.progress.hidden = !settings.autoAdvance;

    if (settings.meta === "always") showHud();

    const first = getEffectiveItem(0);
    if (first) await showSlide(first, 1);
    play();
    showFlash(playIconSvg());
  }

  function close() {
    pause();
    resetProgress();
    overlay.classList.remove("is-hud-active");
    if (cursorTimer) { clearTimeout(cursorTimer); cursorTimer = null; }
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    currentSlideEl?.remove();
    currentSlideEl = null;
    currentItem = null;
    isSettingsOpen = false;
    if (el.settingsPanel) el.settingsPanel.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    overlay.hidden = true;
    document.body.classList.remove("is-slideshow-open");
    el.stage.innerHTML = "";
  }

  // ─── Event listeners ────────────────────────────────────────────

  pickerEl.startBtn?.addEventListener("click", startPlayback);

  el.playbackClose?.addEventListener("click", close);
  el.prevBtn?.addEventListener("click", () => advanceSlide(-1));
  el.nextBtn?.addEventListener("click", () => advanceSlide(1));
  el.playPauseBtn?.addEventListener("click", () => togglePlayPause());
  el.zonePrev?.addEventListener("click", () => advanceSlide(-1));
  el.zoneNext?.addEventListener("click", () => advanceSlide(1));

  el.stage?.addEventListener("click", (e) => {
    if (e.target === el.zonePrev || e.target === el.zoneNext) return;
    const r = el.stage.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const zw = r.width * 0.25;
    if (cx > zw && cx < r.width - zw) togglePlayPause();
  });

  el.likeBtn?.addEventListener("click", (e) => { e.stopPropagation(); toggleLike(); });
  el.detailBtn?.addEventListener("click", (e) => { e.stopPropagation(); openDetail(); });
  el.settingsToggle?.addEventListener("click", (e) => { e.stopPropagation(); toggleSettingsPanel(); });
  el.settingsPanel?.querySelector("[data-ss-settings-close]")?.addEventListener("click", () => toggleSettingsPanel());
  el.fullscreenBtn?.addEventListener("click", toggleFullscreen);

  document.addEventListener("fullscreenchange", syncFullscreenBtn);
  window.addEventListener("gallery:language-changed", applyTranslations);

  overlay.addEventListener("mousemove", showHud);
  overlay.addEventListener("touchstart", showHud, { passive: true });
  document.addEventListener("keydown", handleKeyDown);

  // ─── Public API ──────────────────────────────────────────────────

  return {
    open,
    close,
    isOpen: () => !overlay.hidden,
  };
}
