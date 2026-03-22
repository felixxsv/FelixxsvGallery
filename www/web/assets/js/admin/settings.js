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

const state = {
  activeTab: "general",
  groups: Object.fromEntries(Object.keys(GROUP_META).map((group) => [group, INITIAL_GROUP_STATE()])),
  saving: false,
  pendingApplyResolver: null,
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

  const hashTab = (window.location.hash || "").replace(/^#/, "").trim();
  if (GROUP_META[hashTab]) {
    state.activeTab = hashTab;
  }

  await loadAll();
}

document.addEventListener("admin:ready", () => {
  initAdminSettingsPage();
});
