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
  return `<span class="admin-users-pill ${mod}">${escapeHtml(text)}</span>`;
}

function accountStatusLabel(value) {
  switch (String(value || "").toLowerCase()) {
    case "active":
      return "利用可";
    case "locked":
      return "ロック";
    case "disabled":
      return "停止";
    case "deleted":
      return "削除";
    default:
      return String(value || "-");
  }
}

function loginStatusLabel(value) {
  return String(value || "") === "logged_in" ? "ログイン中" : "未ログイン";
}

function screenStatusLabel(value) {
  return String(value || "") === "visible" ? "表示中" : "非表示";
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
      <button type="button" class="app-button app-button--ghost admin-users-modal__link-remove" data-link-idx="${idx}" aria-label="削除">×</button>
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
    pool.innerHTML = `<span class="admin-users-modal__badge-empty">バッジなし</span>`;
  }
  for (const badge of state.editBadges) {
    const colorClass = BADGE_COLOR_CLASS[badge.color] || "admin-badge--gray";
    const span = document.createElement("span");
    span.className = `admin-badge ${colorClass}`;
    span.innerHTML = `${escapeHtml(badge.name)}<button type="button" class="admin-badge__revoke" data-badge-key="${escapeHtml(badge.key)}" aria-label="剥奪">×</button>`;
    pool.appendChild(span);
  }
  pool.querySelectorAll(".admin-badge__revoke").forEach((btn) => {
    btn.addEventListener("click", () => revokeBadge(btn.dataset.badgeKey));
  });
  // Update select options: exclude already-owned keys
  if (sel) {
    const ownedKeys = new Set(state.editBadges.map((b) => b.key));
    sel.innerHTML = `<option value="">バッジを選択...</option>`;
    for (const item of state.badgeCatalog) {
      if (ownedKeys.has(item.key)) continue;
      const opt = document.createElement("option");
      opt.value = item.key;
      opt.textContent = `${item.name}（${item.type === "auto" ? "自動" : "手動"}）`;
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
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || "バッジ付与に失敗しました。");
    state.editBadges = Array.isArray(data.data?.badges) ? data.data.badges : state.editBadges;
    renderBadgePool();
    window.AdminApp?.toast?.success?.("バッジを付与しました。");
  } catch (err) {
    window.AdminApp?.toast?.error?.(err?.message || "バッジ付与に失敗しました。");
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
    if (!res.ok || !data.ok) throw new Error(data?.error?.message || "バッジ剥奪に失敗しました。");
    state.editBadges = Array.isArray(data.data?.badges) ? data.data.badges : state.editBadges;
    renderBadgePool();
    window.AdminApp?.toast?.success?.("バッジを剥奪しました。");
  } catch (err) {
    window.AdminApp?.toast?.error?.(err?.message || "バッジ剥奪に失敗しました。");
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
        <td>${escapeHtml(item.primary_email || "未登録")}</td>
        <td>${buildPill(item.role || "-", item.role === "admin" ? "admin-users-pill--admin" : "admin-users-pill--user")}</td>
        <td>${buildPill(accountStatusLabel(accountStatus), `admin-users-pill--${escapeHtml(accountStatus || "active")}`)}</td>
        <td>${buildPill(loginStatusLabel(loginStatus), loginStatus === "logged_in" ? "admin-users-pill--logged-in" : "admin-users-pill--logged-out")}</td>
        <td>${buildPill(screenStatusLabel(screenStatus), screenStatus === "visible" ? "admin-users-pill--visible" : "admin-users-pill--hidden")}</td>
        <td>${escapeHtml(twoFactorText)}</td>
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
}


async function loadUsers() {
  const app = window.AdminApp;
  const tbody = byId("adminUsersTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10" class="admin-users-table__empty">読み込み中です。</td></tr>`;
  }
  try {
    const payload = await app.api.get(`/api/admin/users?${qs()}`);
    state.total = Number(payload.data?.total || 0);
    state.pages = Number(payload.data?.pages || 1);
    state.page = Number(payload.data?.page || state.page);
    state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
    renderTable();
  } catch (error) {
    const message = error?.message || "ユーザー一覧の取得に失敗しました。";
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
    if (!user) throw new Error("対象ユーザーが見つかりません。");
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
    byId("adminUsersEditEmail").textContent = user.primary_email || "未登録";
    byId("adminUsersEditCreatedAt").textContent = formatDateTime(user.created_at);
    byId("adminUsersEditLastSeenAt").textContent = formatDateTime(user.last_seen_at);
    byId("adminUsersEditTwoFactor").textContent = user.two_factor?.is_enabled ? `${user.two_factor?.method || "email"} / ON` : "OFF";

    renderLinksEditor();
    renderBadgePool();

    state.editDirty = false;
    window.AdminApp.dirtyGuard.setDirty("admin-users-edit", false);
    window.AdminApp.modal.open("admin-users-edit");
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "ユーザー詳細の取得に失敗しました。");
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
  const ok = await openActionConfirm("ユーザー情報を更新しますか？", "更新");
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
          if (!r.ok || !d.ok) throw new Error(d?.error?.message || "プロフィール更新に失敗しました。");
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
          if (!r.ok || !d.ok) throw new Error(d?.error?.message || "リンク更新に失敗しました。");
          return d;
        })
      );
    }
    await Promise.all(tasks);
    window.AdminApp?.toast?.success?.("更新しました。");
    closeEditModal();
    await loadUsers();
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
    await loadUsers();
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
    await loadUsers();
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
  initPage();
});
