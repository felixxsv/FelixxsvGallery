import { qsa } from "./dom.js";

function getFocusableElements(layer) {
  return qsa(
    'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])',
    layer
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export function createModalManager({ root, closeButton, body = document.body } = {}) {
  const layers = new Map();
  const stack = [];
  const previousFocus = new Map();
  const mobileModalMedia = window.matchMedia("(max-width: 720px)");

  function ensureHeaderCloseButton(layer, id) {
    const header = layer.querySelector(".app-modal-header");
    if (!header || header.querySelector("[data-modal-header-close]")) return;
    let actions = header.querySelector(".app-modal-header-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "app-modal-header-actions";
      header.appendChild(actions);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "app-modal-header-close";
    button.dataset.modalClose = id;
    button.dataset.modalHeaderClose = "true";
    button.setAttribute("aria-label", "Close");
    button.setAttribute("data-i18n-aria-label", "shell.static.close");
    button.textContent = "×";
    actions.appendChild(button);
  }

  function refreshLayerOrder() {
    stack.forEach((id, index) => {
      const layer = layers.get(id);
      if (!layer) return;
      layer.style.zIndex = String(4000 + index * 10);
    });

    closeButton.hidden = stack.length === 0;
    body.classList.toggle("is-modal-open", stack.length > 0);
  }

  function dispatch(name, detail) {
    root.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function registerLayers() {
    qsa("[data-modal-layer]", root).forEach((layer) => {
      const id = layer.dataset.modalId;
      if (!id) return;
      layers.set(id, layer);
      ensureHeaderCloseButton(layer, id);
      layer.hidden = layer.hidden ?? true;
      layer.setAttribute("aria-hidden", layer.hidden ? "true" : "false");
    });
  }

  function focusLayer(id) {
    const layer = layers.get(id);
    if (!layer) return;
    const [firstFocusable] = getFocusableElements(layer);
    if (firstFocusable) {
      firstFocusable.focus();
      return;
    }

    const dialog = layer.querySelector("[role='dialog']");
    if (dialog) {
      dialog.focus();
    }
  }

  function top() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  function isOpen(id) {
    return stack.includes(id);
  }

  function open(id) {
    const layer = layers.get(id);
    if (!layer) return;

    const existingIndex = stack.indexOf(id);
    if (existingIndex >= 0) {
      stack.splice(existingIndex, 1);
    }

    previousFocus.set(id, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    stack.push(id);
    layer.hidden = false;
    layer.setAttribute("aria-hidden", "false");
    refreshLayerOrder();
    focusLayer(id);
    dispatch("app:modal-open", { id, stack: [...stack] });
  }

  function close(id) {
    const layer = layers.get(id);
    if (!layer) return;

    const index = stack.lastIndexOf(id);
    if (index < 0) return;

    stack.splice(index, 1);
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");

    const restoreTarget = previousFocus.get(id);
    previousFocus.delete(id);

    refreshLayerOrder();

    const nextTop = top();
    if (nextTop) {
      focusLayer(nextTop);
    } else if (restoreTarget && typeof restoreTarget.focus === "function") {
      restoreTarget.focus();
    }

    dispatch("app:modal-close", { id, stack: [...stack] });
  }

  function closeTop() {
    const id = top();
    if (!id) return;
    close(id);
  }

  function bindEvents() {
    root.addEventListener("click", (event) => {
      const openTrigger = event.target.closest("[data-modal-open]");
      if (openTrigger) {
        const id = openTrigger.dataset.modalOpen;
        if (id) {
          open(id);
        }
        return;
      }

      const closeTrigger = event.target.closest("[data-modal-close]");
      if (closeTrigger) {
        const id = closeTrigger.dataset.modalClose;
        if (id) {
          close(id);
        }
        return;
      }

      const backdrop = event.target.closest("[data-modal-backdrop]");
      if (backdrop) {
        const id = backdrop.dataset.modalBackdrop;
        if (mobileModalMedia.matches) {
          return;
        }
        if (id && top() === id) {
          closeTop();
        }
      }
    });

    closeButton.addEventListener("click", () => {
      closeTop();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (stack.length === 0) return;
      closeTop();
    });
  }

  registerLayers();
  bindEvents();
  refreshLayerOrder();

  return {
    open,
    close,
    closeTop,
    top,
    isOpen,
    refresh() {
      registerLayers();
      refreshLayerOrder();
    },
    getStack() {
      return [...stack];
    },
  };
}
