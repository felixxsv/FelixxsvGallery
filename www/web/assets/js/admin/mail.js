import { createApiClient } from "../core/api.js";

const appBase = document.body.dataset.appBase || "/gallery";
const api = createApiClient({ baseUrl: appBase });

const DRAFT_SAVE_DELAY_MS = 4000;

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
  draftUpdatedAt: null,
  draftSaveTimer: null,
  draftSaveInFlight: false,
  lastSavedFingerprint: "",
  selectedRecipientsSnapshot: [],
};

const $ = (selector) => document.querySelector(selector);

function setMessage(message, isError = false) {
  const el = $("#adminMailMessage");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.toggle("is-error", !!isError);
}

function setDraftStatus(message) {
  const el = $("#adminMailDraftStatus");
  if (!el) return;
  el.textContent = message || "下書きはありません。";
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
    recipient_user_ids: Array.from(state.selectedIds.values()).sort((a, b) => a - b),
    subject: $("#adminMailSubject")?.value?.trim() || "",
    body: $("#adminMailBody")?.value || "",
  };
}

function fingerprintPayload(payload) {
  return JSON.stringify({
    recipient_scope: payload.recipient_scope || "selected",
    recipient_user_ids: [...(payload.recipient_user_ids || [])].map(Number).filter((id) => id > 0).sort((a, b) => a - b),
    subject: String(payload.subject || ""),
    body: String(payload.body || ""),
  });
}

function isEmptyPayload(payload) {
  return (
    (payload.recipient_scope || "selected") === "selected"
    && (payload.recipient_user_ids || []).length === 0
    && String(payload.subject || "").trim() === ""
    && String(payload.body || "").trim() === ""
  );
}

function refreshSelectedSnapshot() {
  const currentPageSelected = state.recipients
    .filter((item) => state.selectedIds.has(item.user_id))
    .map((item) => ({
      user_id: item.user_id,
      display_name: item.display_name,
      user_key: item.user_key,
      primary_email: item.primary_email,
    }));

  const merged = new Map();
  state.selectedRecipientsSnapshot.forEach((item) => {
    merged.set(Number(item.user_id), item);
  });
  currentPageSelected.forEach((item) => {
    merged.set(Number(item.user_id), item);
  });

  state.selectedRecipientsSnapshot = Array.from(merged.values())
    .filter((item) => state.selectedIds.has(Number(item.user_id)))
    .sort((a, b) => Number(a.user_id) - Number(b.user_id));
}

function updateSummary() {
  refreshSelectedSnapshot();

  if (state.recipientScope === "everyone") {
    $("#adminMailSummaryRecipients").textContent = "@everyone";
    $("#adminMailSummaryCount").textContent = "全員";
    return;
  }

  const count = state.selectedIds.size;
  if (count === 0) {
    $("#adminMailSummaryRecipients").textContent = "選択なし";
    $("#adminMailSummaryCount").textContent = "0";
    return;
  }

  const first = state.selectedRecipientsSnapshot[0];
  const firstLabel = first
    ? `${first.display_name || first.user_key || "ユーザー"}${first.user_key ? ` (${first.user_key})` : ""}`
    : `${count}名選択`;

  $("#adminMailSummaryRecipients").textContent = count === 1 ? firstLabel : `${firstLabel} ほか${count - 1}名`;
  $("#adminMailSummaryCount").textContent = String(count);
}

function applyRecipientScopeToDom() {
  document.querySelectorAll("input[name='adminMailRecipientScope']").forEach((radio) => {
    radio.checked = radio.value === state.recipientScope;
  });

  const isEveryone = state.recipientScope === "everyone";
  const selectAll = $("#adminMailRecipientSelectAll");
  if (selectAll) {
    selectAll.disabled = isEveryone;
    if (isEveryone) {
      selectAll.checked = false;
    }
  }

  document.querySelectorAll("[data-recipient-checkbox]").forEach((checkbox) => {
    checkbox.disabled = isEveryone;
  });

  updateSummary();
}

function renderRecipients() {
  const tbody = $("#adminMailRecipientTableBody");
  if (!tbody) return;

  if (!state.recipients.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-mail-empty">該当するユーザーがいません。</td></tr>`;
    $("#adminMailRecipientTotal").textContent = String(state.recipientsTotal);
    $("#adminMailRecipientPage").textContent = String(state.recipientsPage);
    applyRecipientScopeToDom();
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
  applyRecipientScopeToDom();
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

function applyDraftToForm(draft) {
  const payload = draft || {};
  state.recipientScope = payload.recipient_scope || "selected";
  state.selectedIds = new Set((payload.recipient_user_ids || []).map((id) => Number(id)).filter((id) => id > 0));
  state.selectedRecipientsSnapshot = Array.isArray(payload.selected_recipients) ? payload.selected_recipients : [];
  state.draftUpdatedAt = payload.updated_at || null;

  $("#adminMailSubject").value = payload.subject || "";
  $("#adminMailBody").value = payload.body || "";

  applyRecipientScopeToDom();

  const fingerprint = fingerprintPayload(currentPayload());
  state.lastSavedFingerprint = fingerprint;

  if (state.draftUpdatedAt) {
    setDraftStatus(`下書きを保存済み (${formatDate(state.draftUpdatedAt)})`);
  } else {
    setDraftStatus("下書きはありません。");
  }
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

async function loadDraft() {
  try {
    const payload = await api.get("/api/admin/mail/draft");
    applyDraftToForm(payload.data?.draft || null);
  } catch (error) {
    setDraftStatus("下書きの取得に失敗しました。");
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

async function saveDraft(options = {}) {
  const immediate = !!options.immediate;
  const payload = currentPayload();
  const fingerprint = fingerprintPayload(payload);

  if (!immediate && fingerprint === state.lastSavedFingerprint) {
    return;
  }
  if (state.draftSaveInFlight) {
    if (!immediate) {
      scheduleDraftSave();
    }
    return;
  }

  state.draftSaveInFlight = true;
  setDraftStatus("下書きを保存中...");

  try {
    const res = await api.put("/api/admin/mail/draft", payload);
    const draft = res.data?.draft || null;
    applyDraftToForm(draft);
    state.lastSavedFingerprint = fingerprintPayload(currentPayload());
  } catch (error) {
    setDraftStatus("下書きの保存に失敗しました。");
  } finally {
    state.draftSaveInFlight = false;
  }
}

function scheduleDraftSave() {
  if (state.draftSaveTimer) {
    clearTimeout(state.draftSaveTimer);
  }
  state.draftSaveTimer = window.setTimeout(() => {
    state.draftSaveTimer = null;
    void saveDraft();
  }, DRAFT_SAVE_DELAY_MS);
}

function flushDraftSaveKeepalive() {
  const payload = currentPayload();
  const fingerprint = fingerprintPayload(payload);
  if (fingerprint === state.lastSavedFingerprint) {
    return;
  }

  fetch(`${appBase}/api/admin/mail/draft`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
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
  refreshSelectedSnapshot();
  updateSummary();
  scheduleDraftSave();
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

  let recipientLabel = "@everyone";
  if (payload.recipient_scope !== "everyone") {
    refreshSelectedSnapshot();
    if (state.selectedIds.size === 1 && state.selectedRecipientsSnapshot[0]) {
      const item = state.selectedRecipientsSnapshot[0];
      recipientLabel = `${item.display_name || item.user_key || "ユーザー"}${item.user_key ? ` (${item.user_key})` : ""}`;
    } else {
      recipientLabel = state.selectedIds.size > 0 ? `${state.selectedIds.size}名選択` : "選択なし";
    }
  }

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
    applyDraftToForm(null);
    $("#adminMailRecipientSelectAll").checked = false;
    renderRecipients();
    await loadHistory();
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
      applyRecipientScopeToDom();
      scheduleDraftSave();
    });
  });

  $("#adminMailSubject")?.addEventListener("input", scheduleDraftSave);
  $("#adminMailBody")?.addEventListener("input", scheduleDraftSave);
  $("#adminMailSubject")?.addEventListener("blur", () => { void saveDraft({ immediate: true }); });
  $("#adminMailBody")?.addEventListener("blur", () => { void saveDraft({ immediate: true }); });

  $("#adminMailSendButton")?.addEventListener("click", openSendConfirm);
  $("#adminMailSendConfirmApprove")?.addEventListener("click", submitSend);
  $("#adminMailSendConfirmCancel")?.addEventListener("click", () => {
    window.AdminApp?.modal?.close("admin-mail-send-confirm");
  });

  window.addEventListener("pagehide", flushDraftSaveKeepalive);
  window.addEventListener("beforeunload", flushDraftSaveKeepalive);
}

async function init() {
  bindEvents();
  await Promise.all([loadTemplates(), loadDraft()]);
  await loadRecipients();
  await loadHistory();
  applyRecipientScopeToDom();
}

document.addEventListener("admin:ready", init, { once: true });
