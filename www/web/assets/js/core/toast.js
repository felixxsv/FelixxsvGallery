import { createElement } from "./dom.js";

export function createToastManager({ root } = {}) {
  function show({ type = "info", message = "", duration = 3200, action = null } = {}) {
    if (!message) return null;

    const hasAction = action && typeof action.onClick === "function" && action.label;

    let toast;
    if (hasAction) {
      toast = document.createElement("div");
      toast.className = `app-toast app-toast--${type} app-toast--has-action`;
      const msgSpan = document.createElement("span");
      msgSpan.className = "app-toast__message";
      msgSpan.textContent = message;
      toast.appendChild(msgSpan);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "app-toast__action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        toast.remove();
        action.onClick();
      });
      toast.appendChild(btn);
    } else {
      toast = createElement("div", {
        className: `app-toast app-toast--${type}`,
        text: message,
      });
    }

    toast.style.setProperty("--toast-out-delay", `${Math.max(0, duration - 180)}ms`);
    root.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, duration + 220);

    return toast;
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