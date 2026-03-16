export function createI18n(settingsStore) {
  function getLanguage() {
    return settingsStore.getLanguage();
  }

  function setLanguage(value) {
    return settingsStore.setLanguage(value);
  }

  function t(_key, fallback = "") {
    return fallback;
  }

  return {
    getLanguage,
    setLanguage,
    t
  };
}