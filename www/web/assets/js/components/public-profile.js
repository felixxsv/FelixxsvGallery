import { byId } from "../core/dom.js";
import { resolveBadgeText } from "../core/badge-i18n.js";

const LINK_ICON_MAP = {
  "x.com": "x",
  "twitter.com": "x",
  "discord.com": "discord",
  "discord.gg": "discord",
  "pixiv.net": "pixiv",
  "instagram.com": "instagram",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "bsky.app": "bluesky",
  "bsky.social": "bluesky",
  "misskey.io": "misskey",
  "github.com": "github",
  "tiktok.com": "tiktok",
  "threads.net": "threads",
  "mastodon.social": "mastodon",
  "pawoo.net": "mastodon",
  "fosstodon.org": "mastodon",
  "mstdn.jp": "mastodon",
  "tumblr.com": "tumblr",
  "patreon.com": "patreon",
  "twitch.tv": "twitch",
  "note.com": "note",
  "nicovideo.jp": "niconico",
  "nico.ms": "niconico",
  "zenn.dev": "zenn",
  "facebook.com": "facebook",
};

function getLinkIconUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const slug = LINK_ICON_MAP[hostname] ?? "_default";
    return `/assets/icons/social/${slug}.svg`;
  } catch {
    return `/assets/icons/social/_default.svg`;
  }
}

const BADGE_DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='8' r='6'/%3E%3Cpath d='M8 14l-3 7 7-3 7 3-3-7'/%3E%3C/svg%3E";

function normalizeUserKey(value) {
  const userKey = typeof value === "string" ? value.trim() : "";
  return userKey && userKey !== "-" ? userKey : "";
}

function getBadgeIconHtml(badge, appBase) {
  if (!badge.icon) return `<img class="badge-icon" src="${BADGE_DEFAULT_ICON}" alt="" aria-hidden="true">`;
  const src = `${appBase}/assets/images/badges/${badge.icon}`;
  return `<img class="badge-icon" src="${src}" alt="" aria-hidden="true" onerror="this.onerror=null;this.src=window._BADGE_DEFAULT_ICON">`;
}

export function initPublicProfileModal(app) {
  const refs = {
    loading: byId("userProfileLoading"),
    error: byId("userProfileError"),
    content: byId("userProfileContent"),
    avatar: byId("userProfileAvatar"),
    avatarInitial: byId("userProfileAvatarInitial"),
    avatarImg: byId("userProfileAvatarImg"),
    displayName: byId("userProfileDisplayName"),
    userKey: byId("userProfileUserKey"),
    bio: byId("userProfileBio"),
    bioEmpty: byId("userProfileBioEmpty"),
    links: byId("userProfileLinks"),
    linksSection: byId("userProfileLinksSection"),
    badges: byId("userProfileBadges"),
    badgesSection: byId("userProfileBadgesSection"),
    footer: byId("userProfileFooter"),
    filterButton: byId("userProfileFilterButton"),
  };

  if (!refs.loading) return;

  let currentUser = null;

  function t(key, fallback) {
    return app.i18n?.t?.(`public_profile.${key}`, fallback) || fallback;
  }

  function applyStaticTranslations() {
    const title = byId("userProfileTitle");
    if (title) title.textContent = t("title", "Profile");
    refs.loading.textContent = t("loading", "Loading...");
    refs.error.textContent = t("not_found", "User not found.");
    if (refs.filterButton) refs.filterButton.textContent = t("view_posts", "投稿を見る");
    if (refs.bioEmpty) refs.bioEmpty.textContent = t("no_bio", "まだ書かれていません");
    document.querySelectorAll("[data-i18n='public_profile.bio_label']").forEach(el => { el.textContent = t("bio_label", "ひとこと"); });
    document.querySelectorAll("[data-i18n='public_profile.links_label']").forEach(el => { el.textContent = t("links_label", "リンク"); });
    document.querySelectorAll("[data-i18n='public_profile.badges_label']").forEach(el => { el.textContent = t("badges_label", "バッジ"); });
  }

  applyStaticTranslations();
  window.addEventListener("gallery:language-changed", applyStaticTranslations);

  async function openProfile(userKey) {
    const normalizedUserKey = normalizeUserKey(userKey);
    if (!normalizedUserKey) return;

    refs.loading.hidden = false;
    refs.error.hidden = true;
    refs.content.hidden = true;
    if (refs.footer) refs.footer.hidden = true;

    app.modal.open("user-profile");

    try {
      const result = await app.api.get(`/api/users/${encodeURIComponent(normalizedUserKey)}`);
      const user = result.user || {};

      refs.displayName.textContent = user.display_name || "-";
      refs.userKey.textContent = `@${user.user_key || "-"}`;

      // Avatar + initial
      const avatarUrl = user.avatar_url || null;
      const initial = (user.display_name || user.user_key || "?")[0].toUpperCase();
      if (avatarUrl) {
        refs.avatarImg.src = `${app.appBase}${avatarUrl}?t=${Date.now()}`;
        refs.avatarImg.hidden = false;
        refs.avatar.classList.add("has-avatar");
        if (refs.avatarInitial) refs.avatarInitial.textContent = "";
      } else {
        refs.avatarImg.src = "";
        refs.avatarImg.hidden = true;
        refs.avatar.classList.remove("has-avatar");
        if (refs.avatarInitial) refs.avatarInitial.textContent = initial;
      }

      // Bio
      const bio = (user.bio || "").trim();
      if (bio) {
        refs.bio.textContent = bio;
        refs.bio.hidden = false;
        if (refs.bioEmpty) refs.bioEmpty.hidden = true;
      } else {
        refs.bio.hidden = true;
        if (refs.bioEmpty) refs.bioEmpty.hidden = false;
      }

      // Links
      const links = user.links || [];
      if (refs.linksSection) refs.linksSection.hidden = links.length === 0;
      if (refs.links) {
        refs.links.innerHTML = links.slice(0, 5).map((link) => {
          const iconUrl = getLinkIconUrl(link.url);
          return `<a class="shell-user-link" href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.url}"><span class="shell-user-link__icon" style="--link-icon: url('${iconUrl}')"></span></a>`;
        }).join("");
      }

      // Badges
      const badges = Array.isArray(user.badges) ? user.badges : [];
      currentUser = user;
      if (refs.badgesSection) refs.badgesSection.hidden = badges.length === 0;
      if (refs.badges) {
        refs.badges.innerHTML = "";
        for (const badge of badges.slice(0, 3)) {
          const el = document.createElement("span");
          el.className = `user-profile-badge user-profile-badge--${badge.color || "gray"}`;
          el.title = resolveBadgeText(app.i18n, badge, "description") || resolveBadgeText(app.i18n, badge, "name") || "";
          el.innerHTML = getBadgeIconHtml(badge, app.appBase);
          refs.badges.appendChild(el);
        }
      }

      refs.loading.hidden = true;
      refs.content.hidden = false;
      if (refs.footer) refs.footer.hidden = false;
      if (refs.filterButton) {
        refs.filterButton.dataset.userKey = user.user_key || "";
        refs.filterButton.dataset.displayName = user.display_name || "";
      }
    } catch {
      refs.loading.hidden = true;
      refs.error.hidden = false;
    }
  }

  refs.filterButton?.addEventListener("click", () => {
    const userKey = refs.filterButton.dataset.userKey;
    const displayName = refs.filterButton.dataset.displayName;
    if (!userKey) return;
    app.modal.close("user-profile");
    document.dispatchEvent(new CustomEvent("app:filter-by-owner", { detail: { userKey, displayName } }));
  });

  document.addEventListener("app:open-user-profile", (event) => {
    const userKey = normalizeUserKey(event.detail?.userKey);
    if (userKey) openProfile(userKey);
  });

  window.addEventListener("gallery:language-changed", () => {
    applyStaticTranslations();
    if (!currentUser || refs.content.hidden) return;
    const badges = Array.isArray(currentUser.badges) ? currentUser.badges : [];
    if (refs.badges) {
      refs.badges.innerHTML = "";
      refs.badges.hidden = badges.length === 0;
      for (const badge of badges.slice(0, 3)) {
        const el = document.createElement("span");
        el.className = `user-profile-badge user-profile-badge--${badge.color || "gray"}`;
        el.title = resolveBadgeText(app.i18n, badge, "description") || resolveBadgeText(app.i18n, badge, "name") || "";
        el.innerHTML = getBadgeIconHtml(badge, app.appBase);
        refs.badges.appendChild(el);
      }
    }
  });

  return { openProfile };
}

export function dispatchOpenUserProfile(userKey) {
  const normalizedUserKey = normalizeUserKey(userKey);
  if (!normalizedUserKey) return;
  document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey: normalizedUserKey } }));
}
