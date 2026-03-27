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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPill(text, mod) {
  return `<span class="admin-users-pill ${mod}">${escapeHtml(text)}</span>`;
}

function accountStatusLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active") return "利用可";
  if (normalized === "locked") return "ロック";
  if (normalized === "disabled") return "停止";
  if (normalized === "deleted") return "削除済み";
  return normalized || "-";
}

function loginStatusLabel(isLoggedIn) {
  return isLoggedIn ? "ログイン中" : "未ログイン";
}

function screenStatusLabel(isScreenOpen) {
  return isScreenOpen ? "表示中" : "未表示";
}

function twoFactorLabel(twoFactor) {
  if (!twoFactor?.is_enabled) return "OFF";
  return `${twoFactor.method || "email"} / ON`;
}

function statusPillClass(value) {
  const normalized = String(value || "active").trim().toLowerCase();
  return `admin-users-pill--${normalized || "active"}`;
}

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
  revision: "",
  revisionTimer: null,
  revisionIntervalMs: 10000,
  pendingReload: false,
  loading: false,
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

function setEditDirty() {
  const original = state.editOriginal;
  if (!original) {
    state.editDirty = false;
  } else {
    state.editDirty = (
      byId("adminUsersEditDisplayName")?.value !== (original.display_name || "") ||
      byId("adminUsersEditUserKey")?.value !== (original.user_key || "") ||
      byId("adminUsersEditRole")?.value !== (original.role || "user") ||
      byId("adminUsersEditStatus")?.value !== (original.status || "active") ||
      Boolean(byId("adminUsersEditUploadEnabled")?.checked) !== Boolean(original.upload_enabled)
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

function clearRevisionTimer() {
  if (state.revisionTimer) {
    window.clearTimeout(state.revisionTimer);
    state.revisionTimer = null;
  }
}

function isEditModalOpen() {
  return Boolean(document.querySelector("[data-modal-layer][data-modal-id='admin-users-edit']:not([hidden])"));
}

function isCreateModalOpen() {
  return Boolean(document.querySelector("[data-modal-layer][data-modal-id='admin-users-create']:not([hidden])"));
}

function isAutoRefreshBlocked() {
  return Boolean(state.editDirty || state.createDirty || isEditModalOpen() || isCreateModalOpen());
}

async function applyPendingReload() {
  if (!state.pendingReload || isAutoRefreshBlocked()) return;
  state.pendingReload = false;
  await loadUsers({ silent: true });
}

function closeEditModal() {
  window.AdminApp?.modal?.close?.("admin-users-edit");
  state.editOriginal = null;
  state.editDirty = false;
  window.AdminApp?.dirtyGuard?.clear?.("admin-users-edit");
  void applyPendingReload();
}

function closeCreateModal() {
  window.AdminApp?.modal?.close?.("admin-users-create");
  resetCreateForm();
  void applyPendingReload();
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

function updateLiveStatusText() {
  const el = byId("adminUsersLiveStatus");
  if (!el) return;
  if (state.pendingReload) {
    el.textContent = "更新保留中";
    return;
  }
  el.textContent = document.visibilityState === "hidden" ? "自動確認停止中" : "変更検知中";
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
    tbody.innerHTML = `<tr><td colspan="10" class="admin-users-table__empty">該当するユーザーがいません。</td></tr>`;
  } else {
    for (const item of state.items) {
      const tr = document.createElement("tr");
      const avatar = item.avatar_url
        ? `<img src="${escapeHtml(item.avatar_url)}" alt="${escapeHtml(item.display_name || item.user_key || "user")}">`
        : `<span>${escapeHtml((item.display_name || item.user_key || "?").slice(0, 1).toUpperCase())}</span>`;
      const providers = Array.isArray(item.auth_providers) && item.auth_providers.length > 0 ? item.auth_providers.join(", ") : "-";
      tr.innerHTML = `
        <td>
          <div class="admin-user-cell">
            <div class="admin-user-cell__avatar">${avatar}</div>
            <div>
              <div class="admin-user-cell__name">${escapeHtml(item.display_name || "-")}</div>
              <div class="admin-user-cell__sub">${escapeHtml(item.user_key || "-")} ・ ${escapeHtml(providers)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(item.primary_email || "未登録")}</td>
        <td>${buildPill(item.role || "-", item.role === "admin" ? "admin-users-pill--admin" : "admin-users-pill--user")}</td>
        <td>${buildPill(accountStatusLabel(item.status), statusPillClass(item.status))}</td>
        <td>${buildPill(loginStatusLabel(Boolean(item.is_logged_in)), Boolean(item.is_logged_in) ? "admin-users-pill--login-on" : "admin-users-pill--login-off")}</td>
        <td>${buildPill(screenStatusLabel(Boolean(item.is_screen_open)), Boolean(item.is_screen_open) ? "admin-users-pill--screen-on" : "admin-users-pill--screen-off")}</td>
        <td>${escapeHtml(twoFactorLabel(item.two_factor))}</td>
        <td>${item.upload_enabled ? "許可" : "禁止"}</td>
        <td>${escapeHtml(formatDateTime(item.last_access_at || item.last_seen_at))}</td>
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
  updateLiveStatusText();
}

async function loadUsers(options = {}) {
  const app = window.AdminApp;
  const silent = Boolean(options.silent);
  const tbody = byId("adminUsersTableBody");
  state.loading = true;
  if (!silent && tbody) {
    tbody.innerHTML = `<tr><td colspan="10" class="admin-users-table__empty">読み込み中です。</td></tr>`;
  }
  try {
    const payload = await app.api.get(`/api/admin/users?${qs()}`);
    state.total = Number(payload.data?.total || 0);
    state.pages = Number(payload.data?.pages || 1);
    state.page = Number(payload.data?.page || state.page);
    state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
    state.revision = String(payload.data?.revision || state.revision || "");
    renderTable();
  } catch (error) {
    const message = error?.message || "ユーザー一覧の取得に失敗しました。";
    window.AdminApp?.toast?.error?.(message);
    state.items = [];
    state.total = 0;
    state.pages = 1;
    renderTable();
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" class="admin-users-table__empty">${escapeHtml(message)}</td></tr>`;
    }
  } finally {
    state.loading = false;
    scheduleRevisionCheck();
  }
}

async function fetchUsersRevision() {
  const payload = await window.AdminApp.api.get("/api/admin/users/revision");
  return String(payload.data?.revision || "");
}

async function pollUsersRevision() {
  clearRevisionTimer();
  if (document.visibilityState === "hidden") {
    updateLiveStatusText();
    return;
  }
  try {
    const revision = await fetchUsersRevision();
    if (state.revision && revision && revision !== state.revision) {
      if (isAutoRefreshBlocked()) {
        state.pendingReload = true;
      } else {
        await loadUsers({ silent: true });
        return;
      }
    }
    if (!state.revision && revision) {
      state.revision = revision;
    }
  } catch (error) {
  } finally {
    updateLiveStatusText();
    scheduleRevisionCheck();
  }
}

function scheduleRevisionCheck() {
  clearRevisionTimer();
  if (document.visibilityState === "hidden") return;
  state.revisionTimer = window.setTimeout(() => {
    void pollUsersRevision();
  }, state.revisionIntervalMs);
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
    byId("adminUsersEditLastAccessAt").textContent = formatDateTime(user.last_access_at || user.last_seen_at);
    byId("adminUsersEditLoginStatus").textContent = loginStatusLabel(Boolean(user.is_logged_in));
    byId("adminUsersEditScreenStatus").textContent = screenStatusLabel(Boolean(user.is_screen_open));
    byId("adminUsersEditTwoFactor").textContent = twoFactorLabel(user.two_factor);
    state.editDirty = false;
    window.AdminApp.dirtyGuard.setDirty("admin-users-edit", false);
    window.AdminApp.modal.open("admin-users-edit");
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
    payload.display_name !== state.editOriginal.display_name ||
    payload.user_key !== state.editOriginal.user_key ||
    payload.role !== state.editOriginal.role ||
    payload.status !== state.editOriginal.status ||
    payload.upload_enabled !== state.editOriginal.upload_enabled
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
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || "ユーザー情報の更新に失敗しました。");
    }
    window.AdminApp?.toast?.success?.(data?.message || "更新しました。");
    closeEditModal();
    await loadUsers({ silent: true });
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
      body: JSON.stringify({})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data?.error?.message || "ユーザー削除に失敗しました。");
    }
    window.AdminApp?.toast?.success?.(data?.message || "削除しました。");
    closeEditModal();
    await loadUsers({ silent: true });
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
      body: JSON.stringify(payload)
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
    await loadUsers({ silent: true });
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
    openEditModal(userId);
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
    loadUsers();
  }

  search?.addEventListener("input", () => {
    window.clearTimeout(state.filterTimer);
    state.filterTimer = window.setTimeout(trigger, 250);
  });
  role?.addEventListener("change", trigger);
  status?.addEventListener("change", trigger);
  sort?.addEventListener("change", trigger);
  reload?.addEventListener("click", () => loadUsers());
  prev?.addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadUsers();
  });
  next?.addEventListener("click", () => {
    if (state.page >= state.pages) return;
    state.page += 1;
    loadUsers();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.pendingReload) {
        void applyPendingReload();
      }
      scheduleRevisionCheck();
    } else {
      clearRevisionTimer();
      updateLiveStatusText();
    }
  });
}

function bindModals() {
  byId("adminUsersCreateButton")?.addEventListener("click", () => {
    resetCreateForm();
    window.AdminApp.modal.open("admin-users-create");
  });

  byId("adminUsersCreateCloseButton")?.addEventListener("click", async () => {
    const ok = await window.AdminApp.dirtyGuard.confirmIfNeeded("未保存の入力があります。閉じますか？");
    if (!ok) return;
    closeCreateModal();
  });

  byId("adminUsersCreateSubmitButton")?.addEventListener("click", createTempUser);
  byId("adminUsersEditCloseButton")?.addEventListener("click", async () => {
    const ok = await window.AdminApp.dirtyGuard.confirmIfNeeded("未保存の変更があります。閉じますか？");
    if (!ok) return;
    closeEditModal();
  });
  byId("adminUsersEditSaveButton")?.addEventListener("click", saveEdit);
  byId("adminUsersDeleteButton")?.addEventListener("click", deleteCurrentUser);
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

async function initPage() {
  bindFilters();
  bindTableEvents();
  bindModals();
  await loadUsers();
}

document.addEventListener("admin:ready", () => {
  void initPage();
});
