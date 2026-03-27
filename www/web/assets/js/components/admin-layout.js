import { byId, qsa } from "../core/dom.js";
import { createApiClient, ApiError } from "../core/api.js";
import { createModalManager } from "../core/modal.js";
import { createToastManager } from "../core/toast.js";
import { createSessionStore } from "../core/session.js";
import { initSidebar } from "../core/sidebar.js";
import { createDirtyGuard } from "../core/dirty-guard.js";

function createAdminContext() {
  const appBase = document.body.dataset.appBase || "/gallery";
  const api = createApiClient({ baseUrl: appBase });
  const session = createSessionStore(api);
  const modalRoot = byId("appModalRoot");
  const modalClose = byId("appGlobalClose");
  const toastRoot = byId("appToastRoot");
  const modal = createModalManager({ root: modalRoot, closeButton: modalClose });
  const toast = createToastManager({ root: toastRoot });
  return {
    appBase,
    api,
    session,
    modal,
    toast,
    page: document.body.dataset.adminPage || "dashboard",
    ready: false,
    bootstrapData: null
  };
}


function createPresenceTracker(app) {
  const state = {
    started: false,
    stopped: false,
    inFlight: false,
    intervalMs: 30 * 1000,
    timerId: null,
  };

  function clearTimer() {
    if (state.timerId) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }

  function applyConfig(data) {
    const heartbeatSec = Number(data?.heartbeat_interval_sec || 0);
    if (Number.isFinite(heartbeatSec) && heartbeatSec >= 10) {
      state.intervalMs = heartbeatSec * 1000;
    }
  }

  function schedule() {
    clearTimer();
    if (state.stopped || document.visibilityState !== "visible") return;
    state.timerId = window.setTimeout(() => {
      void ping();
    }, state.intervalMs);
  }

  async function ping() {
    if (state.stopped || state.inFlight) return;
    state.inFlight = true;
    try {
      const response = await fetch(`${app.appBase}/api/auth/presence`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        keepalive: true,
        headers: {
          "Content-Type": "application/json"
        }
      });
      if (response.status === 401 || response.status === 403) {
        state.stopped = true;
        clearTimer();
        return;
      }
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok !== false) {
        applyConfig(payload?.data?.presence || payload?.data || null);
      }
    } catch (error) {
    } finally {
      state.inFlight = false;
      schedule();
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      void ping();
      return;
    }
    clearTimer();
  }

  function start() {
    if (state.started) return;
    state.started = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", () => {
      clearTimer();
    });
    handleVisibilityChange();
  }

  function stop() {
    state.stopped = true;
    clearTimer();
  }

  return { start, stop };
}

function show(el) {
  if (el) el.hidden = false;
}

function hide(el) {
  if (el) el.hidden = true;
}

export async function initAdminLayout() {
  const app = createAdminContext();
  app.presence = createPresenceTracker(app);
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
    reloadButton: byId("adminReloadButton")
  };

  const shellState = {
    confirmResolver: null
  };

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

  const dirtyGuard = createDirtyGuard({
    confirmDiscard: openDiscardConfirm
  });

  const sidebar = initSidebar({
    root: refs.sidebar,
    toggleButton: refs.sidebarToggle,
    onNavigate: async (href) => {
      const ok = await dirtyGuard.confirmIfNeeded("未保存の変更があります。破棄して移動しますか？");
      if (!ok) return false;
      dirtyGuard.allowNextLeave();
      return true;
    }
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
    app.presence?.start?.();
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
