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

async function verifyToken(token) {
  const u = `/api/auth/register/verify?token=${encodeURIComponent(token)}`
  const res = await fetch(u, { method: "GET", cache: "no-store", credentials: "same-origin" })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function boot() {
  if (typeof window.initAuthHeroSlideshow === "function") window.initAuthHeroSlideshow()
  const token = parseParam("token")
  const next = safeNext(parseParam("next"))

  if (!token) {
    location.replace(`/auth/register/?next=${encodeURIComponent(next)}`)
    return
  }

  const { res } = await verifyToken(token)
  if (!res || !res.ok) {
    location.replace(`/auth/register/?next=${encodeURIComponent(next)}`)
    return
  }

  location.replace(`/auth/complete/?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`)
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot)
} else {
  boot()
}