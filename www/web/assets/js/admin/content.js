function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ja-JP");
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx === 0 ? 0 : 1).replace(/\.0$/, "")} ${units[idx]}`;
}

function buildPill(text, mod) {
  return `<span class="admin-content-pill ${mod}">${escapeHtml(text)}</span>`;
}

function buildImageModalPayload(item) {
  const imageId = Number(item?.image_id || item?.id || 0);
  const uploader = item?.uploader || item?.user || {};
  return {
    image_id: imageId || item?.image_id || item?.id || null,
    title: item?.title || item?.alt || "タイトル未設定",
    alt: item?.alt || item?.title || "",
    preview_url: item?.preview_url || item?.original_url || (imageId ? `/media/original/${imageId}` : ""),
    original_url: item?.original_url || item?.preview_url || (imageId ? `/media/original/${imageId}` : ""),
    posted_at: item?.posted_at || item?.created_at || item?.shot_at || null,
    shot_at: item?.shot_at || null,
    like_count: Number(item?.like_count ?? 0),
    view_count: Number(item?.view_count ?? 0),
    user: {
      display_name: uploader.display_name || uploader.user_key || "投稿者不明",
      user_key: uploader.user_key || "-",
      avatar_url: uploader.avatar_url || uploader.avatar_path || ""
    },
    tags: Array.isArray(item?.tags) ? item.tags : [],
    color_tags: Array.isArray(item?.color_tags) ? item.color_tags : [],
    file_size_bytes: item?.file_size_bytes ?? null,
    image_width: item?.image_width ?? item?.width ?? null,
    image_height: item?.image_height ?? item?.height ?? null,
    admin_meta: item?.admin_meta || {}
  };
}

const state = {
  page: 1,
  perPage: 20,
  q: "",
  visibility: "",
  status: "",
  sort: "posted_desc",
  total: 0,
  pages: 1,
  items: [],
  currentContent: null,
  pendingConfirm: null,
  filterTimer: null
};

function qs() {
  const params = new URLSearchParams();
  params.set("page", String(state.page));
  params.set("per_page", String(state.perPage));
  params.set("sort", state.sort || "posted_desc");
  if (state.q) params.set("q", state.q);
  if (state.visibility) params.set("visibility", state.visibility);
  if (state.status) params.set("status", state.status);
  return params.toString();
}

function renderTable() {
  const tbody = byId("adminContentTableBody");
  const summary = byId("adminContentSummary");
  const pageInfo = byId("adminContentPageInfo");
  const prev = byId("adminContentPrevPage");
  const next = byId("adminContentNextPage");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!Array.isArray(state.items) || state.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-content-table__empty">該当するコンテンツがありません。</td></tr>`;
  } else {
    for (const item of state.items) {
      const tr = document.createElement("tr");
      const preview = item.preview_url
        ? `<div class="admin-content-thumb" data-image-open="true" data-image-id="${item.image_id}" role="button" tabindex="0" aria-label="${escapeHtml(item.title || "画像を開く")}"><img src="${escapeHtml(item.preview_url)}" alt="${escapeHtml(item.title || "preview")}"></div>`
        : `<div class="admin-content-thumb"><div class="admin-content-thumb__empty">NO IMAGE</div></div>`;
      const uploaderLabel = item.uploader?.display_name || item.uploader?.user_key || "-";
      tr.innerHTML = `
        <td>${preview}</td>
        <td>
          <div class="admin-content-main">
            <div class="admin-content-main__title">${escapeHtml(item.title || "(無題)")}</div>
            <div class="admin-content-main__sub">${escapeHtml(uploaderLabel)} ・ ${escapeHtml(formatDateTime(item.posted_at))}</div>
          </div>
        </td>
        <td>${buildPill(item.visibility || "-", item.visibility === "public" ? "admin-content-pill--public" : "admin-content-pill--private")}</td>
        <td>${buildPill(item.status || "-", `admin-content-pill--${escapeHtml(item.status || "normal")}`)}</td>
        <td>${escapeHtml(item.like_count_text || "0")}</td>
        <td>${escapeHtml(item.view_count_text || "0")}</td>
        <td>${escapeHtml(formatDateTime(item.posted_at))}</td>
        <td>
          <div class="admin-content-actions">
            <button type="button" class="app-button app-button--ghost admin-content-mini-button" data-action="detail" data-image-id="${item.image_id}">詳細</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  if (summary) summary.textContent = `合計 ${state.total} 件`;
  if (pageInfo) pageInfo.textContent = `${state.page} / ${state.pages}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}

async function loadContents() {
  const tbody = byId("adminContentTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="admin-content-table__empty">読み込み中です。</td></tr>`;
  try {
    const payload = await window.AdminApp.api.get(`/api/admin/content?${qs()}`);
    state.total = Number(payload.data?.total || 0);
    state.pages = Number(payload.data?.pages || 1);
    state.page = Number(payload.data?.page || state.page);
    state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
    renderTable();
  } catch (error) {
    const message = error?.message || "コンテンツ一覧の取得に失敗しました。";
    window.AdminApp?.toast?.error?.(message);
    state.items = [];
    state.total = 0;
    state.pages = 1;
    renderTable();
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="admin-content-table__empty">${escapeHtml(message)}</td></tr>`;
  }
}

async function loadContentDetail(imageId) {
  const payload = await window.AdminApp.api.get(`/api/admin/content/${imageId}`);
  const content = payload.data?.content;
  if (!content) {
    throw new Error("対象コンテンツが見つかりません。");
  }
  return content;
}

function setDetail(content) {
  state.currentContent = content;

  const preview = byId("adminContentDetailPreview");
  if (preview) {
    preview.src = content.preview_url || "";
    preview.alt = content.title || "preview";
    preview.dataset.imageId = String(content.image_id || "");
    preview.tabIndex = content.preview_url ? 0 : -1;
    preview.setAttribute("role", content.preview_url ? "button" : "img");
    preview.setAttribute("aria-label", content.preview_url ? "画像を開く" : "preview");
    preview.style.cursor = content.preview_url ? "zoom-in" : "";
  }

  byId("adminContentDetailName").textContent = content.title || "(無題)";
  byId("adminContentDetailSubline").textContent = `${content.uploader?.display_name || content.uploader?.user_key || "-"} ・ ${formatDateTime(content.posted_at)}`;
  byId("adminContentDetailFieldTitle").textContent = content.title || "-";
  byId("adminContentDetailFieldAlt").textContent = content.alt || "-";
  byId("adminContentDetailFieldTags").textContent = Array.isArray(content.tags) && content.tags.length ? content.tags.join(", ") : "-";
  byId("adminContentDetailFieldPostedAt").textContent = formatDateTime(content.posted_at);
  byId("adminContentDetailFieldShotAt").textContent = formatDateTime(content.shot_at);
  byId("adminContentDetailFieldFileSize").textContent = formatBytes(content.file_size_bytes);
  byId("adminContentDetailFieldDimensions").textContent = content.image_width && content.image_height ? `${content.image_width} × ${content.image_height}` : "-";
  byId("adminContentDetailFieldLikes").textContent = String(content.like_count ?? 0);
  byId("adminContentDetailFieldViews").textContent = String(content.view_count ?? 0);
  byId("adminContentDetailFieldColors").textContent = Array.isArray(content.color_tags) && content.color_tags.length ? content.color_tags.map((item) => item.label || `Color ${item.color_id}`).join(", ") : "-";
  byId("adminContentDetailFieldVisibility").textContent = content.visibility || "-";
  byId("adminContentDetailFieldStatus").textContent = content.status || "-";
  byId("adminContentDetailFieldFileName").textContent = content.admin_meta?.file_name || "-";

  const visibilityButton = byId("adminContentVisibilityButton");
  if (visibilityButton) {
    visibilityButton.textContent = content.visibility === "public" ? "非公開にする" : "公開にする";
  }
}

async function openDetail(imageId) {
  try {
    const content = await loadContentDetail(imageId);
    setDetail(content);
    window.AdminApp.modal.open("admin-content-detail");
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "コンテンツ詳細の取得に失敗しました。");
  }
}

function findContentItem(imageId) {
  return state.items.find((item) => Number(item.image_id || item.id || 0) === Number(imageId || 0)) || null;
}

function openImageModal(item) {
  const app = window.AdminApp;
  const imageId = Number(item?.image_id || item?.id || 0);
  if (!app?.imageModal || !imageId) return;

  app.imageModal.openByPreference(
    buildImageModalPayload(item),
    {
      detailLoader: async () => buildImageModalPayload(await loadContentDetail(imageId))
    }
  );
}

async function openActionConfirm(message, approveLabel = "実行") {
  byId("adminContentActionConfirmMessage").textContent = message;
  byId("adminContentActionConfirmApprove").textContent = approveLabel;
  window.AdminApp.modal.open("admin-content-action-confirm");
  return new Promise((resolve) => {
    state.pendingConfirm = resolve;
  });
}

function closeActionConfirm(result) {
  const resolver = state.pendingConfirm;
  state.pendingConfirm = null;
  window.AdminApp.modal.close("admin-content-action-confirm");
  if (typeof resolver === "function") resolver(Boolean(result));
}

async function applyAction(kind) {
  const item = state.currentContent;
  if (!item) return;

  let path = null;
  let body = undefined;
  let method = "POST";
  let confirmText = "この操作を実行しますか？";
  let approveLabel = "実行";

  if (kind === "visibility") {
    path = `/api/admin/content/${item.image_id}/visibility`;
    body = { is_public: item.visibility !== "public" };
    method = "PATCH";
    confirmText = item.visibility === "public" ? "このコンテンツを非公開にしますか？" : "このコンテンツを公開しますか？";
    approveLabel = "変更";
  } else if (kind === "quarantine") {
    path = `/api/admin/content/${item.image_id}/quarantine`;
    confirmText = "このコンテンツを隔離しますか？";
    approveLabel = "隔離";
  } else if (kind === "restore") {
    path = `/api/admin/content/${item.image_id}/restore`;
    confirmText = "このコンテンツを復元しますか？";
    approveLabel = "復元";
  } else if (kind === "delete") {
    path = `/api/admin/content/${item.image_id}/delete`;
    confirmText = "このコンテンツを削除状態にしますか？";
    approveLabel = "削除";
  }

  const ok = await openActionConfirm(confirmText, approveLabel);
  if (!ok || !path) return;

  try {
    let payload;
    if (method === "PATCH") {
      payload = await window.AdminApp.api.patch(path, body);
    } else {
      payload = await window.AdminApp.api.post(path, {});
    }
    const content = payload.data?.content;
    if (content) {
      setDetail(content);
    }
    window.AdminApp?.toast?.success?.(payload.message || "更新しました。");
    await loadContents();
  } catch (error) {
    window.AdminApp?.toast?.error?.(error?.message || "更新に失敗しました。");
  }
}

function bindFilters() {
  const trigger = () => {
    state.page = 1;
    state.q = byId("adminContentSearchInput")?.value?.trim() || "";
    state.visibility = byId("adminContentVisibilityFilter")?.value || "";
    state.status = byId("adminContentStatusFilter")?.value || "";
    state.sort = byId("adminContentSort")?.value || "posted_desc";
    loadContents();
  };

  byId("adminContentSearchInput")?.addEventListener("input", () => {
    window.clearTimeout(state.filterTimer);
    state.filterTimer = window.setTimeout(trigger, 250);
  });
  byId("adminContentVisibilityFilter")?.addEventListener("change", trigger);
  byId("adminContentStatusFilter")?.addEventListener("change", trigger);
  byId("adminContentSort")?.addEventListener("change", trigger);
  byId("adminContentReloadButton")?.addEventListener("click", () => loadContents());
  byId("adminContentPrevPage")?.addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadContents();
  });
  byId("adminContentNextPage")?.addEventListener("click", () => {
    if (state.page >= state.pages) return;
    state.page += 1;
    loadContents();
  });
}

function bindTableEvents() {
  const tbody = byId("adminContentTableBody");
  if (!tbody) return;

  tbody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) {
      const imageId = Number(button.dataset.imageId || 0);
      if (!imageId) return;
      if (button.dataset.action === "detail") {
        openDetail(imageId);
      }
      return;
    }

    const imageTarget = event.target.closest("[data-image-open='true']");
    if (!imageTarget) return;
    const imageId = Number(imageTarget.dataset.imageId || 0);
    const item = findContentItem(imageId);
    if (!item) return;
    openImageModal(item);
  });

  tbody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const imageTarget = event.target.closest("[data-image-open='true']");
    if (!imageTarget) return;
    event.preventDefault();
    const imageId = Number(imageTarget.dataset.imageId || 0);
    const item = findContentItem(imageId);
    if (!item) return;
    openImageModal(item);
  });
}

function bindModals() {
  byId("adminContentDetailCloseButton")?.addEventListener("click", () => {
    window.AdminApp.modal.close("admin-content-detail");
    state.currentContent = null;
  });
  byId("adminContentActionConfirmApprove")?.addEventListener("click", () => closeActionConfirm(true));
  byId("adminContentActionConfirmCancel")?.addEventListener("click", () => closeActionConfirm(false));
  byId("adminContentVisibilityButton")?.addEventListener("click", () => applyAction("visibility"));
  byId("adminContentQuarantineButton")?.addEventListener("click", () => applyAction("quarantine"));
  byId("adminContentRestoreButton")?.addEventListener("click", () => applyAction("restore"));
  byId("adminContentDeleteButton")?.addEventListener("click", () => applyAction("delete"));
  byId("adminContentDetailPreview")?.addEventListener("click", () => {
    if (!state.currentContent?.preview_url) return;
    openImageModal(state.currentContent);
  });
  byId("adminContentDetailPreview")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!state.currentContent?.preview_url) return;
    event.preventDefault();
    openImageModal(state.currentContent);
  });
}

async function initPage() {
  bindFilters();
  bindTableEvents();
  bindModals();
  await loadContents();
}

document.addEventListener("admin:ready", () => {
  initPage();
});