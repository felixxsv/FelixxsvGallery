import { createSettingsStore, languageToLocaleTag, normalizeLanguageCode } from "../core/settings.js";
import { buildLocaleLoadOrder, fetchLocaleCatalogs, resolveLocalizedMessage } from "../core/i18n.js";

const el = (id) => document.getElementById(id);

const settings = createSettingsStore();
const SUPPORTED_LANGUAGES = new Set(["ja", "en-us", "de", "fr", "ru", "es", "zh-cn", "ko"]);

const MESSAGES = {
  ja: {},
  "en-us": {},
};

const FALLBACK_MESSAGES = {
  "en-us": {
    "auth.actions.confirm": "Confirm",
    "auth.actions.cancel": "Cancel",
    "auth.confirm.title": "Confirm",
    "auth.confirm.defaultMessage": "Are you sure you want to continue?",
    "auth.confirm.sendCodeTitle": "Send verification code",
    "auth.confirm.send": "Send",
    "auth.confirm.abort": "Leave",
    "auth.confirm.continue": "Stay",
    "auth.confirm.loginCode": "Send a verification code to this email address?",
    "auth.flow.enterCode": "Enter the verification code.",
    "auth.flow.enterCodeSent": "Enter the verification code sent to {email}.",
    "auth.flow.enterMailCode": "Enter the verification code sent to your email.",
    "auth.flow.enterMailCodeMasked": "Enter the verification code sent to {email}.",
    "auth.flow.completeRegistration": "Enter your account details.",
    "auth.flow.completeRegistrationForEmail": "Enter account details for {email}.",
    "auth.flow.discordRegistration": "Create your account with Discord. You can set a password later.",
    "auth.flow.discordRegistrationWithEmail": "Create your account with Discord ({email}).",
    "auth.flow.leaveCreate": "Leave this page and discard account creation?",
    "auth.flow.leaveVerify": "Leave this page and discard verification?",
    "auth.flow.leave2fa": "Leave this page and discard two-factor verification?",
    "auth.flow.leaveDefault": "Leave this page and discard the current flow?",
    "auth.errors.requiredEmailPassword": "Enter both email and password.",
    "auth.errors.requiredCode": "Enter the verification code.",
    "auth.errors.waitResend": "Please wait before resending.",
    "auth.errors.oauthUrl": "Failed to get the Discord authorization URL.",
    "auth.errors.requiredEmail": "Enter your email address.",
    "auth.errors.requiredProfileDiscord": "Enter user_key and display_name.",
    "auth.errors.requiredProfile": "Enter user_key, display_name, and password.",
    "auth.errors.missingVerifyTicket": "Missing verify_ticket.",
    "auth.errors.missingChallenge": "Missing challenge token.",
    "auth.toast.checkCode": "Check the verification code.",
    "auth.toast.discordLinkedAfterLogin": "Discord account linked.",
    "auth.toast.loggedIn": "Logged in.",
    "auth.toast.codeResent": "Verification code resent.",
    "auth.toast.codeSent": "Verification code sent.",
    "auth.toast.mailVerified": "Email verification completed.",
    "auth.toast.discordRegistered": "Registered with Discord.",
    "auth.toast.accountCreated": "Account created.",
    "auth.toast.linkAfterLogin": "This email is already registered. Log in to link your Discord account automatically.",
    "auth.resend": "Resend",
    "auth.resendCountdown": "Resend ({seconds}s)",
  }
};

async function loadSharedMessages() {
  const catalogs = await fetchLocaleCatalogs("/gallery/assets/i18n", buildLocaleLoadOrder(settings.getLanguage()));
  Object.entries(catalogs).forEach(([locale, messages]) => {
    if (!MESSAGES[locale]) MESSAGES[locale] = {};
    MESSAGES[locale] = { ...MESSAGES[locale], ...(messages || {}) };
  });
}

function normalizeLanguage(value) {
  const lang = normalizeLanguageCode(value);
  return SUPPORTED_LANGUAGES.has(lang) ? lang : "en-us";
}

let currentLanguage = normalizeLanguage(settings.getLanguage());

function t(key, fallbackOrVars = {}, maybeVars = {}) {
  const hasFallback = typeof fallbackOrVars === "string";
  const fallbackText = hasFallback ? fallbackOrVars : "";
  const vars = hasFallback ? maybeVars : fallbackOrVars;
  const fallbackLanguage = currentLanguage === "ja" ? "ja" : "en-us";
  const dict = MESSAGES[currentLanguage] || {};
  const fallbackDict = MESSAGES[fallbackLanguage] || {};
  const fallbackInline = FALLBACK_MESSAGES["en-us"] || {};
  const template = dict[key] || fallbackDict[key] || fallbackInline[key] || fallbackText || key;
  return template.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? ""));
}

function applyTranslations() {
  document.documentElement.lang = languageToLocaleTag(currentLanguage);

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (!key) return;
    const text = t(key, node.textContent || "");
    node.textContent = text;
    if (node.tagName === "TITLE") {
      document.title = text;
    }
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (!key) return;
    node.setAttribute("placeholder", t(key, node.getAttribute("placeholder") || ""));
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    const key = node.dataset.i18nAriaLabel;
    if (!key) return;
    node.setAttribute("aria-label", t(key, node.getAttribute("aria-label") || ""));
  });
}

function setLanguage(value) {
  currentLanguage = normalizeLanguage(value);
  settings.setLanguage(currentLanguage);
  window.dispatchEvent(new CustomEvent("gallery:language-changed", {
    detail: { language: currentLanguage },
  }));
  applyTranslations();
  syncDynamicTexts();
}

const authLangSelect = el("authLangSelect");
const tabLogin = el("tabLogin");
const tabSignup = el("tabSignup");
const paneLogin = el("paneLogin");
const paneSignup = el("paneSignup");

const loginStageCredentials = el("loginStageCredentials");
const loginStageTwoFactor = el("loginStageTwoFactor");
const loginEmail = el("loginEmail");
const loginPass = el("loginPass");
const loginBtn = el("loginBtn");
const loginTwoFactorMessage = el("loginTwoFactorMessage");
const loginTwoFactorCode = el("loginTwoFactorCode");
const loginTwoFactorVerifyBtn = el("loginTwoFactorVerifyBtn");
const loginTwoFactorResendBtn = el("loginTwoFactorResendBtn");
const loginBackBtn = el("loginBackBtn");

const signupStageStart = el("signupStageStart");
const signupStageVerify = el("signupStageVerify");
const signupStageComplete = el("signupStageComplete");
const signupEmail = el("signupEmail");
const signupStartBtn = el("signupStartBtn");
const signupVerifyMessage = el("signupVerifyMessage");
const signupVerifyCode = el("signupVerifyCode");
const signupVerifyBtn = el("signupVerifyBtn");
const signupResendBtn = el("signupResendBtn");
const signupRestartBtn = el("signupRestartBtn");
const signupCompleteMessage = el("signupCompleteMessage");
const completeUserKey = el("completeUserKey");
const completeDisplayName = el("completeDisplayName");
const completePassword = el("completePassword");
const completeRegisterBtn = el("completeRegisterBtn");
const authHeaderBackButton = el("authHeaderBackButton");

const loginDiscordBtn = el("loginDiscordBtn");
const signupDiscordBtn = el("signupDiscordBtn");
const discordAvatarPreview = el("discordAvatarPreview");
const discordAvatarImg = el("discordAvatarImg");
const completePasswordRow = el("completePasswordRow");

const authConfirmLayer = el("authConfirmLayer");
const authConfirmTitle = el("authConfirmTitle");
const authConfirmMessage = el("authConfirmMessage");
const authConfirmApproveBtn = el("authConfirmApproveBtn");
const authConfirmCancelBtn = el("authConfirmCancelBtn");

let toastWrap = null;
let toastBox = null;
let toastTimer = null;
let confirmResolver = null;
let countdownTimer = null;
let leaveGuardPrimed = false;
let allowBrowserLeave = false;
let popstateBypass = false;

const STORAGE_KEY = "felixxsv-gallery-auth-flow";

const state = {
  verifyTicket: "",
  registrationToken: "",
  signupEmail: "",
  challengeToken: "",
  challengeMaskedEmail: "",
  signupResendAvailableAt: 0,
  loginResendAvailableAt: 0,
  isDiscordRegistration: false,
  discordLinkRegistrationToken: "",
};

function ensureToast() {
  if (toastWrap && toastBox) return;
  toastWrap = document.createElement("div");
  toastWrap.className = "uptoastwrap";
  toastBox = document.createElement("div");
  toastBox.className = "uptoast";
  toastWrap.appendChild(toastBox);
  document.body.appendChild(toastWrap);
}

function showToast(text, ms, kind) {
  const s = String(text || "").trim();
  if (!s) return;
  ensureToast();
  toastBox.textContent = s;
  toastBox.classList.remove("is-off", "is-err", "is-ok");
  if (kind === "err") toastBox.classList.add("is-err");
  if (kind === "ok") toastBox.classList.add("is-ok");
  toastBox.classList.add("is-on");
  if (toastTimer) clearTimeout(toastTimer);
  const dur = Number(ms) > 0 ? Number(ms) : 3200;
  toastTimer = setTimeout(() => {
    toastBox.classList.remove("is-on");
    toastBox.classList.add("is-off");
  }, dur);
}

function showToastErr(text, ms) {
  showToast(text, ms || 5200, "err");
}

function showToastOk(text, ms) {
  showToast(text, ms || 2600, "ok");
}

function getErrorMessage(data, fallback) {
  return resolveLocalizedMessage(data?.error?.message || data?.message || data?.detail, fallback, currentLanguage);
}

function nowMs() {
  return Date.now();
}

function setCooldownFromSeconds(kind, seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const until = nowMs() + safe * 1000;
  if (kind === "signup") state.signupResendAvailableAt = until;
  if (kind === "login") state.loginResendAvailableAt = until;
  persistState();
  refreshResendButtons();
}

function getCooldownRemainingSec(kind) {
  const until = kind === "signup" ? state.signupResendAvailableAt : state.loginResendAvailableAt;
  return Math.max(0, Math.ceil((Number(until || 0) - nowMs()) / 1000));
}

function refreshResendButtons() {
  const signupRemain = getCooldownRemainingSec("signup");
  if (signupResendBtn) {
    signupResendBtn.disabled = signupRemain > 0;
    signupResendBtn.textContent = signupRemain > 0 ? t("auth.resendCountdown", { seconds: signupRemain }) : t("auth.resend");
  }

  const loginRemain = getCooldownRemainingSec("login");
  if (loginTwoFactorResendBtn) {
    loginTwoFactorResendBtn.disabled = loginRemain > 0;
    loginTwoFactorResendBtn.textContent = loginRemain > 0 ? t("auth.resendCountdown", { seconds: loginRemain }) : t("auth.resend");
  }
}

function startCountdownTicker() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    refreshResendButtons();
  }, 1000);
}

function persistState() {
  const payload = {
    verifyTicket: state.verifyTicket,
    registrationToken: state.registrationToken,
    signupEmail: state.signupEmail,
    challengeToken: state.challengeToken,
    challengeMaskedEmail: state.challengeMaskedEmail,
    signupResendAvailableAt: state.signupResendAvailableAt,
    loginResendAvailableAt: state.loginResendAvailableAt,
    isDiscordRegistration: state.isDiscordRegistration,
    discordLinkRegistrationToken: state.discordLinkRegistrationToken,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restorePersistedState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.verifyTicket = String(saved?.verifyTicket || "");
    state.registrationToken = String(saved?.registrationToken || "");
    state.signupEmail = String(saved?.signupEmail || "");
    state.challengeToken = String(saved?.challengeToken || "");
    state.challengeMaskedEmail = String(saved?.challengeMaskedEmail || "");
    state.signupResendAvailableAt = Number(saved?.signupResendAvailableAt || 0);
    state.loginResendAvailableAt = Number(saved?.loginResendAvailableAt || 0);
    state.isDiscordRegistration = Boolean(saved?.isDiscordRegistration || false);
    state.discordLinkRegistrationToken = String(saved?.discordLinkRegistrationToken || "");
  } catch {
    return;
  }
}

function clearPersistedState() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    return { res, data };
  });
}

function getJson(url) {
  return fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    return { res, data };
  });
}

function safeRelativePath(path) {
  const raw = String(path || "").trim();
  if (!raw) return "/gallery/";
  if (!raw.startsWith("/")) return "/gallery/";
  if (raw.startsWith("//")) return "/gallery/";
  return raw;
}

function nextUrl() {
  const u = new URL(location.href);
  return safeRelativePath(u.searchParams.get("next"));
}

function setQuery(params) {
  const url = new URL(location.href);
  const next = url.searchParams.get("next");
  url.search = "";
  if (next) {
    url.searchParams.set("next", safeRelativePath(next));
  }
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  history.replaceState(history.state, "", url.toString());
}

function setTab(which) {
  const isLogin = which === "login";
  tabLogin.classList.toggle("is-on", isLogin);
  tabSignup.classList.toggle("is-on", !isLogin);
  paneLogin.classList.toggle("is-on", isLogin);
  paneSignup.classList.toggle("is-on", !isLogin);
}

function setLoginStage(which) {
  loginStageCredentials.hidden = which !== "credentials";
  loginStageTwoFactor.hidden = which !== "twofactor";
  persistState();
  refreshLeaveGuard();
}

function setSignupStage(which) {
  signupStageStart.hidden = which !== "start";
  signupStageVerify.hidden = which !== "verify";
  signupStageComplete.hidden = which !== "complete";
  persistState();
  refreshLeaveGuard();
}

function setDiscordRegistrationMode(enabled) {
  state.isDiscordRegistration = enabled;
  if (discordAvatarPreview) discordAvatarPreview.hidden = !enabled;
  if (completePasswordRow) completePasswordRow.hidden = enabled;
}

function setLoginTwoFactorPrompt(maskedEmail = state.challengeMaskedEmail) {
  loginTwoFactorMessage.textContent = maskedEmail
    ? t("auth.flow.enterCodeSent", { email: maskedEmail })
    : t("auth.flow.enterCode");
}

function setSignupVerifyPrompt(maskedEmail) {
  signupVerifyMessage.textContent = maskedEmail
    ? t("auth.flow.enterMailCodeMasked", { email: maskedEmail })
    : t("auth.flow.enterMailCode");
}

function setSignupCompletePrompt() {
  if (state.isDiscordRegistration) {
    const email = discordAvatarImg?.dataset.providerEmail || "";
    signupCompleteMessage.textContent = email
      ? t("auth.flow.discordRegistrationWithEmail", { email })
      : t("auth.flow.discordRegistration");
    return;
  }

  signupCompleteMessage.textContent = state.signupEmail
    ? t("auth.flow.completeRegistrationForEmail", { email: state.signupEmail })
    : t("auth.flow.completeRegistration");
}

function syncDynamicTexts() {
  setLoginTwoFactorPrompt();

  if (!signupStageVerify.hidden) {
    setSignupVerifyPrompt(signupVerifyMessage.dataset.maskedEmail || "");
  }

  if (!signupStageComplete.hidden) {
    setSignupCompletePrompt();
  }

  refreshResendButtons();
}

function resetSignupState() {
  state.verifyTicket = "";
  state.registrationToken = "";
  state.signupResendAvailableAt = 0;
  state.isDiscordRegistration = false;
  if (signupVerifyCode) signupVerifyCode.value = "";
  if (completeUserKey) completeUserKey.value = "";
  if (completeDisplayName) completeDisplayName.value = "";
  if (completePassword) completePassword.value = "";
  if (discordAvatarPreview) discordAvatarPreview.hidden = true;
  if (discordAvatarImg) {
    discordAvatarImg.src = "";
    delete discordAvatarImg.dataset.providerEmail;
  }
  if (completePasswordRow) completePasswordRow.hidden = false;
  signupVerifyMessage.dataset.maskedEmail = "";
  persistState();
  refreshResendButtons();
}

function resetLoginTwoFactorState() {
  state.challengeToken = "";
  state.challengeMaskedEmail = "";
  state.loginResendAvailableAt = 0;
  loginTwoFactorCode.value = "";
  setLoginTwoFactorPrompt("");
  persistState();
  refreshResendButtons();
}

function isSignupVerificationActive() {
  return paneSignup.classList.contains("is-on") && !signupStageVerify.hidden && !!state.verifyTicket;
}

function isSignupCompleteActive() {
  return paneSignup.classList.contains("is-on") && !signupStageComplete.hidden && !!state.registrationToken;
}

function isLoginTwoFactorActive() {
  return paneLogin.classList.contains("is-on") && !loginStageTwoFactor.hidden && !!state.challengeToken;
}

function hasPendingFlow() {
  return isSignupVerificationActive() || isSignupCompleteActive() || isLoginTwoFactorActive();
}

function describePendingFlow() {
  if (isSignupCompleteActive()) return t("auth.flow.leaveCreate");
  if (isSignupVerificationActive()) return t("auth.flow.leaveVerify");
  if (isLoginTwoFactorActive()) return t("auth.flow.leave2fa");
  return t("auth.flow.leaveDefault");
}

function openConfirmModal(options) {
  if (!authConfirmLayer || !authConfirmTitle || !authConfirmMessage || !authConfirmApproveBtn || !authConfirmCancelBtn) {
    return Promise.resolve(window.confirm(String(options?.message || t("auth.confirm.defaultMessage"))));
  }

  if (confirmResolver) {
    confirmResolver(false);
    confirmResolver = null;
  }

  authConfirmTitle.textContent = String(options?.title || t("auth.confirm.title"));
  authConfirmMessage.textContent = String(options?.message || t("auth.confirm.defaultMessage"));
  authConfirmApproveBtn.textContent = String(options?.approveText || t("auth.actions.confirm"));
  authConfirmCancelBtn.textContent = String(options?.cancelText || t("auth.actions.cancel"));
  authConfirmApproveBtn.classList.remove("btn-danger");
  if (options?.danger) authConfirmApproveBtn.classList.add("btn-danger");
  authConfirmLayer.style.display = "flex";

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirmModal(result) {
  if (authConfirmLayer) authConfirmLayer.style.display = "none";
  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve(Boolean(result));
  }
}

async function confirmSendCode(message) {
  return openConfirmModal({
    title: t("auth.confirm.sendCodeTitle"),
    message,
    approveText: t("auth.confirm.send"),
    cancelText: t("auth.actions.cancel"),
  });
}

async function confirmLeaveFlow(message) {
  return openConfirmModal({
    title: t("auth.confirm.title"),
    message,
    approveText: t("auth.confirm.abort"),
    cancelText: t("auth.confirm.continue"),
    danger: true,
  });
}

async function getVerifyStatus(mode, token) {
  if (!token) return null;
  const key = mode === "2fa" ? "challenge" : "ticket";
  const { res, data } = await getJson(`/gallery/api/auth/verify/status?mode=${encodeURIComponent(mode)}&${key}=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  return data?.data || null;
}

async function hydrateSignupVerifyStatus() {
  if (!state.verifyTicket) return;
  const status = await getVerifyStatus("email", state.verifyTicket);
  if (!status) return;
  signupVerifyMessage.dataset.maskedEmail = String(status.masked_email || "");
  setSignupVerifyPrompt(signupVerifyMessage.dataset.maskedEmail);
  setCooldownFromSeconds("signup", status.resend_cooldown_sec);
}

async function hydrateLoginTwoFactorStatus() {
  if (!state.challengeToken) return;
  const status = await getVerifyStatus("2fa", state.challengeToken);
  if (!status) return;
  state.challengeMaskedEmail = String(status.masked_email || state.challengeMaskedEmail || "");
  setLoginTwoFactorPrompt(state.challengeMaskedEmail);
  setCooldownFromSeconds("login", status.resend_cooldown_sec);
}

function discardSignupVerifyFlow() {
  resetSignupState();
  setSignupStage("start");
  setQuery({});
}

function discardLoginTwoFactorFlow() {
  resetLoginTwoFactorState();
  setLoginStage("credentials");
  setQuery({});
}

async function handleLeaveCurrentFlow(afterDiscard) {
  if (!hasPendingFlow()) {
    afterDiscard();
    return;
  }

  const ok = await confirmLeaveFlow(describePendingFlow());
  if (!ok) return;

  if (isSignupVerificationActive() || isSignupCompleteActive()) {
    discardSignupVerifyFlow();
  }
  if (isLoginTwoFactorActive()) {
    discardLoginTwoFactorFlow();
  }
  afterDiscard();
}

function refreshLeaveGuard() {
  const active = hasPendingFlow();
  if (active && !leaveGuardPrimed) {
    history.pushState({ authLeaveGuard: true }, "", location.href);
    leaveGuardPrimed = true;
  }
  if (!active) {
    leaveGuardPrimed = false;
    allowBrowserLeave = false;
    popstateBypass = false;
  }
}

async function doLogin() {
  const em = String(loginEmail.value || "").trim();
  const pw = String(loginPass.value || "");

  if (!em || !pw) {
    showToastErr(t("auth.errors.requiredEmailPassword"), 4200);
    return;
  }

  const { res, data } = await postJson("/gallery/api/auth/login", { email: em, password: pw, preferred_language: currentLanguage });

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `login failed (${res.status})`), 5200);
    return;
  }

  if (data?.next?.kind === "verify_2fa" || data?.data?.challenge_token) {
    state.challengeToken = String(data?.data?.challenge_token || "");
    state.challengeMaskedEmail = String(data?.data?.masked_email || "");
    loginTwoFactorCode.value = "";
    setLoginTwoFactorPrompt(state.challengeMaskedEmail);
    setTab("login");
    setLoginStage("twofactor");
    setQuery({ step: "verify-2fa", challenge: state.challengeToken });
    setCooldownFromSeconds("login", data?.data?.resend_cooldown_sec);
    showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.checkCode"), currentLanguage), 1800);
    return;
  }

  if (state.discordLinkRegistrationToken) {
    const linkToken = state.discordLinkRegistrationToken;
    clearPersistedState();
    const { res: lRes, data: lData } = await postJson("/gallery/api/auth/discord/link/via-token", { registration_token: linkToken });
    if (!lRes.ok) {
      showToastErr(getErrorMessage(lData, "Discord link failed."), 6000);
      setTimeout(() => { location.replace(data?.next?.to || nextUrl()); }, 1200);
      return;
    }
    showToastOk(t("auth.toast.discordLinkedAfterLogin"), 2400);
    setTimeout(() => { location.replace(data?.next?.to || nextUrl()); }, 900);
    return;
  }

  showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.loggedIn"), currentLanguage), 1600);
  clearPersistedState();
  setTimeout(() => { location.replace(data?.next?.to || nextUrl()); }, 450);
}

async function doLoginTwoFactorVerify() {
  const code = String(loginTwoFactorCode.value || "").trim();
  if (!state.challengeToken || !code) {
    showToastErr(t("auth.errors.requiredCode"), 4200);
    return;
  }

  const { res, data } = await postJson("/gallery/api/auth/2fa/challenge/verify", {
    challenge_token: state.challengeToken,
    code,
    remember_for_30_days: false,
  });

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `2fa verify failed (${res.status})`), 5200);
    return;
  }

  resetLoginTwoFactorState();
  setQuery({});
  clearPersistedState();
  showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.loggedIn"), currentLanguage), 1600);
  setTimeout(() => { location.replace(data?.next?.to || nextUrl()); }, 450);
}

async function doLoginTwoFactorResend() {
  if (!state.challengeToken) {
    showToastErr(t("auth.errors.missingChallenge"), 4200);
    return;
  }
  if (getCooldownRemainingSec("login") > 0) {
    showToastErr(t("auth.errors.waitResend"), 3000);
    return;
  }

  const { res, data } = await postJson("/gallery/api/auth/2fa/challenge/send", { challenge_token: state.challengeToken });

  if (!res.ok) {
    if (res.status === 429) {
      setCooldownFromSeconds("login", data?.error?.retry_after_sec);
    }
    showToastErr(getErrorMessage(data, `2fa resend failed (${res.status})`), 5200);
    return;
  }

  state.challengeToken = String(data?.data?.challenge_token || state.challengeToken);
  state.challengeMaskedEmail = String(data?.data?.masked_email || state.challengeMaskedEmail);
  setLoginTwoFactorPrompt(state.challengeMaskedEmail);
  setQuery({ step: "verify-2fa", challenge: state.challengeToken });
  setCooldownFromSeconds("login", data?.data?.resend_cooldown_sec);
  showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.codeResent"), currentLanguage), 1800);
}

async function startDiscordOAuth() {
  const { res, data } = await postJson("/gallery/api/auth/discord/start", {});

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `Discord OAuth start failed (${res.status})`), 5200);
    return;
  }

  const redirectTo = data?.next?.to;
  if (redirectTo) {
    allowBrowserLeave = true;
    location.replace(redirectTo);
    return;
  }

  showToastErr(t("auth.errors.oauthUrl"), 5200);
}

async function startRegistration() {
  const email = String(signupEmail.value || "").trim();
  if (!email) {
    showToastErr(t("auth.errors.requiredEmail"), 4200);
    return;
  }

  const ok = await confirmSendCode(t("auth.confirm.loginCode"));
  if (!ok) return;

  const { res, data } = await postJson("/gallery/api/auth/register/start", { email, preferred_language: currentLanguage });

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `register start failed (${res.status})`), 5200);
    return;
  }

  state.signupEmail = email;
  state.verifyTicket = String(data?.data?.verify_ticket || "");
  signupVerifyCode.value = "";
  signupVerifyMessage.dataset.maskedEmail = String(data?.data?.masked_email || "");
  setSignupVerifyPrompt(signupVerifyMessage.dataset.maskedEmail);
  setTab("signup");
  setSignupStage("verify");
  setQuery({ step: "verify-email", ticket: state.verifyTicket });
  setCooldownFromSeconds("signup", data?.data?.resend_cooldown_sec);
  showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.codeSent"), currentLanguage), 1800);
}

async function resendRegistrationCode() {
  if (!state.verifyTicket) {
    showToastErr(t("auth.errors.missingVerifyTicket"), 4200);
    return;
  }
  if (getCooldownRemainingSec("signup") > 0) {
    showToastErr(t("auth.errors.waitResend"), 3000);
    return;
  }

  const { res, data } = await postJson("/gallery/api/auth/verify/email/send", { verify_ticket: state.verifyTicket });

  if (!res.ok) {
    if (res.status === 429) {
      setCooldownFromSeconds("signup", data?.error?.retry_after_sec);
    }
    showToastErr(getErrorMessage(data, `verify resend failed (${res.status})`), 5200);
    return;
  }

  state.verifyTicket = String(data?.data?.verify_ticket || state.verifyTicket);
  signupVerifyMessage.dataset.maskedEmail = String(data?.data?.masked_email || "");
  setSignupVerifyPrompt(signupVerifyMessage.dataset.maskedEmail);
  setQuery({ step: "verify-email", ticket: state.verifyTicket });
  setCooldownFromSeconds("signup", data?.data?.resend_cooldown_sec);
  showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.codeResent"), currentLanguage), 1800);
}

async function confirmRegistrationCode() {
  const code = String(signupVerifyCode.value || "").trim();
  if (!state.verifyTicket || !code) {
    showToastErr(t("auth.errors.requiredCode"), 4200);
    return;
  }

  const { res, data } = await postJson("/gallery/api/auth/verify/email/confirm", {
    verify_ticket: state.verifyTicket,
    code,
  });

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `verify failed (${res.status})`), 5200);
    return;
  }

  state.registrationToken = String(data?.data?.registration_token || "");
  if (data?.data?.email) state.signupEmail = String(data.data.email);
  setSignupCompletePrompt();
  setTab("signup");
  setSignupStage("complete");
  setQuery({ step: "complete-registration", registration: state.registrationToken });
  showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.mailVerified"), currentLanguage), 1800);
}

async function completeRegistration() {
  const userKey = String(completeUserKey.value || "").trim();
  const displayName = String(completeDisplayName.value || "").trim();

  if (state.isDiscordRegistration) {
    if (!state.registrationToken || !userKey || !displayName) {
      showToastErr(t("auth.errors.requiredProfileDiscord"), 5200);
      return;
    }

    const { res, data } = await postJson("/gallery/api/auth/register/discord", {
      registration_token: state.registrationToken,
      user_key: userKey,
      display_name: displayName,
      preferred_language: currentLanguage,
    });

    if (!res.ok) {
      showToastErr(getErrorMessage(data, `Discord registration failed (${res.status})`), 5200);
      return;
    }

    showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.discordRegistered"), currentLanguage), 2200);
    resetSignupState();
    setQuery({});
    clearPersistedState();
    const nextTo = data?.next?.to;
    setTimeout(() => { location.replace(nextTo || "/gallery/"); }, 600);
    return;
  }

  const password = String(completePassword.value || "");
  if (!state.registrationToken || !userKey || !displayName || !password) {
    showToastErr(t("auth.errors.requiredProfile"), 5200);
    return;
  }

  const { res, data } = await postJson("/gallery/api/auth/register/complete", {
    registration_token: state.registrationToken,
    user_key: userKey,
    display_name: displayName,
    password,
    terms_agreed: true,
  });

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `register complete failed (${res.status})`), 5200);
    return;
  }

  showToastOk(resolveLocalizedMessage(data?.message, t("auth.toast.accountCreated"), currentLanguage), 2200);
  resetSignupState();
  setTab("login");
  setLoginStage("credentials");
  setSignupStage("start");
  loginEmail.value = state.signupEmail || "";
  loginPass.value = "";
  setQuery({});
  clearPersistedState();
}

async function hydrateDiscordRegistrationPrefill() {
  if (!state.registrationToken) return;
  const { res, data } = await getJson(`/gallery/api/auth/register/discord/status?registration=${encodeURIComponent(state.registrationToken)}`);
  if (!res.ok || !data?.data?.prefill) return;
  const prefill = data.data.prefill;
  if (completeUserKey && prefill.user_key && !completeUserKey.value) {
    completeUserKey.value = prefill.user_key;
  }
  if (completeDisplayName && prefill.display_name && !completeDisplayName.value) {
    completeDisplayName.value = prefill.display_name;
  }
  const profile = data.data.discord_profile;
  if (profile?.provider_avatar_url && discordAvatarImg) {
    discordAvatarImg.src = profile.provider_avatar_url;
    discordAvatarImg.dataset.providerEmail = String(profile.provider_email || "");
    if (discordAvatarPreview) discordAvatarPreview.hidden = false;
  }
  setSignupCompletePrompt();
}

async function restoreFromLocation() {
  restorePersistedState();
  if (state.signupEmail && signupEmail) signupEmail.value = state.signupEmail;

  const url = new URL(location.href);
  const step = String(url.searchParams.get("step") || "");
  if (step === "verify-email") {
    state.verifyTicket = String(url.searchParams.get("ticket") || state.verifyTicket || "");
    setTab("signup");
    setSignupStage("verify");
    setLoginStage("credentials");
    await hydrateSignupVerifyStatus();
    persistState();
    return;
  }
  if (step === "complete-registration") {
    state.registrationToken = String(url.searchParams.get("registration") || state.registrationToken || "");
    const provider = String(url.searchParams.get("provider") || "");
    const conflict = String(url.searchParams.get("conflict") || "");

    if (provider === "discord" && conflict === "email_exists") {
      state.discordLinkRegistrationToken = state.registrationToken;
      state.registrationToken = "";
      try {
        const statusRes = await fetch(`/gallery/api/auth/register/discord/status?registration=${encodeURIComponent(state.discordLinkRegistrationToken)}`);
        const statusData = await statusRes.json();
        const email = statusData?.data?.discord_profile?.provider_email || "";
        if (email && loginEmail) loginEmail.value = email;
      } catch {
        return;
      }
      setTab("login");
      setLoginStage("credentials");
      setSignupStage("start");
      persistState();
      showToast(t("auth.toast.linkAfterLogin"), 8000, "ok");
      return;
    }

    setDiscordRegistrationMode(provider === "discord");
    setTab("signup");
    setSignupStage("complete");
    setLoginStage("credentials");
    if (provider === "discord" && state.registrationToken) {
      await hydrateDiscordRegistrationPrefill();
    } else {
      setSignupCompletePrompt();
    }
    persistState();
    refreshLeaveGuard();
    return;
  }
  if (step === "verify-2fa") {
    state.challengeToken = String(url.searchParams.get("challenge") || state.challengeToken || "");
    setTab("login");
    setLoginStage("twofactor");
    await hydrateLoginTwoFactorStatus();
    persistState();
    return;
  }
  setTab("login");
  setLoginStage("credentials");
  setSignupStage("start");
  persistState();
}

function handleBeforeUnload(event) {
  if (!hasPendingFlow() || allowBrowserLeave) return;
  event.preventDefault();
  event.returnValue = "";
}

function handlePopState() {
  if (popstateBypass) {
    popstateBypass = false;
    return;
  }
  if (!hasPendingFlow()) return;
  history.pushState({ authLeaveGuard: true }, "", location.href);
  confirmLeaveFlow(describePendingFlow()).then((ok) => {
    if (!ok) return;
    allowBrowserLeave = true;
    popstateBypass = true;
    window.history.back();
  });
}

function initConfirmModal() {
  if (authConfirmApproveBtn) authConfirmApproveBtn.addEventListener("click", () => closeConfirmModal(true));
  if (authConfirmCancelBtn) authConfirmCancelBtn.addEventListener("click", () => closeConfirmModal(false));
  if (authConfirmLayer) {
    authConfirmLayer.addEventListener("click", (event) => {
      if (event.target === authConfirmLayer) closeConfirmModal(false);
    });
  }
}

async function init() {
  try {
    await loadSharedMessages();
  } catch {
    // Keep minimal in-module fallbacks for flow prompts when shared catalogs are unavailable.
  }
  currentLanguage = normalizeLanguage(settings.getLanguage());
  if (authLangSelect) {
    authLangSelect.value = currentLanguage;
    authLangSelect.addEventListener("change", () => setLanguage(authLangSelect.value));
  }
  applyTranslations();

  initConfirmModal();
  startCountdownTicker();

  if (tabLogin) {
    tabLogin.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        resetLoginTwoFactorState();
        setTab("login");
        setLoginStage("credentials");
        setQuery({});
      });
    });
  }

  if (tabSignup) {
    tabSignup.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        resetSignupState();
        setTab("signup");
        setSignupStage("start");
        setQuery({});
      });
    });
  }

  if (authHeaderBackButton) {
    authHeaderBackButton.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        allowBrowserLeave = true;
        location.href = "/gallery/";
      });
    });
  }

  if (loginDiscordBtn) loginDiscordBtn.addEventListener("click", startDiscordOAuth);
  if (signupDiscordBtn) signupDiscordBtn.addEventListener("click", startDiscordOAuth);

  if (loginBtn) loginBtn.addEventListener("click", doLogin);
  if (loginTwoFactorVerifyBtn) loginTwoFactorVerifyBtn.addEventListener("click", doLoginTwoFactorVerify);
  if (loginTwoFactorResendBtn) loginTwoFactorResendBtn.addEventListener("click", doLoginTwoFactorResend);
  if (loginBackBtn) {
    loginBackBtn.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        discardLoginTwoFactorFlow();
      });
    });
  }

  if (signupStartBtn) signupStartBtn.addEventListener("click", startRegistration);
  if (signupVerifyBtn) signupVerifyBtn.addEventListener("click", confirmRegistrationCode);
  if (signupResendBtn) signupResendBtn.addEventListener("click", resendRegistrationCode);
  if (signupRestartBtn) {
    signupRestartBtn.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        discardSignupVerifyFlow();
      });
    });
  }
  if (completeRegisterBtn) completeRegisterBtn.addEventListener("click", completeRegistration);

  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("popstate", handlePopState);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirmResolver) {
      closeConfirmModal(false);
      return;
    }
    if (e.key !== "Enter") return;
    if (paneLogin.classList.contains("is-on")) {
      if (!loginStageCredentials.hidden) return void doLogin();
      if (!loginStageTwoFactor.hidden) return void doLoginTwoFactorVerify();
    }
    if (paneSignup.classList.contains("is-on")) {
      if (!signupStageStart.hidden) return void startRegistration();
      if (!signupStageVerify.hidden) return void confirmRegistrationCode();
      if (!signupStageComplete.hidden) return void completeRegistration();
    }
  });

  restoreFromLocation().finally(() => {
    syncDynamicTexts();
    refreshResendButtons();
  });
}

init();
if (typeof window.initAuthHeroSlideshow === "function") window.initAuthHeroSlideshow();
