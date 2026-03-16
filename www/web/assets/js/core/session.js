import { ApiError } from "./api.js";

export function createSessionStore(apiClient) {
  let state = {
    loaded: false,
    authenticated: false,
    data: null
  };

  const listeners = new Set();

  function notify() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  async function load() {
    try {
      const payload = await apiClient.get("/api/auth/me");
      state = {
        loaded: true,
        authenticated: true,
        data: payload.data
      };
      notify();
      return state;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        state = {
          loaded: true,
          authenticated: false,
          data: null
        };
        notify();
        return state;
      }
      throw error;
    }
  }

  function clear() {
    state = {
      loaded: true,
      authenticated: false,
      data: null
    };
    notify();
  }

  function getState() {
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    load,
    clear,
    getState,
    subscribe
  };
}