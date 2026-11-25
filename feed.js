// Home's views and Reels, drawn by the extension.
//
// Following, Favourites and Algo show Instagram's home feeds, and Reels its
// Reels feed, read with the queries Instagram's own pages use, as a list or
// as a grid (one choice for all four). The list shows just the photos: a
// post's name, buttons and caption appear over it while the pointer is on
// it. Clicking a tile, or a post's comments button, opens the player, which
// goes through the view in order with the caption and comments beside it.
// Instagram's own page stays underneath, hidden and paused.
//
// If a home feed can't be loaded, that view falls back to Instagram's page,
// which content.js filters. Reels in the list layout is Instagram's player.
(() => {
  'use strict';

  const {
    go, el, shadowVideo, hostOf, icon, seekbar, shiftSpeed, cycleSpeed, setRate, speedLabel, onTop, reelsPage, reelByCode, feedPage, ago,
    likeMedia, likeComment, comments, replies, addComment,
  } = Sinsta;
  // content.js: seen posts, favourites, the tab bar.
  const home = () => Sinsta.home || null;

  const KEY = 'sinsta-surface';
  const OLD_KEY = 'sinsta-reels'; // before Home was drawn here: { grid, columns }
  const MIN_COLS = 1;
  const MAX_COLS = 8;
  const PREVIEW_MS = 250; // hover this long before a cover starts playing
  const WHEEL_STEP = 40; // px of scrolling that moves the player one post
  const WHEEL_IDLE = 200; // ms without scroll events that ends a gesture
  const SETTLE_MS = 150; // ms without scrolling after which a carousel has come to rest
  const SEEN_MS = 1000; // as in content.js: on screen this long counts as seen
  const RUN_LIMIT = 120; // seen posts in a row before pausing, as in content.js
  const storage = typeof browser === 'object' && browser.storage && browser.storage.local;

  const GRID = ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'];
  const LIST = ['M6 3.5h12v7H6z', 'M6 13.5h12v7H6z'];
  const MINUS = ['M6 12h12'];
  const PLUS = ['M6 12h12', 'M12 6v12'];
  const HEART = ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'];
  const CLOSE = ['M6 6l12 12M18 6L6 18'];
  const UP = ['M6 15l6-6 6 6'];
  const DOWN = ['M6 9l6 6 6-6'];
  const COMMENT = ['M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z'];
  const LINK = ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'];
  const SOUND_OFF = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9.5l5 5M21.5 9.5l-5 5'];
  const SOUND_ON = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 8.5a5 5 0 0 1 0 7'];
  const PLAY = ['M8 5v14l11-7z'];

  const VIEWS = ['following', 'favorites', 'algo', 'reels'];
  const SEEN_VIEWS = new Set(['following', 'favorites']); // where "Hide seen" applies

  let prefs = {
    layout: 'grid',
    cols: { following: 4, favorites: 3, algo: 3, reels: 4 },
    muted: false,
    volume: 1,
    speed: 1,
    comments: true,
  };

  // The view Home or Reels is on, from the address.
  function viewOf() {
    if (/^\/reels(\/|$)/.test(location.pathname)) return 'reels';
    if (location.pathname !== '/') return null;
    const variant = new URLSearchParams(location.search).get('variant');
    return variant === 'following' || variant === 'favorites' ? variant : 'algo';
  }

  // Each view's feed survives leaving it (the script lives across Instagram's
  // in-page navigation), so coming back finds it as it was until the page
  // reloads.
  const feeds = {};
  function feed(view) {
    return feeds[view] || (feeds[view] = {
      items: [], known: new Set(), after: null, ended: false, loading: false, failed: false,
      unavailable: false, scroll: 0, runLimit: RUN_LIMIT,
    });
  }

  let cur = null; // the view on screen
  let active = false; // whether the surface is up
  let shown = []; // the current view's items on screen, in feed order
  let shownKey = '';
  let queued = false;
  let measuredAt = 0;
  let lastPath = null;
  let visitAt = null; // content.js's visit start, as last seen

  // ---- DOM ----------------------------------------------------------------

  function button(cls, title, paths) {
    const b = el('button', { className: cls, type: 'button', title });
    b.append(icon(paths));
    return b;
  }

  // List / Grid and the column count, which go in the tab bar.
  const listBtn = button('sf-lay', 'List (G)', LIST);
  const gridBtn = button('sf-lay', 'Grid (G)', GRID);
  const layoutSwitch = el('div', { className: 'sf-switch' }, listBtn, gridBtn);
  const fewer = button('sf-step', 'Fewer columns (−)', MINUS);
  const more = button('sf-step', 'More columns (+)', PLUS);
  const count = el('span', { className: 'sf-count' });
  const stepper = el('div', { className: 'sf-stepper' }, fewer, count, more);
  const controls = el('div', { className: 'sf-controls' }, layoutSwitch, stepper);

  const header = el('div', { className: 'sf-header' });
  const content = el('div', { className: 'sf-content' });
  const status = el('div', { className: 'sr-status' });
  const root = el('div', { id: 'sinsta-surface', tabIndex: -1 }, header, content, status);
  // Holds the tab bar over Instagram's own Reels player.
  const float = el('div', { id: 'sinsta-float' });

  listBtn.addEventListener('click', () => setLayout('list'));
  gridBtn.addEventListener('click', () => setLayout('grid'));
  fewer.addEventListener('click', () => setColumns(cols() - 1));
  more.addEventListener('click', () => setColumns(cols() + 1));

  const cols = () => prefs.cols[cur] || 3;
  const isGrid = () => prefs.layout === 'grid';

  function setLayout(layout) {
    if (prefs.layout === layout) return;
    if (cur && cur !== 'reels' && feed(cur).unavailable) return;
    const anchor = active ? topItem() : null;
    prefs.layout = layout;
    save();
    shownKey = '';
    schedule();
    if (anchor) requestAnimationFrame(() => requestAnimationFrame(() => scrollToItem(anchor, 'start')));
  }

  function setColumns(n) {
    n = Math.max(MIN_COLS, Math.min(MAX_COLS, n));
    if (!cur || n === cols()) return;
    // Keep the post at the top of the view in place across the reflow.
    const anchor = topItem();
    prefs.cols[cur] = n;
    save();
    syncControls();
    render(true);
    if (anchor) scrollToItem(anchor, 'start');
    fill();
  }

  function syncControls() {
    const grid = isGrid();
    const unavailable = !!cur && cur !== 'reels' && feed(cur).unavailable;
    listBtn.setAttribute('aria-pressed', String(!grid || unavailable));
    gridBtn.setAttribute('aria-pressed', String(grid && !unavailable));
    gridBtn.disabled = unavailable;
    gridBtn.title = !unavailable ? 'Grid (G)'
      : feed(cur).unavailable === 'unclassified' ? "This feed doesn't say whom you follow, so this is Instagram's own page"
        : "Couldn't load this feed, so this is Instagram's own page";
    listBtn.title = cur === 'reels' ? "List: Instagram's own player (G)" : 'List (G)';
    stepper.hidden = !(grid && active);
    // Setting text always replaces the node, which would wake the
    // MutationObservers and run all this again every frame.
    const n = String(cols());
    if (count.textContent !== n) count.textContent = n;
    count.title = `${n} column${n === '1' ? '' : 's'}`;
    fewer.disabled = cols() <= MIN_COLS;
    more.disabled = cols() >= MAX_COLS;
    const h = home();
    if (h && h.slot && controls.parentElement !== h.slot) h.slot.append(controls);
  }

  // ---- Which posts show -----------------------------------------------------

  // Whether a post belongs in the view. Following leaves out favourites, who
  // have their own view; Algo keeps only posts from accounts you don't follow
  // (Instagram's suggestions). Ads go everywhere.
  function belongs(view, it) {
    if (it.ad) return false;
    const h = home();
    if (view === 'following') return !(h && h.favNames.has(it.username));
    if (view === 'favorites') return !(h && h.unfavved.has(it.username));
    if (view === 'algo') return it.following === false;
    return true;
  }

  // Seen before this visit (see content.js), in the views that track it.
  function seenBefore(view, it) {
    const h = home();
    return view !== 'reels' && !!h && h.seenBefore(it.code);
  }

  function hidingSeen(view) {
    const h = home();
    return SEEN_VIEWS.has(view) && !!h && h.hideSeen();
  }

  function visible(view, it) {
    return belongs(view, it) && !(hidingSeen(view) && seenBefore(view, it));
  }

  // Posts in a row at the end of what's loaded that were skipped while
  // looking for ones to show: seen ones (with Hide seen on) or, in Algo,
  // ones from accounts you follow (Instagram's home feed puts its
  // suggestions after the recent posts of people you follow).
  function seenRun(view) {
    const algo = view === 'algo';
    if (!algo && !hidingSeen(view)) return 0;
    const items = feed(view).items;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.ad) continue;
      if (algo) {
        if (belongs(view, it)) break;
      } else {
        if (!belongs(view, it)) continue;
        if (!seenBefore(view, it)) break;
      }
      n++;
    }
    return n;
  }

  // One wheel gesture, a trackpad's momentum tail included, acts once: `act`
  // gets the direction once it has gone far enough. A gesture keeps the `key`
  // it started with (an axis), which it returns; events for another key are
  // ignored.
  function wheelGesture() {
    let sum = 0;
    let last = 0;
    let acted = false;
    let key = null;
    return (delta, k, act) => {
      const now = Date.now();
      if (now - last > WHEEL_IDLE) {
        sum = 0;
        acted = false;
        key = k;
      }
      last = now;
      if (acted || k !== key || !act) return key;
      sum += delta;
      if (Math.abs(sum) < WHEEL_STEP) return key;
      acted = true;
      act(Math.sign(sum));
      return key;
    };
  }

  const wheelScale = (e) => (e.deltaMode === 1 ? 16 : 1); // lines to px

  // ---- Rendering --------------------------------------------------------------

  const link = (it) => `/${it.kind === 'reel' ? 'reel' : 'p'}/${it.code}/`;

  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    return n.toLocaleString('en');
  }

  // A post's shape on screen: Instagram's own limits (4:5 to 1.91:1), reels
  // 9:16 in the Reels grid.
  function shape(it, view = cur) {
    const s = it.slides[0];
    if (view === 'reels') return 9 / 16;
    return Math.min(1.91, Math.max(it.kind === 'reel' && !isGrid() ? 9 / 16 : 0.8, s.w / s.h));
  }

  function picture(slide, sizes) {
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
    if (slide.thumbs.length) {
      img.src = slide.thumbs[slide.thumbs.length - 1].url;
      img.srcset = slide.thumbs.map((c) => `${c.url} ${c.width}w`).join(', ');
      img.sizes = sizes;
    }
    return img;
  }

  function avatar(it, cls) {
    return el('img', { className: cls, src: it.pic || '', alt: '', loading: 'lazy' });
  }

  // Grid: columns of tiles, each tile going to the shortest column.
  let columns = []; // [{ node, h }]

  function tileWidth() {
    const width = content.clientWidth || root.clientWidth || window.innerWidth;
    return Math.ceil(width / cols()) + 'px';
  }

  function tile(it) {
    const a = el('a', { className: 'sf-tile', href: link(it) });
    a.dataset.pk = it.pk;
    a.style.aspectRatio = String(shape(it));
    if (seenBefore(cur, it)) a.classList.add('sf-seen');
    a.append(trackOf(it, picture(it.slides[0], tileWidth())));
    if (cur !== 'reels' && it.slides.some((s) => s.video)) {
      a.append(el('span', { className: 'sf-badge', hidden: !it.video }, icon(PLAY)));
    }
    if (it.slides.length > 1) a.append(dotsOf(it));
    const likes = el('span', { className: 'sf-tlikes' });
    if (it.likes != null) likes.append(icon(HEART), compact(it.likes));
    const info = el('div', { className: 'sf-tinfo' },
      el('div', { className: 'sf-tcap' }, it.caption),
      el('div', { className: 'sf-trow' }, avatar(it, 'sf-tpic'), el('span', { className: 'sf-tuser' }, it.username), likes));
    a.append(info);
    return a;
  }

  function place(it) {
    const c = columns.reduce((a, b) => (b.h < a.h - 1e-6 ? b : a));
    c.node.append(tile(it));
    c.h += 1 / shape(it);
  }

  // List: the photos, with their name, buttons and caption over them.
  function post(it) {
    const art = el('article', { className: 'sf-post' });
    art.dataset.pk = it.pk;
    art.style.setProperty('--ar', String(shape(it)));
    if (seenBefore(cur, it)) art.classList.add('sf-seen');
    art.append(el('div', { className: 'sf-media' }, trackOf(it, picture(it.slides[0], LIST_SIZES))));

    const user = el('a', { className: 'sf-user', href: `/${it.username}/` }, it.username);
    const head = el('div', { className: 'sf-head' }, avatar(it, 'sf-pic'), user,
      el('span', { className: 'sf-time' }, ago(it.takenAt)));
    if (cur === 'algo') head.append(el('span', { className: 'sf-sug' }, 'Suggested for you'));

    const like = button('sf-act', 'Like (L)', HEART);
    like.dataset.act = 'like';
    const cmt = button('sf-act', 'Comments (C)', COMMENT);
    cmt.dataset.act = 'comments';
    const copy = button('sf-act', 'Copy link', LINK);
    copy.dataset.act = 'link';
    const acts = el('div', { className: 'sf-acts' }, like, cmt, copy);
    const likes = el('div', { className: 'sf-likes' });
    const foot = el('div', { className: 'sf-foot' }, acts, likes);
    if (it.caption) foot.append(el('div', { className: 'sf-cap' }, ...richText(it.caption)));
    if (it.comments) {
      const all = el('button', { type: 'button', className: 'sf-all' }, `View all ${compact(it.comments)} comments`);
      all.dataset.act = 'comments';
      foot.append(all);
    }
    art.append(head, foot);
    if (it.slides.length > 1) art.append(dotsOf(it));
    syncPost(art, it);
    return art;
  }

  function syncPost(art, it) {
    const like = art.querySelector('[data-act="like"]');
    like.toggleAttribute('data-on', it.liked);
    like.title = it.liked ? 'Unlike (L)' : 'Like (L)';
    const likes = art.querySelector('.sf-likes');
    const text = it.likes != null ? `${it.likes.toLocaleString('en')} like${it.likes === 1 ? '' : 's'}` : '';
    if (likes.textContent !== text) likes.textContent = text;
  }

  // A carousel's dots, along the bottom of a list post or a grid tile.
  function dotsOf(it) {
    return el('div', { className: 'sf-dots' }, ...it.slides.map((_, i) => el('i', { className: i ? '' : 'sf-on' })));
  }

  const slideOf = (node) => Number(node.dataset.slide || 0);

  const LIST_SIZES = 'min(470px, 100vw)';

  // A post's photos side by side, in a track that scrolls sideways natively
  // (a trackpad's two-finger swipe, a finger, Shift + mouse wheel) and snaps
  // to each in turn. A cell gets its photo once the track comes near it.
  function trackOf(it, first) {
    const t = el('div', { className: 'sf-track' }, ...it.slides.map(() => el('div', { className: 'sf-cell' })));
    t.firstChild.append(first);
    return t;
  }

  // The cell a track is (nearest to) showing.
  const cellAt = (t) => Math.max(0, Math.min(t.children.length - 1, Math.round(t.scrollLeft / (t.clientWidth || 1))));

  // Cell i and its neighbours get their photo, `make(slide)`, loaded now
  // (lazily they would wait until scrolled into view).
  function fillCells(t, it, i, make) {
    for (let j = Math.max(0, i - 1); j <= Math.min(it.slides.length - 1, i + 1); j++) {
      const c = t.children[j];
      if (c.firstChild) continue;
      const img = make(it.slides[j]);
      img.loading = 'eager';
      c.append(img);
    }
  }

  function syncDots(dots, i, cls) {
    if (dots) [...dots.children].forEach((d, k) => d.classList.toggle(cls, k === i));
  }

  // The carousels under `root`: `move(track, i)` as one scrolls, `land(track,
  // i)` once it comes to rest on cell i.
  function watchTracks(root, move, land) {
    const timers = new WeakMap();
    const isTrack = (t) => t.classList && t.classList.contains('sf-track');
    const settle = (t) => {
      clearTimeout(timers.get(t));
      land(t, cellAt(t));
    };
    root.addEventListener('scroll', (e) => {
      const t = e.target;
      if (!isTrack(t)) return;
      move(t, cellAt(t));
      clearTimeout(timers.get(t));
      timers.set(t, setTimeout(() => settle(t), SETTLE_MS));
    }, true);
    root.addEventListener('scrollend', (e) => {
      if (isTrack(e.target)) settle(e.target);
    }, true);
  }

  // A list post's or grid tile's neighbouring photos, ready to swipe to.
  function nearCells(node) {
    const it = itemOf(node);
    const t = node && node.querySelector('.sf-track');
    if (!it || !t || it.slides.length < 2) return;
    const sizes = node.classList.contains('sf-tile') ? tileWidth() : LIST_SIZES;
    fillCells(t, it, cellAt(t), (sl) => picture(sl, sizes));
  }

  // A list post or grid tile at rest on photo i: its video plays there.
  function landOn(node, i) {
    const it = itemOf(node);
    if (!it || i === slideOf(node)) return;
    node.dataset.slide = i;
    if (node.classList.contains('sf-tile')) {
      const badge = node.querySelector('.sf-badge');
      if (badge) badge.hidden = !it.slides[i].video;
      if (previewTile === node) {
        stopPreview();
        startPreview(node, 0);
      }
      return;
    }
    stopListVideo(node);
    if (node.dataset.onScreen) startListVideo(node);
  }

  watchTracks(content, (t, i) => {
    const node = t.closest('[data-pk]');
    syncDots(node.querySelector('.sf-dots'), i, 'sf-on');
    nearCells(node);
  }, (t, i) => landOn(t.closest('[data-pk]'), i));

  const listVideos = new WeakMap(); // article -> its playing video

  function startListVideo(art) {
    const it = itemOf(art);
    const slide = it && it.slides[slideOf(art)];
    if (!slide || !slide.video || listVideos.has(art)) return;
    const v = shadowVideo({ muted: true, loop: true, autoplay: true, playsInline: true, src: slide.video }, 'cover');
    const host = hostOf(v);
    host.className = 'sr-preview';
    v.addEventListener('playing', () => host.classList.add('sr-on'), { once: true });
    listVideos.set(art, v);
    art.querySelector('.sf-track').children[slideOf(art)].append(host);
    art.classList.add('sf-video');
  }

  function stopListVideo(art) {
    const v = listVideos.get(art);
    if (!v) return;
    listVideos.delete(art);
    unload(v);
    art.classList.remove('sf-video');
  }

  // Comment and caption text with @mentions and #hashtags as links.
  function richText(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(/([@#])([\p{L}\p{N}_.]+)/gu)) {
      if (m.index > 0 && /[\p{L}\p{N}_]/u.test(text[m.index - 1])) continue;
      // Usernames may contain dots, but not end with one; hashtags have none.
      const name = m[1] === '@' ? m[2].replace(/\.+$/, '') : m[2].split('.')[0];
      if (!name) continue;
      out.push(text.slice(last, m.index));
      const href = m[1] === '@' ? `/${name}/` : `/explore/tags/${encodeURIComponent(name)}/`;
      out.push(el('a', { href, className: 'sr-ctag' }, m[1] + name));
      last = m.index + 1 + name.length;
    }
    out.push(text.slice(last));
    return out;
  }

  function itemOf(node) {
    const pk = node && node.dataset.pk;
    return pk ? shown.find((it) => it.pk === pk) || null : null;
  }

  // Draw the current view's posts. `force`: even if the same posts show.
  function render(force) {
    if (!cur) return;
    const f = feed(cur);
    const list = f.items.filter((it) => visible(cur, it));
    const key = `${cur}|${prefs.layout}|${cols()}|${list.map((it) => it.pk).join(',')}`;
    if (!force && key === shownKey) return;
    // Posts only added at the end: append them rather than redrawing.
    const grows = !force && shownKey && shownKey.startsWith(`${cur}|${prefs.layout}|${cols()}|`)
      && list.length > shown.length && shown.every((it, i) => list[i] === it);
    const fresh = grows ? list.slice(shown.length) : list;
    shownKey = key;
    if (!grows) {
      stopPreview();
      for (const art of content.querySelectorAll('.sf-post')) {
        stopListVideo(art);
        listWatch.unobserve(art);
      }
      content.replaceChildren();
      content.className = 'sf-content ' + (isGrid() ? 'sf-grid' : 'sf-list');
      columns = [];
      if (isGrid()) {
        for (let i = 0; i < cols(); i++) columns.push({ node: el('div', { className: 'sf-col' }), h: 0 });
        content.append(...columns.map((c) => c.node));
        // No tile taller than the window, however few the columns.
        const tallest = cur === 'reels' ? 9 / 16 : 0.8;
        content.style.maxWidth = `calc(${cols()} * (100vh - 120px) * ${tallest} + ${(cols() - 1) * 3}px)`;
      } else {
        content.style.maxWidth = '';
      }
    }
    shown = list;
    if (isGrid()) for (const it of fresh) place(it);
    else for (const it of fresh) {
      const art = post(it);
      content.append(art);
      listWatch.observe(art);
    }
  }

  function topItem() {
    const top = root.getBoundingClientRect().top + 80;
    let best = null;
    for (const n of content.querySelectorAll('[data-pk]')) {
      const r = n.getBoundingClientRect();
      if (r.bottom > top && (!best || r.top < best.top)) best = { pk: n.dataset.pk, top: r.top };
    }
    return best && best.pk;
  }

  function nodeOf(pk) {
    return content.querySelector(`[data-pk="${CSS.escape(pk)}"]`);
  }

  function scrollToItem(pk, block) {
    const n = nodeOf(pk);
    if (n) n.scrollIntoView({ block });
  }

  // ---- List: seen posts and videos ----------------------------------------

  // The player or the story viewer is over the surface.
  const covered = () => playerOpen || document.documentElement.classList.contains('sinsta-viewing');

  // A post counts as seen once half of it, or half the screen, has shown it
  // for a second, as on Instagram's page (content.js). In the grid a post
  // counts as seen when it is opened.
  const seenTimers = new WeakMap();
  const listWatch = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const art = e.target;
      clearTimeout(seenTimers.get(art));
      const enough = e.intersectionRatio >= 0.5 || e.intersectionRect.height >= window.innerHeight / 2;
      const it = itemOf(art);
      if (enough && it && cur !== 'reels' && !covered()) {
        seenTimers.set(art, setTimeout(() => {
          const h = home();
          if (art.isConnected && h && !covered()) h.markSeen(it.code);
        }, SEEN_MS));
      }
      // Videos play, silently, while mostly on screen.
      if (e.intersectionRatio >= 0.6 && !playerOpen) {
        art.dataset.onScreen = '1';
        startListVideo(art);
        nearCells(art);
      } else if (e.intersectionRatio < 0.6) {
        delete art.dataset.onScreen;
        stopListVideo(art);
      }
    }
  }, { root, threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] });

  // ---- Clicks and hovers --------------------------------------------------

  const liking = new WeakSet(); // posts whose like is on its way

  async function toggleLike(it, sync) {
    if (!it || liking.has(it)) return;
    const on = !it.liked;
    const flip = (v) => {
      it.liked = v;
      if (it.likes != null) it.likes += v ? 1 : -1;
      sync();
    };
    liking.add(it);
    flip(on);
    const ok = await likeMedia(it.pk, on, it.token, it.kind === 'reel' && cur === 'reels' ? undefined : 'feed_timeline');
    liking.delete(it);
    if (!ok) flip(!on);
  }

  function syncEverywhere(it) {
    const art = nodeOf(it.pk);
    if (art && art.matches('.sf-post')) syncPost(art, it);
    if (playerOpen && list()[pi] === it) syncActions();
  }

  async function copyLink(it, btn) {
    let ok = true;
    try {
      await navigator.clipboard.writeText(`https://www.instagram.com${link(it)}`);
    } catch (_) {
      ok = false;
    }
    btn.title = ok ? 'Copied' : "Couldn't copy";
    btn.toggleAttribute('data-done', ok);
    clearTimeout(btn.timer);
    btn.timer = setTimeout(() => {
      btn.title = 'Copy link';
      btn.removeAttribute('data-done');
    }, 1500);
  }

  const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

  content.addEventListener('click', (e) => {
    const node = e.target.closest('[data-pk]');
    const it = itemOf(node);
    if (!it) return;
    const act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      e.stopPropagation();
      const a = act.dataset.act;
      if (a === 'like') toggleLike(it, () => syncEverywhere(it));
      else if (a === 'comments') openPlayer(shown.indexOf(it), { comments: true });
      else if (a === 'link') copyLink(it, act);
      return;
    }
    // Links (names, tags) open in place, through Instagram's router.
    const a = e.target.closest('a[href]');
    if (a && !a.classList.contains('sf-tile')) {
      if (!plainClick(e)) return;
      e.preventDefault();
      go(a.getAttribute('href'));
      return;
    }
    if (node.classList.contains('sf-tile')) {
      if (!plainClick(e)) return; // Ctrl/⌘-click: a new tab
      e.preventDefault();
      e.stopPropagation();
      openPlayer(shown.indexOf(it));
      return;
    }
    // A list post opens in the player too (unless that click selected text).
    if (!String(getSelection())) openPlayer(shown.indexOf(it));
  });

  // Hovering a grid tile plays it silently, as the app's grids do.
  let previewTile = null;
  let previewTimer = 0;
  let hovered = null; // the post under the pointer
  const previews = new WeakMap(); // .sr-preview host -> its video

  function stopPreview() {
    clearTimeout(previewTimer);
    if (!previewTile) return;
    const host = previewTile.querySelector('.sr-preview');
    if (host) unload(previews.get(host));
    previewTile = null;
  }

  // The tile under the pointer, playing its photo's video if it has one.
  function startPreview(a, delay = PREVIEW_MS) {
    previewTile = a;
    const it = itemOf(a);
    const src = it && it.slides[slideOf(a)].video;
    if (!src) return;
    previewTimer = setTimeout(() => {
      const v = shadowVideo({ muted: true, loop: true, autoplay: true, playsInline: true, src }, 'cover');
      const host = hostOf(v);
      host.className = 'sr-preview';
      previews.set(host, v);
      v.addEventListener('playing', () => host.classList.add('sr-on'), { once: true });
      a.querySelector('.sf-track').children[slideOf(a)].append(host);
    }, delay);
  }

  content.addEventListener('pointerover', (e) => {
    const node = e.target.closest('[data-pk]');
    hovered = node;
    const a = node && node.classList.contains('sf-tile') ? node : null;
    if (a === previewTile) return;
    stopPreview();
    if (!a) return;
    nearCells(a);
    if (e.pointerType !== 'touch') startPreview(a);
  });

  content.addEventListener('pointerleave', () => {
    hovered = null;
    stopPreview();
  });

  function unload(v) {
    if (!v) return;
    v.pause();
    v.removeAttribute('src');
    v.load();
    hostOf(v).remove();
  }

  // ---- Loading ------------------------------------------------------------

  function fetchPage(view, after) {
    if (view === 'reels') return reelsPage(after);
    return feedPage(view === 'algo' ? 'home' : view, after);
  }

  async function loadMore(view = cur) {
    const f = feed(view);
    if (f.loading || f.ended || f.unavailable) return;
    f.loading = true;
    f.failed = false;
    if (view === cur) syncStatus();
    // Right after a page load Instagram's session tokens may not be in the
    // page yet; give them a few tries before giving up.
    let page = null;
    for (let attempt = 0; attempt < 3 && !page; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000 * attempt));
      page = await fetchPage(view, f.after);
    }
    f.loading = false;
    if (!page) {
      f.failed = true;
      // A home view that never loaded falls back to Instagram's page.
      if (view !== 'reels' && !f.items.length) f.unavailable = 'failed';
      schedule();
      if (view === cur) syncStatus();
      return;
    }
    // Algo needs the feed to say whom you follow; without that it can't
    // tell suggestions apart, so Instagram's page (filtered by its labels)
    // takes over.
    if (view === 'algo' && !f.items.length && page.items.length && page.items.every((it) => it.following === null)) {
      f.unavailable = 'unclassified';
      schedule();
      return;
    }
    for (const it of page.items) {
      if (f.known.has(it.pk)) continue;
      f.known.add(it.pk);
      f.items.push(it);
    }
    f.after = page.after;
    f.ended = !f.after;
    if (view === cur && active) render();
    if (view === cur) syncStatus();
    fill();
    if (playerOpen && view === cur) grow();
  }

  // A link to one reel (/reels/<code>/) puts it first in the grid and
  // plays it.
  async function openLinked(code) {
    const f = feed('reels');
    let it = f.items.find((i) => i.code === code);
    if (!it) {
      it = await reelByCode(code);
      if (!it || cur !== 'reels' || !active) return;
      const known = f.items.find((i) => i.pk === it.pk);
      if (known) it = known;
      else {
        f.known.add(it.pk);
        f.items.unshift(it);
        render(true);
      }
    }
    if (cur === 'reels' && active) openPlayer(shown.indexOf(it));
  }

  // At the end of the feed (which the query reports for sure) there is no
  // further back to look.
  function caughtUpButtons(f) {
    const row = el('div', { className: 'sf-actions-row' });
    if (!f.ended) {
      const further = el('button', { type: 'button', className: 'sr-retry' }, 'Look further back');
      further.addEventListener('click', () => {
        f.runLimit = seenRun(cur) + RUN_LIMIT;
        syncStatus();
        fill();
      });
      row.append(further);
    }
    const all = el('button', { type: 'button', className: 'sr-retry' }, "Show posts you've seen");
    all.addEventListener('click', () => {
      const h = home();
      if (h) h.showSeen();
    });
    row.append(all);
    return row;
  }

  let statusKey = '';
  function syncStatus() {
    if (!cur) return;
    const f = feed(cur);
    const run = seenRun(cur);
    const hidden = hidingSeen(cur) && f.items.some((it) => belongs(cur, it) && seenBefore(cur, it));
    // Redrawing it would wake the MutationObserver, which runs this again.
    const key = [cur, f.loading, f.failed, f.ended, run, f.runLimit, hidden].join('|');
    if (key === statusKey) return;
    statusKey = key;
    status.replaceChildren();
    if (f.loading) {
      if (run && cur === 'algo') status.append(el('p', {}, `Skipping posts from accounts you follow… (${run})`));
      else if (run) status.append(el('p', {}, `Looking for posts you haven't seen… (skipped ${run})`));
      status.append(el('span', { className: 'sr-spinner' }));
    } else if (f.failed) {
      const retry = el('button', { type: 'button', className: 'sr-retry' }, 'Try again');
      retry.addEventListener('click', () => loadMore());
      status.append(el('p', {}, cur === 'reels' ? "Couldn't load reels." : "Couldn't load more posts."), retry);
    } else if (run >= f.runLimit && cur === 'algo') {
      const further = el('button', { type: 'button', className: 'sr-retry' }, 'Look further');
      further.addEventListener('click', () => {
        f.runLimit = seenRun(cur) + RUN_LIMIT;
        syncStatus();
        fill();
      });
      status.append(el('p', { className: 'sf-strong' }, `No suggestions in the last ${run} posts.`), further);
    } else if (run >= f.runLimit) {
      status.append(el('p', { className: 'sf-strong' }, `You're caught up: the last ${run} posts were ones you've seen.`), caughtUpButtons(f));
    } else if (f.ended) {
      if (hidden) status.append(el('p', { className: 'sf-strong' }, "You're caught up: that's as far back as this feed goes."), caughtUpButtons(f));
      else status.append(el('p', {}, cur === 'reels' ? "That's all Instagram has for now." : "That's as far back as this feed goes."));
    }
  }

  // Keep a screen and a half of posts below the fold (unless paused after a
  // long run of seen ones).
  function fill() {
    if (!active || !cur) return;
    const f = feed(cur);
    if (f.loading || f.ended || f.failed || f.unavailable || seenRun(cur) >= f.runLimit) return;
    if (root.scrollHeight - root.scrollTop - root.clientHeight < root.clientHeight * 1.5) loadMore();
  }

  root.addEventListener('scroll', fill, { passive: true });
  window.addEventListener('resize', () => {
    measuredAt = 0;
    for (const img of content.querySelectorAll('.sf-tile img')) img.sizes = tileWidth();
    if (playerOpen) sizeStage();
    schedule();
  });

  // ---- Player -------------------------------------------------------------

  let playerOpen = false;
  let pi = 0; // index into list()
  let si = 0; // slide of the post on screen
  let video = null;
  let strack = null; // the post's photos, side by side (see trackOf)
  let slideTarget = null; // the photo a click or key is scrolling to
  let preload = null; // { index, video } for the next post
  const playerWheel = wheelGesture();
  let playing = []; // what the player goes through: the view's posts as they were when it opened

  const list = () => playing;

  const stage = el('div', { className: 'sr-stage' });
  const seek = seekbar();
  const stageAvatar = el('img', { className: 'sr-avatar', alt: '' });
  const userLink = el('a', { className: 'sr-user' });
  const muteBtn = button('sr-btn', 'Sound (M)', SOUND_ON);
  const slider = el('input', { type: 'range', min: 0, max: 1, step: 0.05, title: 'Volume' });
  const volumeBox = el('div', { className: 'sr-volume' }, muteBtn, slider);
  const speedBtn = el('button', { className: 'sr-btn sinsta-speed', type: 'button', title: 'Speed (< >)' });
  const head = el('div', { className: 'sr-head' }, stageAvatar, userLink, el('span', { className: 'sr-gap' }), speedBtn, volumeBox);
  const caption = el('div', { className: 'sr-caption' });
  const foot = el('div', { className: 'sr-foot' }, caption, seek.row);
  const dots = el('div', { className: 'sr-dots' });
  stage.append(head, foot, dots);

  // Like, comments and copy link, beside the post as in the app.
  function action(title, paths) {
    const b = button('sr-act', title, paths);
    b.append(el('span'));
    return b;
  }
  const likeBtn = action('Like (L)', HEART);
  const commentBtn = action('Comments (C)', COMMENT);
  const linkBtn = action('Copy link', LINK);
  const actions = el('div', { className: 'sr-actions' }, likeBtn, commentBtn, linkBtn);

  // Beside the post: its author, its caption in full, then the comments.
  const cList = el('div', { className: 'sr-clist' });
  const cClose = button('sr-btn', 'Hide (C)', CLOSE);
  const cPic = el('img', { className: 'sr-avatar', alt: '' });
  const cUser = el('a', { className: 'sr-cuser' });
  const cTime = el('span', { className: 'sr-ctime' });
  const cTitle = el('div', { className: 'sr-ctitle' }, cPic, cUser, cTime);
  const replyText = el('span');
  const replyCancel = button('sr-btn', 'Cancel reply', CLOSE);
  const replyBar = el('div', { className: 'sr-replying', hidden: true }, replyText, replyCancel);
  const cInput = el('textarea', { className: 'sr-cinput', rows: 1, placeholder: 'Add a comment…', maxLength: 2200 });
  const cPost = el('button', { type: 'button', className: 'sr-cpost', disabled: true }, 'Post');
  const cError = el('div', { className: 'sr-cerror', hidden: true });
  const cForm = el('div', { className: 'sr-cform' }, cInput, cPost);
  const cOff = el('div', { className: 'sr-coff', hidden: true }, 'Comments are turned off.');
  const panel = el('div', { className: 'sr-comments', hidden: true },
    el('div', { className: 'sr-chead' }, cTitle, cClose), cList, replyBar, cError, cForm, cOff);
  const prevBtn = button('sr-arrow', 'Previous (↑)', UP);
  const nextBtn = button('sr-arrow', 'Next (↓)', DOWN);
  const arrows = el('div', { className: 'sr-arrows' }, prevBtn, nextBtn);
  const closeBtn = button('sr-close', 'Close (Esc)', CLOSE);
  const player = el('div', { id: 'sinsta-reel-player' }, stage, actions, panel, arrows, closeBtn);

  closeBtn.addEventListener('click', closePlayer);
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute();
  });
  speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSpeed(cycleSpeed(prefs.speed));
  });
  slider.addEventListener('input', () => setVolume(Number(slider.value)));
  slider.addEventListener('click', (e) => e.stopPropagation());
  for (const a of [userLink, cUser]) {
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!plainClick(e)) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      closePlayer();
      go(href);
    });
  }
  // In a carousel, as in the story viewer, a click on the left third goes
  // back a photo and elsewhere on to the next. Otherwise a click pauses a
  // video.
  stage.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, .sr-caption, .sinsta-seekrow')) return;
    const it = list()[pi];
    if (it && it.slides.length > 1) {
      const box = stage.getBoundingClientRect();
      slide(e.clientX - box.left < box.width * 0.3 ? -1 : 1);
    } else if (video) {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }
  });
  watchTracks(stage, (t, i) => {
    const it = list()[pi];
    syncDots(dots, i, 'sr-on');
    if (it) fillCells(t, it, i, bigPhoto);
  }, (t, i) => {
    slideTarget = null;
    if (i === si) return;
    si = i;
    showMedia(null);
  });
  player.addEventListener('click', (e) => {
    if (e.target === player) closePlayer();
  });
  player.addEventListener('wheel', (e) => {
    if (panel.contains(e.target)) return; // scrolls the comments
    // Over the volume control, scrolling sets the volume instead.
    if (volumeBox.contains(e.target)) {
      e.preventDefault();
      const v = prefs.muted ? 0 : prefs.volume;
      setVolume(Math.round((v - Math.sign(e.deltaY) * 0.05) * 20) / 20);
      return;
    }
    // Up and down moves between posts; sideways, a carousel scrolls itself.
    const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const key = playerWheel(e.deltaY * wheelScale(e), sideways ? 'x' : 'y', sideways ? null : step);
    const it = list()[pi];
    if (key !== 'x' || !it || it.slides.length < 2) e.preventDefault();
  }, { passive: false });

  // ---- Like and comments ----------------------------------------------------

  likeBtn.addEventListener('click', () => {
    const it = list()[pi];
    toggleLike(it, () => syncEverywhere(it));
  });
  commentBtn.addEventListener('click', toggleComments);
  cClose.addEventListener('click', toggleComments);
  linkBtn.addEventListener('click', async () => {
    const it = list()[pi];
    if (!it) return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(`https://www.instagram.com${link(it)}`);
    } catch (_) {
      ok = false;
    }
    linkBtn.lastChild.textContent = ok ? 'Copied' : 'Failed';
    clearTimeout(linkBtn.timer);
    linkBtn.timer = setTimeout(() => { linkBtn.lastChild.textContent = ''; }, 1500);
  });

  function syncActions() {
    const it = list()[pi];
    if (!it) return;
    likeBtn.toggleAttribute('data-on', it.liked);
    likeBtn.title = it.liked ? 'Unlike (L)' : 'Like (L)';
    likeBtn.lastChild.textContent = it.likes != null ? compact(it.likes) : '';
    commentBtn.lastChild.textContent = it.comments ? compact(it.comments) : '';
    commentBtn.toggleAttribute('data-on', !panel.hidden);
  }

  function toggleComments() {
    panel.hidden = !panel.hidden;
    prefs.comments = !panel.hidden;
    save();
    player.classList.toggle('sr-with-comments', !panel.hidden);
    syncFoot();
    sizeStage();
    syncActions();
    if (!panel.hidden) loadComments();
  }

  // Comments of the post on screen: { pk, next, loading, done }.
  let thread = null;
  let replyTo = null; // { pk, username, box } of the comment being replied to

  function captionBlock(it) {
    if (!it.caption) return null;
    return el('div', { className: 'sr-cap' }, ...richText(it.caption));
  }

  function loadComments() {
    const it = list()[pi];
    if (!it || (thread && thread.pk === it.pk)) return;
    thread = { pk: it.pk, token: it.token, next: null, loading: false, done: false };
    setReply(null);
    cError.hidden = true;
    const cap = captionBlock(it);
    cList.replaceChildren(...(cap ? [cap] : []));
    cList.scrollTop = 0;
    cOff.hidden = !it.commentsOff;
    cForm.hidden = it.commentsOff;
    if (it.commentsOff && !it.comments) return;
    moreComments();
  }

  async function moreComments() {
    const t = thread;
    if (!t || t.loading || t.done) return;
    t.loading = true;
    const spinner = el('div', { className: 'sr-cstatus' }, el('span', { className: 'sr-spinner' }));
    cList.append(spinner);
    const page = await comments(t.pk, t.next);
    spinner.remove();
    if (t !== thread) return;
    t.loading = false;
    if (!page) {
      const retry = el('button', { type: 'button', className: 'sr-clink' }, 'Couldn\'t load comments. Try again');
      retry.addEventListener('click', () => {
        retry.parentElement.remove();
        moreComments();
      });
      cList.append(el('div', { className: 'sr-cstatus' }, retry));
      return;
    }
    const seen = new Set([...cList.querySelectorAll('.sr-c')].map((n) => n.dataset.pk));
    cList.append(...page.comments.filter((c) => !seen.has(c.pk)).map((c) => commentNode(c, null)));
    t.next = page.next;
    t.done = !page.next || !page.comments.length;
    if (t.done && !cList.querySelector('.sr-c')) {
      cList.append(el('div', { className: 'sr-cstatus' }, 'No comments yet.'));
    }
    fillComments();
  }

  function fillComments() {
    if (cList.scrollHeight - cList.scrollTop - cList.clientHeight < cList.clientHeight) moreComments();
  }
  cList.addEventListener('scroll', fillComments, { passive: true });

  // `parent`: the top-level comment a reply belongs to.
  function commentNode(c, parent) {
    const like = button('sr-clike', '', HEART);
    const meta = el('div', { className: 'sr-cmeta' }, el('span', {}, ago(c.at)));
    const likes = el('span');
    meta.append(likes);
    const reply = el('button', { type: 'button', className: 'sr-clink' }, 'Reply');
    meta.append(reply);
    const body = el('div', { className: 'sr-cbody' },
      el('div', { className: 'sr-ctext' }, el('a', { href: `/${c.username}/`, className: 'sr-cuser' }, c.username), ' ', ...richText(c.text)),
      meta);
    const node = el('div', { className: 'sr-c' },
      el('a', { href: `/${c.username}/`, className: 'sr-cpic' }, el('img', { src: c.pic, alt: '', loading: 'lazy' })),
      body, like);
    node.dataset.pk = c.pk;
    const box = parent ? parent.box : el('div', { className: 'sr-creplies' });
    const syncLike = () => {
      like.toggleAttribute('data-on', c.liked);
      like.title = c.liked ? 'Unlike' : 'Like';
      likes.textContent = c.likes ? `${c.likes.toLocaleString('en')} like${c.likes === 1 ? '' : 's'}` : '';
      likes.hidden = !c.likes;
    };
    syncLike();
    like.addEventListener('click', async () => {
      if (like.dataset.busy) return;
      const flip = (v) => {
        c.liked = v;
        c.likes += v ? 1 : -1;
        syncLike();
      };
      const on = !c.liked;
      flip(on);
      like.dataset.busy = '';
      const ok = await likeComment(c.pk, on);
      delete like.dataset.busy;
      if (!ok) flip(!on);
    });
    // Replies to a reply go to the thread's top comment, as on Instagram.
    const top = parent || { pk: c.pk, box };
    reply.addEventListener('click', () => setReply({ pk: top.pk, username: c.username, box: top.box }));
    if (parent) return node;
    body.append(box);
    if (c.replies) {
      let next = null;
      let count = 0;
      const moreBtn = el('button', { type: 'button', className: 'sr-clink sr-cmore' });
      const label = () => {
        moreBtn.textContent = count ? `View more replies (${c.replies - count})` : `View replies (${c.replies})`;
      };
      label();
      moreBtn.addEventListener('click', async () => {
        if (moreBtn.disabled) return;
        moreBtn.disabled = true;
        const page = await replies(thread.pk, c.pk, next);
        moreBtn.disabled = false;
        if (!page) {
          moreBtn.textContent = 'Couldn\'t load replies. Try again';
          return;
        }
        const have = new Set([...box.children].map((n) => n.dataset.pk));
        const fresh = page.comments.filter((r) => !have.has(r.pk));
        box.append(...fresh.map((r) => commentNode(r, top)));
        count += fresh.length;
        next = page.next;
        if (!next || !fresh.length) moreBtn.remove();
        else label();
      });
      body.append(moreBtn);
    }
    return node;
  }

  function setReply(r) {
    replyTo = r;
    replyBar.hidden = !r;
    if (!r) return;
    replyText.textContent = `Replying to @${r.username}`;
    if (!cInput.value.trim()) cInput.value = `@${r.username} `;
    syncInput();
    cInput.focus();
    cInput.setSelectionRange(cInput.value.length, cInput.value.length);
  }
  replyCancel.addEventListener('click', () => {
    if (replyTo && cInput.value.trim() === `@${replyTo.username}`) cInput.value = '';
    setReply(null);
    syncInput();
  });

  function syncInput() {
    cPost.disabled = !cInput.value.trim() || !!cPost.dataset.busy;
    cInput.style.height = 'auto';
    cInput.style.height = `${Math.min(cInput.scrollHeight, 120)}px`;
  }
  cInput.addEventListener('input', () => {
    cError.hidden = true;
    syncInput();
  });
  cPost.addEventListener('click', postComment);

  async function postComment() {
    const text = cInput.value.trim();
    const t = thread;
    if (!text || !t || cPost.dataset.busy) return;
    const r = replyTo;
    cPost.dataset.busy = '';
    cInput.disabled = true;
    syncInput();
    const c = await addComment(t.pk, text, r && r.pk, t.token);
    delete cPost.dataset.busy;
    cInput.disabled = false;
    if (!c) {
      cError.textContent = 'Couldn\'t post your comment. Try again.';
      cError.hidden = false;
      syncInput();
      return;
    }
    cInput.value = '';
    setReply(null);
    syncInput();
    const it = list().find((i) => i.pk === t.pk);
    if (it) it.comments++;
    syncActions();
    if (t !== thread) return;
    const empty = cList.querySelector('.sr-cstatus');
    if (empty && !empty.querySelector('*')) empty.remove();
    if (r) {
      const node = commentNode(c, r);
      r.box.append(node);
      node.scrollIntoView({ block: 'nearest' });
    } else {
      const node = commentNode(c, null);
      const cap = cList.querySelector('.sr-cap');
      if (cap) cap.after(node);
      else cList.prepend(node);
      cList.scrollTop = 0;
    }
  }

  // Links in the caption and comments close the player and open in place.
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || !plainClick(e)) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    closePlayer();
    go(href);
  });

  function setMuted(m) {
    prefs.muted = m;
    // Unmuting at zero volume would still be silent.
    if (!m && prefs.volume === 0) prefs.volume = 0.5;
    save();
    syncSound();
  }

  function toggleMute() {
    setMuted(!prefs.muted);
  }

  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    prefs.muted = v === 0;
    if (v > 0) prefs.volume = v;
    save();
    syncSound();
  }

  // The caption (while comments are closed, where it shows instead) and a
  // video's seekbar, along the bottom of the stage.
  function syncFoot() {
    const it = list()[pi];
    caption.hidden = !it || !it.caption || !panel.hidden;
    foot.hidden = caption.hidden && seek.row.hidden;
  }

  function setSpeed(rate) {
    prefs.speed = rate;
    save();
    syncSpeed();
  }

  function syncSpeed() {
    if (video) setRate(video, prefs.speed);
    speedBtn.textContent = speedLabel(prefs.speed);
  }

  function syncSound() {
    if (video) {
      video.muted = prefs.muted;
      video.volume = prefs.volume;
    }
    muteBtn.replaceChildren(icon(prefs.muted ? SOUND_OFF : SOUND_ON));
    // Writing the value during a press on the slider can cancel it in Firefox.
    const v = String(prefs.muted ? 0 : prefs.volume);
    if (slider.value !== v) slider.value = v;
  }

  function makeVideo(s) {
    const v = shadowVideo({ loop: true, playsInline: true, preload: 'auto', src: s.video }, 'contain');
    if (s.thumbs.length) v.poster = s.thumbs[0].url;
    return v;
  }

  // The stage takes the post's shape, as large as the window allows beside
  // the buttons and the panel.
  function sizeStage() {
    const it = list()[pi];
    if (!it) return;
    const s = it.slides[0];
    const ar = Math.min(1.91, Math.max(9 / 16, s.w / s.h));
    const maxH = window.innerHeight - 32;
    const maxW = window.innerWidth - 220 - (panel.hidden ? 0 : 376);
    const h = Math.max(120, Math.min(maxH, maxW / ar));
    stage.style.height = `${Math.round(h)}px`;
    stage.style.width = `${Math.round(h * ar)}px`;
    // The panel as tall as the post, unless that leaves it cramped.
    panel.style.height = `${Math.round(Math.max(h, Math.min(maxH, 480)))}px`;
  }

  // The current slide: its video (`handoff`: one already playing it, the
  // tile's hover preview, which carries on from where it is) or its photo.
  function showMedia(handoff) {
    const it = list()[pi];
    const s = it.slides[si];
    if (video) unload(video);
    video = null;
    fillCells(strack, it, si, bigPhoto);
    if (s.video) {
      video = handoff || (preload && preload.index === pi && si === 0 ? preload.video : makeVideo(s));
      if (preload && preload.video === video) preload = null;
      hostOf(video).className = 'sr-video';
      video.style.objectFit = 'contain';
      video.autoplay = false;
      syncSound();
      syncSpeed();
      strack.children[si].append(hostOf(video));
      const started = video.play();
      // Sound needs a recent click or key press; without one, play muted.
      if (started) started.catch(() => {
        if (!video || video.muted) return;
        prefs.muted = true;
        syncSound();
        video.play().catch(() => {});
      });
    }
    seek.attach(video);
    seek.row.hidden = volumeBox.hidden = speedBtn.hidden = !s.video;
    syncFoot();
    const many = it.slides.length > 1;
    dots.hidden = !many;
    if (many) dots.replaceChildren(...it.slides.map((_, i) => el('i', { className: i === si ? 'sr-on' : '' })));
  }

  function bigPhoto(sl) {
    const img = el('img', { className: 'sr-photo', alt: '', decoding: 'async' });
    if (sl.thumbs[0]) img.src = sl.thumbs[0].url;
    return img;
  }

  function show(handoff, start = 0) {
    const it = list()[pi];
    si = start;
    slideTarget = null;
    if (preload && preload.index !== pi) {
      unload(preload.video);
      preload = null;
    }
    sizeStage();
    if (video) unload(video);
    video = null;
    if (strack) strack.remove();
    strack = trackOf(it, bigPhoto(it.slides[0]));
    strack.classList.add('sr-track');
    stage.prepend(strack);
    strack.scrollLeft = si * strack.clientWidth;
    showMedia(handoff);

    stageAvatar.src = it.pic || '';
    userLink.textContent = it.username;
    userLink.href = `/${it.username}/`;
    cPic.src = it.pic || '';
    cUser.textContent = it.username;
    cUser.href = `/${it.username}/`;
    cTime.textContent = it.takenAt ? ago(it.takenAt) : '';
    caption.textContent = it.caption;
    syncFoot();
    syncActions();
    thread = null;
    if (!panel.hidden) loadComments();
    syncPlayerArrows();
    // Opening a post counts as seeing it.
    const h = home();
    if (h && cur !== 'reels') h.markSeen(it.code);

    const next = list()[pi + 1];
    if (next && next.slides[0].video) preload = { index: pi + 1, video: makeVideo(next.slides[0]) };
    else if (next && next.slides[0].thumbs.length) new Image().src = next.slides[0].thumbs[0].url;
    if (list().length - pi < 6) {
      loadMore();
      grow();
    }
  }

  // The player goes on into posts that load while it's open.
  function grow() {
    if (!cur) return;
    const f = feed(cur);
    for (const it of f.items) if (visible(cur, it) && !playing.includes(it)) playing.push(it);
    syncPlayerArrows();
  }

  // Scrolls the carousel there; it plays once it lands (see watchTracks).
  function slide(delta) {
    const it = list()[pi];
    const n = (slideTarget == null ? si : slideTarget) + delta;
    if (!it || n < 0 || n >= it.slides.length) return false;
    slideTarget = n;
    fillCells(strack, it, n, bigPhoto);
    strack.scrollTo({ left: n * strack.clientWidth, behavior: 'smooth' });
    return true;
  }

  function syncPlayerArrows() {
    if (!playerOpen) return;
    prevBtn.disabled = pi <= 0;
    nextBtn.disabled = pi >= list().length - 1;
  }

  function step(delta) {
    const n = pi + delta;
    if (n < 0 || n >= list().length) return;
    pi = n;
    show();
  }

  // `comments`: open with the panel showing, whatever it was last time.
  function openPlayer(index, opts = {}) {
    const it = shown[index];
    if (!it) return;
    // It opens on the photo the tile or post shows, carrying on with the
    // video playing there.
    const tileNode = nodeOf(it.pk);
    const start = tileNode ? slideOf(tileNode) : 0;
    const host = tileNode && previewTile === tileNode && tileNode.querySelector('.sr-preview');
    let preview = host && previews.get(host);
    if (host) host.remove();
    stopPreview();
    if (!preview && tileNode && listVideos.has(tileNode)) {
      preview = listVideos.get(tileNode);
      listVideos.delete(tileNode);
      hostOf(preview).remove();
      tileNode.classList.remove('sf-video');
    }
    for (const art of content.querySelectorAll('.sf-post')) stopListVideo(art);
    playing = shown.slice();
    pi = index;
    playerOpen = true;
    thread = null;
    panel.hidden = !(prefs.comments || opts.comments);
    player.classList.toggle('sr-with-comments', !panel.hidden);
    document.documentElement.classList.add('sinsta-viewing');
    onTop(player);
    show(preview || null, start);
    grow();
  }

  function closePlayer() {
    if (!playerOpen) return;
    playerOpen = false;
    if (video) unload(video);
    if (preload) unload(preload.video);
    video = null;
    seek.attach(null);
    preload = null;
    thread = null;
    setReply(null);
    player.remove();
    document.documentElement.classList.remove('sinsta-viewing');
    // Land the view on the post the player stopped at.
    const it = list()[pi];
    playing = [];
    render();
    const n = it && root.isConnected && nodeOf(it.pk);
    if (n) {
      n.scrollIntoView({ block: 'nearest' });
      n.focus({ preventScroll: true });
    }
    // Posts on screen are judged afresh (seen, and their videos play again).
    for (const art of content.querySelectorAll('.sf-post')) {
      listWatch.unobserve(art);
      listWatch.observe(art);
    }
  }

  // Registered once, at document start, so it runs before Instagram's own
  // key handlers, which could otherwise swallow the keys.
  window.addEventListener('keydown', (e) => {
    if (playerOpen) onPlayerKey(e);
  }, true);

  function onPlayerKey(e) {
    // Typing a comment: keep the keys from the player and from Instagram.
    if (panel.contains(e.target) && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        e.target.blur();
      } else if (e.target === cInput && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        postComment();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const it = list()[pi];
    const like = () => toggleLike(it, () => syncEverywhere(it));
    // Sideways keys go through a carousel's photos, else to the next post.
    const side = (d) => () => (it && it.slides.length > 1 ? slide(d) : step(d));
    const keys = {
      ArrowDown: () => step(1),
      ArrowRight: side(1),
      j: () => step(1),
      ArrowUp: () => step(-1),
      ArrowLeft: side(-1),
      k: () => step(-1),
      ' ': () => video && (video.paused ? video.play().catch(() => {}) : video.pause()),
      m: toggleMute,
      M: toggleMute,
      l: like,
      L: like,
      c: toggleComments,
      C: toggleComments,
      '<': () => setSpeed(shiftSpeed(prefs.speed, -1)),
      '>': () => setSpeed(shiftSpeed(prefs.speed, 1)),
      Escape: closePlayer,
    };
    const act = keys[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  }

  // ---- Surface keys -------------------------------------------------------

  // While the surface is up, scrolling keys scroll it rather than reaching
  // Instagram's hidden page; G switches list and grid, − / + change the
  // number of columns, and L and C act on the post under the pointer.
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
  window.addEventListener('keydown', (e) => {
    if (!cur || covered() || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const take = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    // G also works over Instagram's own Reels player (Reels' list).
    if ((e.key === 'g' || e.key === 'G') && (active || cur === 'reels')) {
      take();
      setLayout(isGrid() ? 'list' : 'grid');
      return;
    }
    if (!active) return;
    if (e.key === '-' || e.key === '+' || e.key === '=') {
      take();
      if (isGrid()) setColumns(cols() + (e.key === '-' ? -1 : 1));
      return;
    }
    const it = hovered && hovered.isConnected ? itemOf(hovered) : null;
    if (it && (e.key === 'l' || e.key === 'L')) {
      take();
      toggleLike(it, () => syncEverywhere(it));
      return;
    }
    if (it && (e.key === 'c' || e.key === 'C')) {
      take();
      openPlayer(shown.indexOf(it), { comments: true });
      return;
    }
    if (!SCROLL_KEYS.has(e.key)) return;
    e.stopPropagation();
    // Scroll it here unless it has the focus itself, so that Space on a
    // focused button (the column count, a like) scrolls rather than presses.
    if (t !== root) {
      root.focus({ preventScroll: true });
      e.preventDefault();
      const page = root.clientHeight * 0.85;
      const by = { ArrowUp: -80, ArrowDown: 80, PageUp: -page, PageDown: page, ' ': e.shiftKey ? -page : page };
      if (e.key === 'Home') root.scrollTo({ top: 0 });
      else if (e.key === 'End') root.scrollTo({ top: root.scrollHeight });
      else root.scrollBy({ top: by[e.key] });
    }
  }, true);

  // Instagram's page keeps running under the surface; keep it silent. (Our
  // own videos sit in closed shadow roots, so their events don't get here;
  // the story viewer's do, and are left alone.)
  document.addEventListener('play', (e) => {
    const v = e.target;
    if (!active || !v.closest || !v.closest('main')) return;
    v.muted = true;
    v.pause();
  }, true);

  // ---- Wiring -------------------------------------------------------------

  // The Home link in Instagram's sidebar (Reels is gone from it, see
  // content.js). Links in Instagram's own (hidden) page are skipped, though
  // they keep their layout.
  function navLink() {
    for (const svg of document.querySelectorAll('svg[aria-label="Home"]')) {
      const a = svg.closest('a');
      if (a && !root.contains(a) && !a.closest('main, #sinsta-bar') && getComputedStyle(a).visibility === 'visible') return a;
    }
    return null;
  }

  // Where the surface goes. Instagram's sidebar widens over the page on
  // hover, from a fixed layer (z-index 10) inside the app's own stacking
  // context (z-index 0). In <body> the surface would cover the whole app,
  // widened sidebar included; in that context, at z-index 1, it stays under
  // the sidebar and over the page.
  function surfaceHost() {
    let layer = navLink();
    while (layer && layer !== document.body) {
      const cs = getComputedStyle(layer);
      if (cs.position === 'fixed' && cs.zIndex !== 'auto') break;
      layer = layer.parentElement;
    }
    for (let e = layer && layer.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.position !== 'static' && cs.zIndex !== 'auto') return e;
    }
    return document.body;
  }

  // Instagram's sidebar is fixed on the left (or, in narrow windows, a bar
  // along the bottom); the surface fills the rest. The sidebar widens over
  // the surface while the pointer is on it, so its width then isn't the room
  // it takes: keep the last measurement (or, before the first, take the
  // width it has narrow, twice the centre of its icons, which stay put), and
  // measure again once the pointer has left and it has narrowed.
  let measured = false;
  let leaveWatched = null;
  function measure() {
    if (Date.now() - measuredAt < 1000) return;
    const navA = navLink();
    if (!navA) return;
    let layer = navA;
    while (layer && layer !== document.body && getComputedStyle(layer).position !== 'fixed') layer = layer.parentElement;
    if (layer && layer !== document.body && layer.matches(':hover') && layer.getBoundingClientRect().height > window.innerHeight / 2) {
      if (leaveWatched !== layer) {
        leaveWatched = layer;
        // It takes about 100 ms to narrow again; measure once it has.
        layer.addEventListener('mouseleave', () => {
          leaveWatched = null;
          measuredAt = Date.now() - 700; // and nothing measures before then
          setTimeout(measure, 320);
        }, { once: true });
      }
      const svg = !measured && navA.querySelector('svg');
      if (svg) {
        const r = svg.getBoundingClientRect();
        root.style.setProperty('--sr-left', `${Math.round(r.left + r.right)}px`);
      }
      return;
    }
    measuredAt = Date.now();
    measured = true;
    let left = 0;
    let bottom = 0;
    for (let e = navA; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.width && r.height > window.innerHeight / 2 && r.width < window.innerWidth / 2) left = Math.max(left, r.right);
      else if (r.height && r.top > window.innerHeight / 2) bottom = Math.max(bottom, window.innerHeight - r.top);
      if (getComputedStyle(e).position === 'fixed') break;
    }
    for (const n of [root, float]) {
      n.style.setProperty('--sr-left', `${Math.round(left)}px`);
      n.style.setProperty('--sr-bottom', `${Math.round(bottom)}px`);
    }
  }

  // The surface usually goes up before Instagram has drawn its sidebar, so
  // into <body>, where it would cover the sidebar when it widens. Move it
  // into the sidebar's stacking context once that's there (checked at most
  // once a second), keeping its place.
  let hostedAt = 0;
  let rehostTimer = 0;
  function rehost() {
    const wait = hostedAt + 1000 - Date.now();
    if (wait > 0) {
      // Look again then, in case nothing else wakes the sync.
      if (!rehostTimer) rehostTimer = setTimeout(() => {
        rehostTimer = 0;
        schedule();
      }, wait);
      return;
    }
    hostedAt = Date.now();
    if (!navLink()) return;
    const host = surfaceHost();
    if (host === root.parentElement) return;
    const top = root.scrollTop;
    const focused = root.contains(document.activeElement);
    host.append(root);
    root.scrollTop = top;
    if (focused) root.focus({ preventScroll: true });
  }

  // Whether the surface shows this view: home views unless their feed
  // couldn't be loaded, Reels in the grid layout.
  function wants(view) {
    if (!view) return false;
    if (view === 'reels') return isGrid();
    return !feed(view).unavailable;
  }

  function sync() {
    queued = false;
    const view = viewOf();
    // Arriving at /reels/<code>/ from elsewhere means a link to that reel.
    // Within the tab, Instagram's own player rewrites the path as it plays.
    const path = location.pathname;
    const wasOn = lastPath !== null && /^\/reels(\/|$)/.test(lastPath);
    const linked = path !== lastPath && !wasOn && path.match(/^\/reels\/([\w-]+)\/?$/);
    lastPath = path;

    let restore = false;
    if (view !== cur) {
      if (cur && active) feed(cur).scroll = root.scrollTop;
      closePlayer();
      cur = view;
      shownKey = '';
      statusKey = '';
      restore = true;
    }
    const want = wants(view);
    const html = document.documentElement;
    html.toggleAttribute('data-sinsta-surface', want);
    if (want && !root.isConnected && document.body) {
      surfaceHost().append(root);
      active = true;
      measuredAt = 0;
      measure();
      render(true);
      root.scrollTop = feed(view).scroll;
      root.focus({ preventScroll: true });
      for (const v of document.querySelectorAll('main video')) {
        v.muted = true;
        v.pause();
      }
    } else if (!want && root.isConnected) {
      if (cur && !restore) feed(cur).scroll = root.scrollTop;
      stopPreview();
      closePlayer();
      for (const art of content.querySelectorAll('.sf-post')) {
        stopListVideo(art);
        listWatch.unobserve(art);
      }
      content.replaceChildren();
      shownKey = '';
      root.remove();
      active = false;
    } else if (want) {
      active = true;
      rehost();
      measure();
      render();
      if (restore) root.scrollTop = feed(view).scroll;
    }
    if (want) {
      const f = feed(view);
      if (!f.items.length && !f.loading && !f.failed) loadMore(view);
      else fill();
      syncStatus();
    }
    // Over Instagram's own Reels player, the tab bar floats at the top.
    const floating = view === 'reels' && !want;
    if (floating && !float.isConnected && document.body) {
      document.body.append(float);
      measuredAt = 0;
      measure();
    } else if (!floating && float.isConnected) {
      float.remove();
    }
    if (linked && want) openLinked(linked[1]);
    syncControls();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function save() {
    try {
      if (storage) storage.set({ [KEY]: prefs });
      else localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  async function load() {
    let stored = null;
    let old = null;
    try {
      if (storage) {
        const got = await storage.get([KEY, OLD_KEY]);
        stored = got[KEY];
        old = got[OLD_KEY];
      } else {
        stored = JSON.parse(localStorage.getItem(KEY) || 'null');
        old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
      }
    } catch (_) {}
    if (stored) prefs = { ...prefs, ...stored, cols: { ...prefs.cols, ...(stored.cols || {}) } };
    else if (old) {
      // The Reels grid's settings: its column count and sound carry over.
      prefs.layout = old.grid === false ? 'list' : 'grid';
      if (old.columns) prefs.cols.reels = old.columns;
      for (const k of ['muted', 'volume']) if (k in old) prefs[k] = old[k];
    }
    shownKey = '';
    schedule();
  }

  // For content.js: where the tab bar goes, and whether Instagram's page
  // is covered.
  Sinsta.surface = {
    // The surface's header, or (over Instagram's Reels player) the floating
    // box; null where the bar belongs on Instagram's page.
    barHost(view) {
      if (view === cur && active) return header;
      if (view === 'reels') return float;
      return null;
    },
    active: () => active,
    toTop() {
      if (active) root.scrollTo({ top: 0 });
      else window.scrollTo(0, 0);
    },
    // content.js changed what shows (seen posts, favourites, a new visit).
    changed() {
      const h = home();
      const visit = h && h.visitStart();
      if (visit !== visitAt) {
        visitAt = visit;
        for (const f of Object.values(feeds)) f.runLimit = RUN_LIMIT;
      }
      // On a tab switch content.js starts the visit first; the switch
      // itself redraws.
      if (!active || viewOf() !== cur) {
        schedule();
        return;
      }
      render();
      syncStatus();
      fill();
    },
  };

  syncControls();
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  load();
})();
