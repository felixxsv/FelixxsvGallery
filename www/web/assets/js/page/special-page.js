import { createSettingsStore } from "../core/settings.js";
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

function initErrorPage() {
  if (document.body.dataset.pageKind !== "error") {
    return;
  }

  const settings = createSettingsStore();
  const i18n = createSpecialI18n(settings);

  const params = new URLSearchParams(window.location.search);
  const code = text(params.get("code"), text(params.get("status"), "Error"));
  const title = text(
    params.get("title"),
    document.body.dataset.pageTitle || i18n.t("special.error_title", "An error occurred")
  );
  const message = text(
    params.get("message"),
    document.body.dataset.pageDescription || i18n.t("special.error_message", "A problem occurred while processing your request. Please try again later.")
  );
  const requestId = text(params.get("request_id"));
  const detail = text(params.get("detail"));

  document.title = `${title} - Felixxsv Gallery`;
  setText("specialStatusCode", code);
  setText("specialTitle", title);
  setText("specialDescription", message);

  const metaParts = [];
  if (requestId) metaParts.push(`Request ID: ${requestId}`);
  if (detail) metaParts.push(detail);
  setText("specialMeta", metaParts.join(" / "));
  setHidden("specialMeta", metaParts.length === 0);
}

function initPageTitle() {
  if (document.body.dataset.pageKind === "error") {
    return;
  }

  const title = text(document.body.dataset.pageTitle);
  if (title) {
    document.title = `${title} - Felixxsv Gallery`;
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

  document.documentElement.lang = settings.getLanguage();
  initActions();
  initPageTitle();
  if (document.body.dataset.pageKind === "error") {
    const params = new URLSearchParams(window.location.search);
    const code = text(params.get("code"), text(params.get("status"), "Error"));
    const title = text(
      params.get("title"),
      document.body.dataset.pageTitle || i18n.t("special.error_title", "An error occurred")
    );
    const message = text(
      params.get("message"),
      document.body.dataset.pageDescription || i18n.t("special.error_message", "A problem occurred while processing your request. Please try again later.")
    );
    const requestId = text(params.get("request_id"));
    const detail = text(params.get("detail"));

    document.title = `${title} - Felixxsv Gallery`;
    setText("specialStatusCode", code);
    setText("specialTitle", title);
    setText("specialDescription", message);

    const metaParts = [];
    if (requestId) metaParts.push(`Request ID: ${requestId}`);
    if (detail) metaParts.push(detail);
    setText("specialMeta", metaParts.join(" / "));
    setHidden("specialMeta", metaParts.length === 0);
    return;
  }
  initErrorPage();
}

initSpecialPages();
