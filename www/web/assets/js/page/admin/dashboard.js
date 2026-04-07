function byId(id) {
  return document.getElementById(id);
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
  if (hours > 0) return `${hours}時間 ${minutes}分`;
  if (minutes > 0) return `${minutes}分 ${seconds}秒`;
  return `${seconds}秒`;
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
  const normalizedPath = pathText || "未設定";
  element.style.setProperty("--usage-ratio", String(clampRatio(ratio)));
  element.innerHTML = `
    <div class="admin-dashboard-storage__path-text"></div>
    <div class="admin-dashboard-storage__usage-row">
      <span class="admin-dashboard-storage__usage-label">使用率</span>
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
    empty.textContent = "現在アクセス中のユーザーはいません。";
    container.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "admin-list-table-head admin-list-table-head--users";
  head.innerHTML = `
    <span>アイコン</span>
    <span>表示名</span>
    <span>ユーザーID</span>
    <span>状態</span>
    <span>セッション時間</span>
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
      <div class="admin-active-user__status"><span class="admin-status-badge admin-status-badge--online">オンライン</span></div>
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
    empty.textContent = "直近の操作ログはありません。";
    container.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "admin-list-table-head admin-list-table-head--logs";
  head.innerHTML = `
    <span>日時</span>
    <span>操作種別</span>
    <span>概要</span>
    <span>結果</span>
    <span>実行者</span>
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
  loadingEl.textContent = storageUsageState.loading ? "使用状況を読み込み中です…" : "使用状況はまだ読み込まれていません。";
  messageEl.hidden = !storageUsageState.error;
  messageEl.textContent = storageUsageState.error || "";
  messageEl.classList.toggle("is-error", Boolean(storageUsageState.error));
  contentEl.hidden = !storageUsageState.loaded || !storageUsageState.data;

  if (!storageUsageState.loaded || !storageUsageState.data) {
    if (generatedAtEl) generatedAtEl.textContent = "-";
    if (labelEl) labelEl.textContent = "storage_root";
    renderDashboardStoragePath(pathEl, "使用状況を取得するとここに表示します。", "-%", 0);
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
  renderDashboardStoragePath(pathEl, primary.path || "未設定", usagePercentText, primary.filesystem_usage_ratio);
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
    storageUsageState.error = error.message || "ストレージ使用状況の取得に失敗しました。";
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
      latestRun.textContent = "まだ実行履歴がありません。";
    } else {
      const severity = summary?.severity_counts || {};
      latestRun.textContent = `${formatDateTime(run.finished_at || run.started_at || run.requested_at)} / warning ${severity.warning || 0} / error ${severity.error || 0}`;
    }
  }
  if (lastSuccess) lastSuccess.textContent = formatDateTime(summary?.last_success_at);
  if (pending) {
    pending.textContent = summary?.has_pending
      ? `${summary.pending_run?.status || "queued"} / ${formatDateTime(summary.pending_run?.requested_at || summary.pending_run?.started_at)}`
      : "なし";
  }
  if (action) {
    action.disabled = Boolean(summary?.has_pending);
    action.textContent = summary?.has_pending ? "実行待ちがあります" : "手動実行を予約";
  }
  if (!container) return;

  container.innerHTML = "";
  const items = summary?.issue_items || [];
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = "直近の問題はありません。";
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
      <div class="admin-log-item__summary">${detail.join(" / ") || "詳細情報なし"}</div>
      <div class="admin-log-item__result"><span class="admin-log-item__badge">${severity}</span></div>
      <div class="admin-log-item__actor">${item.gallery || "integrity"}</div>
    `;
    container.appendChild(row);
  }
}

function buildDashboardDetail(item) {
  return {
    image_id: item.image_id || item.id || null,
    title: item.title || "タイトル未設定",
    alt: item.alt || "",
    posted_at: item.posted_at || null,
    shot_at: item.shot_at || null,
    like_count: Number(item.like_count || 0),
    view_count: Number(item.view_count || 0),
    user: item.user || {
      display_name: item.uploader_display_name || "投稿者不明",
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
  title.textContent = item.title || "タイトル未設定";
  meta.textContent = `${formatDateTime(item.posted_at)} ・ ${item.user?.display_name || "投稿者不明"}`;
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
    throw new Error(payload?.error?.message || "時計設定の更新に失敗しました。");
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
        window.AdminApp?.toast?.error?.(error?.message || "ダッシュボードの取得に失敗しました。");
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
        window.AdminApp?.toast?.error?.(error?.message || "時計表示の切り替えに失敗しました。");
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
        window.AdminApp?.toast?.error?.(error?.message || "時計表示の切り替えに失敗しました。");
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
      window.AdminApp?.toast?.success?.(result?.message || "整合性チェックを実行キューへ追加しました。");
      dashboardState.lastSnapshot = "";
      await loadDashboard({ force: true });
    } catch (error) {
      button.disabled = false;
      window.AdminApp?.toast?.error?.(error?.message || "整合性チェックの実行予約に失敗しました。");
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
    window.AdminApp?.toast?.error?.(error?.message || "ダッシュボードの取得に失敗しました。");
  }
}

if (window.AdminApp?.ready) {
  void initDashboard();
} else {
  document.addEventListener("admin:ready", () => {
    void initDashboard();
  }, { once: true });
}
