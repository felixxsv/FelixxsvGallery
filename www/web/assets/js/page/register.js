import { buildLocaleLoadOrder, createI18n, resolveLocalizedMessage } from "../core/i18n.js"
import { createSettingsStore } from "../core/settings.js"

const el = (id) => document.getElementById(id)

const form = el("regForm")
const emailEl = el("regEmail")
const pw1El = el("regPassword")
const pw2El = el("regPassword2")
const btn = el("regBtn")
const devLink = el("regDevLink")

let toastWrap = null
let toastBox = null
let toastTimer = null
let i18n = null

function t(key, fallback, vars) {
  return i18n?.t?.(key, fallback, vars) || fallback
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

function showToastErr(text, ms) { showToast(text, ms || 5200, "err") }
function showToastOk(text, ms) { showToast(text, ms || 2600, "ok") }

function parseNext() {
  const u = new URL(location.href)
  const n = u.searchParams.get("next") || "/gallery/"
  if (!n.startsWith("/")) return "/gallery/"
  if (n.startsWith("//")) return "/gallery/"
  return n
}

const NEXT = parseNext()

function setBusy(on, label) {
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

async function startRegister(email, password) {
  const language = i18n?.getLanguage?.() || "en-us"
  const { res, data } = await postForm("/gallery/api/auth/register/start", { email, password, next: NEXT, preferred_language: language })
  if (!res.ok) {
    const msg = resolveLocalizedMessage(data?.error?.message || data?.message || data?.detail, `register failed status=${res.status}`, i18n?.getLanguage?.() || document.documentElement.lang)
    throw new Error(msg)
  }
  return data
}

function showDevVerifyLink(url) {
  if (!devLink) return
  const u = String(url || "").trim()
  if (!u) return
  devLink.style.display = "block"
  devLink.innerHTML = ""
  const link = document.createElement("a")
  link.className = "authlink"
  link.href = u
  link.textContent = t("auth.register.dev_verify_link", "Verification link (when email is not configured)")
  devLink.appendChild(link)
}

async function init() {
  const settings = createSettingsStore()
  i18n = createI18n(settings)
  await i18n.loadCatalogs("/gallery/assets/i18n", buildLocaleLoadOrder(settings.getLanguage())).catch(() => ({}))
  if (typeof window.initAuthHeroSlideshow === "function") window.initAuthHeroSlideshow()
  if (!form) return
  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const email = String(emailEl ? emailEl.value : "").trim().toLowerCase()
    const pw1 = String(pw1El ? pw1El.value : "")
    const pw2 = String(pw2El ? pw2El.value : "")

    if (!email || !pw1 || !pw2) {
      showToastErr(t("auth.register.required_fields", "Enter all required fields."), 4200)
      return
    }
    if (pw1.length < 8) {
      showToastErr(t("auth.register.password_min_length", "Use at least 8 characters for the password."), 4200)
      return
    }
    if (pw1 !== pw2) {
      showToastErr(t("auth.register.password_mismatch", "Password confirmation does not match."), 4200)
      return
    }

    setBusy(true, t("auth.register.submitting", "Sending..."))
    try {
      const data = await startRegister(email, pw1)
      showToastOk(t("auth.register.mail_sent", "Verification email sent. Open the link in the email to continue."), 3600)
      if (data && data.verify_url) showDevVerifyLink(data.verify_url)
    } catch (err) {
      showToastErr(String(err && err.message ? err.message : err), 6200)
    } finally {
      setBusy(false, null)
    }
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  init()
}
