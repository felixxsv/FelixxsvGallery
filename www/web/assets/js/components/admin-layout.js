import { byId, qsa } from "../core/dom.js";
import { createApiClient, ApiError } from "../core/api.js";
import { createModalManager } from "../core/modal.js";
import { createToastManager } from "../core/toast.js";
import { createSessionStore } from "../core/session.js";
import { createSettingsStore, languageToLocaleTag } from "../core/settings.js";
import { buildLocaleLoadOrder, createI18n } from "../core/i18n.js";
import { createImageModalController } from "../core/image-modal.js";
import { initSidebar } from "../core/sidebar.js";
import { createDirtyGuard } from "../core/dirty-guard.js";
import { createThemeController } from "../core/theme.js";
import { initUserShell } from "./user-shell.js?v=20260413-crop";
import { initPublicProfileModal } from "./public-profile.js?v=20260413-crop";

const PRESENCE_INTERVAL_MS = 30000;
const PRESENCE_HIDDEN_DEBOUNCE_MS = 1000;
const SIDEBAR_EDGE_PEEK_PX = 44;
const ADMIN_SIDEBAR_COLLAPSED_KEY = "gallery.admin.sidebar.collapsed";
const ADMIN_SIDEBAR_INIT_KEY = "gallery.admin.sidebar.init.v2";
const ADMIN_PAGE_I18N_PREFIX = {
  dashboard: "admin_dashboard",
  content: "admin_content",
  users: "admin_users",
  mail: "admin_mail",
  settings: "admin_settings",
  "audit-logs": "admin_audit",
};

function createAdminContext() {
  const appBase = document.body.dataset.appBase || "";
  const api = createApiClient({ baseUrl: appBase });
  const settings = createSettingsStore();
  const session = createSessionStore(api);
  const i18n = createI18n(settings);
  const theme = createThemeController(settings);
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
    theme,
    modal,
    toast,
    imageModal,
    page: document.body.dataset.adminPage || "dashboard",
    ready: false,
    bootstrapData: null,
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

function show(el) {
  if (el) el.hidden = false;
}

function hide(el) {
  if (el) el.hidden = true;
}

function ensureAdminSidebarDefaultExpanded() {
  try {
    const initialized = window.localStorage.getItem(ADMIN_SIDEBAR_INIT_KEY);
    if (initialized === "1") return;
    window.localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY, "0");
    window.localStorage.setItem(ADMIN_SIDEBAR_INIT_KEY, "1");
  } catch {
    return;
  }
}

function getAdminPagePrefix(page) {
  return ADMIN_PAGE_I18N_PREFIX[String(page || "").trim()] || "";
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
  const localeLoadOrder = buildLocaleLoadOrder(app.settings.getLanguage());

  try {
    await app.i18n.loadCatalogs(`${app.appBase}/assets/i18n`, localeLoadOrder);
  } catch {
    // Keep in-module dictionaries as fallback when shared catalogs are unavailable.
  }

  await syncLanguagePreference(app, null);
  window.addEventListener("gallery:language-changed", () => {
    app.i18n.apply?.(document);
  });

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
    sidebarTitle: document.querySelector("#adminSidebar .admin-sidebar__title"),
    sidebarSubtitle: document.querySelector("#adminSidebar .admin-sidebar__subtitle"),
    sidebarToggle: byId("adminSidebarToggle"),
    navList: byId("adminSidebarNav"),
    confirmMessage: byId("adminDiscardConfirmMessage"),
    confirmApprove: byId("adminDiscardConfirmApproveButton"),
    confirmCancel: byId("adminDiscardConfirmCancelButton"),
    reloadButton: byId("adminReloadButton"),
  };

  const shellState = {
    confirmResolver: null,
    currentSidebarTitle: (refs.pageTitle?.textContent || "").trim() || app.i18n.t("admin_layout.page_title", "Admin")
  };

  const t = (key, fallback, vars = {}) => app.i18n.t(`admin_layout.${key}`, fallback, vars);
  const pageT = (key, fallback, vars = {}) => {
    const prefix = getAdminPagePrefix(app.page);
    if (!prefix) return fallback;
    return app.i18n.t(`${prefix}.${key}`, fallback, vars);
  };

  function applyStaticTranslations() {
    const loadingTitle = refs.loading?.querySelector(".admin-state-card__title");
    const loadingDesc = refs.loading?.querySelector(".admin-state-card__description");
    refs.headerUserName?.parentElement?.querySelector("#shellUserTrigger")?.setAttribute("aria-label", t("user_info", "User menu"));
    refs.navList?.setAttribute("aria-label", t("nav_label", "Admin navigation"));
    if (loadingTitle) loadingTitle.textContent = t("loading_title", "Checking Admin Access");
    if (loadingDesc) loadingDesc.textContent = t("loading_desc", "The admin console will render after the admin permission check completes.");
    const notFoundTitle = refs.notFound?.querySelector(".admin-state-card__title");
    const notFoundDesc = refs.notFound?.querySelector(".admin-state-card__description");
    const notFoundButton = refs.notFound?.querySelector(".admin-state-card__actions .app-button");
    const errorTitle = refs.error?.querySelector(".admin-state-card__title");
    const errorDesc = refs.error?.querySelector(".admin-state-card__description");
    if (notFoundTitle) notFoundTitle.textContent = t("not_found_title", "404");
    if (notFoundDesc) notFoundDesc.textContent = t("not_found_desc", "The page you requested was not found.");
    if (notFoundButton) notFoundButton.textContent = t("home_back", "Back to Home");
    if (errorTitle) errorTitle.textContent = t("error_title", "Initialization Failed");
    if (errorDesc && !refs.error?.dataset.dynamicMessage) errorDesc.textContent = t("error_desc", "An error occurred while initializing the admin console.");
    if (refs.reloadButton) refs.reloadButton.textContent = t("reload", "Reload");
    if (refs.sidebar?.querySelector(".admin-sidebar__footer")) {
      refs.sidebar.querySelector(".admin-sidebar__footer").textContent = t("sidebar_footer", "The admin console is shown only after permission checks complete.");
    }
    if (refs.sidebarSubtitle) {
      refs.sidebarSubtitle.textContent = t("brand_subtitle", "Admin Console");
      refs.sidebarSubtitle.hidden = false;
    }
    const navKeyMap = {
      dashboard: "nav_dashboard",
      content: "nav_content",
      users: "nav_users",
      contacts: "nav_contacts",
      mail: "nav_mail",
      settings: "nav_settings",
      "audit-logs": "nav_audit_logs",
    };
    for (const [navKey, labelKey] of Object.entries(navKeyMap)) {
      const label = refs.navList?.querySelector(`[data-admin-nav-link-key="${navKey}"] .admin-sidebar__label`);
      if (label) {
        label.textContent = t(labelKey, label.textContent || navKey);
      }
    }
    const discardTitle = byId("adminDiscardConfirmTitle");
    if (discardTitle) discardTitle.textContent = t("discard_title", "Confirm");
    if (refs.confirmCancel) refs.confirmCancel.textContent = t("discard_cancel", "Cancel");
    if (refs.confirmApprove) refs.confirmApprove.textContent = t("discard_approve", "Discard and Continue");
  }

  function syncSidebarDisplay(nextTitle = null) {
    if (typeof nextTitle === "string" && nextTitle.trim()) {
      shellState.currentSidebarTitle = nextTitle.trim();
    }

    const titleText = shellState.currentSidebarTitle || t("page_title", "Admin");
    const collapsed = app.sidebar?.isCollapsed?.() ?? refs.sidebar?.classList.contains("is-collapsed") ?? false;

    refs.appShell?.classList.toggle("is-sidebar-collapsed", collapsed);

    if (refs.sidebarTitle) {
      refs.sidebarTitle.textContent = titleText;
    }

    if (refs.sidebarSubtitle) {
      refs.sidebarSubtitle.textContent = t("brand_subtitle", "Admin Console");
      refs.sidebarSubtitle.hidden = false;
    }

    if (refs.sidebarToggle) {
      refs.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      refs.sidebarToggle.setAttribute("aria-label", collapsed ? t("sidebar_expand", "Expand sidebar") : t("sidebar_close", "Close sidebar"));
      const icon = refs.sidebarToggle.querySelector("span");
      if (icon) {
        icon.textContent = collapsed ? "❯" : "×";
      }
    }

    if (!collapsed) {
      refs.appShell?.classList.remove("is-sidebar-edge-peek");
    }
  }

  function bindSidebarEdgePeek() {
    if (!refs.appShell || !refs.sidebar) return;

    const handlePointerMove = (event) => {
      const collapsed = app.sidebar?.isCollapsed?.() ?? refs.sidebar.classList.contains("is-collapsed");
      if (!collapsed) {
        refs.appShell.classList.remove("is-sidebar-edge-peek");
        return;
      }

      const nearLeftEdge = Number(event.clientX || 0) <= SIDEBAR_EDGE_PEEK_PX;
      refs.appShell.classList.toggle("is-sidebar-edge-peek", nearLeftEdge);
    };

    window.addEventListener("mousemove", handlePointerMove);

    refs.appShell.addEventListener("mouseleave", () => {
      refs.appShell.classList.remove("is-sidebar-edge-peek");
    });
  }

  function bindSidebarToggleSync() {
    if (!refs.sidebarToggle) return;

    refs.sidebarToggle.addEventListener("click", () => {
      window.requestAnimationFrame(() => {
        syncSidebarDisplay();
      });
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== ADMIN_SIDEBAR_COLLAPSED_KEY) return;
      window.requestAnimationFrame(() => {
        syncSidebarDisplay();
      });
    });
  }

  function showNotFound() {
    fetch("/404/")
      .then((r) => r.text())
      .then((html) => {
        const parsed = new DOMParser().parseFromString(html, "text/html");

        document.documentElement.lang = parsed.documentElement.lang;
        document.head.innerHTML = parsed.head.innerHTML;
        document.body.className = parsed.body.className;
        document.body.innerHTML = parsed.body.innerHTML;

        for (const old of parsed.querySelectorAll("script")) {
          const s = document.createElement("script");
          if (old.type) s.type = old.type;
          if (old.src) {
            s.src = old.src;
          } else {
            s.textContent = old.textContent;
          }
          document.body.appendChild(s);
        }
      });
  }

  function showError(message) {
    hide(refs.loading);
    hide(refs.notFound);
    hide(refs.appShell);
    show(refs.error);
    const description = refs.error?.querySelector(".admin-state-card__description");
    if (description) {
      refs.error.dataset.dynamicMessage = message ? "1" : "";
      description.textContent = message || t("init_error", "Failed to initialize the admin console.");
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

  ensureAdminSidebarDefaultExpanded();

  const sidebar = initSidebar({
    root: refs.sidebar,
    toggleButton: refs.sidebarToggle,
    onNavigate: async () => {
      const ok = await dirtyGuard.confirmIfNeeded(t("discard_move", "You have unsaved changes. Discard them and continue?"));
      if (!ok) return false;
      dirtyGuard.allowNextLeave();
      return true;
    }
  });

  app.dirtyGuard = dirtyGuard;
  app.sidebar = sidebar;

  app.theme.init();

  bindSidebarEdgePeek();
  bindSidebarToggleSync();
  syncSidebarDisplay();

  initUserShell(app);
  initPublicProfileModal(app);

  refs.homeLink?.addEventListener("click", async (event) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const href = refs.homeLink.getAttribute("href") || "/";
    event.preventDefault();

    const ok = await dirtyGuard.confirmIfNeeded(t("discard_move", "You have unsaved changes. Discard them and continue?"));
    if (!ok) return;

    dirtyGuard.allowNextLeave();
    window.location.assign(href);
  });

  try {
    const sessionState = await app.session.load();
    await syncLanguagePreference(app, sessionState);

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
    const bootstrapTitle = page.title || refs.pageTitle?.textContent || t("page_title", "Admin");
    const pageTitle = pageT("page_title", bootstrapTitle);
    const pageDescription = pageT("page_description", document.body.dataset.adminDescription || "");

    document.title = `${pageTitle} - Felixxsv Gallery`;

    if (refs.pageTitle) refs.pageTitle.textContent = pageTitle;
    if (refs.headerUserName) refs.headerUserName.textContent = currentUser.display_name || "-";
    if (refs.headerUserKey) refs.headerUserKey.textContent = currentUser.user_key || "-";
    if (refs.pageDescription) {
      refs.pageDescription.textContent = pageDescription;
    }

    populateNavigation(data.navigation || []);
    syncSidebarDisplay(pageTitle);
    applyStaticTranslations();
    window.addEventListener("gallery:language-changed", () => {
      const nextPageTitle = pageT("page_title", page.title || refs.pageTitle?.textContent || t("page_title", "Admin"));
      document.title = `${nextPageTitle} - Felixxsv Gallery`;
      if (refs.pageTitle) refs.pageTitle.textContent = nextPageTitle;
      syncSidebarDisplay(nextPageTitle);
      applyStaticTranslations();
    });

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

    showError(error?.message || t("init_error", "Failed to initialize the admin console."));
  }
}

initAdminLayout();
