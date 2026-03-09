const el = (id) => document.getElementById(id)

const tabLogin = el("tabLogin")
const tabRegister = el("tabRegister")
const panelLogin = el("panelLogin")
const panelRegister = el("panelRegister")

const loginForm = el("loginForm")
const loginEmail = el("loginEmail")
const loginPassword = el("loginPassword")
const loginBtn = el("loginBtn")
const loginDiscordBtn = el("loginDiscordBtn")

const registerForm = el("registerForm")
const regEmail = el("regEmail")
const regPassword = el("regPassword")
const regUserKey = el("regUserKey")
const regDisplayName = el("regDisplayName")
const regBtn = el("regBtn")
const regDiscordBtn = el("regDiscordBtn")

const authHint = el("authHint")

const authMeBox = el("authMeBox")
const meName = el("meName")
const meEmail = el("meEmail")
const meRole = el("meRole")
const logoutBtn = el("logoutBtn")
const goNextBtn = el("goNextBtn")

let toastWrap = null
let toastBox = null
let toastTimer = null

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

function setTab(which) {
  const isLogin = which === "login"
  tabLogin.classList.toggle("is-on", isLogin)
  tabRegister.classList.toggle("is-on", !isLogin)
  tabLogin.setAttribute("aria-selected", isLogin ? "true" : "false")
  tabRegister.setAttribute("aria-selected", !isLogin ? "true" : "false")
  panelLogin.classList.toggle("is-on", isLogin)
  panelRegister.classList.toggle("is-on", !isLogin)
}

function nextUrl() {
  const p = new URLSearchParams(location.search)
  const next = p.get("next")
  if (!next) return "/gallery/"
  return next
}

function setLoading(btn, on) {
  if (!btn) return
  btn.disabled = !!on
}

async function fetchJson(url, opt) {
  const res = await fetch(url, Object.assign({ credentials: "same-origin" }, opt || {}))
  const ct = (res.headers.get("content-type") || "").toLowerCase()
  let data = null
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => null)
  } else {
    data = await res.text().catch(() => "")
  }
  return { res, data }
}

async function refreshMe() {
  const { res, data } = await fetchJson("/gallery/api/auth/me", { method: "GET", cache: "no-store" })
  if (res.status === 200 && data && data.user) {
    const u = data.user
    meName.textContent = String(u.display_name || u.user_key || "")
    meEmail.textContent = String(u.email || "")
    meRole.textContent = String(u.role || "")
    authMeBox.classList.add("is-on")
    authMeBox.setAttribute("aria-hidden", "false")
    panelLogin.classList.remove("is-on")
    panelRegister.classList.remove("is-on")
    tabLogin.classList.remove("is-on")
    tabRegister.classList.remove("is-on")
    if (authHint) authHint.textContent = ""
    return true
  }
  authMeBox.classList.remove("is-on")
  authMeBox.setAttribute("aria-hidden", "true")
  setTab("login")
  if (authHint) authHint.textContent = ""
  return false
}

async function doLogin(email, password) {
  const fd = new FormData()
  fd.append("email", String(email || ""))
  fd.append("password", String(password || ""))
  const { res, data } = await fetchJson("/gallery/api/auth/login", { method: "POST", body: fd })
  if (!res.ok) {
    const msg = data && data.detail ? String(data.detail) : `login failed status=${res.status}`
    throw new Error(msg)
  }
  return data
}

async function doRegister(email, password, user_key, display_name) {
  const fd = new FormData()
  fd.append("email", String(email || ""))
  fd.append("password", String(password || ""))
  fd.append("user_key", String(user_key || ""))
  fd.append("display_name", String(display_name || ""))
  const { res, data } = await fetchJson("/gallery/api/auth/register", { method: "POST", body: fd })
  if (!res.ok) {
    const msg = data && data.detail ? String(data.detail) : `register failed status=${res.status}`
    throw new Error(msg)
  }
  return data
}

async function doLogout() {
  const { res, data } = await fetchJson("/gallery/api/auth/logout", { method: "POST" })
  if (!res.ok) {
    const msg = data && data.detail ? String(data.detail) : `logout failed status=${res.status}`
    throw new Error(msg)
  }
  return true
}

function initTabs() {
  tabLogin.addEventListener("click", () => setTab("login"))
  tabRegister.addEventListener("click", () => setTab("register"))
}

function initForms() {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const em = String(loginEmail.value || "").trim()
    const pw = String(loginPassword.value || "")
    if (!em || !pw) {
      showToastErr("Email/Passwordを入力してください。", 4200)
      return
    }
    setLoading(loginBtn, true)
    try {
      await doLogin(em, pw)
      showToastOk("ログインしました。", 1600)
      setTimeout(() => { location.replace(nextUrl()) }, 450)
    } catch (err) {
      showToastErr(String(err), 5200)
    } finally {
      setLoading(loginBtn, false)
    }
  })

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const em = String(regEmail.value || "").trim()
    const pw = String(regPassword.value || "")
    const uk = String(regUserKey.value || "").trim()
    const dn = String(regDisplayName.value || "").trim()
    if (!em || !pw || !uk) {
      showToastErr("必須項目を入力してください。", 4200)
      return
    }
    setLoading(regBtn, true)
    try {
      await doRegister(em, pw, uk, dn)
      await doLogin(em, pw)
      showToastOk("アカウントを作成し、ログインしました。", 1800)
      setTimeout(() => { location.replace(nextUrl()) }, 550)
    } catch (err) {
      showToastErr(String(err), 6200)
    } finally {
      setLoading(regBtn, false)
    }
  })

  loginDiscordBtn.addEventListener("click", (e) => {
    e.preventDefault()
    showToastErr("Discordログインは未実装です。", 4200)
  })
  regDiscordBtn.addEventListener("click", (e) => {
    e.preventDefault()
    showToastErr("Discord登録は未実装です。", 4200)
  })

  logoutBtn.addEventListener("click", async () => {
    setLoading(logoutBtn, true)
    try {
      await doLogout()
      showToastOk("ログアウトしました。", 1600)
      setTimeout(() => { location.replace("/gallery/auth/") }, 450)
    } catch (err) {
      showToastErr(String(err), 5200)
    } finally {
      setLoading(logoutBtn, false)
    }
  })

  goNextBtn.addEventListener("click", () => {
    location.replace(nextUrl())
  })
}

async function boot() {
  initTabs()
  initForms()
  await refreshMe()
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot)
} else {
  boot()
}