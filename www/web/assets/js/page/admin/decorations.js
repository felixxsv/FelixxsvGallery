import { byId } from "../../core/dom.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

(function initDecorationCatalog() {
  const api = window.AdminApp?.api;
  if (!api) return;

  const state = { items: [], editId: null, pendingFile: null };

  function kindLabel(kind) {
    return kind === "icon_frame" ? "アイコンフレーム" : "プロフィール装飾";
  }

  async function loadItems() {
    try {
      const data = await api.get("/api/admin/decorations");
      state.items = (data?.data?.items) || [];
      renderTable();
    } catch (e) {
      const tbody = byId("adminDecorationsTableBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="admin-users-table__empty">取得に失敗しました。</td></tr>`;
    }
  }

  function renderTable() {
    const tbody = byId("adminDecorationsTableBody");
    if (!tbody) return;
    if (!state.items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="admin-users-table__empty">デコレーションはありません。</td></tr>`;
      return;
    }
    tbody.innerHTML = state.items.map((item) => {
      const jaLabel = (item.labels?.ja || item.labels?.en || item.label_key || "-");
      const assetInfo = item.asset_path
        ? `<span style="color:var(--color-success)">✓ ${escapeHtml(item.asset_path.split("/").pop())}</span>`
        : `<span style="color:var(--color-text-muted)">未設定</span>`;
      const activePill = item.is_active
        ? `<span class="admin-users-pill admin-users-pill--active">有効</span>`
        : `<span class="admin-users-pill admin-users-pill--inactive">無効</span>`;
      return `<tr>
        <td>${escapeHtml(kindLabel(item.decoration_kind))}</td>
        <td><code>${escapeHtml(item.decoration_key)}</code></td>
        <td>${escapeHtml(jaLabel)}</td>
        <td>${assetInfo}</td>
        <td>${item.sort_order}</td>
        <td>${activePill}</td>
        <td>
          <button class="app-button app-button--ghost" style="font-size:0.8rem;padding:4px 10px;" data-decoration-edit="${item.id}">編集</button>
          <button class="app-button app-button--ghost" style="font-size:0.8rem;padding:4px 10px;color:var(--color-danger);" data-decoration-delete="${item.id}">削除</button>
        </td>
      </tr>`;
    }).join("");
  }

  function getLabelsFromForm() {
    const labels = {};
    document.querySelectorAll(".admin-decoration-label-input").forEach((el) => {
      const lang = el.dataset.lang;
      const val = el.value.trim();
      if (lang && val) labels[lang] = val;
    });
    return labels;
  }

  function populateForm(item) {
    const kind = byId("adminDecorationKind");
    const key = byId("adminDecorationKey");
    const sortOrder = byId("adminDecorationSortOrder");
    const isActiveSwitch = byId("adminDecorationIsActiveSwitch");
    const keyField = byId("adminDecorationKeyField");
    const currentAsset = byId("adminDecorationCurrentAsset");

    if (item) {
      if (kind) kind.value = item.decoration_kind;
      if (key) key.value = item.decoration_key;
      if (keyField) keyField.style.display = "none";
      document.querySelectorAll(".admin-decoration-label-input").forEach((el) => {
        el.value = item.labels?.[el.dataset.lang] || "";
      });
      if (sortOrder) sortOrder.value = item.sort_order;
      if (isActiveSwitch) isActiveSwitch.setAttribute("aria-checked", item.is_active ? "true" : "false");
      if (currentAsset) currentAsset.textContent = item.asset_path || "未設定";
    } else {
      if (kind) kind.value = "icon_frame";
      if (key) key.value = "";
      if (keyField) keyField.style.display = "";
      document.querySelectorAll(".admin-decoration-label-input").forEach((el) => { el.value = ""; });
      if (sortOrder) sortOrder.value = "0";
      if (isActiveSwitch) isActiveSwitch.setAttribute("aria-checked", "true");
      if (currentAsset) currentAsset.textContent = "";
    }
    state.pendingFile = null;
    const assetName = byId("adminDecorationAssetName");
    if (assetName) assetName.textContent = "";
    const assetPreview = byId("adminDecorationAssetPreview");
    if (assetPreview) assetPreview.style.display = "none";
    const error = byId("adminDecorationEditError");
    if (error) { error.hidden = true; error.textContent = ""; }
  }

  function openModal(item) {
    state.editId = item ? item.id : null;
    const title = byId("adminDecorationEditTitle");
    if (title) title.textContent = item ? "デコレーション編集" : "デコレーション追加";
    populateForm(item || null);
    const modal = byId("adminDecorationEditModal");
    if (modal) modal.hidden = false;
  }

  function closeModal() {
    const modal = byId("adminDecorationEditModal");
    if (modal) modal.hidden = true;
    state.editId = null;
    state.pendingFile = null;
  }

  async function saveDecoration() {
    const error = byId("adminDecorationEditError");
    if (error) { error.hidden = true; error.textContent = ""; }
    const isActive = byId("adminDecorationIsActiveSwitch")?.getAttribute("aria-checked") !== "false";
    const payload = {
      decoration_kind: byId("adminDecorationKind")?.value,
      decoration_key: byId("adminDecorationKey")?.value?.trim(),
      labels: getLabelsFromForm(),
      sort_order: parseInt(byId("adminDecorationSortOrder")?.value || "0", 10),
      is_active: isActive,
      label_key: "",
      preview_class: "",
    };

    try {
      let data;
      if (state.editId) {
        data = await api.put(`/api/admin/decorations/${state.editId}`, payload);
      } else {
        data = await api.post("/api/admin/decorations", payload);
        if (!state.editId && data?.data?.id) {
          state.editId = data.data.id;
        }
      }
      if (state.pendingFile && state.editId) {
        const form = new FormData();
        form.append("file", state.pendingFile);
        data = await api.postForm(`/api/admin/decorations/${state.editId}/asset`, form);
      }
      state.items = data?.data?.items || state.items;
      renderTable();
      closeModal();
    } catch (e) {
      if (error) {
        error.textContent = e?.message || "保存に失敗しました。";
        error.hidden = false;
      }
    }
  }

  async function deleteDecoration(id) {
    if (!confirm("このデコレーションを削除しますか？")) return;
    try {
      const data = await api.delete(`/api/admin/decorations/${id}`);
      state.items = data?.data?.items || state.items;
      renderTable();
    } catch (e) {
      alert("削除に失敗しました。");
    }
  }

  byId("adminDecorationsAddButton")?.addEventListener("click", () => openModal(null));
  document.querySelector("[data-modal-backdrop='decoration-edit']")?.addEventListener("click", closeModal);
  byId("adminDecorationSaveButton")?.addEventListener("click", saveDecoration);
  document.querySelector("[data-modal-close='decoration-edit']")?.addEventListener("click", closeModal);

  byId("adminDecorationsTableBody")?.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-decoration-edit]");
    if (editBtn) {
      const id = parseInt(editBtn.dataset.decorationEdit, 10);
      const item = state.items.find((i) => i.id === id);
      if (item) openModal(item);
      return;
    }
    const delBtn = e.target.closest("[data-decoration-delete]");
    if (delBtn) {
      deleteDecoration(parseInt(delBtn.dataset.decorationDelete, 10));
    }
  });

  byId("adminDecorationAssetButton")?.addEventListener("click", () => {
    byId("adminDecorationAssetFile")?.click();
  });

  byId("adminDecorationAssetFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.pendingFile = file;
    const name = byId("adminDecorationAssetName");
    if (name) name.textContent = file.name;
    const preview = byId("adminDecorationAssetPreview");
    const previewImg = byId("adminDecorationAssetPreviewImg");
    if (preview && previewImg) {
      previewImg.src = URL.createObjectURL(file);
      preview.style.display = "";
    }
  });

  byId("adminDecorationIsActiveSwitch")?.addEventListener("click", (e) => {
    const sw = e.currentTarget;
    const checked = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", checked ? "true" : "false");
  });

  loadItems();
}());
