import { byId } from "../core/dom.js";

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
  return `/gallery/assets/icons/social/${slug}.svg`;
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
  return date.toLocaleString("ja-JP");
}

function nowMs() {
  return Date.now();
}

export function initUserShell(app) {
  const session = app.session;
  const toast = app.toast;

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
    discordLinkButton: byId("shellDiscordLinkButton"),

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
      refs.twoFactorSetupResendButton.textContent = setupRemain > 0 ? `再送 (${setupRemain}秒)` : "再送";
    }

    const disableRemain = getCooldownRemainingSec("disable");
    if (refs.twoFactorDisableResendButton) {
      refs.twoFactorDisableResendButton.disabled = disableRemain > 0;
      refs.twoFactorDisableResendButton.textContent = disableRemain > 0 ? `再送 (${disableRemain}秒)` : "再送";
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

  function openActionConfirm(message, approveText = "実行する", danger = false) {
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
    refs.creditAuthor.textContent = document.body.dataset.creditAuthor || "-";
    refs.creditStack.textContent = document.body.dataset.creditStack || "-";
    refs.creditLicense.textContent = document.body.dataset.creditLicense || "-";
    refs.creditUpdatedAt.textContent = document.body.dataset.creditUpdatedAt || "-";
    refs.creditVersion.textContent = document.body.dataset.appVersion || "-";
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
      refs.adminLink.hidden = true;
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
    refs.email.textContent = user.primary_email || "未登録";
    refs.createdAt.textContent = formatDate(user.created_at);
    refs.twoFactor.textContent = twoFactor.is_enabled ? "有効" : "無効";

    if (user.role === "admin") {
      refs.roleRow.hidden = false;
      refs.role.textContent = "管理者";
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
    refs.adminLink.hidden = document.body.dataset.hideAdminLinkInShell === "1" || !features.can_open_admin;
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
      `<span class="user-profile-badge user-profile-badge--${badge.color || "gray"}" title="${badge.name || badge.key}">${getBadgeIconHtml(badge, app.appBase)}</span>`
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
      list.innerHTML = `<span class="shell-badge-pool__empty">バッジはまだありません</span>`;
      return;
    }

    const displayBadges = Array.isArray(user.display_badges) ? user.display_badges : [];
    list.innerHTML = "";
    for (const badge of pool) {
      const isSelected = displayBadges.includes(badge.key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `shell-badge-pool__item shell-badge-pool__item--${badge.color || "gray"}${isSelected ? " is-selected" : ""}`;
      btn.dataset.badgeKey = badge.key;
      btn.title = badge.description || badge.name || "";
      btn.innerHTML = `${getBadgeIconHtml(badge, app.appBase)}${badge.name || badge.key}`;
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
        app.toast?.info?.("バッジは最大3つまで選択できます。");
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
      app.toast?.error?.(err?.message || "バッジの更新に失敗しました。");
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
        <button class="shell-link-box__remove" type="button" aria-label="削除" data-link-id="${link.id}">×</button>
      `;
      grid.appendChild(box);
    }

    if (links.length < MAX_LINKS) {
      const addBox = document.createElement("div");
      addBox.className = "shell-link-box shell-link-box--add";
      addBox.innerHTML = `<button class="shell-link-box__add" type="button" aria-label="リンクを追加">+</button>`;
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
      toast.error("URLを入力してください。");
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
      toast.success(result?.message || "リンクを追加しました。");
    } catch (error) {
      const fieldErrors = error?.payload?.error?.field_errors || [];
      toast.error(fieldErrors[0]?.message || error.message || "リンクの追加に失敗しました。");
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
      toast.success("リンクを削除しました。");
    } catch (error) {
      toast.error(error.message || "リンクの削除に失敗しました。");
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

    refs.accountEmail.textContent = email || "未登録";
    refs.accountTwoFactor.textContent = twoFactor.is_enabled ? "有効" : "無効";
    refs.emailActionButton.textContent = email ? "変更" : "登録";
    refs.twoFactorEnableButton.hidden = twoFactor.is_enabled;
    refs.twoFactorDisableOpenButton.hidden = !twoFactor.is_enabled;

    if (refs.accountPasswordStatus) {
      refs.accountPasswordStatus.textContent = hasPassword ? "設定済み" : "未設定";
    }
    if (refs.passwordChangeButton) refs.passwordChangeButton.hidden = !hasPassword;
    if (refs.passwordSetButton) refs.passwordSetButton.hidden = hasPassword;

    if (refs.accountDiscordStatus) {
      refs.accountDiscordStatus.textContent = hasDiscord ? "連携済み" : "未連携";
    }
    if (refs.discordLinkButton) refs.discordLinkButton.hidden = hasDiscord;
  }

  // メール変更フローの状態
  let emailVerifyTicket = null;
  let emailResendCooldownTimer = null;

  function renderEmailModal() {
    if (!isAuthenticated()) return;
    const email = currentEmail();
    const title = email ? "メールアドレス変更" : "メールアドレス登録";
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
    refs.emailSaveButton.textContent = "確認メールを送信";
    refs.emailSaveButton.disabled = false;
  }

  function _showEmailStep2(maskedEmail, expiresInSec, resendCooldownSec) {
    if (refs.emailStep1) refs.emailStep1.hidden = true;
    if (refs.emailStep2) refs.emailStep2.hidden = false;
    if (refs.emailCodeInfo) refs.emailCodeInfo.textContent = `確認コードを ${maskedEmail} に送信しました。コードを入力してください。`;
    if (refs.emailCodeInput) refs.emailCodeInput.value = "";
    refs.emailSaveButton.textContent = "確認する";
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
        refs.emailResendButton.textContent = "再送する";
        refs.emailResendButton.hidden = false;
      } else {
        refs.emailResendButton.disabled = true;
        refs.emailResendButton.textContent = `再送する（${remaining}秒後）`;
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
      toast.error(error.message || "セッション情報の取得に失敗しました。");
    }
  }

  async function handleLogout() {
    try {
      await app.api.post("/api/auth/logout");
      session.clear();
      renderUserCard();
      toast.success("ログアウトしました。");
      window.setTimeout(() => {
        window.location.href = "/gallery/auth";
      }, 250);
    } catch (error) {
      toast.error(error.message || "ログアウトに失敗しました。");
    }
  }

  async function handleLogoutAll() {
    if (!window.confirm("全端末からログアウトします。よろしいですか。")) {
      return;
    }

    try {
      await app.api.post("/api/auth/logout-all");
      session.clear();
      renderUserCard();
      toast.success("全端末からログアウトしました。");
      window.setTimeout(() => {
        window.location.href = "/gallery/auth";
      }, 250);
    } catch (error) {
      toast.error(error.message || "全端末ログアウトに失敗しました。");
    }
  }

  async function handlePasswordSave() {
    try {
      await app.api.post("/api/auth/password/change", {
        current_password: refs.currentPasswordInput.value,
        new_password: refs.newPasswordInput.value
      });
      toast.success("パスワードを変更しました。再ログインしてください。");
      window.setTimeout(() => {
        window.location.href = "/gallery/auth";
      }, 300);
    } catch (error) {
      toast.error(error.message || "パスワード変更に失敗しました。");
    }
  }

  async function handleSetPasswordSave() {
    const password = refs.setPasswordInput?.value || "";
    if (!password) {
      toast.error("パスワードを入力してください。");
      return;
    }
    try {
      await app.api.post("/api/auth/password/set", { password });
      app.modal.close("password-set");
      await refreshSession();
      renderAccountSecurityModal();
      toast.success("パスワードを設定しました。メールアドレスとパスワードでもログインできます。");
    } catch (error) {
      toast.error(error.message || "パスワードの設定に失敗しました。");
    }
  }

  async function handleDiscordLink() {
    try {
      const data = await app.api.post("/api/auth/discord/link/start");
      const redirectTo = data?.next?.to;
      if (redirectTo) {
        window.location.replace(redirectTo);
      } else {
        toast.error("Discord連携URLの取得に失敗しました。");
      }
    } catch (error) {
      toast.error(error.message || "Discord連携の開始に失敗しました。");
    }
  }

  async function beginTwoFactorFlow(kind) {
    if (!isAuthenticated()) {
      toast.error("ログインが必要です。");
      return;
    }

    if (!currentEmail()) {
      toast.error("2段階認証にはメールアドレスの登録が必要です。設定からメールアドレスを登録してください。", 6000);
      if (refs.twoFactor) {
        app.modal.open("account");
        setTimeout(() => {
          const emailSection = refs.twoFactor.closest(".modal-section") || document.getElementById("shellAccountEmail");
          if (emailSection) emailSection.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
      }
      return;
    }

    const sendingMessage = kind === "setup"
      ? "2段階認証の有効化確認コードを送信します。よろしいですか。"
      : "2段階認証の無効化確認コードを送信します。よろしいですか。";
    const approved = await openActionConfirm(sendingMessage, "確認コードを送信");
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
        refs.twoFactorSetupMessage.textContent = maskedEmail ? `${maskedEmail} に届いた確認コードを入力してください。` : "確認コードを入力してください。";
        refs.twoFactorCodeInput.value = "";
        setCooldownFromSeconds("setup", payload?.data?.resend_cooldown_sec);
        app.modal.open("twofactor-setup");
      } else {
        shellState.twoFactorDisableTicket = verifyTicket;
        refs.twoFactorDisableMessage.textContent = maskedEmail ? `${maskedEmail} に届いた確認コードを入力してください。` : "確認コードを入力してください。";
        refs.twoFactorDisableCodeInput.value = "";
        setCooldownFromSeconds("disable", payload?.data?.resend_cooldown_sec);
        app.modal.open("twofactor-disable");
      }

      toast.success(payload?.message || "確認コードを送信しました。");
    } catch (error) {
      toast.error(error.message || "確認コードの送信に失敗しました。");
    }
  }

  async function handleTwoFactorEnable() {
    await beginTwoFactorFlow("setup");
  }

  async function handleTwoFactorSetupConfirm() {
    if (!shellState.twoFactorSetupTicket) {
      toast.error("確認トークンがありません。");
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
      toast.success("2段階認証を有効化しました。");
    } catch (error) {
      toast.error(error.message || "2段階認証の有効化に失敗しました。");
    }
  }

  async function handleTwoFactorSetupResend() {
    if (!shellState.twoFactorSetupTicket) {
      toast.error("確認トークンがありません。");
      return;
    }
    if (getCooldownRemainingSec("setup") > 0) {
      toast.error("しばらく待ってから再送してください。");
      return;
    }

    try {
      const payload = await app.api.post("/api/auth/verify/email/send", {
        verify_ticket: shellState.twoFactorSetupTicket
      });
      shellState.twoFactorSetupTicket = payload.data.verify_ticket;
      refs.twoFactorSetupMessage.textContent = payload.data.masked_email ? `${payload.data.masked_email} に届いた確認コードを入力してください。` : "確認コードを入力してください。";
      refs.twoFactorCodeInput.value = "";
      setCooldownFromSeconds("setup", payload?.data?.resend_cooldown_sec);
      toast.success(payload.message || "確認コードを再送しました。");
    } catch (error) {
      const retryAfterSec = Number(error?.payload?.error?.retry_after_sec);
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
        setCooldownFromSeconds("setup", retryAfterSec);
      }
      toast.error(error.message || "確認コードの再送に失敗しました。");
    }
  }

  async function handleTwoFactorDisableStart() {
    await beginTwoFactorFlow("disable");
  }

  async function handleTwoFactorDisableConfirm() {
    if (!shellState.twoFactorDisableTicket) {
      toast.error("確認トークンがありません。");
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
      toast.success("2段階認証を無効化しました。");
    } catch (error) {
      toast.error(error.message || "2段階認証の無効化に失敗しました。");
    }
  }

  async function handleTwoFactorDisableResend() {
    if (!shellState.twoFactorDisableTicket) {
      toast.error("確認トークンがありません。");
      return;
    }
    if (getCooldownRemainingSec("disable") > 0) {
      toast.error("しばらく待ってから再送してください。");
      return;
    }

    try {
      const payload = await app.api.post("/api/auth/verify/email/send", {
        verify_ticket: shellState.twoFactorDisableTicket
      });
      shellState.twoFactorDisableTicket = payload.data.verify_ticket;
      refs.twoFactorDisableMessage.textContent = payload.data.masked_email ? `${payload.data.masked_email} に届いた確認コードを入力してください。` : "確認コードを入力してください。";
      refs.twoFactorDisableCodeInput.value = "";
      setCooldownFromSeconds("disable", payload?.data?.resend_cooldown_sec);
      toast.success(payload.message || "確認コードを再送しました。");
    } catch (error) {
      const retryAfterSec = Number(error?.payload?.error?.retry_after_sec);
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
        setCooldownFromSeconds("disable", retryAfterSec);
      }
      toast.error(error.message || "確認コードの再送に失敗しました。");
    }
  }

  async function requestDiscardVerificationFlow(kind) {
    const message = kind === "setup"
      ? "2段階認証の有効化確認を中断しますか？"
      : "2段階認証の無効化確認を中断しますか？";
    const approved = await openActionConfirm(message, "中断する", true);
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
      toast.error("表示名を入力してください。");
      refs.profileDisplayNameInput.focus();
      return;
    }
    if (!userKey) {
      toast.error("ユーザーIDを入力してください。");
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
      toast.success("プロフィールを更新しました。");
      app.modal.close("account");
    } catch (error) {
      const fieldErrors = error?.payload?.error?.field_errors || [];
      if (fieldErrors.length > 0) {
        toast.error(fieldErrors[0].message || error.message || "入力内容を確認してください。");
      } else {
        toast.error(error.message || "プロフィールの更新に失敗しました。");
      }
    } finally {
      refs.profileSaveButton.disabled = false;
    }
  }

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
      toast.success("アイコンを更新しました。");
    } catch (error) {
      toast.error(error.message || "アイコンのアップロードに失敗しました。");
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
    if (!window.confirm("アイコンを削除しますか？")) return;
    try {
      await app.api.delete("/api/auth/avatar");
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success("アイコンを削除しました。");
    } catch (error) {
      toast.error(error.message || "アイコンの削除に失敗しました。");
    }
  }

  async function handleEmailSave() {
    refs.emailSaveButton.disabled = true;

    // Step 2: コード確認
    if (emailVerifyTicket) {
      const code = (refs.emailCodeInput?.value || "").trim();
      if (!code) {
        toast.error("確認コードを入力してください。");
        refs.emailSaveButton.disabled = false;
        return;
      }
      try {
        await app.api.post("/api/auth/verify/email/confirm", { verify_ticket: emailVerifyTicket, code });
        app.modal.close("email");
        await refreshSession();
        renderAccountSecurityModal();
        renderUserCard();
        toast.success("メールアドレスを変更しました。");
      } catch (error) {
        toast.error(error.message || "確認コードが正しくありません。");
        refs.emailSaveButton.disabled = false;
      }
      return;
    }

    // Step 1: 確認メール送信
    const newEmail = refs.emailInput.value.trim();
    if (!newEmail) {
      toast.error("メールアドレスを入力してください。");
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
      toast.error(error.message || "確認メールの送信に失敗しました。");
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
      toast.success("確認コードを再送しました。");
    } catch (error) {
      toast.error(error.message || "再送に失敗しました。");
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
      window.location.href = "/gallery/auth";
    });

    refs.logoutButton.addEventListener("click", handleLogout);
    refs.logoutAllButton.addEventListener("click", handleLogoutAll);
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

    refs.settingLanguage.addEventListener("change", () => {
      app.settings.setLanguage(refs.settingLanguage.value);
      toast.success("言語設定を保存しました。");
    });

    refs.settingTheme.addEventListener("change", () => {
      app.settings.setTheme(refs.settingTheme.value);
      app.theme.apply(refs.settingTheme.value);
      toast.success("テーマ設定を保存しました。");
    });

    if (refs.settingImageOpenBehavior) {
      refs.settingImageOpenBehavior.addEventListener("change", () => {
        app.settings.setImageOpenBehavior(refs.settingImageOpenBehavior.value);
        toast.success("画像の開き方を保存しました。");
      });
    }

    if (refs.settingImageBackdropClose) {
      refs.settingImageBackdropClose.addEventListener("change", () => {
        app.settings.setImageBackdropClose(refs.settingImageBackdropClose.checked);
        toast.success("画像モーダルの背景クリック設定を保存しました。");
      });
    }

    if (refs.settingImageMetaPinned) {
      refs.settingImageMetaPinned.addEventListener("change", () => {
        app.settings.setImageMetaPinned(refs.settingImageMetaPinned.checked);
        toast.success("画像モーダルのメタ情報バー設定を保存しました。");
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

  renderCredits();
  renderSettings();
  renderUserCard();
  refreshResendButtons();
  startCountdownTimer();
  bindEvents();

  // Discord連携コールバック結果をトースト通知
  const _discordLinkParam = new URLSearchParams(location.search).get("discord_link");
  if (_discordLinkParam) {
    const _url = new URL(location.href);
    _url.searchParams.delete("discord_link");
    history.replaceState(null, "", _url.toString());
    setTimeout(() => {
      if (_discordLinkParam === "ok") toast.success("Discordアカウントを連携しました。");
      else if (_discordLinkParam === "already") toast.success("このDiscordアカウントはすでに連携済みです。");
      else if (_discordLinkParam === "conflict") toast.error("このDiscordアカウントは別のアカウントに紐付いています。");
    }, 500);
  }
}