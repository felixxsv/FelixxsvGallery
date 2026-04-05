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
    emailInput: byId("shellEmailInput"),
    emailSaveButton: byId("shellEmailSaveButton"),

    currentPasswordInput: byId("shellCurrentPasswordInput"),
    newPasswordInput: byId("shellNewPasswordInput"),
    passwordSaveButton: byId("shellPasswordSaveButton"),

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
    refs.guestIcon.hidden = isAuthenticated();
    refs.authIcon.hidden = !isAuthenticated();
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

    // Links
    const links = user.links || [];
    if (links.length > 0) {
      refs.userCardLinks.hidden = false;
      refs.userCardLinks.innerHTML = links.map((link) => {
        const iconUrl = getLinkIconUrl(link.url);
        return `<a class="shell-user-link" href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.url}"><span class="shell-user-link__icon" style="--link-icon: url('${iconUrl}')"></span></a>`;
      }).join("");
    } else {
      refs.userCardLinks.hidden = true;
      refs.userCardLinks.innerHTML = "";
    }

    const uploadEnabled = user.upload_enabled !== false;
    refs.uploadDisabled.hidden = uploadEnabled;
    if (refs.uploadOpenButton) refs.uploadOpenButton.hidden = !uploadEnabled;
    refs.accountOpenButton.hidden = false;
    refs.adminLink.hidden = document.body.dataset.hideAdminLinkInShell === "1" || !features.can_open_admin;
    refs.userFooter.hidden = false;
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
      refs.accountAvatarInitial.hidden = true;
      refs.avatarDeleteButton.hidden = false;
    } else {
      refs.accountAvatarImg.hidden = true;
      refs.accountAvatarImg.src = "";
      refs.accountAvatarInitial.hidden = false;
      refs.accountAvatarInitial.textContent = (user.display_name || user.user_key || "?")[0];
      refs.avatarDeleteButton.hidden = true;
    }

    // Profile inputs
    refs.profileDisplayNameInput.value = user.display_name || "";
    refs.profileUserKeyInput.value = user.user_key || "";
    refs.profileBioInput.value = user.bio || "";
    refs.profileBioCount.textContent = (user.bio || "").length;

    // Links
    renderLinksGrid();
  }

  function renderAccountSecurityModal() {
    if (!isAuthenticated()) {
      return;
    }

    const user = getUser();
    const twoFactor = getTwoFactor();
    const email = user.primary_email || "";

    refs.accountEmail.textContent = email || "未登録";
    refs.accountTwoFactor.textContent = twoFactor.is_enabled ? "有効" : "無効";
    refs.emailActionButton.textContent = email ? "変更" : "登録";
    refs.twoFactorEnableButton.hidden = twoFactor.is_enabled;
    refs.twoFactorDisableOpenButton.hidden = !twoFactor.is_enabled;
  }

  function renderEmailModal() {
    if (!isAuthenticated()) {
      return;
    }

    const email = currentEmail();
    const title = email ? "メールアドレス変更" : "メールアドレス登録";
    refs.emailTitle.textContent = title;
    refs.emailActionButton.textContent = title;
    refs.emailInput.value = email;
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

  async function beginTwoFactorFlow(kind) {
    if (!isAuthenticated()) {
      toast.error("ログインが必要です。");
      return;
    }

    if (!currentEmail()) {
      toast.error("メールアドレスを入力してください。");
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

  function handleEmailSave() {
    const email = refs.emailInput.value.trim();
    if (!email) {
      toast.error("メールアドレスを入力してください。");
      return;
    }
    toast.info("メールアドレス登録・変更は未実装です。");
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
    refs.passwordSaveButton.addEventListener("click", handlePasswordSave);
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
}