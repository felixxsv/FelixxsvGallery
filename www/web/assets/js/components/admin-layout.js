import { byId, qsa } from "../core/dom.js";
import { createApiClient, ApiError } from "../core/api.js";
import { createModalManager } from "../core/modal.js";
import { createToastManager } from "../core/toast.js";
import { createSessionStore } from "../core/session.js";
import { initSidebar } from "../core/sidebar.js";
import { createDirtyGuard } from "../core/dirty-guard.js";

const DEFAULT_LIVE_ALLOWED_INTERVALS = [0, 3000, 5000, 10000, 30000, 60000];

function normalizeRefreshInterval(value, allowedIntervals = DEFAULT_LIVE_ALLOWED_INTERVALS, defaultIntervalMs = 3000) {
  const ms = Number(value);
  return allowedIntervals.includes(ms) ? ms : defaultIntervalMs;
}

function getStoredRefreshInterval(storageKey, allowedIntervals = DEFAULT_LIVE_ALLOWED_INTERVALS, defaultIntervalMs = 3000) {
  if (!storageKey) {
    return normalizeRefreshInterval(defaultIntervalMs, allowedIntervals, defaultIntervalMs);
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    return normalizeRefreshInterval(raw == null ? defaultIntervalMs : Number(raw), allowedIntervals, defaultIntervalMs);
  } catch {
    return normalizeRefreshInterval(defaultIntervalMs, allowedIntervals, defaultIntervalMs);
  }
}

function setStoredRefreshInterval(storageKey, value, allowedIntervals = DEFAULT_LIVE_ALLOWED_INTERVALS, defaultIntervalMs = 3000) {
  const normalized = normalizeRefreshInterval(value, allowedIntervals, defaultIntervalMs);
  if (!storageKey) {
    return normalized;
  }
  try {
    window.localStorage.setItem(storageKey, String(normalized));
  } catch {
    return normalized;
  }
  return normalized;
}

function createLiveWatcher({
  storageKey = "",
  defaultIntervalMs = 3000,
  allowedIntervals = DEFAULT_LIVE_ALLOWED_INTERVALS,
  visibleOnly = true,
  enabledWhen = () => true,
  onTick = async () => {},
  onError = null,
} = {}) {
  let timerId = null;
  let inFlight = null;
  let destroyed = false;

  const getIntervalMs = () => getStoredRefreshInterval(storageKey, allowedIntervals, defaultIntervalMs);

  const clearTimer = () => {
    if (timerId) {
      window.clearTimeout(timerId);
      timerId = null;
    }
  };

  const canRun = () => {
    if (destroyed) return false;
    if (visibleOnly && document.visibilityState === "hidden") return false;
    return Boolean(enabledWhen());
  };

  const schedule = () => {
    clearTimer();
    if (!canRun()) return;
    const intervalMs = getIntervalMs();
    if (!intervalMs) return;
    timerId = window.setTimeout(() => {
      void run("timer");
    }, intervalMs);
  };

  const run = async (reason = "manual") => {
    if (!canRun()) {
      schedule();
      return;
    }
    if (inFlight) {
      return inFlight;
    }
    inFlight = Promise.resolve()
      .then(() => onTick({ reason, intervalMs: getIntervalMs() }))
      .catch((error) => {
        if (typeof onError === "function") {
          onError(error);
        }
      })
      .finally(() => {
        inFlight = null;
        schedule();
      });
    return inFlight;
  };

  const handleVisibilityChange = () => {
    if (destroyed) return;
    if (document.visibilityState === "visible") {
      void run("visible");
      return;
    }
    clearTimer();
  };

  const handleStorage = (event) => {
    if (!storageKey || event.key !== storageKey) return;
    schedule();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("storage", handleStorage);

  return {
    start({ immediate = true } = {}) {
      if (destroyed) return;
      if (immediate) {
        void run("start");
        return;
      }
      schedule();
    },
    stop() {
      clearTimer();
    },
    destroy() {
      destroyed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
    },
    refreshNow() {
      return run("manual");
    },
    schedule,
    getIntervalMs,
    setIntervalMs(value) {
      const normalized = setStoredRefreshInterval(storageKey, value, allowedIntervals, defaultIntervalMs);
      schedule();
      return normalized;
    },
    isBusy() {
      return Boolean(inFlight);
    },
  };
}

function createAdminContext() {
  const appBase = document.body.dataset.appBase || "/gallery";
  const api = createApiClient({ baseUrl: appBase });
  const session = createSessionStore(api);
  const modalRoot = byId("appModalRoot");
  const modalClose = byId("appGlobalClose");
  const toastRoot = byId("appToastRoot");
  const modal = createModalManager({ root: modalRoot, closeButton: modalClose });
  const toast = createToastManager({ root: toastRoot });
  const liveWatchers = new Set();
  const live = {
    allowedIntervals: DEFAULT_LIVE_ALLOWED_INTERVALS.slice(),
    normalizeInterval: normalizeRefreshInterval,
    getStoredInterval: (storageKey, allowedIntervals, defaultIntervalMs) =>
      getStoredRefreshInterval(storageKey, allowedIntervals, defaultIntervalMs),
    setStoredInterval: (storageKey, value, allowedIntervals, defaultIntervalMs) =>
      setStoredRefreshInterval(storageKey, value, allowedIntervals, defaultIntervalMs),
    createWatcher(options = {}) {
      const watcher = createLiveWatcher(options);
      liveWatchers.add(watcher);
      const destroy = watcher.destroy.bind(watcher);
      watcher.destroy = () => {
        liveWatchers.delete(watcher);
        destroy();
      };
      return watcher;
    },
    destroyAll() {
      for (const watcher of [...liveWatchers]) {
        watcher.destroy();
      }
    },
  };
  return {
    appBase,
    api,
    session,
    modal,
    toast,
    page: document.body.dataset.adminPage || "dashboard",
    ready: false,
    bootstrapData: null,
    live,
  };
}

function show(el) {
  if (el) el.hidden = false;
}

function hide(el) {
  if (el) el.hidden = true;
}

export async function initAdminLayout() {
  const app = createAdminContext();
  window.AdminApp = app;
  const refs = {
    loading: byId("adminLoadingState"),
    appShell: byId("adminAppShell"),
    notFound: byId("adminNotFoundState"),
    error: byId("adminErrorState"),
    pageTitle: byId("adminPageTitle"),
    pageDescription: byId("adminPageDescription"),
    headerUserName: byId("adminHeaderUserName"),
    headerUserKey: byId("adminHeaderUserKey"),
    sidebar: byId("adminSidebar"),
    sidebarToggle: byId("adminSidebarToggle"),
    navList: byId("adminSidebarNav"),
    confirmMessage: byId("adminDiscardConfirmMessage"),
    confirmApprove: byId("adminDiscardConfirmApproveButton"),
    confirmCancel: byId("adminDiscardConfirmCancelButton"),
    reloadButton: byId("adminReloadButton"),
  };
  const shellState = { confirmResolver: null };

  function showNotFound() {
    hide(refs.loading);
    hide(refs.error);
    hide(refs.appShell);
    show(refs.notFound);
    document.title = "404 - Felixxsv Gallery";
    document.dispatchEvent(new CustomEvent("admin:not-found"));
  }

  function showError(message) {
    hide(refs.loading);
    hide(refs.notFound);
    hide(refs.appShell);
    show(refs.error);
    const description = refs.error?.querySelector(".admin-state-card__description");
    if (description) {
      description.textContent = message || "管理画面の初期化に失敗しました。";
    }
    document.dispatchEvent(new CustomEvent("admin:error", { detail: { message } }));
  }

  function showApp() {
    hide(refs.loading);
    hide(refs.notFound);
    hide(refs.error);
    show(refs.appShell);
  }

  function populateNavigation(items) {
    const links = qsa("[data-admin-nav-link]", refs.navList);
    const currentPath = `${window.location.pathname}${window.location.pathname.endsWith("/") ? "" : "/"}`;
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const normalizedHref = href.endsWith("/") ? href : `${href}/`;
      const active = normalizedHref === currentPath;
      link.classList.toggle("is-active", active);
      link.setAttribute("aria-current", active ? "page" : "false");
    }
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const target = refs.navList?.querySelector(`[data-admin-nav-link-key="${item.key}"]`);
      if (!target) continue;
      target.setAttribute("href", item.href);
      const label = target.querySelector(".admin-sidebar__label");
      if (label) label.textContent = item.label;
    }
  }

  function openDiscardConfirm(message) {
    if (!refs.confirmMessage || !refs.confirmApprove || !refs.confirmCancel) {
      return Promise.resolve(window.confirm(message));
    }
    refs.confirmMessage.textContent = message;
    app.modal.open("admin-discard-confirm");
    return new Promise((resolve) => {
      shellState.confirmResolver = resolve;
    });
  }

  function closeDiscardConfirm(result) {
    const resolver = shellState.confirmResolver;
    shellState.confirmResolver = null;
    app.modal.close("admin-discard-confirm");
    if (resolver) resolver(Boolean(result));
  }

  refs.confirmApprove?.addEventListener("click", () => {
    closeDiscardConfirm(true);
  });
  refs.confirmCancel?.addEventListener("click", () => {
    closeDiscardConfirm(false);
  });
  refs.reloadButton?.addEventListener("click", () => {
    window.location.reload();
  });

  const dirtyGuard = createDirtyGuard({ confirmDiscard: openDiscardConfirm });
  const sidebar = initSidebar({
    root: refs.sidebar,
    toggleButton: refs.sidebarToggle,
    onNavigate: async () => {
      const ok = await dirtyGuard.confirmIfNeeded("未保存の変更があります。破棄して移動しますか？");
      if (!ok) return false;
      dirtyGuard.allowNextLeave();
      return true;
    },
  });

  app.dirtyGuard = dirtyGuard;
  app.sidebar = sidebar;

  try {
    const sessionState = await app.session.load();
    if (!sessionState.authenticated) {
      showNotFound();
      return;
    }

    const user = sessionState.data?.user || null;
    const canOpenAdmin = Boolean(sessionState.data?.features?.can_open_admin);
    if (!user || !canOpenAdmin || user.role !== "admin") {
      showNotFound();
      return;
    }

    const payload = await app.api.get(`/api/admin/bootstrap?page=${encodeURIComponent(app.page)}`);
    const data = payload.data || {};
    const currentUser = data.current_user || {};
    const page = data.page || {};
    const pageTitle = page.title || refs.pageTitle?.textContent || "管理画面";
    document.title = `${pageTitle} - Felixxsv Gallery`;

    if (refs.pageTitle) refs.pageTitle.textContent = pageTitle;
    if (refs.headerUserName) refs.headerUserName.textContent = currentUser.display_name || "-";
    if (refs.headerUserKey) refs.headerUserKey.textContent = currentUser.user_key || "-";

    const desc = document.body.dataset.adminDescription || "";
    if (refs.pageDescription) refs.pageDescription.textContent = desc;

    populateNavigation(data.navigation || []);

    app.bootstrapData = data;
    app.ready = true;
    showApp();
    document.dispatchEvent(new CustomEvent("admin:ready", { detail: { app, bootstrap: data } }));
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      showNotFound();
      return;
    }
    showError(error?.message || "管理画面の初期化に失敗しました。");
  }
}

initAdminLayout();
