(() => {
  'use strict';

  // Home is split into three views that never overlap:
  //   Algo        Instagram's home feed, keeping only its suggested posts
  //   Following   Instagram's chronological feed, minus favourites
  //   Favourites  the same, for accounts you starred
  // Ads are hidden everywhere. Reels is a fourth tab beside them. feed.js
  // draws these views itself, and Explore's grid; what's here filters
  // Instagram's own page, which a view falls back to when its feed can't be
  // loaded.
  const { api, go, nav, el, mark, icon, openViewer, fetchReels, setFavourite, appOnlyNotifications, recentPosts, userIds, lookUpId, userCard } = Sinsta;

  const VIEWS = [
    {
      id: 'algo',
      label: 'Algo',
      href: '/',
      icon: [
        'M10 3.5l1.9 5.1 5.1 1.9-5.1 1.9L10 17.5l-1.9-5.1L3 10.5l5.1-1.9z',
        'M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
      ],
    },
    {
      id: 'following',
      label: 'Following',
      href: '/?variant=following',
      icon: [
        'M9 4.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z',
        'M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6',
        'M16.5 10.5l2 2 3.5-4',
      ],
    },
    {
      id: 'favorites',
      label: 'Favourites',
      href: '/?variant=favorites',
      icon: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z'],
    },
    {
      id: 'reels',
      label: 'Reels',
      href: '/reels/',
      icon: ['M7 3.5h10A3.5 3.5 0 0 1 20.5 7v10a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 17V7A3.5 3.5 0 0 1 7 3.5z', 'M3.5 8.5h17', 'M8.5 3.5l3 5', 'M14 3.5l3 5', 'M10.5 12v5l4-2.5z'],
    },
  ];
  const viewById = (id) => VIEWS.find((v) => v.id === id);
  const HOME_VIEWS = new Set(['algo', 'following', 'favorites']);

  const HIDE = 'sinsta-hide';
  const TAIL = 'sinsta-tail';
  const END = 'sinsta-end';
  // Shown when the last few posts loaded all belong elsewhere.
  const TAIL_NOTES = {
    algo: 'Skipping posts from accounts you follow. Keep scrolling for more suggestions.',
    following: 'Skipping posts from favourites. Keep scrolling for more.',
    favorites: 'Keep scrolling for more.',
  };
  const EYE_OFF = [
    'M3 3l18 18',
    'M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a16 16 0 0 1-2.6 3.2',
    'M6.6 7.6A16 16 0 0 0 3 12s4 6 9 6a9 9 0 0 0 4.4-1.1',
    'M9.9 10a3 3 0 0 0 4.1 4.1',
  ];
  // English UI labels.
  const AD_LABELS = new Set(['Ad', 'Sponsored']);
  const SUGGESTED_LABELS = new Set(['Suggested for you', 'Suggested posts']);
  // Instagram renders and loads more posts until the viewport is filled. If
  // every new post were collapsed it would never fill and would fetch in a
  // tight loop. So once this many hidden posts trail the last shown one,
  // they stay invisible but keep their height.
  const TAIL_LIMIT = 5;
  const TRAY_TTL = 60000;
  const FAV_TTL = 5 * 60000;

  let queued = false;
  let reels = null; // [{ id, username, pic, unseen, seenAt }]
  let shownReels = []; // the stories row as rendered, in order
  let favIds = null; // Set of user ids
  const favNames = new Set(); // favourites' usernames
  let trayAt = 0;
  let trayBusy = false;
  let favBusy = false;
  let favAt = 0;
  let favReels = null; // complete story list for favourites
  let favReelsAt = 0;
  let favReelsBusy = false;
  let rendered = '';

  // ---- Feed filtering -----------------------------------------------------

  // "Suggested for you" blocks carry a "See all" link to /explore/people/.
  // Climb to the nearest ancestor that also holds the suggested accounts.
  function suggestionBlock(link) {
    if (link.closest('.' + HIDE)) return null;
    let el = link.parentElement;
    for (let depth = 0; el && el !== document.body && depth < 5; depth++, el = el.parentElement) {
      if (el.matches('main, nav') || el.querySelector('article, main, nav, a[href="/"]')) return null;
      if (el.querySelectorAll('a[href]').length > 1) return el;
    }
    return null;
  }

  // A feed post is an ad, a suggestion (from an account you don't follow),
  // or from an account you follow.
  function postKind(article) {
    let suggested = false;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const text = n.nodeValue.trim();
      if (AD_LABELS.has(text)) return 'ad';
      if (SUGGESTED_LABELS.has(text)) suggested = true;
      // A Follow button on a feed post means you don't follow its author.
      if (text === 'Follow' && n.parentElement.closest('button, [role="button"]')) suggested = true;
    }
    return suggested ? 'suggested' : 'followed';
  }

  // Whether a post belongs in another view (or nowhere, for ads).
  function excluded(article, view) {
    const kind = postKind(article);
    if (view === 'algo') return kind !== 'suggested';
    if (kind !== 'followed') return true;
    if (view === 'following') return favNames.has(author(article));
    return unfavved.size > 0 && unfavved.has(author(article));
  }

  function filterFeed(view) {
    // feed.js draws this view over Instagram's page.
    if (covered()) {
      setNote(null);
      return;
    }
    // "Suggested for you" accounts are recommendations: Algo only.
    if (view !== 'algo') {
      for (const a of document.querySelectorAll('a[href="/explore/people/"]')) {
        const block = suggestionBlock(a);
        if (block) block.classList.add(HIDE);
      }
    }
    if (view === 'algo') hideNativeStories();
    const articles = [...document.querySelectorAll('article')];
    for (const article of articles) watch(article);
    if (view !== 'algo' && prefs.hideSeen && seen) {
      hideSeenPosts(articles, view);
    } else {
      setNote(null);
      hideExcluded(articles, view);
    }
  }

  // Algo, and the other views while Hide seen is off. Seen posts left out of
  // Algo count as hidden ones, parked with the rest.
  function hideExcluded(articles, view) {
    const hiding = view === 'algo' && prefs.hideSeen && seen;
    let hiddenSeen = 0;
    const out = articles.map((a) => {
      if (excluded(a, view)) return true;
      const id = hiding && postId(a);
      const t = id ? seen.get(id) : undefined;
      if (t === undefined || t >= visitSec()) return false;
      hiddenSeen++;
      return true;
    });
    setHiddenCount(hiddenSeen);
    const lastKept = out.lastIndexOf(false);
    const park = articles.length - 1 - lastKept >= TAIL_LIMIT;
    articles.forEach((article, i) => {
      const parked = park && i > lastKept;
      article.classList.toggle(HIDE, out[i] && !parked);
      article.classList.toggle(TAIL, parked);
      article.classList.toggle(END, parked && i === lastKept + 1);
      if (parked && i === lastKept + 1) article.dataset.sinstaNote = TAIL_NOTES[view];
    });
  }

  // Instagram's own stories row on Algo shows accounts you follow, whose
  // stories are on Following and Favourites. It sits above the posts, in
  // the feed's container.
  function hideNativeStories() {
    const main = document.querySelector('main');
    const story = main && main.querySelector('[role="button"][aria-label^="Story by"]');
    if (!story || !main.querySelector('article')) return;
    let row = story;
    while (row.parentElement && row.parentElement !== main && !row.parentElement.querySelector('article')) row = row.parentElement;
    if (row.parentElement !== main && !row.contains(bar)) row.classList.add(HIDE);
  }

  // ---- Seen posts ---------------------------------------------------------

  // A post counts as seen once half of it, or half the screen, has shown it
  // for a second, in any view. Following, Favourites and Algo can then hide
  // posts seen before the current visit. (Instagram can't do it for Algo:
  // the views feed.js draws tell it nothing of what you've seen.) A visit
  // starts on page load, on switching view and on flipping the toggle.
  // feed.js shows which posts count as seen, and lets you mark one either
  // way: one marked as not seen isn't counted again until the next visit.
  const SEEN_KEY = 'sinsta-seen';
  const PREFS_KEY = 'sinsta-prefs';
  const REELS_KEY = 'sinsta-seen-reels-by-account';
  const OLD_REELS_KEY = 'sinsta-seen-reels'; // before it was kept per account
  const SEEN_MS = 1000;
  const KEEP_DAYS = 60;
  const storage = typeof browser === 'object' && browser.storage && browser.storage.local;

  let seen = null; // Map post id -> unix seconds; null until loaded
  let prefs = { hideSeen: true };
  let visitStart = Date.now() / 1000;
  // Seen times are whole seconds: one in the second the visit started is
  // this visit's.
  const visitSec = () => Math.floor(visitStart);
  let visitView = null;
  let saveTimer = 0;
  const unmarked = new Set(); // post ids marked as not seen this visit
  let hiddenCount = 0; // seen posts the current view leaves out, for the toggle

  async function loadState() {
    let data = {};
    try {
      if (storage) {
        data = await storage.get([SEEN_KEY, PREFS_KEY, REELS_KEY]);
      } else {
        data[SEEN_KEY] = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
        data[PREFS_KEY] = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        data[REELS_KEY] = JSON.parse(localStorage.getItem(REELS_KEY) || '{}');
      }
    } catch (_) {}
    const cutoff = Date.now() / 1000 - KEEP_DAYS * 86400;
    seen = new Map(Object.entries(data[SEEN_KEY] || {}).filter(([, t]) => t > cutoff));
    prefs = { ...prefs, ...(data[PREFS_KEY] || {}) };
    seenReels = data[REELS_KEY] || {};
    try {
      if (storage) storage.remove(OLD_REELS_KEY);
      else localStorage.removeItem(OLD_REELS_KEY);
    } catch (_) {}
    // Opening instagram.com lands on Algo; reopen the last view instead.
    const last = HOME_VIEWS.has(prefs.lastView) && viewById(prefs.lastView);
    if (location.pathname === '/' && !location.search && last && last.id !== 'algo') {
      location.replace(last.href);
      return;
    }
    buildSeenCss();
    syncHideSeen(currentView());
    syncToggle();
    if (reels) rememberSeenReels(reels);
    changed();
    schedule();
  }

  function save(key, value) {
    try {
      if (storage) storage.set({ [key]: value });
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function postId(article) {
    for (const a of article.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
      const m = a.getAttribute('href').match(/\/(?:p|reel)\/([^/?#]+)/);
      if (m) return m[1];
    }
    return null;
  }

  const saveSeen = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(SEEN_KEY, Object.fromEntries(seen)), 2000);
  };

  // Counted as seen by being on screen (or opened): not if marked as not seen.
  function markPostSeen(id) {
    if (!seen || seen.has(id) || unmarked.has(id)) return;
    seen.set(id, Math.floor(Date.now() / 1000));
    saveSeen();
  }

  // Marked by hand, either way.
  function setPostSeen(id, on) {
    if (!seen) return;
    if (on) {
      unmarked.delete(id);
      if (seen.has(id)) return;
      seen.set(id, Math.floor(Date.now() / 1000));
    } else {
      unmarked.add(id);
      if (!seen.delete(id)) return;
      buildSeenCss();
    }
    saveSeen();
  }

  const timers = new WeakMap();
  const watched = new WeakSet();
  const covered = () => !!(Sinsta.surface && Sinsta.surface.active());
  const onScreen = (article) => !covered() && !article.matches(`.${HIDE}, .${TAIL}`);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      clearTimeout(timers.get(e.target));
      const enough = e.intersectionRatio >= 0.5 || e.intersectionRect.height >= window.innerHeight / 2;
      if (!enough || !onScreen(e.target)) continue;
      timers.set(e.target, setTimeout(() => {
        const id = onScreen(e.target) && postId(e.target);
        if (id) markPostSeen(id);
      }, SEEN_MS));
    }
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

  function watch(article) {
    if (watched.has(article)) return;
    watched.add(article);
    io.observe(article);
  }

  // Seen posts must already be collapsed when Instagram first lays them out:
  // its feed measures each post once, and a post collapsed afterwards still
  // takes up its old height in the feed's reserved scroll space. A class
  // added from script always comes too late, so a stylesheet matches seen
  // posts by their /p/<id>/ link instead.
  const MAX_CSS_IDS = 1500;
  const seenStyle = el('style', {});

  function buildSeenCss() {
    if (!seen) return;
    const ids = [...seen]
      .filter(([id, t]) => t < visitSec() && /^[\w-]+$/.test(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CSS_IDS)
      .map(([id]) => `[href*="/${id}/"]`);
    setCollapseCss(seenStyle, 'html[data-sinsta-hide-seen]', 'a', ids);
  }

  // Collapse the posts (articles under `scope`) holding a `link` with any of
  // the attributes. Firefox checks every :has() against each post it adds,
  // and one :has() with a long list costs about its square: 1500 post ids
  // took ~9 ms a post as one :has() and ~20 ms as one each, ~1 ms in :has()es
  // of 50. Their contents are skipped (content-visibility) rather than each
  // child hidden by a second rule, which would match them all again.
  const COLLAPSE_CHUNK = 50;
  function setCollapseCss(style, scope, link, attrs) {
    const posts = [];
    for (let i = 0; i < attrs.length; i += COLLAPSE_CHUNK) {
      posts.push(`${scope} article:has(${link}:is(${attrs.slice(i, i + COLLAPSE_CHUNK).join(', ')}))`);
    }
    style.textContent = posts.length
      ? `${posts.join(',\n')} {
  height: 0 !important; min-height: 0 !important; margin: 0 !important;
  padding: 0 !important; border: 0 !important; overflow: hidden !important;
  visibility: hidden !important; content-visibility: hidden !important;
}`
      : '';
    if (!style.isConnected) (document.head || document.documentElement).append(style);
  }

  // A post's author is the first link in its header: four nested first-child
  // spans deep. Collaborators, @mentions and tags sit elsewhere.
  const AUTHOR = 'span:first-child > span:first-child > span:first-child > span:first-child > div > a';

  function author(article) {
    const a = article.querySelector(`${AUTHOR}[href]`);
    return a ? (a.getAttribute('href').match(/^\/([\w.]+)\/$/) || [])[1] : undefined;
  }

  // Collapse posts by these authors when the attribute is set. As with seen
  // posts, a stylesheet catches them before Instagram measures them.
  function setAuthorCss(style, attr, users) {
    setCollapseCss(style, `html[${attr}]`, AUTHOR, [...users]
      .filter((u) => /^[\w.]+$/.test(u))
      .map((u) => `[href="/${u}/"]`));
  }

  // Following leaves out favourites, who have their own view.
  const favStyle = el('style', {});
  const buildFavCss = () => setAuthorCss(favStyle, 'data-sinsta-following', favNames);

  // Accounts removed from Favourites since the page loaded. Instagram's
  // Favourites feed keeps their posts until it reloads, so hide them here.
  const unfavved = new Set();
  const unfavStyle = el('style', {});
  const buildUnfavCss = () => setAuthorCss(unfavStyle, 'data-sinsta-favourites', unfavved);

  function syncHideSeen(view) {
    document.documentElement.toggleAttribute('data-sinsta-hide-seen', HOME_VIEWS.has(view) && prefs.hideSeen && !!seen);
  }

  function newVisit() {
    visitStart = Date.now() / 1000;
    unmarked.clear();
    buildSeenCss();
    met.clear();
    hiddenRun = 0;
    runLimit = RUN_LIMIT;
    stalls = 0;
    metAtNudge = 0;
    changed();
  }

  // Tell feed.js that what shows may have changed.
  const changed = () => Sinsta.surface && Sinsta.surface.changed();

  function hideSeenPosts(articles, view) {
    const shown = [];
    let hidden = 0;
    let hiddenSeen = 0;
    for (const article of articles) {
      const id = postId(article);
      const t = id ? seen.get(id) : undefined;
      const wasSeen = t !== undefined && t < visitSec();
      if (wasSeen) hiddenSeen++;
      const hide = wasSeen || excluded(article, view);
      article.classList.toggle(HIDE, !!hide);
      article.classList.toggle(TAIL, false);
      article.classList.toggle(END, false);
      if (id && !met.has(id)) {
        met.add(id);
        hiddenRun = hide ? hiddenRun + 1 : 0;
      }
      if (hide) hidden++;
      else shown.push(article);
    }
    setHiddenCount(hiddenSeen);
    loadMore(shown, hidden);
  }

  // Instagram fetches the next page only when a scroll brings the end of the
  // feed near. With seen posts collapsed there may be nothing left to scroll,
  // so nudge it with a scroll event. Pause after a long run of seen posts
  // (each "Look further back" allows another run), and stop for good when
  // nudges stop loading anything (the end of the feed).
  const RUN_LIMIT = 120; // seen posts in a row before pausing
  const MAX_STALLS = 8; // nudges in a row that loaded nothing
  const NUDGE_MS = 800;
  const EAGER_MS = 250; // after posts come in, nudge every frame for this long
  const met = new Set(); // post ids met this visit
  let hiddenRun = 0; // seen posts met in a row
  let runLimit = RUN_LIMIT;
  let stalls = 0;
  let metAtNudge = 0;
  let metGrew = 0; // when posts last came in
  let lastNudge = 0;
  let nudgeTimer = 0;

  function loadMore(shown, hidden) {
    if (met.size > metAtNudge) {
      stalls = 0;
      metAtNudge = met.size;
      metGrew = Date.now();
    }
    const last = shown[shown.length - 1] || bar;
    const nearEnd = last.getBoundingClientRect().bottom < window.innerHeight * 2;
    const ended = stalls >= MAX_STALLS;
    const paused = hiddenRun >= runLimit;
    if (!nearEnd || hidden === 0) setNote(null);
    else if (ended) setNote('ended');
    else if (paused) setNote('paused');
    else if (hiddenRun > 0) setNote('looking');
    else setNote(null);
    if (ended || paused || !nearEnd) return;
    clearTimeout(nudgeTimer);
    // Right after posts come in, Instagram takes a frame or two to lay them
    // out before a scroll makes it load more (and ignores scrolls while it
    // loads): while skipping seen posts, nudge every frame for a moment;
    // otherwise, and then, now and then, counting those towards a stall.
    const eager = hiddenRun > 0 && Date.now() - metGrew < EAGER_MS;
    const page = window.wrappedJSObject || window;
    if (eager) {
      page.dispatchEvent(new page.Event('scroll'));
      schedule(); // the next frame
      return;
    }
    const wait = lastNudge + NUDGE_MS - Date.now();
    if (wait > 0) {
      nudgeTimer = setTimeout(schedule, wait);
      return;
    }
    lastNudge = Date.now();
    stalls++;
    page.dispatchEvent(new page.Event('scroll'));
    nudgeTimer = setTimeout(schedule, NUDGE_MS);
  }

  const noteText = el('p', {});
  const furtherBtn = el('button', { type: 'button' }, 'Look further back');
  const showSeenBtn = el('button', { type: 'button' }, "Show posts you've seen");
  const caughtUp = el('div', { className: 'sinsta-caught-up', hidden: true },
    noteText, el('div', { className: 'sinsta-caught-up-actions' }, furtherBtn, showSeenBtn));

  furtherBtn.addEventListener('click', () => {
    runLimit = hiddenRun + RUN_LIMIT;
    stalls = 0; // also retries if a slow connection looked like the end
    schedule();
  });

  showSeenBtn.addEventListener('click', () => {
    prefs.hideSeen = false;
    save(PREFS_KEY, prefs);
    syncToggle();
    newVisit();
    schedule();
  });

  function setNote(state) {
    caughtUp.hidden = !state;
    caughtUp.dataset.state = state || '';
    const text = state === 'looking' ? `Looking for posts you haven't seen\u2026 (skipped ${hiddenRun})`
      : state === 'paused' ? `You're caught up: the last ${hiddenRun} posts were ones you've seen.`
        : state === 'ended' ? "You're caught up: that's as far back as this feed goes." : null;
    // Setting text replaces the node even when it's the same, which wakes
    // the MutationObserver and runs all this again the next frame.
    if (text !== null && noteText.textContent !== text) noteText.textContent = text;
    furtherBtn.hidden = state !== 'paused' && state !== 'ended';
    const further = state === 'ended' ? 'Try again' : 'Look further back';
    if (furtherBtn.textContent !== further) furtherBtn.textContent = further;
    showSeenBtn.hidden = state !== 'paused' && state !== 'ended';
    // Instagram's spinner would keep suggesting more is on the way.
    document.documentElement.toggleAttribute('data-sinsta-caught-up', state === 'paused' || state === 'ended');
    const column = bar.parentElement;
    if (state && column && caughtUp.parentElement !== column) column.append(caughtUp);
  }

  // ---- Story data ---------------------------------------------------------

  // Instagram's stories tray holds at most 120 accounts, unwatched first, so
  // with enough unwatched stories around, fully watched ones drop out of it.
  // Remember them here until they expire, to keep them at the end of the row.
  // Kept per logged-in account: another account follows other people.
  let seenReels = {}; // account id -> user id -> { username, pic, expires }

  const account = () => (document.cookie.match(/(?:^|; )ds_user_id=(\d+)/) || [])[1] || '';

  function rememberSeenReels(list) {
    if (!seen) return; // stored state not loaded yet: saving now would wipe it
    const me = account();
    if (!me) return;
    const mine = seenReels[me] || (seenReels[me] = {});
    const now = Date.now() / 1000;
    let changed = false;
    for (const r of list) {
      if (r.unseen || !r.latest) continue;
      const expires = r.latest + 86400;
      const known = mine[r.id];
      if (known && known.expires === expires) continue;
      mine[r.id] = { username: r.username, pic: r.pic, expires };
      changed = true;
    }
    for (const [acc, reelsOf] of Object.entries(seenReels)) {
      for (const [id, s] of Object.entries(reelsOf)) {
        if (s.expires > now) continue;
        delete reelsOf[id];
        changed = true;
      }
      if (acc !== me && !Object.keys(reelsOf).length) delete seenReels[acc];
    }
    if (changed) save(REELS_KEY, seenReels);
  }

  function rememberedReels(present) {
    const now = Date.now() / 1000;
    const inTray = new Set(present.map((r) => r.id));
    return Object.entries(seenReels[account()] || {})
      .filter(([id, s]) => s.expires > now && !inTray.has(id))
      .sort((a, b) => b[1].expires - a[1].expires)
      .map(([id, s]) => ({ id, username: s.username, pic: s.pic, unseen: false, seenAt: s.expires - 86400, latest: s.expires - 86400 }));
  }

  async function loadTray() {
    if (trayBusy || Date.now() - trayAt < TRAY_TTL) return;
    trayBusy = true;
    const data = await api('/api/v1/feed/reels_tray/');
    trayBusy = false;
    trayAt = Date.now();
    if (!data || !Array.isArray(data.tray)) return;
    reels = data.tray.map(trayReel).filter(Boolean);
    rememberSeenReels(reels);
    schedule();
  }

  function trayReel(r) {
    if (!r.user || !r.user.username || r.muted) return null;
    return {
      id: String(r.user.pk_id || r.user.pk || r.id),
      username: r.user.username,
      pic: r.user.profile_pic_url,
      unseen: r.latest_reel_media > (r.seen || 0),
      seenAt: r.seen || 0,
      latest: r.latest_reel_media || 0,
    };
  }

  // Reloaded every few minutes, to pick up changes made elsewhere.
  async function loadFavourites() {
    if (favBusy || Date.now() - favAt < FAV_TTL) return;
    favBusy = true;
    const data = await api('/api/v1/friendships/feed_favorites/');
    favBusy = false;
    favAt = Date.now();
    if (!data || !Array.isArray(data.users)) {
      if (!favIds) favAt = 0; // nothing yet: retry on the next sweep
      return;
    }
    const before = new Set(favNames);
    favIds = new Set();
    favNames.clear();
    for (const u of data.users) {
      const id = String(u.pk_id || u.pk || u.id);
      favIds.add(id);
      favNames.add(u.username);
      userIds.set(u.username, id);
      unfavved.delete(u.username);
    }
    for (const u of before) if (!favNames.has(u)) unfavved.add(u);
    buildFavCss();
    buildUnfavCss();
    changed();
    schedule();
  }

  // Instagram's stories tray is ranked and cut off at 120 accounts, so it can
  // miss favourites entirely. Ask for every favourite's stories directly.
  async function loadFavReels() {
    if (!favIds || favReelsBusy || Date.now() - favReelsAt < FAV_TTL) return;
    favReelsBusy = true;
    const list = await fetchReels([...favIds]);
    favReelsBusy = false;
    favReelsAt = Date.now();
    if (!list) return;
    favReels = list;
    rememberSeenReels(favReels);
    schedule();
  }

  // ---- Switcher and stories bar -------------------------------------------

  // The tabs come in two groups: accounts you chose (Following, Favourites,
  // with Hide seen beside them), and Instagram's picks (Algo, Reels). The
  // slot holds feed.js's List / Grid switch and column count.
  const tab = (v) => {
    const a = el('a', { className: 'sinsta-tab', href: v.href }, icon(v.icon), v.label);
    a.dataset.view = v.id;
    return a;
  };
  const tabs = el('nav', { className: 'sinsta-tabs' }, tab(viewById('following')), tab(viewById('favorites')));
  const picks = el('nav', { className: 'sinsta-tabs sinsta-picks' }, tab(viewById('algo')), tab(viewById('reels')));
  const seenCount = el('span', { className: 'sinsta-count' });
  const seenToggle = el('button', { className: 'sinsta-toggle', type: 'button' }, icon(EYE_OFF), 'Hide seen', seenCount);
  const slot = el('div', { className: 'sinsta-slot' });
  // The extension's wordmark, "here.", at the start of its own bar
  // (Instagram's logo stays as it is). TeX Gyre Bonum Bold, outlined.
  function wordmark() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = mark(document.createElementNS(NS, 'svg'));
    svg.setAttribute('viewBox', '0 0 344 100');
    svg.setAttribute('class', 'sinsta-mark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Here for Instagram');
    const title = document.createElementNS(NS, 'title');
    title.textContent = 'Here for Instagram';
    svg.append(title);
    for (const [d, cls] of [
      ['M85.8 98.2V87.2L80.9 86.3C75.8 85.3 74.9 83.6 74.9 76V50.2C74.9 32.4 61.7 28.9 53.7 28.9C46.4 28.9 40.4 30.7 32.7 35V0H23.9C15.2 3.7 6.1 5.8 0 5.8V16.8L2.7 17.1C10.3 17.9 10.7 21.4 10.7 28.1V76C10.7 83.6 9.8 85.3 4.7 86.3L0 87.2V98.2H40.4V87.2L38.7 86.6C33 84.4 32.7 83.9 32.7 76V48.8C36 46 42.9 43.6 47.2 43.6C51 43.6 52.9 46.3 52.9 52V76C52.9 83.9 52.6 84.4 46.9 86.6L45.2 87.2V98.2ZM163.6 78.8 152.2 73.3C146.9 81.1 141.4 84.8 134.5 84.8C123.9 84.8 118 77.3 118 63.8H162C162 54.1 161.1 48.6 158.5 44C153.2 34.6 142.2 28.9 129.2 28.9C108.3 28.9 93.5 43.4 93.5 63.9C93.5 84.5 109 99.5 130.4 99.5C150.3 99.5 158.3 87.4 163.6 78.8ZM138 53.3H118.9C119.3 45.9 122.9 41.4 129 41.4C135.1 41.4 137.7 44.8 138 53.3ZM230.7 41.4C230.7 34.3 225.4 28.9 218.5 28.9C212.9 28.9 209.5 30.4 200.5 36.8V30.1H192.1L171 34.1V45L173.4 45.3C179.4 46 180.9 48.2 180.9 56.4V76C180.9 83.7 180.1 85.1 174.9 86.3L171 87.2V98.2H212.8V87.2L208.8 86.3C203.7 85.1 202.8 83.7 202.8 76V49.7C204.7 48 206.1 47.5 208.3 47.5C212.3 47.5 213.3 51.7 219.9 51.7C226.1 51.7 230.7 47.4 230.7 41.4ZM304.7 78.8 293.4 73.3C288.1 81.1 282.5 84.8 275.6 84.8C265 84.8 259.2 77.3 259.2 63.8H303.1C303.1 54.1 302.2 48.6 299.6 44C294.3 34.6 283.3 28.9 270.3 28.9C249.4 28.9 234.6 43.4 234.6 63.9C234.6 84.5 250.1 99.5 271.5 99.5C291.5 99.5 299.5 87.4 304.7 78.8ZM279.1 53.3H260C260.4 45.9 264 41.4 270.1 41.4C276.3 41.4 278.8 44.8 279.1 53.3Z', ''],
      ['M344 87.7C344 80.9 338.5 75.4 331.8 75.4C325 75.4 319.4 80.9 319.4 87.5C319.4 94.4 324.8 100 331.6 100C338.4 100 344 94.4 344 87.7Z', 'sinsta-mark-dot'],
    ]) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      if (cls) path.setAttribute('class', cls);
      svg.append(path);
    }
    return svg;
  }
  const stories = el('div', { className: 'sinsta-stories', hidden: true });
  const bar = el('div', { id: 'sinsta-bar' },
    el('div', { className: 'sinsta-controls' }, wordmark(), tabs, seenToggle, picks, slot),
    stories);

  seenToggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    prefs.hideSeen = !prefs.hideSeen;
    save(PREFS_KEY, prefs);
    syncToggle();
    newVisit();
    toTop();
    schedule();
  });

  const toTop = () => (Sinsta.surface ? Sinsta.surface.toTop() : window.scrollTo(0, 0));

  function syncToggle() {
    const n = prefs.hideSeen ? hiddenCount : 0;
    seenToggle.setAttribute('aria-pressed', String(prefs.hideSeen));
    seenToggle.title = !prefs.hideSeen ? 'Showing the full timeline. Click to hide posts you have seen.'
      : n ? `Hiding ${n} post${n === 1 ? '' : 's'} you saw before this visit. Click for the full timeline.`
        : 'Hiding posts you saw before this visit. Click for the full timeline.';
    const text = n ? String(n) : '';
    if (seenCount.textContent !== text) seenCount.textContent = text;
    seenCount.hidden = !n;
  }
  syncToggle();

  // How many seen posts the view on screen leaves out (of those loaded).
  function setHiddenCount(n) {
    if (n === hiddenCount) return;
    hiddenCount = n;
    syncToggle();
  }

  bar.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (a.dataset.reel) {
      const index = shownReels.findIndex((r) => r.id === a.dataset.reel);
      const onClose = () => {
        rememberSeenReels(shownReels);
        schedule();
      };
      if (index >= 0) openViewer(shownReels, index, { onClose });
      return;
    }
    const href = a.getAttribute('href');
    if (href === nav.here().pathname + nav.here().search) toTop();
    else go(href);
  });

  // Instagram's Home links (sidebar item, logo) always open Algo; open the
  // last view instead, as opening instagram.com does.
  document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href="/"]');
    if (!a || bar.contains(a)) return;
    const last = HOME_VIEWS.has(prefs.lastView) && viewById(prefs.lastView);
    if (!last || last.id === 'algo') return;
    e.preventDefault();
    e.stopPropagation();
    if (nav.here().pathname === '/' && currentView() === last.id) toTop();
    else go(last.href);
  }, true);

  function currentView() {
    const variant = new URLSearchParams(nav.here().search).get('variant');
    return variant === 'following' || variant === 'favorites' ? variant : 'algo';
  }

  // The feed column: the child of main's top-level row that holds the posts.
  function feedColumn() {
    const main = document.querySelector('main');
    if (!main) return null;
    let child = main.querySelector('article') || main.querySelector('a[href*="variant=home"]');
    if (!child) return null;
    let parent = child.parentElement;
    while (parent && parent.parentElement !== main) {
      child = parent;
      parent = parent.parentElement;
    }
    return parent ? child : null;
  }

  function renderStories(view) {
    // Following: Instagram's tray (its own pick of up to 120 accounts) plus
    // remembered watched ones. Favourites: the complete list, falling back to
    // the tray until it arrives. Either way: unwatched first, newest first.
    let source = [];
    if (view === 'favorites' && favIds) {
      const base = (favReels || reels || []).filter((r) => favIds.has(r.id));
      source = base.concat(rememberedReels(base).filter((r) => favIds.has(r.id)));
    } else if (view === 'following' && reels) {
      const notFav = (r) => !favIds || !favIds.has(r.id);
      source = reels.filter(notFav).concat(rememberedReels(reels).filter(notFav));
    }
    const newest = (a, b) => b.latest - a.latest;
    const list = [...source.filter((r) => r.unseen).sort(newest), ...source.filter((r) => !r.unseen).sort(newest)];
    const key = view + '|' + list.map((r) => r.id + (r.unseen ? 'u' : 's')).join(',');
    if (key === rendered) return;
    rendered = key;
    shownReels = list;
    stories.hidden = list.length === 0;
    stories.replaceChildren(...list.map((r) => {
      const item = el('a', {
        className: 'sinsta-story' + (r.unseen ? '' : ' sinsta-seen'),
        href: `/stories/${r.username}/`,
        title: r.username,
      },
        el('span', { className: 'sinsta-ring' }, el('img', { src: r.pic, alt: '', loading: 'lazy' })),
        el('span', { className: 'sinsta-name' }, r.username));
      item.dataset.reel = r.id;
      return item;
    }));
  }

  // The bar goes atop feed.js's surface, over Instagram's Reels player, or
  // (where Instagram's page shows) atop its feed. On Explore it only goes
  // atop the surface, without the tabs.
  function mountBar(view) {
    const host = (Sinsta.surface && Sinsta.surface.barHost(view)) || (HOME_VIEWS.has(view) ? feedColumn() : null);
    if (!host) return;
    if (bar.parentElement !== host) host.prepend(bar);
    if (bar.dataset.view !== view) {
      bar.dataset.view = view;
      for (const t of bar.querySelectorAll('.sinsta-tab')) {
        if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
        else t.removeAttribute('aria-current');
      }
    }
    // Instagram shows no stories row on these two views; Algo's is hidden.
    if (view === 'following') {
      loadTray();
      loadFavourites();
    }
    if (view === 'favorites') {
      loadTray(); // the row's fallback, should the full list fail
      loadFavourites();
      loadFavReels();
    }
    renderStories(view);
  }

  // ---- Wiring -------------------------------------------------------------

  // Reels is a tab in the bar now, so it leaves Instagram's menu: the
  // largest box round the menu's Reels link holding no other link.
  function hideReelsItem() {
    for (const a of document.querySelectorAll('a[href="/reels/"]')) {
      if (a.closest('main, #sinsta-bar, #sinsta-surface, #sinsta-float, [data-sinsta-gone]')) continue;
      let item = a;
      while (item.parentElement && item.parentElement !== document.body
        && item.parentElement.querySelectorAll('a[href], [role="link"]').length === 1) item = item.parentElement;
      item.setAttribute('data-sinsta-gone', '');
    }
  }

  function sweep() {
    queued = false;
    hideReelsItem();
    ensureSavedItem();
    ensureFavButtons();
    syncBadgeTip();
    const { pathname } = nav.here(); // under the player's or viewer's own address
    const onReels = /^\/reels(\/|$)/.test(pathname);
    const onExplore = /^\/explore\/?$/.test(pathname);
    const view = pathname === '/' ? currentView() : onReels ? 'reels' : onExplore ? 'explore' : null;
    document.documentElement.toggleAttribute('data-sinsta-favourites', view === 'favorites');
    document.documentElement.toggleAttribute('data-sinsta-following', view === 'following');
    // A profile's Posts tab, when feed.js draws its grid: the bar (Hide
    // seen and the layout controls) goes atop it. The visit is Home's, which
    // a look at a profile doesn't end.
    if (!view && Sinsta.surface && Sinsta.surface.inline()) {
      mountBar('profile');
      return;
    }
    if (!view) return;
    if (view === 'reels') {
      mountBar(view);
      return;
    }
    if (view !== visitView) {
      visitView = view;
      newVisit();
    }
    // Explore: feed.js's surface, or Instagram's page left as it is.
    if (view === 'explore') {
      mountBar(view);
      return;
    }
    if (seen && prefs.lastView !== view) {
      prefs.lastView = view;
      save(PREFS_KEY, prefs);
    }
    syncHideSeen(view);
    mountBar(view);
    filterFeed(view);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sweep);
  }

  // ---- Saved in the main menu ---------------------------------------------

  // Instagram tucks Saved under "More". Add it as a top-level item under
  // Profile, built from a copy of the Profile item so it matches the menu's
  // look in both its wide and icon-only layouts.
  const BOOKMARK = ['M19 21l-7-5-7 5V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1z'];
  let savedItem = null;
  let savedSig = '';
  let watchedProfile = null;
  const profileWatch = new MutationObserver(() => schedule());

  // ---- App-only notifications ---------------------------------------------

  // Some notifications light the Notifications dot but never appear in the
  // web panel, such as "X added to their story" for accounts you get alerts
  // for. Say so on the dot, and guess what they are: a notification arrives
  // right after what it is about, so look for stories and posts by followed
  // accounts published between the last check without it and the first
  // check with it.
  const BADGE_MS = 60000;
  const SLACK = 120; // seconds a notification may trail what it is about
  const PRECISE = 15 * 60; // a narrower window gives a confident guess
  const PHONE = ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M11 18h2'];
  let appOnly = 0;
  let badgeAt = 0;
  let quietAt = 0; // unix seconds of the last check where the count hadn't risen
  let guesses = []; // [{ at, label, open }], newest first
  let guessKey = '';
  let precise = false;

  async function checkBadge() {
    if (!seen || Date.now() - badgeAt < BADGE_MS / 2) return; // seen: stored state loaded
    badgeAt = Date.now();
    const n = await appOnlyNotifications();
    if (n === null) return;
    const now = Math.floor(Date.now() / 1000);
    const windows = prefs.appOnlyWindows || [];
    if (n === 0) {
      quietAt = now;
      guesses = [];
      guessKey = '';
      if (windows.length || now - (prefs.appOnlyQuietAt || 0) > 300) {
        prefs.appOnlyWindows = [];
        prefs.appOnlyQuietAt = now;
        save(PREFS_KEY, prefs);
      }
    } else if (n > windows.length) {
      // Risen since the last check (or since this browser last checked).
      const from = Math.max(quietAt || prefs.appOnlyQuietAt || 0, now - 86400) - SLACK;
      prefs.appOnlyWindows = [...windows, [from, now]].slice(-5);
      prefs.appOnlyQuietAt = quietAt = now;
      save(PREFS_KEY, prefs);
    } else {
      quietAt = now;
    }
    appOnly = n;
    syncBadgeTip();
    if (n > 0) guessAppOnly(prefs.appOnlyWindows || []);
  }

  async function guessAppOnly(windows) {
    const key = JSON.stringify(windows);
    if (!windows.length || key === guessKey) return;
    guessKey = key;
    const since = Math.min(...windows.map((w) => w[0]));
    const inWindow = (t) => windows.some(([a, b]) => t > a && t <= b + 60);
    // Instagram's stories tray stops at 120 accounts, so favourites' stories
    // are asked for directly too. Favourites rank first: alerts are usually
    // for accounts you care about.
    await loadFavourites();
    const [tray, favs, posts] = await Promise.all([
      api('/api/v1/feed/reels_tray/'),
      favIds ? fetchReels([...favIds]) : null,
      recentPosts(since),
    ]);
    if (key !== guessKey) return;
    const reelsById = new Map();
    for (const reel of [...((tray && tray.tray) || []).map(trayReel), ...(favs || [])]) {
      if (reel && !reelsById.has(reel.id)) reelsById.set(reel.id, reel);
    }
    const fav = (user) => !!(favIds && favIds.has(userIds.get(user)));
    const found = [];
    for (const reel of reelsById.values()) {
      if (!inWindow(reel.latest)) continue;
      found.push({ at: reel.latest, fav: fav(reel.username), label: `${reel.username}'s story`, open: () => openViewer([reel], 0) });
    }
    for (const p of posts || []) {
      if (inWindow(p.takenAt)) found.push({ at: p.takenAt, fav: fav(p.username), label: `${p.username}'s ${p.kind}`, open: () => go(p.href) });
    }
    guesses = found.sort((a, b) => b.fav - a.fav || b.at - a.at);
    precise = windows.every(([a, b]) => b - a <= PRECISE + SLACK);
    syncBadgeTip();
  }

  function ago(t) {
    const mins = Math.max(1, Math.round((Date.now() / 1000 - t) / 60));
    return mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  }

  function syncBadgeTip() {
    const svg = document.querySelector('svg[aria-label="Notifications"]');
    const item = svg && svg.closest('a, [role="link"], [role="button"]');
    if (!item) return;
    let tip = appOnly === 0 ? ''
      : appOnly === 1 ? '1 notification that only shows in the Instagram app'
        : `${appOnly} notifications that only show in the Instagram app`;
    if (tip && guesses.length) {
      const list = guesses.slice(0, 3).map((g) => `${g.label} (${ago(g.at)})`);
      tip += `\n${precise ? 'Probably' : 'Possibly'}: ${list.join(', ')}`;
    }
    if (tip && item.title !== tip) {
      item.title = tip;
      item.dataset.sinstaTip = '';
    } else if (!tip && 'sinstaTip' in item.dataset) {
      item.removeAttribute('title');
      delete item.dataset.sinstaTip;
    }
    // The sidebar shows its labels when hovered or wide: put a phone icon and
    // the count after "Notifications" (the label row is too narrow for words).
    // Clicking it opens the best guess instead of the panel.
    const label = [...item.querySelectorAll('span')].find((s) => s.childElementCount === 0 && s.textContent.trim() === 'Notifications');
    const row = label && label.parentElement && label.parentElement.parentElement;
    let note = item.querySelector('.sinsta-app-note');
    if (!tip || !row) {
      if (note) note.remove();
      return;
    }
    if (!note) {
      note = el('span', { className: 'sinsta-app-note' }, icon(PHONE), el('span', {}));
      note.addEventListener('click', (e) => {
        if (!guesses.length) return; // no guess: let it open the panel
        e.preventDefault();
        e.stopPropagation();
        guesses[0].open();
      });
    }
    note.lastChild.textContent = String(appOnly);
    note.title = guesses.length ? `Open ${guesses[0].label}` : tip;
    if (note.parentElement !== row) row.append(note);
  }

  setInterval(checkBadge, BADGE_MS);
  // Opening the panel clears the dot: check again shortly after.
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('a:has(svg[aria-label="Notifications"]), [role="link"]:has(svg[aria-label="Notifications"])')) return;
    if (e.target.closest('.sinsta-app-note') && guesses.length) return;
    setTimeout(() => {
      badgeAt = 0;
      checkBadge();
    }, 3000);
  }, true);

  // ---- Stories from a profile ---------------------------------------------

  // The profile picture at the top of a profile opens the account's story in
  // the extension's viewer, as the stories row does: one account, so no
  // carousel. Without a story, the click goes on to Instagram (on your own
  // profile it changes the photo).
  function profileAvatar(target) {
    const user = (nav.here().pathname.match(/^\/([\w.]+)\//) || [])[1];
    const btn = user && target.closest && target.closest('header [role="button"]');
    if (!btn || btn.closest('a[href]') || btn.querySelector('a[href]')) return null;
    const img = btn.querySelector('img');
    // "user's profile picture", in whatever language: the username as a word.
    return img && img.alt.split(/[^\w.]+/).includes(user) ? user : null;
  }

  // The account's story, or null if it has none, or undefined if Instagram
  // didn't answer. Asked for on hover, so it is usually there by the click.
  const profileReels = new Map(); // username -> { at, job }
  function profileReel(user) {
    const got = profileReels.get(user);
    if (got && Date.now() - got.at < 60000) return got.job;
    const job = (async () => {
      const id = await lookUpId(user);
      const reels = id ? await fetchReels([id]) : null;
      if (!reels) {
        profileReels.delete(user);
        return undefined;
      }
      return reels.find((r) => r.id === id) || null;
    })();
    profileReels.set(user, { at: Date.now(), job });
    return job;
  }

  let passClick = false;
  document.addEventListener('pointerover', (e) => {
    const user = profileAvatar(e.target);
    if (user) profileReel(user);
  }, true);
  document.addEventListener('click', async (e) => {
    if (passClick || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const user = profileAvatar(e.target);
    if (!user) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    const path = nav.here().pathname;
    const reel = await profileReel(user);
    if (!target.isConnected || nav.here().pathname !== path) return;
    if (reel) {
      openViewer([reel], 0);
    } else if (reel === undefined) {
      go(`/stories/${user}/`); // Instagram's own viewer
    } else {
      passClick = true;
      try {
        target.click();
      } finally {
        passClick = false;
      }
    }
  }, true);

  // ---- Favourite star on profile hover cards ------------------------------

  const FAV_MAX = 50; // Instagram's limit

  // A hover card is an absolutely positioned popup holding the account's
  // stats and its Message / Following buttons. Only followed accounts can be
  // favourites, so the star goes next to "Following".
  function ensureFavButtons() {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim() !== 'Following') continue;
      const row = btn.parentElement && btn.parentElement.parentElement;
      if (!row || row.querySelector('.sinsta-fav')) continue;
      let card = row;
      for (let i = 0; i < 6 && card && getComputedStyle(card).position !== 'absolute'; i++) card = card.parentElement;
      if (!card || getComputedStyle(card).position !== 'absolute' || !/followers/.test(card.textContent)) continue;
      const user = [...card.querySelectorAll('a[href]')]
        .map((a) => (a.getAttribute('href').match(/^\/([\w.]+)\/?$/) || [])[1])
        .find(Boolean);
      if (user) row.append(favButton(user));
    }
    for (const b of document.querySelectorAll('.sinsta-fav')) syncFav(b);
  }

  function favButton(user) {
    const b = el('button', { type: 'button', className: 'sinsta-fav' }, icon(viewById('favorites').icon));
    b.dataset.user = user;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFav(b);
    });
    loadFavourites();
    syncFav(b);
    return b;
  }

  function syncFav(b) {
    const id = userIds.get(b.dataset.user);
    const on = !!(favIds && id && favIds.has(id));
    const full = !!(!on && favIds && favIds.size >= FAV_MAX);
    // Not disabled when full, so the tooltip explaining why still shows.
    b.disabled = !favIds || b.dataset.busy === '1';
    b.setAttribute('aria-disabled', String(full));
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Remove from Favourites'
      : full ? `Favourites is full (Instagram allows ${FAV_MAX})`
        : 'Add to Favourites';
  }

  async function toggleFav(b) {
    if (!favIds || b.dataset.busy) return;
    if (b.getAttribute('aria-disabled') === 'true') {
      favNote(b, `Favourites is full: Instagram allows ${FAV_MAX}. Remove someone first.`);
      return;
    }
    b.dataset.busy = '1';
    syncFav(b);
    const id = await lookUpId(b.dataset.user);
    const want = !(id && favIds.has(id));
    const now = id ? await setFavourite(id, want) : null;
    delete b.dataset.busy;
    if (now === null) {
      favNote(b, "Couldn't update Favourites. Try again, or use the menu on their profile.");
    } else if (now !== want) {
      favNote(b, 'Instagram refused the change.');
    }
    if (now !== null) {
      const user = b.dataset.user;
      if (now) {
        favIds.add(id);
        favNames.add(user);
        unfavved.delete(user);
      } else {
        favIds.delete(id);
        favNames.delete(user);
        unfavved.add(user);
      }
      buildFavCss();
      buildUnfavCss();
      favReelsAt = 0; // refetch the Favourites stories row
      changed();
    }
    syncFav(b);
    schedule();
  }

  // A short message under the card's buttons.
  function favNote(b, text) {
    const row = b.parentElement;
    let note = row.nextElementSibling;
    if (!note || !note.classList.contains('sinsta-fav-note')) {
      note = el('div', { className: 'sinsta-fav-note' });
      row.after(note);
    }
    note.textContent = text;
    clearTimeout(note.timer);
    note.timer = setTimeout(() => note.remove(), 5000);
  }

  // ---- Profile cards on the extension's own names -------------------------

  // Instagram's hover card only comes with its own links, so the names the
  // extension draws (in its feeds, grids, player and comments) get this one,
  // from the query Instagram's card uses, with the Favourites star in it.
  const CARD_SHOW_MS = 500; // rest on a name this long
  const CARD_FETCH_MS = 200; // start fetching after resting this long
  const CARD_HIDE_MS = 250; // grace for moving onto the card
  const CARD_TTL_MS = 5 * 60 * 1000;
  const CARD_POSTS = 9;
  const CARD_SCOPE = '#sinsta-surface, #sinsta-reel-player';
  const NOT_USERS = new Set(['explore', 'reels', 'direct', 'accounts', 'stories', 'p', 'reel', 'about', 'legal']);
  const cards = new Map(); // username -> { at, job: Promise<card | null> }
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  let card = null; // the popup
  let cardLink = null; // the name it is for (or is about to be for)
  let showTimer = 0;
  let hideTimer = 0;
  let fetchTimer = 0;

  function cardUser(a) {
    if (!a || !a.closest(CARD_SCOPE)) return null;
    const user = ((a.getAttribute('href') || '').match(/^\/([\w.]+)\/$/) || [])[1];
    return user && !NOT_USERS.has(user) ? user : null;
  }

  function cardData(user) {
    const hit = cards.get(user);
    if (hit && Date.now() - hit.at < CARD_TTL_MS) return hit.job;
    // Instagram's card query has only the latest three posts; the profile's
    // own grid query has its first nine as the profile shows them (pinned
    // first). Private accounts you don't follow have only the card's.
    const grid = Sinsta.profilePage(user).catch(() => null);
    const job = lookUpId(user)
      .then(async (id) => {
        const c = id && await userCard(id);
        if (!c) return null;
        const page = await grid;
        const nine = page && page.items.length
          ? page.items.slice(0, CARD_POSTS).map((it) => ({ code: it.code, thumb: smallThumb(it.thumbs) }))
          : null;
        return Object.assign(c, { id, recent: nine || c.recent });
      })
      .catch(() => null);
    cards.set(user, { at: Date.now(), job });
    job.then((got) => { if (!got) cards.delete(user); });
    return job;
  }

  // The smallest of a post's pictures (largest first) that is still sharp
  // in a third of the card.
  function smallThumb(thumbs) {
    const ok = (thumbs || []).filter((t) => t.width >= 240 && t.height >= 240);
    return ((ok.length ? ok[ok.length - 1] : (thumbs || [])[0]) || {}).url || '';
  }

  function hideCard() {
    clearTimeout(fetchTimer);
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    cardLink = null;
    if (!card) return;
    if (card.matches(':popover-open')) card.hidePopover();
    card.remove();
    card = null;
  }

  async function showCard(a, user) {
    const got = await cardData(user);
    if (cardLink !== a || !a.isConnected || !got) return;
    if (card) card.remove();
    card = buildCard(got);
    // In the top layer, above the player, which is there too.
    document.body.append(card);
    if (card.showPopover) {
      card.popover = 'manual';
      card.showPopover();
    }
    placeCard(a);
  }

  function placeCard(a) {
    const r = a.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const gap = 6;
    const below = r.bottom + gap + h <= window.innerHeight || r.top - gap - h < 0;
    const top = below ? r.bottom + gap : r.top - gap - h;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    card.style.setProperty('top', `${Math.max(8, top)}px`, 'important');
    card.style.setProperty('left', `${left}px`, 'important');
  }

  function buildCard(c) {
    const href = `/${c.username}/`;
    const name = el('a', { className: 'sinsta-card-user', href }, c.username);
    const who = el('div', { className: 'sinsta-card-who' },
      el('div', { className: 'sinsta-card-line' }, name,
        c.verified ? el('span', { className: 'sinsta-card-tick', title: 'Verified' }, '✓') : ''),
      c.fullName ? el('div', { className: 'sinsta-card-name' }, c.fullName) : '',
      c.followsYou ? el('div', { className: 'sinsta-card-rel' }, c.youFollow ? 'You follow each other' : 'Follows you') : '');
    const head = el('div', { className: 'sinsta-card-head' },
      el('a', { className: 'sinsta-card-pic', href }, el('img', { src: c.pic, alt: '' })), who);

    const stat = (n, label) => el('div', { className: 'sinsta-card-stat' },
      el('b', {}, n == null ? '–' : compact.format(n)), el('span', {}, label));
    const stats = el('div', { className: 'sinsta-card-stats' },
      stat(c.posts, 'posts'), stat(c.followers, 'followers'), stat(c.following, 'following'));

    const kids = [head, stats];
    if (c.recent.length) {
      kids.push(el('div', { className: 'sinsta-card-posts' }, ...c.recent.map((p) =>
        el('a', { href: `/p/${p.code}/` }, el('img', { src: p.thumb, alt: '', loading: 'lazy' })))));
    } else if (c.private && !c.youFollow) {
      kids.push(el('div', { className: 'sinsta-card-empty' }, 'This account is private'));
    } else if (c.posts === 0) {
      kids.push(el('div', { className: 'sinsta-card-empty' }, 'No posts yet'));
    }

    // Follow, or Following (which asks before unfollowing) with the star:
    // only accounts you follow can be favourites.
    const row = el('div', { className: 'sinsta-card-row' });
    const btn = el('button', { type: 'button', className: 'sinsta-card-follow', disabled: !!c.busy });
    if (c.youFollow) {
      btn.textContent = 'Following';
      btn.addEventListener('click', () => confirmUnfollow(c));
      row.append(btn, favButton(c.username));
    } else if (c.requested) {
      btn.textContent = 'Requested';
      btn.addEventListener('click', () => confirmUnfollow(c));
      row.append(btn);
    } else {
      btn.textContent = c.followsYou ? 'Follow back' : 'Follow';
      btn.classList.add('sinsta-card-primary');
      btn.addEventListener('click', () => setFollow(c, true));
      row.append(btn);
    }
    kids.push(row);

    const node = el('div', { className: 'sinsta-card', role: 'dialog' }, ...kids);
    node.dataset.user = c.username;
    // Its links go through Instagram's router, closing the player if it's
    // open, as the extension's other names do.
    node.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      hideCard();
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      if (Sinsta.surface && Sinsta.surface.leave) Sinsta.surface.leave(href);
      else go(href);
    });
    return node;
  }

  // Redraw the card in place if it's showing this account.
  function redrawCard(c) {
    if (!card || card.dataset.user !== c.username) return;
    const old = card;
    card = buildCard(c);
    card.style.cssText = old.style.cssText;
    old.replaceWith(card);
    if (card.showPopover) {
      card.popover = 'manual';
      card.showPopover();
    }
  }

  async function setFollow(c, on) {
    if (c.busy || !c.id) return;
    c.busy = true;
    redrawCard(c);
    const now = await Sinsta.follow(c.id, on);
    c.busy = false;
    if (now) {
      if (c.youFollow !== now.following && c.followers != null) c.followers += now.following ? 1 : -1;
      c.youFollow = now.following;
      c.requested = now.requested;
    }
    redrawCard(c);
    if (!now) cardNote(c, on ? "Couldn't follow. Try again." : "Couldn't unfollow. Try again.");
  }

  function cardNote(c, text) {
    if (!card || card.dataset.user !== c.username) return;
    const row = card.querySelector('.sinsta-card-row');
    if (row) favNote(row.firstChild, text);
  }

  // As Instagram's card does: "Unfollow @name?" over the page.
  let confirmBox = null;
  function confirmUnfollow(c) {
    hideCard();
    closeConfirm();
    const yes = el('button', { type: 'button', className: 'sinsta-confirm-yes' }, c.requested ? 'Withdraw request' : 'Unfollow');
    const no = el('button', { type: 'button', className: 'sinsta-confirm-no' }, 'Cancel');
    const box = el('div', { className: 'sinsta-confirm-box', role: 'dialog' },
      el('img', { className: 'sinsta-confirm-pic', src: c.pic, alt: '' }),
      el('div', { className: 'sinsta-confirm-text' },
        c.requested ? `Withdraw your request to follow @${c.username}?` : `Unfollow @${c.username}?`),
      yes, no);
    const node = el('div', { className: 'sinsta-confirm' }, box);
    confirmBox = node;
    document.body.append(node);
    if (node.showPopover) {
      node.popover = 'manual';
      node.showPopover();
    }
    yes.focus();
    yes.addEventListener('click', () => {
      closeConfirm();
      setFollow(c, false);
    });
    no.addEventListener('click', closeConfirm);
    node.addEventListener('click', (e) => {
      if (e.target === node) closeConfirm();
    });
  }
  function closeConfirm() {
    if (!confirmBox) return;
    confirmBox.remove();
    confirmBox = null;
  }
  // Escape closes it, before the player (which would close) hears the key.
  window.addEventListener('keydown', (e) => {
    if (!confirmBox) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeConfirm();
    } else {
      // Keys press its buttons, not the player's behind it.
      e.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('mouseover', (e) => {
    const t = e.target;
    if (card && card.contains(t)) {
      clearTimeout(hideTimer);
      return;
    }
    const a = t.closest ? t.closest('a[href]') : null;
    const user = cardUser(a);
    if (user && a === cardLink) {
      clearTimeout(hideTimer);
      return;
    }
    if (user) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (card) hideCard();
      cardLink = a;
      // Start fetching while the pointer rests, unless that means fetching
      // a whole profile page for the id (a name in a caption, say).
      clearTimeout(fetchTimer);
      if (userIds.has(user)) fetchTimer = setTimeout(() => cardData(user), CARD_FETCH_MS);
      showTimer = setTimeout(() => showCard(a, user), CARD_SHOW_MS);
      return;
    }
    if (!cardLink) return;
    clearTimeout(fetchTimer);
    clearTimeout(showTimer);
    if (!card) {
      cardLink = null;
      return;
    }
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCard, CARD_HIDE_MS);
  }, true);
  window.addEventListener('scroll', (e) => {
    if (card && !card.contains(e.target)) hideCard();
  }, true);
  document.addEventListener('click', (e) => {
    if (cardLink && !(card && card.contains(e.target))) hideCard();
  }, true);
  window.addEventListener('popstate', hideCard);
  // The player reuses its name link from post to post as keys move it on.
  document.addEventListener('keydown', () => { if (cardLink) hideCard(); }, true);

  function ensureSavedItem() {
    const home = document.querySelector('svg[aria-label="Home"]');
    let item = home && home.closest('a');
    while (item && item.parentElement && item.parentElement.childElementCount < 6) item = item.parentElement;
    const menu = item && item.parentElement;
    if (!menu || menu === document.body) return;
    const profile = [...menu.children].find((c) => c !== savedItem && c.querySelector('a[href] img'));
    const link = profile && profile.querySelector('a[href]');
    const user = link && (link.getAttribute('href').match(/^\/([^/]+)\/$/) || [])[1];
    if (!user) return;
    const href = `/${user}/saved/`;
    // The copy keeps the classes Profile had when it was made, but Instagram
    // changes them, for instance when the sidebar widens on hover and shows
    // its labels. So copy again whenever they change.
    const sig = [...profile.querySelectorAll('*')].map((e) => e.getAttribute('class') || '').join('|');
    if (watchedProfile !== profile) {
      profileWatch.disconnect();
      profileWatch.observe(profile, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
      watchedProfile = profile;
    }
    if (savedItem && savedItem.isConnected && savedItem.previousElementSibling === profile && savedSig === sig) {
      savedItem.querySelector('a').setAttribute('aria-current', String(nav.here().pathname === href));
      syncSavedLabel(profile);
      return;
    }
    savedSig = sig;
    if (savedItem) savedItem.remove();
    savedItem = mark(profile.cloneNode(true));
    savedItem.dataset.sinstaSaved = '';
    const a = savedItem.querySelector('a[href]');
    a.setAttribute('href', href);
    a.setAttribute('aria-label', 'Saved');
    const img = savedItem.querySelector('img');
    const svg = icon(BOOKMARK);
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('aria-label', 'Saved');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.color = 'rgb(var(--ig-primary-text))';
    if (img) img.replaceWith(svg);
    // The avatar's frame has a grey placeholder background; drop it.
    for (let e = svg.parentElement; e && e !== a; e = e.parentElement) e.style.background = 'none';
    const walker = document.createTreeWalker(savedItem, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) if (n.nodeValue.trim() === 'Profile') n.nodeValue = 'Saved';
    a.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      go(href);
    });
    profile.after(savedItem);
    syncSavedLabel(profile);
  }

  // Instagram fades the menu's labels in and out (display, opacity and a
  // slide, as inline styles it animates) when the sidebar widens and
  // narrows. A copy keeps the styles of the moment it was made, often
  // mid-fade, so mirror them from Profile's label onto Saved's: the boxes
  // between the label's text and the first one that also holds the picture.
  function syncSavedLabel(profile) {
    const label = [...profile.querySelectorAll('span')].find((n) => n.childElementCount === 0 && n.textContent.trim() === 'Profile');
    for (let e = label; e && e !== profile && !e.querySelector('img, svg'); e = e.parentElement) {
      let copy = savedItem;
      const path = [];
      for (let n = e; n !== profile; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));
      for (const i of path) copy = copy && copy.children[i];
      if (!copy) return;
      const style = e.getAttribute('style');
      if (copy.getAttribute('style') === style) continue;
      if (style === null) copy.removeAttribute('style');
      else copy.setAttribute('style', style);
    }
  }

  // ---- Carousel scrolling -------------------------------------------------

  // With the cursor over a carousel's photos, scrolling steps through its
  // slides (down or right = next) by pressing Instagram's own arrow buttons.
  // Past the last slide (or before the first) the feed scrolls as usual. A
  // trackpad (or Magic Mouse) is left alone: the carousel scrolls natively
  // under it, continuously and with momentum, and up and down moves the feed.
  // Sideways swipes past a carousel's ends don't trigger the browser's
  // swipe-back gesture.
  const WHEEL_STEP = 30; // px of scrolling per slide
  const WHEEL_MIN_GAP = 300; // ms between slides
  const WHEEL_IDLE = 180; // ms without scroll events that ends a gesture
  let wheelSum = 0;
  let wheelActed = 0;
  let wheelLast = 0;

  function carouselAt(target) {
    const article = target.closest && target.closest('article');
    if (!article || article.closest(`.${HIDE}`)) return null;
    const button = article.querySelector('button[aria-label="Next"], button[aria-label="Go back"]');
    const list = article.querySelector('ul');
    if (!button || !list) return null;
    let area = button.parentElement;
    while (area && area !== article && !area.contains(list)) area = area.parentElement;
    return area && area !== article && area.contains(target) ? area : null;
  }

  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // zoom and similar
    const area = carouselAt(e.target);
    if (!area) return;
    // Firefox reports a mouse wheel in lines and a trackpad in pixels, but only
    // to a listener that reads deltaMode before the deltas: read it first
    // (only here, so Instagram's own listeners elsewhere still get pixels).
    if (e.deltaMode === 0) {
      // Past either end, keep a sideways swipe from going back a page.
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (sideways && !area.querySelector(e.deltaX > 0 ? 'button[aria-label="Next"]' : 'button[aria-label="Go back"]')) e.preventDefault();
      return;
    }
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const dx = e.deltaX * scale;
    const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * scale;
    const sideways = Math.abs(dx) > Math.abs(dy) || (e.shiftKey && !e.deltaX);
    const delta = sideways ? dx || e.deltaY * scale : dy;
    const now = Date.now();
    const gap = now - wheelLast;
    wheelLast = now;
    // One gesture (including a trackpad's momentum tail) moves one slide.
    const locked = now - wheelActed < WHEEL_MIN_GAP || (wheelActed && gap < WHEEL_IDLE);
    if (!locked) wheelActed = 0;
    const next = area.querySelector('button[aria-label="Next"]');
    const prev = area.querySelector('button[aria-label="Go back"]');
    const button = delta > 0 ? next : prev;
    if (!locked && !button) {
      wheelSum = 0;
      if (!sideways) return; // at the end: let the feed scroll
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (locked) return;
    if (gap > WHEEL_IDLE || Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0;
    wheelSum += delta;
    if (Math.abs(wheelSum) < WHEEL_STEP) return;
    wheelSum = 0;
    wheelActed = now;
    button.click();
  }, { capture: true, passive: false });

  // Invisible posts must not autoplay.
  document.addEventListener('play', (e) => {
    const video = e.target;
    if (video.closest && video.closest(`.${HIDE}, .${TAIL}`)) {
      video.muted = true;
      video.pause();
    }
  }, true);

  // For feed.js: the bar, seen posts and favourites.
  Sinsta.home = {
    bar,
    slot,
    favNames,
    unfavved,
    hideSeen: () => !!(prefs.hideSeen && seen),
    // Seen before this visit started.
    seenBefore(code) {
      const t = seen ? seen.get(code) : undefined;
      return t !== undefined && t < visitSec();
    },
    // When a post was counted as seen (unix seconds), if it was.
    seenAt: (code) => (seen ? seen.get(code) : undefined),
    markSeen: markPostSeen,
    setSeen: setPostSeen,
    setHiddenCount,
    showSeen: () => showSeenBtn.click(),
    visitStart: () => visitStart,
  };

  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  loadState();
  window.addEventListener('load', () => setTimeout(checkBadge, 2000));
})();
