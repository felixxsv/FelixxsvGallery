import { createElement } from "../core/dom.js";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const MODAL_ID = "upload-modal";

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
  const ext = String(filename || "").split(".").pop()?.toLowerCase() || "";
  return ext;
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

export function createUploadModalController({ app, scope = "public" } = {}) {
  const state = {
    mounted: false,
    items: [],
    uploading: false,
    dragIndex: -1,
    shotAtAutoValue: "",
    shotAtDirty: false,
    onUploaded: null
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
                <section class="upload-modal__left">
                  <div class="upload-modal__field-title">サムネイル</div>
                  <button type="button" class="upload-modal__thumbnail" id="uploadModalThumbnailButton">
                    <img id="uploadModalThumbnailImage" class="upload-modal__thumbnail-image" alt="thumbnail" hidden>
                    <span id="uploadModalThumbnailEmpty" class="upload-modal__thumbnail-empty">No image</span>
                  </button>
                  <div class="upload-modal__field-title">画像スクロール</div>
                  <div id="uploadModalStrip" class="upload-modal__strip" aria-live="polite"></div>
                  <div id="uploadModalSummary" class="upload-modal__summary">ファイルが未選択です。</div>
                </section>
                <section class="upload-modal__right">
                  <div class="upload-modal__field-title">画像アップロード</div>
                  <div id="uploadModalDropzone" class="upload-modal__dropzone" tabindex="0" role="button" aria-label="画像を選択またはドラッグアンドドロップ">
                    <div class="upload-modal__dropzone-mark">UPLOAD</div>
                    <p class="upload-modal__dropzone-text">ここにドラッグ＆ドロップするか、クリックしてファイルを選択</p>
                    <p class="upload-modal__dropzone-sub">.png .jpg .jpeg .webp / 最大50MB / 最大20枚</p>
                    <div class="upload-modal__dropzone-actions">
                      <button id="uploadModalFileSelectButton" type="button" class="app-button app-button--primary">ファイルを選択</button>
                    </div>
                    <input id="uploadModalFileInput" class="upload-modal__file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple>
                  </div>

                  <label class="app-field">
                    <span class="app-field__label">タイトル（必須）</span>
                    <input id="uploadModalTitleInput" class="app-input" type="text" placeholder="タイトルを入力">
                  </label>

                  <label class="app-field">
                    <span class="app-field__label">説明文（ALT）</span>
                    <textarea id="uploadModalAltInput" class="app-input upload-modal__textarea" placeholder="説明文を入力"></textarea>
                  </label>

                  <label class="app-field">
                    <span class="app-field__label">撮影日時</span>
                    <input id="uploadModalShotAtInput" class="app-input" type="datetime-local" step="1">
                    <span class="app-field__hint">サムネイル画像のファイル名から自動入力します。取得できない場合は空欄のままで構いません。</span>
                  </label>

                  <label class="app-field">
                    <span class="app-field__label">タグ</span>
                    <input id="uploadModalTagsInput" class="app-input" type="text" placeholder="例: VRChat, 夜景, フレンド">
                    <span class="app-field__hint">カンマ区切りで入力します。タグ検索モーダルと下書きは次段で接続します。</span>
                  </label>

                  <label class="app-field upload-modal__visibility-field">
                    <span class="app-field__label">公開 / 非公開</span>
                    <select id="uploadModalVisibilityInput" class="app-select">
                      <option value="true">public</option>
                      <option value="false">private</option>
                    </select>
                  </label>

                  <div id="uploadModalInlineMessage" class="upload-modal__inline-message" hidden></div>
                </section>
              </div>
            </div>
            <div class="app-modal-footer app-modal-footer--end">
              <button id="uploadModalDraftButton" type="button" class="app-button app-button--ghost" hidden>下書き</button>
              <button id="uploadModalCancelButton" type="button" class="app-button app-button--ghost">キャンセル</button>
              <button id="uploadModalSubmitButton" type="button" class="app-button app-button--primary">アップロード</button>
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
    refs.thumbnailButton = document.getElementById("uploadModalThumbnailButton");
    refs.thumbnailImage = document.getElementById("uploadModalThumbnailImage");
    refs.thumbnailEmpty = document.getElementById("uploadModalThumbnailEmpty");
    refs.strip = document.getElementById("uploadModalStrip");
    refs.summary = document.getElementById("uploadModalSummary");
    refs.titleInput = document.getElementById("uploadModalTitleInput");
    refs.altInput = document.getElementById("uploadModalAltInput");
    refs.shotAtInput = document.getElementById("uploadModalShotAtInput");
    refs.tagsInput = document.getElementById("uploadModalTagsInput");
    refs.visibilityInput = document.getElementById("uploadModalVisibilityInput");
    refs.inlineMessage = document.getElementById("uploadModalInlineMessage");
    refs.cancelButton = document.getElementById("uploadModalCancelButton");
    refs.submitButton = document.getElementById("uploadModalSubmitButton");
    refs.draftButton = document.getElementById("uploadModalDraftButton");

    bindEvents();
    state.mounted = true;
    render();
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
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
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
    if (refs.fileInput) refs.fileInput.value = "";
    if (refs.titleInput) refs.titleInput.value = "";
    if (refs.altInput) refs.altInput.value = "";
    if (refs.shotAtInput) refs.shotAtInput.value = "";
    if (refs.tagsInput) refs.tagsInput.value = "";
    if (refs.visibilityInput) refs.visibilityInput.value = "true";
    setInlineMessage("");
    setSubmitting(false);
    render();
  }

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

    const accepted = [];
    const remaining = Math.max(0, MAX_FILES - state.items.length);
    if (remaining <= 0) {
      app.toast?.error?.(`画像は最大 ${MAX_FILES} 枚までです。`);
      return;
    }

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
    renderThumbnail();
  }

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
        attributes: {
          draggable: true,
          "data-index": index
        }
      });

      card.innerHTML = `
        <button type="button" class="upload-modal__strip-thumb" data-action="thumbnail" data-index="${index}" aria-label="${escapeHtml(index === 0 ? "現在のサムネイル" : "サムネイルに設定")}">
          <img src="${escapeHtml(item.objectUrl)}" alt="${escapeHtml(item.file.name || "image")}">
          ${index === 0 ? '<span class="upload-modal__strip-badge upload-modal__strip-badge--thumbnail">サムネイル</span>' : ""}
          ${dup ? '<span class="upload-modal__strip-badge upload-modal__strip-badge--dup">DUP</span>' : ""}
        </button>
        <div class="upload-modal__strip-meta">
          <div class="upload-modal__strip-name">${escapeHtml(item.file.name || "(無名ファイル)")}</div>
          <div class="upload-modal__strip-sub">${formatBytes(item.file.size)}</div>
        </div>
        <div class="upload-modal__strip-actions">
          <button type="button" class="app-button app-button--ghost upload-modal__mini-button" data-action="remove" data-index="${index}">削除</button>
        </div>
      `;
      refs.strip.appendChild(card);
    });
  }

  function render() {
    renderThumbnail();
    renderSummary();
    renderStrip();
  }

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
    const tags = refs.tagsInput?.value || "";
    const isPublic = refs.visibilityInput?.value || "true";
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
    if (shotAt) {
      formData.append("shot_at", shotAt);
    }
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

  function bindEvents() {
    refs.fileSelectButton?.addEventListener("click", () => refs.fileInput?.click());
    refs.fileInput?.addEventListener("change", async (event) => {
      await addFiles(event.target.files);
      event.target.value = "";
    });

    refs.dropzone?.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) return;
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

    refs.strip?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const index = Number(button.dataset.index || -1);
      if (button.dataset.action === "remove") {
        removeItem(index);
        return;
      }
      if (button.dataset.action === "thumbnail") {
        setThumbnail(index);
      }
    });

    refs.strip?.addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-index]");
      if (!card) return;
      state.dragIndex = Number(card.dataset.index || -1);
      card.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(state.dragIndex));
      }
    });

    refs.strip?.addEventListener("dragend", (event) => {
      event.target.closest("[data-index]")?.classList.remove("is-dragging");
      state.dragIndex = -1;
    });

    refs.strip?.addEventListener("dragover", (event) => {
      event.preventDefault();
      const card = event.target.closest("[data-index]");
      if (!card) return;
      card.classList.add("is-dragover");
    });

    refs.strip?.addEventListener("dragleave", (event) => {
      event.target.closest("[data-index]")?.classList.remove("is-dragover");
    });

    refs.strip?.addEventListener("drop", (event) => {
      event.preventDefault();
      const card = event.target.closest("[data-index]");
      if (!card) return;
      card.classList.remove("is-dragover");
      const dropIndex = Number(card.dataset.index || -1);
      if (state.dragIndex >= 0 && dropIndex >= 0) {
        moveItem(state.dragIndex, dropIndex);
      }
      state.dragIndex = -1;
    });

    refs.shotAtInput?.addEventListener("input", () => {
      state.shotAtDirty = true;
    });
    refs.cancelButton?.addEventListener("click", () => close());
    refs.submitButton?.addEventListener("click", () => submit());
    refs.draftButton?.addEventListener("click", () => {
      app.toast?.info?.("下書き機能は次段で接続します。");
    });
  }

  function open(options = {}) {
    ensureMounted();
    if (!canOpen()) return;
    state.onUploaded = options.onUploaded || null;
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
