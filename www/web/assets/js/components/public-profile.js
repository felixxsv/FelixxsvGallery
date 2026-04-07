import { byId } from "../core/dom.js";

const PROFILE_MESSAGES = {
  ja: {
    loading: "読み込み中...",
    not_found: "ユーザーが見つかりませんでした。",
  },
  "en-us": {
    loading: "Loading...",
    not_found: "User not found.",
  },
};

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
    return `/gallery/assets/icons/social/${slug}.svg`;
  } catch {
    return `/gallery/assets/icons/social/_default.svg`;
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
  Object.entries(PROFILE_MESSAGES).forEach(([locale, messages]) => {
    app.i18n?.define?.(locale, Object.fromEntries(Object.entries(messages).map(([key, value]) => [`public_profile.${key}`, value])));
  });
  ["de", "fr", "ru", "es", "zh-cn", "ko"].forEach((locale) => {
    app.i18n?.define?.(locale, Object.fromEntries(Object.entries(PROFILE_MESSAGES["en-us"]).map(([key, value]) => [`public_profile.${key}`, value])));
  });

  const refs = {
    loading: byId("userProfileLoading"),
    error: byId("userProfileError"),
    content: byId("userProfileContent"),
    avatar: byId("userProfileAvatar"),
    avatarImg: byId("userProfileAvatarImg"),
    displayName: byId("userProfileDisplayName"),
    userKey: byId("userProfileUserKey"),
    bio: byId("userProfileBio"),
    links: byId("userProfileLinks"),
    badges: byId("userProfileBadges"),
  };

  if (!refs.loading) return;

  function t(key, fallback) {
    return app.i18n?.t?.(`public_profile.${key}`, fallback) || fallback;
  }

  function applyStaticTranslations() {
    refs.loading.textContent = t("loading", "Loading...");
    refs.error.textContent = t("not_found", "User not found.");
  }

  applyStaticTranslations();
  window.addEventListener("gallery:language-changed", applyStaticTranslations);

  async function openProfile(userKey) {
    const normalizedUserKey = normalizeUserKey(userKey);
    if (!normalizedUserKey) return;

    refs.loading.hidden = false;
    refs.error.hidden = true;
    refs.content.hidden = true;

    app.modal.open("user-profile");

    try {
      const result = await app.api.get(`/api/users/${encodeURIComponent(normalizedUserKey)}`);
      const user = result.user || {};

      refs.displayName.textContent = user.display_name || "-";
      refs.userKey.textContent = `@${user.user_key || "-"}`;

      const avatarUrl = user.avatar_url || null;
      if (avatarUrl) {
        refs.avatarImg.src = `${app.appBase}${avatarUrl}?t=${Date.now()}`;
        refs.avatarImg.hidden = false;
        refs.avatar.classList.add("has-avatar");
      } else {
        refs.avatarImg.src = "";
        refs.avatarImg.hidden = true;
        refs.avatar.classList.remove("has-avatar");
      }

      const bio = (user.bio || "").trim();
      if (bio) {
        refs.bio.textContent = bio;
        refs.bio.hidden = false;
      } else {
        refs.bio.hidden = true;
      }

      // Links (always show container, max 5 slots reserved)
      const links = user.links || [];
      if (refs.links) {
        refs.links.hidden = false;
        refs.links.innerHTML = links.slice(0, 5).map((link) => {
          const iconUrl = getLinkIconUrl(link.url);
          return `<a class="shell-user-link" href="${link.url}" target="_blank" rel="noopener noreferrer" title="${link.url}"><span class="shell-user-link__icon" style="--link-icon: url('${iconUrl}')"></span></a>`;
        }).join("");
      }

      // Badges
      const badges = Array.isArray(user.badges) ? user.badges : [];
      if (refs.badges) {
        refs.badges.innerHTML = "";
        refs.badges.hidden = badges.length === 0;
        for (const badge of badges.slice(0, 3)) {
          const el = document.createElement("span");
          el.className = `user-profile-badge user-profile-badge--${badge.color || "gray"}`;
          el.title = badge.description || badge.name || "";
          el.innerHTML = getBadgeIconHtml(badge, app.appBase);
          refs.badges.appendChild(el);
        }
      }

      refs.loading.hidden = true;
      refs.content.hidden = false;
    } catch {
      refs.loading.hidden = true;
      refs.error.hidden = false;
    }
  }

  document.addEventListener("app:open-user-profile", (event) => {
    const userKey = normalizeUserKey(event.detail?.userKey);
    if (userKey) openProfile(userKey);
  });

  return { openProfile };
}

export function dispatchOpenUserProfile(userKey) {
  const normalizedUserKey = normalizeUserKey(userKey);
  if (!normalizedUserKey) return;
  document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey: normalizedUserKey } }));
}
