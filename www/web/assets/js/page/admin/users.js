import { escapeHtml } from "../../core/dom.js";
import { resolveBadgeText } from "../../core/badge-i18n.js";
import { resolveLocalizedMessage } from "../../core/i18n.js";
import { languageToLocaleTag } from "../../core/settings.js";

function byId(id) {
  return document.getElementById(id);
}

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_users.${key}`, fallback, vars) || fallback;
}

function badgeText(badge, field = "name") {
  return resolveBadgeText(window.AdminApp?.i18n, badge, field);
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(languageToLocaleTag(document.documentElement.lang || "en-us"));
}

function buildPill(text, mod) {
  return `<span class="admin-users-pill ${mod}">${escapeHtml(text)}</span>`;
}

function roleLabel(role) {
  return role === "admin"
    ? t("admin", "Administrator")
    : t("user", "User");
}

function twoFactorMethodLabel(method) {
  return method === "totp"
    ? t("twofactor_method_totp", "Authenticator app")
    : t("twofactor_method_email", "Email");
}

function twoFactorStatusLabel(twoFactor) {
  if (!twoFactor?.is_enabled) {
    return t("twofactor_off", "Off");
  }
  return t("twofactor_on", "{method} / On", {
    method: twoFactorMethodLabel(twoFactor.method || "email"),
  });
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
      Boolean(byId("adminUsersEditHiddenFromSearch")?.checked) !== Boolean(!original.is_hidden_from_search) ||
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
    span.innerHTML = `${escapeHtml(badgeText(badge, "name"))}<button type="button" class="admin-badge__revoke" data-badge-key="${escapeHtml(badge.key)}" aria-label="${escapeHtml(t("revoke", "Revoke"))}">×</button>`;
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
      opt.textContent = `${badgeText(item, "name")} (${item.type === "auto" ? t("auto", "Auto") : t("manual", "Manual")})`;
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
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(err, t("badge_grant_error", "Failed to grant badge.")));
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
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(err, t("badge_revoke_error", "Failed to revoke badge.")));
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
    const message = resolveLocalizedMessage(error, t("load_error", "Failed to load users."));
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
      is_hidden_from_search: Boolean(user.is_hidden_from_search),
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
    const hiddenFromSearchEl = byId("adminUsersEditHiddenFromSearch");
    if (hiddenFromSearchEl) hiddenFromSearchEl.checked = !state.editOriginal.is_hidden_from_search;
    const bioEl = byId("adminUsersEditBio");
    if (bioEl) bioEl.value = state.editOriginal.bio;
    byId("adminUsersEditEmail").textContent = user.primary_email || t("unregistered", "Not registered");
    byId("adminUsersEditCreatedAt").textContent = formatDateTime(user.created_at);
    byId("adminUsersEditLastSeenAt").textContent = formatDateTime(user.last_seen_at);
    byId("adminUsersEditTwoFactor").textContent = twoFactorStatusLabel(user.two_factor);

    renderLinksEditor();
    renderBadgePool();

    state.editDirty = false;
    window.AdminApp.dirtyGuard.setDirty("admin-users-edit", false);
    window.AdminApp.modal.open("admin-users-edit");
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, t("detail_load_error", "Failed to load user details.")));
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
    is_hidden_from_search: !Boolean(byId("adminUsersEditHiddenFromSearch")?.checked),
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
    profilePayload.is_hidden_from_search !== state.editOriginal.is_hidden_from_search ||
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
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, t("update_error", "Failed to update user.")));
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
    window.AdminApp?.toast?.success?.(resolveLocalizedMessage(data?.message, t("deleted_ok", "Deleted.")));
    closeEditModal();
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, t("delete_error", "Failed to delete user.")));
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
    window.AdminApp?.toast?.success?.(resolveLocalizedMessage(data?.message, t("created_ok", "Temporary user created.")));
    state.createDirty = false;
    window.AdminApp?.dirtyGuard?.setDirty?.("admin-users-create", false);
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, t("create_error", "Failed to create temporary user.")));
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
    "adminUsersEditHiddenFromSearch",
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
  const labels = document.querySelectorAll(".admin-users-toolbar .admin-form-label");
  if (labels[0]) labels[0].textContent = t("search", "Search");
  if (labels[1]) labels[1].textContent = t("role", "Role");
  if (labels[2]) labels[2].textContent = t("status", "Status");
  if (labels[3]) labels[3].textContent = t("sort", "Sort");
  const search = byId("adminUsersSearch");
  if (search) search.placeholder = t("search_placeholder", "Search display name / ID / email");
  const role = byId("adminUsersRoleFilter");
  const status = byId("adminUsersStatusFilter");
  const sort = byId("adminUsersSort");
  if (role?.options[0]) role.options[0].text = t("all", "All");
  if (status?.options[0]) status.options[0].text = t("all", "All");
  if (sort?.options[0]) sort.options[0].text = t("created_desc", "Newest");
  if (sort?.options[1]) sort.options[1].text = t("created_asc", "Oldest");
  if (sort?.options[2]) sort.options[2].text = t("name_asc", "Name A-Z");
  if (sort?.options[3]) sort.options[3].text = t("name_desc", "Name Z-A");
  if (sort?.options[4]) sort.options[4].text = t("last_seen_desc", "Last Access");
  const panelTitle = document.querySelector(".admin-users-list-head .admin-panel__title");
  if (panelTitle) panelTitle.textContent = t("list_title", "User List");
  const head = document.querySelectorAll(".admin-users-table thead th");
  if (head[0]) head[0].textContent = t("user_col", "User");
  if (head[1]) head[1].textContent = t("mail_col", "Mail");
  if (head[2]) head[2].textContent = t("role", "Role");
  if (head[3]) head[3].textContent = t("account_col", "Account");
  if (head[4]) head[4].textContent = t("login_col", "Login");
  if (head[5]) head[5].textContent = t("screen_col", "Screen");
  if (head[7]) head[7].textContent = t("post_col", "Upload");
  if (head[8]) head[8].textContent = t("last_access_col", "Last Access");
  if (head[9]) head[9].textContent = t("action_col", "Action");
  const reload = byId("adminUsersReloadButton");
  if (reload) reload.textContent = t("reload", "Reload");
  const create = byId("adminUsersCreateButton");
  if (create) create.textContent = t("create_temp", "Create Temp User");
  const prev = byId("adminUsersPrevPage");
  if (prev) prev.textContent = t("prev", "Prev");
  const next = byId("adminUsersNextPage");
  if (next) next.textContent = t("next", "Next");
  initPage();
  window.addEventListener("gallery:language-changed", () => {
    const labels = document.querySelectorAll(".admin-users-toolbar .admin-form-label");
    if (labels[0]) labels[0].textContent = t("search", "Search");
    if (labels[1]) labels[1].textContent = t("role", "Role");
    if (labels[2]) labels[2].textContent = t("status", "Status");
    if (labels[3]) labels[3].textContent = t("sort", "Sort");
    if (search) search.placeholder = t("search_placeholder", "Search display name / ID / email");
    if (role?.options[0]) role.options[0].text = t("all", "All");
    if (status?.options[0]) status.options[0].text = t("all", "All");
    if (sort?.options[0]) sort.options[0].text = t("created_desc", "Newest");
    if (sort?.options[1]) sort.options[1].text = t("created_asc", "Oldest");
    if (sort?.options[2]) sort.options[2].text = t("name_asc", "Name A-Z");
    if (sort?.options[3]) sort.options[3].text = t("name_desc", "Name Z-A");
    if (sort?.options[4]) sort.options[4].text = t("last_seen_desc", "Last Access");
    if (panelTitle) panelTitle.textContent = t("list_title", "User List");
    if (head[0]) head[0].textContent = t("user_col", "User");
    if (head[1]) head[1].textContent = t("mail_col", "Mail");
    if (head[2]) head[2].textContent = t("role", "Role");
    if (head[3]) head[3].textContent = t("account_col", "Account");
    if (head[4]) head[4].textContent = t("login_col", "Login");
    if (head[5]) head[5].textContent = t("screen_col", "Screen");
    if (head[7]) head[7].textContent = t("post_col", "Upload");
    if (head[8]) head[8].textContent = t("last_access_col", "Last Access");
    if (head[9]) head[9].textContent = t("action_col", "Action");
    if (reload) reload.textContent = t("reload", "Reload");
    if (create) create.textContent = t("create_temp", "Create Temp User");
    if (prev) prev.textContent = t("prev", "Prev");
    if (next) next.textContent = t("next", "Next");
    const editRole = byId("adminUsersEditRole");
    if (editRole?.options[0]) editRole.options[0].text = roleLabel("admin");
    if (editRole?.options[1]) editRole.options[1].text = roleLabel("user");
    const createRole = byId("adminUsersCreateRole");
    if (createRole?.options[0]) createRole.options[0].text = roleLabel("user");
    if (createRole?.options[1]) createRole.options[1].text = roleLabel("admin");
    renderTable();
    if (state.currentUser) {
      const twoFactor = byId("adminUsersEditTwoFactor");
      if (twoFactor) twoFactor.textContent = twoFactorStatusLabel(state.currentUser.two_factor);
      renderLinksEditor();
      renderBadgePool();
    }
  });
});
