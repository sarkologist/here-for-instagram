// Home's views, Reels, Explore, search results and profiles, drawn by the extension.
//
// Following, Favourites and Algo show Instagram's home feeds, Reels its
// Reels feed and Explore the grid under its search box, read with the
// queries Instagram's own pages use, as a list or as a grid (one choice for
// all five). The list shows just the photos: a post's name, buttons and
// caption appear over it while the pointer is on it. Clicking a tile, or a post's comments button, opens the player, which
// goes through the view in order with the caption and comments beside it.
// Instagram's own page stays underneath, hidden and paused.
//
// If a home feed or Explore can't be loaded, that view falls back to
// Instagram's page, which content.js filters (Home's). Reels in the list
// layout is Instagram's player.
(() => {
  'use strict';

  const {
    go, nav, el, shadowVideo, hostOf, icon, seekbar, shiftSpeed, cycleSpeed, setRate, speedLabel, onTop, reelsPage, explorePage, profilePage, profileTabPage, complete, searchPage, reelByCode, feedPage, songFor, ago,
    likeMedia, likeComment, comments, replies, addComment, savePost, collections, addToCollection, removeFromCollection, newCollection,
  } = Sinsta;
  // content.js: seen posts, favourites, the tab bar.
  const home = () => Sinsta.home || null;

  const KEY = 'sinsta-surface';
  const OLD_KEY = 'sinsta-reels'; // before Home was drawn here: { grid, columns }
  const MIN_COLS = 1;
  const MAX_COLS = 8;
  const WHEEL_STEP = 40; // px of scrolling that moves the player one post
  const WHEEL_IDLE = 200; // ms without scroll events that ends a gesture
  const SETTLE_MS = 150; // ms without scrolling after which a carousel has come to rest
  const SEEN_MS = 1000; // as in content.js: on screen this long counts as seen
  const RUN_LIMIT = 120; // seen posts in a row before pausing, as in content.js
  // Feed pages come no faster than someone scrolling would ask for them:
  // Instagram restricts accounts whose web feed is paged like a scraper's.
  const PAGE_GAP_MS = 2500; // between pages
  const AUTO_PAGES = 3; // pages fetched to fill the screen before waiting for a scroll
  // Past a run of seen posts, Following and Favourites (in time order) jump
  // instead of paging: Instagram's later pages hold 4 to 12 posts, but a
  // first page as many as asked, so one request from the top again reaches
  // past the run. It is slow (10 s for 150), so only for long runs.
  const JUMP_VIEWS = new Set(['following', 'favorites']);
  const JUMP_AFTER = 12; // seen posts in a row before jumping
  const JUMP_STEP = 100; // posts a jump reaches past those loaded
  const JUMP_MAX = 200; // posts one request asks for
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
  const CHECK = ['M6.5 12.5l3.5 3.5 7.5-8'];
  const BOOKMARK = ['M6 3.5h12v17l-6-4.6-6 4.6z'];

  const VIEWS = ['following', 'favorites', 'algo', 'reels', 'explore'];
  const SEEN_VIEWS = new Set(['following', 'favorites', 'algo', 'explore']); // where "Hide seen" applies, with profiles

  let prefs = {
    layout: 'grid',
    cols: { following: 4, favorites: 3, algo: 3, reels: 4, explore: 4, profile: 4, 'profile-reels': 4, search: 4 },
    muted: false,
    volume: 1,
    speed: 1,
    comments: true,
  };

  // The view Home, Reels, Explore, search results or a profile's tab is on,
  // from the address (and, for a profile, its tabs: other pages have such
  // addresses too). A profile's Posts tab is 'profile:<username>', its
  // others 'profile:<username>/<tab>' (reels, reposts, tagged); search
  // results' 'search:<query>'.
  function viewOf() {
    const { pathname, search } = nav.here(); // under the player's or viewer's own address
    if (/^\/reels(\/|$)/.test(pathname)) return 'reels';
    if (/^\/explore\/?$/.test(pathname)) return 'explore';
    if (/^\/explore\/search\/keyword\/?$/.test(pathname)) {
      const q = (new URLSearchParams(search).get('q') || '').trim();
      return q ? `search:${q}` : null;
    }
    const [, user, tab] = pathname.match(/^\/([\w.]+)(?:\/(reels|reposts|tagged))?\/?$/) || [];
    if (user && document.querySelector(`main a[href="/${user}/${tab ? `${tab}/` : ''}"][aria-selected="true"]`)) return `profile:${user}${tab ? `/${tab}` : ''}`;
    if (pathname !== '/') return null;
    const variant = new URLSearchParams(search).get('variant');
    return variant === 'following' || variant === 'favorites' ? variant : 'algo';
  }

  // Each view's feed survives leaving it (the script lives across Instagram's
  // in-page navigation), so coming back finds it as it was until the page
  // reloads.
  const feeds = {};
  function feed(view) {
    return feeds[view] || (feeds[view] = {
      items: [], known: new Set(), after: null, ended: false, loading: false, failed: false,
      unavailable: false, scroll: 0, runLimit: RUN_LIMIT, jumpless: false,
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

  const isProfile = (view) => !!view && view.startsWith('profile:');
  // A profile view's account and tab ('' for Posts).
  const profileOf = (view) => {
    const [user, tab = ''] = view.slice('profile:'.length).split('/');
    return { user, tab };
  };
  const isSearch = (view) => !!view && view.startsWith('search:');
  // A profile's grid, and search results', sit in Instagram's page, which
  // scrolls, rather than over it.
  const isInline = (view) => isProfile(view) || isSearch(view);
  const inline = () => isInline(cur);
  // Profiles share one column count, but for their Reels tabs, which share
  // another; searches share one too.
  const colsKey = (view) => (isProfile(view) ? (profileOf(view).tab === 'reels' ? 'profile-reels' : 'profile')
    : isSearch(view) ? 'search' : view);
  const cols = () => prefs.cols[colsKey(cur)] || 3;
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
    prefs.cols[colsKey(cur)] = n;
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
        : Sinsta.heldBack() ? "Instagram turned down this session's requests, so this is Instagram's own page. Here has stopped its background requests for 30 minutes; logging out of Instagram and back in usually clears it."
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
    return (SEEN_VIEWS.has(view) || isInline(view)) && !!h && h.hideSeen();
  }

  // A post's seen mark: on once it counts as seen, and a button to mark it
  // either way. Not in Reels, which doesn't track it.
  function seenMark() {
    if (cur === 'reels') return [];
    const b = button('sf-mark', '', CHECK);
    b.dataset.act = 'seen';
    return [b];
  }

  function syncSeen(node, it) {
    if (!node || !it) return;
    node.classList.toggle('sf-seen', seenBefore(cur, it));
    const mark = node.querySelector('.sf-mark');
    if (!mark) return;
    const h = home();
    const at = h ? h.seenAt(it.code) : undefined;
    mark.toggleAttribute('data-on', at !== undefined);
    const title = at === undefined ? 'Not seen yet. Click to mark as seen.'
      : `Seen ${ago(at)} ago. Click to mark as not seen.`;
    if (mark.title !== title) mark.title = title;
  }

  function visible(view, it) {
    return belongs(view, it) && !(hidingSeen(view) && seenBefore(view, it));
  }

  // Posts in a row at the end of what's loaded that were skipped while
  // looking for ones to show: seen ones (with Hide seen on) or, in Algo,
  // ones from accounts you follow too (Instagram's home feed puts its
  // suggestions after the recent posts of people you follow).
  function seenRun(view) {
    const algo = view === 'algo';
    if (!algo && !hidingSeen(view)) return 0;
    const items = feed(view).items;
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.ad) continue;
      if (!algo && !belongs(view, it)) continue;
      if (visible(view, it)) break;
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
    if (view === 'reels' || (isProfile(view) && profileOf(view).tab === 'reels')) return 9 / 16;
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
    a.append(trackOf(it, picture(it.slides[0], tileWidth())));
    if (cur !== 'reels' && it.slides.some((s) => s.isVideo)) {
      a.append(el('span', { className: 'sf-badge', hidden: !it.slides[0].isVideo }, icon(PLAY)));
    }
    a.append(...seenMark());
    syncSeen(a, it);
    if (it.slides.length > 1) a.append(dotsOf(it));
    const likes = el('span', { className: 'sf-tlikes' });
    if (it.likes != null) likes.append(icon(HEART), compact(it.likes));
    const kept = el('span', { className: 'sf-tsaved', title: 'Saved', hidden: !it.saved }, icon(BOOKMARK));
    const info = el('div', { className: 'sf-tinfo' },
      el('div', { className: 'sf-tcap' }, it.caption),
      el('div', { className: 'sf-trow' }, avatar(it, 'sf-tpic'), el('span', { className: 'sf-tuser' }, it.username), likes, kept));
    a.append(info);
    return a;
  }

  function place(it) {
    const c = columns.reduce((a, b) => (b.h < a.h - 1e-6 ? b : a));
    const a = tile(it);
    c.node.append(a);
    c.h += 1 / shape(it);
    if (it.slides.length > 1) nearWatch.observe(a);
    if (cur !== 'reels') gridWatch.observe(a);
  }

  // A carousel tile gets all its photos as it comes near the screen, so that
  // scrubbing through them (see scrub) has them ready.
  const nearSeen = (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      nearWatch.unobserve(e.target);
      nearCells(e.target, true);
    }
  };
  const NEAR = { rootMargin: '50% 0px' };
  let nearWatch = new IntersectionObserver(nearSeen, { root, ...NEAR });

  // List: the photos, with their name, buttons and caption over them.
  function post(it) {
    const art = el('article', { className: 'sf-post' });
    art.dataset.pk = it.pk;
    art.style.setProperty('--ar', String(shape(it)));
    art.append(el('div', { className: 'sf-media' }, trackOf(it, picture(it.slides[0], LIST_SIZES))));

    const user = el('a', { className: 'sf-user', href: `/${it.username}/` }, it.username);
    const head = el('div', { className: 'sf-head' }, avatar(it, 'sf-pic'), user,
      el('span', { className: 'sf-time' }, ago(it.takenAt)));
    if (cur === 'algo') head.append(el('span', { className: 'sf-sug' }, 'Suggested for you'));

    const like = button('sf-act', 'Like (L)', HEART);
    like.dataset.act = 'like';
    const cmt = button('sf-act', 'Comments (C)', COMMENT);
    cmt.dataset.act = 'comments';
    const open = el('a', { className: 'sf-act', href: link(it), title: 'Open post' }, icon(LINK));
    const keep = button('sf-act sf-save', 'Save (S)', BOOKMARK);
    keep.dataset.act = 'save';
    hoverSave(keep, () => itemOf(art) || it);
    const acts = el('div', { className: 'sf-acts' }, like, cmt, open, keep);
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
    art.append(...seenMark());
    syncSeen(art, it);
    syncPost(art, it);
    return art;
  }

  function syncPost(art, it) {
    const like = art.querySelector('[data-act="like"]');
    like.toggleAttribute('data-on', it.liked);
    like.title = it.liked ? 'Unlike (L)' : 'Like (L)';
    const keep = art.querySelector('[data-act="save"]');
    keep.toggleAttribute('data-on', it.saved);
    keep.title = it.saved ? 'Remove from saved (S)' : 'Save (S)';
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
  // (a trackpad's two-finger swipe, a finger, Shift + mouse wheel), with
  // momentum, coming to rest on a photo. A cell gets its photo once the track
  // comes near it.
  function trackOf(it, first) {
    const t = el('div', { className: 'sf-track' }, ...it.slides.map(() => el('div', { className: 'sf-cell' })));
    t.firstChild.append(first);
    return t;
  }

  // The cell a track is (nearest to) showing.
  const cellAt = (t) => Math.max(0, Math.min(t.children.length - 1, Math.round(t.scrollLeft / (t.clientWidth || 1))));

  // Cell i and `span` cells either side get their photo, `make(slide)`,
  // loaded and decoded now (lazily they would wait until scrolled into view,
  // and show blank while they load).
  function fillCells(t, it, i, make, span = 1) {
    for (let j = Math.max(0, i - span); j <= Math.min(it.slides.length - 1, i + span); j++) {
      const c = t.children[j];
      if (c.firstChild) continue;
      const img = make(it.slides[j]);
      img.loading = 'eager';
      c.append(img);
      if (img.decode) img.decode().catch(() => {});
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

  // A list post's or grid tile's neighbouring photos, ready to swipe to;
  // once it is being swiped (`all`), every one, as a swipe can cross several.
  function nearCells(node, all) {
    const it = itemOf(node);
    const t = node && node.querySelector('.sf-track');
    if (!it || !t || it.slides.length < 2) return;
    const sizes = node.classList.contains('sf-tile') ? tileWidth() : LIST_SIZES;
    fillCells(t, it, cellAt(t), (sl) => picture(sl, sizes), all ? it.slides.length : 1);
  }

  // A list post or grid tile at rest on photo i: its video plays there.
  function landOn(node, i) {
    const it = itemOf(node);
    if (scrub && scrub.node === node && scrub.swiped) {
      scrub.rest = i;
      scrub.swiped = false;
    }
    if (!it || i === slideOf(node)) return;
    node.dataset.slide = i;
    if (node.classList.contains('sf-tile')) {
      const badge = node.querySelector('.sf-badge');
      if (badge) badge.hidden = !it.slides[i].isVideo;
      if (previewTile === node) {
        stopPreview();
        startPreview(node);
      }
      return;
    }
    stopListVideo(node);
    if (node.dataset.onScreen) startListVideo(node);
  }

  // As with the story viewer's side cards, moving the pointer across a
  // carousel in the grid flips through its photos, clicking opens the one it
  // shows, and leaving puts back the one it rested on (where a swipe while
  // there leaves it). Not in the list, where the pointer crosses the photos
  // on its way to the buttons over them.
  let scrub = null; // { node, rest, swiped }

  content.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const node = e.target.closest('.sf-tile');
    const it = itemOf(node);
    const t = node && node.querySelector('.sf-track');
    if (!it || !t || it.slides.length < 2) return;
    if (!scrub || scrub.node !== node) {
      endScrub();
      scrub = { node, rest: cellAt(t), swiped: false };
    }
    const r = node.getBoundingClientRect();
    const j = Math.min(it.slides.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * it.slides.length)));
    if (j === cellAt(t)) return;
    nearCells(node, true);
    t.scrollLeft = j * t.clientWidth;
  });

  // A swipe (sideways wheel events) while scrubbing moves where it rests.
  content.addEventListener('wheel', (e) => {
    if (scrub && Math.abs(e.deltaX) > Math.abs(e.deltaY) && scrub.node.contains(e.target)) scrub.swiped = true;
  }, { passive: true });

  function endScrub() {
    const s = scrub;
    scrub = null;
    const t = s && s.node.isConnected && s.node.querySelector('.sf-track');
    if (t && cellAt(t) !== s.rest) t.scrollLeft = s.rest * t.clientWidth;
  }

  watchTracks(content, (t, i) => {
    const node = t.closest('[data-pk]');
    syncDots(node.querySelector('.sf-dots'), i, 'sf-on');
    nearCells(node, true);
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
      nearWatch.disconnect();
      gridWatch.disconnect();
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

  // What of the page shows the view: the surface, or (inline) the window.
  function viewBox() {
    if (inline()) return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
    return root.getBoundingClientRect();
  }

  function topItem() {
    const top = viewBox().top + 80;
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
  // for a second, as on Instagram's page (content.js). In the grid, see
  // gridWatch. Opening a post counts too.
  const seenTimers = new WeakMap();
  const listSeen = (entries) => {
    for (const e of entries) {
      const art = e.target;
      clearTimeout(seenTimers.get(art));
      const enough = e.intersectionRatio >= 0.5 || e.intersectionRect.height >= window.innerHeight / 2;
      const it = itemOf(art);
      if (enough && it && cur !== 'reels' && !covered()) {
        seenTimers.set(art, setTimeout(() => {
          const h = home();
          if (!art.isConnected || !h || covered()) return;
          h.markSeen(it.code);
          syncSeen(art, it);
        }, SEEN_MS));
      }
      // Videos play, silently, while mostly on screen.
      if (e.intersectionRatio >= 0.6 && !playerOpen) {
        art.dataset.onScreen = '1';
        startListVideo(art);
        nearCells(art, true);
      } else if (e.intersectionRatio < 0.6) {
        delete art.dataset.onScreen;
        stopListVideo(art);
      }
    }
  };
  const LIST_AT = { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] };
  let listWatch = new IntersectionObserver(listSeen, { root, ...LIST_AT });

  // In the grid, where a screen holds many posts, being on screen isn't
  // enough: a tile counts as seen once it has been wholly on screen for a
  // second and is then scrolled past (off the top), or once the pointer has
  // rested on it for a second.
  const readyTiles = new WeakSet(); // wholly on screen for long enough
  const gridSeen = (entries) => {
    for (const e of entries) {
      const a = e.target;
      clearTimeout(seenTimers.get(a));
      if (e.intersectionRatio >= 0.95 && !covered()) {
        seenTimers.set(a, setTimeout(() => {
          if (!covered()) readyTiles.add(a);
        }, SEEN_MS));
      } else if (!e.isIntersecting && readyTiles.has(a) && e.rootBounds && e.boundingClientRect.bottom <= e.rootBounds.top + 1) {
        readyTiles.delete(a);
        markTile(a);
      }
    }
  };
  const GRID_AT = { threshold: [0, 0.95] };
  let gridWatch = new IntersectionObserver(gridSeen, { root, ...GRID_AT });

  // The surface scrolls itself; inline, on a profile, the page scrolls. The
  // watchers follow whichever scrolls.
  let watchRoot = root;
  function setWatchRoot(r) {
    if (r === watchRoot) return;
    watchRoot = r;
    for (const w of [nearWatch, listWatch, gridWatch]) w.disconnect();
    nearWatch = new IntersectionObserver(nearSeen, { root: r, ...NEAR });
    listWatch = new IntersectionObserver(listSeen, { root: r, ...LIST_AT });
    gridWatch = new IntersectionObserver(gridSeen, { root: r, ...GRID_AT });
  }

  function markTile(a) {
    const it = itemOf(a);
    const h = home();
    if (!it || !h || !a.isConnected || cur === 'reels') return;
    h.markSeen(it.code);
    syncSeen(a, it);
  }

  let dwellNode = null;
  let dwellTimer = 0;
  function dwell(node) {
    if (node === dwellNode) return;
    clearTimeout(dwellTimer);
    dwellNode = node;
    if (!node || !node.classList.contains('sf-tile')) return;
    dwellTimer = setTimeout(() => {
      if (dwellNode === node && !covered()) markTile(node);
    }, SEEN_MS);
  }

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
    const kept = art && art.querySelector('.sf-tsaved');
    if (kept) kept.hidden = !it.saved;
    if (playerOpen && list()[pi] === it) syncActions();
  }

  const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

  // ---- Saving -------------------------------------------------------------

  // As on Instagram: saving puts a post in "All posts" and opens a list of
  // your collections beside the button, to put it in one too or make a new
  // one; a note at the bottom says where it went. The pointer resting on the
  // button opens the list too, saved or not. The collections the post is in
  // are ticked, and clicking one puts it in or takes it out, so a saved post
  // can be moved between them without being unsaved.
  const saving = new WeakSet(); // posts whose save is on its way

  // `from`: the button it was saved with, for the collections to open by.
  async function toggleSave(it, from) {
    if (!it || saving.has(it)) return;
    const on = !it.saved;
    const flip = (v) => {
      it.saved = v;
      syncEverywhere(it);
    };
    saving.add(it);
    flip(on);
    // Saving with the list already open by the button (from hovering) keeps it.
    const kept = on && saveTo && saveTo.it === it && saveTo.from === from;
    if (!kept) closeSaveTo();
    const picking = on && from && from.isConnected;
    if (picking && !kept) openSaveTo(it, from);
    const ok = await savePost(it.pk, on);
    saving.delete(it);
    if (!ok) {
      flip(!on);
      closeSaveTo();
      toast(on ? "Couldn't save the post." : "Couldn't remove the post from saved.");
    } else if (!on) {
      it.inCollections = []; // unsaving takes it out of them all
      toast('Removed from saved.');
    } else if (!picking) {
      toast('Saved.', 'View saved', savedHref(null));
    }
  }

  // Your collections, loaded once a page (and more as the list scrolls).
  let colls = null; // { items, after }
  let collsJob = null;
  function loadCollections(more = false) {
    if (collsJob) return collsJob;
    if (colls && !(more && colls.after)) return Promise.resolve(colls);
    const prev = colls;
    collsJob = collections(prev ? prev.after : null).then((got) => {
      collsJob = null;
      if (!got) return prev; // null if nothing could be loaded
      colls = { items: [...(prev ? prev.items : []), ...got.items], after: got.after };
      return colls;
    });
    return collsJob;
  }

  // Your username, from the sidebar's Saved link (or Profile's).
  function myName() {
    for (const a of document.querySelectorAll('nav a[href], a[href$="/saved/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([\w.]+)\/saved\/$/);
      if (m) return m[1];
    }
    return null;
  }
  function savedHref(col) {
    const me = myName();
    if (!me) return null;
    if (!col || !col.id) return `/${me}/saved/`;
    // Instagram goes by the id; the name part is only for show.
    const slug = col.name.toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '') || 'collection';
    return `/${me}/saved/${slug}/${col.id}/`;
  }

  // Leave for a page of Instagram's, closing the player if it's open.
  function leave(href) {
    closeSaveTo();
    closeNewCollection();
    if (playerOpen) closePlayer();
    go(href);
  }

  let saveTo = null; // { node, it, from }
  let hoverTimer = 0; // till the list opens for the button under the pointer
  let leaveTimer = 0; // till it closes, the pointer having left both

  // The pointer resting on `btn` opens the list for the post `itemFor` gives;
  // leaving the button and the list closes it (after a moment, to cross the
  // gap between them).
  function hoverSave(btn, itemFor) {
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(leaveTimer);
      clearTimeout(hoverTimer);
      if (saveTo && saveTo.from === btn) return;
      hoverTimer = setTimeout(() => {
        const it = itemFor();
        if (!it || !btn.isConnected || !btn.matches(':hover') || newCol || (saveTo && saveTo.from === btn)) return;
        closeSaveTo();
        openSaveTo(it, btn);
      }, 300);
    });
    btn.addEventListener('pointerleave', () => {
      clearTimeout(hoverTimer);
      leaveSave();
    });
  }
  function leaveSave() {
    clearTimeout(leaveTimer);
    if (saveTo) leaveTimer = setTimeout(closeSaveTo, 300);
  }

  function openSaveTo(it, from) {
    const listNode = el('div', { className: 'sf-saveto-list' }, el('div', { className: 'sf-saveto-note' }, 'Loading…'));
    const add = button('sf-saveto-add', 'New collection', PLUS);
    const node = el('div', { className: 'sf-saveto', role: 'dialog', ariaLabel: 'Collections' },
      el('div', { className: 'sf-saveto-head' }, el('span', {}, 'Collections'), add), listNode);
    saveTo = { node, it, from };
    node.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
    node.addEventListener('pointerleave', leaveSave);
    onTop(node);
    placeSaveTo();
    add.addEventListener('click', () => {
      closeSaveTo();
      openNewCollection(it);
    });
    const fill = (got) => {
      if (!saveTo || saveTo.node !== node) return;
      if (!got) {
        listNode.replaceChildren(el('div', { className: 'sf-saveto-note' }, "Couldn't load your collections."));
        return;
      }
      if (!got.items.length) {
        listNode.replaceChildren(el('div', { className: 'sf-saveto-note' }, 'No collections yet.'));
        return;
      }
      listNode.replaceChildren(...got.items.map((c) => {
        const tick = icon(CHECK);
        tick.classList.add('sf-saveto-tick');
        const row = el('button', { type: 'button', className: 'sf-saveto-row' },
          c.cover ? el('img', { src: c.cover, alt: '' }) : el('span', { className: 'sf-saveto-blank' }),
          el('span', { className: 'sf-saveto-name' }, c.name), tick);
        markIn(row, isIn(it, c));
        row.addEventListener('click', () => toggleIn(it, c, row));
        return row;
      }));
      placeSaveTo(); // taller now
    };
    loadCollections().then(fill);
    listNode.addEventListener('scroll', () => {
      if (listNode.scrollTop + listNode.clientHeight < listNode.scrollHeight - 40) return;
      if (colls && colls.after && !collsJob) loadCollections(true).then(fill);
    });
  }

  function placeSaveTo() {
    if (!saveTo) return;
    const { node, from } = saveTo;
    const r = from.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    // Above the button if there's room, else below; inside the window.
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - h - 8);
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    node.style.setProperty('top', `${Math.max(8, top)}px`, 'important');
    node.style.setProperty('left', `${left}px`, 'important');
  }

  function closeSaveTo() {
    clearTimeout(leaveTimer);
    if (!saveTo) return;
    saveTo.node.remove();
    saveTo = null;
  }

  // As on Instagram, putting a post in a collection saves it too.
  async function ensureSaved(it) {
    if (it.saved) return true;
    saving.add(it);
    it.saved = true;
    syncEverywhere(it);
    const ok = await savePost(it.pk, true);
    saving.delete(it);
    if (!ok) {
      it.saved = false;
      syncEverywhere(it);
      toast("Couldn't save the post.");
    }
    return ok;
  }

  const isIn = (it, col) => (it.inCollections || []).includes(col.id);
  function markIn(row, on) {
    row.toggleAttribute('data-on', on);
    row.setAttribute('aria-pressed', String(on));
    row.title = on ? 'Remove from this collection' : 'Save to this collection';
  }

  // Put the post in the collection, or take it out if it's in. The list
  // stays open, to change others too.
  async function toggleIn(it, col, row) {
    if (row.dataset.busy) return;
    const on = !isIn(it, col);
    const set = (v) => {
      const rest = (it.inCollections || []).filter((id) => id !== col.id);
      it.inCollections = v ? [...rest, col.id] : rest;
      markIn(row, v);
    };
    row.dataset.busy = '1';
    set(on);
    const ok = (!on || (await ensureSaved(it))) && (await (on ? addToCollection : removeFromCollection)(col.id, it.pk));
    delete row.dataset.busy;
    if (!ok) {
      set(!on);
      toast(on ? `Couldn't save to "${col.name}".` : `Couldn't remove from "${col.name}".`);
    } else {
      toast(on ? `Saved to "${col.name}".` : `Removed from "${col.name}".`, 'View collection', savedHref(col));
    }
  }

  let newCol = null; // { node, it }

  function openNewCollection(it) {
    const input = el('input', { type: 'text', className: 'sf-newcol-name', placeholder: 'Collection name', maxLength: 64 });
    const ok = el('button', { type: 'button', className: 'sf-newcol-save', disabled: true }, 'Save');
    const shut = button('sf-newcol-close', 'Close', CLOSE);
    const err = el('div', { className: 'sf-newcol-error', hidden: true });
    const thumb = it.thumbs && it.thumbs.length ? it.thumbs[it.thumbs.length - 1].url : '';
    const box = el('div', { className: 'sf-newcol-box', role: 'dialog', ariaLabel: 'New collection' },
      el('div', { className: 'sf-newcol-head' }, shut, el('span', {}, 'New collection'), el('span')),
      thumb ? el('img', { className: 'sf-newcol-pic', src: thumb, alt: '' }) : '',
      input, err, ok);
    const node = el('div', { className: 'sf-newcol' }, box);
    newCol = { node, it, input, submit };
    onTop(node);
    input.focus();
    input.addEventListener('input', () => {
      ok.disabled = !input.value.trim();
    });
    shut.addEventListener('click', closeNewCollection);
    node.addEventListener('click', (e) => {
      if (e.target === node) closeNewCollection();
    });
    ok.addEventListener('click', submit);
    async function submit() {
      const name = input.value.trim();
      if (!name || ok.dataset.busy) return;
      ok.dataset.busy = '1';
      ok.disabled = true;
      err.hidden = true;
      const id = (await ensureSaved(it)) ? await newCollection(name, it.pk) : null;
      delete ok.dataset.busy;
      if (id === null) {
        ok.disabled = false;
        err.textContent = "Couldn't make the collection. Try again.";
        err.hidden = false;
        return;
      }
      closeNewCollection();
      colls = null; // list it next time
      if (id) it.inCollections = [...(it.inCollections || []), id];
      toast(`Saved to "${name}".`, id ? 'View collection' : 'View saved', savedHref(id ? { id, name } : null));
    }
  }

  function closeNewCollection() {
    if (!newCol) return;
    newCol.node.remove();
    newCol = null;
  }

  let toastNode = null;
  function toast(text, label, href) {
    if (toastNode) toastNode.remove();
    const node = el('div', { className: 'sf-toast', role: 'status' }, el('span', {}, text));
    if (label && href) {
      const a = el('a', { href }, label);
      a.addEventListener('click', (e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        node.remove();
        leave(href);
      });
      node.append(a);
    }
    toastNode = node;
    onTop(node);
    setTimeout(() => {
      if (toastNode === node) toastNode = null;
      node.remove();
    }, 5000);
  }

  // The collections close on a click elsewhere, a scroll, or another post.
  document.addEventListener('pointerdown', (e) => {
    if (saveTo && !saveTo.node.contains(e.target) && !saveTo.from.contains(e.target)) closeSaveTo();
  }, true);
  window.addEventListener('resize', closeSaveTo);
  window.addEventListener('scroll', (e) => {
    if (saveTo && !saveTo.node.contains(e.target)) closeSaveTo();
  }, true);

  // Keys for the collections and the new collection's box: Escape closes
  // them, and typing a name stays in the box. Whether the key was theirs.
  function onSaveKey(e) {
    if (newCol) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        closeNewCollection();
      } else if (e.key === 'Enter' && e.target === newCol.input && !e.isComposing) {
        e.preventDefault();
        newCol.submit();
      }
      return true;
    }
    if (saveTo && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSaveTo();
      return true;
    }
    return false;
  }
  window.addEventListener('keydown', (e) => {
    if ((saveTo || newCol) && !playerOpen) onSaveKey(e);
  }, true);

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
      else if (a === 'save') toggleSave(it, act);
      else if (a === 'seen') {
        const h = home();
        if (h) h.setSeen(it.code, h.seenAt(it.code) === undefined);
        syncSeen(node, it);
        syncStatus();
      } else if (a === 'comments') openPlayer(shown.indexOf(it), { comments: true });
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
  let hovered = null; // the post under the pointer
  const previews = new WeakMap(); // .sr-preview host -> its video

  function stopPreview() {
    if (!previewTile) return;
    const host = previewTile.querySelector('.sr-preview');
    if (host) unload(previews.get(host));
    previewTile = null;
  }

  // A slide's smallest video still sharp on its tile, as it loads soonest.
  function tileVideo(s) {
    if (!s.video) return null;
    const px = (content.clientWidth || window.innerWidth) / cols() * (window.devicePixelRatio || 1);
    const fit = (s.videos || []).find((v) => v.width >= px);
    return fit ? fit.url : s.video;
  }

  // The tile under the pointer, playing its photo's video if it has one,
  // shown once its first frame is in.
  function startPreview(a) {
    previewTile = a;
    const it = itemOf(a);
    const src = it && tileVideo(it.slides[slideOf(a)]);
    if (!src) return;
    const v = shadowVideo({ muted: true, loop: true, playsInline: true, preload: 'auto', src }, 'cover');
    const host = hostOf(v);
    host.className = 'sr-preview';
    previews.set(host, v);
    v.addEventListener('playing', () => host.classList.add('sr-on'), { once: true });
    a.querySelector('.sf-track').children[slideOf(a)].append(host);
    v.play().catch(() => {});
  }

  content.addEventListener('pointerover', (e) => {
    const node = e.target.closest('[data-pk]');
    hovered = node;
    if (e.pointerType !== 'touch') dwell(node);
    if (node && e.target.closest('.sf-mark')) syncSeen(node, itemOf(node)); // "seen 5m ago" moves on
    if (scrub && scrub.node !== node) endScrub();
    const a = node && node.classList.contains('sf-tile') ? node : null;
    if (a === previewTile) return;
    stopPreview();
    if (!a) return;
    nearCells(a);
    if (e.pointerType !== 'touch') startPreview(a);
  });

  content.addEventListener('pointerleave', () => {
    hovered = null;
    dwell(null);
    endScrub();
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
    if (view === 'explore') return explorePage(after);
    if (isProfile(view)) {
      const { user, tab } = profileOf(view);
      return tab ? profileTabPage(user, tab, after) : profilePage(user, after);
    }
    if (isSearch(view)) return searchPage(view.slice('search:'.length), after);
    return feedPage(view === 'algo' ? 'home' : view, after);
  }

  // How many posts to ask for from the top of the view's feed to jump past
  // its run of seen posts (see JUMP_VIEWS), or 0 to fetch its next page.
  // Not past the run's limit, where the feed pauses anyway.
  function jumpSize(view, f) {
    if (!JUMP_VIEWS.has(view) || f.jumpless || !f.after || !hidingSeen(view)) return 0;
    const run = seenRun(view);
    if (run < JUMP_AFTER) return 0;
    const size = Math.min(f.items.length + Math.min(f.runLimit - run, JUMP_STEP), JUMP_MAX);
    return size - f.items.length >= JUMP_AFTER ? size : 0;
  }

  let pageAt = 0; // when the last feed page was asked for
  let pageTimer = 0;
  let autoPages = 0; // pages fetched since the last scroll, keyboard or touch

  // `auto`: fetched to fill the screen, not because the reader asked.
  async function loadMore(view = cur, auto = false) {
    const f = feed(view);
    if (f.loading || f.ended || f.unavailable) return;
    // A view's first page comes at once; later ones keep their distance.
    const wait = f.items.length ? pageAt + PAGE_GAP_MS - Date.now() : 0;
    if (wait > 0) {
      clearTimeout(pageTimer);
      pageTimer = setTimeout(() => loadMore(view, auto), wait);
      return;
    }
    pageAt = Date.now();
    if (auto) autoPages++;
    f.loading = true;
    f.failed = false;
    if (view === cur) syncStatus();
    // Right after a page load Instagram's session tokens may not be in the
    // page yet; give them a few tries before giving up.
    let page = null;
    const jump = jumpSize(view, f);
    // Not when Instagram has pushed back: retrying is what gets sessions flagged.
    for (let attempt = 0; attempt < 3 && !page && !(attempt && Sinsta.heldBack()); attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000 * attempt));
      page = jump ? await feedPage(view, null, jump) : await fetchPage(view, f.after);
    }
    f.loading = false;
    // A jump's page starts at the top again: what follows the last post
    // already loaded is new. (Posts newer than the first wait for a reload,
    // as they do anyway.) If it shares none, the feed has changed under
    // us: page from where we were.
    if (jump && page) {
      let last = -1;
      page.items.forEach((it, i) => {
        if (f.known.has(it.pk)) last = i;
      });
      if (last < 0) {
        f.jumpless = true;
        loadMore(view, auto);
        return;
      }
      page = { items: page.items.slice(last + 1), after: page.after };
      // Asking again would get the same answer.
      if (!page.items.length) f.jumpless = true;
    }
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
    const h = home();
    const count = hidingSeen(cur) ? f.items.filter((it) => belongs(cur, it) && seenBefore(cur, it)).length : 0;
    if (h) h.setHiddenCount(count);
    const hidden = count > 0;
    // Redrawing it would wake the MutationObserver, which runs this again.
    const waiting = !f.loading && !f.failed && !f.ended && autoPages >= AUTO_PAGES && run < f.runLimit;
    const key = [cur, f.loading, f.failed, f.ended, run, f.runLimit, hidden, waiting].join('|');
    if (key === statusKey) return;
    statusKey = key;
    status.replaceChildren();
    if (f.loading) {
      if (run && cur === 'algo') {
        status.append(el('p', {}, hidingSeen(cur) ? `Looking for suggestions you haven't seen… (skipped ${run})`
          : `Skipping posts from accounts you follow… (${run})`));
      }
      else if (run) status.append(el('p', {}, `Looking for posts you haven't seen… (skipped ${run})`));
      status.append(el('span', { className: 'sr-spinner' }));
    } else if (f.failed) {
      const retry = el('button', { type: 'button', className: 'sr-retry' }, 'Try again');
      retry.addEventListener('click', () => loadMore());
      status.append(el('p', {}, cur === 'reels' ? "Couldn't load reels." : "Couldn't load more posts."), retry);
    } else if (waiting) {
      status.append(el('p', {}, run ? `Scroll for more (skipped ${run} you've seen)` : 'Scroll for more'));
    } else if (run >= f.runLimit && cur === 'algo' && hidden) {
      status.append(el('p', { className: 'sf-strong' }, `No new suggestions in the last ${run} posts.`), caughtUpButtons(f));
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
      if (hidden) {
        status.append(el('p', { className: 'sf-strong' }, isSearch(cur) ? "You're caught up: you've seen the rest of the results."
          : inline() ? "You're caught up: you've seen the rest of their posts."
            : "You're caught up: that's as far back as this feed goes."), caughtUpButtons(f));
      }
      else status.append(el('p', {}, cur === 'reels' || cur === 'explore' || isSearch(cur) ? "That's all Instagram has for now."
        : inline() ? "That's all of their posts." : "That's as far back as this feed goes."));
    }
  }

  // Keep a screen and a half of posts below the fold (unless paused after a
  // long run of seen ones).
  // Fetch the next page if the bottom is near. Past AUTO_PAGES without the
  // reader moving (seen posts hidden, or Algo skipping followed accounts,
  // leave the screen short), wait for them to scroll.
  function fill() {
    if (!active || !cur) return;
    const f = feed(cur);
    if (f.loading || f.ended || f.failed || f.unavailable || seenRun(cur) >= f.runLimit) return;
    const v = viewBox();
    if (root.getBoundingClientRect().bottom - v.bottom >= v.height * 1.5) return;
    if (autoPages >= AUTO_PAGES) {
      syncStatus();
      return;
    }
    loadMore(cur, true);
  }
  // The reader moving on lets the feed fetch again.
  const moved = () => {
    if (autoPages < AUTO_PAGES) {
      autoPages = 0;
      return;
    }
    autoPages = 0;
    syncStatus();
    fill();
  };
  for (const type of ['wheel', 'touchmove', 'pointerdown']) window.addEventListener(type, moved, { passive: true, capture: true });
  window.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'PageDown', 'End', ' ', 'j'].includes(e.key)) moved();
  }, true);

  root.addEventListener('scroll', fill, { passive: true });
  window.addEventListener('scroll', () => inline() && fill(), { passive: true });
  window.addEventListener('resize', () => {
    measuredAt = 0;
    for (const img of content.querySelectorAll('.sf-tile img')) img.sizes = tileWidth();
    if (playerOpen) sizeStage();
    schedule();
  });

  // ---- Player -------------------------------------------------------------

  let playerOpen = false;
  let pendingPlayer = null; // an entry of the player's to show (restorePlayer)
  let pi = 0; // index into list()
  let si = 0; // slide of the post on screen
  let video = null;
  let strack = null; // the post's photos, side by side (see trackOf)
  let slideTarget = null; // the photo a click or key is scrolling to
  let preload = null; // { index, video } for the next post
  let song = null; // { it, audio, held } the open post's song (see loadSong)
  const playerWheel = wheelGesture();
  let playing = []; // what the player goes through: the view's posts as they were when it opened

  const list = () => playing;

  const stage = el('div', { className: 'sr-stage' });
  const seek = seekbar();
  const stageAvatar = el('img', { className: 'sr-avatar', alt: '' });
  const userLink = el('a', { className: 'sr-user' });
  const songLabel = el('span', { className: 'sr-song', hidden: true });
  const muteBtn = button('sr-btn', 'Sound (M)', SOUND_ON);
  const slider = el('input', { type: 'range', min: 0, max: 1, step: 0.05, title: 'Volume' });
  const volumeBox = el('div', { className: 'sr-volume' }, muteBtn, slider);
  const speedBtn = el('button', { className: 'sr-btn sinsta-speed', type: 'button', title: 'Speed (< >)' });
  const head = el('div', { className: 'sr-head' }, stageAvatar, userLink, songLabel, el('span', { className: 'sr-gap' }), speedBtn, volumeBox);
  const caption = el('div', { className: 'sr-caption' });
  const foot = el('div', { className: 'sr-foot' }, caption, seek.row);
  const dots = el('div', { className: 'sr-dots' });
  stage.append(head, foot, dots);

  // Like, comments and a link to the post, beside it as in the app.
  function action(title, paths) {
    const b = button('sr-act', title, paths);
    b.append(el('span'));
    return b;
  }
  const likeBtn = action('Like (L)', HEART);
  const commentBtn = action('Comments (C)', COMMENT);
  const saveBtn = action('Save (S)', BOOKMARK);
  const linkBtn = el('a', { className: 'sr-act', title: 'Open post' }, icon(LINK));
  const actions = el('div', { className: 'sr-actions' }, likeBtn, commentBtn, saveBtn, linkBtn);

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

  closeBtn.addEventListener('click', () => closePlayer(true));
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
  for (const a of [userLink, cUser, linkBtn]) {
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
    } else {
      togglePause();
    }
  });
  watchTracks(stage, (t, i) => {
    const it = list()[pi];
    syncDots(dots, i, 'sr-on');
    if (it) fillCells(t, it, i, bigPhoto, it.slides.length);
  }, (t, i) => {
    slideTarget = null;
    if (i === si) return;
    si = i;
    showMedia(null);
  });
  player.addEventListener('click', (e) => {
    if (e.target === player) closePlayer(true);
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
  saveBtn.addEventListener('click', () => toggleSave(list()[pi], saveBtn));
  hoverSave(saveBtn, () => list()[pi]);
  cClose.addEventListener('click', toggleComments);
  function syncActions() {
    const it = list()[pi];
    if (!it) return;
    likeBtn.toggleAttribute('data-on', it.liked);
    likeBtn.title = it.liked ? 'Unlike (L)' : 'Like (L)';
    likeBtn.lastChild.textContent = it.likes != null ? compact(it.likes) : '';
    commentBtn.lastChild.textContent = it.comments ? compact(it.comments) : '';
    saveBtn.toggleAttribute('data-on', it.saved);
    saveBtn.title = it.saved ? 'Remove from saved (S)' : 'Save (S)';
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
    for (const m of [video, song && song.audio]) {
      if (!m) continue;
      m.muted = prefs.muted;
      m.volume = prefs.volume;
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
    seek.row.hidden = speedBtn.hidden = !s.video;
    syncSong();
    syncFoot();
    const many = it.slides.length > 1;
    dots.hidden = !many;
    if (many) dots.replaceChildren(...it.slides.map((_, i) => el('i', { className: i === si ? 'sr-on' : '' })));
  }

  // Space, or a click on a post that isn't a carousel: pause or go on with
  // the video, else the song.
  function togglePause() {
    if (video) {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    } else if (song && song.audio) {
      song.held = !song.held;
      syncSong();
    }
  }

  // The post's song (`it` null: none), once it's known: it plays the part
  // its author chose, over and over, while a photo shows, as on Instagram.
  function loadSong(it) {
    if (song && song.audio) {
      song.audio.pause();
      song.audio.removeAttribute('src');
      song.audio.load();
    }
    song = it && it.song !== null ? { it, audio: null, held: false } : null;
    songLabel.hidden = true;
    if (!song) return;
    const mine = song;
    songFor(it).then((s) => {
      if (song !== mine || !s || !playerOpen) return;
      const a = el('audio', { preload: 'auto', src: s.url });
      // From the start of the part on, and back there at its end.
      const restart = () => {
        a.currentTime = s.start;
      };
      a.addEventListener('loadedmetadata', restart, { once: true });
      a.addEventListener('timeupdate', () => {
        if (s.end && a.currentTime >= s.end) restart();
      });
      a.addEventListener('ended', () => {
        restart();
        syncSong();
      });
      mine.audio = a;
      songLabel.textContent = s.title ? `♪ ${s.title}` : '♪';
      songLabel.title = s.title;
      songLabel.hidden = false;
      syncSound();
      syncSong();
    });
  }

  // The song plays while a photo of its post shows, unless paused.
  function syncSong() {
    const it = list()[pi];
    const s = it && it.slides[si];
    const a = song && song.audio;
    volumeBox.hidden = !(s && s.video) && !a;
    if (!a) return;
    if (s && !s.video && !song.held) {
      if (!a.paused) return;
      const started = a.play();
      // Sound needs a recent click or key press; without one, play muted.
      if (started) started.catch(() => {
        if (!song || song.audio !== a || a.muted) return;
        prefs.muted = true;
        syncSound();
        a.play().catch(() => {});
      });
    } else {
      a.pause();
    }
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
    if (!song || song.it !== it) loadSong(it);
    showMedia(handoff);

    stageAvatar.src = it.pic || '';
    userLink.textContent = it.username;
    userLink.href = `/${it.username}/`;
    linkBtn.href = link(it);
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
    nav.at('player', link(it), { view: cur, pk: it.pk });
    // Opening a post counts as seeing it.
    const h = home();
    if (h && cur !== 'reels') {
      h.setSeen(it.code, true);
      syncSeen(nodeOf(it.pk), it);
    }

    // A post that came without its videos' files or caption (a profile's
    // Reels, Reposts and Tagged tabs) shows its cover until the rest comes.
    if (it.partial) complete(it).then((ok) => {
      if (ok && playerOpen && list()[pi] === it) restage(it);
    });

    const next = list()[pi + 1];
    if (next && next.slides[0].video) preload = { index: pi + 1, video: makeVideo(next.slides[0]) };
    else if (next && next.slides[0].thumbs.length) new Image().src = next.slides[0].thumbs[0].url;
    if (next && next.partial) complete(next, { background: true });
    else if (next && next.song === undefined) songFor(next, { background: true });
    if (list().length - pi < 6) {
      loadMore();
      grow();
    }
  }

  // The post on stage again, once the rest of it has come (see show).
  function restage(it) {
    if (video) unload(video);
    video = null;
    if (strack) strack.remove();
    strack = trackOf(it, bigPhoto(it.slides[0]));
    strack.classList.add('sr-track');
    stage.prepend(strack);
    strack.scrollLeft = si * strack.clientWidth;
    showMedia(false);
    caption.textContent = it.caption;
    syncFoot();
    syncActions();
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
    closeSaveTo();
    pi = n;
    show();
  }

  // `comments`: open with the panel showing, whatever it was last time.
  function openPlayer(index, opts = {}) {
    const it = shown[index];
    if (!it) return;
    pendingPlayer = null;
    // It opens on the photo the tile or post shows, carrying on with the
    // video playing there.
    const tileNode = nodeOf(it.pk);
    const start = tileNode ? cellAt(tileNode.querySelector('.sf-track')) : 0;
    // (Not if scrubbing has just moved on and the video is still the last one's.)
    const same = tileNode && slideOf(tileNode) === start;
    const host = same && previewTile === tileNode && tileNode.querySelector('.sr-preview');
    let preview = host && previews.get(host);
    // A smaller video than the player's is left behind, for stopPreview.
    if (preview && preview.getAttribute('src') !== it.slides[start].video) preview = null;
    else if (host) host.remove();
    stopPreview();
    if (!preview && same && listVideos.has(tileNode)) {
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

  // `step`: closed by the person (see nav.done).
  function closePlayer(step = false) {
    if (!playerOpen) return;
    playerOpen = false;
    closeSaveTo();
    closeNewCollection();
    nav.done('player', step);
    if (video) unload(video);
    if (preload) unload(preload.video);
    video = null;
    loadSong(null);
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
    for (const a of content.querySelectorAll('.sf-tile')) {
      gridWatch.unobserve(a);
      gridWatch.observe(a);
    }
  }

  // Back or Forward to one of the player's entries: the post it showed,
  // once its view is showing (after Back from a page Instagram went on to,
  // it comes back first).
  function restorePlayer(d, later = true) {
    if (cur !== d.view || !active) {
      pendingPlayer = d;
      if (later) schedule();
      return;
    }
    pendingPlayer = null;
    const n = (playerOpen ? playing : shown).findIndex((it) => it.pk === d.pk);
    if (n < 0) return;
    if (!playerOpen) openPlayer(n);
    else if (n !== pi) {
      pi = n;
      show();
    }
  }
  nav.own('player', {
    restore: restorePlayer,
    leave() {
      pendingPlayer = null;
      closePlayer();
    },
  });

  // Registered once, at document start, so it runs before Instagram's own
  // key handlers, which could otherwise swallow the keys.
  window.addEventListener('keydown', (e) => {
    if (playerOpen && !onSaveKey(e)) onPlayerKey(e);
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
    const keep = () => toggleSave(it, saveBtn);
    // Sideways keys go through a carousel's photos, else to the next post.
    const side = (d) => () => (it && it.slides.length > 1 ? slide(d) : step(d));
    const keys = {
      ArrowDown: () => step(1),
      ArrowRight: side(1),
      j: () => step(1),
      ArrowUp: () => step(-1),
      ArrowLeft: side(-1),
      k: () => step(-1),
      ' ': togglePause,
      m: toggleMute,
      M: toggleMute,
      l: like,
      L: like,
      c: toggleComments,
      C: toggleComments,
      s: keep,
      S: keep,
      '<': () => setSpeed(shiftSpeed(prefs.speed, -1)),
      '>': () => setSpeed(shiftSpeed(prefs.speed, 1)),
      Escape: () => closePlayer(true),
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
  // number of columns, and L, C and S act on the post under the pointer.
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
    if (it && (e.key === 's' || e.key === 'S')) {
      take();
      toggleSave(it, hovered.querySelector('[data-act="save"]'));
      return;
    }
    // Inline, the keys scroll the page, as usual.
    if (!SCROLL_KEYS.has(e.key) || inline()) return;
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
    if (!active || inline() || !v.closest || !v.closest('main')) return;
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
  // measure again once the pointer has left and it has narrowed. Found
  // wider than its icons need with the pointer off it, it may still be
  // narrowing (or, before any measurement saw the pointer on it, never have
  // been watched): that's taken only if it stays so.
  let measured = false;
  let leaveWatched = null;
  let wideAt = 0; // when it was first found wide with the pointer off it
  let wideLast = 0; // and last
  let wideTimer = 0;
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
          setTimeout(() => {
            measure();
            schedule(); // (a profile's grid follows the measurement)
          }, 320);
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
    let left = 0;
    let bottom = 0;
    for (let e = navA; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.width && r.height > window.innerHeight / 2 && r.width < window.innerWidth / 2) left = Math.max(left, r.right);
      else if (r.height && r.top > window.innerHeight / 2) bottom = Math.max(bottom, window.innerHeight - r.top);
      if (getComputedStyle(e).position === 'fixed') break;
    }
    const svg = navA.querySelector('svg');
    const narrow = svg ? svg.getBoundingClientRect().left + svg.getBoundingClientRect().right : 0;
    if (narrow && left > narrow + 8) {
      // (Sightings more than a moment apart don't add up.)
      const now = Date.now();
      if (now - wideLast > 600) wideAt = now;
      wideLast = now;
      if (now - wideAt < 400) {
        // Keep the last measurement, and look again once it would have
        // narrowed.
        measuredAt = 0;
        clearTimeout(wideTimer);
        wideTimer = setTimeout(schedule, 450);
        return;
      }
    } else wideLast = 0;
    measured = true;
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

  // Whether the surface shows this view: home views, Explore, search results
  // and profiles unless their feed couldn't be loaded (or, on Explore, while
  // searching; on a profile or search results, until Instagram's grid is
  // there to take the place of), Reels in the grid layout.
  function wants(view) {
    if (!view) return false;
    if (view === 'reels') return isGrid();
    if (view === 'explore' && searching) return false;
    if (isInline(view) && !gridBlock(view)) return false;
    return !feed(view).unavailable;
  }

  // A profile's Posts grid: the box, after the header and the tabs, that
  // holds Instagram's tiles; search results', the box after the heading
  // (the query) that holds them, or, without such a heading, the tiles'
  // own box. Inline, the surface goes after it, in its place, and it's
  // hidden (so Instagram's page doesn't load more of its own as it would
  // on scrolling).
  let replaced = null;
  function gridBlock(view) {
    const tiles = () => [...document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]')].filter((a) => !root.contains(a));
    const lcaOf = (a, b) => {
      let x = a;
      while (x && !x.contains(b)) x = x.parentElement;
      return x;
    };
    if (isSearch(view)) {
      const all = tiles();
      if (!all.length) return null;
      const q = view.slice('search:'.length);
      const heading = [...document.querySelectorAll('main h1, main h2, main span')]
        .find((n) => !n.childElementCount && n.textContent.trim() === q && n.compareDocumentPosition(all[0]) & Node.DOCUMENT_POSITION_FOLLOWING);
      let block = all[0];
      if (heading) {
        const lca = lcaOf(heading.parentElement, all[0]);
        while (block.parentElement !== lca) block = block.parentElement;
      } else block = lcaOf(all[0], all[all.length - 1]);
      // Out of any box that clips, which would crop the grid as it reaches
      // out to the room beside the sidebar.
      for (let e = block.parentElement; e && e.tagName !== 'MAIN'; e = e.parentElement) {
        if (getComputedStyle(e).overflowX !== 'visible') block = e;
      }
      return block;
    }
    const { user, tab: which } = profileOf(view);
    const tab = document.querySelector(`main a[href="/${user}/${which ? `${which}/` : ''}"][aria-selected="true"]`);
    if (!tab) return null;
    const tile = tiles().find((a) => tab.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
    let lca = tile && tab.parentElement;
    while (lca && !lca.contains(tile)) lca = lca.parentElement;
    if (!lca) return null;
    let block = tile;
    while (block.parentElement !== lca) block = block.parentElement;
    return block;
  }

  function placeInline(view) {
    const block = gridBlock(view);
    if (replaced && replaced !== block) replaced.removeAttribute('data-sinsta-replaced');
    replaced = block;
    if (!block) return;
    block.setAttribute('data-sinsta-replaced', '');
    if (block.nextElementSibling !== root) block.after(root);
    // Instagram's profile column is narrower than the page: reach out of it
    // to the room beside the sidebar, as the surface has elsewhere.
    // (Until the sidebar has been measured, it stays in the column.)
    measure();
    const measured = root.style.getPropertyValue('--sr-left');
    if (!measured) return;
    const left = parseFloat(measured);
    // (From the parent's content box, where the box starts unshifted.)
    const parent = root.parentElement;
    const start = parent.getBoundingClientRect().left + parent.clientLeft + parseFloat(getComputedStyle(parent).paddingLeft);
    const shift = `${Math.round(left - start)}px`;
    const width = `${Math.round(document.documentElement.clientWidth - left)}px`;
    // (Only .sf-inline uses these, so the surface can't keep them when
    // Instagram takes the box away with the profile's page.)
    if (root.style.getPropertyValue('--sr-shift') !== shift) root.style.setProperty('--sr-shift', shift);
    if (root.style.getPropertyValue('--sr-width') !== width) root.style.setProperty('--sr-width', width);
  }

  function unplaceInline() {
    if (replaced) replaced.removeAttribute('data-sinsta-replaced');
    replaced = null;
    root.style.removeProperty('--sr-shift');
    root.style.removeProperty('--sr-width');
  }

  // On Explore the surface leaves Instagram's search box in sight above it.
  // Using the box turns Instagram's page into search results, with a Back
  // button beside the box: the surface makes way for them until then.
  let keptRow = null; // the box's row, kept visible
  let searching = false;
  function syncSearch(view) {
    const input = view === 'explore' ? document.querySelector('main input') : null;
    const main = input && input.closest('main');
    let row = input;
    while (row && row.parentElement && row.parentElement !== main && row.parentElement.getBoundingClientRect().height < 120) row = row.parentElement;
    searching = !!input && (document.activeElement === input || !!input.value || !!row.querySelector('svg[aria-label="Back"]'));
    // Kept only where the page's top has it; elsewhere it stays under.
    const bottom = row ? row.getBoundingClientRect().bottom : 0;
    const keep = !searching && row && bottom < window.innerHeight / 3 ? row : null;
    if (keptRow && keptRow !== keep) keptRow.removeAttribute('data-sinsta-keep');
    keptRow = keep;
    if (keep) {
      keep.setAttribute('data-sinsta-keep', '');
      const top = `${Math.round(bottom + 8)}px`;
      if (root.style.getPropertyValue('--sr-top') !== top) root.style.setProperty('--sr-top', top);
    } else root.style.removeProperty('--sr-top');
  }

  function sync() {
    queued = false;
    const view = viewOf();
    // Arriving at /reels/<code>/ from elsewhere means a link to that reel.
    // Within the tab, Instagram's own player rewrites the path as it plays.
    const path = nav.here().pathname;
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
      setWatchRoot(inline() ? null : root);
    }
    syncSearch(view);
    const want = wants(view);
    const inl = want && inline();
    const html = document.documentElement;
    html.toggleAttribute('data-sinsta-surface', want && !inl);
    html.toggleAttribute('data-sinsta-explore', want && view === 'explore');
    html.toggleAttribute('data-sinsta-inline', inl);
    // Between the surface and a profile, the same box moves.
    if (want && root.isConnected && root.classList.contains('sf-inline') !== inl) {
      root.remove();
      if (!inl) unplaceInline();
    }
    if (want) root.classList.toggle('sf-inline', inl);
    if (want && !root.isConnected && document.body) {
      // Explore's search box, above the surface, is where the page's top
      // has it.
      if (view === 'explore' && window.scrollY) {
        window.scrollTo(0, 0);
        syncSearch(view);
      }
      if (inl) placeInline(view);
      else {
        unplaceInline();
        surfaceHost().append(root);
      }
      active = true;
      measuredAt = 0;
      render(true);
      if (!inl) {
        measure();
        root.scrollTop = feed(view).scroll;
        root.focus({ preventScroll: true });
        for (const v of document.querySelectorAll('main video')) {
          v.muted = true;
          v.pause();
        }
      }
    } else if (!want && (root.isConnected || active)) {
      // (Inline, Instagram may have taken the box away with its page.)
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
      unplaceInline();
      active = false;
    } else if (want && inl) {
      active = true;
      placeInline(view);
      render();
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
    if (pendingPlayer && !nav.data('player')) pendingPlayer = null;
    if (pendingPlayer) restorePlayer(pendingPlayer, false);
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
    // Go to one of Instagram's pages from over the surface or the player.
    leave,
    // The surface's header, or (over Instagram's Reels player) the floating
    // box; null where the bar belongs on Instagram's page.
    barHost(view) {
      if ((view === cur || (view === 'profile' && inline())) && active) return header;
      if (view === 'reels') return float;
      return null;
    },
    active: () => active,
    // Whether the view is inline, in a profile's page.
    inline: () => active && inline(),
    toTop() {
      if (active && !inline()) root.scrollTo({ top: 0 });
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
  // Explore's search box taking or losing the focus (see syncSearch).
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  load();
})();
