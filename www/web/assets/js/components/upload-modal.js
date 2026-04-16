import { createElement, escapeHtml } from "../core/dom.js";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;
const TITLE_MAX = 100;
const ACCEPTED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MODAL_ID = "upload-modal";
const TAG_BROWSE_MODAL_ID = "tag-browse-modal";
const DRAFT_KEY = "gallery.upload.draft.v1"; // legacy (migration only)
const DRAFTS_KEY = "gallery.upload.drafts.v1";
const MAX_DRAFTS = 10;
const DRAFT_LIST_MODAL_ID = "draft-list-modal";
const TAG_QUICK_LIMIT = 10;

function t(app, key, fallback, vars = {}) {
  return app?.i18n?.t?.(`upload.${key}`, fallback, vars) || fallback;
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, idx)) +
    `<mark class="upload-modal__sug-mark">${escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
    escapeHtml(text.slice(idx + query.length))
  );
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = n;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1).replace(/\.0$/, "")} ${units[index]}`;
}

function buildAuthUrl(appBase) {
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `${appBase}/auth/?next=${encodeURIComponent(next)}`;
}

function extractExtension(filename) {
  return String(filename || "").split(".").pop()?.toLowerCase() || "";
}

function parseVRChatShotAt(filename) {
  const base = String(filename || "").split("/").pop()?.split("\\").pop() || "";
  const match = base.match(/^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const [, y, mo, d, hh, mm, ss] = match;
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}`;
}

async function computeFileHash(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function normalizeTag(str) {
  return String(str || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function createUploadModalController({ app, scope = "public" } = {}) {
  const state = {
    mounted: false,
    items: [],
    uploading: false,
    dragIndex: -1,
    shotAtAutoValue: "",
    shotAtDirty: false,
    onUploaded: null,
    tagState: [],
    tagPool: [],
    tagSugOpen: false,
    tagSugMode: "input",
    tagBrowseMounted: false,
    tagBrowseQuery: "",
    focalX: 50,
    focalY: 50,
    focalZoom: 1.0,
    focalDragging: false,
    focalDragStartX: 0,
    focalDragStartY: 0,
    focalDragStartFX: 50,
    focalDragStartFY: 50,
    lastSavedDraft: null,
    formDirty: false,
    draftListMounted: false,
    stripDragActive: false,
    stripDragIndex: -1,
    stripInsertIndex: -1,
    stripPointerId: -1,
    stripDragOffsetX: 0,
    stripDragOffsetY: 0,
    stripDragGhost: null,
    languageBound: false,
    mobileMedia: window.matchMedia("(max-width: 720px)")
  };

  const refs = {};

  function root() {
    return document.getElementById("appModalRoot");
  }

  function ensureMounted() {
    if (state.mounted) return;
    const modalRoot = root();
    if (!modalRoot) {
      throw new Error("appModalRoot is missing.");
    }

    if (!modalRoot.querySelector(`[data-modal-id="${MODAL_ID}"]`)) {
      const layer = createElement("section", {
        className: "app-modal-layer",
        attributes: {
          "data-modal-layer": true,
          "data-modal-id": MODAL_ID,
          hidden: true
        },
        html: `
          <div class="app-modal-backdrop" data-modal-backdrop="${MODAL_ID}"></div>
          <div class="app-modal-dialog app-modal-dialog--upload" role="dialog" aria-modal="true" aria-labelledby="uploadModalTitle" tabindex="-1">
            <div class="app-modal-header">
              <h2 id="uploadModalTitle" class="app-modal-title">${escapeHtml(t(app, "title", "Upload Images"))}</h2>
            </div>
            <div class="app-modal-body upload-modal">
              <div class="upload-modal__layout">

                <!-- 上段: サムネイル + 画像追加 (1:1) -->
                <div class="upload-modal__top">
                  <div class="upload-modal__thumb-col">
                    <div class="upload-modal__field-label">${escapeHtml(t(app, "thumbnail_label", "Thumbnail / Focus"))}</div>
                    <div class="upload-modal__thumbnail-wrap" id="uploadModalThumbnailWrap">
                      <img id="uploadModalThumbnailImage" class="upload-modal__thumbnail-image" alt="${escapeHtml(t(app, "thumbnail_alt", "Thumbnail"))}" hidden>
                      <div id="uploadModalThumbnailEmpty" class="upload-modal__thumbnail-empty">${escapeHtml(t(app, "no_image", "No Image"))}</div>
                      <div class="upload-modal__focal-crosshair" id="uploadModalFocalCrosshair" hidden></div>
                      <div class="upload-modal__thumb-overlay" id="uploadModalThumbOverlay" hidden>
                        <span class="upload-modal__thumb-overlay-title" id="uploadModalThumbTitle"></span>
                        <span class="upload-modal__thumb-overlay-time" id="uploadModalThumbTime"></span>
                      </div>
                    </div>
                  </div>
                  <div class="upload-modal__drop-col">
                    <div class="upload-modal__field-label">${escapeHtml(t(app, "drop_label", "Add Images"))}</div>
                    <div id="uploadModalDropzone" class="upload-modal__dropzone" tabindex="0" role="button" aria-label="${escapeHtml(t(app, "drop_aria", "Select images or drag and drop"))}">
                      <div class="upload-modal__dropzone-icon">↑</div>
                      <p class="upload-modal__dropzone-text">${escapeHtml(t(app, "drop_text", "Drag and drop / click to select"))}</p>
                      <p class="upload-modal__dropzone-sub">${escapeHtml(t(app, "drop_sub", ".png .jpg .jpeg .webp / up to 50MB each / max 20 files"))}</p>
                      <div class="upload-modal__dropzone-actions">
                        <button id="uploadModalFileSelectButton" type="button" class="app-button app-button--primary">${escapeHtml(t(app, "select_files", "Select Files"))}</button>
                      </div>
                      <input id="uploadModalFileInput" class="upload-modal__file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple>
                    </div>
                  </div>
                </div>

                <!-- 中段: 画像一覧 -->
                <div class="upload-modal__strip-section">
                  <div class="upload-modal__strip-header">
                    <div class="upload-modal__field-label">${escapeHtml(t(app, "strip_label", "Images"))}</div>
                    <span class="upload-modal__strip-hint">${escapeHtml(t(app, "strip_hint", "Drag to reorder"))}</span>
                  </div>
                  <div class="upload-modal__strip-wrap" id="uploadModalStripWrap">
                    <button type="button" class="upload-modal__strip-arrow upload-modal__strip-arrow--prev" id="uploadModalStripPrev" hidden aria-label="${escapeHtml(t(app, "prev", "Prev"))}">&#8249;</button>
                    <div id="uploadModalStrip" class="upload-modal__strip" aria-live="polite"></div>
                    <button type="button" class="upload-modal__strip-arrow upload-modal__strip-arrow--next" id="uploadModalStripNext" hidden aria-label="${escapeHtml(t(app, "next", "Next"))}">&#8250;</button>
                  </div>
                  <div id="uploadModalSummary" class="upload-modal__summary">${escapeHtml(t(app, "no_files", "No files selected."))}</div>
                </div>

                <!-- 下段: フォーム -->
                <div class="upload-modal__fields">
                  <label class="app-field">
                    <span class="app-field__label">${escapeHtml(t(app, "title_label", "Title"))} <span class="upload-modal__required">${escapeHtml(t(app, "required", "*"))}</span></span>
                    <div class="upload-modal__input-row">
                      <input id="uploadModalTitleInput" class="app-input" type="text" placeholder="${escapeHtml(t(app, "title_placeholder", "Enter a title"))}" maxlength="${TITLE_MAX}">
                      <span id="uploadModalTitleCounter" class="upload-modal__counter">0/${TITLE_MAX}</span>
                    </div>
                  </label>

                  <label class="app-field">
                    <span class="app-field__label">${escapeHtml(t(app, "alt_label", "Description (ALT)"))}</span>
                    <textarea id="uploadModalAltInput" class="app-input upload-modal__textarea" placeholder="${escapeHtml(t(app, "alt_placeholder", "Enter a description"))}"></textarea>
                  </label>

                  <div class="upload-modal__row">
                    <label class="app-field">
                      <span class="app-field__label">
                        ${escapeHtml(t(app, "shot_at_label", "Shot At"))}
                        <span id="uploadModalShotAtBadge" class="upload-modal__auto-badge" hidden>${escapeHtml(t(app, "auto", "AUTO"))}</span>
                      </span>
                      <div class="upload-modal__shot-at-fields">
                        <input id="uploadModalShotAtDateInput" class="app-input" type="date" lang="${escapeHtml(languageToLocaleTag(app.settings.getLanguage()))}">
                        <input id="uploadModalShotAtTimeInput" class="app-input upload-modal__shot-at-time" type="time" step="60" lang="${escapeHtml(languageToLocaleTag(app.settings.getLanguage()))}">
                      </div>
                    </label>
                    <div class="app-field">
                      <span class="app-field__label">${escapeHtml(t(app, "tags_label", "Tags"))}</span>
                      <div class="upload-modal__tag-box" id="uploadModalTagBox">
                        <div class="upload-modal__tag-scroll" id="uploadModalTagChips"></div>
                        <input class="upload-modal__tag-input" id="uploadModalTagInput" type="text" placeholder="${escapeHtml(t(app, "tags_placeholder", "Add tags..."))}" autocomplete="off">
                        <button type="button" class="upload-modal__tag-add" id="uploadModalTagAdd" aria-label="${escapeHtml(t(app, "tags_add", "Add tag"))}">+</button>
                        <div class="upload-modal__tag-sug" id="uploadModalTagSug" hidden>
                          <div class="upload-modal__tag-sug-list" id="uploadModalTagSugList"></div>
                          <div class="upload-modal__tag-sug-more" id="uploadModalTagSugMore" hidden>
                            <button type="button" class="upload-modal__tag-more-btn" id="uploadModalTagMoreBtn">${escapeHtml(t(app, "more", "+more"))}</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="upload-modal__vis-toggle">
                    <label class="upload-modal__vis-switch" for="uploadModalVisInput" aria-label="${escapeHtml(t(app, "visibility_aria", "Visibility"))}">
                      <input type="checkbox" class="upload-modal__vis-input" id="uploadModalVisInput" checked>
                      <span class="upload-modal__vis-track">
                        <span class="upload-modal__vis-thumb"></span>
                      </span>
                    </label>
                    <span class="upload-modal__vis-label" id="uploadModalVisLabel">${escapeHtml(t(app, "visibility_public", "Public"))}</span>
                  </div>

                  <div id="uploadModalInlineMessage" class="upload-modal__inline-message" hidden></div>
                </div>

              </div>
            </div>
            <div class="app-modal-footer upload-modal__footer">
              <div class="upload-modal__footer-draft">
                <button id="uploadModalDraftButton" type="button" class="app-button app-button--ghost">${escapeHtml(t(app, "save_draft", "Save Draft"))}</button>
                <button id="uploadModalLoadDraftButton" type="button" class="app-button app-button--ghost" hidden>${escapeHtml(t(app, "load_draft", "Drafts"))}</button>
              </div>
              <div class="upload-modal__footer-actions">
                <button id="uploadModalSubmitButton" type="button" class="app-button app-button--primary">${escapeHtml(t(app, "submit", "Upload"))}</button>
              </div>
            </div>
          </div>
        `
      });
      modalRoot.appendChild(layer);
    }

    app.modal?.refresh?.();

    refs.layer = modalRoot.querySelector(`[data-modal-id="${MODAL_ID}"]`);
    refs.dropzone = document.getElementById("uploadModalDropzone");
    refs.fileInput = document.getElementById("uploadModalFileInput");
    refs.fileSelectButton = document.getElementById("uploadModalFileSelectButton");
    refs.thumbnailWrap = document.getElementById("uploadModalThumbnailWrap");
    refs.thumbnailImage = document.getElementById("uploadModalThumbnailImage");
    refs.thumbnailEmpty = document.getElementById("uploadModalThumbnailEmpty");
    refs.thumbOverlay = document.getElementById("uploadModalThumbOverlay");
    refs.thumbTitle = document.getElementById("uploadModalThumbTitle");
    refs.thumbTime = document.getElementById("uploadModalThumbTime");
    refs.stripWrap = document.getElementById("uploadModalStripWrap");
    refs.stripPrev = document.getElementById("uploadModalStripPrev");
    refs.stripNext = document.getElementById("uploadModalStripNext");
    refs.strip = document.getElementById("uploadModalStrip");
    refs.summary = document.getElementById("uploadModalSummary");
    refs.focalCrosshair = document.getElementById("uploadModalFocalCrosshair");
    refs.titleInput = document.getElementById("uploadModalTitleInput");
    refs.titleCounter = document.getElementById("uploadModalTitleCounter");
    refs.altInput = document.getElementById("uploadModalAltInput");
    refs.shotAtDateInput = document.getElementById("uploadModalShotAtDateInput");
    refs.shotAtTimeInput = document.getElementById("uploadModalShotAtTimeInput");
    refs.shotAtBadge = document.getElementById("uploadModalShotAtBadge");
    refs.tagBox = document.getElementById("uploadModalTagBox");
    refs.tagChips = document.getElementById("uploadModalTagChips");
    refs.tagInput = document.getElementById("uploadModalTagInput");
    refs.tagAdd = document.getElementById("uploadModalTagAdd");
    refs.tagSug = document.getElementById("uploadModalTagSug");
    refs.tagSugList = document.getElementById("uploadModalTagSugList");
    refs.tagSugMore = document.getElementById("uploadModalTagSugMore");
    refs.tagMoreBtn = document.getElementById("uploadModalTagMoreBtn");
    refs.visInput = document.getElementById("uploadModalVisInput");
    refs.visLabel = document.getElementById("uploadModalVisLabel");
    refs.inlineMessage = document.getElementById("uploadModalInlineMessage");
    refs.submitButton = document.getElementById("uploadModalSubmitButton");
    refs.draftButton = document.getElementById("uploadModalDraftButton");
    refs.loadDraftButton = document.getElementById("uploadModalLoadDraftButton");

    attachDatePicker(refs.shotAtDateInput, { getLocale: () => document.documentElement.lang || "en-US" });

    bindEvents();
    app.modal?.setBeforeClose?.(MODAL_ID, async () => {
      const approved = await confirmDiscardClose();
      if (approved) {
        resetState();
      }
      return approved;
    });
    if (!state.languageBound) {
      window.addEventListener("gallery:language-changed", applyTranslations);
      state.languageBound = true;
    }
    loadTagPool();
    state.mounted = true;
    render();
  }

  // ── Thumbnail overlay ─────────────────────────────────────────────────────

  function updateThumbOverlay() {
    if (!refs.thumbOverlay) return;
    const title = refs.titleInput?.value?.trim() || "";
    const time = getShotAtValue();
    const hasImage = state.items.length > 0;
    const hasInfo = hasImage && title;
    refs.thumbOverlay.hidden = !hasInfo;
    if (refs.thumbTitle) refs.thumbTitle.textContent = title;
    if (refs.thumbTime) refs.thumbTime.textContent = time ? time.replace("T", " ") : "";
  }

  // ── Strip pointer drag ────────────────────────────────────────────────────

  function createStripGhost(item, offsetX, offsetY) {
    const ghost = document.createElement("div");
    ghost.className = "upload-modal__strip-ghost";
    const img = document.createElement("img");
    img.src = item.objectUrl;
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    state.stripDragGhost = ghost;
    state.stripDragOffsetX = offsetX;
    state.stripDragOffsetY = offsetY;
    return ghost;
  }

  function moveStripGhost(clientX, clientY) {
    if (!state.stripDragGhost) return;
    state.stripDragGhost.style.left = `${clientX - state.stripDragOffsetX}px`;
    state.stripDragGhost.style.top = `${clientY - state.stripDragOffsetY}px`;
  }

  function removeStripGhost() {
    state.stripDragGhost?.remove();
    state.stripDragGhost = null;
  }

  function calcStripInsertIndex(clientX) {
    const visibleItems = [...refs.strip.querySelectorAll(".upload-modal__strip-item")]
      .filter(el => Number(el.dataset.index) !== state.stripDragIndex);
    for (let i = 0; i < visibleItems.length; i++) {
      const rect = visibleItems[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return visibleItems.length;
  }

  function updateStripPlaceholder(insertIndex) {
    refs.strip.querySelector(".upload-modal__strip-placeholder")?.remove();
    const placeholder = document.createElement("div");
    placeholder.className = "upload-modal__strip-placeholder";
    const visibleItems = [...refs.strip.querySelectorAll(".upload-modal__strip-item")]
      .filter(el => Number(el.dataset.index) !== state.stripDragIndex);
    if (insertIndex >= visibleItems.length) {
      refs.strip.appendChild(placeholder);
    } else {
      refs.strip.insertBefore(placeholder, visibleItems[insertIndex]);
    }
  }

  // ── Strip arrows ──────────────────────────────────────────────────────────

  function updateStripArrows() {
    const strip = refs.strip;
    if (!strip || !refs.stripPrev || !refs.stripNext) return;
    const { scrollLeft, scrollWidth, clientWidth } = strip;
    const atStart = scrollLeft <= 2;
    const atEnd = scrollLeft + clientWidth >= scrollWidth - 2;
    refs.stripPrev.hidden = atStart;
    refs.stripNext.hidden = atEnd;
  }

  // ── Focal point ───────────────────────────────────────────────────────────

  function _applyFocalTransform(img, fX, fY, zoom) {
    if (!img) return;
    img.style.objectFit = "cover";
    img.style.objectPosition = `${fX}% ${fY}%`;
    img.style.transformOrigin = `${fX}% ${fY}%`;
    img.style.transform = zoom > 1 ? `scale(${zoom})` : "";
    img.style.left = "";
    img.style.top = "";
    img.style.width = "";
    img.style.height = "";
  }

  function _clampFocal(v) {
    return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
  }

  function updateFocalDisplay() {
    const first = state.items[0];
    const hasImage = Boolean(first);

    if (refs.thumbnailImage) {
      if (hasImage) {
        _applyFocalTransform(refs.thumbnailImage, state.focalX, state.focalY, state.focalZoom);
      } else {
        refs.thumbnailImage.style.transform = "";
        refs.thumbnailImage.style.objectPosition = "";
      }
    }
    if (refs.focalCrosshair) refs.focalCrosshair.hidden = true;
    if (refs.thumbnailWrap) {
      refs.thumbnailWrap.classList.toggle("is-focal-active", hasImage);
    }
  }

  // ── Tag pool ──────────────────────────────────────────────────────────────

  async function loadTagPool() {
    try {
      const response = await fetch(`${app.appBase}/api/tags`, { credentials: "include" });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      const tags = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.tags) ? payload.tags : [];
      state.tagPool = tags.map((t) => String(t?.name ?? t ?? "").trim()).filter(Boolean);
    } catch {
      // tag pool is optional
    }
  }

  // ── Tag management ────────────────────────────────────────────────────────

  function addTag(str) {
    const parts = String(str || "").split(/[,、\s]+/);
    for (const part of parts) {
      const tag = normalizeTag(part);
      if (!tag || tag.length > MAX_TAG_LENGTH) continue;
      if (state.tagState.includes(tag)) continue;
      if (state.tagState.length >= MAX_TAGS) break;
      state.tagState.push(tag);
    }
    state.formDirty = true;
    if (refs.tagInput) refs.tagInput.value = "";
    renderTagChips();
    closeTagSug();
  }

  function removeTag(index) {
    state.tagState.splice(index, 1);
    state.formDirty = true;
    renderTagChips();
  }

  function renderTagChips() {
    if (!refs.tagChips) return;
    refs.tagChips.innerHTML = "";
    state.tagState.forEach((tag, i) => {
      const chip = createElement("span", { className: "upload-modal__tag-chip" });
      chip.innerHTML = `${escapeHtml(tag)}<button type="button" data-tag-index="${i}" aria-label="${escapeHtml(t(app, "remove_tag", "Remove {tag}", { tag }))}">\u00d7</button>`;
      refs.tagChips.appendChild(chip);
    });
  }

  function renderTagSug() {
    if (!refs.tagSugList) return;
    const query = (refs.tagInput?.value || "").trim().toLowerCase();
    const isQuick = state.tagSugMode === "quick";

    const available = state.tagPool.filter((t) => !state.tagState.includes(t));
    let filtered;
    if (isQuick) {
      filtered = available.slice(0, TAG_QUICK_LIMIT);
    } else {
      filtered = available.filter((t) => query && t.toLowerCase().includes(query)).slice(0, 30);
    }

    refs.tagSugList.innerHTML = "";
    for (const tag of filtered) {
      const btn = createElement("button", {
        className: "upload-modal__tag-sug-item",
        attributes: { type: "button", "data-tag": tag }
      });
      btn.innerHTML = isQuick ? escapeHtml(tag) : highlightMatch(tag, query);
      refs.tagSugList.appendChild(btn);
    }

    if (refs.tagSugMore) {
      refs.tagSugMore.hidden = !isQuick;
    }

    const hasContent = filtered.length > 0 || (isQuick && state.tagPool.length > 0);
    if (refs.tagSug) refs.tagSug.hidden = !hasContent;
  }

  function openTagSugQuick() {
    state.tagSugMode = "quick";
    state.tagSugOpen = true;
    renderTagSug();
  }

  function openTagSugInput() {
    state.tagSugMode = "input";
    state.tagSugOpen = true;
    renderTagSug();
  }

  function closeTagSug() {
    state.tagSugOpen = false;
    if (refs.tagSug) refs.tagSug.hidden = true;
  }

  // ── Tag browse modal ──────────────────────────────────────────────────────

  function ensureTagBrowseMounted() {
    if (state.tagBrowseMounted) return;
    const modalRoot = root();
    if (!modalRoot) return;
    if (!modalRoot.querySelector(`[data-modal-id="${TAG_BROWSE_MODAL_ID}"]`)) {
      const layer = createElement("section", {
        className: "app-modal-layer",
        attributes: {
          "data-modal-layer": true,
          "data-modal-id": TAG_BROWSE_MODAL_ID,
          hidden: true
        },
        html: `
          <div class="app-modal-backdrop" data-modal-backdrop="${TAG_BROWSE_MODAL_ID}"></div>
          <div class="app-modal-dialog app-modal-dialog--tag-browse" role="dialog" aria-modal="true" tabindex="-1">
            <div class="app-modal-header">
              <h2 class="app-modal-title">${escapeHtml(t(app, "tag_select_title", "Select Tags"))}</h2>
              <button type="button" class="app-modal-close" id="tagBrowseClose" aria-label="${escapeHtml(t(app, "close", "Close"))}">×</button>
            </div>
            <div class="tag-browse-modal__search-wrap">
              <input id="tagBrowseSearch" class="app-input tag-browse-modal__search" type="search" placeholder="${escapeHtml(t(app, "tag_search_placeholder", "Search tags..."))}" autocomplete="off">
              <div class="tag-browse-modal__sug" id="tagBrowseSug" hidden>
                <div class="tag-browse-modal__sug-list" id="tagBrowseSugList"></div>
              </div>
            </div>
            <div class="app-modal-body tag-browse-modal">
              <div id="tagBrowseList" class="tag-browse-modal__list"></div>
            </div>
          </div>
        `
      });
      modalRoot.appendChild(layer);
    }
    app.modal?.refresh?.();

    refs.tagBrowseLayer = modalRoot.querySelector(`[data-modal-id="${TAG_BROWSE_MODAL_ID}"]`);
    refs.tagBrowseSearch = document.getElementById("tagBrowseSearch");
    refs.tagBrowseSug = document.getElementById("tagBrowseSug");
    refs.tagBrowseSugList = document.getElementById("tagBrowseSugList");
    refs.tagBrowseList = document.getElementById("tagBrowseList");
    refs.tagBrowseClose = document.getElementById("tagBrowseClose");

    refs.tagBrowseSearch?.addEventListener("input", () => {
      const q = (refs.tagBrowseSearch.value || "").trim();
      state.tagBrowseQuery = q;
      renderTagBrowseSug(q);
      renderTagBrowseList(q);
    });
    refs.tagBrowseSugList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag]");
      if (!btn) return;
      addTag(btn.dataset.tag);
      renderTagBrowseList(state.tagBrowseQuery);
      renderTagBrowseSug(state.tagBrowseQuery);
    });
    refs.tagBrowseList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag]");
      if (!btn) return;
      addTag(btn.dataset.tag);
      renderTagBrowseList(state.tagBrowseQuery);
    });
    refs.tagBrowseClose?.addEventListener("click", () => closeTagBrowseModal());
    refs.tagBrowseLayer?.querySelector(`[data-modal-backdrop="${TAG_BROWSE_MODAL_ID}"]`)
      ?.addEventListener("click", () => closeTagBrowseModal());

    state.tagBrowseMounted = true;
  }

  function openTagBrowseModal() {
    ensureTagBrowseMounted();
    state.tagBrowseQuery = "";
    if (refs.tagBrowseSearch) refs.tagBrowseSearch.value = "";
    renderTagBrowseSug("");
    renderTagBrowseList("");
    app.modal?.open?.(TAG_BROWSE_MODAL_ID);
    setTimeout(() => refs.tagBrowseSearch?.focus(), 60);
  }

  function closeTagBrowseModal() {
    app.modal?.close?.(TAG_BROWSE_MODAL_ID);
  }

  function sortTagsLocale(tags) {
    return [...tags].sort((a, b) => a.localeCompare(b, ["ja", "en"], { sensitivity: "base" }));
  }

  function getLetterGroup(tag) {
    const first = tag[0] || "";
    const code = first.charCodeAt(0);
    if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
    // Katakana → convert to hiragana range
    const h = (code >= 0x30A1 && code <= 0x30F6) ? code - 0x60 : code;
    if (h >= 0x3041 && h <= 0x304A) return "あ";
    if (h >= 0x304B && h <= 0x3054) return "か";
    if (h >= 0x3055 && h <= 0x305E) return "さ";
    if (h >= 0x305F && h <= 0x3069) return "た";
    if (h >= 0x306A && h <= 0x306E) return "な";
    if (h >= 0x306F && h <= 0x307D) return "は";
    if (h >= 0x307E && h <= 0x3082) return "ま";
    if (h >= 0x3083 && h <= 0x3088) return "や";
    if (h >= 0x3089 && h <= 0x308D) return "ら";
    if (h >= 0x308E && h <= 0x3093) return "わ";
    return "#";
  }

  function buildTagGroups(tags) {
    const order = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(
      ["あ","か","さ","た","な","は","ま","や","ら","わ","#"]
    );
    const map = new Map();
    for (const tag of tags) {
      const key = getLetterGroup(tag);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(tag);
    }
    const result = [];
    for (const key of order) {
      if (map.has(key)) result.push({ header: key, tags: map.get(key) });
    }
    return result;
  }

  function renderTagBrowseSug(query) {
    if (!refs.tagBrowseSugList) return;
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      if (refs.tagBrowseSug) refs.tagBrowseSug.hidden = true;
      return;
    }
    const results = state.tagPool
      .filter((t) => !state.tagState.includes(t) && t.toLowerCase().includes(q))
      .slice(0, 10);
    refs.tagBrowseSugList.innerHTML = "";
    for (const tag of results) {
      const btn = createElement("button", {
        className: "tag-browse-modal__sug-item",
        attributes: { type: "button", "data-tag": tag }
      });
      btn.innerHTML = highlightMatch(tag, q);
      refs.tagBrowseSugList.appendChild(btn);
    }
    if (refs.tagBrowseSug) refs.tagBrowseSug.hidden = results.length === 0;
  }

  function renderTagBrowseList(query) {
    if (!refs.tagBrowseList) return;
    const q = (query || "").trim().toLowerCase();
    const pool = q
      ? state.tagPool.filter((t) => t.toLowerCase().includes(q))
      : state.tagPool;
    const sorted = sortTagsLocale(pool);

    refs.tagBrowseList.innerHTML = "";
    if (!sorted.length) {
      refs.tagBrowseList.innerHTML = `<p class="tag-browse-modal__empty">${escapeHtml(t(app, "tag_empty", "No tags found"))}</p>`;
      return;
    }

    const groups = buildTagGroups(sorted);
    const fragment = document.createDocumentFragment();
    for (const { header, tags } of groups) {
      const section = createElement("div", { className: "tag-browse-modal__group" });
      const h = createElement("div", { className: "tag-browse-modal__group-header" });
      h.textContent = header;
      section.appendChild(h);
      const row = createElement("div", { className: "tag-browse-modal__group-tags" });
      for (const tag of tags) {
        const selected = state.tagState.includes(tag);
        const btn = createElement("button", {
          className: `tag-browse-modal__tag-btn${selected ? " is-selected" : ""}`,
          attributes: { type: "button", "data-tag": tag, "aria-pressed": selected ? "true" : "false" }
        });
        btn.innerHTML = q ? highlightMatch(tag, q) : escapeHtml(tag);
        row.appendChild(btn);
      }
      section.appendChild(row);
      fragment.appendChild(section);
    }
    refs.tagBrowseList.appendChild(fragment);
  }

  // ── Draft ─────────────────────────────────────────────────────────────────

  function readDraftList() {
    try {
      const raw = localStorage.getItem(DRAFTS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    // Legacy migration from single-draft format
    try {
      const legacy = localStorage.getItem(DRAFT_KEY);
      if (legacy) {
        const draft = JSON.parse(legacy);
        if (draft && typeof draft === "object") {
          const entry = { id: `legacy-${draft.savedAt || Date.now()}`, ...draft };
          const list = [entry];
          try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(list)); } catch {}
          try { localStorage.removeItem(DRAFT_KEY); } catch {}
          return list;
        }
      }
    } catch {}
    return [];
  }

  function saveDraft() {
    const draft = {
      id: `draft-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      title: refs.titleInput?.value || "",
      alt: refs.altInput?.value || "",
      shotAt: getShotAtValue(),
      tags: [...state.tagState],
      isPublic: refs.visInput?.checked ?? true,
      focalX: state.focalX,
      focalY: state.focalY,
      focalZoom: state.focalZoom,
      savedAt: Date.now(),
    };
    const list = readDraftList();
    list.unshift(draft);
    if (list.length > MAX_DRAFTS) list.length = MAX_DRAFTS;
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(list)); } catch {}
    state.lastSavedDraft = { ...draft };
    state.formDirty = false;
    updateDraftLoadButton();
    app.toast?.info?.(t(app, "draft_saved", "Draft saved."));
  }

  function loadDraftItem(entry) {
    if (!entry) return;
    if (refs.titleInput) refs.titleInput.value = entry.title || "";
    if (refs.altInput) refs.altInput.value = entry.alt || "";
    if ((refs.shotAtDateInput || refs.shotAtTimeInput) && entry.shotAt) {
      setShotAtValue(entry.shotAt);
      state.shotAtDirty = true;
    }
    if (typeof entry.focalX === "number") state.focalX = entry.focalX;
    if (typeof entry.focalY === "number") state.focalY = entry.focalY;
    if (typeof entry.focalZoom === "number") state.focalZoom = Math.max(1.0, entry.focalZoom);
    if (Array.isArray(entry.tags)) {
      state.tagState = entry.tags.filter((t) => typeof t === "string" && t.trim());
      renderTagChips();
    }
    if (refs.visInput) refs.visInput.checked = entry.isPublic !== false;
    state.lastSavedDraft = {
      title: entry.title || "",
      alt: entry.alt || "",
      shotAt: entry.shotAt || "",
      tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
      isPublic: entry.isPublic !== false,
      focalX: typeof entry.focalX === "number" ? entry.focalX : 50,
      focalY: typeof entry.focalY === "number" ? entry.focalY : 50,
      focalZoom: typeof entry.focalZoom === "number" ? Math.max(1.0, entry.focalZoom) : 1.0,
    };
    state.formDirty = false;
    updateTitleCounter();
    updateVisLabel();
    updateShotAtBadge();
  }

  function deleteDraftItem(id) {
    const list = readDraftList().filter((e) => e.id !== id);
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(list)); } catch {}
    updateDraftLoadButton();
    if (!list.length) {
      closeDraftListModal();
    } else {
      renderDraftListItems();
    }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFTS_KEY); } catch {}
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    updateDraftLoadButton();
  }

  function updateDraftLoadButton() {
    if (!refs.loadDraftButton) return;
    const list = readDraftList();
    refs.loadDraftButton.hidden = list.length === 0;
  }

  function formatDraftDate(ts) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  }

  function ensureDraftListMounted() {
    if (state.draftListMounted) return;
    const modalRoot = root();
    if (!modalRoot) return;
    if (!modalRoot.querySelector(`[data-modal-id="${DRAFT_LIST_MODAL_ID}"]`)) {
      const layer = createElement("section", {
        className: "app-modal-layer",
        attributes: { "data-modal-layer": true, "data-modal-id": DRAFT_LIST_MODAL_ID, hidden: true },
        html: `
          <div class="app-modal-backdrop" data-modal-backdrop="${DRAFT_LIST_MODAL_ID}"></div>
          <div class="app-modal-dialog app-modal-dialog--draft-list" role="dialog" aria-modal="true" tabindex="-1">
            <div class="app-modal-header">
              <h2 class="app-modal-title">${escapeHtml(t(app, "load_draft", "Drafts"))}</h2>
              <button type="button" class="app-modal-close" id="draftListClose" aria-label="${escapeHtml(t(app, "close", "Close"))}">×</button>
            </div>
            <div class="app-modal-body draft-list-modal">
              <div id="draftListItems" class="draft-list-modal__items"></div>
            </div>
          </div>
        `
      });
      modalRoot.appendChild(layer);
    }
    app.modal?.refresh?.();
    refs.draftListLayer = modalRoot.querySelector(`[data-modal-id="${DRAFT_LIST_MODAL_ID}"]`);
    refs.draftListItems = document.getElementById("draftListItems");
    refs.draftListClose = document.getElementById("draftListClose");

    refs.draftListClose?.addEventListener("click", () => closeDraftListModal());
    refs.draftListLayer?.querySelector(`[data-modal-backdrop="${DRAFT_LIST_MODAL_ID}"]`)
      ?.addEventListener("click", () => closeDraftListModal());

    refs.draftListItems?.addEventListener("click", (event) => {
      const delBtn = event.target.closest("[data-draft-del]");
      if (delBtn) {
        event.stopPropagation();
        deleteDraftItem(delBtn.dataset.draftDel);
        return;
      }
      const item = event.target.closest("[data-draft-id]");
      if (item) {
        const entry = readDraftList().find((e) => e.id === item.dataset.draftId);
        if (entry) {
          loadDraftItem(entry);
          closeDraftListModal();
          app.toast?.info?.(t(app, "draft_loaded", "Draft loaded."));
        }
      }
    });

    state.draftListMounted = true;
  }

  function openDraftListModal() {
    ensureDraftListMounted();
    renderDraftListItems();
    app.modal?.open?.(DRAFT_LIST_MODAL_ID);
  }

  function closeDraftListModal() {
    if (!state.draftListMounted) return;
    app.modal?.close?.(DRAFT_LIST_MODAL_ID);
  }

  function renderDraftListItems() {
    if (!refs.draftListItems) return;
    const list = readDraftList();
    refs.draftListItems.innerHTML = "";
    for (const entry of list) {
      const item = createElement("div", {
        className: "draft-list-modal__item",
        attributes: { "data-draft-id": entry.id }
      });
      item.innerHTML = `
        <div class="draft-list-modal__item-thumb"><div class="draft-list-modal__item-thumb-empty"></div></div>
        <div class="draft-list-modal__item-info">
          <div class="draft-list-modal__item-title">${escapeHtml(entry.title || t(app, "draft_no_title", "(No title)"))}</div>
          ${entry.alt ? `<div class="draft-list-modal__item-desc">${escapeHtml(entry.alt)}</div>` : ""}
        </div>
        <button type="button" class="draft-list-modal__item-del" data-draft-del="${escapeHtml(entry.id)}" aria-label="${escapeHtml(t(app, "draft_delete", "Delete draft"))}">×</button>
      `;
      refs.draftListItems.appendChild(item);
    }
  }

  function hasUnsavedChanges() {
    // ファイルが選択されている場合は常に「未保存」（下書きにはファイルは保存できない）
    if (state.items.length > 0) return true;
    // 下書きが保存・復元済みで、それ以降フォームを変更していない場合は問題なし
    if (state.lastSavedDraft && !state.formDirty) return false;
    return (
      Boolean(refs.titleInput?.value?.trim()) ||
      Boolean(refs.altInput?.value?.trim()) ||
      Boolean(getShotAtValue()) ||
      state.tagState.length > 0 ||
      (refs.visInput?.checked ?? true) === false ||
      state.focalX !== 50 ||
      state.focalY !== 50 ||
      state.focalZoom !== 1.0
    );
  }

  async function confirmDiscardClose() {
    if (state.uploading) {
      app.toast?.info?.(t(app, "submitting", "Uploading..."));
      return false;
    }
    if (!hasUnsavedChanges()) {
      return true;
    }
    const message = t(app, "discard_confirm", "未保存のアップロード内容があります。閉じますか？");
    const approveText = t(app, "discard_approve", "破棄して閉じる");
    if (typeof app.confirmAction === "function") {
      return app.confirmAction(message, approveText, true);
    }
    return window.confirm(message);
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  function updateTitleCounter() {
    if (!refs.titleCounter || !refs.titleInput) return;
    const len = refs.titleInput.value.length;
    refs.titleCounter.textContent = `${len}/${TITLE_MAX}`;
    refs.titleCounter.classList.toggle("is-over", len > TITLE_MAX);
  }

  function updateVisLabel() {
    if (!refs.visLabel || !refs.visInput) return;
    refs.visLabel.textContent = refs.visInput.checked
      ? t(app, "visibility_public", "Public")
      : t(app, "visibility_private", "Private");
  }

  function updateShotAtBadge() {
    if (!refs.shotAtBadge) return;
    refs.shotAtBadge.hidden = !state.shotAtAutoValue;
  }

  function splitShotAtValue(value) {
    const text = String(value || "").trim();
    if (!text) return { date: "", time: "" };
    const [datePart = "", timePart = ""] = text.split("T");
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : "",
      time: /^\d{2}:\d{2}(:\d{2})?$/.test(timePart) ? timePart.slice(0, 5) : "",
    };
  }

  function getShotAtValue() {
    const date = refs.shotAtDateInput?.value || "";
    const time = refs.shotAtTimeInput?.value || "";
    if (!date) return "";
    return `${date}T${time || "00:00"}`;
  }

  function setShotAtValue(value) {
    const { date, time } = splitShotAtValue(value);
    if (refs.shotAtDateInput) refs.shotAtDateInput.value = date;
    if (refs.shotAtTimeInput) refs.shotAtTimeInput.value = time;
  }

  function setInlineMessage(message = "", kind = "") {
    if (!refs.inlineMessage) return;
    refs.inlineMessage.hidden = !message;
    refs.inlineMessage.textContent = message || "";
    refs.inlineMessage.classList.toggle("is-error", kind === "error");
    refs.inlineMessage.classList.toggle("is-success", kind === "success");
    refs.inlineMessage.classList.toggle("is-info", kind === "info");
  }

  function setSubmitting(submitting) {
    state.uploading = Boolean(submitting);
    if (refs.submitButton) {
      refs.submitButton.disabled = state.uploading;
      refs.submitButton.textContent = state.uploading
        ? t(app, "submitting", "Uploading...")
        : t(app, "submit", "Upload");
    }
    if (refs.fileSelectButton) refs.fileSelectButton.disabled = state.uploading;
    if (refs.fileInput) refs.fileInput.disabled = state.uploading;
    if (refs.draftButton) refs.draftButton.disabled = state.uploading;
    if (refs.loadDraftButton) refs.loadDraftButton.disabled = state.uploading;
  }

  function currentUser() {
    return app.session?.getState?.()?.data?.user || null;
  }

  function canOpen() {
    const authenticated = Boolean(app.session?.getState?.()?.authenticated);
    if (!authenticated && scope === "public") {
      window.location.href = buildAuthUrl(app.appBase || "");
      return false;
    }
    const user = currentUser();
    if (scope === "public" && authenticated && user && user.upload_enabled === false) {
      app.toast?.warning?.(t(app, "disabled", "Image uploads are currently disabled."));
      return false;
    }
    return true;
  }

  function revokeUrls() {
    for (const item of state.items) {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    }
  }

  function resetState() {
    revokeUrls();
    state.items = [];
    state.uploading = false;
    state.dragIndex = -1;
    state.shotAtAutoValue = "";
    state.shotAtDirty = false;
    state.onUploaded = null;
    state.tagState = [];
    state.tagSugOpen = false;
    state.focalX = 50;
    state.focalY = 50;
    state.focalZoom = 1.0;
    state.focalDragging = false;
    state.lastSavedDraft = null;
    state.formDirty = false;
    closeDraftListModal();
    removeStripGhost();
    state.stripDragActive = false;
    state.stripDragIndex = -1;
    state.stripInsertIndex = -1;
    state.stripPointerId = -1;
    if (refs.fileInput) refs.fileInput.value = "";
    if (refs.titleInput) refs.titleInput.value = "";
    if (refs.altInput) refs.altInput.value = "";
    if (refs.shotAtDateInput) refs.shotAtDateInput.value = "";
    if (refs.shotAtTimeInput) refs.shotAtTimeInput.value = "";
    if (refs.tagInput) refs.tagInput.value = "";
    if (refs.visInput) refs.visInput.checked = true;
    renderTagChips();
    closeTagSug();
    updateTitleCounter();
    updateVisLabel();
    updateShotAtBadge();
    setInlineMessage("");
    setSubmitting(false);
    render();
  }

  // ── File / hash logic ─────────────────────────────────────────────────────

  async function refreshHashes(items) {
    await Promise.all(items.map(async (item) => {
      if (item.hash) return;
      try {
        item.hash = await computeFileHash(item.file);
      } catch {
        item.hash = `error-${item.id}`;
      }
    }));
    syncDuplicateFlags();
    await checkServerDuplicates();
  }

  async function checkServerDuplicates() {
    const hashes = state.items.map((item) => item.hash).filter((h) => h && !h.startsWith("error-"));
    if (!hashes.length) return;
    try {
      const res = await fetch(`${app.appBase}/api/check-hashes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes }),
      });
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      const dupSet = new Set(Array.isArray(payload?.duplicates) ? payload.duplicates : []);
      state.items.forEach((item) => {
        if (item.hash && !item.hash.startsWith("error-")) {
          item.serverDuplicate = dupSet.has(item.hash);
        }
      });
      render();
    } catch {
      // server duplicate check is optional
    }
  }

  function syncDuplicateFlags() {
    const seen = new Map();
    for (const item of state.items) {
      item.duplicate = false;
      item.duplicateExistingId = null;
    }
    for (const item of state.items) {
      if (!item.hash) continue;
      if (seen.has(item.hash)) {
        item.duplicate = true;
        seen.get(item.hash).duplicate = true;
        continue;
      }
      seen.set(item.hash, item);
    }
    render();
  }

  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const remaining = Math.max(0, MAX_FILES - state.items.length);
    if (remaining <= 0) {
      app.toast?.error?.(t(app, "max_files_error", "You can upload up to {count} images.", { count: MAX_FILES }));
      return;
    }

    const accepted = [];
    for (const file of incoming) {
      if (accepted.length >= remaining) break;
      const ext = extractExtension(file.name);
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        app.toast?.error?.(t(app, "unsupported_format", "{name} is not a supported format.", { name: file.name }));
        continue;
      }
      if (Number(file.size || 0) > MAX_FILE_BYTES) {
        app.toast?.error?.(t(app, "file_too_large", "{name} exceeds 50MB.", { name: file.name }));
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length >= remaining && incoming.length > remaining) {
      app.toast?.warning?.(t(app, "max_files_partial", "You can upload up to {count} images. Only the first {remaining} files were added.", { count: MAX_FILES, remaining }));
    }

    const items = accepted.map((file, offset) => ({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}-${offset}`,
      file,
      objectUrl: URL.createObjectURL(file),
      hash: null,
      duplicate: false,
      serverDuplicate: false,
      duplicateExistingId: null
    }));

    state.items.push(...items);
    render();
    await refreshHashes(items);
    syncShotAtFromThumbnail();
  }

  function moveItem(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= state.items.length || toIndex >= state.items.length) return;
    const [item] = state.items.splice(fromIndex, 1);
    state.items.splice(toIndex, 0, item);
    render();
    syncShotAtFromThumbnail();
  }

  function removeItem(index) {
    const item = state.items[index];
    if (!item) return;
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    state.items.splice(index, 1);
    syncDuplicateFlags();
    syncShotAtFromThumbnail();
  }

  function setThumbnail(index) {
    if (index <= 0) return;
    moveItem(index, 0);
  }

  function syncShotAtFromThumbnail() {
    const first = state.items[0];
    const nextAuto = first ? parseVRChatShotAt(first.file.name) : "";
    if (!refs.shotAtDateInput) return;
    if (nextAuto) {
      setShotAtValue(nextAuto);
      state.shotAtDirty = false;
    }
    state.shotAtAutoValue = nextAuto;
    updateShotAtBadge();
    renderThumbnail();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderThumbnail() {
    const first = state.items[0];
    if (!refs.thumbnailImage || !refs.thumbnailEmpty) return;
    if (!first) {
      refs.thumbnailImage.hidden = true;
      refs.thumbnailImage.removeAttribute("src");
      refs.thumbnailEmpty.hidden = false;
      return;
    }
    refs.thumbnailImage.hidden = false;
    refs.thumbnailImage.src = first.objectUrl;
    refs.thumbnailImage.alt = first.file.name || t(app, "thumbnail_alt", "Thumbnail");
    refs.thumbnailEmpty.hidden = true;
  }

  function renderSummary() {
    if (!refs.summary) return;
    if (!state.items.length) {
      refs.summary.textContent = t(app, "no_files", "No files selected.");
      return;
    }
    const totalBytes = state.items.reduce((sum, item) => sum + Number(item.file?.size || 0), 0);
    const dupCount = state.items.filter((item) => item.duplicate || item.serverDuplicate).length;
    const parts = [t(app, "summary_count", "{count}/{max} files", { count: state.items.length, max: MAX_FILES }), formatBytes(totalBytes)];
    if (dupCount > 0) parts.push(t(app, "summary_dup", "DUP {count}", { count: dupCount }));
    refs.summary.textContent = parts.join(" / ");
  }

  function renderStrip() {
    if (!refs.strip) return;
    if (state.stripDragActive) return; // ドラッグ中は再描画しない
    refs.strip.innerHTML = "";
    if (!state.items.length) {
      const empty = createElement("div", {
        className: "upload-modal__strip-empty",
        text: t(app, "empty_strip", "Added images will appear here.")
      });
      refs.strip.appendChild(empty);
      return;
    }

    state.items.forEach((item, index) => {
      const dup = item.duplicate || item.serverDuplicate;
      const card = createElement("div", {
        className: `upload-modal__strip-item${index === 0 ? " is-thumbnail" : ""}${dup ? " is-dup" : ""}`,
        attributes: { "data-index": index }
      });

      card.innerHTML = `
        <div class="upload-modal__strip-thumb" data-action="thumbnail" data-index="${index}" role="button" tabindex="0" aria-label="${escapeHtml(index === 0 ? t(app, "thumb_current", "Current thumbnail") : t(app, "thumb_set", "Set as thumbnail"))}">
          <img src="${escapeHtml(item.objectUrl)}" alt="${escapeHtml(item.file.name || t(app, "image_alt", "Image"))}">
          ${index === 0 ? `<span class="upload-modal__strip-badge upload-modal__strip-badge--thumbnail">${escapeHtml(t(app, "thumbnail_badge", "THUMB"))}</span>` : ""}
          ${dup ? `<span class="upload-modal__strip-badge upload-modal__strip-badge--dup">${escapeHtml(t(app, "duplicate_badge", "DUP"))}</span>` : ""}
          <button type="button" class="upload-modal__strip-rm" data-action="remove" data-index="${index}" aria-label="${escapeHtml(t(app, "remove", "Remove"))}">\u00d7</button>
        </div>
        <div class="upload-modal__strip-name">${escapeHtml(item.file.name || t(app, "unnamed_file", "(Unnamed file)"))}</div>
      `;
      refs.strip.appendChild(card);
    });
  }

  function render() {
    renderThumbnail();
    renderSummary();
    renderStrip();
    updateThumbOverlay();
    updateStripArrows();
    updateFocalDisplay();
  }

  function applyTranslations() {
    if (!state.mounted || !refs.layer) return;
    const q = (selector) => refs.layer.querySelector(selector);

    const title = q("#uploadModalTitle");
    if (title) title.textContent = t(app, "title", "Upload Images");

    const thumbLabel = q(".upload-modal__thumb-col .upload-modal__field-label");
    if (thumbLabel) thumbLabel.textContent = t(app, "thumbnail_label", "Thumbnail / Focus");

    if (refs.thumbnailImage) refs.thumbnailImage.alt = t(app, "thumbnail_alt", "Thumbnail");
    if (refs.thumbnailEmpty) refs.thumbnailEmpty.textContent = t(app, "no_image", "No Image");

    const dropLabel = q(".upload-modal__drop-col .upload-modal__field-label");
    if (dropLabel) dropLabel.textContent = t(app, "drop_label", "Add Images");
    if (refs.dropzone) refs.dropzone.setAttribute("aria-label", t(app, "drop_aria", "Select images or drag and drop"));
    const dropText = q(".upload-modal__dropzone-text");
    if (dropText) dropText.textContent = t(app, "drop_text", "Drag and drop / click to select");
    const dropSub = q(".upload-modal__dropzone-sub");
    if (dropSub) dropSub.textContent = t(app, "drop_sub", ".png .jpg .jpeg .webp / up to 50MB each / max 20 files");
    if (refs.fileSelectButton) refs.fileSelectButton.textContent = t(app, "select_files", "Select Files");

    const stripLabels = refs.layer.querySelectorAll(".upload-modal__strip-header .upload-modal__field-label");
    if (stripLabels[0]) stripLabels[0].textContent = t(app, "strip_label", "Images");
    const stripHint = q(".upload-modal__strip-hint");
    if (stripHint) stripHint.textContent = t(app, "strip_hint", "Drag to reorder");
    if (refs.stripPrev) refs.stripPrev.setAttribute("aria-label", t(app, "prev", "Prev"));
    if (refs.stripNext) refs.stripNext.setAttribute("aria-label", t(app, "next", "Next"));

    const titleLabel = refs.titleInput?.closest(".app-field")?.querySelector(".app-field__label");
    if (titleLabel) {
      titleLabel.innerHTML = `${escapeHtml(t(app, "title_label", "Title"))} <span class="upload-modal__required">${escapeHtml(t(app, "required", "*"))}</span>`;
    }
    if (refs.titleInput) refs.titleInput.placeholder = t(app, "title_placeholder", "Enter a title");

    const altLabel = refs.altInput?.closest(".app-field")?.querySelector(".app-field__label");
    if (altLabel) altLabel.textContent = t(app, "alt_label", "Description (ALT)");
    if (refs.altInput) refs.altInput.placeholder = t(app, "alt_placeholder", "Enter a description");

    const shotLabel = refs.shotAtDateInput?.closest(".app-field")?.querySelector(".app-field__label");
    if (shotLabel) {
      shotLabel.childNodes[0].textContent = `${t(app, "shot_at_label", "Shot At")} `;
    }
    if (refs.shotAtBadge) refs.shotAtBadge.textContent = t(app, "auto", "AUTO");
    if (refs.shotAtDateInput) refs.shotAtDateInput.lang = languageToLocaleTag(app.settings.getLanguage());
    if (refs.shotAtTimeInput) refs.shotAtTimeInput.lang = languageToLocaleTag(app.settings.getLanguage());

    const fieldLabels = refs.layer.querySelectorAll(".upload-modal__row .app-field__label");
    if (fieldLabels[1]) fieldLabels[1].textContent = t(app, "tags_label", "Tags");
    if (refs.tagInput) refs.tagInput.placeholder = t(app, "tags_placeholder", "Add tags...");
    if (refs.tagAdd) refs.tagAdd.setAttribute("aria-label", t(app, "tags_add", "Add tag"));
    if (refs.tagMoreBtn) refs.tagMoreBtn.textContent = t(app, "more", "+more");

    if (refs.visInput) refs.visInput.parentElement?.setAttribute("aria-label", t(app, "visibility_aria", "Visibility"));
    if (refs.draftButton) refs.draftButton.textContent = t(app, "save_draft", "Save Draft");
    if (refs.loadDraftButton) refs.loadDraftButton.textContent = t(app, "load_draft", "Drafts");
    setSubmitting(state.uploading);
    updateVisLabel();

    if (state.tagBrowseMounted) {
      const browseTitle = refs.tagBrowseLayer?.querySelector(".app-modal-title");
      if (browseTitle) browseTitle.textContent = t(app, "tag_select_title", "Select Tags");
      if (refs.tagBrowseClose) refs.tagBrowseClose.setAttribute("aria-label", t(app, "close", "Close"));
      if (refs.tagBrowseSearch) refs.tagBrowseSearch.placeholder = t(app, "tag_search_placeholder", "Search tags...");
      renderTagBrowseSug(state.tagBrowseQuery);
      renderTagBrowseList(state.tagBrowseQuery);
    }

    renderTagChips();
    if (state.tagSugOpen) {
      renderTagSug();
    } else {
      closeTagSug();
    }
    render();
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  function collectDuplicateMessageFromPayload(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const first = items.find((item) => item?.duplicate);
    if (!first) return t(app, "duplicate_abort", "Duplicate images were detected, so upload was cancelled.");
    const order = Number(first.index ?? 0) + 1;
    return t(app, "duplicate_existing_order", "Image #{order} has already been uploaded.", { order });
  }

  function applyServerDuplicateFlags(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const duplicateMap = new Map(items.filter((item) => item?.duplicate).map((item) => [Number(item.index), item]));
    state.items.forEach((item, index) => {
      const hit = duplicateMap.get(index);
      item.serverDuplicate = Boolean(hit);
      item.duplicateExistingId = hit?.existing_id ?? null;
    });
    render();
  }

  async function submit() {
    if (state.uploading) return;
    const title = refs.titleInput?.value?.trim() || "";
    const alt = refs.altInput?.value || "";
    const tags = state.tagState.join(",");
    const isPublic = refs.visInput?.checked ? "true" : "false";
    const shotAt = getShotAtValue();

    if (!title) {
      const message = t(app, "title_required", "Enter a title.");
      setInlineMessage(message, "error");
      app.toast?.error?.(resolveLocalizedMessage(message, t(app, "title_required", "Enter a title.")));
      return;
    }
    if (!state.items.length) {
      const message = t(app, "image_required", "Select at least one image.");
      setInlineMessage(message, "error");
      app.toast?.error?.(resolveLocalizedMessage(message, t(app, "image_required", "Select at least one image.")));
      return;
    }

    const localDupIndex = state.items.findIndex((item) => item.duplicate);
    if (localDupIndex >= 0) {
      const message = t(app, "duplicate_local_order", "Image #{order} is duplicated.", { order: localDupIndex + 1 });
      setInlineMessage(message, "error");
      app.toast?.error?.(resolveLocalizedMessage(message, t(app, "duplicate_local_order", "Image #{order} is duplicated.", { order: localDupIndex + 1 })));
      return;
    }

    const formData = new FormData();
    formData.append("title", title);
    formData.append("alt", alt);
    formData.append("tags", tags);
    formData.append("is_public", isPublic);
    if (shotAt) formData.append("shot_at", shotAt);
    formData.append("focal_x", String(state.focalX));
    formData.append("focal_y", String(state.focalY));
    formData.append("focal_zoom", String(state.focalZoom));
    for (const item of state.items) {
      formData.append("files", item.file, item.file.name);
    }

    setInlineMessage("");
    setSubmitting(true);

    try {
      const response = await fetch(`${app.appBase}/api/upload`, {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload?.error?.message || payload?.detail || payload?.message || t(app, "submit_error", "Upload failed."));
      }
      if (payload.has_duplicates) {
        applyServerDuplicateFlags(payload);
        const message = collectDuplicateMessageFromPayload(payload);
        setInlineMessage(message, "error");
        app.toast?.error?.(resolveLocalizedMessage(message, t(app, "submit_error", "Upload failed.")));
        return;
      }

      const createdCount = Number(payload.count || state.items.length || 0);
      const successMessage = createdCount > 0
        ? t(app, "success_count", "Uploaded {count} images.", { count: createdCount })
        : t(app, "success_default", "Upload completed.");
      setInlineMessage(successMessage, "success");
      app.toast?.success?.(resolveLocalizedMessage(successMessage, t(app, "success_default", "Upload completed.")));
      clearDraft();
      const uploadedCallback = state.onUploaded;
      close();
      if (typeof uploadedCallback === "function") {
        await uploadedCallback(payload);
      }
    } catch (error) {
      const message = error?.message || t(app, "submit_error", "Upload failed.");
      setInlineMessage(message, "error");
      app.toast?.error?.(resolveLocalizedMessage(message, t(app, "submit_error", "Upload failed.")));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  function bindEvents() {
    // File select
    refs.fileSelectButton?.addEventListener("click", () => refs.fileInput?.click());
    refs.fileInput?.addEventListener("change", async (event) => {
      await addFiles(event.target.files);
      event.target.value = "";
    });

    // Dropzone
    refs.dropzone?.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      refs.fileInput?.click();
    });
    refs.dropzone?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      refs.fileInput?.click();
    });
    ["dragenter", "dragover"].forEach((name) => {
      refs.dropzone?.addEventListener(name, (event) => {
        event.preventDefault();
        refs.dropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((name) => {
      refs.dropzone?.addEventListener(name, (event) => {
        event.preventDefault();
        refs.dropzone.classList.remove("is-dragover");
      });
    });
    refs.dropzone?.addEventListener("drop", async (event) => {
      await addFiles(event.dataTransfer?.files || []);
    });

    // Strip: click
    refs.strip?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const index = Number(button.dataset.index ?? -1);
      if (button.dataset.action === "remove") {
        removeItem(index);
        return;
      }
      if (button.dataset.action === "thumbnail") {
        setThumbnail(index);
      }
    });

    // Strip: pointer drag reorder
    refs.strip?.addEventListener("pointerdown", (event) => {
      if (state.mobileMedia.matches || event.pointerType === "touch") return;
      if (event.button !== 0) return;
      if (event.target.closest("[data-action='remove']")) return;
      const card = event.target.closest(".upload-modal__strip-item");
      if (!card) return;
      const index = Number(card.dataset.index ?? -1);
      if (index < 0) return;
      const rect = card.getBoundingClientRect();
      state.stripDragIndex = index;
      state.stripInsertIndex = index;
      state.stripPointerId = event.pointerId;
      state.stripDragOffsetX = event.clientX - rect.left;
      state.stripDragOffsetY = event.clientY - rect.top;
    });

    refs.strip?.addEventListener("pointermove", (event) => {
      if (state.stripDragIndex < 0) return;
      if (!state.stripDragActive) {
        // 初回移動でドラッグ開始
        state.stripDragActive = true;
        refs.strip.setPointerCapture(state.stripPointerId);
        refs.strip.classList.add("is-strip-dragging");
        const card = refs.strip.querySelector(`[data-index="${state.stripDragIndex}"]`);
        card?.classList.add("is-dragging");
        createStripGhost(
          state.items[state.stripDragIndex],
          state.stripDragOffsetX,
          state.stripDragOffsetY
        );
      }
      moveStripGhost(event.clientX, event.clientY);
      const insertIndex = calcStripInsertIndex(event.clientX);
      if (insertIndex !== state.stripInsertIndex) {
        state.stripInsertIndex = insertIndex;
        updateStripPlaceholder(insertIndex);
      }
    });

    const endStripDrag = () => {
      if (state.stripDragIndex < 0) return;
      const fromIndex = state.stripDragIndex;
      const toIndex = state.stripInsertIndex;
      // toIndex は「dragIndex を除いたリストの挿入位置」で、
      // moveItem が splice で削除してから挿入するため変換不要（そのまま使える）

      removeStripGhost();
      refs.strip.classList.remove("is-strip-dragging");
      state.stripDragActive = false;
      state.stripDragIndex = -1;
      state.stripInsertIndex = -1;
      state.stripPointerId = -1;

      if (toIndex !== fromIndex && toIndex >= 0) {
        moveItem(fromIndex, toIndex);
      } else {
        renderStrip();
      }
    };

    refs.strip?.addEventListener("pointerup", endStripDrag);
    refs.strip?.addEventListener("pointercancel", endStripDrag);

    // Strip: mouse wheel horizontal scroll
    refs.strip?.addEventListener("wheel", (event) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      refs.strip.scrollLeft += event.deltaY;
      updateStripArrows();
    }, { passive: false });

    // Strip: scroll → update arrows
    refs.strip?.addEventListener("scroll", () => updateStripArrows(), { passive: true });

    // Strip: hover → show/hide arrows
    refs.stripWrap?.addEventListener("mouseenter", () => updateStripArrows());
    refs.stripWrap?.addEventListener("mouseleave", () => {
      if (refs.stripPrev) refs.stripPrev.hidden = true;
      if (refs.stripNext) refs.stripNext.hidden = true;
    });

    // Strip: arrow buttons
    refs.stripPrev?.addEventListener("click", () => {
      refs.strip.scrollBy({ left: -120, behavior: "smooth" });
    });
    refs.stripNext?.addEventListener("click", () => {
      refs.strip.scrollBy({ left: 120, behavior: "smooth" });
    });

    // Focal: drag to move focal point + wheel to zoom toward cursor
    refs.thumbnailWrap?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !state.items.length) return;
      state.formDirty = true;
      state.focalDragging = true;
      state.focalDragStartX = event.clientX;
      state.focalDragStartY = event.clientY;
      state.focalDragStartFX = state.focalX;
      state.focalDragStartFY = state.focalY;
      refs.thumbnailWrap.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    refs.thumbnailWrap?.addEventListener("pointermove", (event) => {
      if (!state.focalDragging) return;
      const cW = refs.thumbnailWrap.offsetWidth, cH = refs.thumbnailWrap.offsetHeight;
      const dx = event.clientX - state.focalDragStartX;
      const dy = event.clientY - state.focalDragStartY;
      state.focalX = _clampFocal(state.focalDragStartFX - dx / cW * 100 / state.focalZoom);
      state.focalY = _clampFocal(state.focalDragStartFY - dy / cH * 100 / state.focalZoom);
      updateFocalDisplay();
    });
    refs.thumbnailWrap?.addEventListener("pointerup", () => { state.focalDragging = false; });
    refs.thumbnailWrap?.addEventListener("pointercancel", () => { state.focalDragging = false; });
    refs.thumbnailWrap?.addEventListener("wheel", (event) => {
      if (!state.items.length) return;
      state.formDirty = true;
      event.preventDefault();
      const step = 0.15;
      const oldZoom = state.focalZoom;
      const newZoom = Math.round(Math.max(1.0, Math.min(8.0,
        oldZoom + (event.deltaY < 0 ? step : -step))) * 100) / 100;
      if (newZoom === oldZoom) return;
      const rect = refs.thumbnailWrap.getBoundingClientRect();
      const cx = (event.clientX - rect.left) / rect.width * 100;
      const cy = (event.clientY - rect.top) / rect.height * 100;
      // ズーム前にカーソル下の画像座標を計算し、ズーム後も同じ点がカーソル下に来るよう焦点を補正
      const imgX = state.focalX + (cx - state.focalX) / oldZoom;
      const imgY = state.focalY + (cy - state.focalY) / oldZoom;
      state.focalZoom = newZoom;
      if (newZoom > 1) {
        state.focalX = _clampFocal((imgX * newZoom - cx) / (newZoom - 1));
        state.focalY = _clampFocal((imgY * newZoom - cy) / (newZoom - 1));
      }
      updateFocalDisplay();
    }, { passive: false });

    // Title counter
    refs.titleInput?.addEventListener("input", () => {
      state.formDirty = true;
      updateTitleCounter();
      updateThumbOverlay();
    });

    // Alt text
    refs.altInput?.addEventListener("input", () => { state.formDirty = true; });

    // Shot_at manual edit
    const handleShotAtInput = () => {
      state.formDirty = true;
      state.shotAtDirty = true;
      updateShotAtBadge();
      updateThumbOverlay();
    };
    refs.shotAtDateInput?.addEventListener("input", handleShotAtInput);
    refs.shotAtTimeInput?.addEventListener("input", handleShotAtInput);

    // Visibility toggle
    refs.visInput?.addEventListener("change", () => {
      state.formDirty = true;
      updateVisLabel();
    });

    // Tag chips: remove
    refs.tagChips?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag-index]");
      if (!btn) return;
      removeTag(Number(btn.dataset.tagIndex));
    });

    // Tag box: focus input when clicking box
    refs.tagBox?.addEventListener("click", (event) => {
      if (event.target === refs.tagBox || event.target === refs.tagChips) {
        refs.tagInput?.focus();
      }
    });

    // Tag input
    refs.tagInput?.addEventListener("blur", () => {
      // Delay so suggestion item click can fire first
      setTimeout(() => closeTagSug(), 160);
    });
    refs.tagInput?.addEventListener("input", () => {
      const val = (refs.tagInput.value || "").trim();
      if (val.length >= 1) {
        openTagSugInput();
      } else {
        closeTagSug();
      }
    });
    refs.tagInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "," || event.key === "、") {
        event.preventDefault();
        const val = refs.tagInput.value;
        if (val.trim()) addTag(val);
      } else if (event.key === "Escape") {
        closeTagSug();
      } else if (event.key === "Backspace" && !refs.tagInput.value && state.tagState.length > 0) {
        removeTag(state.tagState.length - 1);
      }
    });

    // Tag add button
    refs.tagAdd?.addEventListener("click", () => {
      const val = refs.tagInput?.value || "";
      if (val.trim()) {
        addTag(val);
      } else {
        if (state.tagSugOpen && state.tagSugMode === "quick") {
          closeTagSug();
        } else {
          openTagSugQuick();
        }
      }
    });

    // Tag suggestion panel
    refs.tagSugList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag]");
      if (!btn) return;
      addTag(btn.dataset.tag);
      refs.tagInput?.focus();
    });

    // +more button
    refs.tagMoreBtn?.addEventListener("click", () => {
      closeTagSug();
      openTagBrowseModal();
    });

    // Footer
    refs.draftButton?.addEventListener("click", () => saveDraft());
    refs.loadDraftButton?.addEventListener("click", () => openDraftListModal());
    refs.submitButton?.addEventListener("click", () => submit());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function open(options = {}) {
    ensureMounted();
    if (!canOpen()) return;
    if (app.modal?.isOpen?.(MODAL_ID)) {
      app.modal.open(MODAL_ID);
      return;
    }
    state.onUploaded = options.onUploaded || null;
    updateDraftLoadButton();
    app.modal.open(MODAL_ID);
  }

  function close() {
    app.modal.close(MODAL_ID);
    resetState();
  }

  return {
    open,
    close,
    reset: resetState,
    applyTranslations
  };
}
import { languageToLocaleTag } from "../core/settings.js";
import { resolveLocalizedMessage } from "../core/i18n.js";
import { attachDatePicker } from "../core/date-picker.js";
