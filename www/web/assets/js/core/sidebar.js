import { qsa } from "./dom.js";
import { ensureCustomScrollbars } from "./custom-scrollbar.js";

const DEFAULT_STORAGE_KEY = "gallery.admin.sidebar.collapsed";
const ADMIN_SIDEBAR_ANIMATION_MS = 180;
const ADMIN_SIDEBAR_REVEAL_DELAY_MS = ADMIN_SIDEBAR_ANIMATION_MS + 20;
const ADMIN_SIDEBAR_EDGE_PEEK_PX = 44;

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

  const shell = root.closest(".admin-shell");
  ensureCustomScrollbars({ includeWindow: true, selectors: [".admin-sidebar__scroll", ".admin-main-scroll"] });
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let revealTimerId = null;

  function clearRevealTimer() {
    if (revealTimerId !== null) {
      window.clearTimeout(revealTimerId);
      revealTimerId = null;
    }
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

  function updateToggleUi(collapsed) {
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    const t = window.AdminApp?.i18n?.t?.bind(window.AdminApp.i18n);
    toggleButton.setAttribute(
      "aria-label",
      collapsed
        ? (t?.("admin_layout.sidebar_expand", "Expand sidebar") || "Expand sidebar")
        : (t?.("admin_layout.sidebar_collapse", "Collapse sidebar") || "Collapse sidebar")
    );

    const icon = toggleButton.querySelector("span");
    if (icon) {
      icon.textContent = collapsed ? "❯" : "×";
    }
  }

  function finishExpandedContent() {
    root.classList.remove("is-content-hidden");
  }

  function applyState(collapsed, { animate = false } = {}) {
    clearRevealTimer();

    root.classList.toggle("is-collapsed", collapsed);
    root.classList.toggle("is-content-hidden", collapsed);
    shell?.classList.toggle("is-sidebar-collapsed", collapsed);

    if (!collapsed) {
      shell?.classList.remove("is-sidebar-edge-peek");
    }

    updateToggleUi(collapsed);

    if (collapsed) {
      writeStoredState(true);
      return;
    }

    const shouldAnimate = animate && !prefersReducedMotion.matches;

    if (!shouldAnimate) {
      finishExpandedContent();
      writeStoredState(false);
      return;
    }

    root.classList.add("is-content-hidden");

    revealTimerId = window.setTimeout(() => {
      revealTimerId = null;
      if (root.classList.contains("is-collapsed")) {
        return;
      }
      finishExpandedContent();
    }, ADMIN_SIDEBAR_REVEAL_DELAY_MS);

    writeStoredState(false);
  }

  function isCollapsed() {
    return root.classList.contains("is-collapsed");
  }

  function setCollapsed(collapsed, options = {}) {
    applyState(Boolean(collapsed), options);
  }

  function toggle() {
    applyState(!isCollapsed(), { animate: true });
  }

  function syncEdgePeek(clientX) {
    if (!shell) {
      return;
    }

    if (!isCollapsed()) {
      shell.classList.remove("is-sidebar-edge-peek");
      return;
    }

    const nearEdge = Number(clientX || 0) <= ADMIN_SIDEBAR_EDGE_PEEK_PX;
    shell.classList.toggle("is-sidebar-edge-peek", nearEdge);
  }

  toggleButton.addEventListener("click", () => {
    toggle();
  });

  window.addEventListener("mousemove", (event) => {
    syncEdgePeek(event.clientX);
  });

  shell?.addEventListener("mouseleave", () => {
    shell.classList.remove("is-sidebar-edge-peek");
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

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) {
      return;
    }
    applyState(readStoredState());
  });

  applyState(readStoredState());

  return {
    isCollapsed,
    setCollapsed,
    toggle
  };
}
