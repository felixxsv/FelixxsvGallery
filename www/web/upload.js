const el = (id) => document.getElementById(id)

const drop = el("upDrop")
const pick = el("upPick")
const fileInput = el("upFile")

const stripFrame = el("upStripFrame")
const strip = el("upStrip")
const arrowL = el("upArrowL")
const arrowR = el("upArrowR")

const coverImg = el("upCover")
const coverPh = el("upCoverPh")

const titleInput = el("upTitle")
const altInput = el("upAlt")

const tagBox = el("upTagBox")
const tagChips = el("upTagChips")
const tagInput = el("upTag")
const tagAdd = el("upTagAdd")
const tagSug = el("upTagSug")

const visHidden = el("upVis")
const visBtns = Array.from(document.querySelectorAll(".upvis__btn"))

const submitBtn = el("upSubmit")

const MAX_FILES = 20
const MIN_PLACEHOLDERS = 20

let files = []
let tagState = []
let tagPoolRaw = []

let pendingDrag = null
let dragging = null

let hoverInFrame = false
let hoverX = null
let hoverArrow = null
let hoverLockTimer = null

let arrowAnim = null
let arrowDir = 0

const EDGE_SHOW = 70
const EDGE_HIDE = 90

let tagPanelMode = ""
let tagCloseTimer = null
let tagBackdrop = null

let tagSugHomeParent = null
let tagSugHomeNext = null

let toastWrap = null
let toastBox = null
let toastTimer = null

const dupIdx = new Set()

const NAV_TOAST_KEY = "gallery_nav_toast_v1"

const AUTH_ME_ENDPOINTS = [
  "/gallery/api/auth/me",
  "/gallery/api/me",
  "/gallery/api/session"
]


const PRESENCE_ENDPOINT = "/gallery/api/auth/presence"
let presenceTimer = null
let presenceStarted = false

async function postPresence(visible, useBeacon) {
  const body = JSON.stringify({ visible: !!visible })
  if (useBeacon && navigator.sendBeacon) {
    try {
      const blob = new Blob([body], { type: "application/json" })
      navigator.sendBeacon(PRESENCE_ENDPOINT, blob)
      return
    } catch (e) {}
  }
  try {
    await fetch(PRESENCE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      keepalive: !visible,
      body,
    })
  } catch (e) {}
}

function startPresenceTimer() {
  if (presenceTimer) return
  presenceTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void postPresence(true, false)
  }, 30000)
}

function stopPresenceTimer() {
  if (!presenceTimer) return
  clearInterval(presenceTimer)
  presenceTimer = null
}

function startPresenceMonitor() {
  if (presenceStarted) return
  presenceStarted = true

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startPresenceTimer()
      void postPresence(true, false)
    } else {
      stopPresenceTimer()
      void postPresence(false, true)
    }
  })

  window.addEventListener("pagehide", () => {
    stopPresenceTimer()
    void postPresence(false, true)
  })

  if (document.visibilityState === "visible") {
    startPresenceTimer()
    void postPresence(true, false)
  }
}

function gotoAuth() {
  const next = `${location.pathname}${location.search}${location.hash}`
  location.replace(`/gallery/auth/?next=${encodeURIComponent(next)}`)
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

function showToastErr(text, ms) {
  showToast(text, ms || 5200, "err")
}

function showToastOk(text, ms) {
  showToast(text, ms || 2600, "ok")
}

function saveNavToast(text, ms) {
  try {
    const v = { text: String(text || ""), ms: Number(ms) || 3600, at: Date.now() }
    sessionStorage.setItem(NAV_TOAST_KEY, JSON.stringify(v))
  } catch (e) {}
}

function ensureBackdrop() {
  if (tagBackdrop) return
  document.querySelectorAll(".uptagbackdrop").forEach((x) => x.remove())
  tagBackdrop = document.createElement("div")
  tagBackdrop.className = "uptagbackdrop"
  tagBackdrop.addEventListener("click", () => closeTagPanelAnimated(null))
  document.body.appendChild(tagBackdrop)
}

function setBackdropOn(on) {
  if (on) {
    ensureBackdrop()
    tagBackdrop.classList.add("is-on")
    return
  }
  if (tagBackdrop) {
    tagBackdrop.classList.remove("is-on")
    tagBackdrop.remove()
    tagBackdrop = null
  }
}

function portalSugToBody() {
  if (!tagSug) return
  if (tagSug.parentElement === document.body) return
  tagSugHomeParent = tagSug.parentElement
  tagSugHomeNext = tagSug.nextSibling
  document.body.appendChild(tagSug)
}

function portalSugBackHome() {
  if (!tagSug) return
  if (tagSugHomeParent && tagSug.parentElement === document.body) {
    if (tagSugHomeNext && tagSugHomeNext.parentNode === tagSugHomeParent) {
      tagSugHomeParent.insertBefore(tagSug, tagSugHomeNext)
    } else {
      tagSugHomeParent.appendChild(tagSug)
    }
  }
  tagSugHomeParent = null
  tagSugHomeNext = null
}

function isSugPortaled() {
  return !!tagSug && tagSug.parentElement === document.body
}

function forceCloseTagUI() {
  setBackdropOn(false)
  if (tagSug) {
    tagSug.classList.remove("is-on", "is-leaving", "uptagsug--popover", "is-small", "is-expanded")
    tagSug.style.display = "none"
    tagSug.innerHTML = ""
    tagSug.setAttribute("aria-hidden", "true")
  }
  if (isSugPortaled()) portalSugBackHome()
  tagPanelMode = ""
}

function isImageFile(f) {
  const t = String(f.type || "").toLowerCase()
  if (t.startsWith("image/")) return true
  const n = String(f.name || "").toLowerCase()
  return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp")
}

function revokeAll() {
  for (const it of files) {
    try {
      URL.revokeObjectURL(it.url)
    } catch (e) {}
  }
}

function makeUrl(f) {
  return URL.createObjectURL(f)
}

function isReordering() {
  return !!dragging || (!!pendingDrag && pendingDrag.started === true)
}

function rebuildDupIdxOnReorder(from, to) {
  if (dupIdx.size === 0) return
  const cur = Array.from(dupIdx).sort((a, b) => a - b)
  const mark = new Array(files.length).fill(false)
  for (const i of cur) if (i >= 0 && i < mark.length) mark[i] = true
  const moved = mark.splice(from, 1)[0]
  mark.splice(to, 0, moved)
  dupIdx.clear()
  for (let i = 0; i < mark.length; i++) if (mark[i]) dupIdx.add(i)
}

function moveIndex(from, to) {
  if (from === to) return
  const it = files.splice(from, 1)[0]
  files.splice(to, 0, it)
  rebuildDupIdxOnReorder(from, to)
}

function clearDupMarks() {
  dupIdx.clear()
}

function applyDupMarksFromItems(items) {
  dupIdx.clear()
  const n = Math.min(items.length, files.length)
  for (let i = 0; i < n; i++) {
    const it = items[i]
    if (it && it.duplicate === true) dupIdx.add(i)
  }
}

function addFiles(list) {
  const incoming = Array.from(list || []).filter(isImageFile)
  if (incoming.length === 0) {
    showToastErr("画像ファイルを選択してください。", 3200)
    return
  }

  const room = MAX_FILES - files.length
  if (room <= 0) {
    showToastErr(`画像は最大${MAX_FILES}枚までです。`, 4200)
    return
  }

  const adding = incoming.slice(0, room)
  for (const f of adding) files.push({ file: f, url: makeUrl(f) })

  if (incoming.length > adding.length) {
    showToastErr(`最大${MAX_FILES}枚までのため、超過分は追加しませんでした。`, 4200)
  }

  clearDupMarks()
  renderAll()
}

function shiftDupIdxOnRemove(idx) {
  if (dupIdx.size === 0) return
  const out = new Set()
  for (const i of dupIdx) {
    if (i === idx) continue
    if (i > idx) out.add(i - 1)
    else out.add(i)
  }
  dupIdx.clear()
  for (const v of out) dupIdx.add(v)
}

function removeIndex(i) {
  const it = files[i]
  if (!it) return
  try {
    URL.revokeObjectURL(it.url)
  } catch (e) {}
  files.splice(i, 1)
  shiftDupIdxOnRemove(i)
  renderAll()
}

function renderCover() {
  if (!coverImg || !coverPh) return
  if (files.length === 0) {
    coverImg.style.display = "none"
    coverImg.removeAttribute("src")
    coverPh.style.display = "flex"
    return
  }
  coverPh.style.display = "none"
  coverImg.style.display = "block"
  coverImg.src = files[0].url
}

function mkThumb(it, idx) {
  const d = document.createElement("div")
  d.className = "upthumb" + (idx === 0 ? " is-cover" : "")
  d.dataset.kind = "file"
  d.dataset.idx = String(idx)
  if (dupIdx.has(idx)) d.classList.add("is-dup")

  const img = document.createElement("img")
  img.className = "upthumb__img"
  img.alt = ""
  img.src = it.url
  img.draggable = false
  img.addEventListener("dragstart", (e) => e.preventDefault())
  d.appendChild(img)

  const rm = document.createElement("button")
  rm.className = "upthumb__rm"
  rm.type = "button"
  rm.textContent = "×"
  rm.addEventListener("click", (e) => {
    e.stopPropagation()
    removeIndex(idx)
  })
  d.appendChild(rm)

  d.addEventListener("dragstart", (e) => e.preventDefault())
  return d
}

function mkEmptyThumb() {
  const d = document.createElement("div")
  d.className = "upthumb is-empty"
  d.dataset.kind = "empty"
  return d
}

function renderStrip() {
  if (!strip) return
  strip.innerHTML = ""
  for (let i = 0; i < files.length; i++) strip.appendChild(mkThumb(files[i], i))
  const need = Math.max(0, MIN_PLACEHOLDERS - files.length)
  for (let i = 0; i < need; i++) strip.appendChild(mkEmptyThumb())
  updateArrows()
}

function normalizeTag(s) {
  const t = String(s || "").trim()
  if (!t) return ""
  return t.replace(/\s+/g, " ")
}

function addTag(s) {
  const t = normalizeTag(s)
  if (!t) return
  if (tagState.includes(t)) return
  tagState.push(t)
  renderTags()
  if (tagPanelMode === "small") renderTagPanelSmall()
  if (tagPanelMode === "expanded") renderTagPanelExpanded()
}

function removeTag(t) {
  const i = tagState.indexOf(t)
  if (i >= 0) tagState.splice(i, 1)
  renderTags()
  if (tagPanelMode === "small") renderTagPanelSmall()
  if (tagPanelMode === "expanded") renderTagPanelExpanded()
}

function renderTags() {
  if (!tagChips) return
  tagChips.innerHTML = ""
  for (const t of tagState) {
    const chip = document.createElement("div")
    chip.className = "uptagchip"
    const name = document.createElement("span")
    name.textContent = t
    const x = document.createElement("button")
    x.type = "button"
    x.textContent = "×"
    x.addEventListener("click", () => removeTag(t))
    chip.appendChild(name)
    chip.appendChild(x)
    tagChips.appendChild(chip)
  }
}

async function loadTagPool() {
  try {
    const res = await fetch("/gallery/api/tags?limit=200", { cache: "no-store", credentials: "same-origin" })
    const data = await res.json()
    const items = Array.isArray(data.items) ? data.items : []
    tagPoolRaw = items.map((x) => ({ name: String(x.name || ""), c: Number(x.c || 0) })).filter((x) => x.name)
  } catch (e) {
    tagPoolRaw = []
  }
}

function isJapaneseText(s) {
  return /[ぁ-んァ-ン一-龯]/.test(String(s || ""))
}

function sortAZThenJP(a, b) {
  const aj = isJapaneseText(a)
  const bj = isJapaneseText(b)
  if (aj !== bj) return aj ? 1 : -1
  if (!aj) return String(a).localeCompare(String(b), "en", { sensitivity: "base", numeric: true })
  return String(a).localeCompare(String(b), "ja", { sensitivity: "base", numeric: true })
}

function showTagPanelBase() {
  if (!tagSug) return
  if (tagCloseTimer) {
    clearTimeout(tagCloseTimer)
    tagCloseTimer = null
  }
  tagSug.style.display = "block"
  tagSug.setAttribute("aria-hidden", "false")
  tagSug.classList.remove("is-leaving")
  requestAnimationFrame(() => tagSug.classList.add("is-on"))
}

function hideTagPanelBase() {
  if (!tagSug) return
  tagSug.classList.remove("is-on", "uptagsug--popover", "is-small", "is-expanded", "is-leaving")
  tagSug.style.display = "none"
  tagSug.innerHTML = ""
  tagSug.setAttribute("aria-hidden", "true")
}

function closeTagPanelAnimated(after) {
  setBackdropOn(false)

  if (!tagSug) {
    tagPanelMode = ""
    if (after) after()
    return
  }

  if (!tagPanelMode) {
    hideTagPanelBase()
    if (isSugPortaled()) portalSugBackHome()
    if (after) after()
    return
  }

  tagSug.classList.add("is-leaving")
  tagSug.classList.remove("is-on")
  const ms = 180
  if (tagCloseTimer) clearTimeout(tagCloseTimer)
  tagCloseTimer = setTimeout(() => {
    hideTagPanelBase()
    tagPanelMode = ""
    if (isSugPortaled()) portalSugBackHome()
    if (after) after()
  }, ms)
}

function openTagPanelSmall() {
  if (!tagSug || !tagBox) return
  tagPanelMode = "small"
  setBackdropOn(false)
  if (isSugPortaled()) portalSugBackHome()
  tagSug.classList.remove("is-expanded")
  tagSug.classList.add("is-small", "uptagsug--popover")
  showTagPanelBase()
  renderTagPanelSmall()
}

function openTagPanelExpanded() {
  if (!tagSug) return
  tagPanelMode = "expanded"
  portalSugToBody()
  tagSug.classList.remove("is-small", "uptagsug--popover")
  tagSug.classList.add("is-expanded")
  showTagPanelBase()
  renderTagPanelExpanded()
  setBackdropOn(true)
}

function togglePlus() {
  if (!tagPanelMode) {
    openTagPanelSmall()
    return
  }
  if (tagPanelMode === "small") {
    closeTagPanelAnimated(null)
    return
  }
  if (tagPanelMode === "expanded") {
    closeTagPanelAnimated(() => openTagPanelSmall())
  }
}

function mkTagButton(name, count, withCount) {
  const b = document.createElement("button")
  b.type = "button"
  b.className = "uptagpick"
  const s = document.createElement("span")
  s.textContent = name
  b.appendChild(s)
  if (withCount) {
    const c = document.createElement("span")
    c.className = "uptagpickcount"
    c.textContent = String(count || 0)
    b.appendChild(c)
  }
  return b
}

function renderTagPanelSmall() {
  if (!tagSug) return
  if (tagPanelMode !== "small") return

  const pool = tagPoolRaw
    .filter((x) => !tagState.includes(x.name))
    .sort((a, b) => b.c - a.c || a.name.localeCompare(b.name))

  tagSug.innerHTML = ""

  const top = document.createElement("div")
  top.className = "uptagpanel__top"
  const title = document.createElement("div")
  title.className = "uptagpanel__title"
  title.textContent = "Tags"
  top.appendChild(title)
  tagSug.appendChild(top)

  const row = document.createElement("div")
  row.className = "uptagrow"
  tagSug.appendChild(row)

  const more = document.createElement("button")
  more.type = "button"
  more.className = "uptagpick more"
  more.textContent = "+more"
  more.addEventListener("click", () => closeTagPanelAnimated(() => openTagPanelExpanded()))
  row.appendChild(more)

  for (const it of pool) {
    const b = mkTagButton(it.name, it.c, false)
    b.addEventListener("click", () => addTag(it.name))
    row.insertBefore(b, more)

    if (row.scrollWidth > row.clientWidth + 1) {
      row.removeChild(b)
      break
    }
  }
}

function renderTagPanelExpanded() {
  if (!tagSug) return
  if (tagPanelMode !== "expanded") return

  const all = tagPoolRaw
    .map((x) => x.name)
    .filter((x) => x && !tagState.includes(x))
    .sort(sortAZThenJP)

  tagSug.innerHTML = ""

  const top = document.createElement("div")
  top.className = "uptagpanel__top"

  const title = document.createElement("div")
  title.className = "uptagpanel__title"
  title.textContent = "Tags"
  top.appendChild(title)

  const close = document.createElement("button")
  close.type = "button"
  close.className = "uptagpanel__close"
  close.textContent = "×"
  close.addEventListener("click", () => closeTagPanelAnimated(null))
  top.appendChild(close)

  tagSug.appendChild(top)

  const grid = document.createElement("div")
  grid.className = "uptaggrid"
  tagSug.appendChild(grid)

  for (const name of all) {
    const b = mkTagButton(name, 0, false)
    b.addEventListener("click", () => addTag(name))
    grid.appendChild(b)
  }
}

function initPicker() {
  if (fileInput) {
    fileInput.multiple = true
    fileInput.accept = "image/png,image/jpeg,image/webp"
    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files)
      fileInput.value = ""
    })
  }

  if (pick && fileInput) {
    pick.addEventListener("click", (e) => {
      e.preventDefault()
      fileInput.click()
    })
  }

  if (drop && fileInput) {
    drop.addEventListener("click", (e) => {
      if (e.target && e.target.closest("button")) return
      fileInput.click()
    })

    drop.addEventListener("dragover", (e) => {
      e.preventDefault()
      drop.classList.add("is-drag")
    })

    drop.addEventListener("dragleave", () => {
      drop.classList.remove("is-drag")
    })

    drop.addEventListener("drop", (e) => {
      e.preventDefault()
      drop.classList.remove("is-drag")
      addFiles(e.dataTransfer.files)
    })

    drop.addEventListener("dragstart", (e) => e.preventDefault())
  }
}

function applyVis(v) {
  const vv = String(v || "").trim()
  if (visHidden) visHidden.value = vv
  for (const b of visBtns) b.classList.toggle("is-on", String(b.dataset.vis || "") === vv)
}

function currentIsPublic() {
  const v = String(visHidden ? visHidden.value : "").toLowerCase()
  if (v === "private" || v === "0" || v === "false") return false
  return true
}

function initVis() {
  if (visBtns.length === 0) return
  for (const b of visBtns) {
    b.addEventListener("click", (e) => {
      e.preventDefault()
      applyVis(String(b.dataset.vis || "public"))
    })
  }
  const initVal = String(visHidden ? visHidden.value : "")
  if (initVal) applyVis(initVal)
  else applyVis(String(visBtns[0].dataset.vis || "public"))
}

function flip(container, action) {
  const items = Array.from(container.children).filter((x) => x && x.dataset && x.dataset.kind === "file")
  const first = new Map()
  for (const it of items) first.set(it, it.getBoundingClientRect())
  action()
  const last = new Map()
  for (const it of items) last.set(it, it.getBoundingClientRect())
  for (const it of items) {
    const a = first.get(it)
    const b = last.get(it)
    if (!a || !b) continue
    const dx = a.left - b.left
    const dy = a.top - b.top
    if (dx === 0 && dy === 0) continue
    it.style.transition = "transform 0s"
    it.style.transform = `translate(${dx}px,${dy}px)`
    requestAnimationFrame(() => {
      it.style.transition = ""
      it.style.transform = "translate(0,0)"
    })
  }
}

function phIndex() {
  if (!strip) return 0
  let idx = 0
  for (const c of Array.from(strip.children)) {
    if (c.dataset && c.dataset.kind === "ph") return idx
    if (c.dataset && c.dataset.kind === "file") idx += 1
  }
  return idx
}

function ghostCreate(url) {
  const g = document.createElement("div")
  g.className = "upghost"
  const b = document.createElement("div")
  b.className = "upghost__box"
  const img = document.createElement("img")
  img.alt = ""
  img.src = url
  img.draggable = false
  img.addEventListener("dragstart", (e) => e.preventDefault())
  b.appendChild(img)
  g.appendChild(b)
  document.body.appendChild(g)
  return g
}

function ghostMove(g, x, y) {
  if (!g) return
  g.style.transform = `translate(${x}px,${y}px)`
}

function ghostRemove(g) {
  if (!g) return
  try {
    g.remove()
  } catch (e) {}
}

function startDragFromPending(p) {
  if (!strip) return
  const idx = p.idx
  const elThumb = p.el
  if (!elThumb || !elThumb.parentElement) return
  const url = files[idx] ? files[idx].url : ""

  strip.classList.add("is-dragging")
  stopArrow()

  const ph = document.createElement("div")
  ph.className = "upthumb is-ph"
  ph.dataset.kind = "ph"
  ph.style.width = `${elThumb.getBoundingClientRect().width}px`
  ph.style.height = `${elThumb.getBoundingClientRect().height}px`

  const ghost = ghostCreate(url)
  ghostMove(ghost, p.x, p.y)

  const parent = elThumb.parentElement
  const ref = elThumb.nextSibling
  parent.removeChild(elThumb)
  if (ref) parent.insertBefore(ph, ref)
  else parent.appendChild(ph)

  dragging = { from: idx, ph, ghost, pointerId: p.pointerId }
  updateArrows()
}

function dragMove(x, y) {
  if (!dragging || !strip) return
  ghostMove(dragging.ghost, x, y)

  const nodes = Array.from(strip.children).filter((n) => n.dataset && (n.dataset.kind === "file" || n.dataset.kind === "ph"))
  const ph = dragging.ph
  const phNow = nodes.indexOf(ph)
  if (phNow < 0) return

  let target = null
  for (const n of nodes) {
    if (n === ph) continue
    const r = n.getBoundingClientRect()
    const mid = r.left + r.width / 2
    if (x < mid) {
      target = n
      break
    }
  }

  const reorder = () => {
    if (!target) strip.appendChild(ph)
    else strip.insertBefore(ph, target)
  }

  if (target) {
    const idxBefore = nodes.indexOf(target)
    if (idxBefore === phNow) return
  } else {
    if (phNow === nodes.length - 1) return
  }

  flip(strip, reorder)
}

function dragEnd() {
  if (!pendingDrag && !dragging) return

  if (pendingDrag && !dragging) {
    pendingDrag = null
    return
  }

  if (!dragging) return

  const from = dragging.from
  const to = phIndex()

  ghostRemove(dragging.ghost)

  dragging = null
  pendingDrag = null

  const cappedTo = to > files.length - 1 ? files.length - 1 : to
  if (from !== cappedTo) moveIndex(from, cappedTo)

  if (strip) strip.classList.remove("is-dragging")
  renderAll()
}

function initDragSorting() {
  if (!strip) return

  strip.addEventListener("pointerdown", (e) => {
    const t = e.target && e.target.closest ? e.target.closest(".upthumb[data-kind='file']") : null
    if (!t) return
    if (e.target && e.target.closest && e.target.closest(".upthumb__rm")) return
    const idx = Number(t.dataset.idx)
    if (!Number.isFinite(idx)) return
    e.preventDefault()
    pendingDrag = { idx, el: t, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pointerId: e.pointerId, started: false }
    if (strip.setPointerCapture) strip.setPointerCapture(e.pointerId)
  })

  strip.addEventListener("pointermove", (e) => {
    if (!pendingDrag) return
    if (pendingDrag.pointerId !== e.pointerId) return
    const dx = e.clientX - pendingDrag.sx
    const dy = e.clientY - pendingDrag.sy
    const dist = Math.hypot(dx, dy)
    pendingDrag.x = e.clientX
    pendingDrag.y = e.clientY

    if (!pendingDrag.started && dist >= 6) {
      pendingDrag.started = true
      startDragFromPending(pendingDrag)
    }
    if (pendingDrag.started) dragMove(e.clientX, e.clientY)
  })

  strip.addEventListener("pointerup", (e) => {
    if (!pendingDrag) return
    if (pendingDrag.pointerId !== e.pointerId) return
    if (strip.releasePointerCapture) {
      try {
        strip.releasePointerCapture(e.pointerId)
      } catch (e2) {}
    }
    dragEnd()
  })

  strip.addEventListener("pointercancel", (e) => {
    if (!pendingDrag) return
    if (pendingDrag.pointerId !== e.pointerId) return
    if (strip.releasePointerCapture) {
      try {
        strip.releasePointerCapture(e.pointerId)
      } catch (e2) {}
    }
    dragEnd()
  })

  strip.addEventListener("dragstart", (e) => e.preventDefault())
}

function canScroll() {
  if (!strip) return { overflow: false, canL: false, canR: false }
  const overflow = strip.scrollWidth > strip.clientWidth + 2
  const canL = strip.scrollLeft > 2
  const canR = strip.scrollLeft < strip.scrollWidth - strip.clientWidth - 2
  return { overflow, canL, canR }
}

function decideEdge(frameW) {
  if (hoverArrow) return hoverArrow
  if (!hoverInFrame || hoverX === null) return null
  if (hoverX <= EDGE_SHOW) return "l"
  if (hoverX >= frameW - EDGE_SHOW) return "r"
  return null
}

function updateArrows() {
  if (!strip || !stripFrame || !arrowL || !arrowR) return
  if (isReordering()) {
    arrowL.classList.remove("is-on")
    arrowR.classList.remove("is-on")
    return
  }

  const { overflow, canL, canR } = canScroll()
  if (!overflow) {
    arrowL.classList.remove("is-on")
    arrowR.classList.remove("is-on")
    return
  }

  const w = stripFrame.clientWidth
  const edge = decideEdge(w)

  const showL = edge === "l" && canL
  const showR = edge === "r" && canR

  arrowL.classList.toggle("is-on", showL)
  arrowR.classList.toggle("is-on", showR)
}

function stopArrowAnim() {
  if (arrowAnim) cancelAnimationFrame(arrowAnim)
  arrowAnim = null
}

function arrowLoop() {
  if (!strip || arrowDir === 0) {
    stopArrowAnim()
    return
  }
  strip.scrollLeft += arrowDir * 12
  updateArrows()
  arrowAnim = requestAnimationFrame(arrowLoop)
}

function startArrow(dir) {
  if (isReordering()) return
  arrowDir = dir
  stopArrowAnim()
  arrowAnim = requestAnimationFrame(arrowLoop)
}

function stopArrow() {
  arrowDir = 0
  stopArrowAnim()
}

function clampScrollLeft(v) {
  if (!strip) return 0
  const max = Math.max(0, strip.scrollWidth - strip.clientWidth)
  if (v < 0) return 0
  if (v > max) return max
  return v
}

function arrowJump(dir) {
  if (!strip) return
  const step = 260
  strip.scrollLeft = clampScrollLeft(strip.scrollLeft + dir * step)
  updateArrows()
}

function lockHoverArrow(side) {
  hoverArrow = side
  if (hoverLockTimer) clearTimeout(hoverLockTimer)
  hoverLockTimer = setTimeout(() => {
    hoverArrow = null
    updateArrows()
  }, 350)
}

function initArrowsAndWheel() {
  if (!strip || !stripFrame || !arrowL || !arrowR) return

  strip.addEventListener("scroll", () => updateArrows())

  stripFrame.addEventListener("mouseenter", () => {
    hoverInFrame = true
    updateArrows()
  })

  stripFrame.addEventListener("mouseleave", () => {
    hoverInFrame = false
    hoverX = null
    hoverArrow = null
    if (hoverLockTimer) clearTimeout(hoverLockTimer)
    hoverLockTimer = null
    arrowL.classList.remove("is-on")
    arrowR.classList.remove("is-on")
    stopArrow()
  })

  stripFrame.addEventListener("mousemove", (e) => {
    if (isReordering()) return
    const r = stripFrame.getBoundingClientRect()
    const x = e.clientX - r.left
    hoverX = x

    if (!hoverArrow) {
      const w = stripFrame.clientWidth
      const inL = x <= EDGE_HIDE
      const inR = x >= w - EDGE_HIDE
      if (!inL && !inR) hoverX = null
    }
    updateArrows()
  })

  const stopOnUp = () => stopArrow()
  window.addEventListener("pointerup", stopOnUp)
  window.addEventListener("pointercancel", stopOnUp)

  arrowL.addEventListener("pointerdown", (e) => {
    e.preventDefault()
    e.stopPropagation()
    lockHoverArrow("l")
    arrowJump(-1)
    startArrow(-1)
  })
  arrowR.addEventListener("pointerdown", (e) => {
    e.preventDefault()
    e.stopPropagation()
    lockHoverArrow("r")
    arrowJump(1)
    startArrow(1)
  })

  arrowL.addEventListener("pointerleave", () => {
    hoverArrow = null
    stopArrow()
    updateArrows()
  })
  arrowR.addEventListener("pointerleave", () => {
    hoverArrow = null
    stopArrow()
    updateArrows()
  })

  strip.addEventListener(
    "wheel",
    (e) => {
      if (isReordering()) return
      const { overflow } = canScroll()
      if (!overflow) return
      const dx = Math.abs(e.deltaX || 0)
      const dy = Math.abs(e.deltaY || 0)
      if (dx === 0 && dy === 0) return
      e.preventDefault()
      strip.scrollLeft = clampScrollLeft(strip.scrollLeft + (e.deltaX || 0) + (e.deltaY || 0))
      updateArrows()
    },
    { passive: false }
  )
}

function initTags() {
  if (tagAdd) {
    tagAdd.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      togglePlus()
    })
  }

  if (tagInput) {
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        addTag(tagInput.value)
        tagInput.value = ""
      }
      if (e.key === "Escape") {
        closeTagPanelAnimated(null)
      }
    })
  }

  document.addEventListener("click", (e) => {
    if (tagPanelMode !== "expanded") {
      const inPanel = e.target && e.target.closest && e.target.closest("#upTagSug")
      const inBox = e.target && e.target.closest && e.target.closest("#upTagBox")
      if (!inPanel && !inBox) closeTagPanelAnimated(null)
    }
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTagPanelAnimated(null)
  })
}

function setSubmitLoading(on) {
  if (!submitBtn) return
  if (on) {
    submitBtn.classList.add("is-loading")
    submitBtn.disabled = true
    return
  }
  submitBtn.classList.remove("is-loading")
  submitBtn.disabled = false
}

async function doUpload() {
  const title = String(titleInput ? titleInput.value : "").trim()
  if (!title) {
    showToastErr("タイトルを入力してください。", 4200)
    return
  }
  if (files.length === 0) {
    showToastErr("画像を追加してください。", 4200)
    return
  }

  const fd = new FormData()
  fd.append("title", title)
  fd.append("alt", String(altInput ? altInput.value : ""))
  fd.append("tags", tagState.join(","))
  fd.append("is_public", currentIsPublic() ? "true" : "false")
  for (const it of files) fd.append("files", it.file, it.file.name)

  setSubmitLoading(true)
  showToast("アップロード中...", 1400, null)

  try {
    const res = await fetch("/gallery/api/upload", { method: "POST", body: fd, credentials: "same-origin" })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg = String(data && data.detail ? data.detail : `upload failed status=${res.status}`)
      showToastErr(msg, 6200)
      return
    }

    const items = Array.isArray(data.items) ? data.items : []
    applyDupMarksFromItems(items)
    renderStrip()

    const dups = items.filter((x) => x && x.duplicate === true).length
    const created = items.length - dups

    if (dups > 0) {
      showToastErr(`重複画像があります (${dups}枚)。赤枠の画像は登録済みです。`, 6200)
      return
    }

    const okMsg = created > 0 ? `アップロードしました (${created}枚)` : "アップロードしました"
    showToastOk(okMsg, 1800)
    saveNavToast(okMsg, 3600)
    setTimeout(() => {
      location.href = "/gallery/"
    }, 550)
  } catch (e) {
    showToastErr(`通信に失敗しました: ${String(e)}`, 6200)
  } finally {
    setSubmitLoading(false)
  }
}

function initSubmit() {
  if (!submitBtn) return
  submitBtn.addEventListener("click", (e) => {
    e.preventDefault()
    doUpload()
  })
}

function renderAll() {
  renderCover()
  renderStrip()
  renderTags()
  updateArrows()
}

async function fetchMeOnce(url) {
  const res = await fetch(url, { method: "GET", cache: "no-store", credentials: "same-origin" })
  return res
}

async function requireLoginOrRedirect() {
  for (const url of AUTH_ME_ENDPOINTS) {
    try {
      const res = await fetchMeOnce(url)
      if (res.status === 404) continue

      if (res.status === 200) {
        const data = await res.json().catch(() => ({}))
        const user = data && data.user ? data.user : null
        const need = !!(data && data.upload_requires_login)
        if (need && !user) {
          gotoAuth()
          return false
        }
        return true
      }

      if (res.status === 401) {
        gotoAuth()
        return false
      }

      if (res.status === 403) {
        showToastErr("権限がありません。", 5200)
        setTimeout(() => { location.href = "/gallery/" }, 400)
        return false
      }

      gotoAuth()
      return false
    } catch (e) {
      continue
    }
  }
  gotoAuth()
  return false
}

function initMain() {
  if (!fileInput || !drop || !strip || !stripFrame) return
  if (!tagBox || !tagSug || !tagAdd) return

  ensureBackdrop()
  forceCloseTagUI()

  initPicker()
  initDragSorting()
  initArrowsAndWheel()
  initTags()
  initVis()
  initSubmit()

  document.addEventListener("dragstart", (e) => {
    if (e.target && e.target.closest && e.target.closest("#upStrip")) e.preventDefault()
  })

  renderAll()
  loadTagPool()
}

async function boot() {
  if (document && document.body) document.body.style.visibility = "hidden"
  const ok = await requireLoginOrRedirect()
  if (!ok) return
  if (document && document.body) document.body.style.visibility = ""
  startPresenceMonitor()
  initMain()
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot)
} else {
  boot()
}

window.addEventListener("beforeunload", () => revokeAll())