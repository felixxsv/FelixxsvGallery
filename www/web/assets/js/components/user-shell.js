import { byId } from "../core/dom.js";

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
    profileSaveButton: byId("shellProfileSaveButton"),

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

    const uploadEnabled = user.upload_enabled !== false;
    refs.uploadDisabled.hidden = uploadEnabled;
    if (refs.uploadOpenButton) refs.uploadOpenButton.hidden = !uploadEnabled;
    refs.accountOpenButton.hidden = false;
    refs.adminLink.hidden = document.body.dataset.hideAdminLinkInShell === "1" || !features.can_open_admin;
    refs.userFooter.hidden = false;
  }

  function renderAccountModal() {
    if (!isAuthenticated()) {
      return;
    }

    const user = getUser();
    const twoFactor = getTwoFactor();
    const email = user.primary_email || "";

    // Avatar
    const avatarUrl = user.avatar_url || null;
    if (avatarUrl) {
      refs.accountAvatarImg.src = avatarUrl + "?t=" + Date.now();
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

    // Security
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
      });
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success("プロフィールを更新しました。");
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

  async function handleAvatarUpload(file) {
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    refs.avatarFileInput.value = "";

    try {
      const result = await app.api.postForm("/api/auth/avatar", formData);
      const avatarUrl = result?.data?.avatar_url || null;
      if (avatarUrl) {
        const user = getUser();
        user.avatar_url = avatarUrl;
      }
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success("アイコンを更新しました。");
    } catch (error) {
      toast.error(error.message || "アイコンのアップロードに失敗しました。");
    }
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
      if (file) handleAvatarUpload(file);
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