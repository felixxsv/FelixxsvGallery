function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textOrDash(value) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return textOrDash(value);
  return date.toLocaleString("ja-JP");
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1).replace(".0", "")} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1).replace(".0", "")} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / (1024 ** 3)).toFixed(1).replace(".0", "")} GB`;
  return `${(bytes / (1024 ** 4)).toFixed(1).replace(".0", "")} TB`;
}

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "-";
  return n.toLocaleString("ja-JP");
}

function formatImageSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "-";
  return `${w.toLocaleString("ja-JP")} × ${h.toLocaleString("ja-JP")}`;
}

function normalizeColorTag(item) {
  if (!item) return null;
  if (typeof item === "string") {
    return { label: item, swatch: "" };
  }
  const label = item.label || item.name || item.hex || item.color_id || "Color";
  const swatch = item.hex || item.swatch || "";
  return { label: String(label), swatch: String(swatch) };
}

export function createImageDetailModal({ host, app, onOpen = null, onClose = null, onLikeToggle = null }) {
  const overlay = document.createElement("section");
  overlay.className = "image-detail-modal";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="image-detail-modal__backdrop"></div>
    <div class="image-detail-modal__dialog" role="dialog" aria-modal="true" aria-label="画像詳細" tabindex="-1">
      <div class="image-detail-modal__header">
        <h2 class="image-detail-modal__title">画像詳細</h2>
        <div class="image-detail-modal__header-actions">
          <button type="button" class="image-detail-modal__like" aria-label="いいねする" aria-pressed="false">
            <span class="image-detail-modal__like-icon" aria-hidden="true">♡</span>
            <span class="image-detail-modal__like-count">0</span>
          </button>
          <button type="button" class="image-detail-modal__close" aria-label="詳細を閉じる">×</button>
        </div>
      </div>
      <div class="image-detail-modal__body"></div>
    </div>
  `;
  host.appendChild(overlay);

  const body = overlay.querySelector(".image-detail-modal__body");
  const closeButton = overlay.querySelector(".image-detail-modal__close");
  const likeButton = overlay.querySelector(".image-detail-modal__like");
  const likeIcon = overlay.querySelector(".image-detail-modal__like-icon");
  const likeCount = overlay.querySelector(".image-detail-modal__like-count");

  let currentDetail = null;
  let likePending = false;

  function syncLikeUi() {
    const detail = currentDetail || {};
    const authenticated = Boolean(app?.session?.getState?.()?.authenticated);
    const liked = Boolean(detail.viewer_liked);
    likeButton.classList.toggle("is-active", liked);
    likeButton.classList.toggle("is-pending", likePending);
    likeButton.disabled = likePending;
    likeButton.hidden = !authenticated;
    likeButton.setAttribute("aria-pressed", String(liked));
    likeButton.setAttribute("aria-label", liked ? "いいねを取り消す" : "いいねする");
    likeIcon.textContent = liked ? "♥" : "♡";
    likeCount.textContent = formatCount(detail.like_count ?? 0);
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    if (typeof onClose === "function") {
      onClose();
    }
  }

  function renderRow(label, value) {
    return `
      <div class="image-detail-modal__row">
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}</dd>
      </div>
    `;
  }

  function renderTagList(items) {
    if (!items?.length) return '<div class="image-detail-modal__empty">タグはありません。</div>';
    return `<div class="image-detail-modal__chips">${items.map((item) => `<span class="image-detail-modal__chip">${escapeHtml(item)}</span>`).join("")}</div>`;
  }

  function renderColorTags(items) {
    if (!items?.length) return '<div class="image-detail-modal__empty">カラータグはありません。</div>';
    return `<div class="image-detail-modal__chips image-detail-modal__chips--colors">${items.map((item) => {
      const color = normalizeColorTag(item);
      if (!color) return "";
      return `<span class="image-detail-modal__chip image-detail-modal__chip--color">${color.swatch ? `<span class="image-detail-modal__swatch" style="background:${escapeHtml(color.swatch)};"></span>` : ""}${escapeHtml(color.label)}</span>`;
    }).join("")}</div>`;
  }

  function render(detail) {
    const sessionData = app?.session?.getState?.()?.data || {};
    const currentUser = sessionData.user || sessionData || {};
    const isAdmin = currentUser.role === "admin";
    const user = detail.user || {};
    const adminMeta = detail.admin_meta || {};

    const userBlock = `
      <section class="image-detail-modal__section">
        <h3 class="image-detail-modal__section-title">投稿ユーザー</h3>
        <div class="image-detail-modal__user">
          ${user.avatar_url ? `<img class="image-detail-modal__avatar" src="${escapeHtml(user.avatar_url)}" alt="">` : `<div class="image-detail-modal__avatar image-detail-modal__avatar--fallback">${escapeHtml((user.display_name || "?").slice(0, 1))}</div>`}
          <div class="image-detail-modal__user-meta">
            <div class="image-detail-modal__user-name">${escapeHtml(textOrDash(user.display_name))}</div>
            <div class="image-detail-modal__user-id">@${escapeHtml(textOrDash(user.user_key))}</div>
          </div>
        </div>
      </section>
    `;

    const infoBlock = `
      <section class="image-detail-modal__section">
        <h3 class="image-detail-modal__section-title">基本情報</h3>
        <dl class="image-detail-modal__list">
          ${renderRow("タイトル", textOrDash(detail.title))}
          ${renderRow("説明文 (ALT)", textOrDash(detail.alt))}
          ${renderRow("投稿日", formatDateTime(detail.posted_at))}
          ${renderRow("撮影日", formatDateTime(detail.shot_at))}
          ${renderRow("データ容量", formatBytes(detail.file_size_bytes))}
          ${renderRow("画像サイズ", formatImageSize(detail.image_width, detail.image_height))}
          ${renderRow("いいね数", formatCount(detail.like_count))}
          ${renderRow("閲覧数", formatCount(detail.view_count))}
        </dl>
      </section>
    `;

    const tagsBlock = `
      <section class="image-detail-modal__section">
        <h3 class="image-detail-modal__section-title">タグ</h3>
        ${renderTagList(detail.tags || [])}
      </section>
    `;

    const colorsBlock = `
      <section class="image-detail-modal__section">
        <h3 class="image-detail-modal__section-title">カラータグ</h3>
        ${renderColorTags(detail.color_tags || [])}
      </section>
    `;

    const adminBlock = isAdmin && (adminMeta.is_public !== undefined || adminMeta.file_name || adminMeta.moderation_status)
      ? `
        <section class="image-detail-modal__section">
          <h3 class="image-detail-modal__section-title">内部メタ情報</h3>
          <dl class="image-detail-modal__list">
            ${adminMeta.is_public !== undefined ? renderRow("公開状態", adminMeta.is_public ? "公開" : "非公開") : ""}
            ${adminMeta.file_name ? renderRow("ファイル名", adminMeta.file_name) : ""}
            ${adminMeta.moderation_status ? renderRow("モデレーション状態", adminMeta.moderation_status) : ""}
          </dl>
        </section>
      `
      : "";

    body.innerHTML = `${userBlock}${infoBlock}${tagsBlock}${colorsBlock}${adminBlock}`;
    syncLikeUi();
  }

  function open(detail) {
    currentDetail = detail || {};
    likePending = false;
    render(currentDetail);
    overlay.hidden = false;
    if (typeof onOpen === "function") {
      onOpen();
    }
    overlay.querySelector(".image-detail-modal__dialog")?.focus();
  }

  function update(detail) {
    currentDetail = detail || currentDetail || {};
    if (overlay.hidden) {
      return;
    }
    render(currentDetail);
  }

  function setLikePending(pending) {
    likePending = Boolean(pending);
    if (!overlay.hidden) {
      syncLikeUi();
    }
  }

  closeButton.addEventListener("click", close);
  likeButton.addEventListener("click", () => {
    if (typeof onLikeToggle === "function") {
      onLikeToggle();
    }
  });
  overlay.querySelector(".image-detail-modal__backdrop")?.addEventListener("click", close);

  return { open, update, close, isOpen: () => !overlay.hidden, setLikePending };
}
