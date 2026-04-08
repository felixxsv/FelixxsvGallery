import { createSettingsStore, languageToLocaleTag } from "../core/settings.js";
import { createThemeController } from "../core/theme.js";
import { buildLocaleLoadOrder, createI18n } from "../core/i18n.js";

function text(value, fallback = "") {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || fallback;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function setHidden(id, hidden) {
  const node = document.getElementById(id);
  if (node) {
    node.hidden = hidden;
  }
}

function setSelectorText(selector, value) {
  const node = document.querySelector(selector);
  if (node) {
    node.textContent = value;
  }
}

function setSelectorAttr(selector, attr, value) {
  const node = document.querySelector(selector);
  if (node) {
    node.setAttribute(attr, value);
  }
}

function getPageConfig(i18n, kind) {
  const t = (key, fallback, vars = {}) => i18n.t(key, fallback, vars);
  const common = {
    backHome: t("special.common.back_home", "Back to Gallery"),
    backPrevious: t("special.common.back_previous", "Back"),
    login: t("special.common.login", "Open Login"),
    reload: t("special.common.reload", "Reload"),
    requestId: t("special.common.request_id", "Request ID"),
  };
  const configs = {
    "not-found": {
      eyebrow: t("special.not_found.eyebrow", "Not Found"),
      status: "404",
      title: t("special.not_found.title", "Page not found"),
      description: t("special.not_found.description", "The URL may have changed or the page may no longer be public. Please return to the gallery top and search again."),
      meta: t("special.not_found.meta", "This is the not-found page for public routes under /gallery."),
      primaryAction: common.backHome,
      secondaryAction: common.backPrevious,
      asideLabel: t("special.not_found.aside_label", "Guidance"),
      asideTitle: t("special.not_found.aside_title", "What to check"),
      asideCopy: t("special.not_found.aside_copy", "Checking the following items in order makes it easier to distinguish broken links from visibility restrictions."),
      list: [
        {
          label: t("special.not_found.list_link_label", "Link"),
          value: t("special.not_found.list_link_value", "Confirm the trailing URL and the path under /gallery/ are correct."),
        },
        {
          label: t("special.not_found.list_visibility_label", "Visibility"),
          value: t("special.not_found.list_visibility_value", "Confirm the image or profile is not private or quarantined."),
        },
        {
          label: t("special.not_found.list_retry_label", "Retry"),
          value: t("special.not_found.list_retry_value", "Search again from the top page using search, tags, or archive."),
        },
      ],
      footerNote: t("special.not_found.footer_note", "Use this together with Apache or reverse-proxy 404 routing."),
    },
    maintenance: {
      eyebrow: t("special.maintenance.eyebrow", "Under Construction"),
      status: "WIP",
      title: t("special.maintenance.title", "This page is under construction"),
      description: t("special.maintenance.description", "This route is temporarily closed while it is being prepared. The main gallery and existing public pages remain available."),
      meta: t("special.maintenance.meta", "Guidance page for unreleased features and in-progress screens."),
      primaryAction: common.backHome,
      secondaryAction: common.backPrevious,
      asideLabel: t("special.maintenance.aside_label", "Maintenance details"),
      asideTitle: t("special.maintenance.aside_title", "Intended use"),
      asideCopy: t("special.maintenance.aside_copy", "Intended for temporarily guiding users around unpublished admin routes, adjusting frontend features, and screens during migration."),
      list: [
        {
          label: t("special.maintenance.list_unreleased_label", "Pre-release feature"),
          value: t("special.maintenance.list_unreleased_value", "The feature is still in development, but the URL already exists."),
        },
        {
          label: t("special.maintenance.list_migration_label", "During migration"),
          value: t("special.maintenance.list_migration_value", "A temporary stop notice while switching from the old route to the new one."),
        },
        {
          label: t("special.maintenance.list_tone_label", "Visual tone"),
          value: t("special.maintenance.list_tone_value", "Show guidance without breaking the gallery's color and typography."),
        },
      ],
      footerNote: "",
    },
    sorry: {
      eyebrow: t("special.sorry.eyebrow", "Sorry"),
      status: "INFO",
      title: t("special.sorry.title", "This route is currently unavailable"),
      description: t("special.sorry.description", "This page is intentionally paused for cases such as access restrictions, invitation-only access, or pre-maintenance guidance. Please check permissions and visibility."),
      meta: t("special.sorry.meta", "Use this when you want to intentionally return guidance separate from 404 or maintenance."),
      primaryAction: common.backHome,
      secondaryAction: common.login,
      asideLabel: t("special.sorry.aside_label", "Unavailable route details"),
      asideTitle: t("special.sorry.aside_title", "Role separation"),
      asideCopy: t("special.sorry.aside_copy", "This page explicitly explains a route that exists but is currently blocked for a reason, rather than a missing page."),
      list: [
        {
          label: t("special.sorry.list_404_label", "Difference from 404"),
          value: t("special.sorry.list_404_value", "The URL itself is expected, but the route is unavailable right now."),
        },
        {
          label: t("special.sorry.list_maintenance_label", "Difference from maintenance"),
          value: t("special.sorry.list_maintenance_value", "It can be used not only during active work, but also for restrictions or guidance."),
        },
        {
          label: t("special.sorry.list_route_label", "Route handling"),
          value: t("special.sorry.list_route_value", "Guide the user back naturally to the top page or auth page."),
        },
      ],
      footerNote: "",
    },
    error: {
      eyebrow: t("special.error.eyebrow", "System Error"),
      status: "500",
      title: t("special.error_title", "An error occurred"),
      description: t("special.error_message", "A problem occurred while processing your request. Please try again later."),
      meta: "",
      primaryAction: common.reload,
      secondaryAction: common.backHome,
      asideLabel: t("special.error.aside_label", "Error guidance"),
      asideTitle: t("special.error.aside_title", "When to use this"),
      asideCopy: t("special.error.aside_copy", "Use this page when you want to separate dedicated failure screens from lightweight errors that can stay in a toast."),
      list: [
        {
          label: t("special.error.list_minor_label", "Minor failure"),
          value: t("special.error.list_minor_value", "Retrying lists or fixing input issues can stay in existing toasts or modals."),
        },
        {
          label: t("special.error.list_dedicated_label", "Dedicated page"),
          value: t("special.error.list_dedicated_value", "Use this for initialization failures, access mismatches, or maintenance routing."),
        },
        {
          label: t("special.error.list_dynamic_label", "Dynamic display"),
          value: t("special.error.list_dynamic_value", "Customize details with ?code=, ?title=, ?message=, and ?request_id=."),
        },
      ],
      footerNote: t("special.error.footer_note", "Example: /gallery/error/?code=503&title=Temporarily Paused&request_id=abc123"),
    },
  };
  return { common, ...(configs[kind] || configs["not-found"]) };
}

function applyPageContent(config) {
  setSelectorText(".special-page__eyebrow", config.eyebrow);
  setText("specialStatusCode", config.status);
  setText("specialTitle", config.title);
  setText("specialDescription", config.description);
  setText("specialMeta", config.meta);
  setHidden("specialMeta", !config.meta);

  const actionButtons = document.querySelectorAll(".special-page__actions .app-button");
  if (actionButtons[0]) actionButtons[0].textContent = config.primaryAction;
  if (actionButtons[1]) actionButtons[1].textContent = config.secondaryAction;

  setSelectorAttr(".special-page__aside", "aria-label", config.asideLabel);
  setSelectorText(".special-page__aside-title", config.asideTitle);
  setSelectorText(".special-page__aside-copy", config.asideCopy);

  const labels = document.querySelectorAll(".special-page__list-label");
  const values = document.querySelectorAll(".special-page__list-value");
  config.list.forEach((item, index) => {
    if (labels[index]) labels[index].textContent = item.label;
    if (values[index]) values[index].textContent = item.value;
  });

  setSelectorText(".special-page__footer-note", config.footerNote);
  const footerNote = document.querySelector(".special-page__footer-note");
  if (footerNote) {
    footerNote.hidden = !config.footerNote;
  }
}

function initTheme() {
  const settings = createSettingsStore();
  const theme = createThemeController(settings);
  theme.init();
  return settings;
}

function initActions() {
  for (const button of document.querySelectorAll("[data-special-action]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.specialAction;
      if (action === "reload") {
        window.location.reload();
        return;
      }
      if (action === "back") {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.assign("/gallery/");
        }
      }
    });
  }
}

async function initSpecialPages() {
  const settings = initTheme();
  const i18n = createI18n(settings);

  try {
    await i18n.loadCatalogs("/gallery/assets/i18n", buildLocaleLoadOrder(settings.getLanguage()));
  } catch {
    // Keep in-module dictionaries as fallback when shared catalogs are unavailable.
  }

  document.documentElement.lang = languageToLocaleTag(settings.getLanguage());
  const kind = document.body.dataset.pageKind || "not-found";
  const config = getPageConfig(i18n, kind);

  initActions();
  applyPageContent(config);

  if (kind === "error") {
    const params = new URLSearchParams(window.location.search);
    const code = text(params.get("code"), text(params.get("status"), config.status));
    const title = text(
      params.get("title"),
      config.title
    );
    const message = text(
      params.get("message"),
      config.description
    );
    const requestId = text(params.get("request_id"));
    const detail = text(params.get("detail"));

    document.title = `${title} - Felixxsv Gallery`;
    setText("specialStatusCode", code);
    setText("specialTitle", title);
    setText("specialDescription", message);

    const metaParts = [];
    if (requestId) metaParts.push(`${config.common.requestId}: ${requestId}`);
    if (detail) metaParts.push(detail);
    setText("specialMeta", metaParts.join(" / "));
    setHidden("specialMeta", metaParts.length === 0);
    return;
  }

  document.title = `${config.title} - Felixxsv Gallery`;
}

initSpecialPages();
