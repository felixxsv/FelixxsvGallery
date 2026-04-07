import { escapeHtml } from "../../core/dom.js";

const USERS_MESSAGES = {
  ja: {
    active: "利用可",
    locked: "ロック",
    disabled: "停止",
    deleted: "削除",
    logged_in: "ログイン中",
    logged_out: "未ログイン",
    visible: "表示中",
    hidden: "非表示",
    remove: "削除",
    no_badges: "バッジなし",
    revoke: "剥奪",
    select_badge: "バッジを選択...",
    auto: "自動",
    manual: "手動",
    badge_grant_error: "バッジ付与に失敗しました。",
    badge_granted: "バッジを付与しました。",
    badge_revoke_error: "バッジ剥奪に失敗しました。",
    badge_revoked: "バッジを剥奪しました。",
    execute: "実行",
    empty: "該当するユーザーがいません。",
    user: "user",
    unregistered: "未登録",
    allow: "許可",
    deny: "禁止",
    edit: "編集",
    total_count: "合計 {count} 件",
    loading: "読み込み中です。",
    load_error: "ユーザー一覧の取得に失敗しました。",
    not_found: "対象ユーザーが見つかりません。",
    detail_load_error: "ユーザー詳細の取得に失敗しました。",
    update_confirm: "ユーザー情報を更新しますか？",
    update: "更新",
    profile_update_error: "プロフィール更新に失敗しました。",
    links_update_error: "リンク更新に失敗しました。",
    updated: "更新しました。",
    update_error: "ユーザー情報の更新に失敗しました。",
    delete_confirm: "「{name}」を削除しますか？",
    delete_label: "削除",
    delete_error: "ユーザー削除に失敗しました。",
    deleted_ok: "削除しました。",
    create_confirm: "仮ユーザーを作成しますか？",
    create_label: "作成",
    create_error: "仮ユーザー作成に失敗しました。",
    created_ok: "仮ユーザーを作成しました。",
    close_create_confirm: "未保存の入力があります。閉じますか？",
    close_edit_confirm: "未保存の変更があります。閉じますか？",
  },
  "en-us": {
    active: "Active",
    locked: "Locked",
    disabled: "Disabled",
    deleted: "Deleted",
    logged_in: "Logged in",
    logged_out: "Logged out",
    visible: "Visible",
    hidden: "Hidden",
    remove: "Remove",
    no_badges: "No badges",
    revoke: "Revoke",
    select_badge: "Select a badge...",
    auto: "Auto",
    manual: "Manual",
    badge_grant_error: "Failed to grant badge.",
    badge_granted: "Badge granted.",
    badge_revoke_error: "Failed to revoke badge.",
    badge_revoked: "Badge revoked.",
    execute: "Confirm",
    empty: "No users found.",
    user: "user",
    unregistered: "Not registered",
    allow: "Allowed",
    deny: "Denied",
    edit: "Edit",
    total_count: "Total {count}",
    loading: "Loading...",
    load_error: "Failed to load users.",
    not_found: "User not found.",
    detail_load_error: "Failed to load user details.",
    update_confirm: "Update this user?",
    update: "Update",
    profile_update_error: "Failed to update profile.",
    links_update_error: "Failed to update links.",
    updated: "Updated.",
    update_error: "Failed to update user.",
    delete_confirm: "Delete “{name}”?",
    delete_label: "Delete",
    delete_error: "Failed to delete user.",
    deleted_ok: "Deleted.",
    create_confirm: "Create a temporary user?",
    create_label: "Create",
    create_error: "Failed to create temporary user.",
    created_ok: "Temporary user created.",
    close_create_confirm: "There is unsaved input. Close anyway?",
    close_edit_confirm: "There are unsaved changes. Close anyway?",
  },
};

function byId(id) {
  return document.getElementById(id);
}

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_users.${key}`, fallback, vars) || fallback;
}

function defineMessages() {
  Object.entries(USERS_MESSAGES).forEach(([locale, messages]) => {
    window.AdminApp?.i18n?.define?.(locale, Object.fromEntries(Object.entries(messages).map(([key, value]) => [`admin_users.${key}`, value])));
  });
  ["de", "fr", "ru", "es", "zh-cn", "ko"].forEach((locale) => {
    window.AdminApp?.i18n?.define?.(locale, Object.fromEntries(Object.entries(USERS_MESSAGES["en-us"]).map(([key, value]) => [`admin_users.${key}`, value])));
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ja-JP");
}

function buildPill(text, mod) {
  return `<span class="admin-users-pill ${mod}">${escapeHtml(text)}</span>`;
}

function accountStatusLabel(value) {
  switch (String(value || "").toLowerCase()) {
    case "active":
      return t("active", "Active");
    case "locked":
      return t("locked", "Locked");
    case "disabled":
      return t("disabled", "Disabled");
    case "deleted":
      return t("deleted", "Deleted");
    default:
      return String(value || "-");
  }
}

function loginStatusLabel(value) {
  return String(value || "") === "logged_in" ? t("logged_in", "Logged in") : t("logged_out", "Logged out");
}

function screenStatusLabel(value) {
  return String(value || "") === "visible" ? t("visible", "Visible") : t("hidden", "Hidden");
}

const BADGE_COLOR_CLASS = {
  blue: "admin-badge--blue",
  red: "admin-badge--red",
  green: "admin-badge--green",
  gold: "admin-badge--gold",
  gray: "admin-badge--gray",
};

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
  editLinks: [],          // current link list in modal
  editBadges: [],         // current badge pool in modal
  badgeCatalog: [],       // full catalog from API
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
      Boolean(byId("adminUsersEditUploadEnabled")?.checked) !== Boolean(original.upload_enabled) ||
      (byId("adminUsersEditBio")?.value || "") !== (original.bio || "")
    );
  }
  window.AdminApp?.dirtyGuard?.setDirty("admin-users-edit", state.editDirty);
}

// --- Links editor ---

function renderLinksEditor() {
  const list = byId("adminUsersEditLinksList");
  const addBtn = byId("adminUsersEditLinkAddButton");
  if (!list) return;
  list.innerHTML = "";
  state.editLinks.forEach((link, idx) => {
    const row = document.createElement("div");
    row.className = "admin-users-modal__link-row";
    row.innerHTML = `
      <input class="app-input admin-users-modal__link-input" type="url" placeholder="https://..." value="${escapeHtml(link.url || "")}" data-link-idx="${idx}"/>
      <button type="button" class="app-button app-button--ghost admin-users-modal__link-remove" data-link-idx="${idx}" aria-label="${escapeHtml(t("remove", "Remove"))}">×</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll("[data-link-idx]").forEach((el) => {
    el.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.linkIdx);
      if (state.editLinks[idx] !== undefined) state.editLinks[idx].url = e.target.value;
      setEditDirty();
    });
    el.addEventListener("click", (e) => {
      if (!e.target.classList.contains("admin-users-modal__link-remove")) return;
      const idx = Number(e.target.dataset.linkIdx);
      state.editLinks.splice(idx, 1);
      renderLinksEditor();
      setEditDirty();
    });
  });
  if (addBtn) addBtn.hidden = state.editLinks.length >= 5;
}

// --- Badge pool editor ---

function renderBadgePool() {
  const pool = byId("adminUsersEditBadgePool");
  const sel = byId("adminUsersEditBadgeSelect");
  if (!pool) return;
  pool.innerHTML = "";
  if (!state.editBadges.length) {
    pool.innerHTML = `<span class="admin-users-modal__badge-empty">${escapeHtml(t("no_badges", "No badges"))}</span>`;
  }
  for (const badge of state.editBadges) {
    const colorClass = BADGE_COLOR_CLASS[badge.color] || "admin-badge--gray";
    const span = document.createElement("span");
    span.className = `admin-badge ${colorClass}`;
    span.innerHTML = `${escapeHtml(badge.name)}<button type="button" class="admin-badge__revoke" data-badge-key="${escapeHtml(badge.key)}" aria-label="${escapeHtml(t("revoke", "Revoke"))}">×</button>`;
    pool.appendChild(span);
  }
  pool.querySelectorAll(".admin-badge__revoke").forEach((btn) => {
    btn.addEventListener("click", () => revokeBadge(btn.dataset.badgeKey));
  });
  // Update select options: exclude already-owned keys
  if (sel) {
    const ownedKeys = new Set(state.editBadges.map((b) => b.key));
    sel.innerHTML = `<option value="">${escapeHtml(t("select_badge", "Select a badge..."))}</option>`;
    for (const item of state.badgeCatalog) {
      if (ownedKeys.has(item.key)) continue;
      const opt = document.createElement("option");
      opt.value = item.key;
      opt.textContent = `${item.name} (${item.type === "auto" ? t("auto", "Auto") : t("manual", "Manual")})`;
      sel.appendChild(opt);
    }
  }
}

async function grantBadge() {
  const sel = byId("adminUsersEditBadgeSelect");
  const badgeKey = sel?.value;
  if (!badgeKey || !state.currentUser) return;
  try {
    const res = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/badges`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badge_key: badgeKey }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || t("badge_grant_error", "Failed to grant badge."));
    state.editBadges = Array.isArray(data.data?.badges) ? data.data.badges : state.editBadges;
    renderBadgePool();
    window.AdminApp?.toast?.success?.(t("badge_granted", "Badge granted."));
  } catch (err) {
    window.AdminApp?.toast?.error?.(err?.message || t("badge_grant_error", "Failed to grant badge."));
  }
}

async function revokeBadge(badgeKey) {
  if (!state.currentUser) return;
  try {
    const res = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/badges/${encodeURIComponent(badgeKey)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || t("badge_revoke_error", "Failed to revoke badge."));
    state.editBadges = Array.isArray(data.data?.badges) ? data.data.badges : state.editBadges;
    renderBadgePool();
    window.AdminApp?.toast?.success?.(t("badge_revoked", "Badge revoked."));
  } catch (err) {
    window.AdminApp?.toast?.error?.(err?.message || t("badge_revoke_error", "Failed to revoke badge."));
  }
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

async function openActionConfirm(message, approveLabel = null) {
  const msg = byId("adminUsersActionConfirmMessage");
  const approve = byId("adminUsersActionConfirmApprove");
  if (msg) msg.textContent = message;
  if (approve) approve.textContent = approveLabel || t("execute", "Confirm");
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

function renderTable() {
  const tbody = byId("adminUsersTableBody");
  const summary = byId("adminUsersSummary");
  const pageInfo = byId("adminUsersPageInfo");
  const prev = byId("adminUsersPrevPage");
  const next = byId("adminUsersNextPage");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!Array.isArray(state.items) || state.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="admin-users-table__empty">${escapeHtml(t("empty", "No users found."))}</td></tr>`;
  } else {
    for (const item of state.items) {
      const tr = document.createElement("tr");
      const avatar = item.avatar_url
        ? `<img src="${escapeHtml(item.avatar_url)}" alt="${escapeHtml(item.display_name || item.user_key || t("user", "user"))}">`
        : `<span>${escapeHtml((item.display_name || item.user_key || "?").slice(0, 1).toUpperCase())}</span>`;
      const providers = Array.isArray(item.auth_providers) && item.auth_providers.length > 0 ? item.auth_providers.join(", ") : "-";
      const twoFactorText = item.two_factor?.is_enabled ? `${item.two_factor.method || "email"} / ON` : "OFF";
      const accountStatus = String(item.account_status || item.status || "active").toLowerCase();
      const loginStatus = String(item.login_status || "logged_out").toLowerCase();
      const screenStatus = String(item.screen_status || "hidden").toLowerCase();
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
        <td>${escapeHtml(item.primary_email || t("unregistered", "Not registered"))}</td>
        <td>${buildPill(item.role || "-", item.role === "admin" ? "admin-users-pill--admin" : "admin-users-pill--user")}</td>
        <td>${buildPill(accountStatusLabel(accountStatus), `admin-users-pill--${escapeHtml(accountStatus || "active")}`)}</td>
        <td>${buildPill(loginStatusLabel(loginStatus), loginStatus === "logged_in" ? "admin-users-pill--logged-in" : "admin-users-pill--logged-out")}</td>
        <td>${buildPill(screenStatusLabel(screenStatus), screenStatus === "visible" ? "admin-users-pill--visible" : "admin-users-pill--hidden")}</td>
        <td>${escapeHtml(twoFactorText)}</td>
        <td>${item.upload_enabled ? t("allow", "Allowed") : t("deny", "Denied")}</td>
        <td>${escapeHtml(formatDateTime(item.last_access_at || item.last_seen_at))}</td>
        <td>
          <div class="admin-users-actions">
            <button type="button" class="app-button app-button--ghost admin-users-mini-button" data-action="edit" data-user-id="${item.user_id}">${escapeHtml(t("edit", "Edit"))}</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  if (summary) summary.textContent = t("total_count", "Total {count}", { count: state.total });
  if (pageInfo) pageInfo.textContent = `${state.page} / ${state.pages}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}


async function loadUsers() {
  const app = window.AdminApp;
  const tbody = byId("adminUsersTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10" class="admin-users-table__empty">${escapeHtml(t("loading", "Loading..."))}</td></tr>`;
  }
  try {
    const payload = await app.api.get(`/api/admin/users?${qs()}`);
    state.total = Number(payload.data?.total || 0);
    state.pages = Number(payload.data?.pages || 1);
    state.page = Number(payload.data?.page || state.page);
    state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
    renderTable();
  } catch (error) {
    const message = error?.message || t("load_error", "Failed to load users.");
    window.AdminApp?.toast?.error?.(message);
    state.items = [];
    state.total = 0;
    state.pages = 1;
    renderTable();
    const tbody = byId("adminUsersTableBody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="10" class="admin-users-table__empty">${escapeHtml(message)}</td></tr>`;
    }
  }
}

async function openEditModal(userId) {
  try {
    const [detailPayload, badgePayload] = await Promise.all([
      window.AdminApp.api.get(`/api/admin/users/${userId}`),
      window.AdminApp.api.get(`/api/admin/users/${userId}/badges`).catch(() => null),
    ]);
    const user = detailPayload.data?.user;
    if (!user) throw new Error(t("not_found", "User not found."));
    state.currentUser = user;
    state.editOriginal = {
      display_name: user.display_name || "",
      user_key: user.user_key || "",
      role: user.role || "user",
      status: user.status || "active",
      upload_enabled: Boolean(user.upload_enabled),
      bio: user.bio || "",
    };
    state.editLinks = Array.isArray(user.links) ? user.links.map((l) => ({ url: l.url || "" })) : [];
    state.editBadges = Array.isArray(badgePayload?.data?.badges) ? badgePayload.data.badges : (Array.isArray(user.badges) ? user.badges : []);
    state.badgeCatalog = Array.isArray(badgePayload?.data?.catalog) ? badgePayload.data.catalog : [];

    byId("adminUsersEditDisplayName").value = state.editOriginal.display_name;
    byId("adminUsersEditUserKey").value = state.editOriginal.user_key;
    byId("adminUsersEditRole").value = state.editOriginal.role;
    byId("adminUsersEditStatus").value = state.editOriginal.status;
    byId("adminUsersEditUploadEnabled").checked = state.editOriginal.upload_enabled;
    const bioEl = byId("adminUsersEditBio");
    if (bioEl) bioEl.value = state.editOriginal.bio;
    byId("adminUsersEditEmail").textContent = user.primary_email || t("unregistered", "Not registered");
    byId("adminUsersEditCreatedAt").textContent = formatDateTime(user.created_at);
    byId("adminUsersEditLastSeenAt").textContent = formatDateTime(user.last_seen_at);
    byId("adminUsersEditTwoFactor").textContent = user.two_factor?.is_enabled ? `${user.two_factor?.method || "email"} / ON` : "OFF";

    renderLinksEditor();
    renderBadgePool();

    state.editDirty = false;
    window.AdminApp.dirtyGuard.setDirty("admin-users-edit", false);
    window.AdminApp.modal.open("admin-users-edit");
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || t("detail_load_error", "Failed to load user details."));
  }
}

async function saveEdit() {
  if (!state.currentUser) return;
  const currentBio = byId("adminUsersEditBio")?.value || "";
  const profilePayload = {
    display_name: byId("adminUsersEditDisplayName")?.value || "",
    user_key: byId("adminUsersEditUserKey")?.value || "",
    role: byId("adminUsersEditRole")?.value || "user",
    status: byId("adminUsersEditStatus")?.value || "active",
    upload_enabled: Boolean(byId("adminUsersEditUploadEnabled")?.checked),
    bio: currentBio,
  };
  const linksChanged = JSON.stringify(state.editLinks.map((l) => l.url)) !==
    JSON.stringify((state.editOriginal._links || []).map((l) => l.url));
  const hasProfileChanges = (
    profilePayload.display_name !== state.editOriginal.display_name ||
    profilePayload.user_key !== state.editOriginal.user_key ||
    profilePayload.role !== state.editOriginal.role ||
    profilePayload.status !== state.editOriginal.status ||
    profilePayload.upload_enabled !== state.editOriginal.upload_enabled ||
    profilePayload.bio !== state.editOriginal.bio
  );
  if (!hasProfileChanges && !linksChanged) {
    closeEditModal();
    return;
  }
  const ok = await openActionConfirm(t("update_confirm", "Update this user?"), t("update", "Update"));
  if (!ok) return;
  try {
    const tasks = [];
    if (hasProfileChanges) {
      tasks.push(
        fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profilePayload),
        }).then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.ok) throw new Error(d?.error?.message || t("profile_update_error", "Failed to update profile."));
          return d;
        })
      );
    }
    if (linksChanged) {
      const validLinks = state.editLinks.filter((l) => l.url.trim());
      tasks.push(
        fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/links`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ links: validLinks }),
        }).then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.ok) throw new Error(d?.error?.message || t("links_update_error", "Failed to update links."));
          return d;
        })
      );
    }
    await Promise.all(tasks);
    window.AdminApp?.toast?.success?.(t("updated", "Updated."));
    closeEditModal();
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || t("update_error", "Failed to update user."));
  }
}

async function deleteCurrentUser() {
  if (!state.currentUser) return;
  const ok = await openActionConfirm(t("delete_confirm", "Delete “{name}”?", { name: state.currentUser.display_name || state.currentUser.user_key }), t("delete_label", "Delete"));
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
      throw new Error(data?.error?.message || t("delete_error", "Failed to delete user."));
    }
    window.AdminApp?.toast?.success?.(data?.message || t("deleted_ok", "Deleted."));
    closeEditModal();
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || t("delete_error", "Failed to delete user."));
  }
}

async function createTempUser() {
  const payload = {
    display_name: byId("adminUsersCreateDisplayName")?.value || "",
    role: byId("adminUsersCreateRole")?.value || "user",
    upload_enabled: Boolean(byId("adminUsersCreateUploadEnabled")?.checked),
  };
  const ok = await openActionConfirm(t("create_confirm", "Create a temporary user?"), t("create_label", "Create"));
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
      throw new Error(data?.error?.message || t("create_error", "Failed to create temporary user."));
    }
    const creds = data?.data?.temporary_credentials || {};
    byId("adminUsersCreateResultUserKey").textContent = creds.user_key || "-";
    byId("adminUsersCreateResultPassword").textContent = creds.password || "-";
    const result = byId("adminUsersCreateResult");
    if (result) result.hidden = false;
    window.AdminApp?.toast?.success?.(data?.message || t("created_ok", "Temporary user created."));
    state.createDirty = false;
    window.AdminApp?.dirtyGuard?.setDirty?.("admin-users-create", false);
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || t("create_error", "Failed to create temporary user."));
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
}

function bindModals() {
  byId("adminUsersCreateButton")?.addEventListener("click", () => {
    resetCreateForm();
    window.AdminApp.modal.open("admin-users-create");
  });

  byId("adminUsersCreateCloseButton")?.addEventListener("click", async () => {
    const ok = await window.AdminApp.dirtyGuard.confirmIfNeeded(t("close_create_confirm", "There is unsaved input. Close anyway?"));
    if (!ok) return;
    closeCreateModal();
  });

  byId("adminUsersCreateSubmitButton")?.addEventListener("click", createTempUser);
  byId("adminUsersEditCloseButton")?.addEventListener("click", async () => {
    const ok = await window.AdminApp.dirtyGuard.confirmIfNeeded(t("close_edit_confirm", "There are unsaved changes. Close anyway?"));
    if (!ok) return;
    closeEditModal();
  });
  byId("adminUsersEditSaveButton")?.addEventListener("click", saveEdit);
  byId("adminUsersDeleteButton")?.addEventListener("click", deleteCurrentUser);
  byId("adminUsersActionConfirmApprove")?.addEventListener("click", () => closeActionConfirm(true));
  byId("adminUsersActionConfirmCancel")?.addEventListener("click", () => closeActionConfirm(false));

  byId("adminUsersEditLinkAddButton")?.addEventListener("click", () => {
    if (state.editLinks.length >= 5) return;
    state.editLinks.push({ url: "" });
    renderLinksEditor();
    setEditDirty();
  });

  byId("adminUsersEditBadgeGrantButton")?.addEventListener("click", grantBadge);

  [
    "adminUsersEditDisplayName",
    "adminUsersEditUserKey",
    "adminUsersEditRole",
    "adminUsersEditStatus",
    "adminUsersEditUploadEnabled",
    "adminUsersEditBio",
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
  defineMessages();
  initPage();
  window.addEventListener("gallery:language-changed", () => {
    renderTable();
    if (state.currentUser) {
      renderLinksEditor();
      renderBadgePool();
    }
  });
});
