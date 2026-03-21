const KEY_LANGUAGE = "felixxsv.gallery.language";
const KEY_THEME = "felixxsv.gallery.theme";
const KEY_IMAGE_OPEN_BEHAVIOR = "felixxsv.gallery.image.openBehavior";
const KEY_IMAGE_BACKDROP_CLOSE = "felixxsv.gallery.image.backdropClose";
const KEY_IMAGE_META_PINNED = "felixxsv.gallery.image.metaPinned";

function getBoolean(storage, key, fallback) {
  const value = storage.getItem(key);
  if (value === null) return fallback;
  return value === "true";
}

function setBoolean(storage, key, value) {
  storage.setItem(key, value ? "true" : "false");
  return Boolean(value);
}

export function createSettingsStore(storage = window.localStorage) {
  function getLanguage() {
    return storage.getItem(KEY_LANGUAGE) || "ja";
  }

  function setLanguage(value) {
    storage.setItem(KEY_LANGUAGE, value);
    return value;
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