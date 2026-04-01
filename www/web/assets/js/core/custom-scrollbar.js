const GLOBAL_MANAGER_KEY = "__galleryCustomScrollbarManager__";
const DEFAULT_MIN_THUMB_SIZE = 36;
const DEFAULT_TRACK_PADDING = 8;
const DEFAULT_TRACK_WIDTH = 6;
const DEFAULT_EDGE_OFFSET = 4;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getWindowScroller() {
  return document.scrollingElement || document.documentElement;
}

function createScrollbarElement() {
  const track = document.createElement("div");
  track.className = "app-custom-scrollbar is-hidden";
  track.setAttribute("aria-hidden", "true");

  const thumb = document.createElement("div");
  thumb.className = "app-custom-scrollbar__thumb";
  track.appendChild(thumb);

  document.body.appendChild(track);

  return { track, thumb };
}

function createController(target, options = {}) {
  const { track, thumb } = createScrollbarElement();
  const kind = options.kind || "element";
  const minThumbSize = options.minThumbSize || DEFAULT_MIN_THUMB_SIZE;
  const trackPadding = options.trackPadding || DEFAULT_TRACK_PADDING;
  const trackWidth = options.trackWidth || DEFAULT_TRACK_WIDTH;
  const edgeOffset = options.edgeOffset || DEFAULT_EDGE_OFFSET;

  const state = {
    dragPointerId: null,
    dragStartClientY: 0,
    dragStartScrollTop: 0,
    viewportSize: 0,
    contentSize: 0,
    maxScroll: 0,
    thumbSize: 0,
    maxThumbOffset: 0
  };

  let resizeObserver = null;
  let mutationObserver = null;
  let rafId = 0;
  let destroyed = false;

  function getMetrics() {
    if (kind === "window") {
      const scroller = getWindowScroller();
      const viewportSize = window.innerHeight;
      const contentSize = Math.max(
        scroller.scrollHeight,
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      );
      const scrollTop = scroller.scrollTop;

      return {
        visible: viewportSize > 0,
        top: trackPadding,
        left: window.innerWidth - trackWidth - edgeOffset,
        height: Math.max(0, viewportSize - trackPadding * 2),
        viewportSize,
        contentSize,
        scrollTop
      };
    }

    if (!target || !target.isConnected) {
      return {
        visible: false,
        top: 0,
        left: 0,
        height: 0,
        viewportSize: 0,
        contentSize: 0,
        scrollTop: 0
      };
    }

    const rect = target.getBoundingClientRect();

    return {
      visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight,
      top: rect.top + trackPadding,
      left: rect.right - trackWidth - edgeOffset,
      height: Math.max(0, rect.height - trackPadding * 2),
      viewportSize: target.clientHeight,
      contentSize: target.scrollHeight,
      scrollTop: target.scrollTop
    };
  }

  function hide() {
    track.classList.add("is-hidden");
  }

  function updateNow() {
    if (destroyed) {
      return;
    }

    const metrics = getMetrics();
    state.viewportSize = metrics.viewportSize;
    state.contentSize = metrics.contentSize;
    state.maxScroll = Math.max(0, metrics.contentSize - metrics.viewportSize);

    if (!metrics.visible || metrics.height <= 0 || state.viewportSize <= 0 || state.maxScroll <= 0) {
      hide();
      return;
    }

    state.thumbSize = clamp((metrics.height * state.viewportSize) / state.contentSize, minThumbSize, metrics.height);
    state.maxThumbOffset = Math.max(0, metrics.height - state.thumbSize);

    const thumbOffset = state.maxScroll > 0
      ? (metrics.scrollTop / state.maxScroll) * state.maxThumbOffset
      : 0;

    track.style.top = `${Math.round(metrics.top)}px`;
    track.style.left = `${Math.round(metrics.left)}px`;
    track.style.height = `${Math.round(metrics.height)}px`;
    track.style.width = `${trackWidth}px`;

    thumb.style.height = `${Math.round(state.thumbSize)}px`;
    thumb.style.transform = `translateY(${Math.round(thumbOffset)}px)`;

    track.classList.remove("is-hidden");
  }

  function scheduleUpdate() {
    if (rafId) {
      return;
    }

    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      updateNow();
    });
  }

  function setScrollTop(nextValue) {
    const value = clamp(nextValue, 0, state.maxScroll);

    if (kind === "window") {
      window.scrollTo({ top: value, behavior: "auto" });
      return;
    }

    target.scrollTop = value;
  }

  function handleTrackPointerDown(event) {
    if (event.target === thumb || state.maxScroll <= 0) {
      return;
    }

    event.preventDefault();

    const bounds = track.getBoundingClientRect();
    const offset = clamp(event.clientY - bounds.top - state.thumbSize / 2, 0, state.maxThumbOffset);
    const ratio = state.maxThumbOffset > 0 ? offset / state.maxThumbOffset : 0;

    setScrollTop(ratio * state.maxScroll);
    scheduleUpdate();
  }

  function handleThumbPointerDown(event) {
    if (state.maxScroll <= 0) {
      return;
    }

    event.preventDefault();

    state.dragPointerId = event.pointerId;
    state.dragStartClientY = event.clientY;
    state.dragStartScrollTop = kind === "window" ? getWindowScroller().scrollTop : target.scrollTop;

    document.body.classList.add("is-custom-scrollbar-dragging");

    if (thumb.setPointerCapture) {
      thumb.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event) {
    if (state.dragPointerId !== event.pointerId || state.maxThumbOffset <= 0) {
      return;
    }

    const delta = event.clientY - state.dragStartClientY;
    const ratio = state.maxScroll / state.maxThumbOffset;

    setScrollTop(state.dragStartScrollTop + delta * ratio);
    scheduleUpdate();
  }

  function finishDrag(event) {
    if (state.dragPointerId === null) {
      return;
    }

    if (event && event.pointerId !== state.dragPointerId) {
      return;
    }

    state.dragPointerId = null;
    document.body.classList.remove("is-custom-scrollbar-dragging");
  }

  function attach() {
    if (kind === "window") {
      document.documentElement.classList.add("app-custom-scrollbar-window");
      window.addEventListener("scroll", scheduleUpdate, { passive: true });
    } else {
      target.classList.add("app-custom-scrollbar-target");
      target.addEventListener("scroll", scheduleUpdate, { passive: true });
    }

    window.addEventListener("resize", scheduleUpdate, { passive: true });
    document.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });
    track.addEventListener("pointerdown", handleTrackPointerDown);
    thumb.addEventListener("pointerdown", handleThumbPointerDown);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate();
      });

      if (kind === "window") {
        resizeObserver.observe(document.documentElement);

        if (document.body) {
          resizeObserver.observe(document.body);
        }
      } else {
        resizeObserver.observe(target);
      }
    }

    if (typeof MutationObserver === "function") {
      mutationObserver = new MutationObserver(() => {
        scheduleUpdate();
      });

      const observeTarget = kind === "window" ? document.body : target;

      if (observeTarget) {
        mutationObserver.observe(observeTarget, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true
        });
      }
    }

    scheduleUpdate();
  }

  function destroy() {
    destroyed = true;

    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (kind === "window") {
      document.documentElement.classList.remove("app-custom-scrollbar-window");
      window.removeEventListener("scroll", scheduleUpdate);
    } else if (target) {
      target.classList.remove("app-custom-scrollbar-target");
      target.removeEventListener("scroll", scheduleUpdate);
    }

    window.removeEventListener("resize", scheduleUpdate);
    document.removeEventListener("scroll", scheduleUpdate, true);
    track.removeEventListener("pointerdown", handleTrackPointerDown);
    thumb.removeEventListener("pointerdown", handleThumbPointerDown);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);

    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    if (mutationObserver) {
      mutationObserver.disconnect();
    }

    finishDrag();
    track.remove();
  }

  attach();

  return {
    update: scheduleUpdate,
    destroy
  };
}

function createManager() {
  const controllers = new Map();

  function getKey(target, kind) {
    return kind === "window" ? "__window__" : target;
  }

  function register(target, options = {}) {
    if (!target && options.kind !== "window") {
      return null;
    }

    const kind = options.kind || "element";
    const key = getKey(target, kind);
    const existing = controllers.get(key);

    if (existing) {
      existing.update();
      return existing;
    }

    const controller = createController(target, options);
    controllers.set(key, controller);
    return controller;
  }

  function unregister(target, options = {}) {
    const kind = options.kind || "element";
    const key = getKey(target, kind);
    const controller = controllers.get(key);

    if (!controller) {
      return;
    }

    controller.destroy();
    controllers.delete(key);
  }

  function updateAll() {
    controllers.forEach((controller) => {
      controller.update();
    });
  }

  function ensure(targets = [], options = {}) {
    const items = Array.isArray(targets) ? targets : [targets];

    items.forEach((item) => {
      if (!item && options.kind !== "window") {
        return;
      }

      register(item, options);
    });

    updateAll();
  }

  return {
    register,
    unregister,
    updateAll,
    ensure
  };
}

function getManager() {
  if (!window[GLOBAL_MANAGER_KEY]) {
    window[GLOBAL_MANAGER_KEY] = createManager();
  }

  return window[GLOBAL_MANAGER_KEY];
}

function uniqueElements(items) {
  const result = [];
  const seen = new Set();

  items.forEach((item) => {
    if (!item || seen.has(item)) {
      return;
    }

    seen.add(item);
    result.push(item);
  });

  return result;
}

function resolveElementsFromSelectors(selectors = []) {
  return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
}

function normalizeEnsureArg(targetOrOptions, maybeOptions) {
  if (
    targetOrOptions &&
    typeof targetOrOptions === "object" &&
    !Array.isArray(targetOrOptions) &&
    !("nodeType" in targetOrOptions) &&
    !("kind" in (maybeOptions || {}))
  ) {
    const selectors = Array.isArray(targetOrOptions.selectors) ? targetOrOptions.selectors : [];
    const directTargets = [];

    if (targetOrOptions.element) {
      directTargets.push(targetOrOptions.element);
    }

    if (Array.isArray(targetOrOptions.elements)) {
      directTargets.push(...targetOrOptions.elements);
    }

    if (Array.isArray(targetOrOptions.targets)) {
      directTargets.push(...targetOrOptions.targets);
    }

    return {
      includeWindow: Boolean(targetOrOptions.includeWindow),
      targets: uniqueElements([
        ...directTargets,
        ...resolveElementsFromSelectors(selectors)
      ]),
      options: {
        minThumbSize: targetOrOptions.minThumbSize,
        trackPadding: targetOrOptions.trackPadding,
        trackWidth: targetOrOptions.trackWidth,
        edgeOffset: targetOrOptions.edgeOffset
      }
    };
  }

  return {
    includeWindow: false,
    targets: targetOrOptions,
    options: maybeOptions || {}
  };
}

export function getCustomScrollbarManager() {
  return getManager();
}

export function registerCustomScrollbar(target, options = {}) {
  return getManager().register(target, options);
}

export function unregisterCustomScrollbar(target, options = {}) {
  return getManager().unregister(target, options);
}

export function updateCustomScrollbars() {
  return getManager().updateAll();
}

export function ensureCustomScrollbars(targetOrOptions, maybeOptions) {
  const normalized = normalizeEnsureArg(targetOrOptions, maybeOptions);

  if (normalized.includeWindow) {
    getManager().register(null, {
      ...normalized.options,
      kind: "window"
    });
  }

  getManager().ensure(normalized.targets, {
    ...normalized.options,
    kind: normalized.options.kind || "element"
  });

  return getManager();
}

export default {
  getCustomScrollbarManager,
  registerCustomScrollbar,
  unregisterCustomScrollbar,
  updateCustomScrollbars,
  ensureCustomScrollbars
};