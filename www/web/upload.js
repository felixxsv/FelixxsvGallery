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
const msg = el("upMsg")

const titleInput = el("upTitle")
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
let tagPool = []
let tagPoolRaw = []
let topTagCache = null
let topTagCacheAt = 0

let pendingDrag = null
let dragging = null

let arrowAnim = null
let arrowDir = 0

let toastWrap = null
let toastBox = null
let toastTimer = null

let hoverInFrame = false
let hoverX = null
let hoverArrow = null
let hoverLockTimer = null

const EDGE_SHOW = 70
const EDGE_HIDE = 90

let tagBackdrop = null
let tagSugMode = ""

function isMobile() {
  return window.matchMedia("(max-width: 920px)").matches
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

function showToast(text, ms) {
  const s = String(text || "").trim()
  if (!s) return
  ensureToast()
  toastBox.textContent = s
  toastBox.classList.add("is-on")
  if (toastTimer) clearTimeout(toastTimer)
  const dur = Number(ms) > 0 ? Number(ms) : 3200
  toastTimer = setTimeout(() => {
    toastBox.classList.remove("is-on")
  }, dur)
}

function setMsg(s) {
  const t = String(s || "").trim()
  if (msg) msg.textContent = ""
  if (t) showToast(t, 3200)
}

function ensureTagBackdrop() {
  if (tagBackdrop) return
  tagBackdrop = document.createElement("div")
  tagBackdrop.className = "uptagbackdrop"
  tagBackdrop.addEventListener("click", () => closeTagPopover())
  document.body.appendChild(tagBackdrop)
}

function isImageFile(f) {
  const t = String(f.type || "").toLowerCase()
  if (t.startsWith("image/")) return true
  const n = String(f.name || "").toLowerCase()
  return n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp")
}

function revokeAll() {
  for (const it of files) {
    try { URL.revokeObjectURL(it.url) } catch (e) {}
  }
}

function makeUrl(f) {
  return URL.createObjectURL(f)
}

function moveIndex(from, to) {
  if (from === to) return
  const it = files.splice(from, 1)[0]
  files.splice(to, 0, it)
}

function addFiles(list) {
  const incoming = Array.from(list || []).filter(isImageFile)
  if (incoming.length === 0) {
    setMsg("画像ファイルを選択してください。")
    return
  }
  const room = MAX_FILES - files.length
  if (room <= 0) {
    setMsg(`画像は最大${MAX_FILES}枚までです。`)
    return
  }

  const adding = incoming.slice(0, room)
  for (const f of adding) files.push({ file: f, url: makeUrl(f) })

  if (incoming.length > adding.length) setMsg(`最大${MAX_FILES}枚までのため、超過分は追加しませんでした。`)
  renderAll()
}

function removeIndex(i) {
  const it = files[i]
  if (!it) return
  try { URL.revokeObjectURL(it.url) } catch (e) {}
  files.splice(i, 1)
  renderAll()
}

function setCover(i) {
  const idx = Number(i)
  if (!Number.isFinite(idx) || idx < 0 || idx >= files.length) return
  if (idx === 0) return
  moveIndex(idx, 0)
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

  const img = document.createElement("img")
  img.className = "upthumb__img"
  img.alt = ""
  img.src = it.url
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

  d.addEventListener("click", () => setCover(idx))
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
  validate()
}

function removeTag(t) {
  const i = tagState.indexOf(t)
  if (i >= 0) tagState.splice(i, 1)
  renderTags()
  validate()
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
    const res = await fetch("/gallery/api/tags?limit=200", { cache: "no-store" })
    const data = await res.json()
    const items = Array.isArray(data.items) ? data.items : []
    tagPoolRaw = items.map((x) => ({ name: String(x.name || ""), c: Number(x.c || 0) })).filter((x) => x.name)
    tagPool = tagPoolRaw.map((x) => x.name)
  } catch (e) {
    tagPoolRaw = []
    tagPool = []
  }
}

function closeTagPopover() {
  if (!tagSug) return
  tagSug.classList.remove("is-on", "is-center", "uptagsug--popover")
  tagSug.setAttribute("aria-hidden", "true")
  tagSug.innerHTML = ""
  tagSugMode = ""
  if (tagBackdrop) tagBackdrop.classList.remove("is-on")
}

function openTagPopover(mode, renderFn) {
  if (!tagSug) return
  ensureTagBackdrop()

  closeTagPopover()

  tagSugMode = mode
  tagSug.innerHTML = ""
  renderFn()

  tagSug.classList.add("is-on")
  if (isMobile()) {
    tagSug.classList.add("is-center")
    if (tagBackdrop) tagBackdrop.classList.add("is-on")
  } else {
    tagSug.classList.add("uptagsug--popover")
    if (tagBackdrop) tagBackdrop.classList.remove("is-on")
  }

  tagSug.setAttribute("aria-hidden", "false")
}

function renderPopular(items) {
  openTagPopover("popular", () => {
    const head = document.createElement("div")
    head.className = "uptagpickhead"

    const left = document.createElement("div")
    const t = document.createElement("div")
    t.className = "uptagpicktitle"
    t.textContent = "POPULAR TAGS"
    const sub = document.createElement("div")
    sub.className = "uptagpicksub"
    sub.textContent = "click to add"
    left.appendChild(t)
    left.appendChild(sub)

    head.appendChild(left)
    tagSug.appendChild(head)

    const grid = document.createElement("div")
    grid.className = "uptagpickgrid"

    for (const it of items) {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "uptagpick"
      const name = document.createElement("span")
      name.textContent = it.name
      const cnt = document.createElement("span")
      cnt.className = "uptagpickcount"
      cnt.textContent = String(it.c || 0)
      b.appendChild(name)
      b.appendChild(cnt)

      b.addEventListener("click", () => {
        addTag(it.name)
        closeTagPopover()
        if (tagInput) tagInput.focus()
      })

      grid.appendChild(b)
    }

    tagSug.appendChild(grid)
  })
}

function renderSuggest(list) {
  openTagPopover("suggest", () => {
    const head = document.createElement("div")
    head.className = "uptagpickhead"

    const left = document.createElement("div")
    const t = document.createElement("div")
    t.className = "uptagpicktitle"
    t.textContent = "SUGGEST"
    const sub = document.createElement("div")
    sub.className = "uptagpicksub"
    sub.textContent = "enter to add"
    left.appendChild(t)
    left.appendChild(sub)

    head.appendChild(left)
    tagSug.appendChild(head)

    const grid = document.createElement("div")
    grid.className = "uptagpickgrid"

    for (const name0 of list) {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "uptagpick"
      const name = document.createElement("span")
      name.textContent = name0
      b.appendChild(name)

      b.addEventListener("click", () => {
        addTag(name0)
        closeTagPopover()
        if (tagInput) {
          tagInput.value = ""
          tagInput.focus()
        }
      })

      grid.appendChild(b)
    }

    tagSug.appendChild(grid)
  })
}

function updateSuggest() {
  const q = normalizeTag(tagInput ? tagInput.value : "")
  if (!q) {
    if (tagSugMode === "suggest") closeTagPopover()
    return
  }
  const low = q.toLowerCase()
  const cand = []
  for (const t of tagPool) {
    if (cand.length >= 8) break
    if (tagState.includes(t)) continue
    if (t.toLowerCase().includes(low)) cand.push(t)
  }
  if (cand.length === 0) {
    if (tagSugMode === "suggest") closeTagPopover()
    return
  }
  renderSuggest(cand)
}

async function getTopTags8() {
  const now = Date.now()
  if (topTagCache && (now - topTagCacheAt) < 60000) return topTagCache
  try {
    const res = await fetch("/gallery/api/tags?limit=8", { cache: "no-store" })
    const data = await res.json()
    const items = Array.isArray(data.items) ? data.items : []
    const out = items
      .map((x) => ({ name: String(x.name || ""), c: Number(x.c || 0) }))
      .filter((x) => x.name)
    topTagCache = out
    topTagCacheAt = now
    return out
  } catch (e) {
    return []
  }
}

function togglePopular() {
  if (tagSugMode === "popular") {
    closeTagPopover()
    return
  }
  getTopTags8().then((items) => {
    const filtered = items.filter((x) => !tagState.includes(x.name))
    renderPopular(filtered.length ? filtered : items)
  })
}

function applyVis(v) {
  if (!visHidden) return
  visHidden.value = v
  for (const b of visBtns) b.classList.toggle("is-on", b.dataset.vis === v)
}

function validate() {
  const okFiles = files.length > 0
  const okTitle = String(titleInput ? titleInput.value : "").trim().length > 0
  if (submitBtn) submitBtn.disabled = !(okFiles && okTitle)
}

function initPicker() {
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
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files)
      fileInput.value = ""
    })
  }
}

function initTags() {
  if (tagAdd) {
    tagAdd.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      togglePopular()
    })
  }

  if (tagInput) {
    tagInput.addEventListener("input", () => {
      if (tagSugMode === "popular") closeTagPopover()
      updateSuggest()
    })
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        addTag(tagInput.value)
        tagInput.value = ""
        closeTagPopover()
      }
      if (e.key === "Escape") {
        closeTagPopover()
        tagInput.value = ""
      }
    })
  }

  document.addEventListener("click", (e) => {
    const inBox = e.target && e.target.closest && (e.target.closest("#upTagBox") || e.target.closest("#upTagSug"))
    if (!inBox) closeTagPopover()
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTagPopover()
  })
}

function initVis() {
  for (const b of visBtns) b.addEventListener("click", () => applyVis(b.dataset.vis))
}

function initSubmit() {
  if (!submitBtn) return
  submitBtn.addEventListener("click", () => {
    const title = String(titleInput ? titleInput.value : "").trim()
    if (!title) {
      setMsg("タイトルを入力してください。")
      return
    }
    if (files.length === 0) {
      setMsg("画像を追加してください。")
      return
    }
    setMsg("アップロード処理（サーバ保存）は次の工程で実装します。いまは選択・並び替え・入力まで動作します。")
  })
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
  try { g.remove() } catch (e) {}
}

function startDragFromPending(p) {
  if (!strip) return
  const idx = p.idx
  const elThumb = p.el
  if (!elThumb || !elThumb.parentElement) return
  const url = files[idx] ? files[idx].url : ""
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
    if (x < mid) { target = n; break }
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
  updateArrows()
}

function dragEnd(asClick) {
  if (!pendingDrag && !dragging) return

  if (pendingDrag && !dragging) {
    if (asClick) setCover(pendingDrag.idx)
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
    pendingDrag = { idx, el: t, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pointerId: e.pointerId, started: false }
    t.setPointerCapture(e.pointerId)
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
    const asClick = !pendingDrag.started
    dragEnd(asClick)
  })

  strip.addEventListener("pointercancel", (e) => {
    if (!pendingDrag) return
    if (pendingDrag.pointerId !== e.pointerId) return
    dragEnd(false)
  })
}

function canScroll() {
  if (!strip) return { overflow: false, canL: false, canR: false }
  const overflow = strip.scrollWidth > strip.clientWidth + 2
  const canL = strip.scrollLeft > 2
  const canR = strip.scrollLeft < (strip.scrollWidth - strip.clientWidth - 2)
  return { overflow, canL, canR }
}

function decideEdge(frameW) {
  if (hoverArrow) return hoverArrow
  if (!hoverInFrame || hoverX === null) return null
  if (hoverX <= EDGE_SHOW) return "l"
  if (hoverX >= (frameW - EDGE_SHOW)) return "r"
  return null
}

function updateArrows() {
  if (!strip || !stripFrame || !arrowL || !arrowR) return
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
  if (!strip || arrowDir === 0) { stopArrowAnim(); return }
  strip.scrollLeft += arrowDir * 12
  updateArrows()
  arrowAnim = requestAnimationFrame(arrowLoop)
}

function startArrow(dir) {
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
  strip.scrollLeft = clampScrollLeft(strip.scrollLeft + (dir * step))
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
    const r = stripFrame.getBoundingClientRect()
    const x = e.clientX - r.left
    hoverX = x

    if (!hoverArrow) {
      const w = stripFrame.clientWidth
      const inL = x <= EDGE_HIDE
      const inR = x >= (w - EDGE_HIDE)
      if (!inL && !inR) hoverX = null
    }

    updateArrows()
  })

  arrowL.addEventListener("pointerenter", () => {
    hoverArrow = "l"
    updateArrows()
    startArrow(-1)
  })
  arrowR.addEventListener("pointerenter", () => {
    hoverArrow = "r"
    updateArrows()
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

  arrowL.addEventListener("pointerdown", (e) => {
    e.preventDefault()
    e.stopPropagation()
    lockHoverArrow("l")
    arrowJump(-1)
  })
  arrowR.addEventListener("pointerdown", (e) => {
    e.preventDefault()
    e.stopPropagation()
    lockHoverArrow("r")
    arrowJump(1)
  })

  strip.addEventListener("wheel", (e) => {
    const { overflow } = canScroll()
    if (!overflow) return
    const dx = Math.abs(e.deltaX || 0)
    const dy = Math.abs(e.deltaY || 0)
    if (dx === 0 && dy === 0) return
    e.preventDefault()
    strip.scrollLeft = clampScrollLeft(strip.scrollLeft + (e.deltaX || 0) + (e.deltaY || 0))
    updateArrows()
  }, { passive: false })
}

function init() {
  initPicker()
  initTags()
  initVis()
  initSubmit()

  if (titleInput) titleInput.addEventListener("input", () => validate())

  ensureTagBackdrop()
  renderAll()

  initDragSorting()
  initArrowsAndWheel()

  loadTagPool()
}

window.addEventListener("beforeunload", () => revokeAll())

init()