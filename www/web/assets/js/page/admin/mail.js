import { createApiClient } from "../../core/api.js";
import { escapeHtml } from "../../core/dom.js";

const MAIL_MESSAGES = {
  ja: {
    no_draft: "下書きはありません。",
    everyone: "全員",
    none_selected: "選択なし",
    user: "ユーザー",
    selected_count: "{count}名選択",
    selected_more: "{first} ほか{count}名",
    recipients_empty: "該当するユーザーがいません。",
    can_send: "送信可",
    cannot_send: "送信不可",
    select_user: "{name} を選択",
    history_empty: "送信履歴はまだありません。",
    sender: "送信者",
    recipients: "宛先",
    success: "成功",
    failure: "失敗",
    draft_saved: "下書きを保存済み ({date})",
    sender_meta: "送信元: {sender}",
    template_error: "メール設定の取得に失敗しました。",
    draft_load_error: "下書きの取得に失敗しました。",
    recipient_error: "宛先一覧の取得に失敗しました。",
    history_error: "送信履歴の取得に失敗しました。",
    draft_saving: "下書きを保存中...",
    draft_save_error: "下書きの保存に失敗しました。",
    subject_required: "件名を入力してください。",
    body_required: "本文を入力してください。",
    recipient_required: "送信先を選択してください。",
    sent_ok: "メールを送信しました。",
    send_error: "メール送信に失敗しました。",
    recipient_select: "宛先選択",
    recipient_select_meta: "送信先ユーザーを選択します。全ユーザー送信時は実ログに @everyone として記録します。",
    selected_users: "選択ユーザー",
    all_users: "全ユーザー",
    search: "検索",
    search_placeholder: "表示名 / ID / メール",
    role: "ロール",
    status: "状態",
    user_col: "ユーザー",
    mail_col: "メール",
    send_availability: "送信可否",
    total_count: "総件数",
    compose_title: "メール作成",
    subject: "件名",
    subject_placeholder: "件名を入力してください",
    body: "本文",
    body_placeholder: "本文を入力してください",
    recipient_summary: "送信先",
    selected_count_label: "選択件数",
    send: "送信",
    history_title: "送信履歴",
    history_meta: "将来のお知らせ表示へ流用できる前提で保持します。",
    reload: "再読込",
    loading: "読み込み中です。",
    prev: "前へ",
    next: "次へ",
  },
  "en-us": {
    no_draft: "No draft.",
    everyone: "Everyone",
    none_selected: "None selected",
    user: "User",
    selected_count: "{count} selected",
    selected_more: "{first} and {count} more",
    recipients_empty: "No users found.",
    can_send: "Can send",
    cannot_send: "Cannot send",
    select_user: "Select {name}",
    history_empty: "No mail history yet.",
    sender: "Sender",
    recipients: "Recipients",
    success: "Success",
    failure: "Failure",
    draft_saved: "Draft saved ({date})",
    sender_meta: "From: {sender}",
    template_error: "Failed to load mail settings.",
    draft_load_error: "Failed to load draft.",
    recipient_error: "Failed to load recipients.",
    history_error: "Failed to load history.",
    draft_saving: "Saving draft...",
    draft_save_error: "Failed to save draft.",
    subject_required: "Enter a subject.",
    body_required: "Enter a message body.",
    recipient_required: "Select recipients.",
    sent_ok: "Mail sent.",
    send_error: "Failed to send mail.",
    recipient_select: "Recipients",
    recipient_select_meta: "Select recipient users. When sending to all users, the audit log is recorded as @everyone.",
    selected_users: "Selected Users",
    all_users: "All Users",
    search: "Search",
    search_placeholder: "Display name / ID / email",
    role: "Role",
    status: "Status",
    user_col: "User",
    mail_col: "Mail",
    send_availability: "Deliverability",
    total_count: "Total",
    compose_title: "Compose Mail",
    subject: "Subject",
    subject_placeholder: "Enter a subject",
    body: "Body",
    body_placeholder: "Enter the message body",
    recipient_summary: "Recipients",
    selected_count_label: "Selected",
    send: "Send",
    history_title: "Mail History",
    history_meta: "Stored so it can be reused for future announcements.",
    reload: "Reload",
    loading: "Loading...",
    prev: "Prev",
    next: "Next",
  },
};

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

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_mail.${key}`, fallback, vars) || fallback;
}

function defineMessages() {
  Object.entries(MAIL_MESSAGES).forEach(([locale, messages]) => {
    window.AdminApp?.i18n?.define?.(locale, Object.fromEntries(Object.entries(messages).map(([key, value]) => [`admin_mail.${key}`, value])));
  });
  ["de", "fr", "ru", "es", "zh-cn", "ko"].forEach((locale) => {
    window.AdminApp?.i18n?.define?.(locale, Object.fromEntries(Object.entries(MAIL_MESSAGES["en-us"]).map(([key, value]) => [`admin_mail.${key}`, value])));
  });
}

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
  el.textContent = message || t("no_draft", "No draft.");
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
    $("#adminMailSummaryCount").textContent = t("everyone", "Everyone");
    return;
  }

  const count = state.selectedIds.size;
  if (count === 0) {
    $("#adminMailSummaryRecipients").textContent = t("none_selected", "None selected");
    $("#adminMailSummaryCount").textContent = "0";
    return;
  }

  const first = state.selectedRecipientsSnapshot[0];
  const firstLabel = first
    ? `${first.display_name || first.user_key || t("user", "User")}${first.user_key ? ` (${first.user_key})` : ""}`
    : t("selected_count", "{count} selected", { count });

  $("#adminMailSummaryRecipients").textContent = count === 1 ? firstLabel : t("selected_more", "{first} and {count} more", { first: firstLabel, count: count - 1 });
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
    tbody.innerHTML = `<tr><td colspan="6" class="admin-mail-empty">${escapeHtml(t("recipients_empty", "No users found."))}</td></tr>`;
    $("#adminMailRecipientTotal").textContent = String(state.recipientsTotal);
    $("#adminMailRecipientPage").textContent = String(state.recipientsPage);
    applyRecipientScopeToDom();
    return;
  }

  tbody.innerHTML = state.recipients.map((item) => {
    const checked = state.selectedIds.has(item.user_id) ? "checked" : "";
    const disabled = state.recipientScope === "everyone" ? "disabled" : "";
    const stateLabel = item.can_receive_mail
      ? `<span class="admin-mail-recipient-state" data-state="ok">${escapeHtml(t("can_send", "Can send"))}</span>`
      : `<span class="admin-mail-recipient-state" data-state="ng">${escapeHtml(t("cannot_send", "Cannot send"))}</span>`;
    return `
      <tr>
        <td class="admin-mail-recipient-table__checkbox">
          <input type="checkbox" data-recipient-checkbox value="${item.user_id}" ${checked} ${disabled} aria-label="${escapeHtml(t("select_user", "Select {name}", { name: item.display_name }))}">
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
    root.innerHTML = `<div class="admin-mail-empty">${escapeHtml(t("history_empty", "No mail history yet."))}</div>`;
    return;
  }
  root.innerHTML = state.historyItems.map((item) => `
    <article class="admin-mail-history-card">
      <div class="admin-mail-history-card__head">
        <div class="admin-mail-history-card__subject">${escapeHtml(item.subject)}</div>
        <div class="admin-mail-history-card__meta">${escapeHtml(formatDate(item.sent_at || item.created_at))}</div>
      </div>
      <div class="admin-mail-history-card__meta">${escapeHtml(t("sender", "Sender"))}: ${escapeHtml(item.sender?.display_name || "-")} / ${escapeHtml(t("recipients", "Recipients"))}: ${escapeHtml(item.recipient_summary || "-")}</div>
      <div class="admin-mail-history-card__body">${escapeHtml(item.body)}</div>
      <div class="admin-mail-history-card__stats">
        <span>${escapeHtml(t("success", "Success"))}: ${escapeHtml(item.success_count)}</span>
        <span>${escapeHtml(t("failure", "Failure"))}: ${escapeHtml(item.failure_count)}</span>
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
    setDraftStatus(t("draft_saved", "Draft saved ({date})", { date: formatDate(state.draftUpdatedAt) }));
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
    $("#adminMailSenderMeta").textContent = t("sender_meta", "From: {sender}", { sender: senderText });
  } catch (error) {
    setMessage(error.message || t("template_error", "Failed to load mail settings."), true);
  }
}

async function loadDraft() {
  try {
    const payload = await api.get("/api/admin/mail/draft");
    applyDraftToForm(payload.data?.draft || null);
  } catch (error) {
    setDraftStatus(t("draft_load_error", "Failed to load draft."));
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
    setMessage(error.message || t("recipient_error", "Failed to load recipients."), true);
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
    setMessage(error.message || t("history_error", "Failed to load history."), true);
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
  setDraftStatus(t("draft_saving", "Saving draft..."));

  try {
    const res = await api.put("/api/admin/mail/draft", payload);
    const draft = res.data?.draft || null;
    applyDraftToForm(draft);
    state.lastSavedFingerprint = fingerprintPayload(currentPayload());
  } catch (error) {
    setDraftStatus(t("draft_save_error", "Failed to save draft."));
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
    setMessage(t("subject_required", "Enter a subject."), true);
    return;
  }
  if (!payload.body.trim()) {
    setMessage(t("body_required", "Enter a message body."), true);
    return;
  }
  if (payload.recipient_scope === "selected" && payload.recipient_user_ids.length === 0) {
    setMessage(t("recipient_required", "Select recipients."), true);
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
      recipientLabel = `${item.display_name || item.user_key || t("user", "User")}${item.user_key ? ` (${item.user_key})` : ""}`;
    } else {
      recipientLabel = state.selectedIds.size > 0 ? t("selected_count", "{count} selected", { count: state.selectedIds.size }) : t("none_selected", "None selected");
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
    setMessage(res.message || t("sent_ok", "Mail sent."), false);
    applyDraftToForm(null);
    $("#adminMailRecipientSelectAll").checked = false;
    renderRecipients();
    await loadHistory();
  } catch (error) {
    setMessage(error.message || t("send_error", "Failed to send mail."), true);
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
  defineMessages();
  const titleEls = document.querySelectorAll(".admin-mail-panel .admin-panel__title");
  if (titleEls[0]) titleEls[0].textContent = t("recipient_select", "Recipients");
  if (titleEls[1]) titleEls[1].textContent = t("compose_title", "Compose Mail");
  if (titleEls[2]) titleEls[2].textContent = t("history_title", "Mail History");
  const metaEls = document.querySelectorAll(".admin-mail-panel .admin-panel__meta");
  if (metaEls[0]) metaEls[0].textContent = t("recipient_select_meta", "Select recipient users. When sending to all users, the audit log is recorded as @everyone.");
  if (metaEls[1]) metaEls[1].textContent = t("history_meta", "Stored so it can be reused for future announcements.");
  const chips = document.querySelectorAll(".admin-mail-chip span");
  if (chips[0]) chips[0].textContent = t("selected_users", "Selected Users");
  if (chips[1]) chips[1].textContent = t("all_users", "All Users");
  const labels = document.querySelectorAll(".admin-mail-filters .admin-mail-field > span");
  if (labels[0]) labels[0].textContent = t("search", "Search");
  if (labels[1]) labels[1].textContent = t("role", "Role");
  if (labels[2]) labels[2].textContent = t("status", "Status");
  const searchInput = $("#adminMailRecipientSearch");
  if (searchInput) searchInput.placeholder = t("search_placeholder", "Display name / ID / email");
  const role = $("#adminMailRecipientRole");
  const status = $("#adminMailRecipientStatus");
  if (role?.options[0]) role.options[0].text = t("all", "All");
  if (status?.options[0]) status.options[0].text = t("all", "All");
  const searchBtn = $("#adminMailRecipientSearchButton");
  if (searchBtn) searchBtn.textContent = t("search", "Search");
  const tableHead = document.querySelectorAll(".admin-mail-recipient-table thead th");
  if (tableHead[1]) tableHead[1].textContent = t("user_col", "User");
  if (tableHead[2]) tableHead[2].textContent = t("mail_col", "Mail");
  if (tableHead[3]) tableHead[3].textContent = t("role", "Role");
  if (tableHead[4]) tableHead[4].textContent = t("status", "Status");
  if (tableHead[5]) tableHead[5].textContent = t("send_availability", "Deliverability");
  const selectAll = $("#adminMailRecipientSelectAll");
  if (selectAll) selectAll.setAttribute("aria-label", t("all_users", "All Users"));
  const totalLabel = document.querySelector(".admin-mail-recipient-count");
  if (totalLabel) totalLabel.childNodes[0].textContent = `${t("total_count", "Total")}: `;
  const prev = $("#adminMailRecipientPrevPage");
  if (prev) prev.textContent = t("prev", "Prev");
  const next = $("#adminMailRecipientNextPage");
  if (next) next.textContent = t("next", "Next");
  const subjectLabel = document.querySelector("label[for='adminMailSubject'], #adminMailSubject")?.closest("label")?.querySelector("span");
  if (subjectLabel) subjectLabel.textContent = t("subject", "Subject");
  const subjectInput = $("#adminMailSubject");
  if (subjectInput) subjectInput.placeholder = t("subject_placeholder", "Enter a subject");
  const bodyLabel = document.querySelector("label[for='adminMailBody'], #adminMailBody")?.closest("label")?.querySelector("span");
  if (bodyLabel) bodyLabel.textContent = t("body", "Body");
  const bodyInput = $("#adminMailBody");
  if (bodyInput) bodyInput.placeholder = t("body_placeholder", "Enter the message body");
  const summaryRows = document.querySelectorAll(".admin-mail-summary__row span");
  if (summaryRows[0]) summaryRows[0].textContent = t("recipient_summary", "Recipients");
  if (summaryRows[1]) summaryRows[1].textContent = t("selected_count_label", "Selected");
  const sendBtn = $("#adminMailSendButton");
  if (sendBtn) sendBtn.textContent = t("send", "Send");
  const historyReload = $("#adminMailHistoryReloadButton");
  if (historyReload) historyReload.textContent = t("reload", "Reload");
  bindEvents();
  await Promise.all([loadTemplates(), loadDraft()]);
  await loadRecipients();
  await loadHistory();
  applyRecipientScopeToDom();
}

document.addEventListener("admin:ready", () => {
  void init();
  window.addEventListener("gallery:language-changed", () => {
    if (titleEls[0]) titleEls[0].textContent = t("recipient_select", "Recipients");
    if (titleEls[1]) titleEls[1].textContent = t("compose_title", "Compose Mail");
    if (titleEls[2]) titleEls[2].textContent = t("history_title", "Mail History");
    if (metaEls[0]) metaEls[0].textContent = t("recipient_select_meta", "Select recipient users. When sending to all users, the audit log is recorded as @everyone.");
    if (metaEls[1]) metaEls[1].textContent = t("history_meta", "Stored so it can be reused for future announcements.");
    if (chips[0]) chips[0].textContent = t("selected_users", "Selected Users");
    if (chips[1]) chips[1].textContent = t("all_users", "All Users");
    if (labels[0]) labels[0].textContent = t("search", "Search");
    if (labels[1]) labels[1].textContent = t("role", "Role");
    if (labels[2]) labels[2].textContent = t("status", "Status");
    if (searchInput) searchInput.placeholder = t("search_placeholder", "Display name / ID / email");
    if (role?.options[0]) role.options[0].text = t("all", "All");
    if (status?.options[0]) status.options[0].text = t("all", "All");
    if (searchBtn) searchBtn.textContent = t("search", "Search");
    if (tableHead[1]) tableHead[1].textContent = t("user_col", "User");
    if (tableHead[2]) tableHead[2].textContent = t("mail_col", "Mail");
    if (tableHead[3]) tableHead[3].textContent = t("role", "Role");
    if (tableHead[4]) tableHead[4].textContent = t("status", "Status");
    if (tableHead[5]) tableHead[5].textContent = t("send_availability", "Deliverability");
    if (selectAll) selectAll.setAttribute("aria-label", t("all_users", "All Users"));
    if (totalLabel) totalLabel.childNodes[0].textContent = `${t("total_count", "Total")}: `;
    if (prev) prev.textContent = t("prev", "Prev");
    if (next) next.textContent = t("next", "Next");
    if (subjectLabel) subjectLabel.textContent = t("subject", "Subject");
    if (subjectInput) subjectInput.placeholder = t("subject_placeholder", "Enter a subject");
    if (bodyLabel) bodyLabel.textContent = t("body", "Body");
    if (bodyInput) bodyInput.placeholder = t("body_placeholder", "Enter the message body");
    if (summaryRows[0]) summaryRows[0].textContent = t("recipient_summary", "Recipients");
    if (summaryRows[1]) summaryRows[1].textContent = t("selected_count_label", "Selected");
    if (sendBtn) sendBtn.textContent = t("send", "Send");
    if (historyReload) historyReload.textContent = t("reload", "Reload");
    updateSummary();
    renderRecipients();
    renderHistory();
    applyDraftToForm({
      ...currentPayload(),
      selected_recipients: state.selectedRecipientsSnapshot,
      updated_at: state.draftUpdatedAt,
    });
  });
}, { once: true });
