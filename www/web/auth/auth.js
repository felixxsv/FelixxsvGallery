const el = (id) => document.getElementById(id)

const discordBtn = el("authDiscordBtn")
const emailForm = el("authEmailForm")
const emailInput = el("authEmail")
const pwInput = el("authPassword")
const loginBtn = el("authLoginBtn")

const createLink = el("authCreateLink")
const createMini = el("authCreateMini")
const forgotLink = el("authForgotLink")

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

function showToastErr(text, ms) { showToast(text, ms || 5200, "err") }
function showToastOk(text, ms) { showToast(text, ms || 2600, "ok") }

function saveNavToast(text, ms) {
  try {
    const v = { text: String(text || ""), ms: Number(ms) || 3600, at: Date.now() }
    sessionStorage.setItem(NAV_TOAST_KEY, JSON.stringify(v))
  } catch (e) {}
}

function parseNext() {
  const u = new URL(location.href)
  const n = u.searchParams.get("next") || "/gallery/"
  if (!n.startsWith("/")) return "/gallery/"
  if (n.startsWith("//")) return "/gallery/"
  return n
}

const NEXT = parseNext()

function setCreateLinks() {
  const url = `/gallery/auth/register/?next=${encodeURIComponent(NEXT)}`
  if (createLink) createLink.href = url
  if (createMini) createMini.href = url
}

async function fetchMe() {
  const res = await fetch("/gallery/api/auth/me", { method: "GET", cache: "no-store", credentials: "same-origin" })
  const data = await res.json().catch(() => ({}))
  return { res, data }
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

async function boot() {
  setCreateLinks()

  const me = await fetchMe().catch(() => null)
  if (me && me.res && me.res.status === 200) {
    const user = me.data ? me.data.user : null
    if (user) {
      showToastOk("ログイン済みです。", 1100)
      setTimeout(() => { location.replace(NEXT) }, 250)
      return
    }
  }

  if (discordBtn) {
    discordBtn.addEventListener("click", () => {
      showToast("Discordログインは現在準備中です。", 3400, null)
    })
  }

  if (forgotLink) {
    forgotLink.addEventListener("click", (e) => {
      showToast("パスワード再設定は未実装です。", 3600, null)
    })
  }

  if (emailForm) {
    emailForm.addEventListener("submit", async (e) => {
      e.preventDefault()
      const email = String(emailInput ? emailInput.value : "").trim().toLowerCase()
      const pw = String(pwInput ? pwInput.value : "")
      if (!email || !pw) {
        showToastErr("メールアドレスとパスワードを入力してください。", 4200)
        return
      }
      setBusy(loginBtn, true, "ログイン中...")
      try {
        await doLogin(email, pw)
        const msg = "ログインしました。"
        showToastOk(msg, 1200)
        saveNavToast(msg, 2600)
        setTimeout(() => { location.replace(NEXT) }, 250)
      } catch (err) {
        showToastErr(String(err && err.message ? err.message : err), 6200)
      } finally {
        setBusy(loginBtn, false, null)
      }
    })
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot)
} else {
  boot()
}