// Story data and a small story viewer.
//
// Instagram's own viewer, opened by link, only knows the one account: it
// closes after that account's last story and cannot load ahead. This viewer
// plays a whole row of accounts in order and preloads what comes next.
const Sinsta = (() => {
  'use strict';

  const APP_ID = '936619743392459'; // Instagram's public web app id
  // The persisted GraphQL queries Instagram's own story viewer uses. If
  // Instagram retires them, opening a story falls back to its viewer.
  const DOC_REELS = '28739385832429456'; // PolarisStoriesV3ReelPageStandaloneQuery
  const DOC_SEEN = '26234228992942885'; // PolarisStoriesV3SeenMutation
  const DOC_FAV = '27833939016209017'; // usePolarisUpdateFeedFavoritesMutation
  const DOC_BADGE = '26853171684350625'; // usePolarisNotificationsNavItemQuery
  const DOC_FEED = '29639616438977013'; // PolarisFeedRootPaginationCachedQuery_subscribe
  const DOC_CLIPS = '29386172244354956'; // PolarisClipsTabDesktopPaginationQuery
  const DOC_LIKE = '27182485238052618'; // usePolarisLikeMediaXIGLikeMutation
  const DOC_UNLIKE = '27345296031770102'; // usePolarisLikeMediaXIGUnlikeMutation
  const DOC_COMMENT = '30184188691181526'; // usePolarisCommentSubmitMutation
  const DOC_COMMENT_LIKE = '25746541371686622'; // usePolarisCommentLikeMutation
  const DOC_COMMENT_UNLIKE = '26466515576331833'; // usePolarisCommentUnlikeMutation
  const DOC_STORY_LIKE = '26938887309082050'; // usePolarisStoriesV4LikeMutationLikeMutation
  const DOC_STORY_UNLIKE = '26510485515280697'; // usePolarisStoriesV4LikeMutationUnlikeMutation
  const DOC_STORY_REPLY = '29327482173525974'; // IGDirectStoryShareReplyMutation
  // Feature flags the feed query declares; values as Instagram's web app sends them.
  const FEED_FLAGS = {
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
    __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
    __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
    __relay_internal__pv__PolarisAdDebugToolEnabledrelayprovider: false,
    __relay_internal__pv__PolarisSuggestedUserFeedUnitCardsEnabledrelayprovider: true,
  };
  const CLIPS_FLAGS = {
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
    __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
  };
  const IMAGE_MS = 5000;
  const AHEAD = 5; // accounts whose story lists are fetched ahead
  const PRELOAD = 3; // media files loaded ahead
  const START = -1; // item index: first unseen story
  const LAST = -2; // item index: last story

  // ---- Requests and navigation -------------------------------------------

  async function request(path, init) {
    const url = location.origin + path;
    const fetchers = [];
    // Firefox: content.fetch sends the request exactly as the page would.
    if (typeof content === 'object' && content && content.fetch) fetchers.push(content.fetch.bind(content));
    fetchers.push(window.fetch.bind(window));
    for (const f of fetchers) {
      try {
        const res = await f(url, init);
        if (res.ok) return JSON.parse(await res.text());
      } catch (_) {}
    }
    return null;
  }

  function api(path) {
    return request(path, { headers: { 'x-ig-app-id': APP_ID }, credentials: 'include' });
  }

  // Some reads work on /graphql/query with just the CSRF cookie. Mutations
  // sent there are accepted but silently dropped (the result is null): they
  // need /api/graphql plus the page's session tokens (`mutation` true), as
  // do more and more reads.
  function gql(docId, variables, mutation) {
    const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
    const params = { doc_id: docId, variables: typeof variables === 'string' ? variables : JSON.stringify(variables) };
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrftoken': csrf,
      'x-ig-app-id': APP_ID,
    };
    if (mutation) {
      const t = tokens();
      if (!t) return Promise.resolve(null);
      Object.assign(params, { fb_dtsg: t.dtsg, lsd: t.lsd });
      headers['x-fb-lsd'] = t.lsd;
    }
    return request(mutation ? '/api/graphql' : '/graphql/query', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: new URLSearchParams(params).toString(),
    });
  }

  // Session tokens Instagram embeds in the page's inline scripts.
  let cachedTokens = null;
  function tokens() {
    if (cachedTokens) return cachedTokens;
    const find = (name) => {
      const re = new RegExp(`"${name}",\\[\\],\\{"token":"([^"]+)"`);
      for (const s of document.scripts) {
        const m = !s.src && s.textContent.match(re);
        if (m) return m[1];
      }
      return null;
    };
    const dtsg = find('DTSGInitialData');
    const lsd = find('LSD');
    let device = null;
    for (const s of document.scripts) {
      const m = !s.src && s.textContent.match(/"device_id":"([\w-]+)"/);
      if (m) {
        device = m[1];
        break;
      }
    }
    if (!dtsg || !lsd) return null;
    const found = { dtsg, lsd, device };
    if (device) cachedTokens = found; // else look for the device id again next time
    return found;
  }

  // Notifications that light the dot but that Instagram never sends to the
  // web (such as "X added a story" for accounts you get alerts for): the
  // badge total minus the categories the web panel lists. Reading the badge
  // doesn't mark anything as seen.
  async function appOnlyNotifications() {
    const t = tokens();
    if (!t || !t.device) return null;
    const res = await gql(DOC_BADGE, { device_id: t.device }, true);
    const badge = res && res.data && res.data.xdt_notification_badge;
    const counts = badge && badge.badge_count;
    if (!counts) return null;
    const listed = Object.values(counts.activity_badge_counts || {}).reduce((sum, n) => sum + (n || 0), 0);
    return Math.max(0, (counts.total_count || 0) - listed);
  }

  // Posts by followed accounts published since `since` (unix seconds), newest
  // first, from the chronological Following feed. Reports nothing as viewed.
  async function recentPosts(since, maxPages = 4) {
    const t = tokens();
    if (!t || !t.device) return null;
    const out = [];
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      const res = await gql(DOC_FEED, {
        after,
        before: null,
        data: {
          device_id: t.device,
          is_async_ads_double_request: '0',
          is_async_ads_in_headload_enabled: '0',
          is_async_ads_rti: '0',
          rti_delivery_backend: '0',
          pagination_source: 'following',
          feed_view_info: '[]',
        },
        first: 12,
        last: null,
        variant: 'following',
        ...FEED_FLAGS,
      });
      const conn = res && res.data && res.data.xdt_api__v1__feed__timeline__connection;
      if (!conn) return page ? out : null;
      let older = false;
      for (const e of conn.edges || []) {
        const m = e.node && e.node.media;
        if (!m || !m.user || !m.code || !m.taken_at) continue;
        if (m.taken_at < since) {
          older = true;
          continue;
        }
        out.push({
          username: m.user.username,
          takenAt: m.taken_at,
          href: `/${m.product_type === 'clips' ? 'reel' : 'p'}/${m.code}/`,
          kind: m.product_type === 'clips' ? 'reel' : 'post',
        });
      }
      const info = conn.page_info;
      if (older || !info || !info.has_next_page) break;
      after = info.end_cursor;
    }
    return out;
  }

  // An object's id as a string. Ids are too long for a JavaScript number, so
  // when a response has one as a number (losing its last digits) the exact
  // string forms win: `pk_id`, or the pk before the "_" of `id`.
  function idOf(o) {
    if (typeof o.pk === 'string') return o.pk;
    if (typeof o.pk_id === 'string') return o.pk_id;
    if (typeof o.id === 'string' && /^\d+(_|$)/.test(o.id)) return o.id.split('_')[0];
    return String(o.pk);
  }

  // A reel as the grid and player use it, from Instagram's media object.
  function clipItem(m) {
    const video = m && (m.video_versions || [])[0];
    if (!m || !m.code || !m.user || !video) return null;
    const cands = (m.image_versions2 && m.image_versions2.candidates) || [];
    const portrait = cands.filter((c) => c.height > c.width);
    return {
      pk: idOf(m),
      code: m.code,
      username: m.user.username,
      pic: m.user.profile_pic_url,
      caption: (m.caption && m.caption.text) || '',
      likes: m.like_and_view_counts_disabled ? null : m.like_count,
      liked: !!m.has_liked,
      comments: m.comment_count || 0,
      commentsOff: !!(m.comments_disabled || m.commenting_disabled_for_viewer),
      token: m.organic_tracking_token || null,
      // Covers, largest first: portrait ones, else the square crops.
      thumbs: (portrait.length ? portrait : cands).sort((a, b) => b.width - a.width),
      video: video.url,
      takenAt: m.taken_at,
    };
  }

  // Instagram's media object for a post or reel, by its shortcode, which is
  // its pk in URL-safe base 64.
  async function mediaByCode(code) {
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let pk = 0n;
    for (const c of code.slice(0, 11)) {
      const d = ABC.indexOf(c);
      if (d < 0) return null;
      pk = pk * 64n + BigInt(d);
    }
    const res = await api(`/api/v1/media/${pk}/info/`);
    const m = res && res.items && res.items[0];
    if (!m) return null;
    // The exact pk, which a plain 11-letter code spells out in full.
    if (code.length <= 11 && m.code === code) m.pk = String(pk);
    return m;
  }

  // One reel by its shortcode.
  async function reelByCode(code) {
    return clipItem(await mediaByCode(code));
  }

  // One page of Instagram's Reels feed (the one its Reels tab plays), as
  // { items, after } where `after` is null at the end, or null on failure.
  // Ads come from a separate query, so there are none here.
  async function reelsPage(after) {
    const res = await gql(DOC_CLIPS, {
      after: after || null,
      before: null,
      data: { container_module: 'clips_tab_desktop_page', seen_reels: '[]' },
      first: 12,
      last: null,
      ...CLIPS_FLAGS,
    }, true);
    const conn = res && res.data && res.data.xdt_api__v1__clips__home__connection_v2;
    if (!conn) return null;
    const items = (conn.edges || []).map((e) => clipItem(e.node && e.node.media)).filter(Boolean);
    const info = conn.page_info || {};
    return { items, after: info.has_next_page ? info.end_cursor : null };
  }

  // ---- Likes and comments -------------------------------------------------

  // The first field of a mutation's result, or null if it failed.
  const mutated = (res) => (res && res.data && Object.values(res.data)[0]) || null;

  // Like or unlike a post or reel. Resolves to whether it worked.
  async function likeMedia(pk, on, token) {
    const input = { media_id: pk, tracking_token: token || undefined };
    if (on) input.container_module = 'clips_viewer_clips_tab';
    return !!mutated(await gql(on ? DOC_LIKE : DOC_UNLIKE, { input }, true));
  }

  async function likeComment(pk, on) {
    return !!mutated(await gql(on ? DOC_COMMENT_LIKE : DOC_COMMENT_UNLIKE, { input: { comment_id: pk } }, true));
  }

  function toComment(c) {
    if (!c || !c.pk || !c.user) return null;
    return {
      pk: idOf(c),
      text: c.text || '',
      username: c.user.username,
      pic: c.user.profile_pic_url,
      at: c.created_at,
      likes: c.comment_like_count || 0,
      liked: !!c.has_liked_comment,
      replies: c.child_comment_count || 0,
    };
  }

  // A page of a post's comments, as { comments, next } where `next` is the
  // cursor for the following page (null at the end), or null on failure.
  async function comments(pk, cursor) {
    let path = `/api/v1/media/${pk}/comments/?can_support_threading=true&permalink_enabled=false`;
    if (cursor) path += `&${cursor.key}=${encodeURIComponent(cursor.value)}`;
    const res = await api(path);
    if (!res || !res.comments) return null;
    const next = res.has_more_headload_comments && res.next_min_id ? { key: 'min_id', value: res.next_min_id }
      : res.has_more_comments && res.next_max_id ? { key: 'max_id', value: res.next_max_id }
      : null;
    return { comments: res.comments.map(toComment).filter(Boolean), next };
  }

  // Replies to a comment, oldest first, paged the same way.
  async function replies(pk, commentPk, cursor) {
    let path = `/api/v1/media/${pk}/comments/${commentPk}/child_comments/`;
    if (cursor) path += `?${cursor.key}=${encodeURIComponent(cursor.value)}`;
    const res = await api(path);
    if (!res || !res.child_comments) return null;
    const next = res.has_more_tail_child_comments && res.next_max_child_cursor ? { key: 'max_id', value: res.next_max_child_cursor }
      : res.has_more_head_child_comments && res.next_min_child_cursor ? { key: 'min_id', value: res.next_min_child_cursor }
      : null;
    return { comments: res.child_comments.map(toComment).filter(Boolean), next };
  }

  // Post a comment, or a reply to comment `replyTo`. Resolves to the new
  // comment, or null if it failed.
  async function addComment(pk, text, replyTo, token) {
    const data = { comment_text: text, media_id: pk, tracking_token: token || undefined };
    if (replyTo) data.replied_to_comment_id = '@REPLY@';
    // Instagram sends the id as a JSON number; ids are too long for a
    // JavaScript number, so write its digits into the JSON directly.
    let variables = JSON.stringify({ data, root_connections: [] });
    if (replyTo && /^\d+$/.test(replyTo)) variables = variables.replace('"@REPLY@"', replyTo);
    const root = mutated(await gql(DOC_COMMENT, variables, true));
    return root ? toComment(root.comment || root) : null;
  }

  // Like or unlike a story (the heart, which its author sees in the viewer list).
  async function likeStory(pk, on) {
    return !!mutated(await gql(on ? DOC_STORY_LIKE : DOC_STORY_UNLIKE, { input: { media_id: pk } }, true));
  }

  // Reply to a story in the author's DMs, with text or a reaction emoji,
  // as Instagram's own viewer does. Resolves to whether it was sent.
  async function replyToStory(pk, reelId, userId, text, emoji) {
    // An "offline threading id": the time in ms shifted left 22 bits, plus random bits.
    const otid = String((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 4194304)));
    const variables = {
      data: {
        is_shh_mode: false,
        media_id: pk,
        reaction_emoji: emoji || null,
        reel_id: reelId,
        sampled: false,
        share_client_context: otid,
        text: text ? { sensitive_string_value: text } : null,
      },
      send_data: {
        forwarded_from_thread_id: null,
        is_forwarded_from_own_message: null,
        offline_threading_id: otid,
        recipient_users: JSON.stringify([String(userId)]),
        thread_id: null,
      },
    };
    return !!mutated(await gql(DOC_STORY_REPLY, variables, true));
  }

  // Navigate through Instagram's own router (no page reload). In Firefox the
  // event has to be created in the page's world for its router to read it.
  function go(url) {
    try {
      const page = window.wrappedJSObject || window;
      const clone = (o) => (typeof cloneInto === 'function' ? cloneInto(o, window) : o);
      page.history.pushState(clone({}), '', url);
      page.dispatchEvent(new page.PopStateEvent('popstate', clone({ state: {} })));
    } catch (_) {
      location.assign(url);
    }
  }

  // ---- DOM helpers --------------------------------------------------------

  // Every element the extension adds carries the id of the copy that made
  // it. Reloading or updating the extension runs it again in tabs already
  // open, where the previous copy's elements stay behind, dead (a second
  // tab bar, a second end-of-feed note); this copy removes them.
  const GEN = Math.random().toString(36).slice(2);
  const mark = (node) => {
    node.setAttribute('data-sinsta-gen', GEN);
    return node;
  };
  for (const node of document.querySelectorAll('[data-sinsta-gen]')) {
    if (node.getAttribute('data-sinsta-gen') !== GEN) node.remove();
  }

  function el(tag, props, ...kids) {
    const node = mark(Object.assign(document.createElement(tag), props));
    node.append(...kids);
    return node;
  }

  // A video inside a closed shadow root, so scripts that scan the page's videos
  // don't find it (one extension paired ours with Instagram's hidden player,
  // clipped its bottom and re-routed its clicks). Returns the video; style and
  // place its host, from hostOf().
  function shadowVideo(props, fit) {
    const host = el('div');
    const v = el('video', props);
    Object.assign(v.style, { display: 'block', width: '100%', height: '100%', objectFit: fit });
    host.attachShadow({ mode: 'closed' }).append(v);
    return v;
  }
  const hostOf = (v) => v.getRootNode().host;

  // Show a full-window overlay in the browser's top layer, so it covers
  // whatever Instagram stacks with z-index (in narrow or zoomed windows,
  // parts of its hidden feed otherwise show through).
  function onTop(node) {
    document.body.append(node);
    if (!node.showPopover || node.matches(':popover-open')) return;
    node.popover = 'manual';
    node.showPopover();
  }

  function icon(paths) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = mark(document.createElementNS(NS, 'svg'));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  // ---- Account ids --------------------------------------------------------

  const userIds = new Map(); // username -> user id, as far as known

  // Favourites' ids come with the favourites list. For anyone else, the only
  // lookup left on the web (web_profile_info is gone) is the profile page,
  // which is large, so it is fetched on click rather than on hover.
  async function lookUpId(user) {
    if (userIds.has(user)) return userIds.get(user);
    // Firefox: content.fetch sends the request as the page would.
    const f = typeof content === 'object' && content && content.fetch ? content.fetch.bind(content) : window.fetch.bind(window);
    try {
      const res = await f(`${location.origin}/${encodeURIComponent(user)}/`, { credentials: 'include' });
      const id = ((await res.text()).match(/"profile_id":"(\d+)"/) || [])[1];
      if (id) userIds.set(user, id);
      return id || null;
    } catch (_) {
      return null;
    }
  }

  // ---- Viewer state -------------------------------------------------------

  let list = []; // reels in play order: { id, username, pic, unseen, seenAt }
  let ri = 0; // reel index
  let ii = START; // item index within the reel
  let dir = 1; // last direction of travel between accounts
  let open = false;
  let token = 0; // invalidates async work from a previous show()
  let current = null; // the <img> or <video> on stage
  let shown = false; // current media has actually loaded
  let elapsed = 0;
  let lastTick = 0;
  let raf = 0;
  let muted = true;
  let spacePaused = false;
  let holding = false;
  let hovering = false; // pointer on a sticker
  let card = null; // the current story's shared card: { href, label }
  let bubbleOn = false; // its "Name ›" bubble is showing
  let downAt = 0;
  let typing = false; // the reply box has focus
  let sending = false; // a reply or reaction is on its way
  let onClose = null;

  const media = new Map(); // reel id -> [{ pk, takenAt, type, src, poster }]
  const pending = new Map(); // reel id -> promise of the fetch that covers it
  const preloaded = new Map(); // src -> element

  // ---- Viewer DOM ---------------------------------------------------------

  const SOUND_OFF = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9.5l5 5M21.5 9.5l-5 5'];
  const SOUND_ON = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 8.5a5 5 0 0 1 0 7'];

  const mediaBox = el('div', { className: 'sv-media' });
  const bars = el('div', { className: 'sv-bars' });
  const avatar = el('img', { className: 'sv-avatar', alt: '' });
  const userLink = el('a', { className: 'sv-user' });
  const timeText = el('span', { className: 'sv-time' });
  const muteBtn = el('button', { className: 'sv-btn', type: 'button', title: 'Sound (M)' });
  const note = el('div', { className: 'sv-note' });
  const stickerBox = el('div', { className: 'sv-stickers' });
  const bubbleText = el('span');
  const bubble = el('a', { className: 'sv-bubble', hidden: true }, bubbleText, icon(['M9 5l7 7-7 7']));
  const sub = el('div', { className: 'sv-sub' });
  // Reply, quick reactions and the heart, along the bottom as in Instagram's viewer.
  const REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'];
  const HEART = ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'];
  const replyInput = el('input', { className: 'sv-reply', type: 'text', maxLength: 1000, enterKeyHint: 'send' });
  const likeBtn = el('button', { className: 'sv-btn sv-like', type: 'button', title: 'Like (L)' }, icon(HEART));
  const reactions = el('div', { className: 'sv-reactions', hidden: true },
    ...REACTIONS.map((emoji) => el('button', { type: 'button', className: 'sv-emoji', title: `React with ${emoji}` }, emoji)));
  const toast = el('div', { className: 'sv-toast', hidden: true });
  const foot = el('div', { className: 'sv-foot' }, reactions, el('div', { className: 'sv-reply-row' }, replyInput, likeBtn));
  const stage = el('div', { className: 'sv-stage' },
    mediaBox,
    stickerBox,
    el('div', { className: 'sv-dim' }),
    el('div', { className: 'sv-top' },
      bars,
      el('div', { className: 'sv-head' }, avatar, userLink, timeText, el('span', { className: 'sv-gap' }), muteBtn),
      sub),
    note,
    toast,
    foot);
  const closeBtn = el('button', { className: 'sv-close', type: 'button', title: 'Close (Esc)' }, icon(['M6 6l12 12M18 6L6 18']));
  // The viewer scrolls sideways, one snap point per account (see Scrolling
  // the carousel): `view` stays put while `wide` gives it room to scroll.
  const view = el('div', { className: 'sv-view' }, closeBtn, stage);
  const stops = el('div'); // a snap point per account, placed by sizeScroller
  const wide = el('div', { className: 'sv-wide' }, view, stops);
  const root = el('div', { id: 'sinsta-viewer' }, wide);

  closeBtn.addEventListener('click', () => close());
  muteBtn.addEventListener('click', () => setMuted(!muted));
  // Links within Instagram close the viewer and navigate in place; link
  // stickers open a new tab and pause the story.
  stage.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (link.target === '_blank') {
      spacePaused = true;
      syncPause();
      return;
    }
    e.preventDefault();
    const href = link.getAttribute('href');
    close();
    go(href);
  });

  // Tap the left third to go back, elsewhere to go forward; hold to pause.
  // As on Instagram, tapping a shared post or story shows a bubble linking to
  // it instead, and the next tap anywhere else dismisses the bubble.
  stage.addEventListener('pointerdown', (e) => {
    // While typing a reply, a tap on the story only leaves the reply box.
    if (e.button !== 0 || typing || e.target.closest('a, button, input, .sv-foot')) return;
    downAt = Date.now();
    holding = true;
    syncPause();
  });
  stage.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const held = Date.now() - downAt;
    release();
    if (held >= 250) return;
    if (bubbleOn) return setBubble(false);
    if (card && onCard(e)) return setBubble(true);
    const box = stage.getBoundingClientRect();
    step(e.clientX - box.left < box.width * 0.3 ? -1 : 1);
  });

  // Instagram reports a shared card only as the middle quarter of the media,
  // whatever its real size.
  function onCard(e) {
    const box = stickerBox.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    return x > 0.25 && x < 0.75 && y > 0.25 && y < 0.75;
  }

  function setBubble(on) {
    bubbleOn = on;
    bubble.hidden = !on;
    syncPause();
  }
  stage.addEventListener('pointerleave', release);
  stage.addEventListener('pointercancel', release);

  function release() {
    downAt = 0;
    holding = false;
    syncPause();
  }

  // Registered once, at document start, so it runs before Instagram's own
  // key handlers, which could otherwise swallow the keys.
  window.addEventListener('keydown', (e) => {
    if (open) onKey(e);
  }, true);

  function onKey(e) {
    // Typing a reply: keep the keys from the viewer and from Instagram.
    if (e.target === replyInput) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        replyInput.blur();
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        sendReply();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const actions = {
      Escape: () => close(),
      ArrowRight: () => (e.shiftKey ? jump(1) : step(1)),
      ArrowLeft: () => (e.shiftKey ? jump(-1) : step(-1)),
      ' ': () => { spacePaused = !spacePaused; syncPause(); },
      m: () => setMuted(!muted),
      l: toggleLike,
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  }

  // ---- Replies, reactions and likes ---------------------------------------

  function currentItem() {
    const reel = list[ri];
    const item = reel && (media.get(reel.id) || [])[ii];
    return item ? { reel, item } : null;
  }

  replyInput.addEventListener('focus', () => {
    typing = true;
    reactions.hidden = false;
    syncPause();
  });
  replyInput.addEventListener('blur', () => {
    typing = false;
    reactions.hidden = true;
    syncPause();
  });
  // Keep the reply box focused while an emoji is pressed, so it stays open.
  reactions.addEventListener('pointerdown', (e) => e.preventDefault());
  reactions.addEventListener('click', (e) => {
    const b = e.target.closest('.sv-emoji');
    if (b) send(null, b.textContent);
  });
  likeBtn.addEventListener('click', toggleLike);

  function sendReply() {
    const text = replyInput.value.trim();
    if (text) send(text, null);
  }

  // While a reply is on its way the box stays focused but read-only (a
  // disabled input would lose focus), and the story stays paused, so it
  // can't move on and take the typed text with it.
  async function send(text, emoji) {
    const cur = currentItem();
    if (!cur || !cur.item.canReply || sending) return;
    sending = true;
    replyInput.readOnly = true;
    replyInput.toggleAttribute('data-sending', true);
    syncPause();
    const ok = await replyToStory(cur.item.pk, cur.reel.id, cur.reel.id, text, emoji);
    sending = false;
    replyInput.readOnly = false;
    replyInput.toggleAttribute('data-sending', false);
    syncPause();
    if (!open) return;
    if (ok) {
      if (text) replyInput.value = '';
      replyInput.blur();
      showToast(emoji ? emoji : 'Sent', !!emoji);
    } else {
      showToast(emoji ? 'Couldn\'t send your reaction' : 'Couldn\'t send your reply', false);
      if (text) replyInput.focus();
    }
  }

  let toastTimer = 0;
  function showToast(text, big) {
    toast.textContent = text;
    toast.classList.toggle('sv-toast-big', big);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, big ? 1200 : 2000);
  }

  // Stories whose like is on its way; another story can be liked meanwhile.
  const liking = new WeakSet();

  async function toggleLike() {
    const cur = currentItem();
    if (!cur || liking.has(cur.item)) return;
    const { item } = cur;
    const flip = (v) => {
      item.liked = v;
      syncLike();
    };
    const on = !item.liked;
    liking.add(item);
    flip(on);
    const ok = await likeStory(item.pk, on);
    liking.delete(item);
    flip(ok ? on : !on);
  }

  function syncLike() {
    const cur = currentItem();
    const liked = !!(cur && cur.item.liked);
    likeBtn.toggleAttribute('data-busy', !!(cur && liking.has(cur.item)));
    likeBtn.toggleAttribute('data-on', liked);
    likeBtn.title = liked ? 'Unlike (L)' : 'Like (L)';
  }

  // The bottom bar for the story on screen; typed text stays while the
  // account stays the same.
  function syncFoot(reel, item) {
    if (foot.dataset.reel !== reel.id) {
      foot.dataset.reel = reel.id;
      replyInput.value = '';
    }
    replyInput.placeholder = `Reply to ${reel.username}…`;
    replyInput.hidden = !item.canReply;
    if (!item.canReply && typing) replyInput.blur();
    foot.hidden = false;
    syncLike();
  }

  // ---- Data ---------------------------------------------------------------

  function toItem(it) {
    const video = it.media_type === 2 && it.video_versions && it.video_versions[0];
    const images = (it.image_versions2 && it.image_versions2.candidates) || [];
    const image = images[0];
    if (!video && !image) return null;
    // The smallest image still sharp on a neighbour card beside the stage.
    const thumb = images.filter((c) => c.width >= 480).sort((a, b) => a.width - b.width)[0] || image;
    const music = it.story_music_stickers && it.story_music_stickers[0] && it.story_music_stickers[0].music_asset_info;
    const shared = (it.story_feed_media || []).find((s) => s.media_code);
    const sharedBy = (it.story_bloks_stickers || []).filter(placeholder)
      .map((s) => s.bloks_sticker && s.bloks_sticker.sticker_data && s.bloks_sticker.sticker_data.ig_mention)
      .find((m) => m && m.username);
    const author = it.reshared_story_media_author || sharedBy;
    const sharedLink = shared && {
      reel: shared.product_type === 'clips',
      href: `/${shared.product_type === 'clips' ? 'reel' : 'p'}/${shared.media_code}/`,
    };
    return {
      pk: String(it.pk),
      takenAt: it.taken_at,
      type: video ? 'video' : 'image',
      src: video ? video.url : image.url,
      liked: !!it.has_liked,
      canReply: !!it.can_reply,
      poster: image ? image.url : '',
      thumb: thumb ? thumb.url : '',
      ratio: it.original_width && it.original_height ? it.original_width / it.original_height : 9 / 16,
      stickers: stickersOf(it),
      music: music && music.title ? [music.title, music.display_artist].filter(Boolean).join(' · ') : '',
      from: (author && author.username) || '',
      shared: sharedLink || null,
      card: sharedLink ? { href: sharedLink.href, label: sharedLink.reel ? 'View reel' : 'View post' }
        : author && author.username ? { href: `/${author.username}/`, label: author.full_name || author.username }
        : null,
    };
  }

  // Clickable stickers: what each points to and where it sits, as fractions
  // of the media (x, y are its centre; rotation is in turns), largest first
  // so smaller ones lying on top stay clickable.
  function stickersOf(it) {
    const out = [];
    const add = (stickers, target) => {
      for (const s of stickers || []) {
        const t = s && s.width && s.height && !placeholder(s) && target(s);
        if (t) out.push({ ...t, x: s.x, y: s.y, w: s.width, h: s.height, rot: s.rotation || 0 });
      }
    };
    const mention = (username) => username && { href: `/${username}/`, title: `@${username}` };
    add(it.story_bloks_stickers, (s) => {
      const data = s.bloks_sticker && s.bloks_sticker.sticker_data;
      return data && data.ig_mention && mention(data.ig_mention.username);
    });
    add(it.reel_mentions, (s) => s.user && mention(s.user.username));
    add(it.story_locations, (s) => s.location && s.location.pk
      && { href: `/explore/locations/${s.location.pk}/`, title: 'Open location' });
    add(it.story_hashtags, (s) => s.hashtag && s.hashtag.name
      && { href: `/explore/tags/${encodeURIComponent(s.hashtag.name)}/`, title: `#${s.hashtag.name}` });
    add(it.story_link_stickers, (s) => s.story_link && /^https:\/\//.test(s.story_link.url)
      && { href: s.story_link.url, title: linkTarget(s.story_link.url), external: true });
    return out.sort((a, b) => b.w * b.h - a.w * a.h);
  }

  // Shared posts, and the mention of their author, are placed at the middle
  // quarter whatever their real size: as a clickable area they would swallow
  // taps meant to advance, so they get links in the header instead.
  function placeholder(s) {
    return s.x === 0.5 && s.y === 0.5 && s.width === 0.5 && s.height === 0.5;
  }

  // Link stickers go through Instagram's redirect; show where they lead.
  function linkTarget(url) {
    try {
      const u = new URL(url);
      const real = u.hostname === 'l.instagram.com' ? u.searchParams.get('u') : url;
      return real ? new URL(real).hostname.replace(/^www\./, '') : url;
    } catch (_) {
      return url;
    }
  }

  // One request for several accounts' stories. Since November 2026 this
  // query needs /api/graphql and the session tokens: /graphql/query
  // answers it with an HTML page.
  function loadReels(ids) {
    const send = () => gql(DOC_REELS, {
      media_id: null,
      reel_ids_arr: ids,
      __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true,
    }, true);
    const reelsOf = (data) => data && data.data && data.data.xdt_api__v1__feed__reels_media;
    const job = send().then((data) => {
      if (reelsOf(data)) return data;
      cachedTokens = null; // tokens may have rotated: re-read them once
      return send();
    }).then((data) => {
      const got = reelsOf(data);
      if (!got) console.warn('Here for Instagram: the stories query failed', data);
      const byId = new Map(((got && got.reels_media) || []).map((r) => [String(r.id), r]));
      for (const id of ids) {
        pending.delete(id);
        if (!got) continue; // request failed: stays unknown, show() falls back
        const reel = byId.get(id);
        media.set(id, reel ? reel.items.map(toItem).filter(Boolean) : []);
        const mine = list.find((r) => r.id === id);
        if (mine && reel) mine.seenAt = Math.max(mine.seenAt, reel.seen || 0);
      }
      if (open) {
        preload();
        renderDeck();
      }
      return got ? got.reels_media || [] : null;
    });
    for (const id of ids) pending.set(id, job);
    return job;
  }

  // Story summaries for the given accounts (those with active stories only),
  // straight from the viewer's own query. Unlike Instagram's stories tray,
  // which is ranked and cut off at 120 accounts, this misses nobody. The
  // stories themselves are kept for the viewer, so they open instantly.
  // Larger batches than 10 accounts make Instagram fail the whole request.
  async function fetchReels(ids) {
    const batches = [];
    for (let i = 0; i < ids.length; i += 10) batches.push(loadReels(ids.slice(i, i + 10)));
    const results = await Promise.all(batches);
    if (results.some((r) => r === null)) return null;
    return results.flat().map((r) => {
      const seenAt = r.seen || 0;
      return {
        id: String(r.id),
        username: r.user.username,
        pic: r.user.profile_pic_url,
        seenAt,
        latest: r.latest_reel_media || 0,
        unseen: r.items.some((it) => it.taken_at > seenAt),
      };
    });
  }

  // Fetch in batches: only when one of the next two accounts is still unknown.
  function loadAhead() {
    const missing = (r) => !media.has(r.id) && !pending.has(r.id);
    if (!list.slice(ri, ri + 3).some(missing)) return;
    const ids = list.slice(ri, ri + 1 + AHEAD).filter(missing).map((r) => r.id);
    if (ids.length) loadReels(ids);
  }

  function firstUnseen(reel, items) {
    const i = items.findIndex((it) => it.takenAt > reel.seenAt);
    return i < 0 ? 0 : i;
  }

  function markSeen(reel, item) {
    if (item.takenAt <= reel.seenAt) return;
    reel.seenAt = item.takenAt;
    if (media.get(reel.id).every((it) => it.takenAt <= reel.seenAt)) reel.unseen = false;
    const send = () => gql(DOC_SEEN, {
      reelId: reel.id,
      reelMediaId: item.pk,
      reelMediaOwnerId: reel.id,
      reelMediaTakenAt: item.takenAt,
      viewSeenAt: Math.floor(Date.now() / 1000),
    }, true);
    const marked = (res) => !!(res && res.data && res.data.xdt_mark_story_reel_seen);
    send().then((res) => {
      if (marked(res)) return;
      cachedTokens = null; // tokens may have rotated: re-read them once
      send();
    });
  }

  // Star or unstar an account, as Instagram's "Add to Favourites" menu item
  // does. Resolves to whether the account is now a favourite, or null.
  async function setFavourite(userId, on) {
    const send = () => gql(DOC_FAV, {
      input: { add: on ? [userId] : [], remove: on ? [] : [userId], source: 'profile' },
    }, true);
    const state = (res) => {
      const got = res && res.data && res.data.xig_update_feed_favorites;
      const info = got && got.user_id_and_relationship_infos && got.user_id_and_relationship_infos[0];
      return info && info.relationship_info ? !!info.relationship_info.is_feed_favorite : null;
    };
    let result = state(await send());
    if (result === null) {
      cachedTokens = null; // tokens may have rotated: re-read them once
      result = state(await send());
    }
    return result;
  }

  // ---- Preloading ---------------------------------------------------------

  function mediaEl(item) {
    let node = preloaded.get(item.src);
    if (!node) {
      node = item.type === 'video'
        ? el('video', { src: item.src, poster: item.poster, preload: 'auto', playsInline: true, muted: true })
        : el('img', { src: item.src, alt: '', decoding: 'async' });
      preloaded.set(item.src, node);
    }
    return node;
  }

  // The next n stories in play order, as far as their lists are known.
  function upcoming(n) {
    const out = [];
    let r = ri;
    let i = ii;
    while (out.length < n && r < list.length) {
      const items = media.get(list[r].id);
      if (!items) break;
      if (i + 1 < items.length) {
        out.push(items[++i]);
        continue;
      }
      r++;
      const next = r < list.length && media.get(list[r].id);
      if (!next) break;
      if (!next.length) {
        i = -1;
        continue;
      }
      i = firstUnseen(list[r], next);
      out.push(next[i]);
    }
    return out;
  }

  function preload() {
    const reel = list[ri];
    const items = reel && media.get(reel.id);
    const now = items && items[ii];
    if (!now) return;
    const keep = new Set([now.src]);
    for (const item of upcoming(PRELOAD)) {
      keep.add(item.src);
      mediaEl(item);
    }
    for (const [src, node] of preloaded) {
      // Also spare the previous story while it still shows under this one.
      if (keep.has(src) || node.parentNode === mediaBox) continue;
      unload(node);
      preloaded.delete(src);
    }
  }

  // Stop a video's download and free its buffer.
  function unload(node) {
    if (node.tagName !== 'VIDEO') return;
    node.pause();
    node.removeAttribute('src');
    node.load();
  }

  // ---- The deck -----------------------------------------------------------

  // The stories around the one on stage, as cards beside it. The account on
  // stage opens into a card per story; every other account is one card, the
  // story going to it lands on. Each card is one stop along the carousel, so
  // moving a story along turns it as far as moving on to the next account.
  // Clicking a card goes to its story. The free room on each side is
  // split by a geometric falloff: each card's visible share is DECK.ratio of
  // the nearer one's, and cards whose share would be under DECK.minStrip
  // stage widths are left out. A card's outer edge goes where its share ends
  // and the nearer card covers the rest of it. Its scale and angle follow its
  // share, so near cards are large and flat, far ones smaller and turned.
  const DECK = { ratio: 0.82, scaleFar: 0.63, angleNear: 0, angleFar: 20, minStrip: 0.075, persp: 1.4, fade: 0.09, margin: 0.015 };
  const peeks = new Map(); // card key ("reel id:story index") -> card element
  const peekAsked = new Set(); // reel ids whose stories the cards asked for
  let slots = []; // right-hand card placements, nearest first: { x, th, s }
  let deckW = 0;
  let deckH = 0;

  function layoutDeck() {
    const FW = root.clientWidth;
    const FH = root.clientHeight;
    const W = stage.offsetWidth;
    const H = stage.offsetHeight;
    deckW = W;
    deckH = H;
    slots = [];
    const room = FW / 2 - DECK.margin * FW - W / 2;
    if (!W || room <= 0) return sizeScroller(FW, W);
    const d = DECK.persp * FH;
    view.style.perspective = `${d}px`;
    let n = 40;
    let strips = [];
    for (; n >= 1; n--) {
      const sum = (1 - DECK.ratio ** n) / (1 - DECK.ratio);
      strips = Array.from({ length: n }, (_, k) => (room * DECK.ratio ** k) / sum);
      if (strips[n - 1] >= DECK.minStrip * W) break;
    }
    let edge = W / 2;
    for (let k = 0; k < n; k++) {
      edge += strips[k];
      const u = strips[k] / strips[0];
      const s = DECK.scaleFar + (1 - DECK.scaleFar) * u;
      const th = DECK.angleNear + (DECK.angleFar - DECK.angleNear) * (1 - u);
      // Turned with its outer edge toward the viewer, that edge projects to
      // (x + half·cos θ) · d / (d − half·sin θ); put it at `edge`.
      const r = (th * Math.PI) / 180;
      const half = (W * s) / 2;
      const x = (edge * (d - half * Math.sin(r))) / d - half * Math.cos(r);
      slots.push({ x, th, s });
    }
    sizeScroller(FW, W);
  }

  function peekCard(reel) {
    const img = el('img', { className: 'sv-peek-img', alt: '', decoding: 'async', draggable: false });
    const when = el('span', { className: 'sv-peek-time' });
    const label = el('div', { className: 'sv-peek-label' }, el('b', {}, reel.username), when);
    const card = el('div', { className: 'sv-peek' }, img, el('div', { className: 'sv-peek-dim' }), label);
    card.parts = { img, when, label };
    card.addEventListener('click', () => toCard(card.item));
    return card;
  }

  // Which story going to an account `off` accounts away lands on: behind, the
  // one you left it on (its last, unless you jumped away); ahead, its first
  // unseen one; for the account on stage, the story on stage.
  function storyIndex(reel, items, off) {
    if (!off) {
      if (ii === START) return firstUnseen(reel, items);
      return ii === LAST ? items.length - 1 : Math.min(ii, items.length - 1);
    }
    if (off > 0) return firstUnseen(reel, items);
    return reel.leftAt != null ? Math.min(reel.leftAt, items.length - 1) : items.length - 1;
  }

  // The deck's cards in order, a stop apart: { k: account, j: story (null
  // while the account's stories are unknown, when it shows its profile
  // picture), key }.
  function deckItems() {
    const out = [];
    list.forEach((reel, k) => {
      const items = media.get(reel.id);
      if (!items || !items.length) out.push({ k, j: null });
      else if (k === ri && ii >= 0) items.forEach((_, j) => out.push({ k, j }));
      else out.push({ k, j: storyIndex(reel, items, k - ri) });
    });
    for (const it of out) it.key = `${list[it.k].id}:${it.j}`;
    return out;
  }

  // Where the story on stage is among them.
  function stageAt(items) {
    let at = -1;
    items.forEach((it, i) => {
      if (it.k === ri && (at < 0 || it.j === ii)) at = i;
    });
    return Math.max(at, 0);
  }

  function fillPeek(card, it) {
    const reel = list[it.k];
    const items = media.get(reel.id);
    const item = items && it.j != null ? items[it.j] : null;
    const { img, when } = card.parts;
    const src = (item && item.thumb) || reel.pic;
    if (img.getAttribute('src') !== src) img.src = src;
    card.classList.toggle('sv-peek-pic', !item || !item.thumb);
    when.textContent = item ? ago(item.takenAt) : '';
  }

  // Go to a card's story.
  function toCard(it) {
    if (it.k !== ri) return toReel(it.k);
    if (ii < 0 || it.j == null || it.j === ii) return;
    dir = it.j > ii ? 1 : -1;
    ii = it.j;
    show();
  }

  let deck = []; // the cards last laid out, kept as they are while scrolling
  let deckAt = 0; // where the stage was among them

  function renderDeck() {
    if (!open) return;
    const n = slots.length;
    if (!scrolling) {
      deck = deckItems();
      deckAt = stageAt(deck);
      syncTrack();
    }
    const pos = scrolling ? scrollPos : deckAt;
    const lo = Math.max(0, Math.floor(pos) - n - 1);
    const hi = Math.min(deck.length - 1, Math.ceil(pos) + n + 1);
    const keep = new Set();
    const missing = [];
    for (let i = lo; i <= hi; i++) {
      const it = deck[i];
      const reel = list[it.k];
      const off = i - pos;
      const d = Math.abs(off);
      keep.add(it.key);
      if (!media.has(reel.id) && !pending.has(reel.id) && !peekAsked.has(reel.id)) missing.push(reel.id);
      let card = peeks.get(it.key);
      const fresh = !card;
      if (fresh) {
        card = peekCard(reel);
        peeks.set(it.key, card);
        view.insertBefore(card, stage);
      }
      card.item = it;
      fillPeek(card, it);
      const { transform, dim } = placement(off);
      // While scrolling, the stage is hidden and every card shows, the
      // farthest fading out as it goes.
      const inView = scrolling ? d < (n || 1) + 1 : !!d && d <= n;
      const opacity = scrolling ? Math.min(1, (n || 1) + 1 - d) : inView || (!d && arriving) ? 1 : 0;
      Object.assign(card.style, { width: `${deckW}px`, height: `${deckH}px`, marginLeft: `${-deckW / 2}px`, marginTop: `${-deckH / 2}px`, zIndex: String(Math.round(99 - 20 * d)) });
      card.style.setProperty('--dim', String(dim));
      card.classList.toggle('sv-peek-centre', d < 0.5);
      card.classList.toggle('sv-peek-off', !inView);
      // While scrolling, a card's name fades with its distance from the middle
      // rather than switching as it passes.
      card.parts.label.style.opacity = scrolling ? String(Math.min(1, 2 * d)) : '';
      if (fresh && !scrolling) {
        // Slide a new neighbour out from behind the stage; fade in farther ones.
        card.style.transform = d <= 1 ? 'none' : transform;
        card.style.opacity = '0';
        card.getBoundingClientRect();
      }
      card.style.transform = transform;
      // After a turn, the new account's card stays under the stage, which is
      // see-through until its story has loaded, so the picture is there
      // from the start.
      card.style.opacity = String(opacity);
    }
    for (const [key, card] of peeks) {
      if (keep.has(key)) continue;
      peeks.delete(key);
      // The account left behind folds back into one card: its other stories
      // fade where they are.
      if (scrolling || card.style.opacity === '0') {
        card.remove();
      } else {
        card.style.opacity = '0';
        card.classList.add('sv-peek-off');
        setTimeout(() => card.remove(), TURN_MS);
      }
    }
    for (let i = 0; i < missing.length; i += 10) {
      const ids = missing.slice(i, i + 10);
      for (const id of ids) peekAsked.add(id);
      loadReels(ids);
    }
  }

  // Where a card `off` places from the middle goes, and how dim it is. While
  // the carousel scrolls, `off` is fractional: between two places, a card is
  // part way from one to the other.
  function placement(off) {
    const d = Math.abs(off);
    const sign = Math.sign(off);
    const n = slots.length;
    if (!d) return { transform: 'none', dim: 0 };
    if (!n && !scrolling) return { transform: 'none', dim: Math.min(0.85, 0.15 + d * DECK.fade) };
    if (!n) {
      // No room for cards beside the stage: while scrolling, they slide in
      // from off screen.
      return { transform: `translateX(${off * unit}px)`, dim: Math.min(d, 1) * 0.3 };
    }
    const k = Math.min(Math.floor(d), n);
    const f = k === n ? 0 : d - k;
    const a = k ? slots[k - 1] : { x: 0, th: 0, s: 1 };
    const b = slots[Math.min(k, n - 1)];
    const x = a.x + (b.x - a.x) * f;
    const th = a.th + (b.th - a.th) * f;
    const s = a.s + (b.s - a.s) * f;
    const far = 0.15 + DECK.fade;
    return {
      transform: `translateX(${sign * x}px) rotateY(${-sign * th}deg) scale(${s})`,
      dim: d < 1 ? d * far : Math.min(0.85, 0.15 + d * DECK.fade),
    };
  }

  // Apply styles at once, without transitions.
  function snap(node, apply) {
    node.classList.add('sv-snap');
    apply();
    node.getBoundingClientRect();
    node.classList.remove('sv-snap');
  }

  function clearDeck() {
    for (const card of peeks.values()) card.remove();
    peeks.clear();
    peekAsked.clear();
    clearTimeout(turnTimer);
    turning = false;
    endScroll();
    landed = false;
    arrived();
    deck = [];
    deckAt = 0;
    trackLen = 0;
    snap(stage, () => {
      stage.style.transform = '';
      stage.style.setProperty('--dim', '0');
    });
  }

  // Changing story turns the carousel, as in a coverflow. The stage, already
  // showing the new story with its controls, flies in from where that story's
  // card was, brightening as it comes; the card itself moves in under it,
  // standing in until the story has loaded. The story left behind becomes a
  // card where the stage was and slides aside.
  let turning = false;
  let arriving = false; // turned to an account whose story hasn't loaded yet
  let turnTimer = 0;
  const TURN_MS = 400; // as the transitions in content.css

  function beginTurn(card, delta) {
    if (card) {
      snap(card, () => {
        card.classList.add('sv-peek-centre');
        card.style.transform = 'none';
        card.style.opacity = '1';
        card.style.setProperty('--dim', '0');
      });
    }
    const from = placement(delta);
    snap(stage, () => {
      stage.style.transform = from.transform;
      stage.style.setProperty('--dim', String(from.dim));
    });
    stage.style.transform = '';
    stage.style.setProperty('--dim', '0');
    arriving = true;
    root.classList.add('sv-arriving');
    turning = true; // videos wait until the stage has arrived
    clearTimeout(turnTimer);
    turnTimer = setTimeout(() => {
      turning = false;
      syncPause();
    }, TURN_MS);
    syncPause();
  }

  // The story has loaded (or failed): the stand-in card under the stage
  // fades out and the stage is opaque again.
  function arrived() {
    if (!arriving) return;
    arriving = false;
    root.classList.remove('sv-arriving');
    renderDeck();
  }

  // Remember which story an account was left on, for its card.
  function leave() {
    if (ii >= 0) list[ri].leftAt = ii;
  }

  window.addEventListener('resize', () => {
    if (!open) return;
    layoutDeck();
    renderDeck();
  });

  // ---- Scrolling the carousel ---------------------------------------------

  // The viewer is a sideways scroller with a snap point per account, so a
  // trackpad turns the carousel natively: continuously, with the system's
  // momentum, coming to rest on an account. A mouse wheel turns it
  // continuously too (down = next), but without momentum: it scrolls
  // smoothly as far as the wheel goes, then settles on the nearest account,
  // at least one along. While it turns, the cards stand in for the stage;
  // where it comes to rest is shown on the stage again.
  const WHEEL_PER_LINE = 0.15; // accounts per line of mouse wheel scrolling (3 lines a notch)
  const WHEEL_SETTLE_MS = 200; // ms after the wheel stops before settling
  let unit = 1; // px of scrolling per account: from the middle to the first card
  let scrolling = false;
  let scrollPos = 0; // where the carousel is, in accounts
  let landed = false; // the stage comes to a story the carousel turned to
  let restPos = 0; // where renderDeck put the scroller, in stops
  let trackLen = 0; // stops laid out
  let trackUnit = 0;
  let wheelTimer = 0;
  let wheelFrom = 0;
  let wheelTo = 0;

  function sizeScroller(FW, W) {
    unit = Math.max(1, Math.round(slots.length ? slots[0].x : W + 16));
    view.style.width = `${FW}px`;
  }

  // A stop per card, and the scroller at the story on stage.
  function syncTrack() {
    if (trackLen !== deck.length || trackUnit !== unit) {
      trackLen = deck.length;
      trackUnit = unit;
      wide.style.width = `${(trackLen - 1) * unit + view.offsetWidth}px`;
      stops.replaceChildren(...deck.map((_, i) => {
        const stop = el('i', { className: 'sv-stop' });
        stop.style.left = `${i * unit}px`;
        return stop;
      }));
    }
    restPos = deckAt;
    if (Math.abs(root.scrollLeft - deckAt * unit) >= 1) root.scrollLeft = deckAt * unit;
  }

  function endScroll() {
    clearTimeout(wheelTimer);
    wheelTimer = 0;
    root.classList.remove('sv-free');
    if (!scrolling) return;
    scrolling = false;
    root.classList.remove('sv-scrolling');
    syncPause();
  }

  root.addEventListener('scroll', () => {
    if (!open) return;
    const pos = root.scrollLeft / unit;
    if (!scrolling) {
      if (Math.abs(pos - restPos) < 0.01) return; // put there by syncTrack
      scrolling = true;
      root.classList.add('sv-scrolling');
      if (typing) replyInput.blur(); // the stage, reply box included, hides
      syncPause();
    }
    scrollPos = pos;
    renderDeck();
  });

  // Come to rest on a card (a snap point; after the mouse wheel, where settle
  // sent it). The layout stayed as it was while scrolling; now the account
  // it rests on opens and the one left folds up.
  root.addEventListener('scrollend', () => {
    if (open && scrolling && !wheelTimer) rest();
  });

  function rest() {
    const i = Math.min(Math.max(Math.round(root.scrollLeft / unit), 0), deck.length - 1);
    if (Math.abs(root.scrollLeft - i * unit) >= 1) {
      root.scrollTo({ left: i * unit, behavior: 'smooth' });
      return;
    }
    endScroll();
    if (i === deckAt) return renderDeck();
    landed = true;
    toCard(deck[i]);
  }

  // Firefox reports a mouse wheel in lines and a trackpad (or Magic Mouse) in
  // pixels, but only to a listener that reads deltaMode before the deltas:
  // read it first, ahead of Instagram's listeners. Pixels are left to the
  // scroller.
  window.addEventListener('wheel', (e) => {
    if (!open || e.ctrlKey || e.metaKey) return; // zoom
    const mode = e.deltaMode;
    if (mode === 0) {
      if (wheelTimer) {
        // A trackpad takes over from the wheel: snap again.
        clearTimeout(wheelTimer);
        wheelTimer = 0;
        root.classList.remove('sv-free');
      }
      return;
    }
    e.preventDefault();
    const lines = (e.deltaY || e.deltaX) * (mode === 2 ? 1 / WHEEL_PER_LINE : 1);
    if (!wheelTimer) {
      wheelFrom = scrolling ? Math.round(root.scrollLeft / unit) : restPos;
      wheelTo = root.scrollLeft;
      root.classList.add('sv-free'); // no snapping until it settles
    }
    wheelTo = Math.min(Math.max(wheelTo + lines * WHEEL_PER_LINE * unit, 0), (deck.length - 1) * unit);
    root.scrollTo({ left: wheelTo, behavior: 'smooth' });
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(settle, WHEEL_SETTLE_MS);
  }, { capture: true, passive: false });

  function settle() {
    wheelTimer = 0;
    const pos = wheelTo / unit;
    let k = Math.round(pos);
    if (k === wheelFrom && Math.abs(pos - wheelFrom) > 0.05) k += Math.sign(pos - wheelFrom);
    k = Math.min(Math.max(k, 0), deck.length - 1);
    // Snapping stays off until it comes to rest (endScroll), so it can't
    // pull the carousel elsewhere on the way.
    if (Math.abs(root.scrollLeft - k * unit) >= 1) root.scrollTo({ left: k * unit, behavior: 'smooth' });
    else if (scrolling) rest();
    else endScroll();
  }

  // ---- Playback -----------------------------------------------------------

  const paused = () => spacePaused || holding || hovering || bubbleOn || typing || sending || turning || scrolling;

  // Clickable areas over the stickers, on a layer matching the media's own
  // box within the 9:16 stage (the media is shown uncropped).
  function renderStickers(item) {
    hovering = false;
    const stageRatio = 9 / 16;
    const w = item.ratio <= stageRatio ? item.ratio / stageRatio : 1;
    const h = item.ratio <= stageRatio ? 1 : stageRatio / item.ratio;
    Object.assign(stickerBox.style, {
      left: `${(1 - w) * 50}%`, top: `${(1 - h) * 50}%`, width: `${w * 100}%`, height: `${h * 100}%`,
    });
    stickerBox.replaceChildren(...item.stickers.map((s) => {
      const a = el('a', { className: 'sv-sticker', href: s.href, title: s.title });
      if (s.external) Object.assign(a, { target: '_blank', rel: 'noopener noreferrer' });
      Object.assign(a.style, {
        left: `${(s.x - s.w / 2) * 100}%`, top: `${(s.y - s.h / 2) * 100}%`,
        width: `${s.w * 100}%`, height: `${s.h * 100}%`, transform: `rotate(${s.rot}turn)`,
      });
      // Hovering a sticker holds the story, so there is time to click it.
      a.addEventListener('pointerenter', () => { hovering = true; syncPause(); });
      a.addEventListener('pointerleave', () => { hovering = false; syncPause(); });
      return a;
    }), bubble);
    card = item.card || null;
    bubbleOn = false;
    bubble.hidden = true;
    if (card) {
      bubble.href = card.href;
      bubbleText.textContent = card.label;
    }
    const parts = [];
    if (item.shared) parts.push(el('a', { href: item.shared.href }, item.shared.reel ? 'View reel' : 'View post'));
    if (item.from) parts.push(el('span', {}, 'from ', el('a', { href: `/${item.from}/` }, `@${item.from}`)));
    if (item.music) parts.push(el('span', { className: 'sv-music' }, `♪ ${item.music}`));
    sub.replaceChildren(...parts);
    sub.hidden = !parts.length;
  }

  function syncPause() {
    root.classList.toggle('sv-paused', paused());
    if (!current || current.tagName !== 'VIDEO') return;
    if (paused()) current.pause();
    else if (current.paused && !current.ended) startVideo();
  }

  function setMuted(value) {
    muted = value;
    muteBtn.replaceChildren(icon(muted ? SOUND_OFF : SOUND_ON));
    if (current && current.tagName === 'VIDEO') current.muted = muted;
  }

  function startVideo() {
    current.muted = muted;
    const attempt = current.play();
    if (attempt && attempt.catch) {
      // Browsers can refuse to autoplay with sound.
      attempt.catch(() => {
        if (!current || current.muted) return;
        setMuted(true);
        current.play().catch(() => {});
      });
    }
  }

  // How long ago a unix time was, as Instagram writes it: 5m, 3h, 2d, 4w.
  function ago(seconds) {
    const mins = Math.max(1, Math.round((Date.now() / 1000 - seconds) / 60));
    if (mins < 60) return `${mins}m`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
    if (mins < 60 * 24 * 7) return `${Math.floor(mins / 60 / 24)}d`;
    return `${Math.floor(mins / 60 / 24 / 7)}w`;
  }

  function fail(text) {
    note.textContent = text;
    note.hidden = false;
    arrived();
  }

  async function show() {
    const my = ++token;
    if (current && current.tagName === 'VIDEO') current.pause();
    current = null;
    shown = false;
    elapsed = 0;
    const reel = list[ri];
    avatar.src = reel.pic;
    userLink.textContent = reel.username;
    userLink.href = `/${reel.username}/`;
    timeText.textContent = '';
    renderStickers({ ratio: 9 / 16, stickers: [] });
    foot.hidden = true;
    note.hidden = true;
    root.classList.add('sv-loading');
    const was = deck[deckAt]; // the card of the story that was on stage
    if (was && (was.k !== ri || (ii >= 0 && was.j != null && was.j !== ii))) {
      mediaBox.replaceChildren(); // the story's card stands in meanwhile
      if (landed) {
        // The carousel already turned there: the card is in place under the stage.
        arriving = true;
        root.classList.add('sv-arriving');
      } else {
        const to = deck.findIndex((it) => it.k === ri && (it.k !== was.k || it.j === ii));
        beginTurn(peeks.get(was.key), to < 0 ? dir : to - deckAt);
      }
    }
    landed = false;
    endScroll();
    renderDeck();

    loadAhead();
    if (!media.has(reel.id)) await (pending.get(reel.id) || loadReels([reel.id]));
    if (my !== token || !open) return;
    const items = media.get(reel.id);
    if (!items) {
      // Instagram no longer answers our query: hand over to its own viewer.
      close();
      go(`/stories/${reel.username}/`);
      return;
    }
    if (!items.length) {
      reel.unseen = false; // expired since the row was loaded
      const n = ri + dir;
      if (n < 0 || n >= list.length) return close();
      ri = n;
      ii = dir > 0 ? START : landing(list[n]);
      return show();
    }
    if (ii === START) ii = firstUnseen(reel, items);
    else if (ii === LAST) ii = items.length - 1;
    ii = Math.min(Math.max(ii, 0), items.length - 1);
    const item = items[ii];
    renderDeck(); // the account opens into its stories

    bars.replaceChildren(...items.map((_, i) => {
      const fill = el('i', {});
      fill.style.width = i < ii ? '100%' : '0%';
      return el('span', {}, fill);
    }));
    timeText.textContent = ago(item.takenAt);
    syncFoot(reel, item);
    muteBtn.hidden = item.type !== 'video';
    renderStickers(item);

    current = mediaEl(item);
    // The previous story of the account stays underneath until this one has
    // a picture, so switching doesn't flash black (a video takes a moment to
    // show its first frame).
    mediaBox.append(current);
    const clearBelow = () => {
      for (const node of [...mediaBox.children]) if (node !== current) node.remove();
    };
    const ready = () => {
      if (my !== token || shown) return;
      shown = true;
      clearBelow();
      root.classList.remove('sv-loading');
      arrived();
      markSeen(reel, item); // only once it is really on screen
    };
    const broken = () => {
      if (my !== token) return;
      clearBelow();
      fail('This story could not be loaded.');
    };
    // Ready means really painted: a video counts as loaded (even fully) a few
    // frames before Firefox presents its first frame, and an image before it
    // is decoded. Until then the story underneath, or after a turn the card,
    // must stay in view.
    const node = current;
    if (item.type === 'video') {
      const painted = () => {
        if (!node.requestVideoFrameCallback) return ready();
        node.requestVideoFrameCallback(() => ready());
        setTimeout(ready, 500); // a background tab may present no frames
      };
      node.currentTime = 0;
      node.onended = () => { if (my === token) step(1); };
      node.onloadeddata = painted;
      node.onplaying = painted;
      node.onerror = broken;
      if (node.error) broken();
      else if (node.readyState >= 2) painted();
      if (!node.error && !paused()) startVideo();
    } else {
      const painted = () => (node.decode ? node.decode() : Promise.resolve()).then(ready, ready);
      node.onload = painted;
      node.onerror = broken;
      if (node.complete) (node.naturalWidth ? painted : broken)();
    }
    preload();
  }

  function tick(now) {
    if (!open) return;
    raf = requestAnimationFrame(tick);
    const dt = now - lastTick;
    lastTick = now;
    const bar = bars.children[ii];
    if (!current || !shown || !bar) return;
    let done;
    if (current.tagName === 'VIDEO') {
      done = current.duration ? current.currentTime / current.duration : 0;
    } else {
      if (!paused()) elapsed += dt;
      done = elapsed / IMAGE_MS;
      if (done >= 1) return step(1);
    }
    bar.firstChild.style.width = `${Math.min(done, 1) * 100}%`;
  }

  // Next or previous story, crossing into the neighbouring account at the ends.
  function step(delta) {
    const items = media.get(list[ri].id) || [];
    if (ii === START || ii === LAST) return; // still loading this account
    if (delta > 0 && ii < items.length - 1) ii++;
    else if (delta < 0 && ii > 0) ii--;
    else return jump(delta);
    show();
  }

  // Next or previous account.
  function jump(delta) {
    const n = ri + delta;
    if (n >= list.length) return close();
    dir = delta;
    if (n < 0) {
      ii = 0;
    } else {
      leave();
      ri = n;
      ii = delta > 0 ? START : landing(list[n]);
    }
    show();
  }

  // Straight to another account, from its card: the story the card shows.
  function toReel(k) {
    if (k < 0 || k >= list.length || k === ri) return;
    dir = k > ri ? 1 : -1;
    leave();
    ri = k;
    ii = dir > 0 ? START : landing(list[k]);
    show();
  }

  // Going back to an account lands where you left it, else on its last story.
  const landing = (reel) => (reel.leftAt != null ? reel.leftAt : LAST);

  function openViewer(reels, index, hooks) {
    if (open) return;
    // Opened on an unwatched account: end after the last unwatched one instead
    // of running on into accounts already watched (the row puts those last).
    let end = reels.length;
    if (reels[index].unseen) {
      end = reels.findIndex((r, i) => i > index && !r.unseen);
      if (end < 0) end = reels.length;
    }
    list = reels.slice(0, end);
    for (const reel of list) delete reel.leftAt;
    ri = index;
    ii = START;
    dir = 1;
    open = true;
    spacePaused = false;
    holding = false;
    typing = false;
    replyInput.value = '';
    delete foot.dataset.reel;
    toast.hidden = true;
    onClose = hooks && hooks.onClose;
    setMuted(muted);
    for (const video of document.querySelectorAll('main video')) video.pause();
    document.documentElement.classList.add('sinsta-viewing');
    onTop(root);
    layoutDeck();
    lastTick = performance.now();
    raf = requestAnimationFrame(tick);
    show();
  }

  function close() {
    if (!open) return;
    open = false;
    token++;
    cancelAnimationFrame(raf);
    for (const node of preloaded.values()) unload(node);
    preloaded.clear();
    current = null;
    mediaBox.replaceChildren();
    clearDeck();
    replyInput.blur();
    typing = false;
    root.remove();
    document.documentElement.classList.remove('sinsta-viewing');
    if (onClose) onClose();
  }

  return {
    api, go, el, shadowVideo, hostOf, icon, onTop, openViewer, fetchReels, setFavourite, appOnlyNotifications, recentPosts, reelsPage, reelByCode,
    mark, userIds, lookUpId, ago,
    likeMedia, likeComment, comments, replies, addComment,
  };
})();
