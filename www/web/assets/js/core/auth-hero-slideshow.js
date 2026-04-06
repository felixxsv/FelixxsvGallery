(function () {
  async function initAuthHeroSlideshow(options) {
    const settings = options && typeof options === "object" ? options : {}
    const containerId = typeof settings.containerId === "string" && settings.containerId.trim()
      ? settings.containerId.trim()
      : "authHeroSlides"
    const intervalMs = Number(settings.intervalMs) > 0 ? Number(settings.intervalMs) : 6000
    const container = document.getElementById(containerId)
    if (!container) return
    if (container.dataset.heroInitialized === "1") return
    container.dataset.heroInitialized = "1"

    const appBase = document.body?.dataset?.appBase || "/gallery"

    function resolveUrl(path) {
      const raw = String(path || "").trim()
      if (!raw) return ""
      if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
      if (raw.startsWith("/gallery/")) return raw
      if (raw.startsWith("/")) return `${appBase}${raw}`
      return `${appBase}/storage/${raw}`
    }

    let items = []
    try {
      const res = await fetch(`${appBase}/api/images?per_page=24&sort=latest`, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json"
        }
      })
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      items = Array.isArray(data?.items)
        ? data.items.filter((img) => img?.preview_path || img?.thumb_path_960 || img?.thumb_path_480)
        : []
    } catch (_error) {
      return
    }
    if (!items.length) return

    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[items[i], items[j]] = [items[j], items[i]]
    }

    const fragment = document.createDocumentFragment()
    items.forEach((img, index) => {
      const src = resolveUrl(img.preview_path || img.thumb_path_960 || img.thumb_path_480)
      if (!src) return

      const slide = document.createElement("div")
      slide.className = `auth-hero__slide${index === 0 ? " is-active" : ""}`

      const image = document.createElement("img")
      image.src = src
      image.alt = ""
      image.draggable = false
      image.style.objectPosition = `${img?.focal_x ?? 50}% ${img?.focal_y ?? 50}%`

      slide.appendChild(image)
      fragment.appendChild(slide)
    })

    if (!fragment.childNodes.length) return
    container.replaceChildren(fragment)

    const slides = container.querySelectorAll(".auth-hero__slide")
    if (slides.length < 2) return

    let current = 0
    window.setInterval(() => {
      slides[current].classList.remove("is-active")
      current = (current + 1) % slides.length
      slides[current].classList.add("is-active")
    }, intervalMs)
  }

  window.initAuthHeroSlideshow = initAuthHeroSlideshow
})()
