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

let toastWrap = null
let toastBox = null
let toastTimer = null

const state = {
  verifyTicket: "",
  registrationToken: "",
  signupEmail: "",
  challengeToken: "",
  challengeMaskedEmail: ""
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

function getErrorMessage(data, fallback) {
  return String(data?.error?.message || data?.message || data?.detail || fallback)
}

function nextUrl() {
  const u = new URL(location.href)
  const n = u.searchParams.get("next")
  if (n) return n
  return "/gallery/"
}

function setQuery(params) {
  const url = new URL(location.href)
  url.search = ""
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value)
    }
  })
  history.replaceState(null, "", url.toString())
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
}

function setSignupStage(which) {
  signupStageStart.hidden = which !== "start"
  signupStageVerify.hidden = which !== "verify"
  signupStageComplete.hidden = which !== "complete"
}

function resetSignupState() {
  state.verifyTicket = ""
  state.registrationToken = ""
  signupVerifyCode.value = ""
  completeUserKey.value = ""
  completeDisplayName.value = ""
  completePassword.value = ""
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
    showToastOk(String(data?.message || "認証コードを送信しました。"), 1800)
    return
  }

  showToastOk(String(data?.message || "ログインしました。"), 1600)
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
  showToastOk(String(data?.message || "ログインしました。"), 1600)
  setQuery({})
  setTimeout(() => { location.replace(data?.next?.to || nextUrl()) }, 450)
}

async function doLoginTwoFactorResend() {
  if (!state.challengeToken) {
    showToastErr("認証トークンがありません。", 4200)
    return
  }
  const { res, data } = await postJson("/gallery/api/auth/2fa/challenge/send", { challenge_token: state.challengeToken })
  if (!res.ok) {
    showToastErr(getErrorMessage(data, `2fa resend failed (${res.status})`), 5200)
    return
  }
  state.challengeToken = String(data?.data?.challenge_token || state.challengeToken)
  state.challengeMaskedEmail = String(data?.data?.masked_email || state.challengeMaskedEmail)
  loginTwoFactorMessage.textContent = state.challengeMaskedEmail ? `${state.challengeMaskedEmail} に送信した認証コードを入力してください。` : "認証コードを入力してください。"
  setQuery({ step: "verify-2fa", challenge: state.challengeToken })
  showToastOk(String(data?.message || "認証コードを再送しました。"), 1800)
}

async function startRegistration() {
  const email = String(signupEmail.value || "").trim()
  if (!email) {
    showToastErr("メールアドレスを入力してください。", 4200)
    return
  }
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
  showToastOk(String(data?.message || "確認コードを送信しました。"), 1800)
}

async function resendRegistrationCode() {
  if (!state.verifyTicket) {
    showToastErr("verify_ticket がありません。", 4200)
    return
  }
  const { res, data } = await postJson("/gallery/api/auth/verify/email/send", { verify_ticket: state.verifyTicket })
  if (!res.ok) {
    showToastErr(getErrorMessage(data, `verify resend failed (${res.status})`), 5200)
    return
  }
  state.verifyTicket = String(data?.data?.verify_ticket || state.verifyTicket)
  signupVerifyMessage.textContent = data?.data?.masked_email ? `${data.data.masked_email} に届いた認証コードを入力してください。` : "メールに届いた認証コードを入力してください。"
  setQuery({ step: "verify-email", ticket: state.verifyTicket })
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
}

function restoreFromLocation() {
  const url = new URL(location.href)
  const step = url.searchParams.get("step") || ""
  if (step === "verify-email") {
    state.verifyTicket = String(url.searchParams.get("ticket") || "")
    setTab("signup")
    setSignupStage("verify")
    setLoginStage("credentials")
    return
  }
  if (step === "complete-registration") {
    state.registrationToken = String(url.searchParams.get("registration") || "")
    setTab("signup")
    setSignupStage("complete")
    setLoginStage("credentials")
    return
  }
  if (step === "verify-2fa") {
    state.challengeToken = String(url.searchParams.get("challenge") || "")
    setTab("login")
    setLoginStage("twofactor")
    return
  }
  setTab("login")
  setLoginStage("credentials")
  setSignupStage("start")
}

function init() {
  if (tabLogin) tabLogin.addEventListener("click", () => { setTab("login"); setLoginStage("credentials"); setQuery({}) })
  if (tabSignup) tabSignup.addEventListener("click", () => { setTab("signup"); setSignupStage("start"); setQuery({}) })
  if (loginBtn) loginBtn.addEventListener("click", doLogin)
  if (loginTwoFactorVerifyBtn) loginTwoFactorVerifyBtn.addEventListener("click", doLoginTwoFactorVerify)
  if (loginTwoFactorResendBtn) loginTwoFactorResendBtn.addEventListener("click", doLoginTwoFactorResend)
  if (loginBackBtn) loginBackBtn.addEventListener("click", () => { state.challengeToken = ""; loginTwoFactorCode.value = ""; setLoginStage("credentials"); setQuery({}) })
  if (signupStartBtn) signupStartBtn.addEventListener("click", startRegistration)
  if (signupVerifyBtn) signupVerifyBtn.addEventListener("click", confirmRegistrationCode)
  if (signupResendBtn) signupResendBtn.addEventListener("click", resendRegistrationCode)
  if (signupRestartBtn) signupRestartBtn.addEventListener("click", () => { resetSignupState(); setSignupStage("start"); setQuery({}) })
  if (completeRegisterBtn) completeRegisterBtn.addEventListener("click", completeRegistration)

  document.addEventListener("keydown", (e) => {
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
}

init()
