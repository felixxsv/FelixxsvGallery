import { byId } from "../core/dom.js";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("ja-JP");
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
    accountOpenButton: byId("shellAccountOpenButton"),
    adminLink: byId("shellAdminLink"),
    userFooter: byId("shellUserFooter"),
    logoutButton: byId("shellLogoutButton"),
    logoutAllButton: byId("shellLogoutAllButton"),

    settingLanguage: byId("shellSettingLanguage"),
    settingTheme: byId("shellSettingTheme"),

    creditAuthor: byId("shellCreditAuthor"),
    creditStack: byId("shellCreditStack"),
    creditLicense: byId("shellCreditLicense"),
    creditUpdatedAt: byId("shellCreditUpdatedAt"),
    creditVersion: byId("shellCreditVersion"),

    accountDisplayName: byId("shellAccountDisplayName"),
    accountUserKey: byId("shellAccountUserKey"),
    accountEmail: byId("shellAccountEmail"),
    accountCreatedAt: byId("shellAccountCreatedAt"),
    accountTwoFactor: byId("shellAccountTwoFactor"),
    emailActionButton: byId("shellEmailActionButton"),
    twoFactorEnableButton: byId("shellTwoFactorEnableButton"),
    twoFactorDisableOpenButton: byId("shellTwoFactorDisableOpenButton"),

    emailTitle: byId("emailTitle"),
    emailInput: byId("shellEmailInput"),
    emailSaveButton: byId("shellEmailSaveButton"),

    currentPasswordInput: byId("shellCurrentPasswordInput"),
    newPasswordInput: byId("shellNewPasswordInput"),
    passwordSaveButton: byId("shellPasswordSaveButton"),

    twoFactorSetupMessage: byId("shellTwoFactorSetupMessage"),
    twoFactorCodeInput: byId("shellTwoFactorCodeInput"),
    twoFactorSetupConfirmButton: byId("shellTwoFactorSetupConfirmButton"),

    twoFactorDisablePasswordInput: byId("shellTwoFactorDisablePasswordInput"),
    twoFactorDisableConfirmButton: byId("shellTwoFactorDisableConfirmButton")
  };

  const shellState = {
    twoFactorSetupTicket: null
  };

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

    refs.uploadDisabled.hidden = user.upload_enabled !== false;
    refs.accountOpenButton.hidden = false;
    refs.adminLink.hidden = !features.can_open_admin;
    refs.userFooter.hidden = false;
  }

  function renderAccountModal() {
    if (!isAuthenticated()) {
      return;
    }

    const user = getUser();
    const twoFactor = getTwoFactor();
    const email = user.primary_email || "";

    refs.accountDisplayName.textContent = user.display_name || "-";
    refs.accountUserKey.textContent = user.user_key || "-";
    refs.accountEmail.textContent = email || "未登録";
    refs.accountCreatedAt.textContent = formatDate(user.created_at);
    refs.accountTwoFactor.textContent = twoFactor.is_enabled ? "有効" : "無効";
    refs.emailActionButton.textContent = email ? "メールアドレス変更" : "メールアドレス登録";
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

  async function handleTwoFactorEnable() {
    if (!isAuthenticated()) {
      toast.error("ログインが必要です。");
      return;
    }

    if (!currentEmail()) {
      toast.error("メールアドレスを入力してください。");
      return;
    }

    try {
      const payload = await app.api.post("/api/auth/2fa/setup/start");
      shellState.twoFactorSetupTicket = payload.data.verify_ticket;
      refs.twoFactorSetupMessage.textContent = `${payload.data.masked_email} に確認コードを送信しました。`;
      refs.twoFactorCodeInput.value = "";
      app.modal.open("twofactor-setup");
    } catch (error) {
      toast.error(error.message || "2段階認証の開始に失敗しました。");
    }
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
      app.modal.close("twofactor-setup");
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success("2段階認証を有効化しました。");
    } catch (error) {
      toast.error(error.message || "2段階認証の有効化に失敗しました。");
    }
  }

  async function handleTwoFactorDisable() {
    try {
      await app.api.post("/api/auth/2fa/disable", {
        password: refs.twoFactorDisablePasswordInput.value
      });
      app.modal.close("twofactor-disable");
      await refreshSession();
      renderAccountModal();
      renderUserCard();
      toast.success("2段階認証を無効化しました。");
    } catch (error) {
      toast.error(error.message || "2段階認証の無効化に失敗しました。");
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
    refs.twoFactorEnableButton.addEventListener("click", handleTwoFactorEnable);
    refs.twoFactorSetupConfirmButton.addEventListener("click", handleTwoFactorSetupConfirm);
    refs.twoFactorDisableConfirmButton.addEventListener("click", handleTwoFactorDisable);
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

    session.subscribe(() => {
      renderUserCard();
    });
  }

  renderCredits();
  renderSettings();
  renderUserCard();
  bindEvents();
}