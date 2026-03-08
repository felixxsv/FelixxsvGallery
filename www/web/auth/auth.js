const el = (id) => document.getElementById(id)

const discordBtn = el("authDiscordBtn")

const nextLabel = el("authNextLabel")

const loginForm = el("authLoginForm")
const loginEmail = el("authLoginEmail")
const loginPassword = el("authLoginPassword")
const loginBtn = el("authLoginBtn")
const openRegisterBtn = el("authOpenRegister")
const forgotBtn = el("authForgotBtn")

const registerCard = document.querySelector(".authcard--register")
const regToggle = el("authRegisterToggle")
const regPanel = el("authRegisterPanel")
const regForm = el("authRegisterForm")
const regUserKey = el("authRegUserKey")
const regDisplayName = el("authRegDisplayName")
const regEmail = el("authRegEmail")
const regPassword = el("authRegPassword")
const regBtn = el("authRegisterBtn")
const regCloseBtn = el("authCloseRegister")

const logoutBtn = el("authLogoutBtn")

const NAV_TOAST_KEY = "gallery_nav_toast_v1"

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

function parseNext() {
  const u = new URL(location.href)
  const n = u.searchParams.get("next") || "/gallery/"
  if (!n.startsWith("/")) return "/gallery/"
  if (n.startsWith("//")) return "/gallery/"
  return n
}

const NEXT = parseNext()

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

async function fetchMe() {
  const res = await fetch("/gallery/api/auth/me", { method: "GET", cache: "no-store", credentials: "same-origin" })
  const data = await res.json().catch(() => ({}))
  return { res, data }
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

function openRegister() {
  if (!registerCard) return
  registerCard.classList.add("is-open")
  if (regToggle) regToggle.setAttribute("aria-expanded", "true")
  if (regPanel) regPanel.setAttribute("aria-hidden", "false")
  if (regEmail) regEmail.focus()
}

function closeRegister() {
  if (!registerCard) return
  registerCard.classList.remove("is-open")
  if (regToggle) regToggle.setAttribute("aria-expanded", "false")
  if (regPanel) regPanel.setAttribute("aria-hidden", "true")
}

function toggleRegister() {
  if (!registerCard) return
  if (registerCard.classList.contains("is-open")) closeRegister()
  else openRegister()
}

function initEvents() {
  if (discordBtn) {
    discordBtn.addEventListener("click", () => {
      showToastErr("Discordログインは未実装です。", 4200)
    })
  }

  if (openRegisterBtn) openRegisterBtn.addEventListener("click", openRegister)
  if (regToggle) regToggle.addEventListener("click", toggleRegister)
  if (regCloseBtn) regCloseBtn.addEventListener("click", closeRegister)

  if (forgotBtn) {
    forgotBtn.addEventListener("click", () => showToastErr("パスワード再発行は未実装です。", 4200))
  }

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
        setTimeout(() => { location.replace(NEXT) }, 260)
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
        setTimeout(() => { location.replace(NEXT) }, 260)
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
        setTimeout(() => { location.replace("/gallery/") }, 260)
      } catch (err) {
        showToastErr(String(err && err.message ? err.message : err), 6200)
      } finally {
        setBusy(logoutBtn, false, null)
      }
    })
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRegister()
  })
}

async function boot() {
  if (nextLabel) nextLabel.textContent = NEXT

  const nav = readNavToast()
  if (nav) showToastOk(nav.text, nav.ms)

  try {
    const { res, data } = await fetchMe()
    const user = data ? data.user : null

    if (res.ok && user) {
      if (logoutBtn) logoutBtn.style.display = "inline-flex"
      showToastOk("ログイン済みです。", 1200)
      setTimeout(() => { location.replace(NEXT) }, 260)
      return
    }
  } catch (e) {}

  if (logoutBtn) logoutBtn.style.display = "none"
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