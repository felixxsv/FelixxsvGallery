import { createElement } from "./dom.js";

export function createToastManager({ root } = {}) {
  function show({ type = "info", message = "", duration = 3200 } = {}) {
    if (!message) return;

    const toast = createElement("div", {
      className: `app-toast app-toast--${type}`,
      text: message
    });

    toast.style.setProperty("--toast-out-delay", `${Math.max(0, duration - 180)}ms`);
    root.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, duration + 220);
  }

  return {
    show,
    success(message, duration) {
      show({ type: "success", message, duration });
    },
    error(message, duration) {
      show({ type: "error", message, duration });
    },
    warning(message, duration) {
      show({ type: "warning", message, duration });
    },
    info(message, duration) {
      show({ type: "info", message, duration });
    }
  };
}