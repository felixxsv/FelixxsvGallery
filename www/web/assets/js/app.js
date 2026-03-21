import { byId } from "./core/dom.js";
import { createApiClient } from "./core/api.js";
import { createModalManager } from "./core/modal.js";
import { createToastManager } from "./core/toast.js";
import { createSettingsStore } from "./core/settings.js";
import { createThemeController } from "./core/theme.js";
import { createSessionStore } from "./core/session.js";
import { createI18n } from "./core/i18n.js";
import { createImageModalController } from "./core/image-modal.js";
import { initUserShell } from "./components/user-shell.js";
import { initHomePage } from "./pages/home.js";

function createAppContext() {
  const appBase = document.body.dataset.appBase || "/gallery";
  const api = createApiClient({ baseUrl: appBase });
  const settings = createSettingsStore();
  const theme = createThemeController(settings);
  const session = createSessionStore(api);
  const i18n = createI18n(settings);
  const modalRoot = byId("appModalRoot");
  const modalClose = byId("appGlobalClose");
  const toastRoot = byId("appToastRoot");
  const modal = createModalManager({ root: modalRoot, closeButton: modalClose });
  const toast = createToastManager({ root: toastRoot });
  const imageModal = createImageModalController({ app: { api, appBase, settings, session, i18n, modal, toast } });
  return { api, appBase, settings, theme, session, i18n, modal, toast, imageModal, page: document.body.dataset.page || "" };
}

async function bootstrap() {
  const app = createAppContext();
  window.App = app;
  app.theme.init();
  initUserShell(app);

  try {
    await app.session.load();
  } catch (error) {
    app.toast.error(error.message || "セッション情報の取得に失敗しました。");
  }

  if (app.page === "home") {
    initHomePage(app);
  }
}

bootstrap();