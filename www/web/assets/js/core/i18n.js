export function createI18n(settingsStore) {
  const dictionaries = new Map();

  function getLanguage() {
    return settingsStore.getLanguage();
  }

  function setLanguage(value) {
    return settingsStore.setLanguage(value);
  }

  function define(locale, messages = {}) {
    const lang = String(locale || "").trim().toLowerCase();
    if (!lang) return;
    const current = dictionaries.get(lang) || {};
    dictionaries.set(lang, { ...current, ...messages });
  }

  function t(key, fallback = "", vars = {}) {
    const lang = String(getLanguage() || "ja").trim().toLowerCase();
    const dict = dictionaries.get(lang) || {};
    const en = dictionaries.get("en-us") || {};
    const ja = dictionaries.get("ja") || {};
    const template = dict[key] || en[key] || ja[key] || fallback;
    return String(template || "").replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? ""));
  }

  async function loadCatalog(locale, url) {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`failed to load locale catalog: ${locale}`);
    }
    const messages = await response.json();
    define(locale, messages && typeof messages === "object" ? messages : {});
    return messages;
  }

  async function loadCatalogs(basePath, locales = ["ja", "en-us"]) {
    const normalizedBasePath = String(basePath || "").replace(/\/+$/, "");
    const entries = await Promise.all(locales.map(async (locale) => {
      const messages = await loadCatalog(locale, `${normalizedBasePath}/${locale}.json`);
      return [locale, messages];
    }));
    return Object.fromEntries(entries);
  }

  function apply(root = document) {
    root.querySelectorAll?.("[data-i18n]").forEach((node) => {
      const key = node.dataset.i18n;
      if (!key) return;
      node.textContent = t(key, node.textContent || "");
    });
    root.querySelectorAll?.("[data-i18n-html]").forEach((node) => {
      const key = node.dataset.i18nHtml;
      if (!key) return;
      node.innerHTML = t(key, node.innerHTML || "");
    });
    root.querySelectorAll?.("[data-i18n-placeholder]").forEach((node) => {
      const key = node.dataset.i18nPlaceholder;
      if (!key) return;
      node.setAttribute("placeholder", t(key, node.getAttribute("placeholder") || ""));
    });
    root.querySelectorAll?.("[data-i18n-aria-label]").forEach((node) => {
      const key = node.dataset.i18nAriaLabel;
      if (!key) return;
      node.setAttribute("aria-label", t(key, node.getAttribute("aria-label") || ""));
    });
    root.querySelectorAll?.("[data-i18n-title]").forEach((node) => {
      const key = node.dataset.i18nTitle;
      if (!key) return;
      node.setAttribute("title", t(key, node.getAttribute("title") || ""));
    });
    root.querySelectorAll?.("input[type=\"date\"], input[type=\"datetime-local\"], input[type=\"time\"]").forEach((node) => {
      node.setAttribute("lang", getLanguage());
    });
  }

  return {
    getLanguage,
    setLanguage,
    define,
    t,
    loadCatalog,
    loadCatalogs,
    apply,
  };
}

export function buildLocaleLoadOrder(language) {
  const normalized = String(language || "").trim().toLowerCase();
  const locales = ["ja", "en-us"];
  if (normalized && !locales.includes(normalized)) {
    locales.push(normalized);
  }
  return locales;
}

export async function fetchLocaleCatalogs(basePath, locales = ["ja", "en-us"]) {
  const normalizedBasePath = String(basePath || "").replace(/\/+$/, "");
  const entries = await Promise.all(locales.map(async (locale) => {
    const response = await fetch(`${normalizedBasePath}/${locale}.json`, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`failed to load locale catalog: ${locale}`);
    }
    const messages = await response.json();
    return [locale, messages && typeof messages === "object" ? messages : {}];
  }));
  return Object.fromEntries(entries);
}
