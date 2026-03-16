export function createThemeController(settingsStore, target = document.documentElement) {
  function apply(theme) {
    const value = theme || settingsStore.getTheme() || "system";

    if (value === "system") {
      delete target.dataset.theme;
      return;
    }

    target.dataset.theme = value;
  }

  function init() {
    apply(settingsStore.getTheme());
  }

  return {
    init,
    apply
  };
}