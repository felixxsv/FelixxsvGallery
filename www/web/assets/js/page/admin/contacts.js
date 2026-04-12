import { escapeHtml } from "../../core/dom.js";
import { languageToLocaleTag } from "../../core/settings.js";

function byId(id) {
  return document.getElementById(id);
}

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_contacts.${key}`, fallback, vars) || fallback;
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(languageToLocaleTag(document.documentElement.lang || "en-us"));
}

function categoryLabel(cat) {
  const map = {
    bug: t("category_bug", "バグ報告"),
    feature: t("category_feature", "機能要望"),
    account: t("category_account", "アカウントについて"),
    other: t("category_other", "その他"),
  };
  return map[cat] || cat || "-";
}

function roleLabel(role) {
  return role === "admin" ? t("role_admin", "管理者") : t("role_user", "ユーザー");
}

function statusLabel(status) {
  return status === "done" ? t("status_done", "完了") : t("status_open", "未対応");
}

function truncate(str, maxLen) {
  if (!str) return "-";
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

const POLL_INTERVAL_MS = 30 * 1000;

const state = {
  items: [],
  total: 0,
  page: 1,
  pages: 1,
  perPage: 50,
  statusFilter: "",
  currentItem: null,
  pollTimer: null,
};

function getApi() {
  return window.AdminApp?.api;
}

async function loadContacts(silent = false) {
  const api = getApi();
  if (!api) return;

  const params = new URLSearchParams({
    page: String(state.page),
    per_page: String(state.perPage),
  });
  if (state.statusFilter) params.set("status", state.statusFilter);

  try {
    const payload = await api.get(`/api/admin/contacts?${params}`);
    const d = payload.data || {};
    state.items = Array.isArray(d.items) ? d.items : [];
    state.total = Number(d.total || 0);
    state.page = Number(d.page || 1);
    state.pages = Number(d.pages || 1);
    renderTable();
  } catch {
    // silent fail on poll
  }
}

function scheduleNextPoll() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(() => {
    loadContacts(true).finally(scheduleNextPoll);
  }, POLL_INTERVAL_MS);
}

function avatarHtml(item) {
  if (item.user_avatar_url) {
    return `<img class="admin-contacts-avatar" src="${escapeHtml(item.user_avatar_url)}" alt="" aria-hidden="true">`;
  }
  const initial = (item.user_display_name || item.user_key || "?").slice(0, 1).toUpperCase();
  return `<span class="admin-contacts-avatar admin-contacts-avatar--fallback">${escapeHtml(initial)}</span>`;
}

function renderTable() {
  const tbody = byId("adminContactsTableBody");
  if (!tbody) return;

  if (!state.items.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-contacts-empty" data-i18n="admin_contacts.empty">お問い合わせはありません</td></tr>`;
    updatePagination();
    return;
  }

  tbody.innerHTML = state.items.map((item) => {
    const statusCls = item.status === "done" ? "admin-contacts-status--done" : "admin-contacts-status--open";
    return `
      <tr data-contact-id="${item.id}">
        <td class="admin-contacts-user-cell">
          ${avatarHtml(item)}
          <span>${escapeHtml(item.user_display_name || "-")}</span>
        </td>
        <td class="admin-contacts-mono">${escapeHtml(item.user_key || "-")}</td>
        <td>${escapeHtml(roleLabel(item.user_role))}</td>
        <td>${escapeHtml(categoryLabel(item.category))}</td>
        <td class="admin-contacts-message-preview">${escapeHtml(truncate(item.message, 60))}</td>
        <td class="admin-contacts-mono">${escapeHtml(formatDateTime(item.created_at))}</td>
        <td><span class="admin-contacts-status ${statusCls}">${escapeHtml(statusLabel(item.status))}</span></td>
        <td>
          <button class="app-button app-button--small" data-action="detail" data-contact-id="${item.id}" data-i18n="admin_contacts.detail_button">詳細</button>
        </td>
      </tr>
    `;
  }).join("");

  updatePagination();
}

function updatePagination() {
  const meta = byId("adminContactsPageMeta");
  const prev = byId("adminContactsPrevPage");
  const next = byId("adminContactsNextPage");
  if (meta) meta.textContent = `${state.page} / ${state.pages}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}

function openDetail(contactId) {
  const item = state.items.find((i) => i.id === contactId);
  if (!item) return;
  state.currentItem = item;

  const body = byId("adminContactDetailBody");
  if (body) {
    body.innerHTML = `
      <dl class="app-definition-list">
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("detail_user", "ユーザー"))}</dt>
          <dd class="admin-contacts-detail-user">
            ${avatarHtml(item)}
            <span>${escapeHtml(item.user_display_name || "-")}</span>
            <span class="admin-contacts-mono" style="color:var(--color-text-muted);font-size:.85em">@${escapeHtml(item.user_key || "-")}</span>
          </dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("detail_role", "ロール"))}</dt>
          <dd>${escapeHtml(roleLabel(item.user_role))}</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("detail_created_at", "お問い合わせ日"))}</dt>
          <dd>${escapeHtml(formatDateTime(item.created_at))}</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("detail_category", "カテゴリ"))}</dt>
          <dd>${escapeHtml(categoryLabel(item.category))}</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("detail_status", "状態"))}</dt>
          <dd>${escapeHtml(statusLabel(item.status))}</dd>
        </div>
        <div class="app-definition-list__row admin-contacts-detail-message-row">
          <dt>${escapeHtml(t("detail_message", "内容"))}</dt>
          <dd class="admin-contacts-detail-message">${escapeHtml(item.message)}</dd>
        </div>
      </dl>
    `;
  }

  const doneBtn = byId("adminContactDetailDoneButton");
  if (doneBtn) {
    doneBtn.hidden = item.status === "done";
  }

  window.AdminApp?.modal?.open?.("admin-contacts-detail");
}

async function markDone(contactId) {
  const api = getApi();
  if (!api) return;
  const doneBtn = byId("adminContactDetailDoneButton");
  if (doneBtn) { doneBtn.disabled = true; doneBtn.textContent = t("marking", "処理中..."); }

  try {
    await api.patch(`/api/admin/contacts/${contactId}/done`, {});
    // Update state immediately for instant feedback
    const item = state.items.find((i) => i.id === contactId);
    if (item) item.status = "done";
    if (state.currentItem?.id === contactId) state.currentItem.status = "done";
    window.AdminApp?.modal?.close?.("admin-contacts-detail");
    renderTable();
    window.AdminApp?.toast?.success?.(t("done_success", "完了にしました。"));
  } catch {
    window.AdminApp?.toast?.error?.(t("done_error", "更新に失敗しました。"));
    if (doneBtn) { doneBtn.disabled = false; doneBtn.textContent = t("mark_done", "完了"); }
  }
}

function bindEvents() {
  byId("adminContactsStatusFilter")?.addEventListener("change", (e) => {
    state.statusFilter = e.target.value;
    state.page = 1;
    loadContacts();
  });

  byId("adminContactsReloadButton")?.addEventListener("click", () => {
    loadContacts();
  });

  byId("adminContactsPrevPage")?.addEventListener("click", () => {
    if (state.page > 1) { state.page--; loadContacts(); }
  });

  byId("adminContactsNextPage")?.addEventListener("click", () => {
    if (state.page < state.pages) { state.page++; loadContacts(); }
  });

  byId("adminContactsTableBody")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='detail']");
    if (btn) {
      const id = parseInt(btn.dataset.contactId, 10);
      if (!isNaN(id)) openDetail(id);
    }
  });

  byId("adminContactDetailDoneButton")?.addEventListener("click", () => {
    if (state.currentItem) markDone(state.currentItem.id);
  });
}

function applyStaticTranslations() {
  const statusFilter = byId("adminContactsStatusFilter");
  if (statusFilter?.options[0]) statusFilter.options[0].text = t("status_all", "すべて");
  if (statusFilter?.options[1]) statusFilter.options[1].text = t("status_open", "未対応");
  if (statusFilter?.options[2]) statusFilter.options[2].text = t("status_done", "完了");

  const reload = byId("adminContactsReloadButton");
  if (reload) reload.textContent = t("reload", "再読み込み");

  const prev = byId("adminContactsPrevPage");
  if (prev) prev.textContent = t("prev", "前へ");
  const next = byId("adminContactsNextPage");
  if (next) next.textContent = t("next", "次へ");

  const panelTitle = document.querySelector(".admin-contacts-panel--list .admin-panel__title");
  if (panelTitle) panelTitle.textContent = t("list_title", "お問い合わせ一覧");

  const head = document.querySelectorAll(".admin-contacts-table thead th");
  if (head[0]) head[0].textContent = t("col_user", "ユーザー");
  if (head[1]) head[1].textContent = t("col_user_id", "ユーザーID");
  if (head[2]) head[2].textContent = t("col_role", "ロール");
  if (head[3]) head[3].textContent = t("col_category", "カテゴリ");
  if (head[4]) head[4].textContent = t("col_message", "内容");
  if (head[5]) head[5].textContent = t("col_created_at", "お問い合わせ日");
  if (head[6]) head[6].textContent = t("col_status", "状態");
  if (head[7]) head[7].textContent = t("col_action", "操作");

  const closeBtn = byId("adminContactDetailClose");
  if (closeBtn) closeBtn.textContent = t("close", "閉じる");
  const doneBtn = byId("adminContactDetailDoneButton");
  if (doneBtn) doneBtn.textContent = t("mark_done", "完了");

  renderTable();
}

document.addEventListener("admin:ready", () => {
  applyStaticTranslations();
  bindEvents();
  loadContacts().then(scheduleNextPoll);

  window.addEventListener("gallery:language-changed", () => {
    applyStaticTranslations();
  });
});
