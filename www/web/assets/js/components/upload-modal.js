import { createElement } from "../core/dom.js";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;
const TITLE_MAX = 100;
const ACCEPTED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MODAL_ID = "upload-modal";
const DRAFT_KEY = "gallery.upload.draft.v1";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    focalX: 50,
    focalY: 50,
    focalDragging: false,
    stripDragActive: false,
    stripDragIndex: -1,
    stripInsertIndex: -1,
    stripPointerId: -1,
    stripDragOffsetX: 0,
    stripDragOffsetY: 0,
    stripDragGhost: null
  };

  const refs = {};

  function root() {
    return document.getElementById("appModalRoot");
  }

  function ensureMounted() {
    if (state.mounted) return;
    const modalRoot = root();
    if (!modalRoot) {
      throw new Error("appModalRoot が見つかりません。");
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
              <h2 id="uploadModalTitle" class="app-modal-title">画像をアップロード</h2>
            </div>
            <div class="app-modal-body upload-modal">
              <div class="upload-modal__layout">

                <!-- 上段: サムネイル + 画像追加 (1:1) -->
                <div class="upload-modal__top">
                  <div class="upload-modal__thumb-col">
                    <div class="upload-modal__field-label">サムネイル / 表示位置</div>
                    <div class="upload-modal__thumbnail-wrap" id="uploadModalThumbnailWrap">
                      <img id="uploadModalThumbnailImage" class="upload-modal__thumbnail-image" alt="thumbnail" hidden>
                      <div id="uploadModalThumbnailEmpty" class="upload-modal__thumbnail-empty">NO IMAGE</div>
                      <div class="upload-modal__focal-crosshair" id="uploadModalFocalCrosshair" hidden></div>
                      <div class="upload-modal__thumb-overlay" id="uploadModalThumbOverlay" hidden>
                        <span class="upload-modal__thumb-overlay-title" id="uploadModalThumbTitle"></span>
                        <span class="upload-modal__thumb-overlay-time" id="uploadModalThumbTime"></span>
                      </div>
                    </div>
                  </div>
                  <div class="upload-modal__drop-col">
                    <div class="upload-modal__field-label">画像追加</div>
                    <div id="uploadModalDropzone" class="upload-modal__dropzone" tabindex="0" role="button" aria-label="画像を選択またはドラッグアンドドロップ">
                      <div class="upload-modal__dropzone-icon">↑</div>
                      <p class="upload-modal__dropzone-text">ドラッグ＆ドロップ / クリックで選択</p>
                      <p class="upload-modal__dropzone-sub">.png .jpg .jpeg .webp / 最大50MB / 最大20枚</p>
                      <div class="upload-modal__dropzone-actions">
                        <button id="uploadModalFileSelectButton" type="button" class="app-button app-button--primary">ファイルを選択</button>
                      </div>
                      <input id="uploadModalFileInput" class="upload-modal__file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple>
                    </div>
                  </div>
                </div>

                <!-- 中段: 画像一覧 -->
                <div class="upload-modal__strip-section">
                  <div class="upload-modal__field-label">画像一覧</div>
                  <div class="upload-modal__strip-wrap" id="uploadModalStripWrap">
                    <button type="button" class="upload-modal__strip-arrow upload-modal__strip-arrow--prev" id="uploadModalStripPrev" hidden aria-label="前へ">&#8249;</button>
                    <div id="uploadModalStrip" class="upload-modal__strip" aria-live="polite"></div>
                    <button type="button" class="upload-modal__strip-arrow upload-modal__strip-arrow--next" id="uploadModalStripNext" hidden aria-label="次へ">&#8250;</button>
                  </div>
                  <div id="uploadModalSummary" class="upload-modal__summary">ファイルが未選択です。</div>
                </div>

                <!-- 下段: フォーム -->
                <div class="upload-modal__fields">
                  <label class="app-field">
                    <span class="app-field__label">タイトル <span class="upload-modal__required">*</span></span>
                    <div class="upload-modal__input-row">
                      <input id="uploadModalTitleInput" class="app-input" type="text" placeholder="タイトルを入力" maxlength="${TITLE_MAX}">
                      <span id="uploadModalTitleCounter" class="upload-modal__counter">0/${TITLE_MAX}</span>
                    </div>
                  </label>

                  <label class="app-field">
                    <span class="app-field__label">説明文（ALT）</span>
                    <textarea id="uploadModalAltInput" class="app-input upload-modal__textarea" placeholder="説明文を入力"></textarea>
                  </label>

                  <div class="upload-modal__row">
                    <label class="app-field">
                      <span class="app-field__label">
                        撮影日時
                        <span id="uploadModalShotAtBadge" class="upload-modal__auto-badge" hidden>AUTO</span>
                      </span>
                      <input id="uploadModalShotAtInput" class="app-input" type="datetime-local" step="1">
                    </label>
                    <div class="app-field">
                      <span class="app-field__label">タグ</span>
                      <div class="upload-modal__tag-box" id="uploadModalTagBox">
                        <div class="upload-modal__tag-scroll" id="uploadModalTagChips"></div>
                        <input class="upload-modal__tag-input" id="uploadModalTagInput" type="text" placeholder="タグを追加…" autocomplete="off">
                        <button type="button" class="upload-modal__tag-add" id="uploadModalTagAdd" aria-label="タグを追加">+</button>
                        <div class="upload-modal__tag-sug" id="uploadModalTagSug" hidden>
                          <div class="upload-modal__tag-sug-list" id="uploadModalTagSugList"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <label class="upload-modal__vis-toggle" for="uploadModalVisInput">
                    <input type="checkbox" class="upload-modal__vis-input" id="uploadModalVisInput" checked>
                    <span class="upload-modal__vis-track">
                      <span class="upload-modal__vis-thumb"></span>
                    </span>
                    <span class="upload-modal__vis-label" id="uploadModalVisLabel">公開</span>
                  </label>

                  <div id="uploadModalInlineMessage" class="upload-modal__inline-message" hidden></div>
                </div>

              </div>
            </div>
            <div class="app-modal-footer upload-modal__footer">
              <button id="uploadModalDraftButton" type="button" class="app-button app-button--ghost">下書き保存</button>
              <div class="upload-modal__footer-actions">
                <button id="uploadModalCancelButton" type="button" class="app-button app-button--ghost">キャンセル</button>
                <button id="uploadModalSubmitButton" type="button" class="app-button app-button--primary">アップロード</button>
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
    refs.shotAtInput = document.getElementById("uploadModalShotAtInput");
    refs.shotAtBadge = document.getElementById("uploadModalShotAtBadge");
    refs.tagBox = document.getElementById("uploadModalTagBox");
    refs.tagChips = document.getElementById("uploadModalTagChips");
    refs.tagInput = document.getElementById("uploadModalTagInput");
    refs.tagAdd = document.getElementById("uploadModalTagAdd");
    refs.tagSug = document.getElementById("uploadModalTagSug");
    refs.tagSugList = document.getElementById("uploadModalTagSugList");
    refs.visInput = document.getElementById("uploadModalVisInput");
    refs.visLabel = document.getElementById("uploadModalVisLabel");
    refs.inlineMessage = document.getElementById("uploadModalInlineMessage");
    refs.cancelButton = document.getElementById("uploadModalCancelButton");
    refs.submitButton = document.getElementById("uploadModalSubmitButton");
    refs.draftButton = document.getElementById("uploadModalDraftButton");

    bindEvents();
    loadTagPool();
    state.mounted = true;
    render();
  }

  // ── Thumbnail overlay ─────────────────────────────────────────────────────

  function updateThumbOverlay() {
    if (!refs.thumbOverlay) return;
    const title = refs.titleInput?.value?.trim() || "";
    const time = refs.shotAtInput?.value || "";
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

  function updateFocalDisplay() {
    const first = state.items[0];
    const hasImage = Boolean(first);

    // サムネイル画像に focal position を反映
    if (refs.thumbnailImage) {
      refs.thumbnailImage.style.objectPosition = hasImage
        ? `${state.focalX}% ${state.focalY}%`
        : "";
    }
    // クロスヘア表示
    if (refs.focalCrosshair) {
      refs.focalCrosshair.hidden = !hasImage;
      if (hasImage) {
        refs.focalCrosshair.style.left = `${state.focalX}%`;
        refs.focalCrosshair.style.top = `${state.focalY}%`;
      }
    }
    // ドラッグカーソル切り替え
    if (refs.thumbnailWrap) {
      refs.thumbnailWrap.classList.toggle("is-focal-active", hasImage);
    }
  }

  function focalPointerToPercent(event) {
    const rect = refs.thumbnailWrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * 100;
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * 100;
    state.focalX = Math.round(x * 10) / 10;
    state.focalY = Math.round(y * 10) / 10;
    updateFocalDisplay();
  }

  // ── Tag pool ──────────────────────────────────────────────────────────────

  async function loadTagPool() {
    try {
      const response = await fetch(`${app.appBase}/api/tags`, { credentials: "include" });
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      const tags = Array.isArray(payload?.tags) ? payload.tags : Array.isArray(payload) ? payload : [];
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
    if (refs.tagInput) refs.tagInput.value = "";
    renderTagChips();
    closeTagSug();
  }

  function removeTag(index) {
    state.tagState.splice(index, 1);
    renderTagChips();
  }

  function renderTagChips() {
    if (!refs.tagChips) return;
    refs.tagChips.innerHTML = "";
    state.tagState.forEach((tag, i) => {
      const chip = createElement("span", { className: "upload-modal__tag-chip" });
      chip.innerHTML = `${escapeHtml(tag)}<button type="button" data-tag-index="${i}" aria-label="${escapeHtml(tag)}を削除">\u00d7</button>`;
      refs.tagChips.appendChild(chip);
    });
  }

  function renderTagSug() {
    if (!refs.tagSugList) return;
    const query = (refs.tagInput?.value || "").trim().toLowerCase();
    const filtered = state.tagPool
      .filter((t) => !state.tagState.includes(t) && (query === "" || t.includes(query)))
      .slice(0, 30);
    refs.tagSugList.innerHTML = "";
    for (const tag of filtered) {
      const btn = createElement("button", {
        className: "upload-modal__tag-sug-item",
        attributes: { type: "button", "data-tag": tag }
      });
      btn.textContent = tag;
      refs.tagSugList.appendChild(btn);
    }
    if (refs.tagSug) refs.tagSug.hidden = filtered.length === 0;
  }

  function openTagSug() {
    state.tagSugOpen = true;
    renderTagSug();
  }

  function closeTagSug() {
    state.tagSugOpen = false;
    if (refs.tagSug) refs.tagSug.hidden = true;
  }

  // ── Draft ─────────────────────────────────────────────────────────────────

  function saveDraft() {
    const draft = {
      title: refs.titleInput?.value || "",
      alt: refs.altInput?.value || "",
      shotAt: refs.shotAtInput?.value || "",
      tags: [...state.tagState],
      isPublic: refs.visInput?.checked ?? true,
      focalX: state.focalX,
      focalY: state.focalY,
      savedAt: Date.now(),
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
    app.toast?.info?.("下書きを保存しました。");
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (refs.titleInput) refs.titleInput.value = draft.title || "";
      if (refs.altInput) refs.altInput.value = draft.alt || "";
      if (refs.shotAtInput && draft.shotAt) {
        refs.shotAtInput.value = draft.shotAt;
        state.shotAtDirty = true;
      }
      if (typeof draft.focalX === "number") state.focalX = draft.focalX;
      if (typeof draft.focalY === "number") state.focalY = draft.focalY;
      if (Array.isArray(draft.tags)) {
        state.tagState = draft.tags.filter((t) => typeof t === "string" && t.trim());
        renderTagChips();
      }
      if (refs.visInput) refs.visInput.checked = draft.isPublic !== false;
      updateTitleCounter();
      updateVisLabel();
      updateShotAtBadge();
    } catch {}
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
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
    refs.visLabel.textContent = refs.visInput.checked ? "公開" : "非公開";
  }

  function updateShotAtBadge() {
    if (!refs.shotAtBadge) return;
    refs.shotAtBadge.hidden = !state.shotAtAutoValue;
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
      refs.submitButton.textContent = state.uploading ? "アップロード中..." : "アップロード";
    }
    if (refs.cancelButton) refs.cancelButton.disabled = state.uploading;
    if (refs.fileSelectButton) refs.fileSelectButton.disabled = state.uploading;
    if (refs.fileInput) refs.fileInput.disabled = state.uploading;
    if (refs.draftButton) refs.draftButton.disabled = state.uploading;
  }

  function currentUser() {
    return app.session?.getState?.()?.data?.user || null;
  }

  function canOpen() {
    const authenticated = Boolean(app.session?.getState?.()?.authenticated);
    if (!authenticated && scope === "public") {
      window.location.href = buildAuthUrl(app.appBase || "/gallery");
      return false;
    }
    const user = currentUser();
    if (scope === "public" && authenticated && user && user.upload_enabled === false) {
      app.toast?.warning?.("現在、画像投稿は無効化されています。");
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
    state.focalDragging = false;
    removeStripGhost();
    state.stripDragActive = false;
    state.stripDragIndex = -1;
    state.stripInsertIndex = -1;
    state.stripPointerId = -1;
    if (refs.fileInput) refs.fileInput.value = "";
    if (refs.titleInput) refs.titleInput.value = "";
    if (refs.altInput) refs.altInput.value = "";
    if (refs.shotAtInput) refs.shotAtInput.value = "";
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
  }

  function syncDuplicateFlags() {
    const seen = new Map();
    for (const item of state.items) {
      item.duplicate = false;
      item.serverDuplicate = false;
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
      app.toast?.error?.(`画像は最大 ${MAX_FILES} 枚までです。`);
      return;
    }

    const accepted = [];
    for (const file of incoming) {
      if (accepted.length >= remaining) break;
      const ext = extractExtension(file.name);
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        app.toast?.error?.(`${file.name} は対応していない形式です。`);
        continue;
      }
      if (Number(file.size || 0) > MAX_FILE_BYTES) {
        app.toast?.error?.(`${file.name} は 50MB を超えています。`);
        continue;
      }
      accepted.push(file);
    }

    if (incoming.length > remaining) {
      app.toast?.warning?.(`画像は最大 ${MAX_FILES} 枚までです。先頭 ${remaining} 枚のみ追加しました。`);
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
    if (!refs.shotAtInput) return;
    const current = refs.shotAtInput.value || "";
    if (!state.shotAtDirty || current === state.shotAtAutoValue) {
      refs.shotAtInput.value = nextAuto;
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
    refs.thumbnailImage.alt = first.file.name || "thumbnail";
    refs.thumbnailEmpty.hidden = true;
  }

  function renderSummary() {
    if (!refs.summary) return;
    if (!state.items.length) {
      refs.summary.textContent = "ファイルが未選択です。";
      return;
    }
    const totalBytes = state.items.reduce((sum, item) => sum + Number(item.file?.size || 0), 0);
    const dupCount = state.items.filter((item) => item.duplicate || item.serverDuplicate).length;
    const parts = [`${state.items.length} 枚`, `合計 ${formatBytes(totalBytes)}`];
    if (dupCount > 0) parts.push(`DUP ${dupCount} 枚`);
    refs.summary.textContent = parts.join(" / ");
  }

  function renderStrip() {
    if (!refs.strip) return;
    if (state.stripDragActive) return; // ドラッグ中は再描画しない
    refs.strip.innerHTML = "";
    if (!state.items.length) {
      const empty = createElement("div", {
        className: "upload-modal__strip-empty",
        text: "画像を追加するとここに表示されます。"
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
        <div class="upload-modal__strip-thumb" data-action="thumbnail" data-index="${index}" role="button" tabindex="0" aria-label="${escapeHtml(index === 0 ? "現在のサムネイル" : "サムネイルに設定")}">
          <img src="${escapeHtml(item.objectUrl)}" alt="${escapeHtml(item.file.name || "image")}">
          ${index === 0 ? '<span class="upload-modal__strip-badge upload-modal__strip-badge--thumbnail">THUMB</span>' : ""}
          ${dup ? '<span class="upload-modal__strip-badge upload-modal__strip-badge--dup">DUP</span>' : ""}
          <button type="button" class="upload-modal__strip-rm" data-action="remove" data-index="${index}" aria-label="削除">\u00d7</button>
        </div>
        <div class="upload-modal__strip-name">${escapeHtml(item.file.name || "(無名ファイル)")}</div>
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

  // ── Upload ────────────────────────────────────────────────────────────────

  function collectDuplicateMessageFromPayload(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const first = items.find((item) => item?.duplicate);
    if (!first) return "重複画像が検出されたため、アップロードを中止しました。";
    const order = Number(first.index ?? 0) + 1;
    return `${order}枚目の画像がすでにアップロードされています。`;
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
    const shotAt = refs.shotAtInput?.value || "";

    if (!title) {
      const message = "タイトルを入力してください。";
      setInlineMessage(message, "error");
      app.toast?.error?.(message);
      return;
    }
    if (!state.items.length) {
      const message = "画像を選択してください。";
      setInlineMessage(message, "error");
      app.toast?.error?.(message);
      return;
    }

    const localDupIndex = state.items.findIndex((item) => item.duplicate);
    if (localDupIndex >= 0) {
      const message = `${localDupIndex + 1}枚目の画像が重複しています。`;
      setInlineMessage(message, "error");
      app.toast?.error?.(message);
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
        throw new Error(payload?.error?.message || payload?.detail || payload?.message || "アップロードに失敗しました。");
      }
      if (payload.has_duplicates) {
        applyServerDuplicateFlags(payload);
        const message = collectDuplicateMessageFromPayload(payload);
        setInlineMessage(message, "error");
        app.toast?.error?.(message);
        return;
      }

      const createdCount = Number(payload.count || state.items.length || 0);
      const successMessage = createdCount > 0 ? `${createdCount} 枚の画像をアップロードしました。` : "アップロードが完了しました。";
      setInlineMessage(successMessage, "success");
      app.toast?.success?.(successMessage);
      clearDraft();
      const uploadedCallback = state.onUploaded;
      close();
      if (typeof uploadedCallback === "function") {
        await uploadedCallback(payload);
      }
    } catch (error) {
      const message = error?.message || "アップロードに失敗しました。";
      setInlineMessage(message, "error");
      app.toast?.error?.(message);
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
      let toIndex = state.stripInsertIndex;
      // insertIndexはdragIndexを除いたリスト上の位置なので、元の配列インデックスに変換
      if (toIndex > fromIndex) toIndex -= 1;

      removeStripGhost();
      refs.strip.classList.remove("is-strip-dragging");
      state.stripDragActive = false;
      state.stripDragIndex = -1;
      state.stripInsertIndex = -1;
      state.stripPointerId = -1;

      if (toIndex !== fromIndex && toIndex >= 0) {
        moveItem(fromIndex, toIndex);
      } else {
        renderStrip(); // キャンセル時は再描画してリセット
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

    // Focal: drag to set position (directly on thumbnail wrap)
    refs.thumbnailWrap?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !state.items.length) return;
      state.focalDragging = true;
      refs.thumbnailWrap.setPointerCapture(event.pointerId);
      focalPointerToPercent(event);
    });
    refs.thumbnailWrap?.addEventListener("pointermove", (event) => {
      if (!state.focalDragging) return;
      focalPointerToPercent(event);
    });
    refs.thumbnailWrap?.addEventListener("pointerup", () => { state.focalDragging = false; });
    refs.thumbnailWrap?.addEventListener("pointercancel", () => { state.focalDragging = false; });

    // Title counter
    refs.titleInput?.addEventListener("input", () => {
      updateTitleCounter();
      updateThumbOverlay();
    });

    // Shot_at manual edit
    refs.shotAtInput?.addEventListener("input", () => {
      state.shotAtDirty = true;
      updateShotAtBadge();
      updateThumbOverlay();
    });

    // Visibility toggle
    refs.visInput?.addEventListener("change", () => updateVisLabel());

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
    refs.tagInput?.addEventListener("focus", () => openTagSug());
    refs.tagInput?.addEventListener("blur", () => {
      // Delay so suggestion item click can fire first
      setTimeout(() => closeTagSug(), 160);
    });
    refs.tagInput?.addEventListener("input", () => {
      if (state.tagSugOpen) renderTagSug();
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
        openTagSug();
      }
    });

    // Tag suggestion panel
    refs.tagSugList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tag]");
      if (!btn) return;
      addTag(btn.dataset.tag);
      refs.tagInput?.focus();
    });

    // Footer
    refs.draftButton?.addEventListener("click", () => saveDraft());
    refs.cancelButton?.addEventListener("click", () => close());
    refs.submitButton?.addEventListener("click", () => submit());
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function open(options = {}) {
    ensureMounted();
    if (!canOpen()) return;
    state.onUploaded = options.onUploaded || null;
    loadDraft();
    app.modal.open(MODAL_ID);
  }

  function close() {
    app.modal.close(MODAL_ID);
    resetState();
  }

  return {
    open,
    close,
    reset: resetState
  };
}
