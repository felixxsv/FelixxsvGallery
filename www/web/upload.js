const el = (id) => document.getElementById(id)

const fileInput = el("fileInput")
const pickBtn = el("pickBtn")
const dropZone = el("dropZone")
const coverImg = el("coverImg")
const strip = el("strip")

const titleInput = el("titleInput")
const altInput = el("altInput")

const tagChips = el("tagChips")
const tagInput = el("tagInput")
const tagSug = el("tagSug")

const visToggle = el("visToggle")
const uploadBtn = el("uploadBtn")
const msgBox = el("msgBox")

let files = []
let coverIndex = 0

let allTags = []
let tags = []

function setMsg(s) {
  if (!msgBox) return
  msgBox.textContent = s || ""
}

function revokeAll() {
  for (const x of files) {
    try { URL.revokeObjectURL(x.url) } catch (e) {}
  }
}

function setCover(i) {
  if (!files.length) {
    if (coverImg) coverImg.removeAttribute("src")
    return
  }
  coverIndex = Math.max(0, Math.min(files.length - 1, i))
  if (coverImg) coverImg.src = files[coverIndex].url
  renderStrip()
}

function renderStrip() {
  if (!strip) return
  strip.innerHTML = ""
  files.forEach((x, i) => {
    const box = document.createElement("div")
    box.className = "upthumb" + (i === coverIndex ? " is-cover" : "")
    box.draggable = true
    box.dataset.idx = String(i)

    const img = document.createElement("img")
    img.className = "upthumb__img"
    img.src = x.url
    img.alt = ""

    const badge = document.createElement("div")
    badge.className = "upthumb__badge"
    badge.textContent = i === coverIndex ? "thumb" : String(i + 1)

    box.appendChild(img)
    box.appendChild(badge)

    box.addEventListener("click", () => setCover(i))

    box.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(i))
      e.dataTransfer.effectAllowed = "move"
    })
    box.addEventListener("dragover", (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
    })
    box.addEventListener("drop", (e) => {
      e.preventDefault()
      const from = Number(e.dataTransfer.getData("text/plain"))
      const to = i
      if (!Number.isFinite(from) || from === to) return
      const item = files.splice(from, 1)[0]
      files.splice(to, 0, item)

      if (coverIndex === from) coverIndex = to
      else if (from < coverIndex && to >= coverIndex) coverIndex -= 1
      else if (from > coverIndex && to <= coverIndex) coverIndex += 1

      renderStrip()
      setCover(coverIndex)
    })

    strip.appendChild(box)
  })
}

function addFiles(fileList) {
  const arr = Array.from(fileList || [])
  if (!arr.length) return

  const ok = []
  for (const f of arr) {
    if (!f || !f.name) continue
    if (!/^image\//.test(f.type || "") && !/\.(png|jpg|jpeg|webp)$/i.test(f.name)) continue
    if (f.size > 50 * 1024 * 1024) continue
    ok.push(f)
  }

  if (!ok.length) {
    setMsg("画像ファイルを選択してください。")
    return
  }

  const remain = Math.max(0, 30 - files.length)
  const take = ok.slice(0, remain)

  for (const f of take) {
    files.push({ file: f, url: URL.createObjectURL(f) })
  }

  if (files.length) setCover(0)
  setMsg("")
}

function clearTagsSug() {
  if (!tagSug) return
  tagSug.classList.remove("is-on")
  tagSug.setAttribute("aria-hidden", "true")
  tagSug.innerHTML = ""
}

function showTagsSug(items) {
  if (!tagSug) return
  tagSug.innerHTML = ""
  const shown = items.slice(0, 12)
  for (const t of shown) {
    const b = document.createElement("button")
    b.type = "button"
    b.textContent = t
    b.addEventListener("click", () => {
      addTag(t)
      clearTagsSug()
      if (tagInput) tagInput.focus()
    })
    tagSug.appendChild(b)
  }
  if (shown.length) {
    tagSug.classList.add("is-on")
    tagSug.setAttribute("aria-hidden", "false")
  } else {
    clearTagsSug()
  }
}

function renderTags() {
  if (!tagChips) return
  tagChips.innerHTML = ""
  for (const t of tags) {
    const chip = document.createElement("div")
    chip.className = "uptagchip"
    const s = document.createElement("span")
    s.textContent = t
    const x = document.createElement("button")
    x.type = "button"
    x.textContent = "×"
    x.addEventListener("click", () => {
      tags = tags.filter((v) => v !== t)
      renderTags()
    })
    chip.appendChild(s)
    chip.appendChild(x)
    tagChips.appendChild(chip)
  }
}

function addTag(t) {
  const v = String(t || "").trim()
  if (!v) return
  if (tags.includes(v)) return
  tags.push(v)
  renderTags()
}

async function loadAllTags() {
  try {
    const res = await fetch("/gallery/api/tags?limit=500", { cache: "no-store" })
    const data = await res.json()
    allTags = (data.items || []).map((x) => String(x.name || "")).filter((x) => x)
  } catch (e) {
    allTags = []
  }
}

function initTagInput() {
  if (!tagInput) return

  let timer = null

  tagInput.addEventListener("input", () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const q = String(tagInput.value || "").trim().toLowerCase()
      if (!q) {
        clearTagsSug()
        return
      }
      const cand = allTags
        .filter((t) => t.toLowerCase().includes(q))
        .filter((t) => !tags.includes(t))
      showTagsSug(cand)
    }, 120)
  })

  tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const v = String(tagInput.value || "").trim()
      if (v) addTag(v)
      tagInput.value = ""
      clearTagsSug()
      return
    }
    if (e.key === "Escape") {
      clearTagsSug()
    }
  })

  document.addEventListener("click", (e) => {
    const inBox = e.target.closest(".uptagbox")
    if (!inBox) clearTagsSug()
  })
}

async function doUpload() {
  const title = String(titleInput ? titleInput.value : "").trim()
  if (!title) {
    setMsg("タイトルを入力してください。")
    if (titleInput) titleInput.focus()
    return
  }
  if (!files.length) {
    setMsg("画像を選択してください。")
    return
  }

  uploadBtn.disabled = true
  setMsg("アップロード中です…")

  const fd = new FormData()
  fd.set("title", title)
  fd.set("alt", String(altInput ? altInput.value : ""))
  fd.set("visibility", visToggle && visToggle.checked ? "public" : "private")
  fd.set("cover_index", String(coverIndex))
  fd.set("tags", tags.join(","))

  files.forEach((x, i) => {
    fd.append("files", x.file, x.file.name)
    fd.append("order", String(i))
  })

  try {
    const res = await fetch("/gallery/api/upload", { method: "POST", body: fd })
    if (!res.ok) {
      const txt = await res.text()
      setMsg(`アップロードに失敗しました status=${res.status} ${txt.slice(0,120)}`)
      uploadBtn.disabled = false
      return
    }
    setMsg("アップロード完了しました。")
    uploadBtn.disabled = false
  } catch (e) {
    setMsg(`アップロードに失敗しました detail=${String(e)}`)
    uploadBtn.disabled = false
  }
}

function initDrop() {
  const pick = () => { if (fileInput) fileInput.click() }
  if (pickBtn) pickBtn.addEventListener("click", pick)
  if (dropZone) dropZone.addEventListener("click", pick)
  if (dropZone) dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter") pick() })

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files)
      fileInput.value = ""
    })
  }

  if (!dropZone) return

  dropZone.addEventListener("dragenter", (e) => {
    e.preventDefault()
    dropZone.classList.add("is-drag")
  })
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault()
    dropZone.classList.add("is-drag")
  })
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-drag")
  })
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault()
    dropZone.classList.remove("is-drag")
    addFiles(e.dataTransfer.files)
  })
}

async function init() {
  if (uploadBtn) uploadBtn.addEventListener("click", doUpload)
  initDrop()
  await loadAllTags()
  initTagInput()
  renderTags()
  renderStrip()
  setCover(0)
}

window.addEventListener("beforeunload", () => revokeAll())
init()