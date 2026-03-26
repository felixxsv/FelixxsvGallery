function byId(id) {
  return document.getElementById(id);
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ja-JP");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPill(text, mod) {
  return `<span class="admin-users-pill ${mod ? escapeHtml(mod) : ""}">${escapeHtml(text)}</span>`;
}

const LIVE_REFRESH_KEY = "admin.users.liveRefreshMs";
const LIVE_ALLOWED_INTERVALS = [0, 3000, 5000, 10000, 30000, 60000];
const LIVE_DEFAULT_INTERVAL_MS = 3000;

const state = {
  page: 1,
  perPage: 20,
  q: "",
  role: "",
  status: "",
  sort: "created_desc",
  total: 0,
  pages: 1,
  items: [],
  currentUser: null,
  editOriginal: null,
  editDirty: false,
  createDirty: false,
  pendingConfirm: null,
  filterTimer: null,
  loadPromise: null,
  lastSnapshot: "",
  liveWatcher: null,
};

function qs() {
  const params = new URLSearchParams();
  params.set("page", String(state.page));
  params.set("per_page", String(state.perPage));
  params.set("sort", state.sort || "created_desc");
  if (state.q) params.set("q", state.q);
  if (state.role) params.set("role", state.role);
  if (state.status) params.set("status", state.status);
  return params.toString();
}

function getLiveInterval() {
  return window.AdminApp?.live?.getStoredInterval?.(LIVE_REFRESH_KEY, LIVE_ALLOWED_INTERVALS, LIVE_DEFAULT_INTERVAL_MS) ?? LIVE_DEFAULT_INTERVAL_MS;
}

function setLiveInterval(value) {
  return window.AdminApp?.live?.setStoredInterval?.(LIVE_REFRESH_KEY, value, LIVE_ALLOWED_INTERVALS, LIVE_DEFAULT_INTERVAL_MS) ?? LIVE_DEFAULT_INTERVAL_MS;
}

function setEditDirty() {
  const original = state.editOriginal;
  if (!original) {
    state.editDirty = false;
  } else {
    state.editDirty = (
      byId("adminUsersEditDisplayName")?.value !== (original.display_name || "")
      || byId("adminUsersEditUserKey")?.value !== (original.user_key || "")
      || byId("adminUsersEditRole")?.value !== (original.role || "user")
      || byId("adminUsersEditStatus")?.value !== (original.status || "active")
      || Boolean(byId("adminUsersEditUploadEnabled")?.checked) !== Boolean(original.upload_enabled)
    );
  }
  window.AdminApp?.dirtyGuard?.setDirty("admin-users-edit", state.editDirty);
}

function setCreateDirty() {
  const displayName = byId("adminUsersCreateDisplayName")?.value || "";
  const role = byId("adminUsersCreateRole")?.value || "user";
  const uploadEnabled = Boolean(byId("adminUsersCreateUploadEnabled")?.checked);
  state.createDirty = Boolean(displayName.trim()) || role !== "user" || uploadEnabled !== true;
  window.AdminApp?.dirtyGuard?.setDirty("admin-users-create", state.createDirty);
}

function resetCreateForm() {
  const displayName = byId("adminUsersCreateDisplayName");
  const role = byId("adminUsersCreateRole");
  const uploadEnabled = byId("adminUsersCreateUploadEnabled");
  const result = byId("adminUsersCreateResult");
  const resultUserKey = byId("adminUsersCreateResultUserKey");
  const resultPassword = byId("adminUsersCreateResultPassword");

  if (displayName) displayName.value = "";
  if (role) role.value = "user";
  if (uploadEnabled) uploadEnabled.checked = true;
  if (result) result.hidden = true;
  if (resultUserKey) resultUserKey.textContent = "-";
  if (resultPassword) resultPassword.textContent = "-";

  state.createDirty = false;
  window.AdminApp?.dirtyGuard?.setDirty("admin-users-create", false);
}

function closeEditModal() {
  window.AdminApp?.modal?.close?.("admin-users-edit");
  state.editOriginal = null;
  state.editDirty = false;
  window.AdminApp?.dirtyGuard?.clear?.("admin-users-edit");
}

function closeCreateModal() {
  window.AdminApp?.modal?.close?.("admin-users-create");
  resetCreateForm();
}

async function openActionConfirm(message, approveLabel = "実行") {
  const msg = byId("adminUsersActionConfirmMessage");
  const approve = byId("adminUsersActionConfirmApprove");
  if (msg) msg.textContent = message;
  if (approve) approve.textContent = approveLabel;
  window.AdminApp?.modal?.open?.("admin-users-action-confirm");
  return new Promise((resolve) => {
    state.pendingConfirm = resolve;
  });
}

function closeActionConfirm(result) {
  const resolver = state.pendingConfirm;
  state.pendingConfirm = null;
  window.AdminApp?.modal?.close?.("admin-users-action-confirm");
  if (typeof resolver === "function") resolver(Boolean(result));
}

function buildUsersSnapshot(payload) {
  return JSON.stringify({
    total: Number(payload.data?.total || 0),
    page: Number(payload.data?.page || state.page),
    pages: Number(payload.data?.pages || 1),
    items: Array.isArray(payload.data?.items)
      ? payload.data.items.map((item) => ({
          user_id: item.user_id,
          display_name: item.display_name,
          user_key: item.user_key,
          primary_email: item.primary_email,
          role: item.role,
          status: item.status,
          upload_enabled: Boolean(item.upload_enabled),
          last_seen_at: item.last_seen_at || "",
          providers: Array.isArray(item.auth_providers) ? item.auth_providers.join(",") : "",
          two_factor: item.two_factor?.is_enabled ? `${item.two_factor.method || "email"}:1` : "0",
        }))
      : [],
  });
}

function renderTable() {
  const tbody = byId("adminUsersTableBody");
  const summary = byId("adminUsersSummary");
  const pageInfo = byId("adminUsersPageInfo");
  const prev = byId("adminUsersPrevPage");
  const next = byId("adminUsersNextPage");

  if (!tbody) return;
  tbody.innerHTML = "";

  if (!Array.isArray(state.items) || state.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-users-table__empty">該当するユーザーがいません。</td></tr>`;
  } else {
    for (const item of state.items) {
      const tr = document.createElement("tr");
      const avatar = item.avatar_url
        ? `<img src="${item.avatar_url}" alt="">`
        : `${escapeHtml((item.display_name || item.user_key || "?").slice(0, 1).toUpperCase())}`;
      const providers = Array.isArray(item.auth_providers) && item.auth_providers.length > 0
        ? item.auth_providers.join(", ")
        : "-";
      const twoFactorText = item.two_factor?.is_enabled ? `${item.two_factor.method || "email"} / ON` : "OFF";
      tr.innerHTML = `
        <td><div class="admin-users-avatar">${avatar}</div></td>
        <td>${escapeHtml(item.display_name || "-")}</td>
        <td>${escapeHtml(item.primary_email || "未登録")}</td>
        <td>${buildPill(item.role || "-", item.role === "admin" ? "admin-users-pill--admin" : "admin-users-pill--user")}</td>
        <td>${buildPill(item.status || "-", `admin-users-pill--${escapeHtml(item.status || "active")}`)}</td>
        <td>${escapeHtml(twoFactorText)}</td>
        <td>${item.upload_enabled ? "許可" : "禁止"}</td>
        <td>${escapeHtml(formatDateTime(item.last_seen_at))}</td>
        <td>
          <div class="admin-users-actions">
            <button type="button" class="app-button app-button--ghost admin-users-mini-button" data-action="edit" data-user-id="${item.user_id}">編集</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  if (summary) summary.textContent = `合計 ${state.total} 件`;
  if (pageInfo) pageInfo.textContent = `${state.page} / ${state.pages}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}

function ensureLiveRefreshControl() {
  const reloadButton = byId("adminUsersReloadButton");
  if (!reloadButton || byId("adminUsersLiveRefreshInterval")) return;

  const wrapper = document.createElement("label");
  wrapper.style.display = "inline-flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "8px";
  wrapper.style.marginRight = "8px";
  wrapper.setAttribute("for", "adminUsersLiveRefreshInterval");
  wrapper.textContent = "自動更新";

  const select = document.createElement("select");
  select.id = "adminUsersLiveRefreshInterval";
  select.style.minWidth = "96px";

  const options = [
    [0, "OFF"],
    [3000, "3秒"],
    [5000, "5秒"],
    [10000, "10秒"],
    [30000, "30秒"],
    [60000, "1分"],
  ];
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = String(getLiveInterval());
  wrapper.appendChild(select);
  reloadButton.parentElement?.insertBefore(wrapper, reloadButton);

  select.addEventListener("change", () => {
    const value = setLiveInterval(select.value);
    select.value = String(value);
    state.liveWatcher?.schedule?.();
    if (value) {
      void state.liveWatcher?.refreshNow?.();
    }
  });
}

function isLiveRefreshAllowed() {
  return !state.pendingConfirm && !state.editOriginal && !state.editDirty && !state.createDirty;
}

async function loadUsers({ silent = false, force = false } = {}) {
  if (state.loadPromise) {
    return state.loadPromise;
  }

  const app = window.AdminApp;
  const tbody = byId("adminUsersTableBody");
  if (tbody && !silent) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-users-table__empty">読み込み中です。</td></tr>`;
  }

  state.loadPromise = app.api.get(`/api/admin/users?${qs()}`)
    .then((payload) => {
      const snapshot = buildUsersSnapshot(payload);
      if (!force && silent && snapshot === state.lastSnapshot) {
        return;
      }
      state.lastSnapshot = snapshot;
      state.total = Number(payload.data?.total || 0);
      state.pages = Number(payload.data?.pages || 1);
      state.page = Number(payload.data?.page || state.page);
      state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
      renderTable();
    })
    .catch((error) => {
      const message = error?.message || "ユーザー一覧の取得に失敗しました。";
      state.items = [];
      state.total = 0;
      state.pages = 1;
      renderTable();
      if (tbody && !silent) {
        tbody.innerHTML = `<tr><td colspan="8" class="admin-users-table__empty">${escapeHtml(message)}</td></tr>`;
      }
      if (!silent) {
        window.AdminApp?.toast?.error?.(message);
      }
    })
    .finally(() => {
      state.loadPromise = null;
    });

  return state.loadPromise;
}

async function openEditModal(userId) {
  try {
    const payload = await window.AdminApp.api.get(`/api/admin/users/${userId}`);
    const user = payload.data?.user;
    if (!user) throw new Error("対象ユーザーが見つかりません。");

    state.currentUser = user;
    state.editOriginal = {
      display_name: user.display_name || "",
      user_key: user.user_key || "",
      role: user.role || "user",
      status: user.status || "active",
      upload_enabled: Boolean(user.upload_enabled),
    };

    byId("adminUsersEditDisplayName").value = state.editOriginal.display_name;
    byId("adminUsersEditUserKey").value = state.editOriginal.user_key;
    byId("adminUsersEditRole").value = state.editOriginal.role;
    byId("adminUsersEditStatus").value = state.editOriginal.status;
    byId("adminUsersEditUploadEnabled").checked = state.editOriginal.upload_enabled;
    byId("adminUsersEditEmail").textContent = user.primary_email || "未登録";
    byId("adminUsersEditCreatedAt").textContent = formatDateTime(user.created_at);
    byId("adminUsersEditLastSeenAt").textContent = formatDateTime(user.last_seen_at);
    byId("adminUsersEditTwoFactor").textContent = user.two_factor?.is_enabled
      ? `${user.two_factor?.method || "email"} / ON`
      : "OFF";

    state.editDirty = false;
    window.AdminApp?.dirtyGuard?.setDirty?.("admin-users-edit", false);
    window.AdminApp?.modal?.open?.("admin-users-edit");
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "ユーザー詳細の取得に失敗しました。");
  }
}

async function saveEdit() {
  if (!state.currentUser) return;

  const payload = {
    display_name: byId("adminUsersEditDisplayName")?.value || "",
    user_key: byId("adminUsersEditUserKey")?.value || "",
    role: byId("adminUsersEditRole")?.value || "user",
    status: byId("adminUsersEditStatus")?.value || "active",
    upload_enabled: Boolean(byId("adminUsersEditUploadEnabled")?.checked),
  };

  const hasChanges = (
    payload.display_name !== state.editOriginal.display_name
    || payload.user_key !== state.editOriginal.user_key
    || payload.role !== state.editOriginal.role
    || payload.status !== state.editOriginal.status
    || payload.upload_enabled !== state.editOriginal.upload_enabled
  );

  if (!hasChanges) {
    closeEditModal();
    return;
  }

  const ok = await openActionConfirm("ユーザー情報を更新しますか？", "更新");
  if (!ok) return;

  try {
    const response = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || "ユーザー情報の更新に失敗しました。");
    }
    window.AdminApp?.toast?.success?.(data?.message || "更新しました。");
    closeEditModal();
    state.lastSnapshot = "";
    await loadUsers({ force: true });
    state.liveWatcher?.schedule?.();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "ユーザー情報の更新に失敗しました。");
  }
}

async function deleteCurrentUser() {
  if (!state.currentUser) return;

  const ok = await openActionConfirm(`「${state.currentUser.display_name || state.currentUser.user_key}」を削除しますか？`, "削除");
  if (!ok) return;

  try {
    const response = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/delete`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || "ユーザー削除に失敗しました。");
    }
    window.AdminApp?.toast?.success?.(data?.message || "削除しました。");
    closeEditModal();
    state.lastSnapshot = "";
    await loadUsers({ force: true });
    state.liveWatcher?.schedule?.();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "ユーザー削除に失敗しました。");
  }
}

async function createTempUser() {
  const payload = {
    display_name: byId("adminUsersCreateDisplayName")?.value || "",
    role: byId("adminUsersCreateRole")?.value || "user",
    upload_enabled: Boolean(byId("adminUsersCreateUploadEnabled")?.checked),
  };

  const ok = await openActionConfirm("仮ユーザーを作成しますか？", "作成");
  if (!ok) return;

  try {
    const response = await fetch(`${window.AdminApp.appBase}/api/admin/users/create`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || "仮ユーザー作成に失敗しました。");
    }
    const creds = data?.data?.temporary_credentials || {};
    byId("adminUsersCreateResultUserKey").textContent = creds.user_key || "-";
    byId("adminUsersCreateResultPassword").textContent = creds.password || "-";
    const result = byId("adminUsersCreateResult");
    if (result) result.hidden = false;
    window.AdminApp?.toast?.success?.(data?.message || "仮ユーザーを作成しました。");
    state.createDirty = false;
    window.AdminApp?.dirtyGuard?.setDirty?.("admin-users-create", false);
    state.lastSnapshot = "";
    await loadUsers({ force: true });
    state.liveWatcher?.schedule?.();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "仮ユーザー作成に失敗しました。");
  }
}

function bindTableEvents() {
  const tbody = byId("adminUsersTableBody");
  tbody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='edit']");
    if (!button) return;
    const userId = Number(button.getAttribute("data-user-id") || 0);
    if (!userId) return;
    void openEditModal(userId);
  });
}

function bindFilters() {
  const search = byId("adminUsersSearch");
  const role = byId("adminUsersRoleFilter");
  const status = byId("adminUsersStatusFilter");
  const sort = byId("adminUsersSort");
  const reload = byId("adminUsersReloadButton");
  const prev = byId("adminUsersPrevPage");
  const next = byId("adminUsersNextPage");

  function trigger() {
    state.page = 1;
    state.q = search?.value?.trim() || "";
    state.role = role?.value || "";
    state.status = status?.value || "";
    state.sort = sort?.value || "created_desc";
    state.lastSnapshot = "";
    void loadUsers({ force: true });
  }

  search?.addEventListener("input", () => {
    window.clearTimeout(state.filterTimer);
    state.filterTimer = window.setTimeout(trigger, 250);
  });
  role?.addEventListener("change", trigger);
  status?.addEventListener("change", trigger);
  sort?.addEventListener("change", trigger);
  reload?.addEventListener("click", () => {
    state.lastSnapshot = "";
    void loadUsers({ force: true });
  });
  prev?.addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page -= 1;
    state.lastSnapshot = "";
    void loadUsers({ force: true });
  });
  next?.addEventListener("click", () => {
    if (state.page >= state.pages) return;
    state.page += 1;
    state.lastSnapshot = "";
    void loadUsers({ force: true });
  });
}

function bindModals() {
  byId("adminUsersCreateButton")?.addEventListener("click", () => {
    resetCreateForm();
    window.AdminApp?.modal?.open?.("admin-users-create");
  });

  byId("adminUsersCreateCloseButton")?.addEventListener("click", async () => {
    const ok = await window.AdminApp?.dirtyGuard?.confirmIfNeeded?.("未保存の入力があります。閉じますか？");
    if (!ok) return;
    closeCreateModal();
  });

  byId("adminUsersCreateSubmitButton")?.addEventListener("click", () => {
    void createTempUser();
  });

  byId("adminUsersEditCloseButton")?.addEventListener("click", async () => {
    const ok = await window.AdminApp?.dirtyGuard?.confirmIfNeeded?.("未保存の変更があります。閉じますか？");
    if (!ok) return;
    closeEditModal();
  });

  byId("adminUsersEditSaveButton")?.addEventListener("click", () => {
    void saveEdit();
  });

  byId("adminUsersDeleteButton")?.addEventListener("click", () => {
    void deleteCurrentUser();
  });

  byId("adminUsersActionConfirmApprove")?.addEventListener("click", () => closeActionConfirm(true));
  byId("adminUsersActionConfirmCancel")?.addEventListener("click", () => closeActionConfirm(false));

  [
    "adminUsersEditDisplayName",
    "adminUsersEditUserKey",
    "adminUsersEditRole",
    "adminUsersEditStatus",
    "adminUsersEditUploadEnabled",
  ].forEach((id) => {
    const el = byId(id);
    el?.addEventListener("input", setEditDirty);
    el?.addEventListener("change", setEditDirty);
  });

  [
    "adminUsersCreateDisplayName",
    "adminUsersCreateRole",
    "adminUsersCreateUploadEnabled",
  ].forEach((id) => {
    const el = byId(id);
    el?.addEventListener("input", setCreateDirty);
    el?.addEventListener("change", setCreateDirty);
  });
}

function startLiveRefresh() {
  ensureLiveRefreshControl();
  state.liveWatcher = window.AdminApp?.live?.createWatcher?.({
    storageKey: LIVE_REFRESH_KEY,
    defaultIntervalMs: LIVE_DEFAULT_INTERVAL_MS,
    allowedIntervals: LIVE_ALLOWED_INTERVALS,
    visibleOnly: true,
    enabledWhen: isLiveRefreshAllowed,
    onTick: async () => {
      await loadUsers({ silent: true });
    },
  });

  state.liveWatcher?.start?.({ immediate: false });
}

async function initPage() {
  bindFilters();
  bindTableEvents();
  bindModals();
  await loadUsers({ force: true });
  startLiveRefresh();
}

document.addEventListener("admin:ready", () => {
  void initPage();
});
