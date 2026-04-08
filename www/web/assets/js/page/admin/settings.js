import { createApiClient } from "../../core/api.js";

const appBase = document.body.dataset.appBase || "/gallery";
const api = createApiClient({ baseUrl: appBase });

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_settings.${key}`, fallback, vars) || fallback;
}

function applyGroupTranslations() {
  GROUP_META.general.title = t("group_general", "General");
  GROUP_META.general.description = t("group_general_desc", "Manage the site name and default image modal behavior.");
  GROUP_META.security.title = t("group_security", "Security");
  GROUP_META.security.description = t("group_security_desc", "Manage password policy and session defaults.");
  GROUP_META.smtp.title = t("group_smtp", "Mail (SMTP)");
  GROUP_META.smtp.description = t("group_smtp_desc", "Manage sender information and SMTP connection settings.");
  GROUP_META.storage.title = t("group_storage", "Storage");
  GROUP_META.storage.description = t("group_storage_desc", "Manage storage paths and upload limits.");
  GROUP_META.integrity.title = t("group_integrity", "Integrity Check");
  GROUP_META.integrity.description = t("group_integrity_desc", "Manage scheduled integrity checks, cadence, run time, and retention.");
  WEEKDAY_LABELS.mon = t("mon", "Mon");
  WEEKDAY_LABELS.tue = t("tue", "Tue");
  WEEKDAY_LABELS.wed = t("wed", "Wed");
  WEEKDAY_LABELS.thu = t("thu", "Thu");
  WEEKDAY_LABELS.fri = t("fri", "Fri");
  WEEKDAY_LABELS.sat = t("sat", "Sat");
  WEEKDAY_LABELS.sun = t("sun", "Sun");
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

  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    const key = button.dataset.settingsTab;
    const map = {
      general: "tab_general",
      security: "tab_security",
      smtp: "tab_smtp",
      storage: "tab_storage",
      integrity: "tab_integrity",
    };
    if (map[key]) button.textContent = t(map[key], button.textContent);
  });

  setAttr(".admin-settings-tabs", "aria-label", t("group_general", "General"));
  setText("#adminSettingsSaveState", state.saving ? t("save_saving", "Saving...") : document.getElementById("adminSettingsSaveState")?.textContent || "");
  setText("#adminSettingsFormGeneral .admin-settings-field:nth-of-type(1) > span", t("field_site_name", "Site Name"));
  setText("#adminSettingsFormGeneral .admin-settings-field:nth-of-type(2) > span", t("field_gallery_key", "Gallery Key"));
  setText("#adminSettingsFormGeneral .admin-settings-field:nth-of-type(3) > span", t("field_deleted_user_display_name", "Deleted User Display Name"));
  setText("#adminSettingsFormGeneral .admin-settings-field:nth-of-type(4) > span", t("field_default_image_open", "Default image click behavior"));
  setText("#adminSettingsGeneralImageOpenBehavior option[value='modal']", t("field_default_image_open_modal", "Open in modal"));
  setText("#adminSettingsGeneralImageOpenBehavior option[value='new_tab']", t("field_default_image_open_tab", "Open in new tab"));
  setText("#adminSettingsFormGeneral .admin-settings-field:nth-of-type(5) .app-switch__label", t("field_default_backdrop_close", "Allow backdrop click by default"));
  setText("#adminSettingsFormGeneral .admin-settings-field:nth-of-type(6) .app-switch__label", t("field_default_meta_pinned", "Keep the image meta bar pinned by default"));

  setText("#adminSettingsFormSecurity .admin-settings-field:nth-of-type(1) > span", t("field_password_min_length", "Minimum password length"));
  setText("#adminSettingsFormSecurity .admin-settings-field:nth-of-type(2) > span", t("field_login_rate_limit", "Login attempts per 10 minutes"));
  setText("#adminSettingsFormSecurity .admin-settings-field:nth-of-type(3) > span", t("field_session_idle_timeout", "Session idle timeout (minutes)"));
  setText("#adminSettingsFormSecurity .admin-settings-field:nth-of-type(4) .app-switch__label", t("field_require_uppercase", "Require uppercase letters"));
  setText("#adminSettingsFormSecurity .admin-settings-field:nth-of-type(5) .app-switch__label", t("field_require_lowercase", "Require lowercase letters"));
  setText("#adminSettingsFormSecurity .admin-settings-field:nth-of-type(6) .app-switch__label", t("field_require_number", "Require numbers"));
  setText("#adminSettingsFormSecurity .admin-settings-field:nth-of-type(7) .app-switch__label", t("field_admin_2fa_recommended", "Recommend 2FA for administrators"));

  setText("#adminSettingsFormSmtp .admin-settings-field:nth-of-type(1) > span", t("field_smtp_host", "SMTP host"));
  setText("#adminSettingsFormSmtp .admin-settings-field:nth-of-type(2) > span", t("field_smtp_port", "Port"));
  setText("#adminSettingsFormSmtp .admin-settings-field:nth-of-type(3) > span", t("field_smtp_from_email", "Sender email address"));
  setText("#adminSettingsFormSmtp .admin-settings-field:nth-of-type(4) > span", t("field_smtp_from_name", "Sender name"));
  setText("#adminSettingsFormSmtp .admin-settings-field:nth-of-type(5) .app-switch__label", t("field_smtp_starttls", "Use STARTTLS"));

  setText("#adminStorageConfigTitle", t("storage_config_title", "Paths and upload limits"));
  setText(".admin-storage-pane--config .admin-storage-pane__meta", t("storage_config_meta", "Manage source_root / storage_root / original_cache_root and upload limits here."));
  setText("#adminSettingsFormStorage .admin-settings-field:nth-of-type(4) > span", t("field_max_upload_files", "Maximum upload files"));
  setText("#adminSettingsFormStorage .admin-settings-field:nth-of-type(5) > span", t("field_max_upload_size_mb", "Maximum upload size (MB)"));
  setText("#adminStorageUsageTitle", t("storage_usage_title", "Directory usage"));
  setText(".admin-storage-pane--usage .admin-storage-overview__meta", t("storage_usage_meta", "Shows directory size and destination filesystem usage based on the saved source_root / storage_root / original_cache_root."));
  const usageGeneratedAt = document.getElementById("adminStorageUsageGeneratedAt");
  if (usageGeneratedAt?.parentElement) usageGeneratedAt.parentElement.firstChild.textContent = `${t("last_fetched", "Last fetched")}: `;
  setText(".admin-storage-refresh-interval > span", t("auto_refresh", "Auto refresh"));
  setAttr("#adminStorageUsageRefreshInterval", "aria-label", t("auto_refresh", "Auto refresh"));
  setText("#adminStorageUsageRefreshInterval option[value='0']", t("manual_only", "Manual only"));
  setText("#adminStorageUsageRefreshButton", t("refresh_usage", "Refresh Usage"));
  setText(".admin-storage-summary-card__eyebrow", t("primary_display", "Primary View"));
  setClosestText("#adminStoragePrimaryDirectorySize", ".admin-storage-summary-card__metric", "span", t("metric_directory_size", "Directory size"));
  setClosestText("#adminStoragePrimaryFilesystemUsage", ".admin-storage-summary-card__metric", "span", t("metric_filesystem_usage", "Used / Total"));
  setClosestText("#adminStoragePrimaryFilesystemFree", ".admin-storage-summary-card__metric", "span", t("metric_filesystem_free", "Free space"));

  setText(".admin-integrity-hero__eyebrow", t("integrity_hero_eyebrow", "Scheduled run"));
  setText(".admin-integrity-hero__title", t("integrity_hero_title", "Enable integrity checks"));
  setText(".admin-integrity-hero__description", t("integrity_hero_description", "Regularly checks source / DB / derived files / color data. Disabled means no scheduled run, but settings can still be saved."));
  setText(".admin-integrity-hero__toggle-text", t("enabled", "Enabled"));
  setText(".admin-integrity-section:nth-of-type(2) .admin-integrity-section__title", t("integrity_rule_title", "Execution Rule"));
  setText(".admin-integrity-section:nth-of-type(2) .admin-integrity-section__meta", t("integrity_rule_meta", "Only the required inputs are shown for the selected execution method."));
  setText("#adminSettingsFormIntegrity .admin-settings-field:nth-of-type(1) > span", t("field_schedule_type", "Schedule"));
  setText("#adminSettingsIntegrityScheduleType option[value='daily']", t("schedule_daily", "Daily"));
  setText("#adminSettingsIntegrityScheduleType option[value='every_n_days']", t("schedule_every_n_days", "Every n days"));
  setText("#adminSettingsIntegrityScheduleType option[value='weekly']", t("schedule_weekly", "Weekly"));
  setText("#adminSettingsFormIntegrity .admin-settings-field:nth-of-type(2) > span", t("field_run_at", "Run time"));
  setText("#adminSettingsFormIntegrity .admin-settings-field:nth-of-type(2) .admin-settings-field__help", t("run_at_hint", "Use 24-hour time."));
  setText("#adminIntegrityIntervalField > span", t("field_interval_days", "Every n days"));
  setText("#adminIntegrityIntervalField .admin-settings-field__help", t("interval_days_hint", "Example: entering 3 runs it every 3 days."));
  setText("#adminIntegrityWeeklyField > span", t("field_weekly_days", "Weekdays"));
  setText("#adminIntegrityWeeklyHelp", t("weekly_days_help", "Used only when weekly is selected."));
  setText(".admin-integrity-section--secondary .admin-integrity-section__title", t("integrity_report_title", "Report Retention"));
  setText(".admin-integrity-section--secondary .admin-integrity-section__meta", t("integrity_report_meta", "Controls report retention period and operation notes."));
  setText(".admin-integrity-section--secondary .admin-settings-field > span", t("field_report_retention_days", "Report retention days"));
  setText(".admin-integrity-section--secondary .admin-settings-field__help", t("report_retention_hint", "Used as a guideline when cleaning up old JSON reports."));
  setText(".admin-integrity-note-card__title", t("operation_note", "Operation Note"));
  setText(".admin-integrity-note-card .admin-panel__meta", t("operation_note_body", "Queue manual runs from the dashboard. Actual scheduled execution is expected to be handled by a periodic dispatcher such as a systemd timer."));

  setText("#adminSettingsApplyButton", t("apply_button", "Apply"));
  setText("#adminSettingsApplyConfirmTitle", t("apply_confirm_title", "Apply these settings?"));
  setText("#adminSettingsApplyConfirmMessage", t("apply_confirm_message", "Apply the current changes?"));
  setText("#adminSettingsApplyConfirmApprove", t("apply_confirm_approve", "Apply"));
  setText("#adminSettingsApplyConfirmCancel", t("apply_confirm_cancel", "Cancel"));
}

const GROUP_META = {
  general: {
    title: "General",
    description: "Manage the site name and default image modal behavior.",
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
    title: "Security",
    description: "Manage password policy and session defaults.",
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
    title: "Mail (SMTP)",
    description: "Manage sender information and SMTP connection settings.",
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
    title: "Storage",
    description: "Manage storage paths and upload limits.",
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
    title: "Integrity Check",
    description: "Manage scheduled integrity checks, cadence, run time, and retention.",
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
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
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

import { languageToLocaleTag } from "../../core/settings.js";

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
    return new Date(value).toLocaleString(languageToLocaleTag(document.documentElement.lang || "en-us"));
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
  if (!item?.path) return t("not_set", "Not set");
  if (item.exists) return item.is_directory ? t("exists", "Exists") : item.is_file ? t("file", "File") : t("exists", "Exists");
  return t("not_created", "Not created");
}

function buildStoragePathNote(item) {
  if (!item?.path) {
    return t("path_unset_help", "This path is not configured. Save a path to show usage information here.");
  }
  if (!item.exists) {
    return item.usage_base_path
      ? t("path_missing_parent_usage", "The path itself does not exist yet. Usage is shown relative to the parent directory {path}.", { path: item.usage_base_path })
      : t("path_missing_usage", "The path does not exist, so usage could not be calculated.");
  }
  if (!item.is_directory && !item.is_file) {
    return t("path_special_file", "This is a special file and is excluded from directory usage calculations.");
  }
  return item.is_directory
    ? t("path_directory_usage", "Shows total real files under the directory and the destination filesystem usage.")
    : t("path_file_usage", "Shows the file size and the destination filesystem usage.");
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
  title.textContent = item.label || item.key || t("directory", "Directory");

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
  path.textContent = item.path || t("not_set", "Not set");

  header.append(heading, path);

  const stats = document.createElement("div");
  stats.className = "admin-storage-card__stats";

  const directoryMetric = document.createElement("div");
  directoryMetric.className = "admin-storage-card__metric";
  directoryMetric.innerHTML = `<span>${t("metric_directory_size", "Directory size")}</span><strong>${formatBytes(item.directory_size_bytes)}</strong>`;

  const shareMetric = document.createElement("div");
  shareMetric.className = "admin-storage-card__metric";
  shareMetric.innerHTML = `<span>${t("metric_share_total", "Share of Total Capacity")}</span><strong>${formatPercent(item.directory_share_of_filesystem_percent, 2)}</strong>`;

  stats.append(directoryMetric, shareMetric);

  const progressList = document.createElement("div");
  progressList.className = "admin-storage-card__progress-list";

  const filesystemProgress = document.createElement("div");
  filesystemProgress.className = "admin-storage-progress";
  filesystemProgress.innerHTML = `
    <div class="admin-storage-progress__head">
      <span>${t("metric_filesystem_usage_label", "Target Filesystem Usage")}</span>
      <strong>${formatPercent(item.filesystem_usage_percent)}</strong>
    </div>
    <div class="admin-storage-progress__track"><span style="width:${formatPercent(item.filesystem_usage_percent, 3)}"></span></div>
    <div class="admin-storage-progress__meta">
      <span>${t("metric_free_space", "Free Space {size}", { size: formatBytes(item.filesystem_free_bytes) })}</span>
      <span>${t("metric_usage_base", "Base: {path}", { path: item.usage_base_path || "-" })}</span>
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
  loadingEl.textContent = loading ? t("storage_loading", "Loading usage...") : t("storage_idle", "Usage has not been loaded yet.");
  messageEl.hidden = !error;
  messageEl.textContent = error || "";
  messageEl.classList.toggle("is-error", Boolean(error));
  contentEl.hidden = !loaded || !data;

  if (!loaded || !data) {
    if (cardsEl) cardsEl.replaceChildren();
    if (generatedAtEl) generatedAtEl.textContent = "-";
    if (primaryLabelEl) primaryLabelEl.textContent = "storage_root";
    if (primaryPathEl) primaryPathEl.textContent = t("storage_placeholder", "Usage information will appear here after loading.");
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
    if (primaryPathEl) primaryPathEl.textContent = primary.path || t("not_set", "Not set");
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
    state.storageUsage.error = error.message || t("storage_error", "Failed to load usage information.");
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
  return runAt || t("not_set", "Not set");
}

function buildIntegritySummary({ enabled, scheduleType, intervalDays, weeklyLabels, runAt }) {
  if (!enabled) {
    return t("integrity_disabled", "This is currently disabled. No scheduled run will occur after saving, but the settings are kept.");
  }

  if (!runAt || runAt === t("not_set", "Not set")) {
    return t("integrity_run_at_hint", "Set a run time to show the future execution rule here.");
  }

  if (scheduleType === "every_n_days") {
    const days = Number(intervalDays) || 1;
    return t("integrity_every_days", "Runs every {days} days at {time}.", { days, time: runAt });
  }

  if (scheduleType === "weekly") {
    if (!weeklyLabels.length) {
      return t("integrity_weekday_required", "No weekdays selected. Select at least one weekday.");
    }
    return t("integrity_weekly", "Runs every week on {days} at {time}.", { days: weeklyLabels.join(" / "), time: runAt });
  }

  return t("integrity_daily", "Runs every day at {time}.", { time: runAt });
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
      scheduleHelp.textContent = t("integrity_help_interval", "Runs at the same time every specified number of days.");
    } else if (scheduleType === "weekly") {
      scheduleHelp.textContent = t("integrity_help_weekly", "Runs at the specified time only on the selected weekdays.");
    } else {
      scheduleHelp.textContent = t("integrity_help_daily", "Runs once a day at the specified time.");
    }
  }

  if (weeklyHelp) {
    weeklyHelp.textContent = weeklyLabels.length
      ? t("integrity_selected", "Selected: {days}", { days: weeklyLabels.join(" / ") })
      : t("integrity_weekday_required", "No weekdays selected. Select at least one weekday.");
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
      ? t("updated_at", "Last updated: {date}", { date: formatDateTime(entry.updated_at) })
      : t("not_saved_yet", "Not saved yet.");
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
  setSaveState(t("save_loading", "Loading..."));
  try {
    await Promise.all(Object.keys(GROUP_META).map((group) => loadGroup(group)));
    renderActiveTab();
    setSaveState(t("save_loaded", "Loaded"));
  } catch (error) {
    setMessage(error.message || t("load_error", "Failed to load settings."), true);
    setSaveState(t("load_failed", "Load failed."), "error");
  }
}

async function switchTab(nextTab) {
  if (!GROUP_META[nextTab] || nextTab === state.activeTab) return;

  if (isGroupDirty(state.activeTab)) {
    const ok = await window.AdminApp?.dirtyGuard?.confirmIfNeeded?.(t("discard_move", "You have unsaved changes. Discard them and continue?"));
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
    msg.textContent = t("apply_confirm", "Apply changes to {title}?", { title: activeGroupMeta().title });
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
  setSaveState(t("save_saving", "Saving..."));
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
    setSaveState(t("save_done", "Saved ({date})", { date: formatDateTime(data.updated_at) }));
    setMessage(result.message || t("save_success", "Settings updated."));
  } catch (error) {
    setSaveState(t("save_failed", "Save failed."), "error");
    setMessage(error.message || t("save_error", "Failed to save settings."), true);
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
  applyGroupTranslations();
  applyStaticTranslations();
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
  window.addEventListener("gallery:language-changed", () => {
    applyGroupTranslations();
    applyStaticTranslations();
    renderActiveTab();
    updateHeader();
  });
});
