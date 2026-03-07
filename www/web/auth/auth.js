const el = (id) => document.getElementById(id)

const loginForm = el("loginForm")
const loginEmail = el("loginEmail")
const loginPw = el("loginPw")
const loginBtn = el("loginBtn")

const createForm = el("createForm")
const createUserKey = el("createUserKey")
const createDisplay = el("createDisplay")
const createEmail = el("createEmail")
const createPw = el("createPw")
const createBtn = el("createBtn")

const discordBtn = el("discordBtn")

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

function showErr(s, ms){ showToast(s, ms || 5200, "err") }
function showOk(s, ms){ showToast(s, ms || 2200, "ok") }

function nextUrl() {
  const u = new URL(location.href)
  const n = u.searchParams.get("next")
  if (n && n.startsWith("/")) return n
  return "/gallery/upload"
}

async function postForm(url, fd) {
  const res = await fetch(url, { method: "POST", body: fd, cache: "no-store" })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

if (discordBtn) {
  discordBtn.addEventListener("click", () => showErr("Discordは未実装です。", 3200))
}

if (createForm) {
  createForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    if (!createEmail.value || !createPw.value || !createUserKey.value) return

    createBtn.disabled = true
    try {
      const fd = new FormData()
      fd.append("email", createEmail.value)
      fd.append("password", createPw.value)
      fd.append("user_key", createUserKey.value)
      fd.append("display_name", createDisplay.value || "")
      const { res, data } = await postForm("/gallery/api/auth/register", fd)
      if (!res.ok) {
        showErr(String((data && data.detail) || `register failed ${res.status}`))
        return
      }
      showOk("作成しました。ログインしてください。", 2200)
    } finally {
      createBtn.disabled = false
    }
  })
}

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    if (!loginEmail.value || !loginPw.value) return

    loginBtn.disabled = true
    try {
      const fd = new FormData()
      fd.append("email", loginEmail.value)
      fd.append("password", loginPw.value)
      const { res, data } = await postForm("/gallery/api/auth/login", fd)
      if (!res.ok) {
        showErr(String((data && data.detail) || `login failed ${res.status}`))
        return
      }
      showOk("ログインしました。", 1200)
      setTimeout(() => { location.href = nextUrl() }, 400)
    } finally {
      loginBtn.disabled = false
    }
  })
}