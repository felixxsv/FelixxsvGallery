import { createApiClient, ApiError } from "../core/api.js";

const appBase = document.body.dataset.appBase || "/gallery";
const api = createApiClient({ baseUrl: appBase });

const state = {
  recipientsPage: 1,
  recipientsPerPage: 20,
  recipientsTotal: 0,
  recipients: [],
  selectedIds: new Set(),
  recipientScope: "selected",
  templates: [],
  sender: { from_email: "-", from_name: "" },
  historyPage: 1,
  historyPerPage: 10,
  historyItems: [],
};

const $ = (selector) => document.querySelector(selector);

function setMessage(message, isError = false) {
  const el = $("#adminMailMessage");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.toggle("is-error", !!isError);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ja-JP");
  } catch {
    return String(value);
  }
}

function currentPayload() {
  return {
    recipient_scope: state.recipientScope,
    recipient_user_ids: Array.from(state.selectedIds.values()),
    subject: $("#adminMailSubject")?.value?.trim() || "",
    body: $("#adminMailBody")?.value || "",
  };
}

function isDirty() {
  const payload = currentPayload();
  return Boolean(payload.subject || payload.body.trim() || payload.recipient_scope !== "selected" || payload.recipient_user_ids.length > 0);
}

function syncDirtyGuard() {
  window.AdminApp?.dirtyGuard?.setDirty("admin-mail-compose", isDirty);
}

function updateSummary() {
  const selectedRows = state.recipients.filter((item) => state.selectedIds.has(item.user_id));
  const count = state.recipientScope === "everyone" ? state.recipients.filter((item) => item.can_receive_mail).length : selectedRows.length;
  const label = state.recipientScope === "everyone"
    ? "@everyone"
    : (selectedRows.length === 0 ? "選択なし" : (selectedRows.length === 1 ? `${selectedRows[0].display_name} (${selectedRows[0].user_key})` : `${selectedRows[0].display_name} ほか${selectedRows.length - 1}名`));
  $("#adminMailSummaryRecipients").textContent = label;
  $("#adminMailSummaryCount").textContent = String(count);
}

function renderRecipients() {
  const tbody = $("#adminMailRecipientTableBody");
  if (!tbody) return;

  if (!state.recipients.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-mail-empty">該当するユーザーがいません。</td></tr>`;
    $("#adminMailRecipientTotal").textContent = String(state.recipientsTotal);
    $("#adminMailRecipientPage").textContent = String(state.recipientsPage);
    updateSummary();
    return;
  }

  tbody.innerHTML = state.recipients.map((item) => {
    const checked = state.selectedIds.has(item.user_id) ? "checked" : "";
    const disabled = state.recipientScope === "everyone" ? "disabled" : "";
    const stateLabel = item.can_receive_mail
      ? '<span class="admin-mail-recipient-state" data-state="ok">送信可</span>'
      : '<span class="admin-mail-recipient-state" data-state="ng">送信不可</span>';
    return `
      <tr>
        <td class="admin-mail-recipient-table__checkbox">
          <input type="checkbox" data-recipient-checkbox value="${item.user_id}" ${checked} ${disabled} aria-label="${escapeHtml(item.display_name)} を選択">
        </td>
        <td>${escapeHtml(item.display_name)}<br><small>${escapeHtml(item.user_key)}</small></td>
        <td>${escapeHtml(item.primary_email || "-")}</td>
        <td>${escapeHtml(item.role)}</td>
        <td>${escapeHtml(item.status)}</td>
        <td>${stateLabel}</td>
      </tr>
    `;
  }).join("");

  $("#adminMailRecipientTotal").textContent = String(state.recipientsTotal);
  $("#adminMailRecipientPage").textContent = String(state.recipientsPage);
  updateSummary();
}

function renderHistory() {
  const root = $("#adminMailHistoryList");
  if (!root) return;
  if (!state.historyItems.length) {
    root.innerHTML = '<div class="admin-mail-empty">送信履歴はまだありません。</div>';
    return;
  }
  root.innerHTML = state.historyItems.map((item) => `
    <article class="admin-mail-history-card">
      <div class="admin-mail-history-card__head">
        <div class="admin-mail-history-card__subject">${escapeHtml(item.subject)}</div>
        <div class="admin-mail-history-card__meta">${escapeHtml(formatDate(item.sent_at || item.created_at))}</div>
      </div>
      <div class="admin-mail-history-card__meta">送信者: ${escapeHtml(item.sender?.display_name || "-")} / 宛先: ${escapeHtml(item.recipient_summary || "-")}</div>
      <div class="admin-mail-history-card__body">${escapeHtml(item.body)}</div>
      <div class="admin-mail-history-card__stats">
        <span>成功: ${escapeHtml(item.success_count)}</span>
        <span>失敗: ${escapeHtml(item.failure_count)}</span>
      </div>
    </article>
  `).join("");
}

async function loadTemplates() {
  try {
    const payload = await api.get("/api/admin/mail/templates");
    state.templates = payload.data?.items || [];
    state.sender = payload.data?.sender || { from_email: "-", from_name: "" };
    const senderText = state.sender.from_name
      ? `${state.sender.from_name} <${state.sender.from_email}>`
      : (state.sender.from_email || "-");
    $("#adminMailSenderMeta").textContent = `送信元: ${senderText}`;
  } catch (error) {
    setMessage(error.message || "メール設定の取得に失敗しました。", true);
  }
}

async function loadRecipients() {
  const params = new URLSearchParams();
  params.set("page", String(state.recipientsPage));
  params.set("per_page", String(state.recipientsPerPage));
  const q = $("#adminMailRecipientSearch")?.value?.trim() || "";
  const role = $("#adminMailRecipientRole")?.value || "";
  const status = $("#adminMailRecipientStatus")?.value || "";
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  if (status) params.set("status", status);

  try {
    const payload = await api.get(`/api/admin/mail/recipients?${params.toString()}`);
    state.recipients = payload.data?.items || [];
    state.recipientsTotal = Number(payload.data?.total || 0);
    renderRecipients();
  } catch (error) {
    state.recipients = [];
    state.recipientsTotal = 0;
    renderRecipients();
    setMessage(error.message || "宛先一覧の取得に失敗しました。", true);
  }
}

async function loadHistory() {
  try {
    const payload = await api.get(`/api/admin/mail/history?page=${state.historyPage}&per_page=${state.historyPerPage}`);
    state.historyItems = payload.data?.items || [];
    renderHistory();
  } catch (error) {
    state.historyItems = [];
    renderHistory();
    setMessage(error.message || "送信履歴の取得に失敗しました。", true);
  }
}

function syncSelectedIdsFromDom() {
  document.querySelectorAll("[data-recipient-checkbox]").forEach((checkbox) => {
    const id = Number(checkbox.value);
    if (!id) return;
    if (checkbox.checked) {
      state.selectedIds.add(id);
    } else {
      state.selectedIds.delete(id);
    }
  });
  syncDirtyGuard();
  updateSummary();
}

function openSendConfirm() {
  const payload = currentPayload();
  if (!payload.subject) {
    setMessage("件名を入力してください。", true);
    return;
  }
  if (!payload.body.trim()) {
    setMessage("本文を入力してください。", true);
    return;
  }
  if (payload.recipient_scope === "selected" && payload.recipient_user_ids.length === 0) {
    setMessage("送信先を選択してください。", true);
    return;
  }

  const senderText = state.sender.from_name
    ? `${state.sender.from_name} <${state.sender.from_email}>`
    : (state.sender.from_email || "-");

  const selectedRows = state.recipients.filter((item) => state.selectedIds.has(item.user_id));
  const recipientLabel = payload.recipient_scope === "everyone"
    ? "@everyone"
    : (selectedRows.length === 1 ? `${selectedRows[0].display_name} (${selectedRows[0].user_key})` : `${selectedRows[0].display_name} ほか${selectedRows.length - 1}名`);

  $("#adminMailConfirmSender").textContent = senderText;
  $("#adminMailConfirmRecipients").textContent = recipientLabel;
  $("#adminMailConfirmSubject").textContent = payload.subject;
  $("#adminMailConfirmBody").textContent = payload.body;
  window.AdminApp?.modal?.open("admin-mail-send-confirm");
}

async function submitSend() {
  const payload = currentPayload();
  try {
    const res = await api.post("/api/admin/mail/send", payload);
    window.AdminApp?.modal?.close("admin-mail-send-confirm");
    setMessage(res.message || "メールを送信しました。", false);
    $("#adminMailSubject").value = "";
    $("#adminMailBody").value = "";
    state.selectedIds.clear();
    state.recipientScope = "selected";
    document.querySelectorAll("input[name='adminMailRecipientScope']").forEach((radio) => {
      radio.checked = radio.value === "selected";
    });
    $("#adminMailRecipientSelectAll").checked = false;
    renderRecipients();
    await loadHistory();
    syncDirtyGuard();
  } catch (error) {
    setMessage(error.message || "メール送信に失敗しました。", true);
  }
}

function bindEvents() {
  $("#adminMailRecipientSearchButton")?.addEventListener("click", async () => {
    state.recipientsPage = 1;
    await loadRecipients();
  });

  $("#adminMailRecipientPrevPage")?.addEventListener("click", async () => {
    if (state.recipientsPage <= 1) return;
    state.recipientsPage -= 1;
    await loadRecipients();
  });

  $("#adminMailRecipientNextPage")?.addEventListener("click", async () => {
    const maxPage = Math.max(1, Math.ceil(state.recipientsTotal / state.recipientsPerPage));
    if (state.recipientsPage >= maxPage) return;
    state.recipientsPage += 1;
    await loadRecipients();
  });

  $("#adminMailHistoryReloadButton")?.addEventListener("click", loadHistory);

  $("#adminMailRecipientTableBody")?.addEventListener("change", (event) => {
    if (event.target.matches("[data-recipient-checkbox]")) {
      syncSelectedIdsFromDom();
    }
  });

  $("#adminMailRecipientSelectAll")?.addEventListener("change", (event) => {
    if (state.recipientScope === "everyone") {
      event.target.checked = false;
      return;
    }
    document.querySelectorAll("[data-recipient-checkbox]").forEach((checkbox) => {
      if (!checkbox.disabled) checkbox.checked = event.target.checked;
    });
    syncSelectedIdsFromDom();
  });

  document.querySelectorAll("input[name='adminMailRecipientScope']").forEach((radio) => {
    radio.addEventListener("change", () => {
      state.recipientScope = radio.value;
      document.querySelectorAll("[data-recipient-checkbox]").forEach((checkbox) => {
        checkbox.disabled = state.recipientScope === "everyone";
      });
      $("#adminMailRecipientSelectAll").disabled = state.recipientScope === "everyone";
      if (state.recipientScope === "everyone") {
        $("#adminMailRecipientSelectAll").checked = false;
      }
      syncDirtyGuard();
      updateSummary();
    });
  });

  $("#adminMailSubject")?.addEventListener("input", syncDirtyGuard);
  $("#adminMailBody")?.addEventListener("input", syncDirtyGuard);

  $("#adminMailSendButton")?.addEventListener("click", openSendConfirm);
  $("#adminMailSendConfirmApprove")?.addEventListener("click", submitSend);
  $("#adminMailSendConfirmCancel")?.addEventListener("click", () => {
    window.AdminApp?.modal?.close("admin-mail-send-confirm");
  });
}

async function init() {
  window.AdminApp?.dirtyGuard?.register("admin-mail-compose", isDirty);
  bindEvents();
  await loadTemplates();
  await loadRecipients();
  await loadHistory();
  syncDirtyGuard();
}

document.addEventListener("admin:ready", init, { once: true });
