const el = (id) => document.getElementById(id)

const tabLogin = el("tabLogin")
const tabRegister = el("tabRegister")
const paneLogin = el("paneLogin")
const paneRegister = el("paneRegister")

const loginEmail = el("loginEmail")
const loginPass = el("loginPass")
const loginBtn = el("loginBtn")

const regEmail = el("regEmail")
const regKey = el("regKey")
const regName = el("regName")
const regPass = el("regPass")
const regBtn = el("regBtn")

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
  paneLogin.classList.toggle("is-on", isLogin)
  paneRegister.classList.toggle("is-on", !isLogin)
}

function nextUrl() {
  const u = new URL(location.href)
  const n = u.searchParams.get("next")
  if (n) return n
  return "/gallery/"
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

function getErrorMessage(data, fallback) {
  return String(
    data?.error?.message ||
    data?.message ||
    data?.detail ||
    fallback
  )
}

async function doLogin() {
  const em = String(loginEmail.value || "").trim()
  const pw = String(loginPass.value || "")

  if (!em || !pw) {
    showToastErr("email/password を入力してください。", 4200)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/login", {
    email: em,
    password: pw
  })

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `login failed (${res.status})`), 5200)
    return
  }

  if (data?.next?.to) {
    showToastOk(String(data.message || "ログインしました。"), 1600)
    setTimeout(() => {
      location.replace(data.next.to)
    }, 450)
    return
  }

  showToastOk(String(data?.message || "ログインしました。"), 1600)
  setTimeout(() => {
    location.replace(nextUrl())
  }, 450)
}

async function doRegister() {
  const em = String(regEmail.value || "").trim()
  const uk = String(regKey.value || "").trim()
  const dnRaw = String(regName.value || "").trim()
  const dn = dnRaw || uk
  const pw = String(regPass.value || "")

  if (!em || !uk || !pw) {
    showToastErr("email / user_key / password を入力してください。", 5200)
    return
  }

  const { res, data } = await postJson("/gallery/api/auth/register", {
    email: em,
    password: pw,
    user_key: uk,
    display_name: dn,
    terms_agreed: true
  })

  if (!res.ok) {
    showToastErr(getErrorMessage(data, `register failed (${res.status})`), 5200)
    return
  }

  showToastOk(String(data?.message || "作成しました。"), 2200)

  if (data?.next?.to) {
    setTimeout(() => {
      location.replace(data.next.to)
    }, 450)
    return
  }

  setTab("login")
  loginEmail.value = em
  loginPass.value = ""
  setTimeout(() => {
    loginPass.focus()
  }, 0)
}

function init() {
  if (tabLogin) tabLogin.addEventListener("click", () => setTab("login"))
  if (tabRegister) tabRegister.addEventListener("click", () => setTab("register"))
  if (loginBtn) loginBtn.addEventListener("click", doLogin)
  if (regBtn) regBtn.addEventListener("click", doRegister)

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return
    if (paneLogin.classList.contains("is-on")) {
      doLogin()
      return
    }
    doRegister()
  })
}

init()