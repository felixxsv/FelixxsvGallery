import { buildLocaleLoadOrder, createI18n } from "../core/i18n.js"
import { createSettingsStore } from "../core/settings.js"

const el = (id) => document.getElementById(id)

const form = el("cForm")
const ukEl = el("cUserKey")
const dnEl = el("cDisplayName")
const btn = el("cBtn")

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

function parseParam(name) {
  const u = new URL(location.href)
  return u.searchParams.get(name) || ""
}

function safeNext(v) {
  const n = String(v || "").trim() || "/"
  if (!n.startsWith("/")) return "/"
  if (n.startsWith("//")) return "/"
  return n
}

const TOKEN = parseParam("token")
const NEXT = safeNext(parseParam("next"))

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

async function completeRegister(user_key, display_name) {
  const { res, data } = await postForm("/api/auth/register/complete", { token: TOKEN, user_key, display_name, next: NEXT })
  if (!res.ok) {
    const msg = String(data && data.detail ? data.detail : `complete failed status=${res.status}`)
    throw new Error(msg)
  }
  return data
}

async function init() {
  const settings = createSettingsStore()
  i18n = createI18n(settings)
  await i18n.loadCatalogs("/assets/i18n", buildLocaleLoadOrder(settings.getLanguage())).catch(() => ({}))
  if (typeof window.initAuthHeroSlideshow === "function") window.initAuthHeroSlideshow()
  if (!TOKEN) {
    location.replace(`/auth/register/?next=${encodeURIComponent(NEXT)}`)
    return
  }
  if (!form) return

  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const uk = String(ukEl ? ukEl.value : "").trim()
    const dn = String(dnEl ? dnEl.value : "").trim()

    if (!uk) {
      showToastErr(t("auth.complete.user_key_required", "Enter a user key."), 4200)
      return
    }

    setBusy(true, t("auth.complete.processing", "Processing..."))
    try {
      await completeRegister(uk, dn)
      showToastOk(t("auth.complete.completed", "Registration completed."), 1400)
      setTimeout(() => { location.replace(NEXT) }, 250)
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
