import { createSettingsStore, languageToLocaleTag } from "../core/settings.js";
import { createThemeController } from "../core/theme.js";
import { buildLocaleLoadOrder, createI18n } from "../core/i18n.js";

async function initNotFoundPage() {
  const settings = createSettingsStore();
  const theme = createThemeController(settings);
  theme.init();

  const i18n = createI18n(settings);

  async function loadAndApply() {
    try {
      await i18n.loadCatalogs("/assets/i18n", buildLocaleLoadOrder(settings.getLanguage()));
    } catch {
      // keep inline defaults
    }
    document.documentElement.lang = languageToLocaleTag(settings.getLanguage());
    i18n.apply();
    document.title = `${i18n.t("special.not_found.title", "Page not found")} - Felixxsv Gallery`;
  }

  await loadAndApply();

  // Language selector
  const langSelect = document.getElementById("authLangSelect");
  if (langSelect) {
    langSelect.value = settings.getLanguage();
    langSelect.addEventListener("change", async () => {
      settings.setLanguage(langSelect.value);
      await loadAndApply();
    });
  }

  // Back button
  document.getElementById("notFoundBackBtn")?.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign("/");
    }
  });

  // Slideshow
  if (typeof window.initAuthHeroSlideshow === "function") {
    window.initAuthHeroSlideshow();
  }
}

initNotFoundPage();
