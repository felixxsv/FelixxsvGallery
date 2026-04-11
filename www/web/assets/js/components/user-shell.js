import { byId } from "../core/dom.js";
import { resolveBadgeText } from "../core/badge-i18n.js";
import { resolveLocalizedMessage } from "../core/i18n.js";
import { languageToLocaleTag } from "../core/settings.js";

const LINK_ICON_MAP = {
  "x.com": "x",
  "twitter.com": "x",
  "discord.com": "discord",
  "discord.gg": "discord",
  "pixiv.net": "pixiv",
  "instagram.com": "instagram",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "bsky.app": "bluesky",
  "bsky.social": "bluesky",
  "misskey.io": "misskey",
  "github.com": "github",
  "tiktok.com": "tiktok",
  "threads.net": "threads",
  "mastodon.social": "mastodon",
  "pawoo.net": "mastodon",
  "fosstodon.org": "mastodon",
  "mstdn.jp": "mastodon",
  "tumblr.com": "tumblr",
  "patreon.com": "patreon",
  "twitch.tv": "twitch",
  "note.com": "note",
  "nicovideo.jp": "niconico",
  "nico.ms": "niconico",
  "zenn.dev": "zenn",
  "facebook.com": "facebook",
};

function getLinkIconSlug(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return LINK_ICON_MAP[hostname] ?? "_default";
  } catch {
    return "_default";
  }
}

function getLinkIconUrl(url) {
  const slug = getLinkIconSlug(url);
  return `/assets/icons/social/${slug}.svg`;
}

const DEFAULT_CREDIT_META = Object.freeze({
  service: "Felixxsv Gallery",
  author: "Felix",
  stack: "FastAPI / MySQL / JavaScript / CSS / Apache",
  license: "TBD",
  updatedAt: "2026-03-16",
  version: "2026.03-rebuild-v2",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Default badge icon as inline SVG data URI (used when icon file is not yet available)
const BADGE_DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='6'/%3E%3Cpath d='M8 14l-3 7 7-3 7 3-3-7'/%3E%3C/svg%3E";
window._BADGE_DEFAULT_ICON = BADGE_DEFAULT_ICON;

function getBadgeIconHtml(badge, appBase) {
  if (!badge.icon) return `<img class="badge-icon" src="${BADGE_DEFAULT_ICON}" alt="" aria-hidden="true">`;
  const src = `${appBase}/assets/images/badges/${badge.icon}`;
  return `<img class="badge-icon" src="${src}" alt="" aria-hidden="true" onerror="this.onerror=null;this.src=window._BADGE_DEFAULT_ICON">`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString(languageToLocaleTag(document.documentElement.lang || "en-us"));
}

function nowMs() {
  return Date.now();
}

function dispatchLanguageChange(language) {
  window.dispatchEvent(new CustomEvent("gallery:language-changed", {
    detail: { language },
  }));
}

export function initUserShell(app) {
  const session = app.session;
  const toast = app.toast;

  function t(key, fallback = "", vars = {}) {
    return app.i18n?.t?.(key, fallback, vars) || fallback;
  }

  async function ensureLanguageCatalog(language) {
    const normalized = languageToLocaleTag(language);
    if (!app.i18n?.loadCatalog) return;
    try {
      await app.i18n.loadCatalog(language, `${app.appBase}/assets/i18n/${String(language || "").trim().toLowerCase()}.json`);
    } catch {
      // Keep current in-memory dictionaries as fallback.
    }
    document.documentElement.lang = normalized;
  }

  const refs = {
    userTrigger: byId("shellUserTrigger"),
    guestIcon: byId("shellUserTriggerGuestIcon"),
    authIcon: byId("shellUserTriggerAuthIcon"),

    userCard: byId("shellUserCard"),
    guestOverlay: byId("shellGuestOverlay"),
    loginButton: byId("shellLoginButton"),

    displayName: byId("shellUserDisplayName"),
    accountEditButton: byId("shellAccountEditButton"),
    userKey: byId("shellUserKey"),
    userCardAvatar: byId("shellUserCardAvatar"),
    userCardAvatarImg: byId("shellUserCardAvatarImg"),
    userBio: byId("shellUserBio"),
    userCardLinks: byId("shellUserCardLinks"),
    email: byId("shellUserEmail"),
    createdAt: byId("shellUserCreatedAt"),
    twoFactor: byId("shellUserTwoFactor"),
    roleRow: byId("shellUserRoleRow"),
    role: byId("shellUserRole"),
    uploadDisabled: byId("shellUploadDisabledMessage"),
    uploadOpenButton: byId("shellUploadOpenButton"),
    accountOpenButton: byId("shellAccountOpenButton"),
    profilePreviewButton: byId("shellProfilePreviewButton"),
    adminLink: byId("shellAdminLink"),
    userFooter: byId("shellUserFooter"),
    logoutButton: byId("shellLogoutButton"),
    logoutAllButton: byId("shellLogoutAllButton"),

    settingLanguage: byId("shellSettingLanguage"),
    settingTheme: byId("shellSettingTheme"),
    settingImageOpenBehavior: byId("shellSettingImageOpenBehavior"),
    settingImageBackdropClose: byId("shellSettingImageBackdropClose"),
    settingImageMetaPinned: byId("shellSettingImageMetaPinned"),

    creditAuthor: byId("shellCreditAuthor"),
    creditStack: byId("shellCreditStack"),
    creditLicense: byId("shellCreditLicense"),
    creditUpdatedAt: byId("shellCreditUpdatedAt"),
    creditVersion: byId("shellCreditVersion"),

    accountEmail: byId("shellAccountEmail"),
    accountTwoFactor: byId("shellAccountTwoFactor"),
    emailActionButton: byId("shellEmailActionButton"),
    twoFactorEnableButton: byId("shellTwoFactorEnableButton"),
    twoFactorDisableOpenButton: byId("shellTwoFactorDisableOpenButton"),

    accountAvatar: byId("shellAccountAvatar"),
    accountAvatarInitial: byId("shellAccountAvatarInitial"),
    accountAvatarImg: byId("shellAccountAvatarImg"),
    avatarFileInput: byId("shellAvatarFileInput"),
    avatarDeleteButton: byId("shellAvatarDeleteButton"),
    profileDisplayNameInput: byId("shellProfileDisplayNameInput"),
    profileUserKeyInput: byId("shellProfileUserKeyInput"),
    profileBioInput: byId("shellProfileBioInput"),
    profileBioCount: byId("shellProfileBioCount"),
    profileSaveButton: byId("shellProfileSaveButton"),
    profileLinksGrid: byId("shellProfileLinksGrid"),
    addLinkInput: byId("shellAddLinkInput"),
    addLinkSubmitButton: byId("shellAddLinkSubmitButton"),

    avatarCropStage: byId("shellAvatarCropStage"),
    avatarCropCanvas: byId("shellAvatarCropCanvas"),
    avatarZoomSlider: byId("shellAvatarZoomSlider"),
    avatarCropCancelButton: byId("shellAvatarCropCancelButton"),
    avatarCropConfirmButton: byId("shellAvatarCropConfirmButton"),

    emailTitle: byId("emailTitle"),
    emailStep1: byId("shellEmailStep1"),
    emailStep2: byId("shellEmailStep2"),
    emailInput: byId("shellEmailInput"),
    emailCodeInput: byId("shellEmailCodeInput"),
    emailCodeInfo: byId("shellEmailCodeInfo"),
    emailSaveButton: byId("shellEmailSaveButton"),
    emailResendButton: byId("shellEmailResendButton"),

    currentPasswordInput: byId("shellCurrentPasswordInput"),
    newPasswordInput: byId("shellNewPasswordInput"),
    passwordSaveButton: byId("shellPasswordSaveButton"),

    accountPasswordStatus: byId("shellAccountPasswordStatus"),
    passwordChangeButton: byId("shellPasswordChangeButton"),
    passwordSetButton: byId("shellPasswordSetButton"),
    setPasswordInput: byId("shellSetPasswordInput"),
    setPasswordSaveButton: byId("shellSetPasswordSaveButton"),

    accountDiscordStatus: byId("shellAccountDiscordStatus"),
    accountRegistrationRoute: byId("shellAccountRegistrationRoute"),
    discordLinkButton: byId("shellDiscordLinkButton"),
    discordUnlinkButton: byId("shellDiscordUnlinkButton"),

    twoFactorSetupMessage: byId("shellTwoFactorSetupMessage"),
    twoFactorCodeInput: byId("shellTwoFactorCodeInput"),
    twoFactorSetupConfirmButton: byId("shellTwoFactorSetupConfirmButton"),
    twoFactorSetupResendButton: byId("shellTwoFactorSetupResendButton"),
    twoFactorSetupCancelButton: byId("shellTwoFactorSetupCancelButton"),

    twoFactorDisableMessage: byId("shellTwoFactorDisableMessage"),
    twoFactorDisableCodeInput: byId("shellTwoFactorDisableCodeInput"),
    twoFactorDisableConfirmButton: byId("shellTwoFactorDisableConfirmButton"),
    twoFactorDisableResendButton: byId("shellTwoFactorDisableResendButton"),
    twoFactorDisableCancelButton: byId("shellTwoFactorDisableCancelButton"),

    actionConfirmMessage: byId("shellTwoFactorActionConfirmMessage"),
    actionConfirmApproveButton: byId("shellTwoFactorActionConfirmApproveButton"),
    actionConfirmCancelButton: byId("shellTwoFactorActionConfirmCancelButton")
  };

  const shellState = {
    twoFactorSetupTicket: null,
    twoFactorDisableTicket: null,
    twoFactorSetupResendAvailableAt: 0,
    twoFactorDisableResendAvailableAt: 0,
    bypassVerificationCloseGuard: false,
    allowBrowserLeave: false,
    actionConfirmResolver: null
  };

  const CROP_DISPLAY = 240;
  const CROP_OUTPUT = 256;

  const cropState = {
    img: null,
    scale: 1,
    minScale: 1,
    maxScale: 4,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffsetX: 0,
    dragStartOffsetY: 0,
  };

  let countdownTimer = null;

  function getSessionState() {
    return session.getState();
  }

  function isAuthenticated() {
    return getSessionState().authenticated;
  }

  function getUser() {
    return getSessionState().data?.user || null;
  }

  function getTwoFactor() {
    return getSessionState().data?.security?.two_factor || { is_enabled: false };
  }

  function getFeatures() {
    return getSessionState().data?.features || {};
  }

  function currentEmail() {
    return (getUser()?.primary_email || "").trim();
  }

  function hasSetupFlow() {
    return !!shellState.twoFactorSetupTicket;
  }

  function hasDisableFlow() {
    return !!shellState.twoFactorDisableTicket;
  }

  function hasPendingVerificationFlow() {
    return hasSetupFlow() || hasDisableFlow();
  }

  function getCooldownRemainingSec(kind) {
    const until = kind === "setup" ? shellState.twoFactorSetupResendAvailableAt : shellState.twoFactorDisableResendAvailableAt;
    return Math.max(0, Math.ceil((Number(until || 0) - nowMs()) / 1000));
  }

  function setCooldownFromSeconds(kind, seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const until = nowMs() + safe * 1000;
    if (kind === "setup") shellState.twoFactorSetupResendAvailableAt = until;
    if (kind === "disable") shellState.twoFactorDisableResendAvailableAt = until;
    refreshResendButtons();
  }

  function refreshResendButtons() {
    const setupRemain = getCooldownRemainingSec("setup");
    if (refs.twoFactorSetupResendButton) {
      refs.twoFactorSetupResendButton.disabled = setupRemain > 0;
      refs.twoFactorSetupResendButton.textContent = setupRemain > 0
        ? t("shell.resend_countdown", `Resend (${setupRemain}s)`, { seconds: setupRemain })
        : t("shell.resend", "Resend");
    }

    const disableRemain = getCooldownRemainingSec("disable");
    if (refs.twoFactorDisableResendButton) {
      refs.twoFactorDisableResendButton.disabled = disableRemain > 0;
      refs.twoFactorDisableResendButton.textContent = disableRemain > 0
        ? t("shell.resend_countdown", `Resend (${disableRemain}s)`, { seconds: disableRemain })
        : t("shell.resend", "Resend");
    }
  }

  function startCountdownTimer() {
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
    }
    countdownTimer = window.setInterval(() => {
      refreshResendButtons();
    }, 1000);
  }

  function openActionConfirm(message, approveText = t("shell.confirm.default", "Confirm"), danger = false) {
    if (!refs.actionConfirmApproveButton || !refs.actionConfirmCancelButton || !refs.actionConfirmMessage) {
      return Promise.resolve(window.confirm(message));
    }

    refs.actionConfirmMessage.textContent = message;
    refs.actionConfirmApproveButton.textContent = approveText;
    refs.actionConfirmApproveButton.classList.toggle("app-button--danger", danger);
    app.modal.open("twofactor-action-confirm");

    return new Promise((resolve) => {
      shellState.actionConfirmResolver = resolve;
    });
  }

  function closeActionConfirm(result) {
    if (shellState.actionConfirmResolver) {
      const resolve = shellState.actionConfirmResolver;
      shellState.actionConfirmResolver = null;
      resolve(Boolean(result));
    }
    app.modal.close("twofactor-action-confirm");
  }

  function renderHeaderIcon() {
    const authed = isAuthenticated();
    refs.guestIcon.hidden = authed;
    refs.authIcon.hidden = !authed;
    if (authed) {
      const avatarUrl = getUser()?.avatar_url || null;
      refs.authIcon.style.backgroundImage = avatarUrl
        ? `url("${app.appBase}${avatarUrl}?t=${Date.now()}")`
        : "";
    }
  }

  function renderCredits() {
    const creditAuthor = byId("shellCreditAuthor");
    const creditStack = byId("shellCreditStack");
    const creditLicense = byId("shellCreditLicense");
    const creditUpdatedAt = byId("shellCreditUpdatedAt");
    const creditVersion = byId("shellCreditVersion");
    if (creditAuthor) creditAuthor.textContent = document.body.dataset.creditAuthor || DEFAULT_CREDIT_META.author;
    if (creditStack) creditStack.textContent = document.body.dataset.creditStack || DEFAULT_CREDIT_META.stack;
    if (creditLicense) creditLicense.textContent = document.body.dataset.creditLicense || DEFAULT_CREDIT_META.license;
    if (creditUpdatedAt) creditUpdatedAt.textContent = document.body.dataset.creditUpdatedAt || DEFAULT_CREDIT_META.updatedAt;
    if (creditVersion) creditVersion.textContent = document.body.dataset.appVersion || DEFAULT_CREDIT_META.version;
  }

  function renderHelpContent() {
    const helpBody = document.querySelector("[data-modal-id='help'] .app-modal-body");
    if (!helpBody) return;
    helpBody.innerHTML = `
      <div class="shell-help-content">
        <section>
          <h3>${escapeHtml(t("shell.help.search_title", "Search and Filters"))}</h3>
          <ul>
            <li>${escapeHtml(t("shell.help.search_item1", "Use the header search to filter across titles, ALT text, tags, and users."))}</li>
            <li>${escapeHtml(t("shell.help.search_item2", "Use the sidebar to combine tags, color tags, shot date, posted date, and archive filters."))}</li>
            <li>${escapeHtml(t("shell.help.search_item3", "Archive counts are recalculated against the current filters and stay in sync when conditions change."))}</li>
          </ul>
        </section>
        <section>
          <h3>${escapeHtml(t("shell.help.view_title", "Viewing Images"))}</h3>
          <ul>
            <li>${escapeHtml(t("shell.help.view_item1", "Open a card to view the image in the image modal."))}</li>
            <li>${escapeHtml(t("shell.help.view_item2", "Use the details button to check shot date, posted date, tags, and color tags."))}</li>
            <li>${escapeHtml(t("shell.help.view_item3", "Select the uploader icon to open the profile modal."))}</li>
          </ul>
        </section>
        <section>
          <h3>${escapeHtml(t("shell.help.account_title", "Account and Settings"))}</h3>
          <ul>
            <li>${escapeHtml(t("shell.help.account_item1", "Use the user menu in the top-right corner to open profile editing, display settings, and account settings."))}</li>
            <li>${escapeHtml(t("shell.help.account_item2", "Email changes, Discord linking, two-factor authentication, and logout actions are grouped under account settings."))}</li>
            <li>${t("shell.help.account_item3", "The canonical authentication flow is provided at <code>/auth/</code>.")}</li>
          </ul>
        </section>
      </div>
    `;
  }

  function renderCreditsContent() {
    const creditsBody = document.querySelector("[data-modal-id='credits'] .app-modal-body");
    if (!creditsBody) return;
    creditsBody.innerHTML = `
      <dl class="app-definition-list">
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("shell.static.credit_service", "Service"))}</dt>
          <dd>${escapeHtml(document.body.dataset.creditService || DEFAULT_CREDIT_META.service)}</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("shell.static.credit_author", "Author"))}</dt>
          <dd id="shellCreditAuthor">-</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("shell.static.credit_stack", "Tech Stack"))}</dt>
          <dd id="shellCreditStack">-</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("shell.static.credit_license", "License"))}</dt>
          <dd id="shellCreditLicense">-</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("shell.static.credit_updated_at", "Updated"))}</dt>
          <dd id="shellCreditUpdatedAt">-</dd>
        </div>
        <div class="app-definition-list__row">
          <dt>${escapeHtml(t("shell.static.credit_version", "Version"))}</dt>
          <dd id="shellCreditVersion">-</dd>
        </div>
      </dl>
    `;
  }

  function applyStaticTranslations() {
    const mappings = [
      ["#userInfoTitle", 0, "shell.static.account_settings", "Account Settings"],
      ["[data-modal-id='settings'] .app-modal-title", 0, "shell.static.settings", "Settings"],
      ["[data-modal-id='help'] .app-modal-title", 0, "shell.static.help", "Help"],
      ["[data-modal-id='credits'] .app-modal-title", 0, "shell.static.credits", "Credits"],
      ["[data-modal-id='account'] .app-modal-title", 0, "shell.static.profile_edit", "Edit Profile"],
      ["[data-modal-id='account-security'] .app-modal-title", 0, "shell.static.account_settings", "Account Settings"],
      ["[data-modal-id='password'] .app-modal-title", 0, "shell.static.password_change", "Change Password"],
      ["[data-modal-id='password-set'] .app-modal-title", 0, "shell.static.password_set", "Set Password"],
      ["[data-modal-id='twofactor-setup'] .app-modal-title", 0, "shell.static.twofactor_setup", "Two-Factor Verification"],
      ["[data-modal-id='twofactor-disable'] .app-modal-title", 0, "shell.static.twofactor_disable", "Disable Two-Factor Authentication"],
      ["#shellLogoutAllButton", 0, "shell.static.logout_all", "Log Out All Devices"],
      ["#shellLogoutButton", 0, "shell.static.logout", "Log Out"],
      ["#shellProfileSaveButton", 0, "shell.static.save", "Save"],
      ["#shellViewMyPostsButton", 0, "shell.static.view_my_posts", "自分の投稿を見る"],
      ["#shellPasswordSaveButton", 0, "shell.static.change", "Change"],
      ["#shellSetPasswordSaveButton", 0, "shell.static.set", "Set"],
      ["#shellTwoFactorSetupConfirmButton", 0, "shell.static.verify", "Verify"],
      ["#shellTwoFactorDisableConfirmButton", 0, "shell.static.disable", "Disable"],
      ["#shellTwoFactorSetupCancelButton", 0, "shell.static.cancel", "Cancel"],
      ["#shellTwoFactorDisableCancelButton", 0, "shell.static.cancel", "Cancel"],
      ["#shellTwoFactorActionConfirmCancelButton", 0, "shell.static.cancel", "Cancel"],
      ["#shellAvatarCropCancelButton", 0, "shell.static.cancel", "Cancel"],
      ["#shellAvatarCropConfirmButton", 0, "shell.static.apply", "Apply"],
      ["#shellAddLinkSubmitButton", 0, "shell.static.add", "Add"],
      ["#shellLoginButton", 0, "shell.static.login", "Log In"],
      ["#shellUploadOpenButton", 0, "shell.static.upload", "Upload"],
      ["#shellAccountOpenButton", 0, "shell.static.account_settings", "Account Settings"],
      ["#shellAdminLink", 0, "shell.static.admin", "Open Admin"],
      ["[data-modal-id='settings'] .app-modal-footer .app-button--primary", 0, "shell.static.close", "Close"],
      ["[data-modal-id='help'] .app-modal-footer .app-button--primary", 0, "shell.static.close", "Close"],
      ["[data-modal-id='credits'] .app-modal-footer .app-button--primary", 0, "shell.static.close", "Close"],
      ["[data-modal-id='account-security'] .app-modal-footer .app-button--primary", 0, "shell.static.close", "Close"],
      ["[data-modal-id='account'] .app-modal-footer .app-button--ghost", 0, "shell.static.cancel", "Cancel"],
      ["[data-modal-id='email'] .app-modal-footer .app-button--ghost[data-modal-close='email']", 0, "shell.static.cancel", "Cancel"],
      ["[data-modal-id='add-link'] .app-modal-footer .app-button--ghost", 0, "shell.static.cancel", "Cancel"],
    ];
    for (const [selector, index, key, fallback] of mappings) {
      const node = Array.from(document.querySelectorAll(selector))[index];
      if (node) node.textContent = t(key, fallback);
    }

    const setText = (selector, text) => {
      const node = document.querySelector(selector);
      if (node) node.textContent = text;
    };
    const setAttr = (selector, attr, value) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute(attr, value);
    };

    setText("[data-modal-id='settings'] .shell-settings-group:nth-of-type(1) .shell-settings-group__title", t("shell.static.display_group", "Display"));
    setText("[data-modal-id='settings'] .shell-settings-group:nth-of-type(1) .app-field:nth-of-type(1) .app-field__label", t("shell.static.language", "Language"));
    setText("[data-modal-id='settings'] .shell-settings-group:nth-of-type(1) .app-field:nth-of-type(2) .app-field__label", t("shell.static.theme", "Theme"));
    setText("[data-modal-id='settings'] .shell-settings-group:nth-of-type(2) .shell-settings-group__title", t("shell.static.image_group", "Images"));
    setText("[data-modal-id='settings'] .shell-settings-group:nth-of-type(2) .app-field .app-field__label", t("shell.static.image_open_behavior", "Click Behavior"));
    setText("[data-modal-id='settings'] .app-switch-row:nth-of-type(1) .app-switch-row__label", t("shell.static.backdrop_close", "Close modal on backdrop click"));
    setText("[data-modal-id='settings'] .app-switch-row:nth-of-type(2) .app-switch-row__label", t("shell.static.meta_pinned", "Keep the meta bar pinned"));
    setText("#shellSettingTheme option[value='system']", t("shell.static.theme_system", "Follow system setting"));
    setText("#shellSettingTheme option[value='dark']", t("shell.static.theme_dark", "Dark"));
    setText("#shellSettingTheme option[value='light']", t("shell.static.theme_light", "Light"));
    setText("#shellSettingImageOpenBehavior option[value='modal']", t("shell.static.image_open_modal", "Open in modal"));
    setText("#shellSettingImageOpenBehavior option[value='new_tab']", t("shell.static.image_open_tab", "Open in new tab"));

    setText("[data-modal-id='credits'] .app-definition-list__row:nth-of-type(1) dt", t("shell.static.credit_service", "Service"));
    setText("[data-modal-id='credits'] .app-definition-list__row:nth-of-type(2) dt", t("shell.static.credit_author", "Author"));
    setText("[data-modal-id='credits'] .app-definition-list__row:nth-of-type(3) dt", t("shell.static.credit_stack", "Tech Stack"));
    setText("[data-modal-id='credits'] .app-definition-list__row:nth-of-type(4) dt", t("shell.static.credit_license", "License"));
    setText("[data-modal-id='credits'] .app-definition-list__row:nth-of-type(5) dt", t("shell.static.credit_updated_at", "Updated"));
    setText("[data-modal-id='credits'] .app-definition-list__row:nth-of-type(6) dt", t("shell.static.credit_version", "Version"));

    setText(".shell-user-card__meta-list .app-definition-list__row:nth-of-type(1) dt", t("shell.static.email", "Email"));
    setText(".shell-user-card__meta-list .app-definition-list__row:nth-of-type(2) dt", t("shell.static.created_at", "Created"));
    setText(".shell-user-card__meta-list .app-definition-list__row:nth-of-type(3) dt", t("shell.static.twofactor", "Two-Factor Authentication"));
    setText("#shellUserRoleRow dt", t("shell.static.role", "Role"));
    setText("#shellUploadDisabledMessage", t("shell.static.upload_disabled", "Image uploads are currently disabled."));

    setAttr("#shellProfilePreviewButton", "aria-label", t("shell.static.profile_preview", "Open profile"));
    setAttr("#shellAccountEditButton", "aria-label", t("shell.static.profile_edit", "Edit Profile"));

    setText("[data-modal-id='account'] .shell-avatar-upload-label", t("shell.static.icon_change", "Change icon"));
    setText("[data-modal-id='account'] .app-field:nth-of-type(1) .app-field__label", t("shell.static.display_name", "Display Name"));
    setText("[data-modal-id='account'] .app-field:nth-of-type(2) .app-field__label", t("shell.static.user_id", "User ID"));
    setText("[data-modal-id='account'] .app-field:nth-of-type(2) .app-field__hint", t("shell.static.user_id_hint", "4-20 chars, start with a letter, letters/numbers/_/- only"));
    setText("[data-modal-id='account'] .app-field:nth-of-type(3) .app-field__label", t("shell.static.bio", "Bio"));
    setText("[data-modal-id='account'] .shell-profile-links__title", t("shell.static.links", "Links"));
    setText("[data-modal-id='email'] .app-field .app-field__label", t("shell.static.new_email", "New email address"));
    setText("[data-modal-id='email'] #shellEmailStep2 .app-field .app-field__label", t("shell.static.code_6digit", "Verification code (6 digits)"));
    setText("[data-modal-id='add-link'] .app-field__label", t("shell.static.url", "URL"));
    setText("[data-modal-id='add-link'] .app-field__hint", t("shell.static.url_hint", "Enter a URL starting with https://"));
    setText("#cropAvatarTitle", t("shell.static.avatar_adjust", "Adjust Icon"));
    setText(".shell-avatar-crop__zoom-text", t("shell.static.zoom", "Zoom"));
    setText(".shell-avatar-crop__hint", t("shell.static.crop_hint", "Drag to adjust the position"));
    setText("#shellEmailSaveButton", refs.emailStep2?.hidden ? t("shell.email.send", "Send Verification Email") : t("shell.email.verify", "Verify"));
    setText("#shellEmailResendButton", t("shell.email.resend", "Resend"));
    if (refs.profileBioCount) {
      setText("[data-modal-id='account'] .app-field:nth-of-type(3) .app-field__hint", t("shell.static.bio_hint", "{count} / 300 chars", { count: refs.profileBioCount.textContent || "0" }));
    }
  }

  function renderSettings() {
    refs.settingLanguage.value = app.settings.getLanguage();
    refs.settingTheme.value = app.settings.getTheme();
    if (refs.settingImageOpenBehavior) {
      refs.settingImageOpenBehavior.value = app.settings.getImageOpenBehavior();
    }
    if (refs.settingImageBackdropClose) {
      refs.settingImageBackdropClose.checked = Boolean(app.settings.getImageBackdropClose());
    }
    if (refs.settingImageMetaPinned) {
      refs.settingImageMetaPinned.checked = Boolean(app.settings.getImageMetaPinned());
    }
  }

  function renderUserCard() {
    renderHeaderIcon();

    if (!isAuthenticated()) {
      refs.userCard.classList.add("is-guest");
      refs.guestOverlay.hidden = false;
      refs.displayName.textContent = "-";
      refs.accountEditButton.hidden = true;
      refs.userKey.textContent = "-";
      refs.email.textContent = "-";
      refs.createdAt.textContent = "-";
      refs.twoFactor.textContent = "-";
      refs.roleRow.hidden = true;
      refs.role.textContent = "-";
      refs.uploadDisabled.hidden = true;
      if (refs.uploadOpenButton) refs.uploadOpenButton.hidden = true;
      refs.accountOpenButton.hidden = true;
      if (refs.profilePreviewButton) refs.profilePreviewButton.hidden = true;
      if (refs.adminLink) refs.adminLink.hidden = true;
      refs.userFooter.hidden = true;
      return;
    }

    const user = getUser();
    const twoFactor = getTwoFactor();
    const features = getFeatures();

    refs.userCard.classList.remove("is-guest");
    refs.guestOverlay.hidden = true;
    refs.displayName.textContent = user.display_name || "-";
    refs.accountEditButton.hidden = false;
    refs.userKey.textContent = user.user_key || "-";
    refs.email.textContent = user.primary_email || t("shell.value.unregistered", "Not set");
    refs.createdAt.textContent = formatDate(user.created_at);
    refs.twoFactor.textContent = twoFactor.is_enabled ? t("shell.value.enabled", "Enabled") : t("shell.value.disabled", "Disabled");

    if (user.role === "admin") {
      refs.roleRow.hidden = false;
      refs.role.textContent = t("shell.value.admin", "Admin");
    } else {
      refs.roleRow.hidden = true;
      refs.role.textContent = "-";
    }

    // Avatar
    const avatarUrl = user.avatar_url || null;
    if (avatarUrl) {
      refs.userCardAvatarImg.src = app.appBase + avatarUrl + "?t=" + Date.now();
      refs.userCardAvatarImg.hidden = false;
      refs.userCardAvatar.classList.add("has-avatar");
    } else {
      refs.userCardAvatarImg.src = "";
      refs.userCardAvatarImg.hidden = true;
      refs.userCardAvatar.classList.remove("has-avatar");
    }

    // Bio
    const bio = (user.bio || "").trim();
    if (bio) {
      refs.userBio.textContent = bio;
      refs.userBio.hidden = false;
    } else {
      refs.userBio.hidden = true;
    }

    // Links (always show container for reserved space)
    const links = user.links || [];
    if (refs.userCardLinks) {
      refs.userCardLinks.hidden = false;
      refs.userCardLinks.innerHTML = links.slice(0, 5).map((link) => {
        const iconUrl = getLinkIconUrl(link.url);
        return `<a class="shell-user-link" href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.url}"><span class="shell-user-link__icon" style="--link-icon: url('${iconUrl}')"></span></a>`;
      }).join("");
    }

    // Display selected badges on card
    renderDisplayBadges(user);

    const uploadEnabled = user.upload_enabled !== false;
    refs.uploadDisabled.hidden = uploadEnabled;
    if (refs.uploadOpenButton) refs.uploadOpenButton.hidden = !uploadEnabled;
    refs.accountOpenButton.hidden = false;
    if (refs.profilePreviewButton) refs.profilePreviewButton.hidden = false;
    if (refs.adminLink) {
      refs.adminLink.hidden = document.body.dataset.hideAdminLinkInShell === "1" || !features.can_open_admin;
    }
    refs.userFooter.hidden = false;
  }

  // ---- Badge UI ----

  /** Show the selected (up to 3) display badges on the main user card */
  function renderDisplayBadges(user) {
    const container = byId("shellUserDisplayBadges");
    if (!container) return;
    const pool = Array.isArray(user.badge_pool) ? user.badge_pool : [];
    const displayKeys = Array.isArray(user.display_badges) ? user.display_badges : [];
    const poolMap = Object.fromEntries(pool.map((b) => [b.key, b]));
    const toShow = displayKeys.map((k) => poolMap[k]).filter(Boolean);
    if (toShow.length === 0) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    container.innerHTML = toShow.map((badge) =>
      `<span class="user-profile-badge user-profile-badge--${badge.color || "gray"}" title="${escapeHtml(resolveBadgeText(app.i18n, badge, "name"))}">${getBadgeIconHtml(badge, app.appBase)}</span>`
    ).join("");
  }

  /** Render badge pool in the profile edit modal (shellProfileBadgePool) */
  function renderProfileBadgePool(user) {
    const section = byId("shellProfileBadgeSection");
    const list = byId("shellProfileBadgePool");
    if (!list) return;

    const pool = Array.isArray(user.badge_pool) ? user.badge_pool : [];
    if (section) section.hidden = pool.length === 0;
    if (pool.length === 0) {
      list.innerHTML = `<span class="shell-badge-pool__empty">${t("shell.value.none", "Not set")}</span>`;
      return;
    }

    const displayBadges = Array.isArray(user.display_badges) ? user.display_badges : [];
    list.innerHTML = "";
    for (const badge of pool) {
      const isSelected = displayBadges.includes(badge.key);
      const badgeName = resolveBadgeText(app.i18n, badge, "name");
      const badgeDescription = resolveBadgeText(app.i18n, badge, "description");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `shell-badge-pool__item shell-badge-pool__item--${badge.color || "gray"}${isSelected ? " is-selected" : ""}`;
      btn.dataset.badgeKey = badge.key;
      btn.title = badgeDescription || badgeName || "";
      btn.innerHTML = `${getBadgeIconHtml(badge, app.appBase)}${escapeHtml(badgeName || badge.key)}`;
      btn.setAttribute("aria-pressed", String(isSelected));
      list.appendChild(btn);
    }
  }

  async function handleBadgeToggle(badgeKey, user) {
    const currentDisplay = Array.isArray(user.display_badges) ? [...user.display_badges] : [];
    const isSelected = currentDisplay.includes(badgeKey);
    let newDisplay;
    if (isSelected) {
      newDisplay = currentDisplay.filter((k) => k !== badgeKey);
    } else {
      if (currentDisplay.length >= 3) {
        app.toast?.info?.(t("shell.toast.badge_limit", "You can select up to 3 badges."));
        return;
      }
      newDisplay = [...currentDisplay, badgeKey];
    }
    try {
      await app.api.put("/api/users/me/badge-display", { badge_keys: newDisplay });
      user.display_badges = newDisplay;
      renderProfileBadgePool(user);
      renderDisplayBadges(user);
    } catch (err) {
      app.toast?.error?.(err?.message || t("shell.toast.badge_update_error", "Failed to update badges."));
    }
  }

  const MAX_LINKS = 5;

  function renderLinksGrid() {
    const links = getUser()?.links || [];
    const grid = refs.profileLinksGrid;
    grid.innerHTML = "";

    for (const link of links) {
      const iconUrl = getLinkIconUrl(link.url);
      const box = document.createElement("div");
      box.className = "shell-link-box";
      box.dataset.linkId = String(link.id);
      box.innerHTML = `
        <a class="shell-link-box__link" href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.url}">
          <span class="shell-link-box__icon" style="--link-icon: url('${iconUrl}')"></span>
        </a>
        <button class="shell-link-box__remove" type="button" aria-label="${escapeHtml(t("shell.action.remove", "Remove"))}" data-link-id="${link.id}">×</button>
      `;
      grid.appendChild(box);
    }

    if (links.length < MAX_LINKS) {
      const addBox = document.createElement("div");
      addBox.className = "shell-link-box shell-link-box--add";
      addBox.innerHTML = `<button class="shell-link-box__add" type="button" aria-label="${escapeHtml(t("shell.action.add_link", "Add link"))}">+</button>`;
      addBox.querySelector(".shell-link-box__add").addEventListener("click", () => {
        refs.addLinkInput.value = "";
        app.modal.open("add-link");
      });
      grid.appendChild(addBox);
    }

    grid.querySelectorAll(".shell-link-box__remove").forEach((btn) => {
      btn.addEventListener("click", () => handleLinkDelete(Number(btn.dataset.linkId)));
    });
  }

  async function handleLinkAdd() {
    const url = refs.addLinkInput.value.trim();
    if (!url) {
      toast.error(t("shell.toast.url_required", "Enter a URL."));
      refs.addLinkInput.focus();
      return;
    }
    refs.addLinkSubmitButton.disabled = true;
    try {
      const result = await app.api.post("/api/auth/links", { url });
      const links = result?.data?.links ?? [];
      const user = getUser();
      if (user) user.links = links;
      renderLinksGrid();
      app.modal.close("add-link");
      toast.success(result?.message || t("shell.toast.link_added", "Link added."));
    } catch (error) {
      const fieldErrors = error?.payload?.error?.field_errors || [];
      toast.error(resolveLocalizedMessage(fieldErrors[0]?.message || error, t("shell.toast.link_add_error", "Failed to add link.")));
    } finally {
      refs.addLinkSubmitButton.disabled = false;
    }
  }

  async function handleLinkDelete(linkId) {
    try {
      const result = await app.api.delete(`/api/auth/links/${linkId}`);
      const links = result?.data?.links ?? [];
      const user = getUser();
      if (user) user.links = links;
      renderLinksGrid();
      toast.success(t("shell.toast.link_removed", "Link removed."));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.link_remove_error", "Failed to remove link.")));
    }
  }

  function renderAccountModal() {
    if (!isAuthenticated()) {
      return;
    }

    const user = getUser();

    // Avatar
    const avatarUrl = user.avatar_url || null;
    if (avatarUrl) {
      refs.accountAvatarImg.src = app.appBase + avatarUrl + "?t=" + Date.now();
      refs.accountAvatarImg.hidden = false;
      if (refs.accountAvatarInitial) refs.accountAvatarInitial.hidden = true;
      refs.avatarDeleteButton.hidden = false;
    } else {
      refs.accountAvatarImg.hidden = true;
      refs.accountAvatarImg.src = "";
      if (refs.accountAvatarInitial) {
        refs.accountAvatarInitial.hidden = false;
        refs.accountAvatarInitial.textContent = (user.display_name || user.user_key || "?")[0];
      }
      refs.avatarDeleteButton.hidden = true;
    }

    // Profile inputs
    refs.profileDisplayNameInput.value = user.display_name || "";
    refs.profileUserKeyInput.value = user.user_key || "";
    refs.profileBioInput.value = user.bio || "";
    refs.profileBioCount.textContent = (user.bio || "").length;

    // Links
    renderLinksGrid();

    // Badge pool (in profile edit)
    renderProfileBadgePool(user);
  }

  function renderAccountSecurityModal() {
    if (!isAuthenticated()) {
      return;
    }

    const user = getUser();
    const twoFactor = getTwoFactor();
    const security = getSessionState().data?.security || {};
    const email = user.primary_email || "";
    const hasPassword = !!security.has_password;
    const hasDiscord = !!security.has_discord;
    const authProviders = Array.isArray(security.auth_providers) ? security.auth_providers : [];
    const registrationRoute = String(security.registration_route || "");

    refs.accountEmail.textContent = email || t("shell.value.unregistered", "Not set");
    refs.accountTwoFactor.textContent = twoFactor.is_enabled ? t("shell.value.enabled", "Enabled") : t("shell.value.disabled", "Disabled");
    refs.emailActionButton.textContent = email ? t("shell.action.change", "Change") : t("shell.action.register", "Register");
    refs.twoFactorEnableButton.hidden = twoFactor.is_enabled;
    refs.twoFactorDisableOpenButton.hidden = !twoFactor.is_enabled;

    if (refs.accountPasswordStatus) {
      refs.accountPasswordStatus.textContent = hasPassword ? t("shell.value.password_set", "Set") : t("shell.value.password_unset", "Not set");
    }
    if (refs.passwordChangeButton) refs.passwordChangeButton.hidden = !hasPassword;
    if (refs.passwordSetButton) refs.passwordSetButton.hidden = hasPassword;

    if (refs.accountDiscordStatus) {
      refs.accountDiscordStatus.textContent = hasDiscord ? t("shell.value.linked", "Linked") : t("shell.value.unlinked", "Not linked");
    }
    if (refs.accountRegistrationRoute) {
      const providerSet = new Set(authProviders);
      let routeText = t("shell.value.route_unknown", "Unknown");
      if (registrationRoute === "discord_and_email" || (providerSet.has("discord") && providerSet.has("email_password"))) {
        routeText = t("shell.value.route_discord_email", "Discord + Email");
      } else if (registrationRoute === "discord" || providerSet.has("discord")) {
        routeText = t("shell.value.route_discord", "Discord account");
      } else if (registrationRoute === "email" || hasPassword || providerSet.has("email_password")) {
        routeText = t("shell.value.route_email", "Email account");
      }
      refs.accountRegistrationRoute.textContent = routeText;
    }
    if (refs.discordLinkButton) refs.discordLinkButton.hidden = hasDiscord;
    if (refs.discordUnlinkButton) refs.discordUnlinkButton.hidden = !hasDiscord;
  }

  // メール変更フローの状態
  let emailVerifyTicket = null;
  let emailResendCooldownTimer = null;

  function renderEmailModal() {
    if (!isAuthenticated()) return;
    const email = currentEmail();
    const title = email ? t("shell.email.change", "Change Email") : t("shell.email.register", "Add Email");
    refs.emailTitle.textContent = title;
    refs.emailActionButton.textContent = title;
    _showEmailStep1();
  }

  function _showEmailStep1() {
    emailVerifyTicket = null;
    if (emailResendCooldownTimer) { clearInterval(emailResendCooldownTimer); emailResendCooldownTimer = null; }
    if (refs.emailStep1) refs.emailStep1.hidden = false;
    if (refs.emailStep2) refs.emailStep2.hidden = true;
    if (refs.emailResendButton) refs.emailResendButton.hidden = true;
    refs.emailInput.value = currentEmail();
    refs.emailSaveButton.textContent = t("shell.email.send", "Send Verification Email");
    refs.emailSaveButton.disabled = false;
  }

  function _showEmailStep2(maskedEmail, expiresInSec, resendCooldownSec) {
    if (refs.emailStep1) refs.emailStep1.hidden = true;
    if (refs.emailStep2) refs.emailStep2.hidden = false;
    if (refs.emailCodeInfo) refs.emailCodeInfo.textContent = t("shell.email.code_info", `A verification code was sent to ${maskedEmail}. Enter the code.`, { email: maskedEmail });
    if (refs.emailCodeInput) refs.emailCodeInput.value = "";
    refs.emailSaveButton.textContent = t("shell.email.verify", "Verify");
    refs.emailSaveButton.disabled = false;
    _startEmailResendCooldown(resendCooldownSec);
  }

  function _startEmailResendCooldown(sec) {
    if (!refs.emailResendButton) return;
    if (emailResendCooldownTimer) clearInterval(emailResendCooldownTimer);
    let remaining = Math.max(0, Math.ceil(sec));
    const update = () => {
      if (remaining <= 0) {
        clearInterval(emailResendCooldownTimer);
        emailResendCooldownTimer = null;
        refs.emailResendButton.disabled = false;
        refs.emailResendButton.textContent = t("shell.email.resend", "Resend");
        refs.emailResendButton.hidden = false;
      } else {
        refs.emailResendButton.disabled = true;
        refs.emailResendButton.textContent = t("shell.email.resend_countdown", `Resend (${remaining}s)`, { seconds: remaining });
        refs.emailResendButton.hidden = false;
        remaining--;
      }
    };
    update();
    emailResendCooldownTimer = setInterval(update, 1000);
  }

  async function refreshSession() {
    try {
      await session.load();
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.session_error", "Failed to load session.")));
    }
  }

  async function handleLogout() {
    try {
      await app.api.post("/api/auth/logout");
      session.clear();
      renderUserCard();
      toast.success(t("shell.toast.logout", "Logged out."));
      window.setTimeout(() => {
        window.location.href = "/auth";
      }, 250);
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.logout_error", "Failed to log out.")));
    }
  }

  async function handleLogoutAll() {
    if (!await openActionConfirm(t("shell.confirm.logout_all", "Log out from all devices?"), t("shell.confirm.logout", "Log out"), true)) {
      return;
    }

    try {
      await app.api.post("/api/auth/logout-all");
      session.clear();
      renderUserCard();
      toast.success(t("shell.toast.logout_all", "Logged out from all sessions."));
      window.setTimeout(() => {
        window.location.href = "/auth";
      }, 250);
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.logout_all_error", "Failed to log out from all sessions.")));
    }
  }

  async function handlePasswordSave() {
    try {
      await app.api.post("/api/auth/password/change", {
        current_password: refs.currentPasswordInput.value,
        new_password: refs.newPasswordInput.value
      });
      toast.success(t("shell.toast.password_changed", "Password changed. Please sign in again."));
      window.setTimeout(() => {
        window.location.href = "/auth";
      }, 300);
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.password_change_error", "Failed to change password.")));
    }
  }

  async function handleSetPasswordSave() {
    const password = refs.setPasswordInput?.value || "";
    if (!password) {
      toast.error(t("shell.toast.password_required", "Enter a password."));
      return;
    }
    try {
      await app.api.post("/api/auth/password/set", { password });
      app.modal.close("password-set");
      await refreshSession();
      renderAccountSecurityModal();
      toast.success(t("shell.toast.password_set", "Password set. You can now sign in with email and password."));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.password_set_error", "Failed to set password.")));
    }
  }

  async function handleDiscordLink() {
    try {
      const data = await app.api.post("/api/auth/discord/link/start");
      const redirectTo = data?.next?.to;
      if (redirectTo) {
        window.location.replace(redirectTo);
      } else {
        toast.error(t("shell.toast.discord_link_url_error", "Failed to get Discord link URL."));
      }
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.discord_link_start_error", "Failed to start Discord linking.")));
    }
  }

  async function handleDiscordUnlink() {
    const confirmed = await openActionConfirm(t("shell.confirm.discord_unlink", "Unlink Discord? Discord login will no longer be available."), t("shell.confirm.discord_unlink_approve", "Unlink"), true);
    if (!confirmed) return;
    try {
      await app.api.post("/api/auth/discord/unlink");
      toast.success(t("shell.toast.discord_unlinked", "Discord unlinked."));
      await refreshSession();
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.discord_unlink_error", "Failed to unlink Discord.")));
    }
  }

  async function beginTwoFactorFlow(kind) {
    if (!isAuthenticated()) {
      toast.error(t("shell.toast.login_required", "Login required."));
      return;
    }

    if (!currentEmail()) {
      const discordEmail = getSessionState().data?.security?.discord_email || "";
      if (discordEmail) {
        renderEmailModal();
        app.modal.open("email");
        setTimeout(async () => {
          refs.emailInput.value = discordEmail;
          await handleEmailSave();
        }, 150);
      } else {
        toast.error(t("shell.toast.2fa_email_required", "Two-factor authentication requires a registered email address."), 6000);
        if (refs.twoFactor) {
          app.modal.open("account");
          setTimeout(() => {
            const emailSection = refs.twoFactor.closest(".modal-section") || document.getElementById("shellAccountEmail");
            if (emailSection) emailSection.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 200);
        }
      }
      return;
    }

    const sendingMessage = kind === "setup"
      ? t("shell.confirm.2fa_enable_send", "Send a verification code to enable two-factor authentication?")
      : t("shell.confirm.2fa_disable_send", "Send a verification code to disable two-factor authentication?");
    const approved = await openActionConfirm(sendingMessage, t("shell.confirm.send_verify_code", "Send Code"));
    if (!approved) {
      return;
    }

    try {
      const endpoint = kind === "setup" ? "/api/auth/2fa/setup/start" : "/api/auth/2fa/disable/start";
      const payload = await app.api.post(endpoint);
      const verifyTicket = payload?.data?.verify_ticket || null;
      const maskedEmail = payload?.data?.masked_email || "";

      if (kind === "setup") {
        shellState.twoFactorSetupTicket = verifyTicket;
        refs.twoFactorSetupMessage.textContent = maskedEmail ? t("shell.email.code_info", `A verification code was sent to ${maskedEmail}. Enter the code.`, { email: maskedEmail }) : t("shell.toast.code_required", "Enter the verification code.");
        refs.twoFactorCodeInput.value = "";
        setCooldownFromSeconds("setup", payload?.data?.resend_cooldown_sec);
        app.modal.open("twofactor-setup");
      } else {
        shellState.twoFactorDisableTicket = verifyTicket;
        refs.twoFactorDisableMessage.textContent = maskedEmail ? t("shell.email.code_info", `A verification code was sent to ${maskedEmail}. Enter the code.`, { email: maskedEmail }) : t("shell.toast.code_required", "Enter the verification code.");
        refs.twoFactorDisableCodeInput.value = "";
        setCooldownFromSeconds("disable", payload?.data?.resend_cooldown_sec);
        app.modal.open("twofactor-disable");
      }

      toast.success(resolveLocalizedMessage(payload?.message, t("shell.toast.verify_sent", "Verification code sent.")));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.verify_send_error", "Failed to send verification code.")));
    }
  }

  async function handleTwoFactorEnable() {
    await beginTwoFactorFlow("setup");
  }

  async function handleTwoFactorSetupConfirm() {
    if (!shellState.twoFactorSetupTicket) {
      toast.error(t("shell.toast.invalid_token", "Missing verification token."));
      return;
    }

    try {
      await app.api.post("/api/auth/2fa/setup/confirm", {
        verify_ticket: shellState.twoFactorSetupTicket,
        code: refs.twoFactorCodeInput.value
      });
      shellState.twoFactorSetupTicket = null;
      shellState.twoFactorSetupResendAvailableAt = 0;
      refreshResendButtons();
      shellState.bypassVerificationCloseGuard = true;
      app.modal.close("twofactor-setup");
      shellState.bypassVerificationCloseGuard = false;
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success(t("shell.toast.2fa_enabled", "Two-factor authentication enabled."));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.2fa_enable_error", "Failed to enable two-factor authentication.")));
    }
  }

  async function handleTwoFactorSetupResend() {
    if (!shellState.twoFactorSetupTicket) {
      toast.error(t("shell.toast.invalid_token", "Missing verification token."));
      return;
    }
    if (getCooldownRemainingSec("setup") > 0) {
      toast.error(t("shell.toast.wait_resend", "Please wait before resending."));
      return;
    }

    try {
      const payload = await app.api.post("/api/auth/verify/email/send", {
        verify_ticket: shellState.twoFactorSetupTicket
      });
      shellState.twoFactorSetupTicket = payload.data.verify_ticket;
      refs.twoFactorSetupMessage.textContent = payload.data.masked_email
        ? t("shell.email.code_info", `A verification code was sent to ${payload.data.masked_email}. Enter the code.`, { email: payload.data.masked_email })
        : t("shell.toast.code_required", "Enter the verification code.");
      refs.twoFactorCodeInput.value = "";
      setCooldownFromSeconds("setup", payload?.data?.resend_cooldown_sec);
      toast.success(resolveLocalizedMessage(payload.message, t("shell.toast.code_resent", "Verification code resent.")));
    } catch (error) {
      const retryAfterSec = Number(error?.payload?.error?.retry_after_sec);
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
        setCooldownFromSeconds("setup", retryAfterSec);
      }
      toast.error(resolveLocalizedMessage(error, t("shell.toast.code_resend_error", "Failed to resend verification code.")));
    }
  }

  async function handleTwoFactorDisableStart() {
    await beginTwoFactorFlow("disable");
  }

  async function handleTwoFactorDisableConfirm() {
    if (!shellState.twoFactorDisableTicket) {
      toast.error(t("shell.toast.invalid_token", "Missing verification token."));
      return;
    }

    try {
      await app.api.post("/api/auth/2fa/disable/confirm", {
        verify_ticket: shellState.twoFactorDisableTicket,
        code: refs.twoFactorDisableCodeInput.value
      });
      shellState.twoFactorDisableTicket = null;
      shellState.twoFactorDisableResendAvailableAt = 0;
      refreshResendButtons();
      shellState.bypassVerificationCloseGuard = true;
      app.modal.close("twofactor-disable");
      shellState.bypassVerificationCloseGuard = false;
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success(t("shell.toast.2fa_disabled", "Two-factor authentication disabled."));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.2fa_disable_error", "Failed to disable two-factor authentication.")));
    }
  }

  async function handleTwoFactorDisableResend() {
    if (!shellState.twoFactorDisableTicket) {
      toast.error(t("shell.toast.invalid_token", "Missing verification token."));
      return;
    }
    if (getCooldownRemainingSec("disable") > 0) {
      toast.error(t("shell.toast.wait_resend", "Please wait before resending."));
      return;
    }

    try {
      const payload = await app.api.post("/api/auth/verify/email/send", {
        verify_ticket: shellState.twoFactorDisableTicket
      });
      shellState.twoFactorDisableTicket = payload.data.verify_ticket;
      refs.twoFactorDisableMessage.textContent = payload.data.masked_email
        ? t("shell.email.code_info", `A verification code was sent to ${payload.data.masked_email}. Enter the code.`, { email: payload.data.masked_email })
        : t("shell.toast.code_required", "Enter the verification code.");
      refs.twoFactorDisableCodeInput.value = "";
      setCooldownFromSeconds("disable", payload?.data?.resend_cooldown_sec);
      toast.success(resolveLocalizedMessage(payload.message, t("shell.toast.code_resent", "Verification code resent.")));
    } catch (error) {
      const retryAfterSec = Number(error?.payload?.error?.retry_after_sec);
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
        setCooldownFromSeconds("disable", retryAfterSec);
      }
      toast.error(resolveLocalizedMessage(error, t("shell.toast.code_resend_error", "Failed to resend verification code.")));
    }
  }

  async function requestDiscardVerificationFlow(kind) {
    const message = kind === "setup"
      ? t("shell.confirm.2fa_abort_enable", "Cancel two-factor activation?")
      : t("shell.confirm.2fa_abort_disable", "Cancel two-factor deactivation?");
    const approved = await openActionConfirm(message, t("shell.confirm.abort", "Cancel"), true);
    if (!approved) {
      return;
    }

    if (kind === "setup") {
      shellState.twoFactorSetupTicket = null;
      shellState.twoFactorSetupResendAvailableAt = 0;
      refs.twoFactorCodeInput.value = "";
      shellState.bypassVerificationCloseGuard = true;
      app.modal.close("twofactor-setup");
      shellState.bypassVerificationCloseGuard = false;
    } else {
      shellState.twoFactorDisableTicket = null;
      shellState.twoFactorDisableResendAvailableAt = 0;
      refs.twoFactorDisableCodeInput.value = "";
      shellState.bypassVerificationCloseGuard = true;
      app.modal.close("twofactor-disable");
      shellState.bypassVerificationCloseGuard = false;
    }

    refreshResendButtons();
  }

  async function handleProfileSave() {
    const displayName = refs.profileDisplayNameInput.value.trim();
    const userKey = refs.profileUserKeyInput.value.trim();
    const bio = refs.profileBioInput.value;

    if (!displayName) {
      toast.error(t("shell.toast.display_name_required", "Enter a display name."));
      refs.profileDisplayNameInput.focus();
      return;
    }
    if (!userKey) {
      toast.error(t("shell.toast.user_key_required", "Enter a user ID."));
      refs.profileUserKeyInput.focus();
      return;
    }

    refs.profileSaveButton.disabled = true;
    try {
      await app.api.patch("/api/auth/profile", {
        display_name: displayName,
        user_key: userKey,
        bio: bio,
      });
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success(t("shell.toast.profile_updated", "Profile updated."));
      app.modal.close("account");
    } catch (error) {
      const fieldErrors = error?.payload?.error?.field_errors || [];
      if (fieldErrors.length > 0) {
        toast.error(resolveLocalizedMessage(fieldErrors[0]?.message || error, t("shell.toast.check_input", "Check the input values.")));
      } else {
        toast.error(resolveLocalizedMessage(error, t("shell.toast.profile_update_error", "Failed to update profile.")));
      }
    } finally {
      refs.profileSaveButton.disabled = false;
    }
  }

  byId("shellViewMyPostsButton")?.addEventListener("click", () => {
    const user = getUser();
    if (!user?.user_key) return;
    app.modal.close("user-info");
    document.dispatchEvent(new CustomEvent("app:filter-by-owner", {
      detail: { userKey: user.user_key, displayName: user.display_name || user.user_key },
    }));
  });

  // --- Avatar crop ---

  function cropScaleToSlider(scale) {
    const { minScale, maxScale } = cropState;
    return Math.round(((scale - minScale) / (maxScale - minScale)) * 100);
  }

  function cropSliderToScale(val) {
    const { minScale, maxScale } = cropState;
    return minScale + (maxScale - minScale) * (val / 100);
  }

  function cropClampOffset() {
    const { img, scale } = cropState;
    if (!img) return;
    const scaledW = img.width * scale;
    const scaledH = img.height * scale;
    const maxX = Math.max(0, (scaledW - CROP_DISPLAY) / 2);
    const maxY = Math.max(0, (scaledH - CROP_DISPLAY) / 2);
    cropState.offsetX = Math.max(-maxX, Math.min(maxX, cropState.offsetX));
    cropState.offsetY = Math.max(-maxY, Math.min(maxY, cropState.offsetY));
  }

  function cropDraw() {
    const canvas = refs.avatarCropCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { img, scale, offsetX, offsetY } = cropState;
    ctx.clearRect(0, 0, CROP_DISPLAY, CROP_DISPLAY);
    if (!img) return;
    const scaledW = img.width * scale;
    const scaledH = img.height * scale;
    const x = (CROP_DISPLAY - scaledW) / 2 + offsetX;
    const y = (CROP_DISPLAY - scaledH) / 2 + offsetY;
    ctx.drawImage(img, x, y, scaledW, scaledH);
  }

  function openAvatarCropModal(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        cropState.img = img;
        const fitScale = Math.min(CROP_DISPLAY / img.width, CROP_DISPLAY / img.height);
        const fillScale = Math.max(CROP_DISPLAY / img.width, CROP_DISPLAY / img.height);
        cropState.minScale = fitScale;
        cropState.maxScale = Math.max(fillScale * 3, fitScale * 3);
        cropState.scale = fillScale;
        cropState.offsetX = 0;
        cropState.offsetY = 0;
        if (refs.avatarZoomSlider) {
          refs.avatarZoomSlider.value = String(cropScaleToSlider(fillScale));
        }
        cropDraw();
        app.modal.open("crop-avatar");
      };
      img.src = String(e.target.result);
    };
    reader.readAsDataURL(file);
  }

  async function handleCropConfirm() {
    if (!cropState.img) return;
    refs.avatarCropConfirmButton.disabled = true;
    try {
      const offscreen = document.createElement("canvas");
      offscreen.width = CROP_OUTPUT;
      offscreen.height = CROP_OUTPUT;
      const ctx = offscreen.getContext("2d");
      const ratio = CROP_OUTPUT / CROP_DISPLAY;
      const { img, scale, offsetX, offsetY } = cropState;
      const scaledW = img.width * scale * ratio;
      const scaledH = img.height * scale * ratio;
      const x = (CROP_OUTPUT - scaledW) / 2 + offsetX * ratio;
      const y = (CROP_OUTPUT - scaledH) / 2 + offsetY * ratio;
      ctx.drawImage(img, x, y, scaledW, scaledH);

      offscreen.toBlob(async (blob) => {
        app.modal.close("crop-avatar");
        await uploadAvatarBlob(blob);
        refs.avatarCropConfirmButton.disabled = false;
      }, "image/jpeg", 0.92);
    } catch {
      refs.avatarCropConfirmButton.disabled = false;
    }
  }

  async function uploadAvatarBlob(blob) {
    const formData = new FormData();
    formData.append("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
    try {
      await app.api.postForm("/api/auth/avatar", formData);
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success(t("shell.toast.avatar_updated", "Avatar updated."));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.avatar_update_error", "Failed to upload avatar.")));
    }
  }

  function bindCropDrag() {
    const stage = refs.avatarCropStage;
    if (!stage) return;

    stage.addEventListener("mousedown", (e) => {
      cropState.isDragging = true;
      cropState.dragStartX = e.clientX;
      cropState.dragStartY = e.clientY;
      cropState.dragStartOffsetX = cropState.offsetX;
      cropState.dragStartOffsetY = cropState.offsetY;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!cropState.isDragging) return;
      cropState.offsetX = cropState.dragStartOffsetX + (e.clientX - cropState.dragStartX);
      cropState.offsetY = cropState.dragStartOffsetY + (e.clientY - cropState.dragStartY);
      cropClampOffset();
      cropDraw();
    });

    window.addEventListener("mouseup", () => { cropState.isDragging = false; });

    stage.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      cropState.isDragging = true;
      cropState.dragStartX = t.clientX;
      cropState.dragStartY = t.clientY;
      cropState.dragStartOffsetX = cropState.offsetX;
      cropState.dragStartOffsetY = cropState.offsetY;
      e.preventDefault();
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      if (!cropState.isDragging) return;
      const t = e.touches[0];
      cropState.offsetX = cropState.dragStartOffsetX + (t.clientX - cropState.dragStartX);
      cropState.offsetY = cropState.dragStartOffsetY + (t.clientY - cropState.dragStartY);
      cropClampOffset();
      cropDraw();
    }, { passive: false });

    window.addEventListener("touchend", () => { cropState.isDragging = false; });
  }

  async function handleAvatarDelete() {
    if (!window.confirm(t("shell.confirm.avatar_delete", "Delete the avatar?"))) return;
    try {
      await app.api.delete("/api/auth/avatar");
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success(t("shell.toast.avatar_deleted", "Avatar deleted."));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.avatar_delete_error", "Failed to delete avatar.")));
    }
  }

  async function handleEmailSave() {
    refs.emailSaveButton.disabled = true;

    // Step 2: コード確認
    if (emailVerifyTicket) {
      const code = (refs.emailCodeInput?.value || "").trim();
      if (!code) {
        toast.error(t("shell.toast.code_required", "Enter the verification code."));
        refs.emailSaveButton.disabled = false;
        return;
      }
      try {
        await app.api.post("/api/auth/verify/email/confirm", { verify_ticket: emailVerifyTicket, code });
        app.modal.close("email");
        await refreshSession();
        renderAccountSecurityModal();
        renderUserCard();
        toast.success(t("shell.toast.email_changed", "Email address updated."));
      } catch (error) {
        toast.error(resolveLocalizedMessage(error, t("shell.toast.invalid_code", "Invalid verification code.")));
        refs.emailSaveButton.disabled = false;
      }
      return;
    }

    // Step 1: 確認メール送信
    const newEmail = refs.emailInput.value.trim();
    if (!newEmail) {
      toast.error(t("shell.toast.email_required", "Enter an email address."));
      refs.emailSaveButton.disabled = false;
      return;
    }
    try {
      const result = await app.api.post("/api/auth/email/change/start", { new_email: newEmail });
      emailVerifyTicket = result.data?.verify_ticket;
      _showEmailStep2(
        result.data?.masked_email || newEmail,
        result.data?.expires_in_sec || 600,
        result.data?.resend_cooldown_sec || 60,
      );
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.email_send_error", "Failed to send verification email.")));
      refs.emailSaveButton.disabled = false;
    }
  }

  async function handleEmailResend() {
    if (!emailVerifyTicket) return;
    refs.emailResendButton.disabled = true;
    try {
      const result = await app.api.post("/api/auth/verify/email/send", { verify_ticket: emailVerifyTicket });
      emailVerifyTicket = result.data?.verify_ticket || emailVerifyTicket;
      _startEmailResendCooldown(result.data?.resend_cooldown_sec || 60);
      toast.success(t("shell.toast.code_resent", "Verification code resent."));
    } catch (error) {
      toast.error(resolveLocalizedMessage(error, t("shell.toast.resend_error", "Failed to resend.")));
      refs.emailResendButton.disabled = false;
    }
  }

  function handleBeforeUnload(event) {
    if (!hasPendingVerificationFlow() || shellState.allowBrowserLeave) {
      return;
    }
    event.preventDefault();
    event.returnValue = "";
  }

  function bindEvents() {
    refs.userTrigger.addEventListener("click", () => {
      app.modal.open("user-info");
    });

    refs.loginButton.addEventListener("click", () => {
      window.location.href = "/auth";
    });

    if (refs.logoutButton) {
      refs.logoutButton.addEventListener("click", handleLogout);
    }
    if (refs.logoutAllButton) {
      refs.logoutAllButton.addEventListener("click", handleLogoutAll);
    }
    if (refs.profilePreviewButton) {
      refs.profilePreviewButton.addEventListener("click", () => {
        const userKey = getUser()?.user_key;
        if (userKey) {
          document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey } }));
        }
      });
    }
    // Badge pool click delegation (in profile edit modal)
    const profileBadgePoolEl = byId("shellProfileBadgePool");
    if (profileBadgePoolEl) {
      profileBadgePoolEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".shell-badge-pool__item[data-badge-key]");
        if (!btn) return;
        const user = getUser();
        if (user) handleBadgeToggle(btn.dataset.badgeKey, user);
      });
    }

    refs.passwordSaveButton.addEventListener("click", handlePasswordSave);
    if (refs.setPasswordSaveButton) refs.setPasswordSaveButton.addEventListener("click", handleSetPasswordSave);
    if (refs.discordLinkButton) refs.discordLinkButton.addEventListener("click", handleDiscordLink);
    if (refs.discordUnlinkButton) refs.discordUnlinkButton.addEventListener("click", handleDiscordUnlink);
    refs.profileSaveButton.addEventListener("click", handleProfileSave);
    refs.avatarFileInput.addEventListener("change", () => {
      const file = refs.avatarFileInput.files?.[0] || null;
      refs.avatarFileInput.value = "";
      if (file) openAvatarCropModal(file);
    });
    refs.profileBioInput.addEventListener("input", () => {
      refs.profileBioCount.textContent = refs.profileBioInput.value.length;
    });
    if (refs.avatarZoomSlider) {
      refs.avatarZoomSlider.addEventListener("input", () => {
        cropState.scale = cropSliderToScale(Number(refs.avatarZoomSlider.value));
        cropClampOffset();
        cropDraw();
      });
    }
    if (refs.avatarCropConfirmButton) {
      refs.avatarCropConfirmButton.addEventListener("click", handleCropConfirm);
    }
    if (refs.avatarCropCancelButton) {
      refs.avatarCropCancelButton.addEventListener("click", () => {
        cropState.img = null;
        app.modal.close("crop-avatar");
      });
    }
    bindCropDrag();
    refs.addLinkSubmitButton.addEventListener("click", handleLinkAdd);
    refs.addLinkInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleLinkAdd();
    });
    refs.avatarDeleteButton.addEventListener("click", handleAvatarDelete);
    refs.twoFactorEnableButton.addEventListener("click", handleTwoFactorEnable);
    refs.twoFactorSetupConfirmButton.addEventListener("click", handleTwoFactorSetupConfirm);
    refs.twoFactorSetupResendButton.addEventListener("click", handleTwoFactorSetupResend);
    refs.twoFactorSetupCancelButton.addEventListener("click", () => requestDiscardVerificationFlow("setup"));
    refs.twoFactorDisableOpenButton.addEventListener("click", handleTwoFactorDisableStart);
    refs.twoFactorDisableConfirmButton.addEventListener("click", handleTwoFactorDisableConfirm);
    refs.twoFactorDisableResendButton.addEventListener("click", handleTwoFactorDisableResend);
    refs.twoFactorDisableCancelButton.addEventListener("click", () => requestDiscardVerificationFlow("disable"));
    refs.actionConfirmApproveButton.addEventListener("click", () => closeActionConfirm(true));
    refs.actionConfirmCancelButton.addEventListener("click", () => closeActionConfirm(false));
    refs.emailSaveButton.addEventListener("click", handleEmailSave);
    if (refs.emailResendButton) refs.emailResendButton.addEventListener("click", handleEmailResend);

    refs.settingLanguage.addEventListener("change", async () => {
      const nextLanguage = app.settings.setLanguage(refs.settingLanguage.value);
      refs.settingLanguage.value = nextLanguage;
      await ensureLanguageCatalog(nextLanguage);
      app.i18n?.setLanguage?.(nextLanguage);
      dispatchLanguageChange(nextLanguage);
      toast.success(t("shell.toast.save_language", "Language saved."));
    });

    refs.settingTheme.addEventListener("change", () => {
      app.settings.setTheme(refs.settingTheme.value);
      app.theme.apply(refs.settingTheme.value);
      toast.success(t("shell.toast.save_theme", "Theme saved."));
    });

    if (refs.settingImageOpenBehavior) {
      refs.settingImageOpenBehavior.addEventListener("change", () => {
        app.settings.setImageOpenBehavior(refs.settingImageOpenBehavior.value);
        toast.success(t("shell.toast.save_open_behavior", "Image open behavior saved."));
      });
    }

    if (refs.settingImageBackdropClose) {
      refs.settingImageBackdropClose.addEventListener("change", () => {
        app.settings.setImageBackdropClose(refs.settingImageBackdropClose.checked);
        toast.success(t("shell.toast.save_backdrop_close", "Backdrop close setting saved."));
      });
    }

    if (refs.settingImageMetaPinned) {
      refs.settingImageMetaPinned.addEventListener("change", () => {
        app.settings.setImageMetaPinned(refs.settingImageMetaPinned.checked);
        toast.success(t("shell.toast.save_meta_pinned", "Meta bar setting saved."));
      });
    }

    document.getElementById("appModalRoot").addEventListener("app:modal-open", (event) => {
      const id = event.detail.id;

      if (id === "settings") {
        renderSettings();
      }
      if (id === "credits") {
        renderCredits();
      }
      if (id === "account") {
        renderAccountModal();
      }
      if (id === "account-security") {
        renderAccountSecurityModal();
      }
      if (id === "email") {
        renderEmailModal();
      }
    });

    document.getElementById("appModalRoot").addEventListener("app:modal-close", (event) => {
      if (shellState.bypassVerificationCloseGuard) {
        return;
      }
      const id = event.detail.id;
      if (id === "twofactor-setup" && shellState.twoFactorSetupTicket) {
        app.modal.open("twofactor-setup");
        requestDiscardVerificationFlow("setup");
      }
      if (id === "twofactor-disable" && shellState.twoFactorDisableTicket) {
        app.modal.open("twofactor-disable");
        requestDiscardVerificationFlow("disable");
      }
      if (id === "email") {
        // モーダルを閉じたらステップをリセット
        _showEmailStep1();
      }
    });

    session.subscribe(() => {
      renderUserCard();
    });

    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  renderHelpContent();
  renderCreditsContent();
  renderCredits();
  renderSettings();
  renderUserCard();
  applyStaticTranslations();
  refreshResendButtons();
  startCountdownTimer();
  bindEvents();
  window.addEventListener("gallery:language-changed", () => {
    renderHelpContent();
    renderCreditsContent();
    renderCredits();
    applyStaticTranslations();
    refreshResendButtons();
    renderUserCard();
    renderAccountSecurityModal();
  });

  // Discord連携コールバック結果をトースト通知
  const _discordLinkParam = new URLSearchParams(location.search).get("discord_link");
  if (_discordLinkParam) {
    const _url = new URL(location.href);
    _url.searchParams.delete("discord_link");
    history.replaceState(null, "", _url.toString());
    setTimeout(() => {
      if (_discordLinkParam === "ok") toast.success(t("shell.toast.discord_linked", "Discord account linked."));
      else if (_discordLinkParam === "already") toast.success(t("shell.toast.discord_already", "This Discord account is already linked."));
      else if (_discordLinkParam === "conflict") toast.error(t("shell.toast.discord_conflict", "This Discord account is linked to another account."));
    }, 500);
  }
}
