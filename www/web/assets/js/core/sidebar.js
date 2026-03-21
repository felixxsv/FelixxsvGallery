import { qsa } from "./dom.js";

const DEFAULT_STORAGE_KEY = "gallery.admin.sidebar.collapsed";

export function initSidebar({ root, toggleButton, storageKey = DEFAULT_STORAGE_KEY, onNavigate } = {}) {
  if (!root || !toggleButton) {
    return {
      isCollapsed() {
        return false;
      },
      setCollapsed() {},
      toggle() {}
    };
  }

  function readStoredState() {
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  }

  function writeStoredState(collapsed) {
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      return;
    }
  }

  function applyState(collapsed) {
    root.classList.toggle("is-collapsed", collapsed);
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.setAttribute("aria-label", collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ");
    writeStoredState(collapsed);
  }

  function isCollapsed() {
    return root.classList.contains("is-collapsed");
  }

  function setCollapsed(collapsed) {
    applyState(Boolean(collapsed));
  }

  function toggle() {
    applyState(!isCollapsed());
  }

  toggleButton.addEventListener("click", () => {
    toggle();
  });

  qsa("[data-admin-nav-link]", root).forEach((link) => {
    link.addEventListener("click", async (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const href = link.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      if (typeof onNavigate === "function") {
        event.preventDefault();
        const shouldMove = await onNavigate(href, link);
        if (shouldMove) {
          window.location.assign(href);
        }
      }
    });
  });

  applyState(readStoredState());

  return {
    isCollapsed,
    setCollapsed,
    toggle
  };
}
