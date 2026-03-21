function byId(id) {
  return document.getElementById(id);
}

function showClock(mode) {
  const digital = byId("adminDashboardClockDigital");
  const analog = byId("adminDashboardClockAnalog");
  if (digital) digital.hidden = mode !== "digital";
  if (analog) analog.hidden = mode !== "analog";
}

function formatElapsed(sec) {
  const total = Math.max(0, Number(sec) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}時間 ${minutes}分`;
  if (minutes > 0) return `${minutes}分 ${seconds}秒`;
  return `${seconds}秒`;
}

function formatStorage(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1).replace(".0", "")} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 ** 2)).toFixed(1).replace(".0", "")} MB`;
  if (n < 1024 ** 4) return `${(n / (1024 ** 3)).toFixed(1).replace(".0", "")} GB`;
  return `${(n / (1024 ** 4)).toFixed(1).replace(".0", "")} TB`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ja-JP");
}

function updateDigitalClock() {
  const el = byId("adminDashboardClockDigital");
  if (!el || el.hidden) return;
  const now = new Date();
  const text = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const date = now.toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const timeEl = el.querySelector("[data-clock-time]");
  const dateEl = el.querySelector("[data-clock-date]");
  if (timeEl) timeEl.textContent = text;
  if (dateEl) dateEl.textContent = date;
}

function updateAnalogClock() {
  const root = byId("adminDashboardClockAnalog");
  if (!root || root.hidden) return;
  const now = new Date();
  const sec = now.getSeconds();
  const min = now.getMinutes();
  const hour = now.getHours() % 12;
  const hourDeg = hour * 30 + min * 0.5;
  const minDeg = min * 6 + sec * 0.1;
  const secDeg = sec * 6;
  const hourHand = root.querySelector("[data-clock-hand='hour']");
  const minHand = root.querySelector("[data-clock-hand='minute']");
  const secHand = root.querySelector("[data-clock-hand='second']");
  if (hourHand) hourHand.style.transform = `translateX(-50%) rotate(${hourDeg}deg)`;
  if (minHand) minHand.style.transform = `translateX(-50%) rotate(${minDeg}deg)`;
  if (secHand) secHand.style.transform = `translateX(-50%) rotate(${secDeg}deg)`;
}

function startClockLoop() {
  updateDigitalClock();
  updateAnalogClock();
  window.setInterval(() => {
    updateDigitalClock();
    updateAnalogClock();
  }, 1000);
}

function renderStats(stats) {
  const refs = {
    online: byId("adminStatOnlineUsers"),
    upload: byId("adminStatTodayUploads"),
    publicCount: byId("adminStatPublicCount"),
    privateCount: byId("adminStatPrivateCount"),
    quarantine: byId("adminStatQuarantineCount"),
    storageUsed: byId("adminStatStorageUsed"),
    storageTotal: byId("adminStatStorageTotal"),
  };
  if (refs.online) refs.online.textContent = String(stats.online_user_count ?? 0);
  if (refs.upload) refs.upload.textContent = String(stats.today_upload_count ?? 0);
  if (refs.publicCount) refs.publicCount.textContent = String(stats.public_count ?? 0);
  if (refs.privateCount) refs.privateCount.textContent = String(stats.private_count ?? 0);
  if (refs.quarantine) refs.quarantine.textContent = String(stats.quarantine_count ?? 0);
  if (refs.storageUsed) refs.storageUsed.textContent = formatStorage(stats.storage_used_bytes);
  if (refs.storageTotal) refs.storageTotal.textContent = formatStorage(stats.storage_total_bytes);
}

function renderActiveUsers(items) {
  const container = byId("adminDashboardActiveUsers");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = "現在アクセス中のユーザーはいません。";
    container.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "admin-active-user";
    const avatar = item.avatar_url
      ? `<img src="${item.avatar_url}" alt="">`
      : `${(item.display_name || "?").slice(0, 1)}`;
    row.innerHTML = `
      <div class="admin-active-user__avatar">${avatar}</div>
      <div class="admin-active-user__meta">
        <strong>${item.display_name || "-"}</strong>
        <div>@${item.user_key || "-"}</div>
      </div>
      <div class="admin-active-user__elapsed">
        <div>セッション時間</div>
        <strong>${formatElapsed(item.session_elapsed_sec)}</strong>
      </div>
    `;
    container.appendChild(row);
  }
}

function renderAuditLogs(items) {
  const container = byId("adminDashboardRecentLogs");
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = "直近の操作ログはありません。";
    container.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "admin-log-item";
    row.innerHTML = `
      <div class="admin-log-item__meta">${item.action_type || "-"} ・ ${formatDateTime(item.created_at)}</div>
      <div class="admin-log-item__summary">${item.summary || "-"}</div>
      <div class="admin-log-item__actor">${item.actor?.display_name || "system"} / ${item.result || "-"}</div>
    `;
    container.appendChild(row);
  }
}

let latestImageItem = null;

function buildDashboardDetail(item) {
  return {
    image_id: item.image_id || item.id || null,
    title: item.title || "タイトル未設定",
    alt: item.alt || "",
    posted_at: item.posted_at || null,
    shot_at: item.shot_at || null,
    like_count: Number(item.like_count || 0),
    view_count: Number(item.view_count || 0),
    user: item.user || {
      display_name: item.uploader_display_name || "投稿者不明",
      user_key: item.uploader_user_key || "-",
      avatar_url: item.uploader_avatar_url || item.uploader_avatar_path || "",
    },
    tags: Array.isArray(item.tags) ? item.tags : [],
    color_tags: Array.isArray(item.color_tags) ? item.color_tags : [],
    file_size_bytes: item.file_size_bytes ?? null,
    image_width: item.image_width ?? item.width ?? null,
    image_height: item.image_height ?? item.height ?? null,
    admin_meta: item.admin_meta || {},
  };
}

async function loadAdminContentDetail(imageId) {
  const app = window.AdminApp;
  const payload = await app.api.get(`/api/admin/content/${imageId}`);
  const content = payload.data?.content || {};
  return buildDashboardDetail(content);
}

function renderLatestImage(item) {
  latestImageItem = item || null;
  const card = byId("adminDashboardLatestImageCard");
  const image = byId("adminDashboardLatestImage");
  const title = byId("adminDashboardLatestImageTitle");
  const meta = byId("adminDashboardLatestImageMeta");
  const stats = byId("adminDashboardLatestImageStats");
  const placeholder = byId("adminDashboardLatestImagePlaceholder");
  if (!card || !image || !title || !meta || !stats || !placeholder) return;

  if (!item || !item.preview_url) {
    card.hidden = true;
    placeholder.hidden = false;
    return;
  }

  image.src = item.preview_url;
  image.alt = item.title || "latest image";
  title.textContent = item.title || "タイトル未設定";
  meta.textContent = `${formatDateTime(item.posted_at)} ・ ${item.user?.display_name || "投稿者不明"}`;
  stats.textContent = `♥ ${item.like_count_short || "0"} ・ ${item.view_count_short || "0"}`;
  card.hidden = false;
  placeholder.hidden = true;
}

async function saveClockMode(mode) {
  const app = window.AdminApp;
  const response = await fetch(`${app.appBase}/api/admin/dashboard/preferences`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clock_mode: mode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload?.error?.message || "時計設定の更新に失敗しました。");
  }
  return payload;
}

async function loadDashboard() {
  const app = window.AdminApp;
  const payload = await app.api.get("/api/admin/dashboard");
  const data = payload.data || {};
  renderStats({
    online_user_count: data.online_user_count ?? 0,
    ...(data.stats || {}),
  });
  renderActiveUsers(data.active_users || []);
  renderAuditLogs(data.recent_audit_logs || []);
  renderLatestImage(data.latest_image || null);

  const mode = data.clock_mode === "analog" ? "analog" : "digital";
  const digitalBtn = byId("adminClockModeDigital");
  const analogBtn = byId("adminClockModeAnalog");
  if (digitalBtn) digitalBtn.classList.toggle("is-active", mode === "digital");
  if (analogBtn) analogBtn.classList.toggle("is-active", mode === "analog");
  showClock(mode);
  updateDigitalClock();
  updateAnalogClock();
}

function bindClockButtons() {
  const digitalBtn = byId("adminClockModeDigital");
  const analogBtn = byId("adminClockModeAnalog");

  if (digitalBtn) {
    digitalBtn.addEventListener("click", async () => {
      try {
        await saveClockMode("digital");
        digitalBtn.classList.add("is-active");
        analogBtn?.classList.remove("is-active");
        showClock("digital");
      } catch (error) {
        window.AdminApp?.toast?.error?.(error?.message || "時計表示の切り替えに失敗しました。");
      }
    });
  }

  if (analogBtn) {
    analogBtn.addEventListener("click", async () => {
      try {
        await saveClockMode("analog");
        analogBtn.classList.add("is-active");
        digitalBtn?.classList.remove("is-active");
        showClock("analog");
      } catch (error) {
        window.AdminApp?.toast?.error?.(error?.message || "時計表示の切り替えに失敗しました。");
      }
    });
  }
}

function bindLatestImage() {
  const card = byId("adminDashboardLatestImageCard");
  if (!card) return;

  card.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!latestImageItem || !window.AdminApp?.imageModal) return;
    const imageId = latestImageItem.image_id || latestImageItem.id;
    window.AdminApp.imageModal.openByPreference(
      {
        ...latestImageItem,
        original_url: latestImageItem.original_url || latestImageItem.preview_url,
      },
      {
        detailLoader: async () => loadAdminContentDetail(imageId),
      },
    );
  });
}

async function initDashboard() {
  if (!window.AdminApp || !window.AdminApp.ready) return;
  bindClockButtons();
  bindLatestImage();
  startClockLoop();
  try {
    await loadDashboard();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "ダッシュボードの取得に失敗しました。");
  }
}

if (window.AdminApp?.ready) {
  initDashboard();
} else {
  document.addEventListener("admin:ready", () => {
    initDashboard();
  }, { once: true });
}