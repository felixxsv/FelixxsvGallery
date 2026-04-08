import { escapeHtml } from "../../core/dom.js";
import { attachDatePicker } from "../../core/date-picker.js";
import { languageToLocaleTag } from "../../core/settings.js";

function byId(id) {
  return document.getElementById(id);
}

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_audit.${key}`, fallback, vars) || fallback;
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(languageToLocaleTag(document.documentElement.lang || "en-us"));
}

const LIVE_REFRESH_KEY = "admin.auditLogs.liveRefreshMs";
const LIVE_ALLOWED_INTERVALS = [0, 3000, 5000, 10000, 30000, 60000];
const LIVE_DEFAULT_INTERVAL_MS = 3000;

const state = {
  page: 1,
  perPage: 20,
  total: 0,
  pages: 1,
  q: "",
  actionType: "",
  result: "",
  dateFrom: "",
  dateTo: "",
  items: [],
  loadPromise: null,
  lastSnapshot: "",
  liveWatcher: null,
};

function buildQuery() {
  const params = new URLSearchParams();
  params.set("page", String(state.page));
  params.set("per_page", String(state.perPage));
  if (state.q) params.set("q", state.q);
  if (state.actionType) params.set("action_type", state.actionType);
  if (state.result) params.set("result", state.result);
  if (state.dateFrom) params.set("date_from", state.dateFrom);
  if (state.dateTo) params.set("date_to", state.dateTo);
  return params.toString();
}

function resultPill(result) {
  const text = String(result || "-");
  const mod = text === "success" ? "success" : (text === "failure" ? "failure" : "other");
  return `<span class="admin-audit-pill admin-audit-pill--${mod}">${escapeHtml(text)}</span>`;
}

function buildAuditSnapshot(payload) {
  return JSON.stringify({
    total: Number(payload.data?.total || 0),
    page: Number(payload.data?.page || state.page),
    pages: Number(payload.data?.pages || 1),
    items: Array.isArray(payload.data?.items)
      ? payload.data.items.map((item) => ({
          id: item.id,
          created_at: item.created_at,
          action_type: item.action_type,
          result: item.result,
          summary: item.summary,
          actor: item.actor?.display_name || item.actor?.user_key || "",
        }))
      : [],
  });
}

function renderTable(errorMessage = "") {
  const tbody = byId("adminAuditTableBody");
  const summary = byId("adminAuditSummary");
  const pageInfo = byId("adminAuditPageInfo");
  const prev = byId("adminAuditPrevPage");
  const next = byId("adminAuditNextPage");

  if (!tbody) return;

  if (errorMessage) {
    tbody.innerHTML = `<tr><td colspan="7" class="admin-audit-table__empty">${escapeHtml(errorMessage)}</td></tr>`;
  } else if (!Array.isArray(state.items) || state.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="admin-audit-table__empty">${escapeHtml(t("empty", "No audit logs found."))}</td></tr>`;
  } else {
    tbody.innerHTML = state.items.map((item) => {
      const actor = item.actor?.display_name || item.actor?.user_key || "-";
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(item.created_at))}</td>
          <td>${escapeHtml(actor)}</td>
          <td>${escapeHtml(item.action_type || "-")}</td>
          <td>${escapeHtml(item.target_label || "-")}</td>
          <td>${resultPill(item.result)}</td>
          <td>${escapeHtml(item.summary || "-")}</td>
          <td>
            <button type="button" class="app-button app-button--ghost app-button--sm" data-action="detail" data-log-id="${Number(item.id || 0)}">${escapeHtml(t("detail", "Details"))}</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  if (summary) summary.textContent = t("total_count", "Total {count}", { count: state.total });
  if (pageInfo) pageInfo.textContent = `${state.page} / ${state.pages}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}

function getLiveInterval() {
  return window.AdminApp?.live?.getStoredInterval?.(LIVE_REFRESH_KEY, LIVE_ALLOWED_INTERVALS, LIVE_DEFAULT_INTERVAL_MS) ?? LIVE_DEFAULT_INTERVAL_MS;
}

function setLiveInterval(value) {
  return window.AdminApp?.live?.setStoredInterval?.(LIVE_REFRESH_KEY, value, LIVE_ALLOWED_INTERVALS, LIVE_DEFAULT_INTERVAL_MS) ?? LIVE_DEFAULT_INTERVAL_MS;
}

function isDefaultLiveView() {
  return state.page === 1
    && !state.q
    && !state.actionType
    && !state.result
    && !state.dateFrom
    && !state.dateTo;
}

function syncLiveRefreshControl() {
  const select = byId("adminAuditLiveRefreshInterval");
  if (!select) return;
  select.value = String(getLiveInterval());
}

async function loadAuditLogs({ silent = false, force = false } = {}) {
  if (state.loadPromise) {
    return state.loadPromise;
  }

  const tbody = byId("adminAuditTableBody");
  if (tbody && !silent) {
    tbody.innerHTML = `<tr><td colspan="7" class="admin-audit-table__empty">${escapeHtml(t("loading", "Loading..."))}</td></tr>`;
  }

  state.loadPromise = window.AdminApp.api.get(`/api/admin/audit-logs?${buildQuery()}`)
    .then((payload) => {
      const snapshot = buildAuditSnapshot(payload);
      if (!force && silent && snapshot === state.lastSnapshot) {
        return;
      }
      state.lastSnapshot = snapshot;
      state.total = Number(payload.data?.total || 0);
      state.pages = Number(payload.data?.pages || 1);
      state.page = Number(payload.data?.page || state.page);
      state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
      renderTable("");
    })
    .catch((error) => {
      state.items = [];
      state.total = 0;
      state.pages = 1;
      renderTable(error?.message || t("load_error", "Failed to load audit logs."));
      if (!silent) {
        window.AdminApp?.toast?.error?.(error?.message || t("load_error", "Failed to load audit logs."));
      }
    })
    .finally(() => {
      state.loadPromise = null;
    });

  return state.loadPromise;
}

function fillDetail(item) {
  byId("adminAuditDetailCreatedAt").textContent = formatDateTime(item.created_at);
  byId("adminAuditDetailActor").textContent = item.actor?.display_name || item.actor?.user_key || "-";
  byId("adminAuditDetailActionType").textContent = item.action_type || "-";
  byId("adminAuditDetailTarget").textContent = item.target_label || "-";
  byId("adminAuditDetailResult").textContent = item.result || "-";
  byId("adminAuditDetailIp").textContent = item.ip_address || "-";
  byId("adminAuditDetailSummary").textContent = item.summary || "-";
  byId("adminAuditDetailMeta").textContent = item.meta_json ? JSON.stringify(item.meta_json, null, 2) : "-";
  byId("adminAuditDetailUserAgent").textContent = item.user_agent || "-";
}

async function openDetail(logId) {
  try {
    const payload = await window.AdminApp.api.get(`/api/admin/audit-logs/${logId}`);
    const item = payload.data?.item;
    if (!item) throw new Error(t("not_found", "Audit log not found."));
    fillDetail(item);
    window.AdminApp.modal.open("admin-audit-detail");
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || t("detail_load_error", "Failed to load audit log details."));
  }
}

function bindEvents() {
  byId("adminAuditSearchButton")?.addEventListener("click", async () => {
    state.page = 1;
    state.q = byId("adminAuditSearch")?.value?.trim() || "";
    state.actionType = byId("adminAuditActionType")?.value?.trim() || "";
    state.result = byId("adminAuditResult")?.value || "";
    state.dateFrom = byId("adminAuditDateFrom")?.value || "";
    state.dateTo = byId("adminAuditDateTo")?.value || "";
    state.lastSnapshot = "";
    await loadAuditLogs({ force: true });
    state.liveWatcher?.schedule?.();
  });

  byId("adminAuditLiveRefreshInterval")?.addEventListener("change", async (event) => {
    const value = setLiveInterval(event.currentTarget?.value);
    if (event.currentTarget) event.currentTarget.value = String(value);
    state.liveWatcher?.schedule?.();
    if (value && isDefaultLiveView()) {
      state.lastSnapshot = "";
      await loadAuditLogs({ silent: true, force: true });
    }
  });

  byId("adminAuditReloadButton")?.addEventListener("click", async () => {
    state.lastSnapshot = "";
    await loadAuditLogs({ force: true });
  });

  byId("adminAuditPrevPage")?.addEventListener("click", async () => {
    if (state.page <= 1) return;
    state.page -= 1;
    state.lastSnapshot = "";
    await loadAuditLogs({ force: true });
  });

  byId("adminAuditNextPage")?.addEventListener("click", async () => {
    if (state.page >= state.pages) return;
    state.page += 1;
    state.lastSnapshot = "";
    await loadAuditLogs({ force: true });
  });

  byId("adminAuditExportButton")?.addEventListener("click", () => {
    const url = `${window.AdminApp.appBase}/api/admin/audit-logs/export?${buildQuery()}`;
    window.location.href = url;
  });

  byId("adminAuditTableBody")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action='detail']");
    if (!btn) return;
    const logId = Number(btn.dataset.logId || 0);
    if (!logId) return;
    await openDetail(logId);
  });

  byId("adminAuditDetailCloseButton")?.addEventListener("click", () => {
    window.AdminApp?.modal?.close?.("admin-audit-detail");
  });
}

function startLiveRefresh() {
  syncLiveRefreshControl();
  state.liveWatcher = window.AdminApp?.live?.createWatcher?.({
    storageKey: LIVE_REFRESH_KEY,
    defaultIntervalMs: LIVE_DEFAULT_INTERVAL_MS,
    allowedIntervals: LIVE_ALLOWED_INTERVALS,
    visibleOnly: true,
    enabledWhen: isDefaultLiveView,
    onTick: async () => {
      await loadAuditLogs({ silent: true });
    },
  });

  state.liveWatcher?.start?.({ immediate: false });
}

document.addEventListener("admin:ready", async () => {
  attachDatePicker(byId("adminAuditDateFrom"), { getLocale: () => document.documentElement.lang || "en-US" });
  attachDatePicker(byId("adminAuditDateTo"), { getLocale: () => document.documentElement.lang || "en-US" });
  const fields = document.querySelectorAll(".admin-audit-field .admin-form-label");
  if (fields[0]) fields[0].textContent = t("search", "Search");
  if (fields[1]) fields[1].textContent = t("action_type", "Action Type");
  if (fields[2]) fields[2].textContent = t("result", "Result");
  if (fields[3]) fields[3].textContent = t("start_date", "Start Date");
  if (fields[4]) fields[4].textContent = t("end_date", "End Date");
  const search = byId("adminAuditSearch");
  if (search) search.placeholder = t("search_placeholder", "Search action / target / actor / summary");
  const actionType = byId("adminAuditActionType");
  if (actionType) actionType.placeholder = t("action_type_placeholder", "e.g. admin.users.update");
  const result = byId("adminAuditResult");
  if (result?.options[0]) result.options[0].text = t("all", "All");
  const refreshLabel = document.querySelector(".admin-audit-toolbar__refresh-label");
  if (refreshLabel) refreshLabel.textContent = t("auto_refresh", "Auto Refresh");
  const searchBtn = byId("adminAuditSearchButton");
  if (searchBtn) searchBtn.textContent = t("search", "Search");
  const reload = byId("adminAuditReloadButton");
  if (reload) reload.textContent = t("reload", "Reload");
  const exportBtn = byId("adminAuditExportButton");
  if (exportBtn) exportBtn.textContent = t("export", "Export CSV");
  const listTitle = document.querySelector(".admin-audit-list-head .admin-panel__title");
  if (listTitle) listTitle.textContent = t("list_title", "Audit Logs");
  const head = document.querySelectorAll(".admin-audit-table thead th");
  if (head[0]) head[0].textContent = t("date", "Date");
  if (head[1]) head[1].textContent = t("actor", "Actor");
  if (head[2]) head[2].textContent = t("action_type", "Action Type");
  if (head[3]) head[3].textContent = t("target", "Target");
  if (head[4]) head[4].textContent = t("result", "Result");
  if (head[5]) head[5].textContent = t("summary", "Summary");
  if (head[6]) head[6].textContent = t("action", "Action");
  const prev = byId("adminAuditPrevPage");
  if (prev) prev.textContent = t("prev", "Prev");
  const next = byId("adminAuditNextPage");
  if (next) next.textContent = t("next", "Next");
  bindEvents();
  await loadAuditLogs({ force: true });
  startLiveRefresh();
  window.addEventListener("gallery:language-changed", () => {
    if (fields[0]) fields[0].textContent = t("search", "Search");
    if (fields[1]) fields[1].textContent = t("action_type", "Action Type");
    if (fields[2]) fields[2].textContent = t("result", "Result");
    if (fields[3]) fields[3].textContent = t("start_date", "Start Date");
    if (fields[4]) fields[4].textContent = t("end_date", "End Date");
    if (search) search.placeholder = t("search_placeholder", "Search action / target / actor / summary");
    if (actionType) actionType.placeholder = t("action_type_placeholder", "e.g. admin.users.update");
    if (result?.options[0]) result.options[0].text = t("all", "All");
    if (refreshLabel) refreshLabel.textContent = t("auto_refresh", "Auto Refresh");
    if (searchBtn) searchBtn.textContent = t("search", "Search");
    if (reload) reload.textContent = t("reload", "Reload");
    if (exportBtn) exportBtn.textContent = t("export", "Export CSV");
    if (listTitle) listTitle.textContent = t("list_title", "Audit Logs");
    if (head[0]) head[0].textContent = t("date", "Date");
    if (head[1]) head[1].textContent = t("actor", "Actor");
    if (head[2]) head[2].textContent = t("action_type", "Action Type");
    if (head[3]) head[3].textContent = t("target", "Target");
    if (head[4]) head[4].textContent = t("result", "Result");
    if (head[5]) head[5].textContent = t("summary", "Summary");
    if (head[6]) head[6].textContent = t("action", "Action");
    if (prev) prev.textContent = t("prev", "Prev");
    if (next) next.textContent = t("next", "Next");
    syncLiveRefreshControl();
    renderTable("");
  });
});
