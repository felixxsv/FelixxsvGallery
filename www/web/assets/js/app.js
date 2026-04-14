import { byId } from "./core/dom.js";
import { createApiClient } from "./core/api.js";
import { createModalManager } from "./core/modal.js";
import { createToastManager } from "./core/toast.js";
import { createSettingsStore, languageToLocaleTag } from "./core/settings.js";
import { createThemeController } from "./core/theme.js";
import { createSessionStore } from "./core/session.js";
import { buildLocaleLoadOrder, createI18n, resolveLocalizedMessage } from "./core/i18n.js";
import { createImageModalController } from "./core/image-modal.js";
import { initUserShell } from "./components/user-shell.js?v=20260414-support-settings-v1";
import { initPublicProfileModal } from "./components/public-profile.js?v=20260414-support";
import { createUploadModalController } from "./components/upload-modal.js";
import { initHomePage } from "./page/home.js";
import { ensureCustomScrollbars, updateCustomScrollbars } from "./core/custom-scrollbar.js";

const PRESENCE_INTERVAL_MS = 30000;
const PRESENCE_HIDDEN_DEBOUNCE_MS = 1000;
const HOME_SIDEBAR_COLLAPSED_KEY = "gallery.home.sidebar.collapsed";
const HOME_SIDEBAR_INIT_KEY = "gallery.home.sidebar.init.v2";
const HOME_GRID_COLUMNS_KEY = "gallery.home.gridColumns";
const HOME_GRID_COLUMNS_DEFAULT = 3;
const HOME_GRID_COLUMNS_ALLOWED = [1, 2, 3, 4];
const HOME_GRID_COLUMNS_MOBILE_BREAKPOINT = 980;
const HOME_SIDEBAR_ANIMATION_MS = 180;
const HOME_SIDEBAR_REVEAL_DELAY_MS = HOME_SIDEBAR_ANIMATION_MS + 20;

function createAppContext() {
  const appBase = document.body.dataset.appBase || "";
  const api = createApiClient({ baseUrl: appBase });
  const settings = createSettingsStore();
  const theme = createThemeController(settings);
  const session = createSessionStore(api);
  const i18n = createI18n(settings);
  const modalRoot = byId("appModalRoot");
  const modalClose = byId("appGlobalClose");
  const toastRoot = byId("appToastRoot");
  const modal = createModalManager({ root: modalRoot, closeButton: modalClose });
  const toast = createToastManager({ root: toastRoot });
  const imageModal = createImageModalController({ app: { api, appBase, settings, session, i18n, modal, toast } });

  return {
    api,
    appBase,
    settings,
    theme,
    session,
    i18n,
    modal,
    toast,
    imageModal,
    uploadModal: null,
    page: document.body.dataset.page || "",
    presence: null
  };
}

function applyDocumentLanguage(language) {
  document.documentElement.lang = languageToLocaleTag(language);
}

function dispatchLanguageChange(language) {
  window.dispatchEvent(new CustomEvent("gallery:language-changed", {
    detail: { language },
  }));
}

async function syncLanguagePreference(app, sessionState) {
  const resolvedLanguage = app.settings.getLanguage();
  try {
    await app.i18n.loadCatalog?.(resolvedLanguage, `${app.appBase}/assets/i18n/${resolvedLanguage}.json`);
  } catch {
    // Use already loaded catalogs as fallback.
  }
  app.i18n.setLanguage(resolvedLanguage);
  applyDocumentLanguage(resolvedLanguage);
  app.i18n.apply?.(document);
  dispatchLanguageChange(resolvedLanguage);
  return resolvedLanguage;
}

function createPresenceController(app) {
  let started = false;
  let intervalId = null;
  let hiddenTimerId = null;
  let lastVisible = null;
  let lastSentAt = 0;
  let inflight = null;

  function clearHiddenTimer() {
    if (hiddenTimerId !== null) {
      window.clearTimeout(hiddenTimerId);
      hiddenTimerId = null;
    }
  }

  function currentVisibleState() {
    return document.visibilityState !== "hidden";
  }

  async function sendPresence(visible, keepalive = false, force = false) {
    const now = Date.now();
    if (!force && lastVisible === visible && now - lastSentAt < 5000) {
      return;
    }

    if (inflight && !force) {
      return inflight;
    }

    const url = `${app.appBase}/api/auth/presence`;
    const request = fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Gallery-Language": document.documentElement.lang || "en-US"
      },
      body: JSON.stringify({ visible }),
      keepalive
    })
      .then(async (response) => {
        const contentType = response.headers.get("content-type") || "";
        let payload = null;

        if (contentType.includes("application/json")) {
          payload = await response.json().catch(() => null);
        }

        if (!response.ok || (payload && payload.ok === false)) {
          throw new Error(payload?.error?.message || payload?.message || "presence update failed");
        }

        lastVisible = visible;
        lastSentAt = Date.now();
      })
      .catch(() => {})
      .finally(() => {
        if (inflight === request) {
          inflight = null;
        }
      });

    inflight = request;
    return request;
  }

  function scheduleHiddenPresence() {
    clearHiddenTimer();
    hiddenTimerId = window.setTimeout(() => {
      sendPresence(false);
    }, PRESENCE_HIDDEN_DEBOUNCE_MS);
  }

  function handleVisibilityChange() {
    if (currentVisibleState()) {
      clearHiddenTimer();
      sendPresence(true, false, true);
      return;
    }

    scheduleHiddenPresence();
  }

  function handlePageShow() {
    clearHiddenTimer();
    sendPresence(true, false, true);
  }

  function handlePageHide() {
    clearHiddenTimer();
    sendPresence(false, true, true);
  }

  function handleFocus() {
    clearHiddenTimer();
    sendPresence(true, false, true);
  }

  function handleBlur() {
    if (!currentVisibleState()) {
      scheduleHiddenPresence();
    }
  }

  function startInterval() {
    if (intervalId !== null) return;

    intervalId = window.setInterval(() => {
      if (!currentVisibleState()) return;
      sendPresence(true);
    }, PRESENCE_INTERVAL_MS);
  }

  function stopInterval() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  return {
    async start() {
      if (started) return;

      started = true;
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("pageshow", handlePageShow);
      window.addEventListener("pagehide", handlePageHide);
      window.addEventListener("focus", handleFocus);
      window.addEventListener("blur", handleBlur);
      startInterval();
      await sendPresence(currentVisibleState(), false, true);
    },
    stop() {
      if (!started) return;

      started = false;
      clearHiddenTimer();
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    }
  };
}

function ensureHomeSidebarDefaultExpanded() {
  try {
    const initialized = window.localStorage.getItem(HOME_SIDEBAR_INIT_KEY);
    if (initialized === "1") return;
    window.localStorage.setItem(HOME_SIDEBAR_COLLAPSED_KEY, "0");
    window.localStorage.setItem(HOME_SIDEBAR_INIT_KEY, "1");
  } catch {
    return;
  }
}

function normalizeHomeGridColumns(value) {
  const num = Number(value);
  return HOME_GRID_COLUMNS_ALLOWED.includes(num) ? num : HOME_GRID_COLUMNS_DEFAULT;
}

function readHomeGridColumns() {
  try {
    return normalizeHomeGridColumns(window.localStorage.getItem(HOME_GRID_COLUMNS_KEY));
  } catch {
    return HOME_GRID_COLUMNS_DEFAULT;
  }
}

function writeHomeGridColumns(value) {
  try {
    window.localStorage.setItem(HOME_GRID_COLUMNS_KEY, String(normalizeHomeGridColumns(value)));
  } catch {
    return;
  }
}

function initHomeGridColumns() {
  const grid = byId("homeGalleryGrid") || document.querySelector(".home-gallery-grid");
  const controls = byId("homeGridColumnsControls") || document.querySelector(".home-grid-columns");
  const buttons = Array.from(document.querySelectorAll("[data-grid-cols]"));
  const media = window.matchMedia(`(max-width: ${HOME_GRID_COLUMNS_MOBILE_BREAKPOINT}px)`);

  if (!grid || !controls || buttons.length === 0) {
    return;
  }

  function setButtonState(columns, isMobile) {
    controls.hidden = isMobile;

    for (const button of buttons) {
      const value = normalizeHomeGridColumns(button.dataset.gridCols);
      const active = !isMobile && value === columns;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.hidden = isMobile;
    }
  }

  function apply(columns) {
    const isMobile = media.matches;
    const resolved = isMobile ? 1 : normalizeHomeGridColumns(columns);

    grid.dataset.gridCols = String(resolved);
    grid.style.setProperty("--home-grid-columns", String(resolved));
    setButtonState(resolved, isMobile);
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      if (media.matches) return;
      const value = normalizeHomeGridColumns(button.dataset.gridCols);
      writeHomeGridColumns(value);
      apply(value);
    });
  }

  const handleMediaChange = () => {
    apply(readHomeGridColumns());
  };

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", handleMediaChange);
  } else if (typeof media.addListener === "function") {
    media.addListener(handleMediaChange);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== HOME_GRID_COLUMNS_KEY) return;
    apply(readHomeGridColumns());
  });

  apply(readHomeGridColumns());
}

const HOME_MOBILE_BREAKPOINT = "(max-width: 980px)";

function initPublicSidebar() {
  const root = byId("homeSidebar");
  const toggleButton = byId("homeSidebarToggle");
  const closeButton = byId("homeSidebarClose");
  const backdrop = byId("homeSidebarBackdrop");
  const mobileFilterBtn = byId("homeMobileFilterBtn");
  const layout = root?.closest(".home-shell-layout") || null;
  if (!root || !toggleButton || !layout) return;

  const mobileMedia = window.matchMedia(HOME_MOBILE_BREAKPOINT);
  const edgePeekPx = 44;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let revealTimerId = null;

  function isMobile() {
    return mobileMedia.matches;
  }

  function clearRevealTimer() {
    if (revealTimerId !== null) {
      window.clearTimeout(revealTimerId);
      revealTimerId = null;
    }
  }

  function readStoredState() {
    try {
      return window.localStorage.getItem(HOME_SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  }

  function writeStoredState(collapsed) {
    try {
      window.localStorage.setItem(HOME_SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      return;
    }
  }

  function syncBackdrop(collapsed) {
    if (!backdrop) return;
    if (isMobile() && !collapsed) {
      backdrop.hidden = false;
    } else {
      backdrop.hidden = true;
    }
  }

  function syncMobileScrollLock(collapsed) {
    document.body.classList.toggle("is-home-sidebar-open", isMobile() && !collapsed);
  }

  function updateToggleUi(collapsed) {
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.setAttribute("aria-label", collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ");

    const icon = toggleButton.querySelector("span");
    if (icon) {
      icon.textContent = "❯";
    }

    if (mobileFilterBtn) {
      mobileFilterBtn.classList.toggle("is-active", !collapsed);
    }
  }

  function finishExpandedContent() {
    root.classList.remove("is-content-hidden");

    if (closeButton) {
      closeButton.hidden = false;
    }
  }

  function applyState(collapsed, { animate = false } = {}) {
    clearRevealTimer();

    root.classList.toggle("is-collapsed", collapsed);
    layout.classList.toggle("is-sidebar-collapsed", collapsed);
    document.body.classList.toggle("is-home-sidebar-collapsed", collapsed);
    updateCustomScrollbars();

    if (!collapsed) {
      document.body.classList.remove("is-home-sidebar-edge-peek");
    }

    syncBackdrop(collapsed);
    syncMobileScrollLock(collapsed);
    updateToggleUi(collapsed);

    if (collapsed) {
      root.classList.add("is-content-hidden");

      if (closeButton) {
        closeButton.hidden = true;
      }

      // On mobile, don't persist collapsed state (always resets to closed on load)
      if (!isMobile()) {
        writeStoredState(true);
      }
      return;
    }

    const shouldAnimate = animate && !prefersReducedMotion.matches;

    if (!shouldAnimate) {
      finishExpandedContent();
      if (!isMobile()) writeStoredState(false);
      return;
    }

    root.classList.add("is-content-hidden");

    if (closeButton) {
      closeButton.hidden = true;
    }

    revealTimerId = window.setTimeout(() => {
      revealTimerId = null;
      if (root.classList.contains("is-collapsed")) {
        return;
      }
      finishExpandedContent();
    }, HOME_SIDEBAR_REVEAL_DELAY_MS);

    if (!isMobile()) writeStoredState(false);
  }

  function isCollapsed() {
    return root.classList.contains("is-collapsed");
  }

  function syncEdgePeek(clientX) {
    if (isMobile()) return;
    if (!isCollapsed()) {
      document.body.classList.remove("is-home-sidebar-edge-peek");
      return;
    }

    const nearEdge = Number(clientX || 0) <= edgePeekPx;
    document.body.classList.toggle("is-home-sidebar-edge-peek", nearEdge);
  }

  // On mobile: always start collapsed; on desktop: use stored preference
  if (isMobile()) {
    applyState(true);
  } else {
    ensureHomeSidebarDefaultExpanded();
    applyState(readStoredState());
  }
  document.documentElement.classList.remove("is-home-mobile-preload");

  toggleButton.addEventListener("click", () => {
    applyState(!isCollapsed(), { animate: true });
  });

  closeButton?.addEventListener("click", () => {
    applyState(true, { animate: true });
  });

  backdrop?.addEventListener("click", () => {
    applyState(true, { animate: true });
  });

  mobileFilterBtn?.addEventListener("click", () => {
    applyState(!isCollapsed(), { animate: true });
  });

  window.addEventListener("mousemove", (event) => {
    syncEdgePeek(event.clientX);
  });

  layout.addEventListener("mouseleave", () => {
    document.body.classList.remove("is-home-sidebar-edge-peek");
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== HOME_SIDEBAR_COLLAPSED_KEY) return;
    if (!isMobile()) applyState(readStoredState());
  });

  // When switching from mobile to desktop, restore stored state
  mobileMedia.addEventListener("change", () => {
    if (!isMobile()) {
      backdrop.hidden = true;
      document.body.classList.remove("is-home-sidebar-open");
      applyState(readStoredState());
    } else {
      applyState(true);
    }
  });
}

async function bootstrap() {
  const app = createAppContext();
  window.App = app;
  app.theme.init();
  const localeLoadOrder = buildLocaleLoadOrder(app.settings.getLanguage());

  try {
    await app.i18n.loadCatalogs(`${app.appBase}/assets/i18n`, localeLoadOrder);
  } catch {
    // Keep in-module dictionaries as fallback when shared catalogs are unavailable.
  }

  initUserShell(app);
  initPublicProfileModal(app);
  ensureCustomScrollbars({ includeWindow: true, selectors: [".home-sidebar__body"] });

  app.uploadModal = createUploadModalController({ app, scope: "public" });

  const publicUploadTriggers = [byId("shellHeaderUploadButton"), byId("shellUploadOpenButton")].filter(Boolean);
  for (const trigger of publicUploadTriggers) {
    trigger.addEventListener("click", () => {
      app.uploadModal?.open({
        onUploaded: () => document.dispatchEvent(new CustomEvent("gallery:uploaded")),
      });
    });
  }

  try {
    const sessionState = await app.session.load();
    await syncLanguagePreference(app, sessionState);

    if (sessionState.authenticated) {
      app.presence = createPresenceController(app);
      await app.presence.start();
    }
  } catch (error) {
    app.toast.error(resolveLocalizedMessage(error, "Failed to load session."));
  }

  if (app.page === "home") {
    initPublicSidebar();
    initHomePage(app);
    initHomeGridColumns();
  }

  await syncLanguagePreference(app, null);
  window.addEventListener("gallery:language-changed", () => {
    app.i18n.apply?.(document);
  });
}

bootstrap();
