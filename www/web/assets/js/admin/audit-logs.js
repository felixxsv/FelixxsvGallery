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
  return `<span class="admin-audit-result admin-audit-result--${mod}">${escapeHtml(text)}</span>`;
}

function renderTable(errorMessage = "") {
  const tbody = byId("adminAuditTableBody");
  const summary = byId("adminAuditSummary");
  const pageInfo = byId("adminAuditPageInfo");
  const prev = byId("adminAuditPrevPage");
  const next = byId("adminAuditNextPage");
  if (!tbody) return;

  if (errorMessage) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-audit-table__error">${escapeHtml(errorMessage)}</td></tr>`;
  } else if (!Array.isArray(state.items) || state.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-audit-table__empty">該当する監査ログがありません。</td></tr>`;
  } else {
    tbody.innerHTML = state.items.map((item) => {
      const actor = item.actor?.display_name || item.actor?.user_key || "-";
      return `
        <tr>
          <td>${escapeHtml(formatDateTime(item.created_at))}</td>
          <td>${escapeHtml(actor)}</td>
          <td>${escapeHtml(item.action_type || "-")}</td>
          <td>${resultPill(item.result)}</td>
          <td class="admin-audit-summary">${escapeHtml(item.summary || "-")}</td>
          <td>
            <button type="button" class="app-button app-button--ghost app-button--sm" data-action="detail" data-log-id="${Number(item.id || 0)}">詳細</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  if (summary) summary.textContent = `合計 ${state.total} 件`;
  if (pageInfo) pageInfo.textContent = `${state.page} / ${state.pages}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}

async function loadAuditLogs() {
  const tbody = byId("adminAuditTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-audit-table__empty">読み込み中です。</td></tr>`;
  }
  try {
    const payload = await window.AdminApp.api.get(`/api/admin/audit-logs?${buildQuery()}`);
    state.total = Number(payload.data?.total || 0);
    state.pages = Number(payload.data?.pages || 1);
    state.page = Number(payload.data?.page || state.page);
    state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
    renderTable("");
  } catch (error) {
    state.items = [];
    state.total = 0;
    state.pages = 1;
    renderTable(error?.message || "監査ログの取得に失敗しました。");
    window.AdminApp?.toast?.error?.(error?.message || "監査ログの取得に失敗しました。");
  }
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
    if (!item) throw new Error("監査ログが見つかりません。");
    fillDetail(item);
    window.AdminApp.modal.open("admin-audit-detail");
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "監査ログ詳細の取得に失敗しました。");
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
    await loadAuditLogs();
  });

  byId("adminAuditReloadButton")?.addEventListener("click", async () => {
    await loadAuditLogs();
  });

  byId("adminAuditPrevPage")?.addEventListener("click", async () => {
    if (state.page <= 1) return;
    state.page -= 1;
    await loadAuditLogs();
  });

  byId("adminAuditNextPage")?.addEventListener("click", async () => {
    if (state.page >= state.pages) return;
    state.page += 1;
    await loadAuditLogs();
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

document.addEventListener("admin:ready", async () => {
  bindEvents();
  await loadAuditLogs();
});
