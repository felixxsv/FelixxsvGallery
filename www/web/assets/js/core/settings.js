const KEY_LANGUAGE = "felixxsv.gallery.language";
const KEY_THEME = "felixxsv.gallery.theme";

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

  return {
    getLanguage,
    setLanguage,
    getTheme,
    setTheme
  };
}