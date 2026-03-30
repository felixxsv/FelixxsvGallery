import { byId } from "./core/dom.js";
import { createApiClient } from "./core/api.js";
import { createModalManager } from "./core/modal.js";
import { createToastManager } from "./core/toast.js";
import { createSettingsStore } from "./core/settings.js";
import { createThemeController } from "./core/theme.js";
import { createSessionStore } from "./core/session.js";
import { createI18n } from "./core/i18n.js";
import { createImageModalController } from "./core/image-modal.js";
import { initUserShell } from "./components/user-shell.js";
import { initHomePage } from "./pages/home.js";

const PRESENCE_INTERVAL_MS = 30000;
const PRESENCE_HIDDEN_DEBOUNCE_MS = 1000;
const HOME_SIDEBAR_COLLAPSED_KEY = "gallery.home.sidebar.collapsed";
const HOME_SIDEBAR_INIT_KEY = "gallery.home.sidebar.init.v2";
const HOME_GRID_COLUMNS_KEY = "gallery.home.gridColumns";
const HOME_GRID_COLUMNS_DEFAULT = 3;
const HOME_GRID_COLUMNS_ALLOWED = [1, 2, 3, 4];
const HOME_GRID_COLUMNS_MOBILE_BREAKPOINT = 980;

function createAppContext() {
  const appBase = document.body.dataset.appBase || "/gallery";
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
    page: document.body.dataset.page || "",
    presence: null
  };
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
        "Content-Type": "application/json"
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
  const grid = byId("homeGalleryGrid");
  const controls = byId("homeGridColumnsControls");
  const buttons = Array.from(document.querySelectorAll("#homeGridColumnsControls [data-grid-cols]"));
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

function initPublicSidebar() {
  const root = byId("homeSidebar");
  const toggleButton = byId("homeSidebarToggle");
  const closeButton = byId("homeSidebarClose");
  const layout = root?.closest(".home-shell-layout") || null;
  if (!root || !toggleButton || !layout) return;

  const edgePeekPx = 44;

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

  function applyState(collapsed) {
    root.classList.toggle("is-collapsed", collapsed);
    layout.classList.toggle("is-sidebar-collapsed", collapsed);
    document.body.classList.toggle("is-home-sidebar-collapsed", collapsed);

    if (!collapsed) {
      document.body.classList.remove("is-home-sidebar-edge-peek");
    }

    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.setAttribute("aria-label", collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ");

    const icon = toggleButton.querySelector("span");
    if (icon) {
      icon.textContent = "❯";
    }

    if (closeButton) {
      closeButton.hidden = collapsed;
    }

    writeStoredState(collapsed);
  }

  function isCollapsed() {
    return root.classList.contains("is-collapsed");
  }

  function syncEdgePeek(clientX) {
    if (!isCollapsed()) {
      document.body.classList.remove("is-home-sidebar-edge-peek");
      return;
    }

    const nearEdge = Number(clientX || 0) <= edgePeekPx;
    document.body.classList.toggle("is-home-sidebar-edge-peek", nearEdge);
  }

  ensureHomeSidebarDefaultExpanded();

  toggleButton.addEventListener("click", () => {
    applyState(!isCollapsed());
  });

  closeButton?.addEventListener("click", () => {
    applyState(true);
  });

  window.addEventListener("mousemove", (event) => {
    syncEdgePeek(event.clientX);
  });

  layout.addEventListener("mouseleave", () => {
    document.body.classList.remove("is-home-sidebar-edge-peek");
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== HOME_SIDEBAR_COLLAPSED_KEY) return;
    applyState(readStoredState());
  });

  applyState(readStoredState());
}

async function bootstrap() {
  const app = createAppContext();
  window.App = app;
  app.theme.init();
  initUserShell(app);

  try {
    const sessionState = await app.session.load();
    if (sessionState.authenticated) {
      app.presence = createPresenceController(app);
      await app.presence.start();
    }
  } catch (error) {
    app.toast.error(error.message || "セッション情報の取得に失敗しました。");
  }

  if (app.page === "home") {
    initPublicSidebar();
    initHomeGridColumns();
    initHomePage(app);
  }
}

bootstrap();