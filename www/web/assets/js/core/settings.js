const KEY_LANGUAGE = "felixxsv.gallery.language";
const KEY_THEME = "felixxsv.gallery.theme";
const KEY_IMAGE_OPEN_BEHAVIOR = "felixxsv.gallery.image.openBehavior";
const KEY_IMAGE_BACKDROP_CLOSE = "felixxsv.gallery.image.backdropClose";
const KEY_IMAGE_META_PINNED = "felixxsv.gallery.image.metaPinned";
export const DEFAULT_LANGUAGE = "en-us";
export const SUPPORTED_LANGUAGE_VALUES = ["ja", "en-us", "de", "fr", "ru", "es", "zh-cn", "ko"];
const LANGUAGE_LOCALE_TAGS = {
  ja: "ja-JP",
  "en-us": "en-US",
  de: "de-DE",
  fr: "fr-FR",
  ru: "ru-RU",
  es: "es-ES",
  "zh-cn": "zh-CN",
  ko: "ko-KR",
};

const LANGUAGE_ALIASES = {
  ja: "ja",
  "ja-jp": "ja",
  en: "en-us",
  "en-us": "en-us",
  "en-gb": "en-us",
  de: "de",
  "de-de": "de",
  fr: "fr",
  "fr-fr": "fr",
  ru: "ru",
  "ru-ru": "ru",
  es: "es",
  "es-es": "es",
  "es-419": "es",
  zh: "zh-cn",
  "zh-cn": "zh-cn",
  "zh-hans": "zh-cn",
  "zh-sg": "zh-cn",
  ko: "ko",
  "ko-kr": "ko",
};

function getBoolean(storage, key, fallback) {
  const value = storage.getItem(key);
  if (value === null) return fallback;
  return value === "true";
}

function setBoolean(storage, key, value) {
  storage.setItem(key, value ? "true" : "false");
  return Boolean(value);
}

export function normalizeLanguageCode(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return DEFAULT_LANGUAGE;
  if (SUPPORTED_LANGUAGE_VALUES.includes(raw)) return raw;
  if (LANGUAGE_ALIASES[raw]) return LANGUAGE_ALIASES[raw];
  const prefix = raw.split("-")[0];
  return LANGUAGE_ALIASES[prefix] || DEFAULT_LANGUAGE;
}

export function languageToLocaleTag(value) {
  const normalized = normalizeLanguageCode(value);
  return LANGUAGE_LOCALE_TAGS[normalized] || LANGUAGE_LOCALE_TAGS[DEFAULT_LANGUAGE];
}

function detectBrowserLanguage() {
  try {
    const languages = Array.isArray(window?.navigator?.languages) ? window.navigator.languages : [];
    const candidates = [...languages, window?.navigator?.language].filter(Boolean);
    for (const candidate of candidates) {
      const normalized = normalizeLanguageCode(candidate);
      if (normalized) return normalized;
    }
  } catch {
    return DEFAULT_LANGUAGE;
  }
  return DEFAULT_LANGUAGE;
}

export function createSettingsStore(storage = window.localStorage) {
  function getLanguage() {
    const stored = storage.getItem(KEY_LANGUAGE);
    if (stored !== null) {
      return normalizeLanguageCode(stored);
    }
    return DEFAULT_LANGUAGE;
  }

  function setLanguage(value) {
    const normalized = normalizeLanguageCode(value);
    storage.setItem(KEY_LANGUAGE, normalized);
    return normalized;
  }

  function getTheme() {
    return storage.getItem(KEY_THEME) || "system";
  }

  function setTheme(value) {
    storage.setItem(KEY_THEME, value);
    return value;
  }

  function getImageOpenBehavior() {
    const value = storage.getItem(KEY_IMAGE_OPEN_BEHAVIOR) || "modal";
    return value === "new_tab" ? "new_tab" : "modal";
  }

  function setImageOpenBehavior(value) {
    const normalized = value === "new_tab" ? "new_tab" : "modal";
    storage.setItem(KEY_IMAGE_OPEN_BEHAVIOR, normalized);
    return normalized;
  }

  function getImageBackdropClose() {
    return getBoolean(storage, KEY_IMAGE_BACKDROP_CLOSE, true);
  }

  function setImageBackdropClose(value) {
    return setBoolean(storage, KEY_IMAGE_BACKDROP_CLOSE, value);
  }

  function getImageMetaPinned() {
    return getBoolean(storage, KEY_IMAGE_META_PINNED, false);
  }

  function setImageMetaPinned(value) {
    return setBoolean(storage, KEY_IMAGE_META_PINNED, value);
  }

  return {
    getLanguage,
    setLanguage,
    getTheme,
    setTheme,
    getImageOpenBehavior,
    setImageOpenBehavior,
    getImageBackdropClose,
    setImageBackdropClose,
    getImageMetaPinned,
    setImageMetaPinned,
  };
}
