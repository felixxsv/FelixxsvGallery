export function createDirtyGuard({ confirmDiscard } = {}) {
  const states = new Map();
  let allowLeaveOnce = false;

  function coerceDirtyValue(value) {
    if (typeof value === "function") {
      try {
        return Boolean(value());
      } catch {
        return false;
      }
    }
    return Boolean(value);
  }

  function register(id, getter) {
    if (!id) return () => {};
    states.set(id, getter);
    return () => {
      states.delete(id);
    };
  }

  function setDirty(id, dirty) {
    if (!id) return;
    states.set(id, Boolean(dirty));
  }

  function clear(id) {
    if (!id) return;
    states.delete(id);
  }

  function clearAll() {
    states.clear();
  }

  function isDirty() {
    for (const value of states.values()) {
      if (coerceDirtyValue(value)) {
        return true;
      }
    }
    return false;
  }

  async function confirmIfNeeded(message = "未保存の変更があります。破棄して移動しますか？") {
    if (!isDirty()) {
      return true;
    }

    if (typeof confirmDiscard === "function") {
      return Boolean(await confirmDiscard(message));
    }

    return window.confirm(message);
  }

  function allowNextLeave() {
    allowLeaveOnce = true;
    window.setTimeout(() => {
      allowLeaveOnce = false;
    }, 0);
  }

  function bindBeforeUnload() {
    window.addEventListener("beforeunload", (event) => {
      if (allowLeaveOnce) return;
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  bindBeforeUnload();

  return {
    register,
    setDirty,
    clear,
    clearAll,
    isDirty,
    confirmIfNeeded,
    allowNextLeave
  };
}
