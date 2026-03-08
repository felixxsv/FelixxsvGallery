const el = (id) => document.getElementById(id)

const tabLogin = el("authTabLogin")
const tabRegister = el("authTabRegister")
const panelLogin = el("authPanelLogin")
const panelRegister = el("authPanelRegister")

const meLine = el("authMeLine")
const nextLabel = el("authNextLabel")

const loginForm = el("authLoginForm")
const loginEmail = el("authLoginEmail")
const loginPassword = el("authLoginPassword")
const loginBtn = el("authLoginBtn")
const gotoRegisterBtn = el("authGotoRegister")

const regForm = el("authRegisterForm")
const regUserKey = el("authRegUserKey")
const regDisplayName = el("authRegDisplayName")
const regEmail = el("authRegEmail")
const regPassword = el("authRegPassword")
const regBtn = el("authRegisterBtn")
const gotoLoginBtn = el("authGotoLogin")

const logoutBtn = el("authLogoutBtn")

const NAV_TOAST_KEY = "gallery_nav_toast_v1"

let toastWrap = null
let toastBox = null
let toastTimer = null

const AUTH_ME_ENDPOINTS = [
  "/gallery/api/auth/me",
  "/gallery/api/me",
  "/gallery/api/session"
]

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

function readNavToast() {
  try {
    const raw = sessionStorage.getItem(NAV_TOAST_KEY)
    if (!raw) return null
    sessionStorage.removeItem(NAV_TOAST_KEY)
    const v = JSON.parse(raw)
    if (!v || typeof v !== "object") return null
    const text = String(v.text || "").trim()
    const ms = Number(v.ms || 2600)
    if (!text) return null
    return { text, ms }
  } catch (e) {
    return null
  }
}

function setTab(mode) {
  const isLogin = mode === "login"
  tabLogin.classList.toggle("is-on", isLogin)
  tabRegister.classList.toggle("is-on", !isLogin)
  tabLogin.setAttribute("aria-selected", isLogin ? "true" : "false")
  tabRegister.setAttribute("aria-selected", !isLogin ? "true" : "false")
  panelLogin.classList.toggle("is-on", isLogin)
  panelRegister.classList.toggle("is-on", !isLogin)
}

function parseNext() {
  const u = new URL(location.href)
  const n = u.searchParams.get("next") || "/gallery/"
  if (!n.startsWith("/")) return "/gallery/"
  if (n.startsWith("//")) return "/gallery/"
  return n
}

const NEXT = parseNext()

function setMeLine(user) {
  if (!meLine) return
  if (!user) {
    meLine.textContent = ""
    return
  }
  const dn = String(user.display_name || user.user_key || "")
  meLine.textContent = dn ? `Logged in: ${dn}` : "Logged in"
}

async function fetchMe() {
  for (const url of AUTH_ME_ENDPOINTS) {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store", credentials: "same-origin" })
      if (res.status === 404) continue
      const data = await res.json().catch(() => ({}))
      return { status: res.status, data }
    } catch (e) {}
  }
  return { status: 0, data: null }
}

function setBusy(btn, on, label) {
  if (!btn) return
  if (on) {
    btn.disabled = true
    btn.dataset._label = btn.textContent || ""
    if (label) btn.textContent = label
    return
  }
  btn.disabled = false
  const prev = btn.dataset._label
  if (prev) btn.textContent = prev
}

async function postForm(url, obj) {
  const fd = new FormData()
  for (const k of Object.keys(obj)) fd.append(k, String(obj[k] ?? ""))
  const res = await fetch(url, { method: "POST", body: fd, credentials: "same-origin" })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function doLogin(email, password) {
  const { res, data } = await postForm("/gallery/api/auth/login", { email, password })
  if (!res.ok) {
    const msg = String(data && data.detail ? data.detail : `login failed status=${res.status}`)
    throw new Error(msg)
  }
  return data
}

async function doRegister(user_key, display_name, email, password) {
  const { res, data } = await postForm("/gallery/api/auth/register", { user_key, display_name, email, password })
  if (!res.ok) {
    const msg = String(data && data.detail ? data.detail : `register failed status=${res.status}`)
    throw new Error(msg)
  }
  return data
}

async function doLogout() {
  const res = await fetch("/gallery/api/auth/logout", { method: "POST", credentials: "same-origin" })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = String(data && data.detail ? data.detail : `logout failed status=${res.status}`)
    throw new Error(msg)
  }
  return data
}

async function boot() {
  if (nextLabel) nextLabel.textContent = NEXT

  const nav = readNavToast()
  if (nav) showToastOk(nav.text, nav.ms)

  const me = await fetchMe()
  const user = me && me.data ? me.data.user : null
  const uploadReq = me && me.data ? !!me.data.upload_requires_login : null

  setMeLine(user)

  if (user) {
    if (logoutBtn) logoutBtn.style.display = "inline-flex"
    showToastOk("ログイン済みです。", 1200)
    setTimeout(() => { location.replace(NEXT) }, 250)
    return
  }

  if (logoutBtn) logoutBtn.style.display = "none"

  if (uploadReq === false && NEXT.startsWith("/gallery/upload")) {
    showToast("現在はログインなしでアップロード可能です。", 2600, null)
  }

  setTab("login")
}

function initEvents() {
  tabLogin.addEventListener("click", () => setTab("login"))
  tabRegister.addEventListener("click", () => setTab("register"))

  if (gotoRegisterBtn) gotoRegisterBtn.addEventListener("click", () => setTab("register"))
  if (gotoLoginBtn) gotoLoginBtn.addEventListener("click", () => setTab("login"))

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault()
      const email = String(loginEmail ? loginEmail.value : "").trim().toLowerCase()
      const pw = String(loginPassword ? loginPassword.value : "")
      if (!email || !pw) {
        showToastErr("Email と Password を入力してください。", 4200)
        return
      }
      setBusy(loginBtn, true, "Logging in...")
      try {
        await doLogin(email, pw)
        showToastOk("ログインしました。", 1200)
        setTimeout(() => { location.replace(NEXT) }, 250)
      } catch (err) {
        showToastErr(String(err && err.message ? err.message : err), 6200)
      } finally {
        setBusy(loginBtn, false, null)
      }
    })
  }

  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault()
      const uk = String(regUserKey ? regUserKey.value : "").trim()
      const dn = String(regDisplayName ? regDisplayName.value : "").trim()
      const email = String(regEmail ? regEmail.value : "").trim().toLowerCase()
      const pw = String(regPassword ? regPassword.value : "")

      if (!uk || !email || !pw) {
        showToastErr("必須項目を入力してください。", 4200)
        return
      }
      if (pw.length < 8) {
        showToastErr("Password は 8文字以上にしてください。", 4200)
        return
      }

      setBusy(regBtn, true, "Registering...")
      try {
        await doRegister(uk, dn, email, pw)
        await doLogin(email, pw)
        showToastOk("登録しました。", 1400)
        setTimeout(() => { location.replace(NEXT) }, 250)
      } catch (err) {
        showToastErr(String(err && err.message ? err.message : err), 6200)
      } finally {
        setBusy(regBtn, false, null)
      }
    })
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      setBusy(logoutBtn, true, "Logging out...")
      try {
        await doLogout()
        showToastOk("ログアウトしました。", 1400)
        setTimeout(() => { location.replace("/gallery/") }, 250)
      } catch (err) {
        showToastErr(String(err && err.message ? err.message : err), 6200)
      } finally {
        setBusy(logoutBtn, false, null)
      }
    })
  }
}

function init() {
  initEvents()
  boot()
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  init()
}