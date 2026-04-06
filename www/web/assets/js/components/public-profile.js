import { byId } from "../core/dom.js";

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

export function initPublicProfileModal(app) {
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

  async function openProfile(userKey) {
    if (!userKey) return;

    refs.loading.hidden = false;
    refs.error.hidden = true;
    refs.content.hidden = true;

    app.modal.open("user-profile");

    try {
      const result = await app.api.get(`/api/users/${encodeURIComponent(userKey)}`);
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
          el.textContent = badge.name || badge.key;
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
    const userKey = event.detail?.userKey;
    if (userKey) openProfile(userKey);
  });

  return { openProfile };
}

export function dispatchOpenUserProfile(userKey) {
  if (!userKey) return;
  document.dispatchEvent(new CustomEvent("app:open-user-profile", { detail: { userKey } }));
}
