import { byId, qsa } from "../core/dom.js";
import { createApiClient, ApiError } from "../core/api.js";
import { createModalManager } from "../core/modal.js";
import { createToastManager } from "../core/toast.js";
import { createSessionStore } from "../core/session.js";
import { createSettingsStore } from "../core/settings.js";
import { createI18n } from "../core/i18n.js";
import { createImageModalController } from "../core/image-modal.js";
import { initSidebar } from "../core/sidebar.js";
import { createDirtyGuard } from "../core/dirty-guard.js";

const PRESENCE_INTERVAL_MS = 30000;
const PRESENCE_HIDDEN_DEBOUNCE_MS = 1000;

function createAdminContext() {
  const appBase = document.body.dataset.appBase || "/gallery";
  const api = createApiClient({ baseUrl: appBase });
  const settings = createSettingsStore();
  const session = createSessionStore(api);
  const i18n = createI18n(settings);
  const modalRoot = byId("appModalRoot");
  const modalClose = byId("appGlobalClose");
  const toastRoot = byId("appToastRoot");
  const modal = createModalManager({ root: modalRoot, closeButton: modalClose });
  const toast = createToastManager({ root: toastRoot });
  const imageModal = createImageModalController({ app: { api, appBase, settings, session, i18n, modal, toast } });

  return {
    appBase,
    api,
    settings,
    session,
    i18n,
    modal,
    toast,
    imageModal,
    page: document.body.dataset.adminPage || "dashboard",
    ready: false,
    bootstrapData: null,
    presence: null
  };
}

function show(el) {
  if (el) el.hidden = false;
}

function hide(el) {
  if (el) el.hidden = true;
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
    headerSidebarToggle: byId("adminHeaderSidebarToggle"),
    homeLink: byId("adminHomeLink"),
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
    onNavigate: async () => {
      const ok = await dirtyGuard.confirmIfNeeded("未保存の変更があります。破棄して移動しますか？");
      if (!ok) return false;
      dirtyGuard.allowNextLeave();
      return true;
    }
  });

  app.dirtyGuard = dirtyGuard;
  app.sidebar = sidebar;

  refs.headerSidebarToggle?.addEventListener("click", () => {
    app.sidebar?.toggle?.();
  });

  refs.homeLink?.addEventListener("click", async (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const href = refs.homeLink.getAttribute("href") || "/gallery/";
    event.preventDefault();

    const ok = await dirtyGuard.confirmIfNeeded("未保存の変更があります。破棄して移動しますか？");
    if (!ok) return;

    dirtyGuard.allowNextLeave();
    window.location.assign(href);
  });

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

    app.presence = createPresenceController(app);
    await app.presence.start();

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

    document.dispatchEvent(new CustomEvent("admin:ready", {
      detail: {
        app,
        bootstrap: data
      }
    }));
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      showNotFound();
      return;
    }

    showError(error?.message || "管理画面の初期化に失敗しました。");
  }
}

initAdminLayout();