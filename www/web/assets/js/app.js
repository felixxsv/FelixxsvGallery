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


function initPublicSidebar() {
  const root = byId("homeSidebar");
  const toggleButton = byId("homeSidebarToggle");
  const closeButton = byId("homeSidebarClose");
  if (!root || !toggleButton) return;

  const storageKey = "gallery.home.sidebar.collapsed";

  function readStoredState() {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  }

  function writeStoredState(collapsed) {
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      return;
    }
  }

  function applyState(collapsed) {
    root.classList.toggle("is-collapsed", collapsed);
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.setAttribute("aria-label", collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ");
    if (closeButton) closeButton.hidden = collapsed;
    writeStoredState(collapsed);
  }

  function isCollapsed() {
    return root.classList.contains("is-collapsed");
  }

  toggleButton.addEventListener("click", () => {
    applyState(!isCollapsed());
  });

  closeButton?.addEventListener("click", () => {
    applyState(true);
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
    initHomePage(app);
  }
}

bootstrap();