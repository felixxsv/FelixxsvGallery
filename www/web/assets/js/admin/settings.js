import { createApiClient } from "../core/api.js";

const appBase = document.body.dataset.appBase || "/gallery";
const api = createApiClient({ baseUrl: appBase });

const GROUP_META = {
  general: {
    title: "全般",
    description: "サイト名や画像モーダルの既定値を管理します。",
    loadPath: "/api/admin/settings/general",
    savePath: "/api/admin/settings/general",
    fields: {
      site_name: "adminSettingsGeneralSiteName",
      gallery_key: "adminSettingsGeneralGalleryKey",
      deleted_user_display_name: "adminSettingsGeneralDeletedUserDisplayName",
      default_image_open_behavior: "adminSettingsGeneralImageOpenBehavior",
      default_image_backdrop_close: "adminSettingsGeneralBackdropClose",
      default_image_meta_bar_pinned: "adminSettingsGeneralMetaBarPinned",
    },
  },
  security: {
    title: "セキュリティ",
    description: "パスワードポリシーやセッション関連の既定値を管理します。",
    loadPath: "/api/admin/settings/security",
    savePath: "/api/admin/settings/security",
    fields: {
      password_min_length: "adminSettingsSecurityPasswordMinLength",
      password_require_uppercase: "adminSettingsSecurityRequireUppercase",
      password_require_lowercase: "adminSettingsSecurityRequireLowercase",
      password_require_number: "adminSettingsSecurityRequireNumber",
      login_rate_limit_per_10_min: "adminSettingsSecurityLoginRateLimit",
      session_idle_timeout_minutes: "adminSettingsSecuritySessionIdleTimeout",
      admin_2fa_recommended: "adminSettingsSecurityAdmin2faRecommended",
    },
  },
  smtp: {
    title: "メール (SMTP)",
    description: "送信元や SMTP 接続先を管理します。SMTP パスワードは後続フェーズです。",
    loadPath: "/api/admin/settings/smtp",
    savePath: "/api/admin/settings/smtp",
    fields: {
      host: "adminSettingsSmtpHost",
      port: "adminSettingsSmtpPort",
      use_starttls: "adminSettingsSmtpUseStarttls",
      from_email: "adminSettingsSmtpFromEmail",
      from_name: "adminSettingsSmtpFromName",
    },
  },
  storage: {
    title: "ストレージ",
    description: "ストレージ関連の参照パスとアップロード上限を管理します。",
    loadPath: "/api/admin/settings/storage",
    savePath: "/api/admin/settings/storage",
    fields: {
      source_root: "adminSettingsStorageSourceRoot",
      storage_root: "adminSettingsStorageStorageRoot",
      original_cache_root: "adminSettingsStorageOriginalCacheRoot",
      max_upload_files: "adminSettingsStorageMaxUploadFiles",
      max_upload_size_mb: "adminSettingsStorageMaxUploadSizeMb",
    },
  },
  integrity: {
    title: "整合性チェック",
    description: "日次整合性チェックの有効化、周期、実行時刻、保持期間を管理します。",
    loadPath: "/api/admin/settings/integrity",
    savePath: "/api/admin/settings/integrity",
    fields: {
      enabled: "adminSettingsIntegrityEnabled",
      schedule_type: "adminSettingsIntegrityScheduleType",
      run_at_hhmm: "adminSettingsIntegrityRunAt",
      interval_days: "adminSettingsIntegrityIntervalDays",
      weekly_days: {
        type: "checkbox-group",
        selector: 'input[name="adminSettingsIntegrityWeeklyDays"]',
      },
      report_retention_days: "adminSettingsIntegrityReportRetentionDays",
    },
  },
};

const WEEKDAY_LABELS = {
  mon: "月",
  tue: "火",
  wed: "水",
  thu: "木",
  fri: "金",
  sat: "土",
  sun: "日",
};

const INITIAL_GROUP_STATE = () => ({
  initial: null,
  current: null,
  updated_at: null,
  updated_by_user_id: null,
});

const STORAGE_USAGE_REFRESH_INTERVAL_KEY = "admin.storageUsage.refreshIntervalMs";
const STORAGE_USAGE_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_USAGE_ALLOWED_INTERVALS = [0, 60 * 1000, 3 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

const state = {
  activeTab: "general",
  groups: Object.fromEntries(Object.keys(GROUP_META).map((group) => [group, INITIAL_GROUP_STATE()])),
  saving: false,
  pendingApplyResolver: null,
  storageUsage: {
    loading: false,
    loaded: false,
    error: "",
    data: null,
    timerId: null,
  },
};

const $ = (selector) => document.querySelector(selector);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeForCompare(value) {
  return JSON.stringify(value ?? {});
}

function setMessage(message, isError = false) {
  const el = $("#adminSettingsMessage");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.toggle("is-error", Boolean(isError));
}

function setSaveState(text, kind = "idle") {
  const el = $("#adminSettingsSaveState");
  if (!el) return;
  el.textContent = text || "";
  if (kind === "error") {
    el.dataset.state = "error";
  } else {
    el.removeAttribute("data-state");
  }
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ja-JP");
  } catch {
    return String(value);
  }
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / (1024 ** exponent);
  const digits = exponent === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[exponent]}`;
}

function formatPercent(value, digits = 1) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return "-";
  return `${percent.toFixed(digits)}%`;
}

function clampRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return 0;
  if (ratio < 0) return 0;
  if (ratio > 1) return 1;
  return ratio;
}
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

function syncStorageUsageIntervalControl() {
  const select = document.getElementById("adminStorageUsageRefreshInterval");
  if (select) {
    select.value = String(getStorageUsageRefreshInterval());
  }
}

function clearStorageUsageTimer() {
  if (state.storageUsage.timerId) {
    window.clearTimeout(state.storageUsage.timerId);
    state.storageUsage.timerId = null;
  }
}

function scheduleStorageUsageAutoRefresh() {
  clearStorageUsageTimer();
  if (document.visibilityState === "hidden") return;
  if (state.activeTab !== "storage") return;
  const intervalMs = getStorageUsageRefreshInterval();
  if (!intervalMs) return;
  state.storageUsage.timerId = window.setTimeout(async () => {
    await loadStorageUsage({ force: true, silent: true });
    scheduleStorageUsageAutoRefresh();
  }, intervalMs);
}

function buildStoragePathStatus(item) {
  if (!item?.path) return "未設定";
  if (item.exists) return item.is_directory ? "存在" : item.is_file ? "ファイル" : "存在";
  return "未作成";
}

function buildStoragePathNote(item) {
  if (!item?.path) {
    return "このパスは未設定です。保存済みの設定にパスを入れると使用状況を表示します。";
  }
  if (!item.exists) {
    return item.usage_base_path
      ? `パス自体はまだ存在しません。使用率は親ディレクトリ ${item.usage_base_path} を基準に表示しています。`
      : "パスが存在せず、使用率を算出できませんでした。";
  }
  if (!item.is_directory && !item.is_file) {
    return "特殊ファイルのため、ディレクトリ容量の集計対象外です。";
  }
  return item.is_directory
    ? "ディレクトリ配下の実ファイル合計と、配置先ファイルシステムの使用率を表示しています。"
    : "単一ファイルのサイズと、配置先ファイルシステムの使用率を表示しています。";
}

function setStorageRingUsage(element, ratio) {
  if (!element) return;
  element.style.setProperty("--usage-ratio", String(clampRatio(ratio)));
}

function createStorageUsageCard(item) {
  const article = document.createElement("article");
  article.className = "admin-storage-card";

  const header = document.createElement("div");
  header.className = "admin-storage-card__header";

  const heading = document.createElement("div");
  heading.className = "admin-storage-card__heading";

  const title = document.createElement("h4");
  title.className = "admin-storage-card__title";
  title.textContent = item.label || item.key || "ディレクトリ";

  const status = document.createElement("span");
  status.className = "admin-storage-card__status";
  if (!item.path) {
    status.dataset.state = "idle";
  } else if (item.exists) {
    status.dataset.state = "ok";
  } else {
    status.dataset.state = "warning";
  }
  status.textContent = buildStoragePathStatus(item);

  heading.append(title, status);

  const path = document.createElement("p");
  path.className = "admin-storage-card__path";
  path.textContent = item.path || "未設定";

  header.append(heading, path);

  const stats = document.createElement("div");
  stats.className = "admin-storage-card__stats";

  const directoryMetric = document.createElement("div");
  directoryMetric.className = "admin-storage-card__metric";
  directoryMetric.innerHTML = `<span>ディレクトリサイズ</span><strong>${formatBytes(item.directory_size_bytes)}</strong>`;

  const shareMetric = document.createElement("div");
  shareMetric.className = "admin-storage-card__metric";
  shareMetric.innerHTML = `<span>総容量に対する割合</span><strong>${formatPercent(item.directory_share_of_filesystem_percent, 2)}</strong>`;

  stats.append(directoryMetric, shareMetric);

  const progressList = document.createElement("div");
  progressList.className = "admin-storage-card__progress-list";

  const filesystemProgress = document.createElement("div");
  filesystemProgress.className = "admin-storage-progress";
  filesystemProgress.innerHTML = `
    <div class="admin-storage-progress__head">
      <span>配置先ファイルシステム使用率</span>
      <strong>${formatPercent(item.filesystem_usage_percent)}</strong>
    </div>
    <div class="admin-storage-progress__track"><span style="width:${formatPercent(item.filesystem_usage_percent, 3)}"></span></div>
    <div class="admin-storage-progress__meta">
      <span>空き容量 ${formatBytes(item.filesystem_free_bytes)}</span>
      <span>基準: ${item.usage_base_path || "-"}</span>
    </div>
  `;

  progressList.append(filesystemProgress);

  const note = document.createElement("p");
  note.className = "admin-storage-card__note";
  note.textContent = buildStoragePathNote(item);

  article.append(header, stats, progressList, note);
  return article;
}

function renderStorageUsage() {
  const loadingEl = document.getElementById("adminStorageUsageLoading");
  const messageEl = document.getElementById("adminStorageUsageMessage");
  const contentEl = document.getElementById("adminStorageUsageContent");
  const cardsEl = document.getElementById("adminStorageUsageCards");
  const refreshButton = document.getElementById("adminStorageUsageRefreshButton");
  const intervalSelect = document.getElementById("adminStorageUsageRefreshInterval");
  const generatedAtEl = document.getElementById("adminStorageUsageGeneratedAt");
  const primaryLabelEl = document.getElementById("adminStoragePrimaryLabel");
  const primaryPathEl = document.getElementById("adminStoragePrimaryPath");
  const primaryDirectorySizeEl = document.getElementById("adminStoragePrimaryDirectorySize");
  const primaryUsageEl = document.getElementById("adminStoragePrimaryFilesystemUsage");
  const primaryFreeEl = document.getElementById("adminStoragePrimaryFilesystemFree");
  const primaryPercentEl = document.getElementById("adminStoragePrimaryUsagePercent");
  const primaryRingEl = document.getElementById("adminStoragePrimaryRing");

  if (!loadingEl || !messageEl || !contentEl || !cardsEl) return;

  const { loading, loaded, error, data } = state.storageUsage;
  if (refreshButton) {
    refreshButton.disabled = loading;
  }
  if (intervalSelect) {
    intervalSelect.disabled = loading;
    intervalSelect.value = String(getStorageUsageRefreshInterval());
  }
  loadingEl.hidden = !loading && loaded;
  loadingEl.textContent = loading ? "使用状況を読み込み中です…" : "使用状況はまだ読み込まれていません。";
  messageEl.hidden = !error;
  messageEl.textContent = error || "";
  messageEl.classList.toggle("is-error", Boolean(error));
  contentEl.hidden = !loaded || !data;

  if (!loaded || !data) {
    if (cardsEl) cardsEl.replaceChildren();
    if (generatedAtEl) generatedAtEl.textContent = "-";
    if (primaryLabelEl) primaryLabelEl.textContent = "storage_root";
    if (primaryPathEl) primaryPathEl.textContent = "使用状況を取得するとここに表示します。";
    if (primaryDirectorySizeEl) primaryDirectorySizeEl.textContent = "-";
    if (primaryUsageEl) primaryUsageEl.textContent = "-";
    if (primaryFreeEl) primaryFreeEl.textContent = "-";
    if (primaryPercentEl) primaryPercentEl.textContent = "-%";
    setStorageRingUsage(primaryRingEl, 0);
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const primary = data.primary || items.find((item) => item.key === data.primary_key) || items[0] || null;
  if (generatedAtEl) {
    generatedAtEl.textContent = data.generated_at ? formatDateTime(data.generated_at) : "-";
  }
  if (primary) {
    if (primaryLabelEl) primaryLabelEl.textContent = primary.label || primary.key || "storage_root";
    if (primaryPathEl) primaryPathEl.textContent = primary.path || "未設定";
    if (primaryDirectorySizeEl) primaryDirectorySizeEl.textContent = formatBytes(primary.directory_size_bytes);
    if (primaryUsageEl) {
      primaryUsageEl.textContent = `${formatBytes(primary.filesystem_used_bytes)} / ${formatBytes(primary.filesystem_total_bytes)}`;
    }
    if (primaryFreeEl) primaryFreeEl.textContent = formatBytes(primary.filesystem_free_bytes);
    if (primaryPercentEl) primaryPercentEl.textContent = formatPercent(primary.filesystem_usage_percent);
    setStorageRingUsage(primaryRingEl, primary.filesystem_usage_ratio);
  }

  cardsEl.replaceChildren(...items.map((item) => createStorageUsageCard(item)));
}

async function loadStorageUsage({ force = false, silent = false } = {}) {
  const storageTabVisible = state.activeTab === "storage";
  if (!storageTabVisible && !force) return;
  if (state.storageUsage.loading) return;
  if (state.storageUsage.loaded && !force) {
    renderStorageUsage();
    scheduleStorageUsageAutoRefresh();
    return;
  }

  state.storageUsage.loading = true;
  state.storageUsage.error = "";
  renderStorageUsage();
  try {
    const result = await api.get("/api/admin/settings/storage/usage");
    state.storageUsage.data = result.data || null;
    state.storageUsage.loaded = true;
  } catch (error) {
    state.storageUsage.error = error.message || "使用状況の取得に失敗しました。";
    state.storageUsage.data = null;
    state.storageUsage.loaded = false;
    if (!silent) {
      window.AdminApp?.toast?.error?.(state.storageUsage.error);
    }
  } finally {
    state.storageUsage.loading = false;
    renderStorageUsage();
    scheduleStorageUsageAutoRefresh();
  }
}

function bindStorageUsageEvents() {
  document.getElementById("adminStorageUsageRefreshButton")?.addEventListener("click", () => {
    loadStorageUsage({ force: true });
  });
  document.getElementById("adminStorageUsageRefreshInterval")?.addEventListener("change", (event) => {
    const value = setStorageUsageRefreshInterval(event.currentTarget?.value);
    event.currentTarget.value = String(value);
    scheduleStorageUsageAutoRefresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.activeTab === "storage") {
      loadStorageUsage({ force: true, silent: true });
      return;
    }
    clearStorageUsageTimer();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_USAGE_REFRESH_INTERVAL_KEY) return;
    syncStorageUsageIntervalControl();
    scheduleStorageUsageAutoRefresh();
  });
}

function activeGroupMeta() {
  return GROUP_META[state.activeTab];
}

function activeGroupState() {
  return state.groups[state.activeTab];
}

function fieldConfig(field) {
  if (typeof field === "string") {
    return { type: "element", id: field };
  }
  return field || { type: "element", id: "" };
}

function fieldElements(field) {
  const config = fieldConfig(field);
  if (config.type === "checkbox-group") {
    return Array.from(document.querySelectorAll(config.selector || ""));
  }
  const el = document.getElementById(config.id);
  return el ? [el] : [];
}

function readField(field) {
  const config = fieldConfig(field);
  const elements = fieldElements(field);

  if (config.type === "checkbox-group") {
    return elements.filter((el) => el.checked).map((el) => el.value);
  }

  const el = elements[0];
  if (!el) return null;
  if (el.type === "checkbox") return Boolean(el.checked);
  if (el.type === "number") return el.value === "" ? null : Number(el.value);
  return el.value;
}

function writeField(field, value) {
  const config = fieldConfig(field);
  const elements = fieldElements(field);

  if (config.type === "checkbox-group") {
    const values = Array.isArray(value) ? value.map((item) => String(item)) : [];
    elements.forEach((el) => {
      el.checked = values.includes(el.value);
    });
    return;
  }

  const el = elements[0];
  if (!el) return;

  if (el.type === "checkbox") {
    el.checked = Boolean(value);
  } else if (el.type === "number") {
    el.value = value == null ? "" : String(value);
  } else {
    el.value = value == null ? "" : String(value);
  }
}

function isGroupDirty(group) {
  const entry = state.groups[group];
  if (!entry || !entry.initial || !entry.current) return false;
  return normalizeForCompare(entry.initial) !== normalizeForCompare(entry.current);
}

function isAnyDirty() {
  return Object.keys(state.groups).some((group) => isGroupDirty(group));
}

function syncDirtyGuard() {
  window.AdminApp?.dirtyGuard?.setDirty("admin-settings-page", isAnyDirty());
}

function selectedIntegrityWeekdayLabels() {
  return Array.from(document.querySelectorAll('input[name="adminSettingsIntegrityWeeklyDays"]:checked'))
    .map((el) => WEEKDAY_LABELS[el.value] || el.value);
}

function formatIntegrityRunTime() {
  const runAt = document.getElementById("adminSettingsIntegrityRunAt")?.value?.trim() || "";
  return runAt || "未設定";
}

function buildIntegritySummary({ enabled, scheduleType, intervalDays, weeklyLabels, runAt }) {
  if (!enabled) {
    return `現在は無効です。保存後も定期実行は行われません。設定内容はこのまま保持されます。`;
  }

  if (!runAt || runAt === "未設定") {
    return `実行時刻を設定すると、ここに次回以降の実行ルールを表示します。`;
  }

  if (scheduleType === "every_n_days") {
    const days = Number(intervalDays) || 1;
    return `${days}日ごとに ${runAt} に実行します。`;
  }

  if (scheduleType === "weekly") {
    if (!weeklyLabels.length) {
      return `曜日指定が未選択です。少なくとも 1 つ曜日を選択してください。`;
    }
    return `毎週 ${weeklyLabels.join("・")} の ${runAt} に実行します。`;
  }

  return `毎日 ${runAt} に実行します。`;
}

function syncIntegrityFieldState() {
  const form = document.getElementById("adminSettingsFormIntegrity");
  if (!form) return;

  const enabled = document.getElementById("adminSettingsIntegrityEnabled")?.checked ?? false;
  const scheduleType = document.getElementById("adminSettingsIntegrityScheduleType")?.value || "daily";
  const interval = document.getElementById("adminSettingsIntegrityIntervalDays");
  const intervalField = document.getElementById("adminIntegrityIntervalField");
  const weeklyField = document.getElementById("adminIntegrityWeeklyField");
  const scheduleHelp = document.getElementById("adminIntegrityScheduleHelp");
  const weeklyHelp = document.getElementById("adminIntegrityWeeklyHelp");
  const summary = document.getElementById("adminIntegrityScheduleSummary");
  const weekly = document.querySelectorAll('input[name="adminSettingsIntegrityWeeklyDays"]');
  const weeklyLabels = selectedIntegrityWeekdayLabels();
  const runAt = formatIntegrityRunTime();

  if (interval) {
    interval.disabled = scheduleType !== "every_n_days";
  }
  if (intervalField) {
    intervalField.hidden = scheduleType !== "every_n_days";
  }

  weekly.forEach((el) => {
    el.disabled = scheduleType !== "weekly";
  });
  if (weeklyField) {
    weeklyField.hidden = scheduleType !== "weekly";
  }

  if (scheduleHelp) {
    if (scheduleType === "every_n_days") {
      scheduleHelp.textContent = "指定した日数ごとに、同じ時刻で実行します。";
    } else if (scheduleType === "weekly") {
      scheduleHelp.textContent = "選んだ曜日だけ、指定した時刻で実行します。";
    } else {
      scheduleHelp.textContent = "毎日、指定した時刻に 1 回実行します。";
    }
  }

  if (weeklyHelp) {
    weeklyHelp.textContent = weeklyLabels.length
      ? `選択中: ${weeklyLabels.join("・")}`
      : "少なくとも 1 つ曜日を選択してください。";
  }

  form.dataset.scheduleType = scheduleType;
  form.dataset.enabled = enabled ? "true" : "false";

  if (summary) {
    summary.textContent = buildIntegritySummary({
      enabled,
      scheduleType,
      intervalDays: interval?.value,
      weeklyLabels,
      runAt,
    });
  }
}

function updateHeader() {
  const meta = activeGroupMeta();
  const entry = activeGroupState();

  $("#adminSettingsPanelTitle").textContent = meta.title;
  $("#adminSettingsPanelDescription").textContent = meta.description;

  const updatedMeta = $("#adminSettingsUpdatedMeta");
  if (updatedMeta) {
    updatedMeta.textContent = entry?.updated_at
      ? `最終更新: ${formatDateTime(entry.updated_at)}`
      : "まだ保存されていません。";
  }

  const applyButton = $("#adminSettingsApplyButton");
  if (applyButton) {
    applyButton.disabled = !isGroupDirty(state.activeTab) || state.saving;
  }
}

function readGroupValuesFromDom(group) {
  const fields = GROUP_META[group].fields;
  const out = {};
  for (const [key, field] of Object.entries(fields)) {
    out[key] = readField(field);
  }
  return out;
}

function writeGroupValuesToDom(group) {
  const values = state.groups[group].current || {};
  const fields = GROUP_META[group].fields;
  for (const [key, field] of Object.entries(fields)) {
    writeField(field, values[key]);
  }
  syncIntegrityFieldState();
}

function renderActiveTab() {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    const isActive = button.dataset.settingsTab === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-settings-form]").forEach((form) => {
    form.hidden = form.dataset.settingsForm !== state.activeTab;
  });

  writeGroupValuesToDom(state.activeTab);
  updateHeader();
  syncDirtyGuard();
  if (state.activeTab === "storage") {
    syncStorageUsageIntervalControl();
    loadStorageUsage({ force: true, silent: true });
  } else {
    clearStorageUsageTimer();
  }
}

async function loadGroup(group) {
  const payload = await api.get(GROUP_META[group].loadPath);
  const data = payload.data || {};
  state.groups[group] = {
    initial: deepClone(data.settings || {}),
    current: deepClone(data.settings || {}),
    updated_at: data.updated_at || null,
    updated_by_user_id: data.updated_by_user_id || null,
  };
}

async function loadAll() {
  setMessage("");
  setSaveState("読み込み中…");
  try {
    await Promise.all(Object.keys(GROUP_META).map((group) => loadGroup(group)));
    renderActiveTab();
    setSaveState("読み込み完了");
  } catch (error) {
    setMessage(error.message || "設定の読み込みに失敗しました。", true);
    setSaveState("読み込みに失敗しました。", "error");
  }
}

async function switchTab(nextTab) {
  if (!GROUP_META[nextTab] || nextTab === state.activeTab) return;

  if (isGroupDirty(state.activeTab)) {
    const ok = await window.AdminApp?.dirtyGuard?.confirmIfNeeded?.("未保存の変更があります。破棄して移動しますか？");
    if (!ok) return;
    const entry = state.groups[state.activeTab];
    entry.current = deepClone(entry.initial || {});
  }

  state.activeTab = nextTab;
  window.history.replaceState({}, "", `#${nextTab}`);
  renderActiveTab();
}

function bindTabEvents() {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      await switchTab(button.dataset.settingsTab || "general");
    });
  });
}

function bindFieldEvents() {
  Object.keys(GROUP_META).forEach((group) => {
    Object.values(GROUP_META[group].fields).forEach((field) => {
      fieldElements(field).forEach((el) => {
        const handler = () => {
          state.groups[group].current = readGroupValuesFromDom(group);
          if (group === state.activeTab) {
            syncIntegrityFieldState();
            updateHeader();
          }
          syncDirtyGuard();
        };
        el.addEventListener("input", handler);
        el.addEventListener("change", handler);
      });
    });
  });
}

function openApplyConfirm() {
  const msg = $("#adminSettingsApplyConfirmMessage");
  if (msg) {
    msg.textContent = `${activeGroupMeta().title} の変更を適用します。よろしいですか？`;
  }
  window.AdminApp?.modal?.open?.("admin-settings-apply-confirm");
  return new Promise((resolve) => {
    state.pendingApplyResolver = resolve;
  });
}

function closeApplyConfirm(result) {
  const resolver = state.pendingApplyResolver;
  state.pendingApplyResolver = null;
  window.AdminApp?.modal?.close?.("admin-settings-apply-confirm");
  if (typeof resolver === "function") {
    resolver(Boolean(result));
  }
}

async function applyActiveTab() {
  const group = state.activeTab;
  if (!isGroupDirty(group) || state.saving) {
    return;
  }

  const confirmed = await openApplyConfirm();
  if (!confirmed) return;

  state.saving = true;
  updateHeader();
  setSaveState("保存中…");
  setMessage("");

  try {
    const payload = state.groups[group].current || {};
    const result = await api.patch(GROUP_META[group].savePath, payload);
    const data = result.data || {};

    state.groups[group] = {
      initial: deepClone(data.settings || {}),
      current: deepClone(data.settings || {}),
      updated_at: data.updated_at || null,
      updated_by_user_id: data.updated_by_user_id || null,
    };

    renderActiveTab();
    if (group === "storage") {
      state.storageUsage.loaded = false;
      await loadStorageUsage({ force: true, silent: true });
    }
    setSaveState(`保存済み (${formatDateTime(data.updated_at)})`);
    setMessage(result.message || "設定を更新しました。");
  } catch (error) {
    setSaveState("保存に失敗しました。", "error");
    setMessage(error.message || "設定の保存に失敗しました。", true);
  } finally {
    state.saving = false;
    updateHeader();
  }
}

function bindApplyEvents() {
  $("#adminSettingsApplyButton")?.addEventListener("click", applyActiveTab);
  $("#adminSettingsApplyConfirmApprove")?.addEventListener("click", () => closeApplyConfirm(true));
  $("#adminSettingsApplyConfirmCancel")?.addEventListener("click", () => closeApplyConfirm(false));
}

export async function initAdminSettingsPage() {
  window.AdminApp?.dirtyGuard?.register?.("admin-settings-page", () => isAnyDirty());
  bindTabEvents();
  bindFieldEvents();
  bindApplyEvents();
  bindStorageUsageEvents();
  syncStorageUsageIntervalControl();

  const hashTab = (window.location.hash || "").replace(/^#/, "").trim();
  if (GROUP_META[hashTab]) {
    state.activeTab = hashTab;
  }

  await loadAll();
}

document.addEventListener("admin:ready", () => {
  initAdminSettingsPage();
});
