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
    const ja = dictionaries.get("ja") || {};
    const template = dict[key] || ja[key] || fallback;
    return String(template || "").replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? ""));
  }

  function apply(root = document) {
    root.querySelectorAll?.("[data-i18n]").forEach((node) => {
      const key = node.dataset.i18n;
      if (!key) return;
      node.textContent = t(key, node.textContent || "");
    });
    root.querySelectorAll?.("[data-i18n-placeholder]").forEach((node) => {
      const key = node.dataset.i18nPlaceholder;
      if (!key) return;
      node.setAttribute("placeholder", t(key, node.getAttribute("placeholder") || ""));
    });
  }

  return {
    getLanguage,
    setLanguage,
    define,
    t,
    apply,
  };
}
