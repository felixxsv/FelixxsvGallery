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

function formatDateTimeLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function normalizeDateTimeLocalValue(value) {
  const text = String(value || "").trim();
  return text || null;
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

function supportStatusLabel(value) {
  switch (String(value || "")) {
    case "active":
      return window.AdminApp?.i18n?.t?.("support.status.active", "支援中") || "支援中";
    case "cancelScheduled":
      return window.AdminApp?.i18n?.t?.("support.status.cancelScheduled", "停止予定") || "停止予定";
    case "giftActive":
      return window.AdminApp?.i18n?.t?.("support.status.giftActive", "ギフト中") || "ギフト中";
    case "permanentActive":
      return window.AdminApp?.i18n?.t?.("support.status.permanentActive", "永久無料") || "永久無料";
    case "scheduled":
      return window.AdminApp?.i18n?.t?.("support.status.scheduled", "課金予約あり") || "課金予約あり";
    case "past_due":
      return window.AdminApp?.i18n?.t?.("support.admin.statusPastDue", "支払失敗") || "支払失敗";
    case "unpaid":
      return window.AdminApp?.i18n?.t?.("support.admin.statusUnpaid", "未払い") || "未払い";
    case "expired":
      return window.AdminApp?.i18n?.t?.("support.status.expired", "支援終了") || "支援終了";
    default:
      return window.AdminApp?.i18n?.t?.("support.status.inactive", "未支援") || "未支援";
  }
}

function supportSourceLabel(value) {
  switch (String(value || "")) {
    case "paid_subscription":
      return window.AdminApp?.i18n?.t?.("support.admin.sourcePaid", "課金") || "課金";
    case "admin_gift":
      return window.AdminApp?.i18n?.t?.("support.admin.sourceGift", "ギフト") || "ギフト";
    case "admin_permanent":
      return window.AdminApp?.i18n?.t?.("support.admin.sourcePermanent", "永久無料") || "永久無料";
    case "mixed":
      return window.AdminApp?.i18n?.t?.("support.admin.sourceMixed", "併用") || "併用";
    default:
      return "-";
  }
}

function supportEventStatusLabel(value) {
  switch (String(value || "").toLowerCase()) {
    case "received":
      return window.AdminApp?.i18n?.t?.("support.admin.eventStatusReceived", "受信") || "受信";
    case "processed":
      return window.AdminApp?.i18n?.t?.("support.admin.eventStatusProcessed", "処理済み") || "処理済み";
    case "failed":
      return window.AdminApp?.i18n?.t?.("support.admin.eventStatusFailed", "処理失敗") || "処理失敗";
    case "ignored":
      return window.AdminApp?.i18n?.t?.("support.admin.eventStatusIgnored", "無視") || "無視";
    default:
      return String(value || "-");
  }
}

function supportMismatchLabel(value) {
  switch (String(value || "").toLowerCase()) {
    case "reflection_missing":
      return window.AdminApp?.i18n?.t?.("support.admin.mismatchReflectionMissing", "決済済み未反映") || "決済済み未反映";
    case "reflection_unexpected":
      return window.AdminApp?.i18n?.t?.("support.admin.mismatchReflectionUnexpected", "未決済で反映") || "未決済で反映";
    case "webhook_signature":
      return window.AdminApp?.i18n?.t?.("support.admin.mismatchWebhookSignature", "署名検証失敗") || "署名検証失敗";
    case "provider_state":
      return window.AdminApp?.i18n?.t?.("support.admin.mismatchProviderState", "外部状態不一致") || "外部状態不一致";
    case "billing_schedule":
      return window.AdminApp?.i18n?.t?.("support.admin.mismatchBillingSchedule", "請求日不整合") || "請求日不整合";
    default:
      return value ? String(value) : "-";
  }
}

const BADGE_COLOR_CLASS = {
  blue: "admin-badge--blue",
  red: "admin-badge--red",
  green: "admin-badge--green",
  gold: "admin-badge--gold",
  gray: "admin-badge--gray",
};
const REMOVED_BADGE_KEYS = new Set(["star"]);

function isActiveBadge(badge) {
  return badge?.key && !REMOVED_BADGE_KEYS.has(String(badge.key));
}

const state = {
  page: 1,
  perPage: 20,
  q: "",
  role: "",
  status: "",
  supportStatus: "",
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
  if (state.supportStatus) params.set("support_status", state.supportStatus);
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
  const activeBadges = state.editBadges.filter(isActiveBadge);
  if (!activeBadges.length) {
    pool.innerHTML = `<span class="admin-users-modal__badge-empty">${escapeHtml(t("no_badges", "No badges"))}</span>`;
  }
  for (const badge of activeBadges) {
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
    const ownedKeys = new Set(activeBadges.map((b) => b.key));
    sel.innerHTML = `<option value="">${escapeHtml(t("select_badge", "Select a badge..."))}</option>`;
    for (const item of state.badgeCatalog.filter(isActiveBadge)) {
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
    state.editBadges = Array.isArray(data.data?.badges) ? data.data.badges.filter(isActiveBadge) : state.editBadges;
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
    state.editBadges = Array.isArray(data.data?.badges) ? data.data.badges.filter(isActiveBadge) : state.editBadges;
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
    tbody.innerHTML = `<tr><td colspan="11" class="admin-users-table__empty">${escapeHtml(t("empty", "No users found."))}</td></tr>`;
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
      const supportCode = item.support?.status?.code || "inactive";
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
        <td>${buildPill(supportStatusLabel(supportCode), `admin-users-pill--support-${escapeHtml(supportCode)}`)}</td>
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
    tbody.innerHTML = `<tr><td colspan="11" class="admin-users-table__empty">${escapeHtml(t("loading", "Loading..."))}</td></tr>`;
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
      tbody.innerHTML = `<tr><td colspan="11" class="admin-users-table__empty">${escapeHtml(message)}</td></tr>`;
    }
  }
}

function renderSupportLists(support) {
  const status = support?.status || {};
  const settings = support?.settings || {};
  const grants = Array.isArray(support?.grants) ? support.grants : [];
  const events = Array.isArray(support?.events) ? support.events : [];
  byId("adminUsersSupportStatus").textContent = supportStatusLabel(status.code);
  byId("adminUsersSupportSource").textContent = supportSourceLabel(status.source_type);
  byId("adminUsersSupportNextBilling").textContent = formatDateTime(status.next_billing_at || status.current_period_end || status.gift_ends_at);
  byId("adminUsersSupportFirstBilling").textContent = formatDateTime(status.first_billing_at);
  const highest = support?.achievement_summary?.highest_code;
  byId("adminUsersSupportAchievement").textContent = highest
    ? `${window.AdminApp?.i18n?.t?.(`support.achievements.${highest}`, highest.toUpperCase()) || highest.toUpperCase()} / ${support?.achievement_summary?.total_months || 0}M`
    : `${support?.achievement_summary?.total_months || 0}M`;
  byId("adminUsersSupportVisibility").textContent = [
    settings.supporter_visible ? "S" : "-",
    settings.supporter_badge_visible ? "B" : "-",
    settings.supporter_duration_badge_visible ? "D" : "-",
    settings.supporter_icon_frame_visible ? "I" : "-",
    settings.supporter_profile_decor_visible ? "P" : "-",
  ].join(" ");
  const permanentRevoke = byId("adminUsersSupportPermanentRevokeButton");
  if (permanentRevoke) {
    permanentRevoke.disabled = !grants.some((item) => item.is_permanent && item.is_active && !item.revoked_at);
  }
  const subscription = support?.subscription || {};
  const subscriptionStatus = byId("adminUsersSupportSubscriptionStatus");
  const periodStart = byId("adminUsersSupportSubscriptionPeriodStart");
  const periodEnd = byId("adminUsersSupportSubscriptionPeriodEnd");
  const firstBilling = byId("adminUsersSupportSubscriptionFirstBilling");
  const scheduledStart = byId("adminUsersSupportSubscriptionScheduledStart");
  const creditedMonths = byId("adminUsersSupportSubscriptionCreditedMonths");
  if (subscriptionStatus) subscriptionStatus.value = String(subscription.status || "inactive").toLowerCase();
  if (periodStart) periodStart.value = formatDateTimeLocalInput(subscription.current_period_start || subscription.started_at);
  if (periodEnd) periodEnd.value = formatDateTimeLocalInput(subscription.current_period_end);
  if (firstBilling) firstBilling.value = formatDateTimeLocalInput(subscription.first_billing_at);
  if (scheduledStart) scheduledStart.value = formatDateTimeLocalInput(subscription.scheduled_start_at);
  if (creditedMonths) creditedMonths.value = String(Number(subscription.credited_months || 0));
  const eventProvider = byId("adminUsersSupportEventProvider");
  const eventType = byId("adminUsersSupportEventType");
  const eventStatus = byId("adminUsersSupportEventStatus");
  const eventMismatch = byId("adminUsersSupportEventMismatchType");
  const eventId = byId("adminUsersSupportEventId");
  const eventError = byId("adminUsersSupportEventError");
  if (eventProvider) eventProvider.value = "stripe";
  if (eventType) eventType.value = "";
  if (eventStatus) eventStatus.value = "received";
  if (eventMismatch) eventMismatch.value = "";
  if (eventId) eventId.value = "";
  if (eventError) eventError.value = "";

  const grantList = byId("adminUsersSupportGrantList");
  if (grantList) {
    if (!grants.length) {
      grantList.innerHTML = `<div class="admin-users-support-log__empty">-</div>`;
    } else {
      grantList.innerHTML = grants.map((grant) => `
        <div class="admin-users-support-log__item">
          <div class="admin-users-support-log__meta">${escapeHtml(supportSourceLabel(grant.source_type))} / ${grant.is_permanent ? escapeHtml(window.AdminApp?.i18n?.t?.("support.status.permanentActive", "永久無料") || "永久無料") : `${escapeHtml(String(grant.months || 0))}M`}</div>
          <div class="admin-users-support-log__sub">${escapeHtml(formatDateTime(grant.starts_at))} - ${escapeHtml(formatDateTime(grant.ends_at))}</div>
          <div class="admin-users-support-log__sub">${escapeHtml(grant.reason || "-")}</div>
          ${grant.revoked_at ? `<div class="admin-users-support-log__sub">${escapeHtml(formatDateTime(grant.revoked_at))} / ${escapeHtml(grant.revoke_reason || "-")}</div>` : `<button type="button" class="app-button app-button--ghost admin-users-mini-button" data-support-revoke-grant="${grant.id}">${escapeHtml(window.AdminApp?.i18n?.t?.("support.gift.stopGrant", "付与を停止") || "付与を停止")}</button>`}
        </div>
      `).join("");
    }
  }

  const eventList = byId("adminUsersSupportEventList");
  if (eventList) {
    if (!events.length) {
      eventList.innerHTML = `<div class="admin-users-support-log__empty">-</div>`;
    } else {
      eventList.innerHTML = events.map((item) => `
        <div class="admin-users-support-log__item">
          <div class="admin-users-support-log__meta">${escapeHtml(item.provider || "-")} / ${escapeHtml(item.event_type || "-")}</div>
          <div class="admin-users-support-log__sub">${escapeHtml(formatDateTime(item.received_at))} / ${escapeHtml(supportEventStatusLabel(item.process_status))}</div>
          <div class="admin-users-support-log__sub">${escapeHtml(item.mismatch_flag ? supportMismatchLabel(item.mismatch_type) : (window.AdminApp?.i18n?.t?.("support.admin.noMismatch", "不整合なし") || "不整合なし"))}</div>
          <div class="admin-users-support-log__sub">${escapeHtml(item.error_summary || "-")}</div>
        </div>
      `).join("");
    }
  }
}

async function saveSupportSubscription() {
  if (!state.currentUser) return;
  const payload = {
    status: byId("adminUsersSupportSubscriptionStatus")?.value || "inactive",
    current_period_start: normalizeDateTimeLocalValue(byId("adminUsersSupportSubscriptionPeriodStart")?.value),
    current_period_end: normalizeDateTimeLocalValue(byId("adminUsersSupportSubscriptionPeriodEnd")?.value),
    first_billing_at: normalizeDateTimeLocalValue(byId("adminUsersSupportSubscriptionFirstBilling")?.value),
    scheduled_start_at: normalizeDateTimeLocalValue(byId("adminUsersSupportSubscriptionScheduledStart")?.value),
    credited_months: Number(byId("adminUsersSupportSubscriptionCreditedMonths")?.value || 0),
  };
  if (payload.status === "inactive") {
    payload.current_period_start = null;
    payload.current_period_end = null;
    payload.first_billing_at = null;
    payload.scheduled_start_at = null;
  }
  const ok = await openActionConfirm(
    window.AdminApp?.i18n?.t?.("support.admin.confirmSaveSubscription", "課金状態を更新しますか？") || "課金状態を更新しますか？",
    window.AdminApp?.i18n?.t?.("support.admin.saveSubscription", "状態を更新") || "状態を更新"
  );
  if (!ok) return;
  try {
    const response = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/support/subscription`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data?.error?.message || "subscription update failed");
    state.currentUser.support = data.data?.support || state.currentUser.support;
    renderSupportLists(state.currentUser.support);
    window.AdminApp?.toast?.success?.(window.AdminApp?.i18n?.t?.("support.admin.savedSubscription", "課金状態を更新しました。") || "課金状態を更新しました。");
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, window.AdminApp?.i18n?.t?.("support.admin.saveSubscriptionFailed", "課金状態の更新に失敗しました。") || "課金状態の更新に失敗しました。"));
  }
}

async function saveSupportEvent() {
  if (!state.currentUser) return;
  const payload = {
    provider: byId("adminUsersSupportEventProvider")?.value || "stripe",
    event_type: byId("adminUsersSupportEventType")?.value || "",
    process_status: byId("adminUsersSupportEventStatus")?.value || "received",
    mismatch_type: byId("adminUsersSupportEventMismatchType")?.value || "",
    provider_event_id: byId("adminUsersSupportEventId")?.value || "",
    error_summary: byId("adminUsersSupportEventError")?.value || "",
  };
  const ok = await openActionConfirm(
    window.AdminApp?.i18n?.t?.("support.admin.confirmSaveEvent", "支援イベントを記録しますか？") || "支援イベントを記録しますか？",
    window.AdminApp?.i18n?.t?.("support.admin.saveEvent", "イベントを記録") || "イベントを記録"
  );
  if (!ok) return;
  try {
    const response = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/support/events`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data?.error?.message || "event record failed");
    state.currentUser.support = data.data?.support || state.currentUser.support;
    renderSupportLists(state.currentUser.support);
    window.AdminApp?.toast?.success?.(window.AdminApp?.i18n?.t?.("support.admin.savedEvent", "支援イベントを記録しました。") || "支援イベントを記録しました。");
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, window.AdminApp?.i18n?.t?.("support.admin.saveEventFailed", "支援イベントの記録に失敗しました。") || "支援イベントの記録に失敗しました。"));
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
    state.editBadges = (Array.isArray(badgePayload?.data?.badges) ? badgePayload.data.badges : (Array.isArray(user.badges) ? user.badges : [])).filter(isActiveBadge);
    state.badgeCatalog = (Array.isArray(badgePayload?.data?.catalog) ? badgePayload.data.catalog : []).filter(isActiveBadge);

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
    const grantPreset = byId("adminUsersSupportGrantPreset");
    const grantMonths = byId("adminUsersSupportGrantMonths");
    const grantReason = byId("adminUsersSupportGrantReason");
    if (grantPreset) grantPreset.value = "1";
    if (grantMonths) {
      grantMonths.value = "1";
      grantMonths.disabled = true;
    }
    if (grantReason) grantReason.value = "";

    renderLinksEditor();
    renderBadgePool();
    renderSupportLists(user.support || {});

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

async function grantSupport() {
  if (!state.currentUser) return;
  const preset = byId("adminUsersSupportGrantPreset")?.value || "1";
  const monthsInput = byId("adminUsersSupportGrantMonths")?.value || "1";
  const reason = byId("adminUsersSupportGrantReason")?.value || "";
  const payload = preset === "permanent"
    ? { grant_type: "permanent", is_permanent: true, reason }
    : { grant_type: "months", months: Number(preset === "custom" ? monthsInput : preset), reason };
  const ok = await openActionConfirm(window.AdminApp?.i18n?.t?.("support.gift.confirmGrant", "支援特典を付与しますか？") || "支援特典を付与しますか？", window.AdminApp?.i18n?.t?.("support.gift.grant", "付与") || "付与");
  if (!ok) return;
  try {
    const response = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/support/grants`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data?.error?.message || "grant failed");
    state.currentUser.support = data.data?.support || state.currentUser.support;
    renderSupportLists(state.currentUser.support);
    window.AdminApp?.toast?.success?.(window.AdminApp?.i18n?.t?.("support.gift.granted", "支援特典を付与しました。") || "支援特典を付与しました。");
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, window.AdminApp?.i18n?.t?.("support.gift.grantFailed", "支援特典の付与に失敗しました。") || "支援特典の付与に失敗しました。"));
  }
}

async function revokeSupportGrant(grantId, revokePermanentOnly = false) {
  if (!state.currentUser || !grantId) return;
  const ok = await openActionConfirm(window.AdminApp?.i18n?.t?.("support.gift.confirmRevoke", "支援付与を停止しますか？") || "支援付与を停止しますか？", window.AdminApp?.i18n?.t?.("support.gift.stopGrant", "付与を停止") || "付与を停止");
  if (!ok) return;
  try {
    const response = await fetch(`${window.AdminApp.appBase}/api/admin/users/${state.currentUser.user_id}/support/grants/${grantId}/revoke`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoke_reason: revokePermanentOnly ? "permanent revoke" : "" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data?.error?.message || "revoke failed");
    state.currentUser.support = data.data?.support || state.currentUser.support;
    renderSupportLists(state.currentUser.support);
    window.AdminApp?.toast?.success?.(window.AdminApp?.i18n?.t?.("support.gift.revoked", "支援付与を停止しました。") || "支援付与を停止しました。");
    await loadUsers();
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, window.AdminApp?.i18n?.t?.("support.gift.revokeFailed", "支援付与の停止に失敗しました。") || "支援付与の停止に失敗しました。"));
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
  const supportStatus = byId("adminUsersSupportStatusFilter");
  const sort = byId("adminUsersSort");
  const reload = byId("adminUsersReloadButton");
  const prev = byId("adminUsersPrevPage");
  const next = byId("adminUsersNextPage");

  function trigger() {
    state.page = 1;
    state.q = search?.value?.trim() || "";
    state.role = role?.value || "";
    state.status = status?.value || "";
    state.supportStatus = supportStatus?.value || "";
    state.sort = sort?.value || "created_desc";
    loadUsers();
  }

  search?.addEventListener("input", () => {
    window.clearTimeout(state.filterTimer);
    state.filterTimer = window.setTimeout(trigger, 250);
  });
  role?.addEventListener("change", trigger);
  status?.addEventListener("change", trigger);
  supportStatus?.addEventListener("change", trigger);
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
  byId("adminUsersSupportSubscriptionSaveButton")?.addEventListener("click", saveSupportSubscription);
  byId("adminUsersSupportEventSaveButton")?.addEventListener("click", saveSupportEvent);
  byId("adminUsersSupportGrantButton")?.addEventListener("click", grantSupport);
  byId("adminUsersSupportGrantPreset")?.addEventListener("change", (event) => {
    const value = event.target.value;
    const months = byId("adminUsersSupportGrantMonths");
    if (!months) return;
    if (value === "custom") {
      months.disabled = false;
      return;
    }
    if (value === "permanent") {
      months.value = "";
      months.disabled = true;
      return;
    }
    months.value = value;
    months.disabled = true;
  });
  byId("adminUsersSupportPermanentRevokeButton")?.addEventListener("click", () => {
    const grants = Array.isArray(state.currentUser?.support?.grants) ? state.currentUser.support.grants : [];
    const target = grants.find((item) => item.is_permanent && !item.revoked_at && item.is_active);
    if (target?.id) revokeSupportGrant(target.id, true);
  });

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

  byId("adminUsersSupportGrantList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-support-revoke-grant]");
    if (!button) return;
    revokeSupportGrant(Number(button.dataset.supportRevokeGrant || 0), false);
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
  if (labels[3]) labels[3].textContent = t("support_status", "Support");
  if (labels[4]) labels[4].textContent = t("sort", "Sort");
  const search = byId("adminUsersSearch");
  if (search) search.placeholder = t("search_placeholder", "Search display name / ID / email");
  const role = byId("adminUsersRoleFilter");
  const status = byId("adminUsersStatusFilter");
  const supportStatus = byId("adminUsersSupportStatusFilter");
  const sort = byId("adminUsersSort");
  if (role?.options[0]) role.options[0].text = t("all", "All");
  if (status?.options[0]) status.options[0].text = t("all", "All");
  if (supportStatus?.options[0]) supportStatus.options[0].text = t("all", "All");
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
  if (head[7]) head[7].textContent = window.AdminApp?.i18n?.t?.("support.common.title", "Support / 支援") || "Support / 支援";
  if (head[8]) head[8].textContent = t("post_col", "Upload");
  if (head[9]) head[9].textContent = t("last_access_col", "Last Access");
  if (head[10]) head[10].textContent = t("action_col", "Action");
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
    if (labels[3]) labels[3].textContent = t("support_status", "Support");
    if (labels[4]) labels[4].textContent = t("sort", "Sort");
    if (search) search.placeholder = t("search_placeholder", "Search display name / ID / email");
    if (role?.options[0]) role.options[0].text = t("all", "All");
    if (status?.options[0]) status.options[0].text = t("all", "All");
    if (supportStatus?.options[0]) supportStatus.options[0].text = t("all", "All");
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
    if (head[7]) head[7].textContent = window.AdminApp?.i18n?.t?.("support.common.title", "Support / 支援") || "Support / 支援";
    if (head[8]) head[8].textContent = t("post_col", "Upload");
    if (head[9]) head[9].textContent = t("last_access_col", "Last Access");
    if (head[10]) head[10].textContent = t("action_col", "Action");
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

// ─────────────────────────────────────────────────────────────────────────────
// Decoration Catalog Admin
// ─────────────────────────────────────────────────────────────────────────────
(function initDecorationCatalog() {
  const api = window.AdminApp?.api;
  if (!api) return;

  const state = { items: [], editId: null, pendingFile: null };
  const LOCALES = ["ja", "en", "de", "es", "fr", "ko", "ru", "zh-cn"];

  function kindLabel(kind) {
    return kind === "icon_frame" ? "アイコンフレーム" : "プロフィール装飾";
  }

  async function loadItems() {
    try {
      const data = await api.get("/api/admin/decorations");
      state.items = (data?.data?.items) || [];
      renderTable();
    } catch (e) {
      const tbody = byId("adminDecorationsTableBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="admin-users-table__empty">取得に失敗しました。</td></tr>`;
    }
  }

  function renderTable() {
    const tbody = byId("adminDecorationsTableBody");
    if (!tbody) return;
    if (!state.items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="admin-users-table__empty">デコレーションはありません。</td></tr>`;
      return;
    }
    tbody.innerHTML = state.items.map((item) => {
      const jaLabel = (item.labels?.ja || item.labels?.en || item.label_key || "-");
      const assetInfo = item.asset_path
        ? `<span style="color:var(--color-success)">✓ ${escapeHtml(item.asset_path.split("/").pop())}</span>`
        : `<span style="color:var(--color-text-muted)">未設定</span>`;
      const activePill = item.is_active
        ? `<span class="admin-users-pill admin-users-pill--active">有効</span>`
        : `<span class="admin-users-pill admin-users-pill--inactive">無効</span>`;
      return `<tr>
        <td>${escapeHtml(kindLabel(item.decoration_kind))}</td>
        <td><code>${escapeHtml(item.decoration_key)}</code></td>
        <td>${escapeHtml(jaLabel)}</td>
        <td>${assetInfo}</td>
        <td>${item.sort_order}</td>
        <td>${activePill}</td>
        <td>
          <button class="app-button app-button--ghost" style="font-size:0.8rem;padding:4px 10px;" data-decoration-edit="${item.id}">編集</button>
          <button class="app-button app-button--ghost" style="font-size:0.8rem;padding:4px 10px;color:var(--color-danger);" data-decoration-delete="${item.id}">削除</button>
        </td>
      </tr>`;
    }).join("");
  }

  function getLabelsFromForm() {
    const labels = {};
    document.querySelectorAll(".admin-decoration-label-input").forEach((el) => {
      const lang = el.dataset.lang;
      const val = el.value.trim();
      if (lang && val) labels[lang] = val;
    });
    return labels;
  }

  function populateForm(item) {
    const kind = byId("adminDecorationKind");
    const key = byId("adminDecorationKey");
    const sortOrder = byId("adminDecorationSortOrder");
    const isActiveSwitch = byId("adminDecorationIsActiveSwitch");
    const keyField = byId("adminDecorationKeyField");
    const currentAsset = byId("adminDecorationCurrentAsset");
    const assetSection = byId("adminDecorationAssetSection");

    if (item) {
      if (kind) kind.value = item.decoration_kind;
      if (key) key.value = item.decoration_key;
      if (keyField) keyField.style.display = "none";
      document.querySelectorAll(".admin-decoration-label-input").forEach((el) => {
        el.value = item.labels?.[el.dataset.lang] || "";
      });
      if (sortOrder) sortOrder.value = item.sort_order;
      if (isActiveSwitch) isActiveSwitch.setAttribute("aria-checked", item.is_active ? "true" : "false");
      if (currentAsset) currentAsset.textContent = item.asset_path || "未設定";
      if (assetSection) assetSection.style.display = "";
    } else {
      if (kind) kind.value = "icon_frame";
      if (key) key.value = "";
      if (keyField) keyField.style.display = "";
      document.querySelectorAll(".admin-decoration-label-input").forEach((el) => { el.value = ""; });
      if (sortOrder) sortOrder.value = "0";
      if (isActiveSwitch) isActiveSwitch.setAttribute("aria-checked", "true");
      if (currentAsset) currentAsset.textContent = "";
      if (assetSection) assetSection.style.display = "";
    }
    state.pendingFile = null;
    const assetName = byId("adminDecorationAssetName");
    if (assetName) assetName.textContent = "";
    const assetPreview = byId("adminDecorationAssetPreview");
    if (assetPreview) assetPreview.style.display = "none";
    const error = byId("adminDecorationEditError");
    if (error) { error.hidden = true; error.textContent = ""; }
  }

  function openModal(item) {
    state.editId = item ? item.id : null;
    const title = byId("adminDecorationEditTitle");
    if (title) title.textContent = item ? "デコレーション編集" : "デコレーション追加";
    populateForm(item || null);
    const modal = byId("adminDecorationEditModal");
    if (modal) modal.hidden = false;
  }

  function closeModal() {
    const modal = byId("adminDecorationEditModal");
    if (modal) modal.hidden = true;
    state.editId = null;
    state.pendingFile = null;
  }

  async function saveDecoration() {
    const error = byId("adminDecorationEditError");
    if (error) { error.hidden = true; error.textContent = ""; }
    const isActive = byId("adminDecorationIsActiveSwitch")?.getAttribute("aria-checked") !== "false";
    const payload = {
      decoration_kind: byId("adminDecorationKind")?.value,
      decoration_key: byId("adminDecorationKey")?.value?.trim(),
      labels: getLabelsFromForm(),
      sort_order: parseInt(byId("adminDecorationSortOrder")?.value || "0", 10),
      is_active: isActive,
      label_key: "",
      preview_class: "",
    };

    try {
      let data;
      if (state.editId) {
        data = await api.put(`/api/admin/decorations/${state.editId}`, payload);
      } else {
        data = await api.post("/api/admin/decorations", payload);
        if (!state.editId && data?.data?.id) {
          state.editId = data.data.id;
        }
      }
      if (state.pendingFile && state.editId) {
        const form = new FormData();
        form.append("file", state.pendingFile);
        data = await api.postForm(`/api/admin/decorations/${state.editId}/asset`, form);
      }
      state.items = data?.data?.items || state.items;
      renderTable();
      closeModal();
    } catch (e) {
      if (error) {
        error.textContent = e?.message || "保存に失敗しました。";
        error.hidden = false;
      }
    }
  }

  async function deleteDecoration(id) {
    if (!confirm("このデコレーションを削除しますか？")) return;
    try {
      const data = await api.delete(`/api/admin/decorations/${id}`);
      state.items = data?.data?.items || state.items;
      renderTable();
    } catch (e) {
      alert("削除に失敗しました。");
    }
  }

  // Wire up events
  byId("adminDecorationsAddButton")?.addEventListener("click", () => openModal(null));

  document.querySelector("[data-modal-backdrop='decoration-edit']")?.addEventListener("click", closeModal);

  byId("adminDecorationSaveButton")?.addEventListener("click", saveDecoration);

  document.querySelector("[data-modal-close='decoration-edit']")?.addEventListener("click", closeModal);

  byId("adminDecorationsTableBody")?.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-decoration-edit]");
    if (editBtn) {
      const id = parseInt(editBtn.dataset.decorationEdit, 10);
      const item = state.items.find((i) => i.id === id);
      if (item) openModal(item);
      return;
    }
    const delBtn = e.target.closest("[data-decoration-delete]");
    if (delBtn) {
      deleteDecoration(parseInt(delBtn.dataset.decorationDelete, 10));
    }
  });

  byId("adminDecorationAssetButton")?.addEventListener("click", () => {
    byId("adminDecorationAssetFile")?.click();
  });

  byId("adminDecorationAssetFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.pendingFile = file;
    const name = byId("adminDecorationAssetName");
    if (name) name.textContent = file.name;
    const preview = byId("adminDecorationAssetPreview");
    const previewImg = byId("adminDecorationAssetPreviewImg");
    if (preview && previewImg) {
      previewImg.src = URL.createObjectURL(file);
      preview.style.display = "";
    }
  });

  byId("adminDecorationIsActiveSwitch")?.addEventListener("click", (e) => {
    const sw = e.currentTarget;
    const checked = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", checked ? "true" : "false");
  });

  // Load on init
  loadItems();
}());
