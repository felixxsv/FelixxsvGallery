
const el = (id) => document.getElementById(id)

const tabLogin = el("tabLogin")
const tabSignup = el("tabSignup")
const paneLogin = el("paneLogin")
const paneSignup = el("paneSignup")

const loginStageCredentials = el("loginStageCredentials")
const loginStageTwoFactor = el("loginStageTwoFactor")
const loginEmail = el("loginEmail")
const loginPass = el("loginPass")
const loginBtn = el("loginBtn")
const loginTwoFactorMessage = el("loginTwoFactorMessage")
const loginTwoFactorCode = el("loginTwoFactorCode")
const loginTwoFactorVerifyBtn = el("loginTwoFactorVerifyBtn")
const loginTwoFactorResendBtn = el("loginTwoFactorResendBtn")
const loginBackBtn = el("loginBackBtn")

const signupStageStart = el("signupStageStart")
const signupStageVerify = el("signupStageVerify")
const signupStageComplete = el("signupStageComplete")
const signupEmail = el("signupEmail")
const signupStartBtn = el("signupStartBtn")
const signupVerifyMessage = el("signupVerifyMessage")
const signupVerifyCode = el("signupVerifyCode")
const signupVerifyBtn = el("signupVerifyBtn")
const signupResendBtn = el("signupResendBtn")
const signupRestartBtn = el("signupRestartBtn")
const signupCompleteMessage = el("signupCompleteMessage")
const completeUserKey = el("completeUserKey")
const completeDisplayName = el("completeDisplayName")
const completePassword = el("completePassword")
const completeRegisterBtn = el("completeRegisterBtn")
const authHeaderBackButton = el("authHeaderBackButton")

const loginDiscordBtn = el("loginDiscordBtn")
const signupDiscordBtn = el("signupDiscordBtn")
const discordAvatarPreview = el("discordAvatarPreview")
const discordAvatarImg = el("discordAvatarImg")
const completePasswordRow = el("completePasswordRow")

const authConfirmLayer = el("authConfirmLayer")
const authConfirmTitle = el("authConfirmTitle")
const authConfirmMessage = el("authConfirmMessage")
const authConfirmApproveBtn = el("authConfirmApproveBtn")
const authConfirmCancelBtn = el("authConfirmCancelBtn")

let toastWrap = null
let toastBox = null
let toastTimer = null
let confirmResolver = null
let countdownTimer = null
let leaveGuardPrimed = false
let allowBrowserLeave = false
let popstateBypass = false

const STORAGE_KEY = "felixxsv-gallery-auth-flow"

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
}

function ensureToast() {
  if (toastWrap && toastBox) return
  toastWrap = document.createElement("div")
  toastWrap.className = "uptoastwrap"
  toastBox = document.createElement("div")
  toastBox.className = "uptoast"
  toastWrap.appendChild(toastBox)
  document.body.appendChild(toastWrap)
}

function showToast(text, ms, kind) {
  const s = String(text || "").trim()
  if (!s) return
  ensureToast()
  toastBox.textContent = s
  toastBox.classList.remove("is-off", "is-err", "is-ok")
  if (kind === "err") toastBox.classList.add("is-err")
  if (kind === "ok") toastBox.classList.add("is-ok")
  toastBox.classList.add("is-on")
  if (toastTimer) clearTimeout(toastTimer)
  const dur = Number(ms) > 0 ? Number(ms) : 3200
  toastTimer = setTimeout(() => {
    toastBox.classList.remove("is-on")
    toastBox.classList.add("is-off")
  }, dur)
}

function showToastErr(text, ms) {
  showToast(text, ms || 5200, "err")
}

function showToastOk(text, ms) {
  showToast(text, ms || 2600, "ok")
}

function getErrorMessage(data, fallback) {
  return String(data?.error?.message || data?.message || data?.detail || fallback)
}

function nowMs() {
  return Date.now()
}

function setCooldownFromSeconds(kind, seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const until = nowMs() + safe * 1000
  if (kind === "signup") state.signupResendAvailableAt = until
  if (kind === "login") state.loginResendAvailableAt = until
  persistState()
  refreshResendButtons()
}

function getCooldownRemainingSec(kind) {
  const until = kind === "signup" ? state.signupResendAvailableAt : state.loginResendAvailableAt
  return Math.max(0, Math.ceil((Number(until || 0) - nowMs()) / 1000))
}

function refreshResendButtons() {
  const signupRemain = getCooldownRemainingSec("signup")
  if (signupResendBtn) {
    signupResendBtn.disabled = signupRemain > 0
    signupResendBtn.textContent = signupRemain > 0 ? `再送 (${signupRemain}秒)` : "再送"
  }

  const loginRemain = getCooldownRemainingSec("login")
  if (loginTwoFactorResendBtn) {
    loginTwoFactorResendBtn.disabled = loginRemain > 0
    loginTwoFactorResendBtn.textContent = loginRemain > 0 ? `再送 (${loginRemain}秒)` : "再送"
  }
}

function startCountdownTicker() {
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    refreshResendButtons()
  }, 1000)
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
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function restorePersistedState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    state.verifyTicket = String(saved?.verifyTicket || "")
    state.registrationToken = String(saved?.registrationToken || "")
    state.signupEmail = String(saved?.signupEmail || "")
    state.challengeToken = String(saved?.challengeToken || "")
    state.challengeMaskedEmail = String(saved?.challengeMaskedEmail || "")
    state.signupResendAvailableAt = Number(saved?.signupResendAvailableAt || 0)
    state.loginResendAvailableAt = Number(saved?.loginResendAvailableAt || 0)
    state.isDiscordRegistration = Boolean(saved?.isDiscordRegistration || false)
    state.discordLinkRegistrationToken = String(saved?.discordLinkRegistrationToken || "")
  } catch (_error) {
  }
}

function clearPersistedState() {
  sessionStorage.removeItem(STORAGE_KEY)
}

function postJson(url, payload) {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    return { res, data }
  })
}

function getJson(url) {
  return fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      "Accept": "application/json"
    }
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    return { res, data }
  })
}

function safeRelativePath(path) {
  const raw = String(path || "").trim()
  if (!raw) return "/gallery/"
  if (!raw.startsWith("/")) return "/gallery/"
  if (raw.startsWith("//")) return "/gallery/"
  return raw
}

function nextUrl() {
  const u = new URL(location.href)
  return safeRelativePath(u.searchParams.get("next"))
}

function setQuery(params) {
  const url = new URL(location.href)
  const next = url.searchParams.get("next")
  url.search = ""
  if (next) {
    url.searchParams.set("next", safeRelativePath(next))
  }
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value)
    }
  })
  history.replaceState(history.state, "", url.toString())
}

function setTab(which) {
  const isLogin = which === "login"
  tabLogin.classList.toggle("is-on", isLogin)
  tabSignup.classList.toggle("is-on", !isLogin)
  paneLogin.classList.toggle("is-on", isLogin)
  paneSignup.classList.toggle("is-on", !isLogin)
}

function setLoginStage(which) {
  loginStageCredentials.hidden = which !== "credentials"
  loginStageTwoFactor.hidden = which !== "twofactor"
  persistState()
  refreshLeaveGuard()
}

function setSignupStage(which) {
  signupStageStart.hidden = which !== "start"
  signupStageVerify.hidden = which !== "verify"
  signupStageComplete.hidden = which !== "complete"
  persistState()
  refreshLeaveGuard()
}

function setDiscordRegistrationMode(enabled) {
  state.isDiscordRegistration = enabled
  if (discordAvatarPreview) discordAvatarPreview.hidden = !enabled
  if (completePasswordRow) completePasswordRow.hidden = enabled
}

function resetSignupState() {
  state.verifyTicket = ""
  state.registrationToken = ""
  state.signupResendAvailableAt = 0
  state.isDiscordRegistration = false
  if (signupVerifyCode) signupVerifyCode.value = ""
  if (completeUserKey) completeUserKey.value = ""
  if (completeDisplayName) completeDisplayName.value = ""
  if (completePassword) completePassword.value = ""
  if (discordAvatarPreview) discordAvatarPreview.hidden = true
  if (discordAvatarImg) discordAvatarImg.src = ""
  if (completePasswordRow) completePasswordRow.hidden = false
  persistState()
  refreshResendButtons()
}

function resetLoginTwoFactorState() {
  state.challengeToken = ""
  state.challengeMaskedEmail = ""
  state.loginResendAvailableAt = 0
  loginTwoFactorCode.value = ""
  loginTwoFactorMessage.textContent = "認証コードを入力してください。"
  persistState()
  refreshResendButtons()
}

function isSignupVerificationActive() {
  return paneSignup.classList.contains("is-on") && !signupStageVerify.hidden && !!state.verifyTicket
}

function isSignupCompleteActive() {
  return paneSignup.classList.contains("is-on") && !signupStageComplete.hidden && !!state.registrationToken
}

function isLoginTwoFactorActive() {
  return paneLogin.classList.contains("is-on") && !loginStageTwoFactor.hidden && !!state.challengeToken
}

function hasPendingFlow() {
  return isSignupVerificationActive() || isSignupCompleteActive() || isLoginTwoFactorActive()
}

function describePendingFlow() {
  if (isSignupCompleteActive()) {
    return "アカウント作成を中断して画面を離れますか？"
  }
  if (isSignupVerificationActive()) {
    return "認証コード入力を中断して画面を離れますか？"
  }
  if (isLoginTwoFactorActive()) {
    return "2段階認証を中断して画面を離れますか？"
  }
  return "この操作を中断して画面を離れますか？"
}

function openConfirmModal(options) {
  if (!authConfirmLayer || !authConfirmTitle || !authConfirmMessage || !authConfirmApproveBtn || !authConfirmCancelBtn) {
    return Promise.resolve(window.confirm(String(options?.message || "本当に実行しますか？")))
  }

  if (confirmResolver) {
    confirmResolver(false)
    confirmResolver = null
  }

  authConfirmTitle.textContent = String(options?.title || "確認")
  authConfirmMessage.textContent = String(options?.message || "本当に実行しますか？")
  authConfirmApproveBtn.textContent = String(options?.approveText || "実行する")
  authConfirmCancelBtn.textContent = String(options?.cancelText || "キャンセル")
  authConfirmApproveBtn.classList.remove("btn-danger")
  if (options?.danger) authConfirmApproveBtn.classList.add("btn-danger")
  authConfirmLayer.style.display = "flex"

  return new Promise((resolve) => {
    confirmResolver = resolve
  })
}

function closeConfirmModal(result) {
  if (authConfirmLayer) authConfirmLayer.style.display = "none"
  if (confirmResolver) {
    const resolve = confirmResolver
    confirmResolver = null
    resolve(Boolean(result))
  }
}

async function confirmSendCode(message) {
  return openConfirmModal({
    title: "認証コード送信の確認",
    message,
    approveText: "送信する",
    cancelText: "キャンセル"
  })
}

async function confirmLeaveFlow(message) {
  return openConfirmModal({
    title: "確認",
    message,
    approveText: "中断する",
    cancelText: "続ける",
    danger: true
  })
}

async function getVerifyStatus(mode, token) {
  if (!token) return null
  const key = mode === "2fa" ? "challenge" : "ticket"
  const { res, data } = await getJson(`/gallery/api/auth/verify/status?mode=${encodeURIComponent(mode)}&${key}=${encodeURIComponent(token)}`)
  if (!res.ok) return null
  return data?.data || null
}

async function hydrateSignupVerifyStatus() {
  if (!state.verifyTicket) return
  const status = await getVerifyStatus("email", state.verifyTicket)
  if (!status) return
  signupVerifyMessage.textContent = status.masked_email ? `${status.masked_email} に届いた認証コードを入力してください。` : "メールに届いた認証コードを入力してください。"
  setCooldownFromSeconds("signup", status.resend_cooldown_sec)
}

async function hydrateLoginTwoFactorStatus() {
  if (!state.challengeToken) return
  const status = await getVerifyStatus("2fa", state.challengeToken)
  if (!status) return
  state.challengeMaskedEmail = String(status.masked_email || state.challengeMaskedEmail || "")
  loginTwoFactorMessage.textContent = state.challengeMaskedEmail ? `${state.challengeMaskedEmail} に送信した認証コードを入力してください。` : "認証コードを入力してください。"
  setCooldownFromSeconds("login", status.resend_cooldown_sec)
}

function discardSignupVerifyFlow() {
  resetSignupState()
  setSignupStage("start")
  setQuery({})
}

function discardLoginTwoFactorFlow() {
  resetLoginTwoFactorState()
  setLoginStage("credentials")
  setQuery({})
}

async function handleLeaveCurrentFlow(afterDiscard) {
  if (!hasPendingFlow()) {
    afterDiscard()
    return
  }

  const ok = await confirmLeaveFlow(describePendingFlow())
  if (!ok) return

  if (isSignupVerificationActive() || isSignupCompleteActive()) {
    discardSignupVerifyFlow()
  }
  if (isLoginTwoFactorActive()) {
    discardLoginTwoFactorFlow()
  }
  afterDiscard()
}

function refreshLeaveGuard() {
  const active = hasPendingFlow()
  if (active && !leaveGuardPrimed) {
    history.pushState({ authLeaveGuard: true }, "", location.href)
    leaveGuardPrimed = true
  }
  if (!active) {
    leaveGuardPrimed = false
    allowBrowserLeave = false
    popstateBypass = false
  }
}

async function doLogin() {
  const em = String(loginEmail.value || "").trim()
  const pw = String(loginPass.value || "")

  if (!em || !pw) {
    showToastErr("email/password を入力してください。", 4200)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/login", { email: em, password: pw })

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `login failed (${res.status})`), 5200)
    return
  }

  if (data?.next?.kind === "verify_2fa" || data?.data?.challenge_token) {
    state.challengeToken = String(data?.data?.challenge_token || "")
    state.challengeMaskedEmail = String(data?.data?.masked_email || "")
    loginTwoFactorCode.value = ""
    loginTwoFactorMessage.textContent = state.challengeMaskedEmail ? `${state.challengeMaskedEmail} に送信した認証コードを入力してください。` : "認証コードを入力してください。"
    setTab("login")
    setLoginStage("twofactor")
    setQuery({ step: "verify-2fa", challenge: state.challengeToken })
    setCooldownFromSeconds("login", data?.data?.resend_cooldown_sec)
    showToastOk(String(data?.message || "認証コードを確認してください。"), 1800)
    return
  }

  // Discord email-conflict: auto-link after login
  if (state.discordLinkRegistrationToken) {
    const linkToken = state.discordLinkRegistrationToken
    clearPersistedState()
    const { res: lRes, data: lData } = await postJson("/gallery/api/auth/discord/link/via-token", { registration_token: linkToken })
    if (!lRes.ok) {
      showToastErr(getErrorMessage(lData, "Discord連携に失敗しました。"), 6000)
      setTimeout(() => { location.replace(data?.next?.to || nextUrl()) }, 1200)
      return
    }
    showToastOk("Discordアカウントを連携しました。", 2400)
    setTimeout(() => { location.replace(data?.next?.to || nextUrl()) }, 900)
    return
  }

  showToastOk(String(data?.message || "ログインしました。"), 1600)
  clearPersistedState()
  setTimeout(() => { location.replace(data?.next?.to || nextUrl()) }, 450)
}

async function doLoginTwoFactorVerify() {
  const code = String(loginTwoFactorCode.value || "").trim()
  if (!state.challengeToken || !code) {
    showToastErr("認証コードを入力してください。", 4200)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/2fa/challenge/verify", {
    challenge_token: state.challengeToken,
    code,
    remember_for_30_days: false
  })

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `2fa verify failed (${res.status})`), 5200)
    return
  }

  resetLoginTwoFactorState()
  setQuery({})
  clearPersistedState()
  showToastOk(String(data?.message || "ログインしました。"), 1600)
  setTimeout(() => { location.replace(data?.next?.to || nextUrl()) }, 450)
}

async function doLoginTwoFactorResend() {
  if (!state.challengeToken) {
    showToastErr("認証トークンがありません。", 4200)
    return
  }
  if (getCooldownRemainingSec("login") > 0) {
    showToastErr("しばらく待ってから再送してください。", 3000)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/2fa/challenge/send", { challenge_token: state.challengeToken })

  if (!res.ok) {
    if (res.status === 429) {
      setCooldownFromSeconds("login", data?.error?.retry_after_sec)
    }
    showToastErr(getErrorMessage(data, `2fa resend failed (${res.status})`), 5200)
    return
  }

  state.challengeToken = String(data?.data?.challenge_token || state.challengeToken)
  state.challengeMaskedEmail = String(data?.data?.masked_email || state.challengeMaskedEmail)
  loginTwoFactorMessage.textContent = state.challengeMaskedEmail ? `${state.challengeMaskedEmail} に送信した認証コードを入力してください。` : "認証コードを入力してください。"
  setQuery({ step: "verify-2fa", challenge: state.challengeToken })
  setCooldownFromSeconds("login", data?.data?.resend_cooldown_sec)
  showToastOk(String(data?.message || "認証コードを再送しました。"), 1800)
}

async function startDiscordOAuth() {
  const { res, data } = await postJson("/gallery/api/auth/discord/start", {})

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `Discord OAuth 開始に失敗しました (${res.status})`), 5200)
    return
  }

  const redirectTo = data?.next?.to
  if (redirectTo) {
    allowBrowserLeave = true
    location.replace(redirectTo)
    return
  }

  showToastErr("Discord認証URLの取得に失敗しました。", 5200)
}

async function startRegistration() {
  const email = String(signupEmail.value || "").trim()
  if (!email) {
    showToastErr("メールアドレスを入力してください。", 4200)
    return
  }

  const ok = await confirmSendCode("入力したメールアドレス宛に認証コードを送信します。よろしいですか？")
  if (!ok) return

  const { res, data } = await postJson("/gallery/api/auth/register/start", { email })

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `register start failed (${res.status})`), 5200)
    return
  }

  state.signupEmail = email
  state.verifyTicket = String(data?.data?.verify_ticket || "")
  signupVerifyCode.value = ""
  signupVerifyMessage.textContent = data?.data?.masked_email ? `${data.data.masked_email} に届いた認証コードを入力してください。` : "メールに届いた認証コードを入力してください。"
  setTab("signup")
  setSignupStage("verify")
  setQuery({ step: "verify-email", ticket: state.verifyTicket })
  setCooldownFromSeconds("signup", data?.data?.resend_cooldown_sec)
  showToastOk(String(data?.message || "確認コードを送信しました。"), 1800)
}

async function resendRegistrationCode() {
  if (!state.verifyTicket) {
    showToastErr("verify_ticket がありません。", 4200)
    return
  }
  if (getCooldownRemainingSec("signup") > 0) {
    showToastErr("しばらく待ってから再送してください。", 3000)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/verify/email/send", { verify_ticket: state.verifyTicket })

  if (!res.ok) {
    if (res.status === 429) {
      setCooldownFromSeconds("signup", data?.error?.retry_after_sec)
    }
    showToastErr(getErrorMessage(data, `verify resend failed (${res.status})`), 5200)
    return
  }

  state.verifyTicket = String(data?.data?.verify_ticket || state.verifyTicket)
  signupVerifyMessage.textContent = data?.data?.masked_email ? `${data.data.masked_email} に届いた認証コードを入力してください。` : "メールに届いた認証コードを入力してください。"
  setQuery({ step: "verify-email", ticket: state.verifyTicket })
  setCooldownFromSeconds("signup", data?.data?.resend_cooldown_sec)
  showToastOk(String(data?.message || "確認コードを再送しました。"), 1800)
}

async function confirmRegistrationCode() {
  const code = String(signupVerifyCode.value || "").trim()
  if (!state.verifyTicket || !code) {
    showToastErr("認証コードを入力してください。", 4200)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/verify/email/confirm", {
    verify_ticket: state.verifyTicket,
    code
  })

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `verify failed (${res.status})`), 5200)
    return
  }

  state.registrationToken = String(data?.data?.registration_token || "")
  if (data?.data?.email) state.signupEmail = String(data.data.email)
  signupCompleteMessage.textContent = state.signupEmail ? `${state.signupEmail} のアカウント情報を入力してください。` : "アカウント情報を入力してください。"
  setTab("signup")
  setSignupStage("complete")
  setQuery({ step: "complete-registration", registration: state.registrationToken })
  showToastOk(String(data?.message || "メール認証が完了しました。"), 1800)
}

async function completeRegistration() {
  const userKey = String(completeUserKey.value || "").trim()
  const displayName = String(completeDisplayName.value || "").trim()

  if (state.isDiscordRegistration) {
    if (!state.registrationToken || !userKey || !displayName) {
      showToastErr("user_key / display_name を入力してください。", 5200)
      return
    }

    const { res, data } = await postJson("/gallery/api/auth/register/discord", {
      registration_token: state.registrationToken,
      user_key: userKey,
      display_name: displayName,
    })

    if (!res.ok) {
      showToastErr(getErrorMessage(data, `Discord登録に失敗しました (${res.status})`), 5200)
      return
    }

    showToastOk(String(data?.message || "Discordアカウントで登録しました。"), 2200)
    resetSignupState()
    setQuery({})
    clearPersistedState()
    const nextTo = data?.next?.to
    setTimeout(() => { location.replace(nextTo || "/gallery/") }, 600)
    return
  }

  const password = String(completePassword.value || "")
  if (!state.registrationToken || !userKey || !displayName || !password) {
    showToastErr("user_key / display_name / password を入力してください。", 5200)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/register/complete", {
    registration_token: state.registrationToken,
    user_key: userKey,
    display_name: displayName,
    password,
    terms_agreed: true
  })

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `register complete failed (${res.status})`), 5200)
    return
  }

  showToastOk(String(data?.message || "アカウントを作成しました。"), 2200)
  resetSignupState()
  setTab("login")
  setLoginStage("credentials")
  setSignupStage("start")
  loginEmail.value = state.signupEmail || ""
  loginPass.value = ""
  setQuery({})
  clearPersistedState()
}

async function hydrateDiscordRegistrationPrefill() {
  if (!state.registrationToken) return
  const { res, data } = await getJson(
    `/gallery/api/auth/register/discord/status?registration=${encodeURIComponent(state.registrationToken)}`
  )
  if (!res.ok || !data?.data?.prefill) return
  const prefill = data.data.prefill
  if (completeUserKey && prefill.user_key && !completeUserKey.value) {
    completeUserKey.value = prefill.user_key
  }
  if (completeDisplayName && prefill.display_name && !completeDisplayName.value) {
    completeDisplayName.value = prefill.display_name
  }
  const profile = data.data.discord_profile
  if (profile?.provider_avatar_url && discordAvatarImg) {
    discordAvatarImg.src = profile.provider_avatar_url
    if (discordAvatarPreview) discordAvatarPreview.hidden = false
  }
  if (profile?.provider_email) {
    if (signupCompleteMessage) signupCompleteMessage.textContent = `Discordアカウント (${profile.provider_email}) でアカウントを作成します。`
  } else {
    if (signupCompleteMessage) signupCompleteMessage.textContent = "Discordアカウントでアカウントを作成します。パスワードを設定してください。"
  }
}

async function restoreFromLocation() {
  restorePersistedState()
  if (state.signupEmail && signupEmail) signupEmail.value = state.signupEmail

  const url = new URL(location.href)
  const step = String(url.searchParams.get("step") || "")
  if (step === "verify-email") {
    state.verifyTicket = String(url.searchParams.get("ticket") || state.verifyTicket || "")
    setTab("signup")
    setSignupStage("verify")
    setLoginStage("credentials")
    await hydrateSignupVerifyStatus()
    persistState()
    return
  }
  if (step === "complete-registration") {
    state.registrationToken = String(url.searchParams.get("registration") || state.registrationToken || "")
    const provider = String(url.searchParams.get("provider") || "")
    const conflict = String(url.searchParams.get("conflict") || "")

    if (provider === "discord" && conflict === "email_exists") {
      // Email already exists: ask user to login to link Discord
      state.discordLinkRegistrationToken = state.registrationToken
      state.registrationToken = ""
      // Pre-fill email from Discord profile if available
      try {
        const statusRes = await fetch(`/gallery/api/auth/register/discord/status?registration=${encodeURIComponent(state.discordLinkRegistrationToken)}`)
        const statusData = await statusRes.json()
        const email = statusData?.data?.discord_profile?.provider_email || ""
        if (email && loginEmail) loginEmail.value = email
      } catch (_) {}
      setTab("login")
      setLoginStage("credentials")
      setSignupStage("start")
      persistState()
      showToast("このメールアドレスはすでに登録されています。ログインするとDiscordが自動的に連携されます。", 8000, "ok")
      return
    }

    setDiscordRegistrationMode(provider === "discord")
    setTab("signup")
    setSignupStage("complete")
    setLoginStage("credentials")
    if (provider === "discord" && state.registrationToken) {
      await hydrateDiscordRegistrationPrefill()
    }
    persistState()
    refreshLeaveGuard()
    return
  }
  if (step === "verify-2fa") {
    state.challengeToken = String(url.searchParams.get("challenge") || state.challengeToken || "")
    setTab("login")
    setLoginStage("twofactor")
    await hydrateLoginTwoFactorStatus()
    persistState()
    return
  }
  setTab("login")
  setLoginStage("credentials")
  setSignupStage("start")
  persistState()
}

function handleBeforeUnload(event) {
  if (!hasPendingFlow() || allowBrowserLeave) return
  event.preventDefault()
  event.returnValue = ""
}

function handlePopState() {
  if (popstateBypass) {
    popstateBypass = false
    return
  }
  if (!hasPendingFlow()) return
  history.pushState({ authLeaveGuard: true }, "", location.href)
  confirmLeaveFlow(describePendingFlow()).then((ok) => {
    if (!ok) return
    allowBrowserLeave = true
    popstateBypass = true
    window.history.back()
  })
}

function initConfirmModal() {
  if (authConfirmApproveBtn) authConfirmApproveBtn.addEventListener("click", () => closeConfirmModal(true))
  if (authConfirmCancelBtn) authConfirmCancelBtn.addEventListener("click", () => closeConfirmModal(false))
  if (authConfirmLayer) {
    authConfirmLayer.addEventListener("click", (event) => {
      if (event.target === authConfirmLayer) closeConfirmModal(false)
    })
  }
}

function init() {
  initConfirmModal()
  startCountdownTicker()

  if (tabLogin) {
    tabLogin.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        resetLoginTwoFactorState()
        setTab("login")
        setLoginStage("credentials")
        setQuery({})
      })
    })
  }

  if (tabSignup) {
    tabSignup.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        resetSignupState()
        setTab("signup")
        setSignupStage("start")
        setQuery({})
      })
    })
  }

  if (authHeaderBackButton) {
    authHeaderBackButton.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        allowBrowserLeave = true
        location.href = "/gallery/"
      })
    })
  }

  if (loginDiscordBtn) loginDiscordBtn.addEventListener("click", startDiscordOAuth)
  if (signupDiscordBtn) signupDiscordBtn.addEventListener("click", startDiscordOAuth)

  if (loginBtn) loginBtn.addEventListener("click", doLogin)
  if (loginTwoFactorVerifyBtn) loginTwoFactorVerifyBtn.addEventListener("click", doLoginTwoFactorVerify)
  if (loginTwoFactorResendBtn) loginTwoFactorResendBtn.addEventListener("click", doLoginTwoFactorResend)
  if (loginBackBtn) {
    loginBackBtn.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        discardLoginTwoFactorFlow()
      })
    })
  }

  if (signupStartBtn) signupStartBtn.addEventListener("click", startRegistration)
  if (signupVerifyBtn) signupVerifyBtn.addEventListener("click", confirmRegistrationCode)
  if (signupResendBtn) signupResendBtn.addEventListener("click", resendRegistrationCode)
  if (signupRestartBtn) {
    signupRestartBtn.addEventListener("click", () => {
      handleLeaveCurrentFlow(() => {
        discardSignupVerifyFlow()
      })
    })
  }
  if (completeRegisterBtn) completeRegisterBtn.addEventListener("click", completeRegistration)

  window.addEventListener("beforeunload", handleBeforeUnload)
  window.addEventListener("popstate", handlePopState)

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && confirmResolver) {
      closeConfirmModal(false)
      return
    }
    if (e.key !== "Enter") return
    if (paneLogin.classList.contains("is-on")) {
      if (!loginStageCredentials.hidden) return void doLogin()
      if (!loginStageTwoFactor.hidden) return void doLoginTwoFactorVerify()
    }
    if (paneSignup.classList.contains("is-on")) {
      if (!signupStageStart.hidden) return void startRegistration()
      if (!signupStageVerify.hidden) return void confirmRegistrationCode()
      if (!signupStageComplete.hidden) return void completeRegistration()
    }
  })

  restoreFromLocation()
  refreshResendButtons()
}

async function initHeroSlideshow() {
  const container = document.getElementById("authHeroSlides")
  if (!container) return
  const appBase = document.body.dataset.appBase || "/gallery"

  function resolveUrl(path) {
    if (!path) return ""
    if (path.startsWith("http://") || path.startsWith("https://")) return path
    if (path.startsWith("/gallery/")) return path
    if (path.startsWith("/")) return `${appBase}${path}`
    return `${appBase}/storage/${path}`
  }

  let items = []
  try {
    const res = await fetch(`${appBase}/api/images?per_page=24&sort=latest`)
    if (!res.ok) return
    const data = await res.json()
    items = (data.items || []).filter(img => img.preview_path || img.thumb_path_960 || img.thumb_path_480)
  } catch (_) { return }
  if (!items.length) return

  // Shuffle so each page visit shows different order
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]]
  }

  items.forEach((img, i) => {
    const src = resolveUrl(img.preview_path || img.thumb_path_960 || img.thumb_path_480)
    if (!src) return

    const slide = document.createElement("div")
    slide.className = "auth-hero__slide" + (i === 0 ? " is-active" : "")

    const imgEl = document.createElement("img")
    imgEl.src = src
    imgEl.alt = ""
    imgEl.draggable = false
    imgEl.style.objectPosition = `${img.focal_x ?? 50}% ${img.focal_y ?? 50}%`

    slide.appendChild(imgEl)
    container.appendChild(slide)
  })

  let current = 0
  setInterval(() => {
    const slides = container.querySelectorAll(".auth-hero__slide")
    if (slides.length < 2) return
    slides[current].classList.remove("is-active")
    current = (current + 1) % slides.length
    slides[current].classList.add("is-active")
  }, 6000)
}

init()
initHeroSlideshow()
