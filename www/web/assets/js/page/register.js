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
  const { res, data } = await postForm("/gallery/api/auth/register/start", { email, password, next: NEXT })
  if (!res.ok) {
    const msg = String(data && data.detail ? data.detail : `register failed status=${res.status}`)
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
  link.textContent = "検証用リンク（メール未設定時）"
  devLink.appendChild(link)
}

function init() {
  if (!form) return
  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const email = String(emailEl ? emailEl.value : "").trim().toLowerCase()
    const pw1 = String(pw1El ? pw1El.value : "")
    const pw2 = String(pw2El ? pw2El.value : "")

    if (!email || !pw1 || !pw2) {
      showToastErr("必須項目を入力してください。", 4200)
      return
    }
    if (pw1.length < 8) {
      showToastErr("パスワードは8文字以上にしてください。", 4200)
      return
    }
    if (pw1 !== pw2) {
      showToastErr("パスワード（確認）が一致しません。", 4200)
      return
    }

    setBusy(true, "送信中...")
    try {
      const data = await startRegister(email, pw1)
      showToastOk("確認メールを送信しました。メールのリンクを開いて続行してください。", 3600)
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