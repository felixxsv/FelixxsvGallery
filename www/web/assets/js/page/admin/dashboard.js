function byId(id) {
  return document.getElementById(id);
}

const DASHBOARD_MESSAGES = {
  ja: {
    elapsed_hours: "{hours}時間 {minutes}分",
    elapsed_minutes: "{minutes}分 {seconds}秒",
    elapsed_seconds: "{seconds}秒",
    not_set: "未設定",
    usage_label: "使用率",
    active_users_empty: "現在アクセス中のユーザーはいません。",
    active_user_head_icon: "アイコン",
    active_user_head_name: "表示名",
    active_user_head_id: "ユーザーID",
    active_user_head_status: "状態",
    active_user_head_elapsed: "セッション時間",
    online: "オンライン",
    recent_logs_empty: "直近の操作ログはありません。",
    recent_logs_head_date: "日時",
    recent_logs_head_action: "操作種別",
    recent_logs_head_summary: "概要",
    recent_logs_head_result: "結果",
    recent_logs_head_actor: "実行者",
    storage_loading: "使用状況を読み込み中です…",
    storage_idle: "使用状況はまだ読み込まれていません。",
    storage_placeholder: "使用状況を取得するとここに表示します。",
    storage_error: "ストレージ使用状況の取得に失敗しました。",
    no_history: "まだ実行履歴がありません。",
    none: "なし",
    pending_exists: "実行待ちがあります",
    queue_run: "手動実行を予約",
    no_issues: "直近の問題はありません。",
    no_detail: "詳細情報なし",
    untitled: "タイトル未設定",
    unknown_user: "投稿者不明",
    clock_error: "時計設定の更新に失敗しました。",
    dashboard_error: "ダッシュボードの取得に失敗しました。",
    integrity_run_success: "整合性チェックを実行キューへ追加しました。",
    integrity_run_error: "整合性チェックの実行予約に失敗しました。",
  },
  "en-us": {
    elapsed_hours: "{hours}h {minutes}m",
    elapsed_minutes: "{minutes}m {seconds}s",
    elapsed_seconds: "{seconds}s",
    not_set: "Not set",
    usage_label: "Usage",
    active_users_empty: "No users are currently active.",
    active_user_head_icon: "Icon",
    active_user_head_name: "Display Name",
    active_user_head_id: "User ID",
    active_user_head_status: "Status",
    active_user_head_elapsed: "Session",
    online: "Online",
    recent_logs_empty: "There are no recent activity logs.",
    recent_logs_head_date: "Date",
    recent_logs_head_action: "Action",
    recent_logs_head_summary: "Summary",
    recent_logs_head_result: "Result",
    recent_logs_head_actor: "Actor",
    storage_loading: "Loading storage usage...",
    storage_idle: "Storage usage has not been loaded yet.",
    storage_placeholder: "Storage usage will appear here after loading.",
    storage_error: "Failed to load storage usage.",
    no_history: "No execution history yet.",
    none: "None",
    pending_exists: "A run is already queued",
    queue_run: "Queue Manual Run",
    no_issues: "No recent issues.",
    no_detail: "No details",
    untitled: "Untitled",
    unknown_user: "Unknown uploader",
    clock_error: "Failed to update clock setting.",
    dashboard_error: "Failed to load dashboard.",
    integrity_run_success: "Integrity check queued.",
    integrity_run_error: "Failed to queue integrity check.",
    title_clock: "Clock",
    meta_clock: "The display mode is stored per administrator.",
    mode_digital: "Digital",
    mode_analog: "Analog",
    title_latest: "Latest Image",
    meta_latest: "Shows the newest image.",
    latest_empty: "No image available.",
    title_summary: "Current Overview",
    meta_summary: "Shows the gallery-wide counts and storage summary.",
    stat_online_users: "Online Users",
    stat_today_uploads: "Uploads Today",
    stat_public_count: "Public Images",
    stat_private_count: "Private Images",
    stat_quarantine_count: "Quarantine",
    stat_storage_used: "Storage Usage",
    title_storage: "Storage Monitor",
    meta_storage: "Automatically loads storage_root usage. Shares the refresh interval with the settings page.",
    last_fetched: "Last fetched",
    auto_refresh: "Auto refresh",
    manual_only: "Manual only",
    refresh: "Refresh",
    metric_directory_size: "Directory size",
    metric_filesystem_usage: "Used / Total",
    metric_filesystem_free: "Free space",
    title_integrity: "Integrity Check",
    meta_integrity: "Shows the latest status, recent issues, and manual-run queue.",
    stat_integrity_status: "Latest status",
    stat_integrity_last_run: "Last run",
    stat_integrity_last_success: "Last success",
    stat_integrity_pending: "Pending jobs",
    title_online_users: "Online Users",
    meta_online_users: "Shows active users and their session duration.",
    title_recent_logs: "Recent Activity Logs",
    meta_recent_logs: "Shows recent audit logs.",
  },
};

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_dashboard.${key}`, fallback, vars) || fallback;
}

function defineMessages() {
  Object.entries(DASHBOARD_MESSAGES).forEach(([locale, messages]) => {
    window.AdminApp?.i18n?.define?.(locale, Object.fromEntries(Object.entries(messages).map(([key, value]) => [`admin_dashboard.${key}`, value])));
  });
  ["de", "fr", "ru", "es", "zh-cn", "ko"].forEach((locale) => {
    window.AdminApp?.i18n?.define?.(locale, Object.fromEntries(Object.entries(DASHBOARD_MESSAGES["en-us"]).map(([key, value]) => [`admin_dashboard.${key}`, value])));
  });
}

function applyStaticTranslations() {
  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  };
  const setClosestText = (selector, closestSelector, targetSelector, value) => {
    const base = document.querySelector(selector);
    const node = base?.closest(closestSelector)?.querySelector(targetSelector);
    if (node) node.textContent = value;
  };
  const setAttr = (selector, attr, value) => {
    const node = document.querySelector(selector);
    if (node) node.setAttribute(attr, value);
  };
  setText(".admin-dashboard-card--clock .admin-panel__title", t("title_clock", "Clock"));
  setText(".admin-dashboard-card--clock .admin-panel__meta", t("meta_clock", "The display mode is stored per administrator."));
  setText("#adminClockModeDigital", t("mode_digital", "Digital"));
  setText("#adminClockModeAnalog", t("mode_analog", "Analog"));
  setAttr(".admin-dashboard-card--clock .admin-segmented-control", "aria-label", t("title_clock", "Clock"));

  setText(".admin-dashboard-card--latest .admin-panel__title", t("title_latest", "Latest Image"));
  setText(".admin-dashboard-card--latest .admin-panel__meta", t("meta_latest", "Shows the newest image."));
  setText("#adminDashboardLatestImagePlaceholder", t("latest_empty", "No image available."));

  setText(".admin-dashboard-card--stats .admin-panel__title", t("title_summary", "Current Overview"));
  setText(".admin-dashboard-card--stats .admin-panel__meta", t("meta_summary", "Shows the gallery-wide counts and storage summary."));
  setClosestText("#adminStatOnlineUsers", ".admin-stat", ".admin-stat__label", t("stat_online_users", "Online Users"));
  setClosestText("#adminStatTodayUploads", ".admin-stat", ".admin-stat__label", t("stat_today_uploads", "Uploads Today"));
  setClosestText("#adminStatPublicCount", ".admin-stat", ".admin-stat__label", t("stat_public_count", "Public Images"));
  setClosestText("#adminStatPrivateCount", ".admin-stat", ".admin-stat__label", t("stat_private_count", "Private Images"));
  setClosestText("#adminStatQuarantineCount", ".admin-stat", ".admin-stat__label", t("stat_quarantine_count", "Quarantine"));
  setClosestText("#adminStatStorageUsed", ".admin-stat", ".admin-stat__label", t("stat_storage_used", "Storage Usage"));

  setText(".admin-dashboard-card--storage .admin-panel__title", t("title_storage", "Storage Monitor"));
  setText(".admin-dashboard-card--storage .admin-panel__meta", t("meta_storage", "Automatically loads storage_root usage. Shares the refresh interval with the settings page."));
  setText(".admin-dashboard-storage__timestamp", `${t("last_fetched", "Last fetched")}: `);
  const storageGeneratedAt = document.getElementById("adminDashboardStorageGeneratedAt");
  if (storageGeneratedAt?.parentElement) {
    storageGeneratedAt.parentElement.firstChild.textContent = `${t("last_fetched", "Last fetched")}: `;
  }
  setText(".admin-dashboard-refresh-interval > span", t("auto_refresh", "Auto refresh"));
  setAttr("#adminDashboardStorageRefreshInterval", "aria-label", t("auto_refresh", "Auto refresh"));
  setText("#adminDashboardStorageRefreshInterval option[value='0']", t("manual_only", "Manual only"));
  setText("#adminDashboardStorageRefreshButton", t("refresh", "Refresh"));
  setText("#adminDashboardStorageLoading", t("storage_loading", "Loading storage usage..."));
  setText("#adminDashboardStoragePrimaryPath", storageUsageState.loaded ? (document.getElementById("adminDashboardStoragePrimaryPath")?.textContent || "") : t("storage_placeholder", "Storage usage will appear here after loading."));
  setClosestText("#adminDashboardStorageDirectorySize", ".admin-dashboard-storage__metric", "span", t("metric_directory_size", "Directory size"));
  setClosestText("#adminDashboardStorageFilesystemUsage", ".admin-dashboard-storage__metric", "span", t("metric_filesystem_usage", "Used / Total"));
  setClosestText("#adminDashboardStorageFilesystemFree", ".admin-dashboard-storage__metric", "span", t("metric_filesystem_free", "Free space"));

  setText(".admin-dashboard-card--integrity .admin-panel__title", t("title_integrity", "Integrity Check"));
  setText(".admin-dashboard-card--integrity .admin-panel__meta", t("meta_integrity", "Shows the latest status, recent issues, and manual-run queue."));
  setText("#adminDashboardIntegrityRunButton", t("queue_run", "Queue Manual Run"));
  setClosestText("#adminDashboardIntegrityStatus", ".admin-stat", ".admin-stat__label", t("stat_integrity_status", "Latest status"));
  setClosestText("#adminDashboardIntegrityLastRun", ".admin-stat", ".admin-stat__label", t("stat_integrity_last_run", "Last run"));
  setClosestText("#adminDashboardIntegrityLastSuccess", ".admin-stat", ".admin-stat__label", t("stat_integrity_last_success", "Last success"));
  setClosestText("#adminDashboardIntegrityPending", ".admin-stat", ".admin-stat__label", t("stat_integrity_pending", "Pending jobs"));

  setText(".admin-dashboard-card--users .admin-panel__title", t("title_online_users", "Online Users"));
  setText(".admin-dashboard-card--users .admin-panel__meta", t("meta_online_users", "Shows active users and their session duration."));
  setText(".admin-dashboard-card--logs .admin-panel__title", t("title_recent_logs", "Recent Activity Logs"));
  setText(".admin-dashboard-card--logs .admin-panel__meta", t("meta_recent_logs", "Shows recent audit logs."));
}

function showClock(mode) {
  const digital = byId("adminDashboardClockDigital");
  const analog = byId("adminDashboardClockAnalog");
  if (digital) digital.hidden = mode !== "digital";
  if (analog) analog.hidden = mode !== "analog";
}

function formatElapsed(sec) {
  const total = Math.max(0, Number(sec) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return t("elapsed_hours", "{hours}h {minutes}m", { hours, minutes });
  if (minutes > 0) return t("elapsed_minutes", "{minutes}m {seconds}s", { minutes, seconds });
  return t("elapsed_seconds", "{seconds}s", { seconds });
}

function formatStorage(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1).replace(".0", "")} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 ** 2)).toFixed(1).replace(".0", "")} MB`;
  if (n < 1024 ** 4) return `${(n / (1024 ** 3)).toFixed(1).replace(".0", "")} GB`;
  return `${(n / (1024 ** 4)).toFixed(1).replace(".0", "")} TB`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatPercent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n.toFixed(digits)}%`;
}

function clampRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}

const STORAGE_USAGE_REFRESH_INTERVAL_KEY = "admin.storageUsage.refreshIntervalMs";
const STORAGE_USAGE_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_USAGE_ALLOWED_INTERVALS = [0, 60 * 1000, 3 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];
const DASHBOARD_LIVE_REFRESH_KEY = "admin.dashboard.liveRefreshMs";
const DASHBOARD_LIVE_ALLOWED_INTERVALS = [0, 3000, 5000, 10000, 30000, 60000];
const DASHBOARD_LIVE_DEFAULT_INTERVAL_MS = 3000;

const storageUsageState = {
  loading: false,
  loaded: false,
  error: "",
  data: null,
  timerId: null,
};

const dashboardState = {
  loadPromise: null,
  lastSnapshot: "",
  latestData: null,
  latestImageItem: null,
  liveWatcher: null,
  liveTimerId: null,
  liveVisibilityBound: false,
  liveStorageBound: false,
  elapsedTimerId: null,
};

function normalizeStorageUsageRefreshInterval(value) {
  const ms = Number(value);
  return STORAGE_USAGE_ALLOWED_INTERVALS.includes(ms) ? ms : STORAGE_USAGE_DEFAULT_INTERVAL_MS;
}

function getStorageUsageRefreshInterval() {
  try {
    const raw = window.localStorage.getItem(STORAGE_USAGE_REFRESH_INTERVAL_KEY);
    return normalizeStorageUsageRefreshInterval(raw == null ? STORAGE_USAGE_DEFAULT_INTERVAL_MS : Number(raw));
  } catch {
    return STORAGE_USAGE_DEFAULT_INTERVAL_MS;
  }
}

function setStorageUsageRefreshInterval(value) {
  const normalized = normalizeStorageUsageRefreshInterval(value);
  try {
    window.localStorage.setItem(STORAGE_USAGE_REFRESH_INTERVAL_KEY, String(normalized));
  } catch {
    return normalized;
  }
  return normalized;
}

function normalizeDashboardLiveRefreshInterval(value) {
  const ms = Number(value);
  return DASHBOARD_LIVE_ALLOWED_INTERVALS.includes(ms) ? ms : DASHBOARD_LIVE_DEFAULT_INTERVAL_MS;
}

function getDashboardLiveRefreshInterval() {
  try {
    const raw = window.localStorage.getItem(DASHBOARD_LIVE_REFRESH_KEY);
    return normalizeDashboardLiveRefreshInterval(raw == null ? DASHBOARD_LIVE_DEFAULT_INTERVAL_MS : Number(raw));
  } catch {
    return DASHBOARD_LIVE_DEFAULT_INTERVAL_MS;
  }
}

function clearDashboardLiveRefreshTimer() {
  if (dashboardState.liveTimerId) {
    window.clearTimeout(dashboardState.liveTimerId);
    dashboardState.liveTimerId = null;
  }
}

function clearDashboardStorageTimer() {
  if (storageUsageState.timerId) {
    window.clearTimeout(storageUsageState.timerId);
    storageUsageState.timerId = null;
  }
}

function setDashboardStorageRingUsage(element, ratio) {
  if (!element) return;
  element.style.setProperty("--usage-ratio", String(clampRatio(ratio)));
}

function renderDashboardStoragePath(element, pathText, percentText, ratio) {
  if (!element) return;
  const normalizedPercent = percentText || "-%";
  const normalizedPath = pathText || t("not_set", "Not set");
  element.style.setProperty("--usage-ratio", String(clampRatio(ratio)));
  element.innerHTML = `
    <div class="admin-dashboard-storage__path-text"></div>
    <div class="admin-dashboard-storage__usage-row">
      <span class="admin-dashboard-storage__usage-label">${t("usage_label", "Usage")}</span>
      <span class="admin-dashboard-storage__usage-value">${normalizedPercent}</span>
    </div>
    <div class="admin-dashboard-storage__usage-bar" aria-hidden="true">
      <span class="admin-dashboard-storage__usage-fill"></span>
    </div>
  `;
  const textEl = element.querySelector(".admin-dashboard-storage__path-text");
  if (textEl) {
    textEl.textContent = normalizedPath;
  }
}

function updateDigitalClock() {
  const el = byId("adminDashboardClockDigital");
  if (!el || el.hidden) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const timeEl = el.querySelector("[data-clock-time]");
  const dateEl = el.querySelector("[data-clock-date]");
  if (timeEl) timeEl.textContent = text;
  if (dateEl) dateEl.textContent = date;
}

function updateAnalogClock() {
  const root = byId("adminDashboardClockAnalog");
  if (!root || root.hidden) return;
  const now = new Date();
  const sec = now.getSeconds();
  const min = now.getMinutes();
  const hour = now.getHours() % 12;
  const hourDeg = hour * 30 + min * 0.5;
  const minDeg = min * 6 + sec * 0.1;
  const secDeg = sec * 6;
  const hourHand = root.querySelector("[data-clock-hand='hour']");
  const minHand = root.querySelector("[data-clock-hand='minute']");
  const secHand = root.querySelector("[data-clock-hand='second']");
  if (hourHand) hourHand.style.transform = `translateX(-50%) rotate(${hourDeg}deg)`;
  if (minHand) minHand.style.transform = `translateX(-50%) rotate(${minDeg}deg)`;
  if (secHand) secHand.style.transform = `translateX(-50%) rotate(${secDeg}deg)`;
}

function startClockLoop() {
  updateDigitalClock();
  updateAnalogClock();
  window.setInterval(() => {
    updateDigitalClock();
    updateAnalogClock();
  }, 1000);
}

function startElapsedLoop() {
  if (dashboardState.elapsedTimerId) {
    return;
  }
  dashboardState.elapsedTimerId = window.setInterval(() => {
    const nodes = document.querySelectorAll("[data-session-elapsed]");
    for (const node of nodes) {
      const next = Number(node.dataset.sessionElapsed || 0) + 1;
      node.dataset.sessionElapsed = String(next);
      node.textContent = formatElapsed(next);
    }
  }, 1000);
}

function renderStats(stats) {
  const refs = {
    online: byId("adminStatOnlineUsers"),
    upload: byId("adminStatTodayUploads"),
    publicCount: byId("adminStatPublicCount"),
    privateCount: byId("adminStatPrivateCount"),
    quarantine: byId("adminStatQuarantineCount"),
    storageUsed: byId("adminStatStorageUsed"),
    storageTotal: byId("adminStatStorageTotal"),
  };
  if (refs.online) refs.online.textContent = String(stats.online_user_count ?? 0);
  if (refs.upload) refs.upload.textContent = String(stats.today_upload_count ?? 0);
  if (refs.publicCount) refs.publicCount.textContent = String(stats.public_count ?? 0);
  if (refs.privateCount) refs.privateCount.textContent = String(stats.private_count ?? 0);
  if (refs.quarantine) refs.quarantine.textContent = String(stats.quarantine_count ?? 0);
  if (refs.storageUsed) refs.storageUsed.textContent = formatStorage(stats.storage_used_bytes);
  if (refs.storageTotal) refs.storageTotal.textContent = formatStorage(stats.storage_total_bytes);
}

function renderActiveUsers(items) {
  const container = byId("adminDashboardActiveUsers");
  if (!container) return;

  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = t("active_users_empty", "No users are currently active.");
    container.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "admin-list-table-head admin-list-table-head--users";
  head.innerHTML = `
    <span>${t("active_user_head_icon", "Icon")}</span>
    <span>${t("active_user_head_name", "Display Name")}</span>
    <span>${t("active_user_head_id", "User ID")}</span>
    <span>${t("active_user_head_status", "Status")}</span>
    <span>${t("active_user_head_elapsed", "Session")}</span>
  `;
  container.appendChild(head);

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "admin-active-user";
    const avatar = item.avatar_url
      ? `<img src="${item.avatar_url}" alt="">`
      : `${(item.display_name || "?").slice(0, 1)}`;
    row.innerHTML = `
      <div class="admin-active-user__avatar">${avatar}</div>
      <div class="admin-active-user__display">${item.display_name || "-"}</div>
      <div class="admin-active-user__id">@${item.user_key || "-"}</div>
      <div class="admin-active-user__status"><span class="admin-status-badge admin-status-badge--online">${t("online", "Online")}</span></div>
      <div class="admin-active-user__elapsed" data-session-elapsed="${Number(item.session_elapsed_sec || 0)}">${formatElapsed(item.session_elapsed_sec)}</div>
    `;
    container.appendChild(row);
  }
}

function renderAuditLogs(items) {
  const container = byId("adminDashboardRecentLogs");
  if (!container) return;

  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = t("recent_logs_empty", "There are no recent activity logs.");
    container.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "admin-list-table-head admin-list-table-head--logs";
  head.innerHTML = `
    <span>${t("recent_logs_head_date", "Date")}</span>
    <span>${t("recent_logs_head_action", "Action")}</span>
    <span>${t("recent_logs_head_summary", "Summary")}</span>
    <span>${t("recent_logs_head_result", "Result")}</span>
    <span>${t("recent_logs_head_actor", "Actor")}</span>
  `;
  container.appendChild(head);

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "admin-log-item";
    const normalizedResult = String(item.result || "").trim().toLowerCase();
    if (normalizedResult) {
      row.dataset.result = normalizedResult;
    }
    row.innerHTML = `
      <div class="admin-log-item__created">${formatDateTime(item.created_at)}</div>
      <div class="admin-log-item__action">${item.action_type || "-"}</div>
      <div class="admin-log-item__summary">${item.summary || "-"}</div>
      <div class="admin-log-item__result"><span class="admin-log-item__badge">${item.result || "-"}</span></div>
      <div class="admin-log-item__actor">${item.actor?.display_name || "system"}</div>
    `;
    container.appendChild(row);
  }
}

function syncDashboardStorageIntervalControl() {
  const select = byId("adminDashboardStorageRefreshInterval");
  if (select) {
    select.value = String(getStorageUsageRefreshInterval());
  }
}

function renderDashboardStorageUsage() {
  const loadingEl = byId("adminDashboardStorageLoading");
  const messageEl = byId("adminDashboardStorageMessage");
  const contentEl = byId("adminDashboardStorageContent");
  const refreshButton = byId("adminDashboardStorageRefreshButton");
  const intervalSelect = byId("adminDashboardStorageRefreshInterval");
  const generatedAtEl = byId("adminDashboardStorageGeneratedAt");
  const labelEl = byId("adminDashboardStoragePrimaryLabel");
  const pathEl = byId("adminDashboardStoragePrimaryPath");
  const directorySizeEl = byId("adminDashboardStorageDirectorySize");
  const filesystemUsageEl = byId("adminDashboardStorageFilesystemUsage");
  const filesystemFreeEl = byId("adminDashboardStorageFilesystemFree");
  const percentEl = byId("adminDashboardStorageUsagePercent");
  const ringEl = byId("adminDashboardStorageRing");

  if (!loadingEl || !messageEl || !contentEl) return;

  if (refreshButton) refreshButton.disabled = storageUsageState.loading;
  if (intervalSelect) {
    intervalSelect.disabled = storageUsageState.loading;
    intervalSelect.value = String(getStorageUsageRefreshInterval());
  }

  loadingEl.hidden = !storageUsageState.loading && storageUsageState.loaded;
  loadingEl.textContent = storageUsageState.loading ? t("storage_loading", "Loading storage usage...") : t("storage_idle", "Storage usage has not been loaded yet.");
  messageEl.hidden = !storageUsageState.error;
  messageEl.textContent = storageUsageState.error || "";
  messageEl.classList.toggle("is-error", Boolean(storageUsageState.error));
  contentEl.hidden = !storageUsageState.loaded || !storageUsageState.data;

  if (!storageUsageState.loaded || !storageUsageState.data) {
    if (generatedAtEl) generatedAtEl.textContent = "-";
    if (labelEl) labelEl.textContent = "storage_root";
    renderDashboardStoragePath(pathEl, t("storage_placeholder", "Storage usage will appear here after loading."), "-%", 0);
    if (directorySizeEl) directorySizeEl.textContent = "-";
    if (filesystemUsageEl) filesystemUsageEl.textContent = "-";
    if (filesystemFreeEl) filesystemFreeEl.textContent = "-";
    if (percentEl) percentEl.textContent = "-%";
    setDashboardStorageRingUsage(ringEl, 0);
    return;
  }

  const data = storageUsageState.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const primary = data.primary || items.find((item) => item.key === data.primary_key) || items[0] || null;
  if (generatedAtEl) generatedAtEl.textContent = formatDateTime(data.generated_at);
  if (!primary) return;
  if (labelEl) labelEl.textContent = primary.label || primary.key || "storage_root";
  const usagePercentText = formatPercent(primary.filesystem_usage_percent);
  renderDashboardStoragePath(pathEl, primary.path || t("not_set", "Not set"), usagePercentText, primary.filesystem_usage_ratio);
  if (directorySizeEl) directorySizeEl.textContent = formatStorage(primary.directory_size_bytes);
  if (filesystemUsageEl) filesystemUsageEl.textContent = `${formatStorage(primary.filesystem_used_bytes)} / ${formatStorage(primary.filesystem_total_bytes)}`;
  if (filesystemFreeEl) filesystemFreeEl.textContent = formatStorage(primary.filesystem_free_bytes);
  if (percentEl) percentEl.textContent = usagePercentText;
  setDashboardStorageRingUsage(ringEl, primary.filesystem_usage_ratio);
}

async function loadDashboardStorageUsage({ force = false, silent = false } = {}) {
  if (storageUsageState.loading) return;
  if (storageUsageState.loaded && !force) {
    renderDashboardStorageUsage();
    scheduleDashboardStorageRefresh();
    return;
  }

  const app = window.AdminApp;
  storageUsageState.loading = true;
  storageUsageState.error = "";
  renderDashboardStorageUsage();

  try {
    const payload = await app.api.get("/api/admin/settings/storage/usage");
    storageUsageState.data = payload.data || null;
    storageUsageState.loaded = true;
  } catch (error) {
    storageUsageState.error = error.message || t("storage_error", "Failed to load storage usage.");
    storageUsageState.data = null;
    storageUsageState.loaded = false;
    if (!silent) {
      window.AdminApp?.toast?.error?.(storageUsageState.error);
    }
  } finally {
    storageUsageState.loading = false;
    renderDashboardStorageUsage();
    scheduleDashboardStorageRefresh();
  }
}

function scheduleDashboardStorageRefresh() {
  clearDashboardStorageTimer();
  if (document.visibilityState === "hidden") return;
  const intervalMs = getStorageUsageRefreshInterval();
  if (!intervalMs) return;
  storageUsageState.timerId = window.setTimeout(async () => {
    await loadDashboardStorageUsage({ force: true, silent: true });
    scheduleDashboardStorageRefresh();
  }, intervalMs);
}

function bindDashboardStorageUsage() {
  byId("adminDashboardStorageRefreshButton")?.addEventListener("click", () => {
    void loadDashboardStorageUsage({ force: true });
  });

  byId("adminDashboardStorageRefreshInterval")?.addEventListener("change", (event) => {
    const value = setStorageUsageRefreshInterval(event.currentTarget?.value);
    event.currentTarget.value = String(value);
    scheduleDashboardStorageRefresh();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void loadDashboardStorageUsage({ force: true, silent: true });
      return;
    }
    clearDashboardStorageTimer();
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_USAGE_REFRESH_INTERVAL_KEY) return;
    syncDashboardStorageIntervalControl();
    scheduleDashboardStorageRefresh();
  });
}

function renderIntegritySummary(summary) {
  const latestStatus = byId("adminDashboardIntegrityStatus");
  const latestRun = byId("adminDashboardIntegrityLastRun");
  const lastSuccess = byId("adminDashboardIntegrityLastSuccess");
  const pending = byId("adminDashboardIntegrityPending");
  const container = byId("adminDashboardIntegrityIssues");
  const action = byId("adminDashboardIntegrityRunButton");

  if (latestStatus) latestStatus.textContent = summary?.latest_status || "never";
  if (latestRun) {
    const run = summary?.last_run;
    if (!run) {
      latestRun.textContent = t("no_history", "No execution history yet.");
    } else {
      const severity = summary?.severity_counts || {};
      latestRun.textContent = `${formatDateTime(run.finished_at || run.started_at || run.requested_at)} / warning ${severity.warning || 0} / error ${severity.error || 0}`;
    }
  }
  if (lastSuccess) lastSuccess.textContent = formatDateTime(summary?.last_success_at);
  if (pending) {
    pending.textContent = summary?.has_pending
      ? `${summary.pending_run?.status || "queued"} / ${formatDateTime(summary.pending_run?.requested_at || summary.pending_run?.started_at)}`
      : t("none", "None");
  }
  if (action) {
    action.disabled = Boolean(summary?.has_pending);
    action.textContent = summary?.has_pending ? t("pending_exists", "A run is already queued") : t("queue_run", "Queue Manual Run");
  }
  if (!container) return;

  container.innerHTML = "";
  const items = summary?.issue_items || [];
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = t("no_issues", "No recent issues.");
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "admin-log-item";
    const severity = String(item.severity || "warning").toLowerCase();
    row.dataset.severity = severity;
    const detail = [];
    if (item.file_path) detail.push(item.file_path);
    if (item.image_id) detail.push(`image:${item.image_id}`);
    if (item.derivative_kind) detail.push(item.derivative_kind);
    row.innerHTML = `
      <div class="admin-log-item__created">${formatDateTime(item.created_at)}</div>
      <div class="admin-log-item__action">${item.issue_code || "-"}</div>
      <div class="admin-log-item__summary">${detail.join(" / ") || t("no_detail", "No details")}</div>
      <div class="admin-log-item__result"><span class="admin-log-item__badge">${severity}</span></div>
      <div class="admin-log-item__actor">${item.gallery || "integrity"}</div>
    `;
    container.appendChild(row);
  }
}

function buildDashboardDetail(item) {
  return {
    image_id: item.image_id || item.id || null,
    title: item.title || t("untitled", "Untitled"),
    alt: item.alt || "",
    posted_at: item.posted_at || null,
    shot_at: item.shot_at || null,
    like_count: Number(item.like_count || 0),
    view_count: Number(item.view_count || 0),
    user: item.user || {
      display_name: item.uploader_display_name || t("unknown_user", "Unknown uploader"),
      user_key: item.uploader_user_key || "-",
      avatar_url: item.uploader_avatar_url || item.uploader_avatar_path || "",
    },
    tags: Array.isArray(item.tags) ? item.tags : [],
    color_tags: Array.isArray(item.color_tags) ? item.color_tags : [],
    file_size_bytes: item.file_size_bytes ?? null,
    image_width: item.image_width ?? item.width ?? null,
    image_height: item.image_height ?? item.height ?? null,
    admin_meta: item.admin_meta || {},
    preview_url: item.preview_url || item.thumbnail_url || item.url || "",
    original_url: item.original_url || item.preview_url || item.thumbnail_url || item.url || "",
  };
}

async function loadAdminContentDetail(imageId) {
  const app = window.AdminApp;
  const payload = await app.api.get(`/api/admin/content/${imageId}`);
  const content = payload.data?.content || {};
  return buildDashboardDetail(content);
}

function renderLatestImage(item) {
  dashboardState.latestImageItem = item || null;
  const card = byId("adminDashboardLatestImageCard");
  const image = byId("adminDashboardLatestImage");
  const title = byId("adminDashboardLatestImageTitle");
  const meta = byId("adminDashboardLatestImageMeta");
  const stats = byId("adminDashboardLatestImageStats");
  const placeholder = byId("adminDashboardLatestImagePlaceholder");

  if (!card || !image || !title || !meta || !stats || !placeholder) return;

  if (!item || !item.preview_url) {
    card.hidden = true;
    placeholder.hidden = false;
    return;
  }

  image.src = item.preview_url;
  image.alt = item.title || "latest image";
  title.textContent = item.title || t("untitled", "Untitled");
  meta.textContent = `${formatDateTime(item.posted_at)} ・ ${item.user?.display_name || t("unknown_user", "Unknown uploader")}`;
  stats.textContent = `♥ ${item.like_count_short || "0"} ・ ${item.view_count_short || "0"}`;
  card.hidden = false;
  placeholder.hidden = true;
}

async function saveClockMode(mode) {
  const app = window.AdminApp;
  const response = await fetch(`${app.appBase}/api/admin/dashboard/preferences`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clock_mode: mode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload?.error?.message || t("clock_error", "Failed to update clock setting."));
  }
  return payload;
}

async function queueIntegrityRun() {
  const app = window.AdminApp;
  return app.api.post("/api/admin/integrity/run", {});
}

function buildDashboardSnapshot(data) {
  return JSON.stringify({
    stats: data.stats || {},
    online_user_count: data.online_user_count ?? 0,
    active_users: Array.isArray(data.active_users)
      ? data.active_users.map((item) => ({
          user_id: item.user_id,
          display_name: item.display_name,
          user_key: item.user_key,
          avatar_url: item.avatar_url || "",
          session_elapsed_sec: Number(item.session_elapsed_sec || 0),
          last_seen_at: item.last_seen_at || "",
        }))
      : [],
    recent_audit_logs: Array.isArray(data.recent_audit_logs)
      ? data.recent_audit_logs.map((item) => ({
          id: item.id,
          created_at: item.created_at,
          action_type: item.action_type,
          summary: item.summary,
          result: item.result,
          actor: item.actor?.display_name || item.actor?.user_key || "",
        }))
      : [],
    latest_image: data.latest_image ? {
      image_id: data.latest_image.image_id || data.latest_image.id,
      posted_at: data.latest_image.posted_at,
      title: data.latest_image.title,
      preview_url: data.latest_image.preview_url,
      like_count_short: data.latest_image.like_count_short,
      view_count_short: data.latest_image.view_count_short,
    } : null,
    integrity_summary: data.integrity_summary || {},
    clock_mode: data.clock_mode || "digital",
  });
}

async function loadDashboard({ silent = false, force = false } = {}) {
  if (dashboardState.loadPromise) {
    return dashboardState.loadPromise;
  }

  const app = window.AdminApp;
  dashboardState.loadPromise = app.api.get("/api/admin/dashboard")
    .then((payload) => {
      const data = payload.data || {};
      const snapshot = buildDashboardSnapshot(data);
      if (!force && silent && snapshot === dashboardState.lastSnapshot) {
        return;
      }
      dashboardState.lastSnapshot = snapshot;
      dashboardState.latestData = data;

      renderStats({
        online_user_count: data.online_user_count ?? 0,
        ...(data.stats || {}),
      });
      renderActiveUsers(data.active_users || []);
      renderAuditLogs(data.recent_audit_logs || []);
      renderLatestImage(data.latest_image || null);
      renderIntegritySummary(data.integrity_summary || {});
      const mode = data.clock_mode === "analog" ? "analog" : "digital";
      const digitalBtn = byId("adminClockModeDigital");
      const analogBtn = byId("adminClockModeAnalog");
      if (digitalBtn) digitalBtn.classList.toggle("is-active", mode === "digital");
      if (analogBtn) analogBtn.classList.toggle("is-active", mode === "analog");
      showClock(mode);
      updateDigitalClock();
      updateAnalogClock();
    })
    .catch((error) => {
      if (!silent) {
        window.AdminApp?.toast?.error?.(error?.message || t("dashboard_error", "Failed to load dashboard."));
      }
    })
    .finally(() => {
      dashboardState.loadPromise = null;
    });

  return dashboardState.loadPromise;
}

function bindClockButtons() {
  const digitalBtn = byId("adminClockModeDigital");
  const analogBtn = byId("adminClockModeAnalog");

  if (digitalBtn) {
    digitalBtn.addEventListener("click", async () => {
      try {
        await saveClockMode("digital");
        digitalBtn.classList.add("is-active");
        analogBtn?.classList.remove("is-active");
        showClock("digital");
      } catch (error) {
        window.AdminApp?.toast?.error?.(error?.message || t("clock_error", "Failed to update clock setting."));
      }
    });
  }

  if (analogBtn) {
    analogBtn.addEventListener("click", async () => {
      try {
        await saveClockMode("analog");
        analogBtn.classList.add("is-active");
        digitalBtn?.classList.remove("is-active");
        showClock("analog");
      } catch (error) {
        window.AdminApp?.toast?.error?.(error?.message || t("clock_error", "Failed to update clock setting."));
      }
    });
  }
}

function bindLatestImage() {
  const card = byId("adminDashboardLatestImageCard");
  if (!card) return;

  card.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!dashboardState.latestImageItem || !window.AdminApp?.imageModal) return;
    const imageId = dashboardState.latestImageItem.image_id || dashboardState.latestImageItem.id;
    window.AdminApp.imageModal.openByPreference(
      {
        ...dashboardState.latestImageItem,
        original_url: dashboardState.latestImageItem.original_url || dashboardState.latestImageItem.preview_url,
      },
      {
        detailLoader: async () => loadAdminContentDetail(imageId),
      },
    );
  });
}

function bindIntegrityButton() {
  const button = byId("adminDashboardIntegrityRunButton");
  if (!button) return;

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await queueIntegrityRun();
      window.AdminApp?.toast?.success?.(result?.message || t("integrity_run_success", "Integrity check queued."));
      dashboardState.lastSnapshot = "";
      await loadDashboard({ force: true });
    } catch (error) {
      button.disabled = false;
      window.AdminApp?.toast?.error?.(error?.message || t("integrity_run_error", "Failed to queue integrity check."));
    }
  });
}

function scheduleDashboardLiveRefresh() {
  clearDashboardLiveRefreshTimer();
  if (document.visibilityState === "hidden") return;
  const intervalMs = getDashboardLiveRefreshInterval();
  if (!intervalMs) return;
  dashboardState.liveTimerId = window.setTimeout(async () => {
    await loadDashboard({ silent: true });
    scheduleDashboardLiveRefresh();
  }, intervalMs);
}

function bindDashboardLiveRefreshLifecycle() {
  if (!dashboardState.liveVisibilityBound) {
    dashboardState.liveVisibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void loadDashboard({ silent: true, force: true }).finally(() => {
          scheduleDashboardLiveRefresh();
        });
        return;
      }
      clearDashboardLiveRefreshTimer();
    });
  }

  if (!dashboardState.liveStorageBound) {
    dashboardState.liveStorageBound = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== DASHBOARD_LIVE_REFRESH_KEY) return;
      scheduleDashboardLiveRefresh();
    });
  }
}

function startDashboardLiveRefresh() {
  bindDashboardLiveRefreshLifecycle();
  dashboardState.liveWatcher = {
    stop() {
      clearDashboardLiveRefreshTimer();
    },
  };
  scheduleDashboardLiveRefresh();
}

async function initDashboard() {
  if (!window.AdminApp || !window.AdminApp.ready) return;
  defineMessages();
  applyStaticTranslations();

  bindClockButtons();
  bindLatestImage();
  bindIntegrityButton();
  bindDashboardStorageUsage();
  syncDashboardStorageIntervalControl();
  startClockLoop();
  startElapsedLoop();

  try {
    await Promise.all([
      loadDashboard({ force: true }),
      loadDashboardStorageUsage({ force: true, silent: true }),
    ]);
    startDashboardLiveRefresh();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || t("dashboard_error", "Failed to load dashboard."));
  }
}

if (window.AdminApp?.ready) {
  void initDashboard();
} else {
  document.addEventListener("admin:ready", () => {
    void initDashboard();
  }, { once: true });
}

window.addEventListener("gallery:language-changed", () => {
  applyStaticTranslations();
  renderDashboardStorageUsage();
  if (dashboardState.latestData) {
    renderStats({
      online_user_count: dashboardState.latestData.online_user_count ?? 0,
      ...(dashboardState.latestData.stats || {}),
    });
    renderActiveUsers(dashboardState.latestData.active_users || []);
    renderAuditLogs(dashboardState.latestData.recent_audit_logs || []);
    renderLatestImage(dashboardState.latestData.latest_image || null);
    renderIntegritySummary(dashboardState.latestData.integrity_summary || {});
  }
});
