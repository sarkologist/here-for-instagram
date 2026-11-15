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

  // Reads work on /graphql/query with just the CSRF cookie. Mutations sent
  // there are accepted but silently dropped (the result is null): they need
  // /api/graphql plus the page's session tokens, as do a few reads.
  function gql(docId, variables, mutation) {
    const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
    const params = { doc_id: docId, variables: JSON.stringify(variables) };
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
    const items = [];
    for (const e of conn.edges || []) {
      const m = e.node && e.node.media;
      const video = m && (m.video_versions || [])[0];
      if (!m || !m.code || !m.user || !video) continue;
      const cands = (m.image_versions2 && m.image_versions2.candidates) || [];
      const portrait = cands.filter((c) => c.height > c.width);
      items.push({
        pk: String(m.pk),
        code: m.code,
        username: m.user.username,
        pic: m.user.profile_pic_url,
        caption: (m.caption && m.caption.text) || '',
        likes: m.like_and_view_counts_disabled ? null : m.like_count,
        // Covers, largest first: portrait ones, else the square crops.
        thumbs: (portrait.length ? portrait : cands).sort((a, b) => b.width - a.width),
        video: video.url,
      });
    }
    const info = conn.page_info || {};
    return { items, after: info.has_next_page ? info.end_cursor : null };
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

  function el(tag, props, ...kids) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  }

  // Show a full-window overlay in the browser's top layer, so it covers
  // whatever Instagram stacks with z-index (in narrow or zoomed windows,
  // parts of its hidden feed otherwise show through).
  function onTop(node) {
    document.body.append(node);
    if (!node.showPopover || node.matches(':popover-open')) return;
    node.popover = 'manual';
    node.showPopover();
  }

  // TEMP: measures why the bottom of full-window overlays gets cut off in
  // some Firefox setups. Bound to L in the story viewer and the reels player;
  // the report is copied and shown in a text box on the overlay.
  function layerReport(overlay, stage, extra) {
    const rect = (n) => {
      if (!n) return null;
      const b = n.getBoundingClientRect();
      return [b.top, b.bottom, b.height].map(Math.round);
    };
    const props = ['position', 'height', 'overflow', 'transform', 'filter', 'contain', 'will-change', 'clip-path', 'zoom'];
    const css = (n) => {
      const st = getComputedStyle(n);
      return props.map((p) => `${p}:${st.getPropertyValue(p)}`).join('; ');
    };
    const probe = (style) => {
      const d = el('div');
      d.style.cssText = `${style};visibility:hidden;pointer-events:none`;
      document.body.append(d);
      const h = Math.round(d.getBoundingClientRect().height);
      d.remove();
      return h;
    };
    const desc = (n) => n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '')
      + (typeof n.className === 'string' && n.className.trim() ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '');
    const round = (n) => Math.round(n * 100) / 100;
    const vv = window.visualViewport;
    let fullScreen = null;
    try { fullScreen = window.fullScreen; } catch (_) { /* not Firefox */ }
    const ours = (n) => n.closest('[id^="sinsta"]');
    // An Instagram element that is fixed to the window (its sidebar), which
    // is drawn in full even when ours are cut off.
    const igFixed = [...document.querySelectorAll('a[href="/reels/"], a[href="/explore/"]')]
      .filter((a) => !ours(a))
      .map((a) => {
        for (let e = a; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return e;
        return null;
      })
      .find(Boolean);
    const info = {
      inner: [innerWidth, innerHeight],
      client: document.documentElement.clientHeight,
      vv: vv && [vv.width, vv.height, vv.offsetTop, vv.pageTop, vv.scale].map(round),
      outer: [outerWidth, outerHeight, screenY],
      screen: [screen.width, screen.height, screen.availHeight],
      fullScreen,
      dpr: round(devicePixelRatio),
      scroll: [Math.round(scrollY), document.documentElement.scrollHeight],
      fixed: probe('position:fixed;inset:0'),
      vh: probe('position:absolute;top:0;height:100vh'),
      dvh: probe('position:absolute;top:0;height:100dvh'),
      overlay: [desc(overlay), rect(overlay)],
      topLayer: overlay.matches(':popover-open'),
      overlayState: (() => {
        const st = getComputedStyle(overlay);
        const chain = [];
        for (let e = overlay.parentElement; e; e = e.parentElement) chain.push(desc(e));
        return {
          parents: chain,
          copies: document.querySelectorAll('#' + overlay.id).length,
          attrs: [...overlay.attributes].map((a) => a.name),
          css: ['display', 'visibility', 'pointer-events', 'opacity', 'z-index', 'position'].map((p) => `${p}:${st.getPropertyValue(p)}`).join('; '),
          inert: overlay.inert,
          inertAncestor: !!(overlay.parentElement && overlay.parentElement.closest('[inert]')),
          runs: document.documentElement.dataset.sinstaRuns,
        };
      })(),
      stage: rect(stage),
      html: rect(document.documentElement),
      body: rect(document.body),
      htmlCss: css(document.documentElement),
      bodyCss: css(document.body),
      igFixed: igFixed ? [desc(igFixed), rect(igFixed), css(igFixed)] : null,
      atBottom: document.elementsFromPoint(innerWidth / 2, innerHeight - 20).slice(0, 5).map(desc),
      atStageBottom: document.elementsFromPoint(innerWidth / 2, stage.getBoundingClientRect().bottom - 10).slice(0, 3).map(desc),
      ua: navigator.userAgent,
    };
    // Where hit-testing stops finding a layer (it follows the same clip as
    // drawing), and whether some workarounds move that line.
    const clipY = (n, x = innerWidth / 2) => {
      const hits = (_, y) => document.elementsFromPoint(x, y).some((h) => n.contains(h));
      if (hits(n, innerHeight - 2)) return innerHeight;
      let lo = 0;
      let hi = innerHeight - 2;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (hits(n, mid)) lo = mid; else hi = mid;
      }
      return lo;
    };
    const tests = { base: clipY(overlay) };
    document.documentElement.classList.remove('sinsta-viewing');
    tests.noOverflowHidden = clipY(overlay);
    document.documentElement.classList.add('sinsta-viewing');
    const saved = overlay.style.cssText;
    overlay.style.cssText += ';transform:translateZ(0)';
    tests.ownLayer = clipY(overlay);
    overlay.style.cssText = saved;
    if (overlay.matches(':popover-open')) {
      overlay.hidePopover();
      overlay.removeAttribute('popover');
      tests.notTopLayer = clipY(overlay);
      overlay.popover = 'manual';
      overlay.showPopover();
    }
    const grid = document.getElementById('sinsta-reels');
    if (grid) tests.reelsGrid = clipY(grid);
    if (igFixed) {
      const r = igFixed.getBoundingClientRect();
      tests.igFixed = clipY(igFixed, r.left + r.width / 2);
    }
    const parents = [['probeInBody', document.body], ['probeInHtml', document.documentElement],
      ['probeInIgRoot', [...document.body.children].find((c) => c.tagName === 'DIV' && !ours(c))], ['probeInIgFixed', igFixed],
      ['probeInOverlay', overlay]];
    for (const [name, parent] of parents) {
      if (!parent) continue;
      const p = el('div');
      p.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      parent.append(p);
      tests[name] = clipY(p);
      p.remove();
    }
    info.clipTests = tests;
    Object.assign(info, extra);
    const text = JSON.stringify(info, null, 1);
    let box = overlay.querySelector('.sinsta-debug');
    if (box) box.remove();
    box = el('textarea', { className: 'sinsta-debug', value: text, readOnly: true });
    box.style.cssText = 'position:absolute;top:16px;left:16px;z-index:5;width:420px;height:60vh;font:11px/1.3 monospace;color:#000;background:#fff';
    overlay.append(box);
    box.select();
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function icon(paths) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
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
  const nativeLink = el('a', { className: 'sv-btn', title: 'Open in Instagram to reply, react or vote' },
    icon(['M14 4h6v6', 'M20 4l-9 9', 'M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5']));
  const note = el('div', { className: 'sv-note' });
  const stickerBox = el('div', { className: 'sv-stickers' });
  const bubbleText = el('span');
  const bubble = el('a', { className: 'sv-bubble', hidden: true }, bubbleText, icon(['M9 5l7 7-7 7']));
  const sub = el('div', { className: 'sv-sub' });
  const stage = el('div', { className: 'sv-stage' },
    mediaBox,
    stickerBox,
    el('div', { className: 'sv-top' },
      bars,
      el('div', { className: 'sv-head' }, avatar, userLink, timeText, el('span', { className: 'sv-gap' }), muteBtn, nativeLink),
      sub),
    note);
  const prevBtn = el('button', { className: 'sv-arrow', type: 'button', title: 'Previous (←)' }, icon(['M15 5l-7 7 7 7']));
  const nextBtn = el('button', { className: 'sv-arrow', type: 'button', title: 'Next (→)' }, icon(['M9 5l7 7-7 7']));
  const closeBtn = el('button', { className: 'sv-close', type: 'button', title: 'Close (Esc)' }, icon(['M6 6l12 12M18 6L6 18']));
  const root = el('div', { id: 'sinsta-viewer' }, closeBtn, prevBtn, stage, nextBtn);

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
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
    if (e.button !== 0 || e.target.closest('a, button')) return;
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

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const actions = {
      Escape: () => close(),
      ArrowRight: () => (e.shiftKey ? jump(1) : step(1)),
      ArrowLeft: () => (e.shiftKey ? jump(-1) : step(-1)),
      ' ': () => { spacePaused = !spacePaused; syncPause(); },
      m: () => setMuted(!muted),
      l: () => debugInfo(), // TEMP: bottom-strip diagnostics
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  }

  // TEMP: bottom-strip diagnostics (see layerReport).
  function debugInfo() {
    spacePaused = true;
    syncPause();
    layerReport(root, stage);
  }

  // ---- Data ---------------------------------------------------------------

  function toItem(it) {
    const video = it.media_type === 2 && it.video_versions && it.video_versions[0];
    const image = it.image_versions2 && it.image_versions2.candidates && it.image_versions2.candidates[0];
    if (!video && !image) return null;
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
      poster: image ? image.url : '',
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

  // One request for several accounts' stories.
  function loadReels(ids) {
    const job = gql(DOC_REELS, {
      media_id: null,
      reel_ids_arr: ids,
      __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true,
    }).then((data) => {
      const got = data && data.data && data.data.xdt_api__v1__feed__reels_media;
      const byId = new Map(((got && got.reels_media) || []).map((r) => [String(r.id), r]));
      for (const id of ids) {
        pending.delete(id);
        if (!got) continue; // request failed: stays unknown, show() falls back
        const reel = byId.get(id);
        media.set(id, reel ? reel.items.map(toItem).filter(Boolean) : []);
        const mine = list.find((r) => r.id === id);
        if (mine && reel) mine.seenAt = Math.max(mine.seenAt, reel.seen || 0);
      }
      if (open) preload();
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
      if (keep.has(src)) continue;
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

  // ---- Playback -----------------------------------------------------------

  const paused = () => spacePaused || holding || hovering || bubbleOn;

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

  function ago(seconds) {
    const mins = Math.max(1, Math.round((Date.now() / 1000 - seconds) / 60));
    return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  }

  function fail(text) {
    note.textContent = text;
    note.hidden = false;
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
    note.hidden = true;
    root.classList.add('sv-loading');

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
      ii = dir > 0 ? START : LAST;
      return show();
    }
    if (ii === START) ii = firstUnseen(reel, items);
    else if (ii === LAST) ii = items.length - 1;
    ii = Math.min(Math.max(ii, 0), items.length - 1);
    const item = items[ii];

    bars.replaceChildren(...items.map((_, i) => {
      const fill = el('i', {});
      fill.style.width = i < ii ? '100%' : '0%';
      return el('span', {}, fill);
    }));
    timeText.textContent = ago(item.takenAt);
    nativeLink.href = `/stories/${reel.username}/${item.pk}/`;
    muteBtn.hidden = item.type !== 'video';
    renderStickers(item);

    current = mediaEl(item);
    mediaBox.replaceChildren(current);
    const ready = () => {
      if (my !== token || shown) return;
      shown = true;
      root.classList.remove('sv-loading');
      markSeen(reel, item); // only once it is really on screen
    };
    const broken = () => {
      if (my === token) fail('This story could not be loaded.');
    };
    if (item.type === 'video') {
      current.currentTime = 0;
      current.onended = () => { if (my === token) step(1); };
      current.onloadeddata = ready;
      current.onplaying = ready;
      current.onerror = broken;
      if (current.error) broken();
      else if (current.readyState >= 2) ready();
      if (!current.error && !paused()) startVideo();
    } else {
      current.onload = ready;
      current.onerror = broken;
      if (current.complete) (current.naturalWidth ? ready : broken)();
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
      ri = n;
      ii = delta > 0 ? START : LAST;
    }
    show();
  }

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
    ri = index;
    ii = START;
    dir = 1;
    open = true;
    spacePaused = false;
    holding = false;
    onClose = hooks && hooks.onClose;
    setMuted(muted);
    for (const video of document.querySelectorAll('main video')) video.pause();
    document.documentElement.classList.add('sinsta-viewing');
    onTop(root);
    window.addEventListener('keydown', onKey, true);
    lastTick = performance.now();
    raf = requestAnimationFrame(tick);
    show();
  }

  function close() {
    if (!open) return;
    open = false;
    token++;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    for (const node of preloaded.values()) unload(node);
    preloaded.clear();
    current = null;
    mediaBox.replaceChildren();
    root.remove();
    document.documentElement.classList.remove('sinsta-viewing');
    if (onClose) onClose();
  }

  return { api, go, el, icon, onTop, layerReport, openViewer, fetchReels, setFavourite, appOnlyNotifications, recentPosts, reelsPage };
})();
