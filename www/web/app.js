(() => {
  const state = {
    profile: null,
    twoFactorSetupTicket: null,
    twoFactorSetupMaskedEmail: null,
    twoFactorSetupExpiresInSec: null
  };


  const AUTH_ME_ENDPOINTS = [
    '/api/auth/me',
    '/gallery/api/auth/me',
    '/gallery/api/me',
    '/gallery/api/session'
  ]

  function createPresenceReporter() {
    const endpoint = '/api/auth/presence'
    const intervalMs = 30000
    let timerId = null
    let started = false
    let visible = false

    async function post(nextVisible, useBeacon) {
      const body = JSON.stringify({ visible: !!nextVisible })
      if (useBeacon && navigator.sendBeacon) {
        try {
          const blob = new Blob([body], { type: 'application/json' })
          navigator.sendBeacon(endpoint, blob)
          return
        } catch (e) {}
      }
      try {
        await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: !!useBeacon,
        })
      } catch (e) {}
    }

    function clearTimer() {
      if (timerId) {
        clearTimeout(timerId)
        timerId = null
      }
    }

    function schedule() {
      clearTimer()
      if (!visible) return
      timerId = setTimeout(async () => {
        await post(true, false)
        schedule()
      }, intervalMs)
    }

    async function setVisible(nextVisible, useBeacon) {
      visible = !!nextVisible
      if (!visible) {
        clearTimer()
        await post(false, useBeacon)
        return
      }
      await post(true, useBeacon)
      schedule()
    }

    function bind() {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          void setVisible(false, true)
          return
        }
        void setVisible(true, false)
      })
      window.addEventListener('pagehide', () => {
        void setVisible(false, true)
      })
    }

    return {
      start() {
        if (started) return
        started = true
        bind()
        void setVisible(document.visibilityState !== 'hidden', false)
      },
    }
  }

  const presenceReporter = createPresenceReporter()

  async function startPresenceIfAuthenticated() {
    for (const endpoint of AUTH_ME_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })

        if (response.status === 401 || response.status === 403 || response.status === 404) {
          continue
        }

        let payload = null
        try {
          payload = await response.json()
        } catch (e) {}

        if (response.ok && payload && payload.ok !== false) {
          presenceReporter.start()
          return true
        }
      } catch (e) {}
    }
    return false
  }

  const settingsModal = document.getElementById('settings-modal');
  const settingsBody = document.getElementById('settings-modal-body');
  const settingsLoading = document.getElementById('settings-modal-loading');
  const settingsError = document.getElementById('settings-modal-error');

  const passwordModal = document.getElementById('settings-password-modal');
  const passwordForm = document.getElementById('settings-password-form');
  const passwordError = document.getElementById('settings-password-error');

  const twoFactorDisableModal = document.getElementById('settings-2fa-disable-modal');
  const twoFactorDisableForm = document.getElementById('settings-2fa-disable-form');
  const twoFactorDisableError = document.getElementById('settings-2fa-disable-error');

  const displayNameEl = document.getElementById('settings-display-name');
  const userKeyEl = document.getElementById('settings-user-key');
  const emailEl = document.getElementById('settings-email');
  const createdAtEl = document.getElementById('settings-created-at');
  const roleRowEl = document.getElementById('settings-role-row');
  const roleEl = document.getElementById('settings-role');
  const uploadDisabledEl = document.getElementById('settings-upload-disabled');
  const twoFactorStatusEl = document.getElementById('settings-2fa-status');
  const adminSectionEl = document.getElementById('settings-admin-section');

  const twoFactorEnableBtn = document.getElementById('settings-2fa-enable-btn');
  const twoFactorDisableOpenBtn = document.getElementById('settings-2fa-disable-open-btn');
  const twoFactorSetupBox = document.getElementById('settings-2fa-setup-box');
  const twoFactorSetupMessage = document.getElementById('settings-2fa-setup-message');
  const twoFactorSetupForm = document.getElementById('settings-2fa-setup-form');
  const twoFactorSetupCode = document.getElementById('settings-2fa-code');
  const twoFactorSetupError = document.getElementById('settings-2fa-setup-error');
  const twoFactorCancelBtn = document.getElementById('settings-2fa-cancel-btn');

  const logoutBtn = document.getElementById('settings-logout-btn');
  const logoutAllBtn = document.getElementById('settings-logout-all-btn');
  const passwordChangeOpenBtn = document.getElementById('settings-password-change-open-btn');

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status === 401) {
      window.location.href = '/gallery/auth';
      throw new Error('ログインが必要です。');
    }

    if (!response.ok || !payload || payload.ok === false) {
      const message = payload?.error?.message || '処理に失敗しました。';
      const error = new Error(message);
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function setMainLoading(isLoading) {
    settingsLoading.hidden = !isLoading;
    settingsBody.hidden = isLoading;
    settingsError.hidden = true;
    settingsError.textContent = '';
  }

  function showMainError(message) {
    settingsError.hidden = false;
    settingsError.textContent = message;
  }

  function closeSettingsModal() {
    settingsModal.hidden = true;
    resetTwoFactorSetupBox();
  }

  function openSettingsModal() {
    settingsModal.hidden = false;
    loadProfile();
  }

  function openPasswordModal() {
    passwordModal.hidden = false;
    passwordError.hidden = true;
    passwordError.textContent = '';
    passwordForm.reset();
  }

  function closePasswordModal() {
    passwordModal.hidden = true;
    passwordError.hidden = true;
    passwordError.textContent = '';
    passwordForm.reset();
  }

  function openTwoFactorDisableModal() {
    twoFactorDisableModal.hidden = false;
    twoFactorDisableError.hidden = true;
    twoFactorDisableError.textContent = '';
    twoFactorDisableForm.reset();
  }

  function closeTwoFactorDisableModal() {
    twoFactorDisableModal.hidden = true;
    twoFactorDisableError.hidden = true;
    twoFactorDisableError.textContent = '';
    twoFactorDisableForm.reset();
  }

  function resetTwoFactorSetupBox() {
    state.twoFactorSetupTicket = null;
    state.twoFactorSetupMaskedEmail = null;
    state.twoFactorSetupExpiresInSec = null;
    twoFactorSetupBox.hidden = true;
    twoFactorSetupMessage.textContent = '';
    twoFactorSetupError.hidden = true;
    twoFactorSetupError.textContent = '';
    twoFactorSetupForm.reset();
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return date.toLocaleString('ja-JP');
  }

  function renderProfile(data) {
    state.profile = data;

    const user = data.user;
    const twoFactor = data.security.two_factor;
    const canOpenAdmin = data.features.can_open_admin;

    displayNameEl.textContent = user.display_name || '-';
    userKeyEl.textContent = user.user_key || '-';
    emailEl.textContent = user.primary_email || '-';
    createdAtEl.textContent = formatDate(user.created_at);

    if (user.role === 'admin') {
      roleRowEl.hidden = false;
      roleEl.textContent = '管理者';
    } else {
      roleRowEl.hidden = true;
      roleEl.textContent = '';
    }

    uploadDisabledEl.hidden = user.upload_enabled !== false;
    twoFactorStatusEl.textContent = twoFactor.is_enabled ? '有効' : '無効';

    twoFactorEnableBtn.hidden = twoFactor.is_enabled;
    twoFactorDisableOpenBtn.hidden = !twoFactor.is_enabled;

    adminSectionEl.hidden = !canOpenAdmin;
  }

  async function loadProfile() {
    setMainLoading(true);
    resetTwoFactorSetupBox();
    try {
      const payload = await api('/api/auth/me');
      renderProfile(payload.data);
      setMainLoading(false);
    } catch (error) {
      setMainLoading(false);
      showMainError(error.message || 'ユーザー情報の取得に失敗しました。');
    }
  }

  async function handleLogout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.href = '/gallery/auth';
    } catch (error) {
      showMainError(error.message || 'ログアウトに失敗しました。');
    }
  }

  async function handleLogoutAll() {
    const ok = window.confirm('全端末からログアウトします。よろしいですか。');
    if (!ok) return;

    try {
      await api('/api/auth/logout-all', { method: 'POST' });
      window.location.href = '/gallery/auth';
    } catch (error) {
      showMainError(error.message || '全端末ログアウトに失敗しました。');
    }
  }

  async function handlePasswordChangeSubmit(event) {
    event.preventDefault();
    passwordError.hidden = true;
    passwordError.textContent = '';

    const currentPassword = document.getElementById('settings-current-password').value;
    const newPassword = document.getElementById('settings-new-password').value;

    try {
      await api('/api/auth/password/change', {
        method: 'POST',
        body: {
          current_password: currentPassword,
          new_password: newPassword
        }
      });
      window.location.href = '/gallery/auth';
    } catch (error) {
      passwordError.hidden = false;
      passwordError.textContent = error.message || 'パスワード変更に失敗しました。';
    }
  }

  async function handleTwoFactorSetupStart() {
    resetTwoFactorSetupBox();
    twoFactorSetupError.hidden = true;
    twoFactorSetupError.textContent = '';

    try {
      const payload = await api('/api/auth/2fa/setup/start', { method: 'POST' });
      state.twoFactorSetupTicket = payload.data.verify_ticket;
      state.twoFactorSetupMaskedEmail = payload.data.masked_email;
      state.twoFactorSetupExpiresInSec = payload.data.expires_in_sec;
      twoFactorSetupMessage.textContent = `${payload.data.masked_email} に確認コードを送信しました。コードを入力してください。`;
      twoFactorSetupBox.hidden = false;
      twoFactorSetupCode.focus();
    } catch (error) {
      twoFactorSetupError.hidden = false;
      twoFactorSetupError.textContent = error.message || '2段階認証の開始に失敗しました。';
      twoFactorSetupBox.hidden = false;
    }
  }

  async function handleTwoFactorSetupConfirm(event) {
    event.preventDefault();
    twoFactorSetupError.hidden = true;
    twoFactorSetupError.textContent = '';

    try {
      await api('/api/auth/2fa/setup/confirm', {
        method: 'POST',
        body: {
          verify_ticket: state.twoFactorSetupTicket,
          code: twoFactorSetupCode.value
        }
      });
      resetTwoFactorSetupBox();
      await loadProfile();
    } catch (error) {
      twoFactorSetupError.hidden = false;
      twoFactorSetupError.textContent = error.message || '2段階認証の有効化に失敗しました。';
    }
  }

  async function handleTwoFactorDisableSubmit(event) {
    event.preventDefault();
    twoFactorDisableError.hidden = true;
    twoFactorDisableError.textContent = '';

    const password = document.getElementById('settings-2fa-disable-password').value;

    try {
      await api('/api/auth/2fa/disable', {
        method: 'POST',
        body: {
          password
        }
      });
      closeTwoFactorDisableModal();
      await loadProfile();
    } catch (error) {
      twoFactorDisableError.hidden = false;
      twoFactorDisableError.textContent = error.message || '2段階認証の無効化に失敗しました。';
    }
  }

  document.querySelectorAll('[data-open-settings-modal]').forEach((button) => {
    button.addEventListener('click', openSettingsModal);
  });

  document.querySelectorAll('[data-close-settings-modal]').forEach((button) => {
    button.addEventListener('click', closeSettingsModal);
  });

  document.querySelectorAll('[data-close-password-modal]').forEach((button) => {
    button.addEventListener('click', closePasswordModal);
  });

  document.querySelectorAll('[data-close-2fa-disable-modal]').forEach((button) => {
    button.addEventListener('click', closeTwoFactorDisableModal);
  });

  logoutBtn.addEventListener('click', handleLogout);
  logoutAllBtn.addEventListener('click', handleLogoutAll);
  passwordChangeOpenBtn.addEventListener('click', openPasswordModal);
  passwordForm.addEventListener('submit', handlePasswordChangeSubmit);

  twoFactorEnableBtn.addEventListener('click', handleTwoFactorSetupStart);
  twoFactorSetupForm.addEventListener('submit', handleTwoFactorSetupConfirm);
  twoFactorCancelBtn.addEventListener('click', resetTwoFactorSetupBox);

  twoFactorDisableOpenBtn.addEventListener('click', openTwoFactorDisableModal);
  twoFactorDisableForm.addEventListener('submit', handleTwoFactorDisableSubmit);
})();

const el = (id) => document.getElementById(id)

const grid = el("grid")
const pagerTop = el("pagerTop")
const pagerBottom = el("pagerBottom")
const titleline = el("titleline")

const colBtns = el("colBtns")
const sidebar = el("sidebar")
const sideClose = el("sideClose")
const sideTab = el("sideTab")

const perPageSelect = el("perPageSelect")
const perPageValue = el("perPageValue")
const sortSelect = el("sortSelect")
const sortValue = el("sortValue")

const tagModeOr = el("tagModeOr")
const tagModeAnd = el("tagModeAnd")
const tagSelected = el("tagSelected")
const tagList = el("tagList")
const tagMore = el("tagMore")

const colorModeOr = el("colorModeOr")
const colorModeAnd = el("colorModeAnd")
const colorSelected = el("colorSelected")
const colorList = el("colorList")

const dateFrom = el("dateFrom")
const dateTo = el("dateTo")
const dateClear = el("dateClear")

const searchInput = el("searchInput")
const searchClear = el("searchClear")

const lb = el("lightbox")
const lbBg = el("lbBg")
const lbImg = el("lbImg")
const lbX = el("lbX")
const lbMeta = el("lbMeta")
const lbMoreBtn = el("lbMore")

const modal = el("modal")
const mBg = el("mBg")
const mX = el("mX")
const mBody = el("mBody")

const tagModal = el("tagModal")
const tmBg = el("tmBg")
const tmX = el("tmX")
const tmBody = el("tmBody")

const LS_COLS = "gallery_cols"
const LS_PERPAGE = "gallery_per_page"
const LS_SORT = "gallery_sort"
const LS_SEARCH = "gallery_search"

const LS_VIEWED = "gallery_viewed_v1"
const VIEW_TTL_MS = 24 * 60 * 60 * 1000
const VIEW_MAX = 3000

let viewedCache = null

let PALETTE = [
  { id: 1, name: "Red", hex: "#ff4b4b" },
  { id: 2, name: "Orange", hex: "#ff9f1a" },
  { id: 3, name: "Yellow", hex: "#ffd21a" },
  { id: 4, name: "Green", hex: "#34d399" },
  { id: 5, name: "Cyan", hex: "#22d3ee" },
  { id: 6, name: "Blue", hex: "#60a5fa" },
  { id: 7, name: "Purple", hex: "#a78bfa" },
  { id: 8, name: "Pink", hex: "#fb7185" },
  { id: 9, name: "White", hex: "#e5e7eb" },
  { id: 10, name: "Black", hex: "#111827" }
]

let state = {
  page: 1,
  per_page: 100,
  sort: "latest",
  cols: 2,
  total: 0,
  pages: 0,
  items: [],
  currentId: null,
  tagMode: "or",
  selectedTags: [],
  allTags: [],
  tagsExpanded: false,
  colorMode: "or",
  selectedColors: [],
  dateFrom: "",
  dateTo: "",
  q: ""
}

let sidebarOpen = true
let tabTimer = null

let lbHideTimer = null
let lbBarHideTimer = null
let lbXHideTimer = null
let lbTapToggle = true

const viewedOnce = new Set()

function isMobile() {
  return window.matchMedia("(max-width: 920px)").matches
}

function clampPerPage(n) {
  return [50, 100, 150, 200].includes(n) ? n : 100
}

function effectivePerPage() {
  return isMobile() ? 50 : state.per_page
}

function fmtShotAt(s) {
  if (!s) return ""
  const t = String(s).replace(/-/g, "/")
  return t.slice(0, 16)
}

function showFatal(msg) {
  let box = document.getElementById("fatalBox")
  if (!box) {
    box = document.createElement("div")
    box.id = "fatalBox"
    box.style.position = "sticky"
    box.style.top = "54px"
    box.style.zIndex = "9"
    box.style.margin = "10px 0"
    box.style.padding = "10px 12px"
    box.style.borderRadius = "12px"
    box.style.border = "1px solid rgba(255,255,255,.14)"
    box.style.background = "rgba(255,80,80,.12)"
    box.style.backdropFilter = "blur(10px)"
    box.style.color = "#e7eef7"
    box.style.fontSize = "13px"
    if (grid && grid.parentElement) {
      grid.parentElement.insertBefore(box, grid)
    }
  }
  box.textContent = msg
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" })
  const ct = (res.headers.get("content-type") || "").toLowerCase()
  if (!ct.includes("application/json")) {
    const txt = await res.text()
    throw new Error(`non-json response: ${res.status} ${ct} head=${txt.slice(0, 80)}`)
  }
  return await res.json()
}

function loadViewedCache() {
  if (viewedCache !== null) return viewedCache
  try {
    const raw = localStorage.getItem(LS_VIEWED)
    if (!raw) {
      viewedCache = {}
      return viewedCache
    }
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== "object") {
      viewedCache = {}
      return viewedCache
    }
    viewedCache = obj
    return viewedCache
  } catch (e) {
    viewedCache = {}
    return viewedCache
  }
}

function saveViewedCache(obj) {
  try {
    localStorage.setItem(LS_VIEWED, JSON.stringify(obj))
  } catch (e) {}
}

function pruneViewedCache(obj) {
  const now = Date.now()
  const entries = []
  for (const k in obj) {
    const ts = Number(obj[k])
    if (!Number.isFinite(ts)) continue
    if (now - ts > VIEW_TTL_MS) continue
    entries.push([k, ts])
  }
  entries.sort((a, b) => b[1] - a[1])
  const kept = entries.slice(0, VIEW_MAX)
  const out = {}
  for (const [k, ts] of kept) out[k] = ts
  viewedCache = out
  saveViewedCache(out)
  return out
}

function recordViewOnce(imageId) {
  const id = Number(imageId)
  if (!id) return
  if (viewedOnce.has(id)) return

  const now = Date.now()
  let cache = loadViewedCache()
  cache = pruneViewedCache(cache)

  const key = String(id)
  const last = Number(cache[key] || 0)

  if (last && (now - last) <= VIEW_TTL_MS) {
    viewedOnce.add(id)
    return
  }

  viewedOnce.add(id)
  cache[key] = now
  saveViewedCache(cache)

  fetch(`/gallery/api/images/${id}/view`, { method: "POST", keepalive: true }).catch(() => {})
}

function applyCols(n) {
  if (!grid) return
  grid.classList.remove("cols-1", "cols-2", "cols-3")
  grid.classList.add(`cols-${n}`)
  state.cols = n
  if (colBtns) {
    for (const b of colBtns.querySelectorAll(".btn")) {
      b.classList.toggle("is-on", Number(b.dataset.cols) === n)
    }
  }
}

function setCols(n) {
  if (isMobile()) {
    applyCols(1)
    return
  }
  const v = [1, 2, 3].includes(n) ? n : 2
  localStorage.setItem(LS_COLS, String(v))
  applyCols(v)
}

function openSidebar() {
  sidebarOpen = true
  if (sidebar) sidebar.classList.remove("is-closed")
  if (sideTab) sideTab.classList.remove("is-on")
}

function closeSidebar() {
  sidebarOpen = false
  if (sidebar) sidebar.classList.add("is-closed")
}

function buildPager(target) {
  if (!target) return
  target.innerHTML = ""
  const p = state.page
  const max = state.pages || 1

  const mk = (label, page, disabled) => {
    const b = document.createElement("button")
    b.textContent = label
    b.disabled = !!disabled
    b.addEventListener("click", () => {
      state.page = page
      load()
    })
    return b
  }

  target.appendChild(mk("<<", 1, p === 1))
  target.appendChild(mk("<", Math.max(1, p - 1), p === 1))

  const start = Math.max(1, p - 2)
  const end = Math.min(max, p + 2)
  for (let i = start; i <= end; i++) {
    const b = mk(String(i), i, false)
    if (i === p) b.classList.add("is-on")
    target.appendChild(b)
  }

  target.appendChild(mk(">", Math.min(max, p + 1), p === max))
  target.appendChild(mk(">>", max, p === max))
}

function buildQuery() {
  const p = new URLSearchParams()
  p.set("page", String(state.page))
  p.set("per_page", String(effectivePerPage()))
  p.set("sort", state.sort)

  const q = (state.q || "").trim()
  if (q) p.set("q", q)

  if (state.selectedTags.length > 0) {
    const v = state.selectedTags.join(",")
    if (state.tagMode === "and") p.set("tags_all", v)
    else p.set("tags_any", v)
  }

  if (state.selectedColors.length > 0) {
    const v = state.selectedColors.join(",")
    if (state.colorMode === "and") p.set("colors_all", v)
    else p.set("colors_any", v)
  }

  if (state.dateFrom) p.set("date_from", state.dateFrom)
  if (state.dateTo) p.set("date_to", state.dateTo)

  return p.toString()
}

function card(item) {
  const div = document.createElement("div")
  div.className = "card"

  const img = document.createElement("img")
  img.src = "/gallery/storage/" + item.thumb_path_960
  img.alt = item.title || ""
  img.loading = "lazy"
  img.addEventListener("click", () => openLightbox(item))

  const bar = document.createElement("div")
  bar.className = "bar"

  const l = document.createElement("div")
  l.className = "l"
  const t = document.createElement("div")
  t.className = "t"
  t.textContent = item.title || ""
  l.appendChild(t)

  const r = document.createElement("div")
  r.className = "r"

  const d = document.createElement("div")
  d.className = "d"
  d.textContent = fmtShotAt(item.shot_at)

  const more = document.createElement("button")
  more.className = "more"
  more.textContent = "…"
  more.addEventListener("click", (e) => {
    e.stopPropagation()
    openDetails(item.id)
  })

  r.appendChild(d)
  r.appendChild(more)

  bar.appendChild(l)
  bar.appendChild(r)

  div.appendChild(img)
  div.appendChild(bar)
  return div
}

async function load() {
  try {
    const q = buildQuery()
    const data = await fetchJson(`/gallery/api/images?${q}`)

    state.items = data.items || []
    state.total = Number(data.total || 0)
    state.pages = Number(data.pages || 1)

    if (titleline) titleline.textContent = `All Images (${state.total})`

    if (grid) {
      grid.innerHTML = ""
      for (const it of state.items) grid.appendChild(card(it))
    }

    if (!isMobile()) buildPager(pagerTop)
    else if (pagerTop) pagerTop.innerHTML = ""
    buildPager(pagerBottom)
  } catch (e) {
    showFatal(`API取得に失敗しました detail=${String(e)}`)
    if (grid) grid.innerHTML = ""
    if (pagerTop) pagerTop.innerHTML = ""
    if (pagerBottom) pagerBottom.innerHTML = ""
  }
}

function closeSelect(sel) {
  if (!sel) return
  sel.classList.remove("is-open")
  const b = sel.querySelector(".cselect__btn")
  if (b) b.setAttribute("aria-expanded", "false")
}

function openSelect(sel) {
  if (!sel) return
  if (sel.classList.contains("is-disabled")) return
  const isOpen = sel.classList.contains("is-open")
  closeSelect(perPageSelect)
  closeSelect(sortSelect)
  if (!isOpen) {
    sel.classList.add("is-open")
    const b = sel.querySelector(".cselect__btn")
    if (b) b.setAttribute("aria-expanded", "true")
  }
}

function initSelects() {
  if (perPageSelect) {
    const b = perPageSelect.querySelector(".cselect__btn")
    if (b) b.addEventListener("click", () => openSelect(perPageSelect))
    perPageSelect.addEventListener("click", (e) => {
      const opt = e.target.closest(".cselect__opt")
      if (!opt) return
      if (perPageSelect.classList.contains("is-disabled")) return
      const v = clampPerPage(Number(opt.dataset.value))
      state.per_page = v
      localStorage.setItem(LS_PERPAGE, String(v))
      if (perPageValue) perPageValue.textContent = String(v)
      perPageSelect.querySelectorAll(".cselect__opt").forEach((x) => x.classList.toggle("is-on", x.dataset.value === String(v)))
      closeSelect(perPageSelect)
      state.page = 1
      load()
    })
  }

  if (sortSelect) {
    const b = sortSelect.querySelector(".cselect__btn")
    if (b) b.addEventListener("click", () => openSelect(sortSelect))
    sortSelect.addEventListener("click", (e) => {
      const opt = e.target.closest(".cselect__opt")
      if (!opt) return
      const v = opt.dataset.value
      state.sort = v
      localStorage.setItem(LS_SORT, String(v))
      if (sortValue) sortValue.textContent = v === "oldest" ? "Oldest" : (v === "popular" ? "Popular" : "Latest")
      sortSelect.querySelectorAll(".cselect__opt").forEach((x) => x.classList.toggle("is-on", x.dataset.value === v))
      closeSelect(sortSelect)
      state.page = 1
      load()
    })
  }

  document.addEventListener("click", (e) => {
    const inSelect = e.target.closest(".cselect")
    if (!inSelect) {
      closeSelect(perPageSelect)
      closeSelect(sortSelect)
    }
  })
}

function setTagMode(mode) {
  state.tagMode = mode
  if (tagModeOr) tagModeOr.classList.toggle("is-on", mode === "or")
  if (tagModeAnd) tagModeAnd.classList.toggle("is-on", mode === "and")
  state.page = 1
  load()
}

function toggleTag(tag) {
  const i = state.selectedTags.indexOf(tag)
  if (i >= 0) state.selectedTags.splice(i, 1)
  else state.selectedTags.push(tag)
  renderSelectedTags()
  renderTagList()
  state.page = 1
  load()
}

function renderSelectedTags() {
  if (!tagSelected) return
  tagSelected.innerHTML = ""
  for (const t of state.selectedTags) {
    const chip = document.createElement("div")
    chip.className = "chip"
    const s = document.createElement("span")
    s.textContent = t
    const x = document.createElement("button")
    x.className = "x"
    x.type = "button"
    x.textContent = "×"
    x.addEventListener("click", () => toggleTag(t))
    chip.appendChild(s)
    chip.appendChild(x)
    tagSelected.appendChild(chip)
  }
}

function renderTagList() {
  if (!tagList) return
  tagList.innerHTML = ""
  const items = state.allTags || []
  const limit = state.tagsExpanded ? items.length : Math.min(10, items.length)

  for (let i = 0; i < limit; i++) {
    const it = items[i]
    const b = document.createElement("button")
    b.type = "button"
    b.className = "tagitem"
    b.title = it.name

    const name = document.createElement("span")
    name.className = "tagname"
    name.textContent = it.name

    const cnt = document.createElement("span")
    cnt.className = "tagcount"
    cnt.textContent = String(it.c)

    b.appendChild(name)
    b.appendChild(cnt)

    b.classList.toggle("is-on", state.selectedTags.includes(it.name))
    b.addEventListener("click", () => toggleTag(it.name))
    tagList.appendChild(b)
  }

  if (tagMore) {
    if (items.length > 10) {
      tagMore.style.display = "block"
      tagMore.textContent = state.tagsExpanded ? "Less" : "More"
    } else {
      tagMore.style.display = "none"
    }
  }
}

async function loadTags() {
  try {
    const data = await fetchJson("/gallery/api/tags?limit=200")
    state.allTags = data.items || []
    renderTagList()
  } catch (e) {
    state.allTags = []
    renderTagList()
  }
}

function setColorMode(mode) {
  state.colorMode = mode
  if (colorModeOr) colorModeOr.classList.toggle("is-on", mode === "or")
  if (colorModeAnd) colorModeAnd.classList.toggle("is-on", mode === "and")
  state.page = 1
  load()
}

function toggleColor(id) {
  const n = Number(id)
  const i = state.selectedColors.indexOf(n)
  if (i >= 0) state.selectedColors.splice(i, 1)
  else state.selectedColors.push(n)
  renderSelectedColors()
  renderColorList()
  state.page = 1
  load()
}

function renderSelectedColors() {
  if (!colorSelected) return
  colorSelected.innerHTML = ""
  for (const id of state.selectedColors) {
    const c = PALETTE.find((x) => Number(x.id) === Number(id))
    if (!c) continue
    const chip = document.createElement("div")
    chip.className = "cchip"
    const dot = document.createElement("span")
    dot.className = "dot"
    dot.style.background = c.hex
    const name = document.createElement("span")
    name.textContent = c.name
    const x = document.createElement("button")
    x.className = "x"
    x.type = "button"
    x.textContent = "×"
    x.addEventListener("click", () => toggleColor(id))
    chip.appendChild(dot)
    chip.appendChild(name)
    chip.appendChild(x)
    colorSelected.appendChild(chip)
  }
}

function renderColorList() {
  if (!colorList) return
  colorList.innerHTML = ""
  for (const c of PALETTE) {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "coloritem"
    b.title = c.name
    b.classList.toggle("is-on", state.selectedColors.includes(Number(c.id)))
    const dot = document.createElement("span")
    dot.className = "cdot"
    dot.style.background = c.hex
    b.appendChild(dot)
    b.addEventListener("click", () => toggleColor(Number(c.id)))
    colorList.appendChild(b)
  }
}

async function loadPalette() {
  try {
    const data = await fetchJson("/gallery/api/palette")
    const items = data.items || []
    if (Array.isArray(items) && items.length > 0) {
      PALETTE = items.map((x) => ({ id: Number(x.id), name: String(x.name), hex: String(x.hex) }))
    }
  } catch (e) {}
  renderColorList()
  renderSelectedColors()
}

function normalizeDates() {
  if (state.dateFrom && state.dateTo && state.dateFrom > state.dateTo) {
    const tmp = state.dateFrom
    state.dateFrom = state.dateTo
    state.dateTo = tmp
    if (dateFrom) dateFrom.value = state.dateFrom
    if (dateTo) dateTo.value = state.dateTo
  }
}

function initFilters() {
  if (tagModeOr) tagModeOr.addEventListener("click", () => setTagMode("or"))
  if (tagModeAnd) tagModeAnd.addEventListener("click", () => setTagMode("and"))
  if (tagMore) tagMore.addEventListener("click", () => { state.tagsExpanded = !state.tagsExpanded; renderTagList() })

  if (colorModeOr) colorModeOr.addEventListener("click", () => setColorMode("or"))
  if (colorModeAnd) colorModeAnd.addEventListener("click", () => setColorMode("and"))

  if (dateFrom) dateFrom.addEventListener("change", () => { state.dateFrom = dateFrom.value || ""; normalizeDates(); state.page = 1; load() })
  if (dateTo) dateTo.addEventListener("change", () => { state.dateTo = dateTo.value || ""; normalizeDates(); state.page = 1; load() })
  if (dateClear) dateClear.addEventListener("click", () => { state.dateFrom = ""; state.dateTo = ""; if (dateFrom) dateFrom.value = ""; if (dateTo) dateTo.value = ""; state.page = 1; load() })
}

function initSearch() {
  const saved = String(localStorage.getItem(LS_SEARCH) || "")
  state.q = saved
  if (searchInput) searchInput.value = saved

  let timer = null
  const apply = () => {
    const v = (searchInput ? String(searchInput.value || "") : "").trim()
    state.q = v
    localStorage.setItem(LS_SEARCH, v)
    state.page = 1
    load()
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(apply, 250)
    })
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (timer) clearTimeout(timer)
        apply()
      }
      if (e.key === "Escape") {
        if (timer) clearTimeout(timer)
        searchInput.value = ""
        apply()
      }
    })
  }

  if (searchClear) {
    searchClear.addEventListener("click", () => {
      if (timer) clearTimeout(timer)
      if (searchInput) searchInput.value = ""
      apply()
    })
  }
}

function lbClearTimers() {
  if (lbHideTimer) clearTimeout(lbHideTimer)
  if (lbBarHideTimer) clearTimeout(lbBarHideTimer)
  if (lbXHideTimer) clearTimeout(lbXHideTimer)
  lbHideTimer = null
  lbBarHideTimer = null
  lbXHideTimer = null
}

function lbHideAll() {
  if (!lb) return
  lb.classList.remove("show-bar", "show-x")
  lb.classList.add("cursor-hidden")
}

function lbShowX() {
  if (!lb) return
  lb.classList.add("show-x")
  lb.classList.remove("cursor-hidden")
  if (lbXHideTimer) clearTimeout(lbXHideTimer)
  lbXHideTimer = setTimeout(() => { if (lb) lb.classList.remove("show-x") }, 1000)
}

function lbShowBar() {
  if (!lb) return
  lb.classList.add("show-bar")
  lb.classList.remove("cursor-hidden")
  if (lbBarHideTimer) clearTimeout(lbBarHideTimer)
  lbBarHideTimer = setTimeout(() => { if (lb) lb.classList.remove("show-bar") }, 1000)
}

function lbShowByMove(e) {
  if (!lb) return
  lb.classList.remove("cursor-hidden")
  const w = window.innerWidth
  const h = window.innerHeight
  const inBottom = e.clientY >= (h - 140)
  const inTopRight = (e.clientX >= (w - 90) && e.clientY <= 90)
  if (inBottom) lbShowBar()
  if (inTopRight) lbShowX()
  if (lbHideTimer) clearTimeout(lbHideTimer)
  lbHideTimer = setTimeout(lbHideAll, 2500)
}

function openLightbox(item) {
  if (!lb || !lbImg) return
  state.currentId = item.id
  lbImg.src = "/gallery/media/original/" + item.id
  if (lbMeta) lbMeta.textContent = fmtShotAt(item.shot_at)
  lb.classList.add("is-on", "show-bar", "show-x")
  lb.classList.remove("cursor-hidden")
  lb.setAttribute("aria-hidden", "false")
  lbClearTimers()
  lbHideTimer = setTimeout(lbHideAll, 2000)
  lbTapToggle = true
  recordViewOnce(item.id)
}

function closeLightbox() {
  if (!lb) return
  lbClearTimers()
  lb.classList.remove("is-on", "show-bar", "show-x", "cursor-hidden")
  lb.setAttribute("aria-hidden", "true")
  if (lbImg) lbImg.removeAttribute("src")
  state.currentId = null
}

function openTagModal(tags) {
  if (!tagModal || !tmBody) return
  tmBody.innerHTML = ""
  for (const t of tags) {
    const chip = document.createElement("div")
    chip.className = "tagmini"
    chip.textContent = t
    tmBody.appendChild(chip)
  }
  tagModal.classList.add("is-on")
  tagModal.setAttribute("aria-hidden", "false")
}

function closeTagModal() {
  if (!tagModal || !tmBody) return
  tagModal.classList.remove("is-on")
  tagModal.setAttribute("aria-hidden", "true")
  tmBody.innerHTML = ""
}

async function openDetails(id) {
  try {
    const data = await fetchJson(`/gallery/api/images/${id}`)
    const tags = data.tags || []

    if (!mBody) return
    mBody.innerHTML = ""

    const mkRow = (k) => {
      const row = document.createElement("div")
      row.className = "row"
      const kk = document.createElement("div")
      kk.className = "k"
      kk.textContent = k
      const vv = document.createElement("div")
      vv.className = "v"
      row.appendChild(kk)
      row.appendChild(vv)
      mBody.appendChild(row)
      return vv
    }

    const vTitle = mkRow("Title")
    vTitle.textContent = data.title || ""

    const vAlt = mkRow("Alt")
    vAlt.textContent = data.alt || ""

    const vDate = mkRow("Date")
    vDate.textContent = fmtShotAt(data.shot_at)

    const vRes = mkRow("Resolution")
    vRes.textContent = `${data.width}x${data.height}`

    const vFmt = mkRow("Format")
    vFmt.textContent = data.format || ""

    const vViews = mkRow("Views")
    vViews.textContent = String(data.view_count ?? 0)

    const vLikes = mkRow("Likes")
    vLikes.textContent = String(data.like_count ?? 0)

    const vXLikes = mkRow("X Likes")
    vXLikes.textContent = String(data.x_like_count ?? 0)

    const vTags = mkRow("Tags")
    if (tags.length > 0) {
      const shown = tags.slice(0, 6)
      for (const t of shown) {
        const chip = document.createElement("div")
        chip.className = "tagmini"
        chip.textContent = t
        vTags.appendChild(chip)
      }
      if (tags.length > 6) {
        const more = document.createElement("button")
        more.type = "button"
        more.className = "tagmini more"
        more.textContent = "+more"
        more.addEventListener("click", () => openTagModal(tags))
        vTags.appendChild(more)
      }
    }

    const vColors = mkRow("Colors")
    const cstr = (data.colors || []).map((c) => `${c.color_id}:${Number(c.ratio).toFixed(2)}`).join(" ")
    vColors.textContent = cstr

    if (modal) {
      modal.classList.add("is-on")
      modal.setAttribute("aria-hidden", "false")
    }
  } catch (e) {
    showFatal(`details取得に失敗しました detail=${String(e)}`)
  }
}

function closeModal() {
  if (!modal) return
  modal.classList.remove("is-on")
  modal.setAttribute("aria-hidden", "true")
  if (mBody) mBody.innerHTML = ""
}

function initLightboxAndModals() {
  if (sideClose) sideClose.addEventListener("click", closeSidebar)
  if (sideTab) sideTab.addEventListener("click", openSidebar)

  document.addEventListener("mousemove", (e) => {
    if (sidebarOpen) return
    if (!sideTab) return
    if (e.clientX <= 10) {
      sideTab.classList.add("is-on")
      if (tabTimer) clearTimeout(tabTimer)
      tabTimer = null
      return
    }
    if (sideTab.classList.contains("is-on") && !tabTimer) {
      tabTimer = setTimeout(() => { if (sideTab) sideTab.classList.remove("is-on") }, 400)
    }
  })

  if (lbX) lbX.addEventListener("click", closeLightbox)
  if (lbBg) lbBg.addEventListener("click", closeLightbox)

  if (lb) {
    lb.addEventListener("mousemove", (e) => {
      if (!lb.classList.contains("is-on")) return
      if (isMobile()) return
      lbShowByMove(e)
    })
    lb.addEventListener("touchstart", () => {
      if (!lb.classList.contains("is-on")) return
      if (!isMobile()) return
      if (lbTapToggle) {
        lb.classList.remove("show-bar", "show-x")
        lbTapToggle = false
        return
      }
      lb.classList.add("show-bar", "show-x")
      lbTapToggle = true
      if (lbHideTimer) clearTimeout(lbHideTimer)
      lbHideTimer = setTimeout(() => { if (lb) lb.classList.remove("show-bar", "show-x") }, 2000)
    })
  }

  if (tmX) tmX.addEventListener("click", closeTagModal)
  if (tmBg) tmBg.addEventListener("click", closeTagModal)

  if (mX) {
    mX.addEventListener("click", () => {
      if (tagModal && tagModal.classList.contains("is-on")) {
        closeTagModal()
        return
      }
      closeModal()
    })
  }
  if (mBg) {
    mBg.addEventListener("click", () => {
      if (tagModal && tagModal.classList.contains("is-on")) {
        closeTagModal()
        return
      }
      closeModal()
    })
  }

  if (lbMoreBtn) lbMoreBtn.addEventListener("click", () => { if (state.currentId) openDetails(state.currentId) })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (tagModal && tagModal.classList.contains("is-on")) closeTagModal()
      else if (modal && modal.classList.contains("is-on")) closeModal()
      else if (lb && lb.classList.contains("is-on")) closeLightbox()
    }
    if (String(e.key).toLowerCase() === "i") {
      if (lb && lb.classList.contains("is-on") && state.currentId) openDetails(state.currentId)
    }
  })
}

function initColumns() {
  if (colBtns) {
    colBtns.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cols]")
      if (!b) return
      setCols(Number(b.dataset.cols))
    })
  }
  const savedCols = Number(localStorage.getItem(LS_COLS) || "2")
  if (isMobile()) applyCols(1)
  else applyCols([1, 2, 3].includes(savedCols) ? savedCols : 2)
}

function initPerPageSort() {
  const savedPer = Number(localStorage.getItem(LS_PERPAGE) || "100")
  if (isMobile()) {
    if (perPageSelect) perPageSelect.classList.add("is-disabled")
    if (perPageValue) perPageValue.textContent = "50"
  } else {
    const v = clampPerPage(savedPer)
    state.per_page = v
    if (perPageValue) perPageValue.textContent = String(v)
    if (perPageSelect) perPageSelect.querySelectorAll(".cselect__opt").forEach((x) => x.classList.toggle("is-on", x.dataset.value === String(v)))
  }

  const savedSort = String(localStorage.getItem(LS_SORT) || "latest")
  const sortOk = ["latest", "oldest", "popular"].includes(savedSort) ? savedSort : "latest"
  state.sort = sortOk
  if (sortValue) sortValue.textContent = sortOk === "oldest" ? "Oldest" : (sortOk === "popular" ? "Popular" : "Latest")
  if (sortSelect) sortSelect.querySelectorAll(".cselect__opt").forEach((x) => x.classList.toggle("is-on", x.dataset.value === sortOk))
}

async function init() {
  initColumns()
  initPerPageSort()
  initSelects()
  initFilters()
  initSearch()
  initLightboxAndModals()

  void startPresenceIfAuthenticated()

  await loadPalette()
  await loadTags()

  renderSelectedTags()
  renderSelectedColors()

  load()
}

init()