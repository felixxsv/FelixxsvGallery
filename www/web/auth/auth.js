const el = (id) => document.getElementById(id)

const loginForm = el("authLoginForm")
const loginEmail = el("authLoginEmail")
const loginPassword = el("authLoginPassword")
const loginBtn = el("authLoginBtn")

const discordBtn = el("authDiscordBtn")

const openReg1 = el("authOpenRegister1")
const openReg2 = el("authOpenRegister2")
const forgotBtn = el("authForgotBtn")

const modal = el("authModal")
const modalBg = el("authModalBg")
const modalX = el("authModalX")

const regForm = el("authRegisterForm")
const regEmail = el("authRegEmail")
const regPassword = el("authRegPassword")
const regDisplayName = el("authRegDisplayName")
const regBtn = el("authRegisterBtn")

const userLine = el("authUserLine")
const logoutBtn = el("authLogoutBtn")
const nextLine = el("authNextLine")

let toastWrap = null
let toastBox = null
let toastTimer = null

const AUTH_ME_ENDPOINTS = [
  "/gallery/api/auth/me",
  "/gallery/api/me",
  "/gallery/api/session"
]

const NAV_TOAST_KEY = "gallery_nav_toast_v1"

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

async function postForm(url, obj) {
  const fd = new FormData()
  for (const k of Object.keys(obj)) fd.append(k, String(obj[k] ?? ""))
  const res = await fetch(url, { method: "POST", body: fd, credentials: "same-origin" })
  const data = await res.json().catch(() => ({}))
  return { res, data }
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

function openModal() {
  if (!modal) return
  modal.classList.add("is-on")
  modal.setAttribute("aria-hidden", "false")
  setTimeout(() => {
    if (regEmail) regEmail.focus()
  }, 0)
}

function closeModal() {
  if (!modal) return
  modal.classList.remove("is-on")
  modal.setAttribute("aria-hidden", "true")
}

function isJapaneseText(s) {
  return /[ぁ-んァ-ン一-龯]/.test(String(s || ""))
}

function makeUserKeyFromEmail(email) {
  const e = String(email || "").trim().toLowerCase()
  const local = (e.split("@")[0] || "").trim()
  let k = local.replace(/[^a-z0-9_-]/g, "_")
  if (!k) k = "user"
  if (!/^[a-z]/.test(k)) k = "u" + k
  k = k.replace(/_+/g, "_").replace(/-+/g, "-")
  if (k.length < 4) k = (k + "____").slice(0, 4)
  if (k.length > 18) k = k.slice(0, 18)
  const suf = Math.random().toString(16).slice(2, 6)
  const out = (k + "_" + suf).slice(0, 20)
  if (!/^[a-z][a-z0-9_-]{3,19}$/.test(out)) {
    const alt = ("user_" + suf).slice(0, 20)
    return alt
  }
  return out
}

async function doLogin(email, password) {
  const { res, data } = await postForm("/gallery/api/auth/login", { email, password })
  if (!res.ok) {
    const msg = String(data && data.detail ? data.detail : `login failed status=${res.status}`)
    throw new Error(msg)
  }
  return data
}

async function doRegister(email, password, display_name) {
  const baseKey = makeUserKeyFromEmail(email)
  const dn = String(display_name || "").trim()
  const tries = [baseKey, makeUserKeyFromEmail(email), makeUserKeyFromEmail(email)]
  let lastErr = null

  for (const uk of tries) {
    try {
      const { res, data } = await postForm("/gallery/api/auth/register", {
        user_key: uk,
        display_name: dn,
        email,
        password
      })
      if (!res.ok) {
        const msg = String(data && data.detail ? data.detail : `register failed status=${res.status}`)
        lastErr = new Error(msg)
        if (res.status === 409 && String(msg).includes("user_key")) continue
        throw lastErr
      }
      return data
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error("register failed")
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

function setUserUI(user) {
  if (!userLine || !logoutBtn) return
  if (!user) {
    userLine.style.display = "none"
    logoutBtn.style.display = "none"
    return
  }
  const dn = String(user.display_name || user.user_key || "")
  userLine.textContent = dn ? dn : "Logged in"
  userLine.style.display = "block"
  logoutBtn.style.display = "inline-flex"
}

async function boot() {
  if (nextLine) {
    nextLine.textContent = `next: ${NEXT}`
    nextLine.style.display = "none"
  }

  const nav = readNavToast()
  if (nav) showToastOk(nav.text, nav.ms)

  const me = await fetchMe()
  const user = me && me.data ? me.data.user : null
  const uploadReq = me && me.data ? !!me.data.upload_requires_login : null

  setUserUI(user)

  if (user) {
    showToastOk("ログイン済みです。", 1200)
    setTimeout(() => { location.replace(NEXT) }, 250)
    return
  }

  if (uploadReq === false && NEXT.startsWith("/gallery/upload")) {
    showToast("現在はログインなしでアップロード可能です。", 2600, null)
  }
}

function initEvents() {
  if (discordBtn) {
    discordBtn.addEventListener("click", () => {
      showToast("Discord認証は準備中です。", 3200, null)
    })
  }

  if (forgotBtn) {
    forgotBtn.addEventListener("click", () => {
      showToast("パスワードリセットは未実装です。", 3200, null)
    })
  }

  const openReg = () => openModal()
  if (openReg1) openReg1.addEventListener("click", openReg)
  if (openReg2) openReg2.addEventListener("click", openReg)

  if (modalBg) modalBg.addEventListener("click", closeModal)
  if (modalX) modalX.addEventListener("click", closeModal)

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal()
  })

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault()
      const email = String(loginEmail ? loginEmail.value : "").trim().toLowerCase()
      const pw = String(loginPassword ? loginPassword.value : "")
      if (!email || !pw) {
        showToastErr("Email と Password を入力してください。", 4200)
        return
      }
      setBusy(loginBtn, true, "ログイン中...")
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
      const email = String(regEmail ? regEmail.value : "").trim().toLowerCase()
      const pw = String(regPassword ? regPassword.value : "")
      const dn = String(regDisplayName ? regDisplayName.value : "").trim()

      if (!email || !pw) {
        showToastErr("メールアドレスとパスワードを入力してください。", 4200)
        return
      }
      if (pw.length < 8) {
        showToastErr("パスワードは8文字以上にしてください。", 4200)
        return
      }

      setBusy(regBtn, true, "作成中...")
      try {
        await doRegister(email, pw, dn)
        await doLogin(email, pw)
        closeModal()
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
      setBusy(logoutBtn, true, "Logout...")
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