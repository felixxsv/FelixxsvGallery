import { createUploadModalController } from "../../components/upload-modal.js";
import { escapeHtml } from "../../core/dom.js";
import { resolveLocalizedMessage } from "../../core/i18n.js";

function byId(id) {
  return document.getElementById(id);
}

function t(key, fallback, vars = {}) {
  return window.AdminApp?.i18n?.t?.(`admin_content.${key}`, fallback, vars) || fallback;
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
    title: item?.title || item?.alt || t("untitled", "Untitled"),
    alt: item?.alt ?? "",
    preview_url: item?.preview_url || item?.original_url || (imageId ? `/media/original/${imageId}` : ""),
    original_url: item?.original_url || item?.preview_url || (imageId ? `/media/original/${imageId}` : ""),
    posted_at: item?.posted_at || item?.created_at || item?.shot_at || null,
    shot_at: item?.shot_at || null,
    like_count: Number(item?.like_count ?? 0),
    view_count: Number(item?.view_count ?? 0),
    user: {
      display_name: uploader.display_name || uploader.user_key || t("unknown_user", "Unknown uploader"),
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

const MAX_UPLOAD_FILES = 20;

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
  expandedContentKeys: new Set(),
  pendingConfirm: null,
  filterTimer: null,
  uploadSubmitting: false,
  uploadModalController: null
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
    tbody.innerHTML = `<tr><td colspan="9" class="admin-content-table__empty">${escapeHtml(t("empty", "No content found."))}</td></tr>`;
  } else {
    for (const item of state.items) {
      const tr = document.createElement("tr");
      const contentKey = String(item.content_key || item.content_id || `i-${item.image_id}`);
      const children = Array.isArray(item.children) ? item.children : [];
      const visibleChildren = children
        .map((child, index) => ({ child, index }))
        .filter(({ child }) => Number(child.image_id || child.id || 0) !== Number(item.image_id || item.id || 0));
      const isGroup = children.length > 1 || Number(item.image_count || 0) > 1;
      const isExpanded = state.expandedContentKeys.has(contentKey);
      const preview = item.preview_url
        ? `<div class="admin-content-thumb" data-image-open="true" data-image-id="${item.image_id}" role="button" tabindex="0" aria-label="${escapeHtml(item.title || t("preview_open", "Open image"))}"><img src="${escapeHtml(item.preview_url)}" alt="${escapeHtml(item.title || t("preview_alt", "preview"))}"></div>`
        : `<div class="admin-content-thumb"><div class="admin-content-thumb__empty">${escapeHtml(t("no_image", "No Image"))}</div></div>`;
      const uploaderLabel = item.uploader?.display_name || item.uploader?.user_key || "-";
      const groupToggle = isGroup
        ? `<button type="button" class="admin-content-group-toggle" data-action="toggle-group" data-content-key="${escapeHtml(contentKey)}" aria-expanded="${isExpanded ? "true" : "false"}" aria-label="${escapeHtml(isExpanded ? t("collapse", "閉じる") : t("expand", "展開"))}"><span aria-hidden="true"></span></button>`
        : `<span class="admin-content-group-spacer" aria-hidden="true"></span>`;
      const countBadge = isGroup ? `<span class="admin-content-count-badge">${escapeHtml(t("image_count", "{count}枚", { count: Number(item.image_count || children.length || 1) }))}</span>` : "";
      const thumbCellClass = "admin-content-thumb-cell admin-content-thumb-cell--parent";
      tr.className = isGroup ? "admin-content-row admin-content-row--group" : "admin-content-row";
      tr.innerHTML = `
        <td><div class="${thumbCellClass}">${groupToggle}${preview}${countBadge}</div></td>
        <td>
          <div class="admin-content-main">
            <div class="admin-content-main__title-row">
              <div class="admin-content-main__title">${escapeHtml(item.title || t("no_title", "(Untitled)"))}</div>
            </div>
            <div class="admin-content-main__sub">${escapeHtml(uploaderLabel)}</div>
          </div>
        </td>
        <td>${escapeHtml(formatDateTime(item.shot_at))}</td>
        <td>${buildPill(item.visibility || "-", item.visibility === "public" ? "admin-content-pill--public" : "admin-content-pill--private")}</td>
        <td>${buildPill(item.status || "-", `admin-content-pill--${escapeHtml(item.status || "normal")}`)}</td>
        <td>${escapeHtml(item.like_count_text || "0")}</td>
        <td>${escapeHtml(item.view_count_text || "0")}</td>
        <td>${escapeHtml(formatDateTime(item.posted_at))}</td>
        <td>
          <div class="admin-content-actions">
            <button type="button" class="app-button app-button--ghost admin-content-mini-button" data-action="detail" data-image-id="${item.image_id}">${escapeHtml(t("detail", "Details"))}</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);

      if (isGroup && isExpanded) {
        for (const { child, index } of visibleChildren) {
          const childTr = document.createElement("tr");
          childTr.className = "admin-content-row admin-content-row--child";
          const childPreview = child.preview_url
            ? `<div class="admin-content-thumb admin-content-thumb--child" data-image-open="true" data-image-id="${child.image_id}" role="button" tabindex="0" aria-label="${escapeHtml(child.title || t("preview_open", "Open image"))}"><img src="${escapeHtml(child.preview_url)}" alt="${escapeHtml(child.title || t("preview_alt", "preview"))}"></div>`
            : `<div class="admin-content-thumb admin-content-thumb--child"><div class="admin-content-thumb__empty">${escapeHtml(t("no_image", "No Image"))}</div></div>`;
          const positionText = `${index + 1}/${children.length}`;
          childTr.innerHTML = `
            <td><div class="admin-content-thumb-cell admin-content-thumb-cell--child"><span class="admin-content-child-line" aria-hidden="true"></span>${childPreview}<span class="admin-content-count-badge admin-content-count-badge--child">${escapeHtml(positionText)}</span></div></td>
            <td></td>
            <td><div class="admin-content-child-shot">${escapeHtml(formatDateTime(child.shot_at))}</div></td>
            <td></td>
            <td>${buildPill(child.status || "-", `admin-content-pill--${escapeHtml(child.status || "normal")}`)}</td>
            <td></td>
            <td></td>
            <td></td>
            <td>
              <div class="admin-content-actions">
                <button type="button" class="app-button app-button--ghost admin-content-mini-button" data-action="detail" data-image-id="${child.image_id}">${escapeHtml(t("detail", "Details"))}</button>
              </div>
            </td>
          `;
          tbody.appendChild(childTr);
        }
      }
    }
  }

  if (summary) summary.textContent = t("total_count", "Total {count}", { count: state.total });
  if (pageInfo) pageInfo.textContent = `${state.page} / ${state.pages}`;
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= state.pages;
}

async function loadContents() {
  const tbody = byId("adminContentTableBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="admin-content-table__empty">${escapeHtml(t("loading", "Loading..."))}</td></tr>`;
  try {
    const payload = await window.AdminApp.api.get(`/api/admin/content?${qs()}`);
    state.total = Number(payload.data?.total || 0);
    state.pages = Number(payload.data?.pages || 1);
    state.page = Number(payload.data?.page || state.page);
    state.items = Array.isArray(payload.data?.items) ? payload.data.items : [];
    renderTable();
  } catch (error) {
    const message = resolveLocalizedMessage(error, t("load_error", "Failed to load content."));
    window.AdminApp?.toast?.error?.(message);
    state.items = [];
    state.total = 0;
    state.pages = 1;
    renderTable();
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="admin-content-table__empty">${escapeHtml(message)}</td></tr>`;
  }
}

async function loadContentDetail(imageId) {
  const payload = await window.AdminApp.api.get(`/api/admin/content/${imageId}`);
  const content = payload.data?.content;
  if (!content) {
    throw new Error(t("content_not_found", "Content not found."));
  }
  return content;
}

function setDetail(content) {
  state.currentContent = content;

  const preview = byId("adminContentDetailPreview");
  if (preview) {
    preview.src = content.preview_url || "";
    preview.alt = content.title || t("preview_alt", "preview");
    preview.dataset.imageId = String(content.image_id || "");
    preview.tabIndex = content.preview_url ? 0 : -1;
    preview.setAttribute("role", content.preview_url ? "button" : "img");
    preview.setAttribute("aria-label", content.preview_url ? t("preview_open", "Open image") : t("preview_alt", "preview"));
    preview.style.cursor = content.preview_url ? "zoom-in" : "";
  }

  byId("adminContentDetailName").textContent = content.title || t("no_title", "(Untitled)");
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
    visibilityButton.textContent = content.visibility === "public" ? t("make_private", "Make Private") : t("make_public", "Make Public");
  }
}

async function openDetail(imageId) {
  try {
    const content = await loadContentDetail(imageId);
    setDetail(content);
    window.AdminApp.modal.open("admin-content-detail");
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, t("detail_load_error", "Failed to load content details.")));
  }
}

function findContentItem(imageId) {
  const targetId = Number(imageId || 0);
  for (const item of state.items) {
    if (Number(item.image_id || item.id || 0) === targetId) return item;
    const child = (Array.isArray(item.children) ? item.children : []).find((row) => Number(row.image_id || row.id || 0) === targetId);
    if (child) return child;
  }
  return null;
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

function setUploadResult(message, kind = "") {
  const box = byId("adminContentUploadResult");
  if (!box) return;
  box.textContent = message || "";
  box.hidden = !message;
  box.classList.toggle("is-error", kind === "error");
  box.classList.toggle("is-success", kind === "success");
}

function renderUploadSelection() {
  const input = byId("adminContentUploadFilesInput");
  const summary = byId("adminContentUploadSummary");
  const list = byId("adminContentUploadFileList");
  const files = Array.from(input?.files || []);

  if (!summary || !list) return;

  list.innerHTML = "";
  if (files.length === 0) {
    summary.textContent = t("no_files", "No files selected.");
    list.hidden = true;
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + Number(file?.size || 0), 0);
  summary.textContent = t("selected_summary", "{count} selected / {size}", { count: files.length, size: formatBytes(totalBytes) });

  for (const file of files) {
    const li = document.createElement("li");
    li.textContent = `${file.name} (${formatBytes(file.size)})`;
    list.appendChild(li);
  }

  list.hidden = false;
}

function resetUploadForm() {
  const form = byId("adminContentUploadForm");
  if (form) form.reset();
  renderUploadSelection();
  setUploadResult("");
  setUploadSubmitting(false);
}

function setUploadSubmitting(submitting) {
  state.uploadSubmitting = Boolean(submitting);
  const submit = byId("adminContentUploadSubmitButton");
  const cancel = byId("adminContentUploadCancelButton");
  const openButton = byId("adminContentUploadOpenButton");
  if (submit) {
    submit.disabled = state.uploadSubmitting;
    submit.textContent = state.uploadSubmitting ? t("submitting", "Uploading...") : t("submit", "Upload");
  }
  if (cancel) cancel.disabled = state.uploadSubmitting;
  if (openButton) openButton.disabled = state.uploadSubmitting;
}

async function uploadWithFormData(formData) {
  const response = await fetch(`${window.AdminApp.appBase}/api/upload`, {
    method: "POST",
    credentials: "include",
    body: formData
  });

  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  }

  if (!response.ok || !payload || payload.ok === false) {
    const message = payload?.error?.message || payload?.detail || payload?.message || t("upload_error", "Upload failed.");
    throw new Error(message);
  }

  return payload;
}

function buildDuplicateMessage(items) {
  const duplicates = Array.isArray(items) ? items.filter((item) => item?.duplicate) : [];
  if (duplicates.length === 0) {
    return t("duplicate_short", "Duplicate images were detected, so nothing was uploaded.");
  }

  const lines = duplicates.slice(0, 10).map((item) => {
    const existingId = t("duplicate_existing_id", "Existing ID: {id}", { id: item?.existing_id || "-" });
    return `- ${item?.filename || t("duplicate_unnamed_file", "(Unnamed file)")} / ${existingId}`;
  });
  if (duplicates.length > 10) {
    lines.push(t("duplicate_more", "- {count} more", { count: duplicates.length - 10 }));
  }

  return [t("duplicate_short", "Duplicate images were detected, so nothing was uploaded."), ...lines].join("\n");
}

async function submitUpload() {
  if (state.uploadSubmitting) return;

  const title = byId("adminContentUploadTitleInput")?.value?.trim() || "";
  const alt = byId("adminContentUploadAltInput")?.value || "";
  const tags = byId("adminContentUploadTagsInput")?.value || "";
  const visibility = byId("adminContentUploadVisibility")?.value || "true";
  const fileInput = byId("adminContentUploadFilesInput");
  const files = Array.from(fileInput?.files || []);

  if (!title) {
    setUploadResult(t("title_required", "Enter a title."), "error");
    return;
  }
  if (files.length === 0) {
    setUploadResult(t("image_required", "Select image files."), "error");
    return;
  }
  if (files.length > MAX_UPLOAD_FILES) {
    setUploadResult(t("max_files", "You can upload up to {count} images.", { count: MAX_UPLOAD_FILES }), "error");
    return;
  }

  const formData = new FormData();
  formData.append("title", title);
  formData.append("alt", alt);
  formData.append("tags", tags);
  formData.append("is_public", visibility);
  for (const file of files) {
    formData.append("files", file);
  }

  setUploadResult("");
  setUploadSubmitting(true);

  try {
    const payload = await uploadWithFormData(formData);
    if (payload.has_duplicates) {
      setUploadResult(buildDuplicateMessage(payload.items), "error");
      window.AdminApp?.toast?.error?.(t("duplicate_short", "Duplicate images were detected, so nothing was uploaded."));
      return;
    }

    const created = Number(payload.count || files.length || 0);
    setUploadResult(t("uploaded_count", "Uploaded {count} images.", { count: created }), "success");
    window.AdminApp?.toast?.success?.(t("uploaded_count", "Uploaded {count} images.", { count: created }));
    state.page = 1;
    await loadContents();
    window.setTimeout(() => {
      window.AdminApp?.modal?.close?.("admin-content-upload");
      resetUploadForm();
    }, 300);
  } catch (error) {
    setUploadResult(error?.message || t("upload_error", "Upload failed."), "error");
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, t("upload_error", "Upload failed.")));
  } finally {
    setUploadSubmitting(false);
  }
}

async function openActionConfirm(message, approveLabel = null) {
  byId("adminContentActionConfirmMessage").textContent = message;
  byId("adminContentActionConfirmApprove").textContent = approveLabel || t("action_execute", "Confirm");
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
  let confirmText = t("action_confirm", "Do you want to continue?");
  let approveLabel = t("action_execute", "Confirm");

  if (kind === "visibility") {
    path = `/api/admin/content/${item.image_id}/visibility`;
    body = { is_public: item.visibility !== "public" };
    method = "PATCH";
    confirmText = item.visibility === "public" ? t("action_visibility_private", "Make this content private?") : t("action_visibility_public", "Make this content public?");
    approveLabel = t("action_change", "Change");
  } else if (kind === "quarantine") {
    path = `/api/admin/content/${item.image_id}/quarantine`;
    confirmText = t("action_quarantine", "Quarantine this content?");
    approveLabel = t("action_quarantine_label", "Quarantine");
  } else if (kind === "restore") {
    path = `/api/admin/content/${item.image_id}/restore`;
    confirmText = t("action_restore", "Restore this content?");
    approveLabel = t("action_restore_label", "Restore");
  } else if (kind === "delete") {
    path = `/api/admin/content/${item.image_id}/delete`;
    confirmText = t("action_delete", "Mark this content as deleted?");
    approveLabel = t("action_delete_label", "Delete");
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
    window.AdminApp?.toast?.success?.(resolveLocalizedMessage(payload.message, t("updated", "Updated.")));
    await loadContents();
  } catch (error) {
    window.AdminApp?.toast?.error?.(resolveLocalizedMessage(error, t("update_error", "Update failed.")));
  }
}

function applyStaticTranslations() {
  const setText = (id, key, fallback, vars = {}) => {
    const node = byId(id);
    if (node) node.textContent = t(key, fallback, vars);
  };
  setText("adminContentUploadOpenButton", "new_post", "New Post");
  setText("adminContentReloadButton", "reload", "Reload");
  const labels = document.querySelectorAll(".admin-content-filters .admin-field__label");
  if (labels[0]) labels[0].textContent = t("search", "Search");
  if (labels[1]) labels[1].textContent = t("visibility", "Visibility");
  if (labels[2]) labels[2].textContent = t("status", "Status");
  if (labels[3]) labels[3].textContent = t("sort", "Sort");
  const searchInput = byId("adminContentSearchInput");
  if (searchInput) searchInput.placeholder = t("search_placeholder", "Search title / ALT / tags");
  const visibility = byId("adminContentVisibilityFilter");
  if (visibility?.options[0]) visibility.options[0].text = t("all", "All");
  const status = byId("adminContentStatusFilter");
  if (status?.options[0]) status.options[0].text = t("all", "All");
  const sort = byId("adminContentSort");
  if (sort?.options[0]) sort.options[0].text = t("latest", "Latest");
  if (sort?.options[1]) sort.options[1].text = t("oldest", "Oldest");
  if (sort?.options[2]) sort.options[2].text = t("likes_desc", "Most Likes");
  if (sort?.options[3]) sort.options[3].text = t("views_desc", "Most Views");
  if (sort?.options[4]) sort.options[4].text = t("title_asc", "Title A-Z");
  const panelTitle = document.querySelector(".admin-content-panel .admin-panel__title");
  if (panelTitle) panelTitle.textContent = t("list_title", "Content List");
  const tableHead = document.querySelectorAll(".admin-content-table thead th");
  if (tableHead[0]) tableHead[0].textContent = t("image", "Image");
  if (tableHead[1]) tableHead[1].textContent = t("title_uploader", "Title / Uploader");
  if (tableHead[2]) tableHead[2].textContent = t("detail_field_shot_at", "Shot At");
  if (tableHead[3]) tableHead[3].textContent = t("public_short", "Public");
  if (tableHead[4]) tableHead[4].textContent = t("status", "Status");
  if (tableHead[5]) tableHead[5].textContent = t("likes", "Likes");
  if (tableHead[6]) tableHead[6].textContent = t("views", "Views");
  if (tableHead[7]) tableHead[7].textContent = t("posted_at", "Posted At");
  if (tableHead[8]) tableHead[8].textContent = t("action", "Action");
  setText("adminContentPrevPage", "prev", "Prev");
  setText("adminContentNextPage", "next", "Next");
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
      if (button.dataset.action === "toggle-group") {
        const key = String(button.dataset.contentKey || "");
        if (!key) return;
        if (state.expandedContentKeys.has(key)) {
          state.expandedContentKeys.delete(key);
        } else {
          state.expandedContentKeys.add(key);
        }
        renderTable();
        return;
      }
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
  byId("adminContentUploadOpenButton")?.addEventListener("click", () => {
    if (!state.uploadModalController) return;
    state.uploadModalController.open({
      onUploaded: async () => {
        state.page = 1;
        await loadContents();
      }
    });
  });
  byId("adminContentUploadCancelButton")?.addEventListener("click", () => {
    if (state.uploadSubmitting) return;
    window.AdminApp.modal.close("admin-content-upload");
    resetUploadForm();
  });
  byId("adminContentUploadFilesInput")?.addEventListener("change", () => {
    renderUploadSelection();
    setUploadResult("");
  });
  byId("adminContentUploadSubmitButton")?.addEventListener("click", () => {
    submitUpload();
  });
  byId("adminContentUploadForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitUpload();
  });
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
  applyStaticTranslations();
  window.addEventListener("gallery:language-changed", applyStaticTranslations);
  state.uploadModalController = createUploadModalController({ app: window.AdminApp, scope: "admin" });
  bindFilters();
  bindTableEvents();
  bindModals();
  renderUploadSelection();
  resetUploadForm();
  await loadContents();
}

document.addEventListener("admin:ready", () => {
  initPage();
});
