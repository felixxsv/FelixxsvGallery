export function byId(id, scope = document) {
  if (typeof scope.getElementById === "function") {
    return scope.getElementById(id);
  }
  return document.getElementById(id);
}

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function on(target, eventName, handler, options) {
  target.addEventListener(eventName, handler, options);
  return () => target.removeEventListener(eventName, handler, options);
}

export function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.className) {
    element.className = options.className;
  }

  if (options.text !== undefined) {
    element.textContent = String(options.text);
  }

  if (options.html !== undefined) {
    element.innerHTML = String(options.html);
  }

  if (options.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      if (value === false || value === null || value === undefined) {
        continue;
      }
      if (value === true) {
        element.setAttribute(key, "");
        continue;
      }
      element.setAttribute(key, String(value));
    }
  }

  if (Array.isArray(options.children)) {
    for (const child of options.children) {
      if (child instanceof Node) {
        element.appendChild(child);
      }
    }
  }

  return element;
}

export function mountHTML(target, html) {
  target.innerHTML = html;
  return target;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}