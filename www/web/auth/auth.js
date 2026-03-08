const el = (id) => document.getElementById(id)

const loginForm = el("authLoginForm")
const loginId = el("authLoginId")
const loginPassword = el("authLoginPassword")
const loginBtn = el("authLoginBtn")

const discordBtn = el("authDiscordBtn")
const registerLink = el("authRegisterLink")

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

async function doLogin(identifier, password) {
  const { res, data } = await postForm("/gallery/api/auth/login", { email: identifier, password })
  if (!res.ok) {
    const msg = String(data && data.detail ? data.detail : `login failed status=${res.status}`)
    throw new Error(msg)
  }
  return data
}

async function boot() {
  const nav = readNavToast()
  if (nav) showToastOk(nav.text, nav.ms)

  if (registerLink) {
    registerLink.href = `/gallery/auth/register/?next=${encodeURIComponent(NEXT)}`
  }

  try {
    const me = await fetchMe()
    const user = me && me.data ? me.data.user : null
    if (user) {
      showToastOk("ログイン済みです。", 1200)
      setTimeout(() => { location.replace(NEXT) }, 250)
    }
  } catch (e) {}
}

function initEvents() {
  if (discordBtn) {
    discordBtn.addEventListener("click", () => {
      showToast("Discordログインは未設定です。", 3200, null)
    })
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault()
      const idv = String(loginId ? loginId.value : "").trim()
      const pw = String(loginPassword ? loginPassword.value : "")
      if (!idv || !pw) {
        showToastErr("入力してください。", 4200)
        return
      }

      setBusy(loginBtn, true, "Logging in...")
      try {
        await doLogin(idv, pw)
        showToastOk("ログインしました。", 1200)
        setTimeout(() => { location.replace(NEXT) }, 250)
      } catch (err) {
        showToastErr(String(err && err.message ? err.message : err), 6200)
      } finally {
        setBusy(loginBtn, false, null)
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