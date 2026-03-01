const el = (id) => document.getElementById(id)

const drop = el("upDrop")
const pick = el("upPick")
const fileInput = el("upFile")
const strip = el("upStrip")
const coverImg = el("upCover")
const coverPh = el("upCoverPh")
const msg = el("upMsg")

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
const MIN_PLACEHOLDERS = 5

let files = []
let tagState = []
let allTags = []

function setMsg(s) {
  if (!msg) return
  msg.textContent = s || ""
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
  for (const f of adding) {
    files.push({ file: f, url: makeUrl(f) })
  }

  if (incoming.length > adding.length) setMsg(`最大${MAX_FILES}枚までのため、超過分は追加しませんでした。`)
  else setMsg("")

  renderAll()
}

function moveIndex(from, to) {
  if (from === to) return
  const it = files.splice(from, 1)[0]
  files.splice(to, 0, it)
}

function removeIndex(i) {
  const it = files[i]
  if (!it) return
  try { URL.revokeObjectURL(it.url) } catch (e) {}
  files.splice(i, 1)
  renderAll()
}

function setCover(i) {
  if (i <= 0) return
  moveIndex(i, 0)
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
  d.draggable = true
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

  d.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", String(idx))
    e.dataTransfer.effectAllowed = "move"
  })

  d.addEventListener("dragover", (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  })

  d.addEventListener("drop", (e) => {
    e.preventDefault()
    const from = Number(e.dataTransfer.getData("text/plain"))
    const to = Number(d.dataset.idx)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return
    if (from < 0 || to < 0 || from >= files.length || to >= files.length) return
    moveIndex(from, to)
    renderAll()
  })

  return d
}

function mkEmptyThumb() {
  const d = document.createElement("div")
  d.className = "upthumb is-empty"
  return d
}

function renderStrip() {
  if (!strip) return
  strip.innerHTML = ""
  for (let i = 0; i < files.length; i++) strip.appendChild(mkThumb(files[i], i))
  const need = Math.max(0, MIN_PLACEHOLDERS - files.length)
  for (let i = 0; i < need; i++) strip.appendChild(mkEmptyThumb())
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
}

function removeTag(t) {
  const i = tagState.indexOf(t)
  if (i >= 0) tagState.splice(i, 1)
  renderTags()
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
    allTags = items.map((x) => String(x.name || "")).filter((x) => x)
  } catch (e) {
    allTags = []
  }
}

function closeSug() {
  if (!tagSug) return
  tagSug.classList.remove("is-on")
  tagSug.setAttribute("aria-hidden", "true")
  tagSug.innerHTML = ""
}

function openSug(list) {
  if (!tagSug) return
  tagSug.innerHTML = ""
  for (const t of list) {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = t
    b.addEventListener("click", () => {
      addTag(t)
      if (tagInput) tagInput.value = ""
      closeSug()
      if (tagInput) tagInput.focus()
    })
    tagSug.appendChild(b)
  }
  tagSug.classList.add("is-on")
  tagSug.setAttribute("aria-hidden", "false")
}

function updateSug() {
  const q = normalizeTag(tagInput ? tagInput.value : "")
  if (!q) {
    closeSug()
    return
  }
  const low = q.toLowerCase()
  const cand = []
  for (const t of allTags) {
    if (cand.length >= 8) break
    if (tagState.includes(t)) continue
    if (t.toLowerCase().includes(low)) cand.push(t)
  }
  if (cand.length === 0) closeSug()
  else openSug(cand)
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

function renderAll() {
  renderCover()
  renderStrip()
  renderTags()
  validate()
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
    tagAdd.addEventListener("click", () => {
      addTag(tagInput ? tagInput.value : "")
      if (tagInput) tagInput.value = ""
      closeSug()
      validate()
    })
  }

  if (tagInput) {
    tagInput.addEventListener("input", () => updateSug())
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        addTag(tagInput.value)
        tagInput.value = ""
        closeSug()
      }
      if (e.key === "Escape") {
        closeSug()
        tagInput.value = ""
      }
    })
  }

  document.addEventListener("click", (e) => {
    const inBox = e.target && e.target.closest && e.target.closest("#upTagBox")
    if (!inBox) closeSug()
  })
}

function initVis() {
  for (const b of visBtns) {
    b.addEventListener("click", () => applyVis(b.dataset.vis))
  }
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

function init() {
  initPicker()
  initTags()
  initVis()
  initSubmit()

  if (titleInput) titleInput.addEventListener("input", () => validate())
  renderAll()

  loadTagPool()
}

window.addEventListener("beforeunload", () => revokeAll())

init()