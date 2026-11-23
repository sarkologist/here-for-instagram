// Feed scenarios for run.mjs: loading and filtering posts in Algo, Following
// and Favourites, on the stand-in feed in feed-app.js.

const PAGE = 8; // posts per page
const PAGES = 20; // per view
const HISTORY = 20000; // posts in the seen history (60 days of heavy use)
const FAVS = 15; // favourites among the 60 followed accounts

// The views' posts. Following has everyone followed, favourites included
// (the extension takes them out); Favourites only them; Algo about half
// suggestions, a tenth ads, the rest from followed accounts. About a third
// are videos, never the first three.
function makePosts(run, view) {
  const out = [];
  for (let n = 0; n < PAGE * PAGES; n++) {
    const id = `D${{ following: 'f', favorites: 'v', algo: 'a' }[view]}${String(run).padStart(3, '0')}${String(n).padStart(6, '0')}`;
    let user;
    let kind = 'followed';
    if (view === 'favorites') user = `account_${n % FAVS}`;
    else if (view === 'following') user = n % 4 === 1 ? `account_${n % FAVS}` : `account_${FAVS + (n % 45)}`;
    else if (n % 10 < 5) [user, kind] = [`sugg_${n % 37}`, 'suggested'];
    else if (n % 10 === 9) [user, kind] = [`brand_${n % 7}`, 'ad'];
    else user = `account_${FAVS + (n % 45)}`;
    const video = n >= 3 && n % 3 === 2;
    out.push({
      id, user, kind,
      pic: `/perf/img/r${run}/pic${user}_150.jpg`,
      picture: `/perf/img/r${run}/post${id}_1080.jpg`,
      ...(video ? { video: `/perf/vid/r${run}/post${id}.mp4` } : {}),
      likes: 100 + ((n * 7919) % 40000),
      caption: `Caption for post ${n}, with a few words about it and a hashtag or two #perf #harness`,
      comments: 3 + (n % 90),
      ago: `${1 + (n % 23)}h`,
    });
  }
  return out;
}

// What the extension finds in its storage: a seen history, the posts given
// by `seen` among them (seen before this visit), and its preferences.
function makeStore(posts, seen, view, now) {
  const history = {};
  for (let i = 0; i < HISTORY; i++) history[`C${i.toString(36).padStart(10, '0')}`] = now - 3600 - i * 250;
  for (const v of Object.values(posts)) v.forEach((p, n) => seen(n, v) && (history[p.id] = now - 600));
  return { 'sinsta-seen': history, 'sinsta-prefs': { hideSeen: true, lastView: view }, 'sinsta-seen-reels': {} };
}

// browser.storage.local as the extension sees it: asynchronous, and every
// value structured-cloned on the way in and out.
// (The stored data comes from /perf/store.json, so the page doesn't parse
// it as script: the browser keeps it outside the page.)
export const storageScript = `window.browser = { storage: { local: (() => {
  let data = null;
  const load = () => data || (data = fetch('/perf/store.json').then((r) => r.json()));
  return {
    async get(keys) {
      const all = await load();
      if (keys == null) return structuredClone(all);
      const out = {};
      for (const k of [].concat(keys)) if (k in all) out[k] = structuredClone(all[k]);
      return out;
    },
    async set(obj) {
      const copy = structuredClone(obj);
      Object.assign(await load(), copy);
    },
  };
})() } };\n`;

export function makeFeed(run, view, seen, now) {
  const posts = { following: makePosts(run, 'following'), favorites: makePosts(run, 'favorites'), algo: makePosts(run, 'algo') };
  return {
    view,
    store: makeStore(posts, seen, view, now),
    page: (v, k) => ({ posts: (posts[v] || []).slice(k * PAGE, (k + 1) * PAGE), more: (k + 1) * PAGE < PAGE * PAGES }),
    favourites: Array.from({ length: FAVS }, (_, i) => ({ pk: String(1000 + i), username: `account_${i}` })),
  };
}

// h: the harness's helpers (record, stop, settle, viewport, routeMs).
export function feedScenarios(h) {
  // Loads `view` with the given posts seen, and waits until its first
  // visible post shows. The probe watches for that from navigation start.
  async function open(page, run, view, seen, recordLoad = false, bare = false) {
    await page.loadFeed(makeFeed(run, view, seen, h.now), bare);
    if (recordLoad) await h.record(page);
    await shown(page);
  }

  const shown = (page) => page.waitForFunction(() => window.__perf.feed && window.__perf.feed.shown, null, { timeout: 60000 });

  // How long the first visible post took to show beyond the network: less
  // the page itself (when opening), the view's feed requests, and the
  // post's picture, each with what a request through the harness costs.
  async function overhead(page) {
    const { origin, feed } = await page.evaluate(() => ({ origin: performance.timeOrigin, feed: window.__perf.feed }));
    const t0 = origin + feed.t0;
    const t1 = origin + feed.shown.at;
    const src = new URL(feed.shown.src).pathname;
    const net = page.netlog.filter((x) => x.asked >= t0 - 2 && x.done <= t1
      && ((x.kind === 'feed' && x.view === feed.view) || x.kind === 'doc' || (x.kind === 'img' && x.path === src)));
    const floor = net.reduce((a, x) => a + (x.done - x.asked) + h.routeMs(), 0) + (feed.t0 === 0 ? h.routeMs() : 0); // + the scripts
    // Where the rest went: the waits between one request ending and the next
    // starting, and from the picture to the post showing.
    let at = t0;
    const gaps = [];
    for (const x of net) {
      gaps.push(`${x.kind[0]}${Math.round(x.asked - at)}`);
      at = x.done;
    }
    gaps.push(`s${Math.round(t1 - at)}`);
    return { ms: t1 - t0 - floor, pages: net.filter((x) => x.kind === 'feed').length, total: Math.round(t1 - t0), gaps: gaps.join(' ') };
  }

  // A trackpad flick down the feed: scrolled frame by frame, decelerating,
  // about `px` in all.
  const flick = (page, px) => page.evaluate(async (px) => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const decay = 0.96;
    let v = px * (1 - decay);
    let last = await frame();
    while (v > 0.3) {
      const t = await frame();
      const k = (t - last) / 16.7;
      last = t;
      window.scrollBy(0, v * k);
      v *= decay ** k;
    }
  }, px);

  async function scrollThrough(page) {
    for (let i = 0; i < 4; i++) {
      await flick(page, 3500);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(800);
  }

  // Loads, for run.mjs to judge: per page of posts each took (Instagram's
  // pages take seconds each, and a few tens of ms more over several of them
  // goes unnoticed).
  const withLoad = async (page, out, loads) => {
    out.loads = loads.map((o) => ({ ms: o.ms / Math.max(1, o.pages), about: `${Math.round(o.ms)}ms of ${o.total} (${o.pages} pages; waits ${o.gaps})` }));
    return out;
  };

  const scenarios = {
    // Opening Following: three new posts, then a mix of seen and new.
    async 'feed-open'(page, run, bare) {
      await open(page, run, 'following', (n) => n >= 3 && n % 2 === 0, true, bare);
      await h.settle(page, 1500);
      return withLoad(page, await h.stop(page), [await overhead(page)]);
    },

    // Opening Following after three pages of posts already seen: the
    // extension has Instagram load on until it finds new ones.
    async 'feed-skip'(page, run) {
      await open(page, run, 'following', (n) => n < 3 * PAGE, true);
      await h.settle(page, 1000);
      return withLoad(page, await h.stop(page), [await overhead(page)]);
    },

    // Trackpad flicks down Following, a third of it seen, with pages
    // loading on the way.
    async 'feed-scroll'(page, run) {
      await open(page, run, 'following', (n) => n % 3 === 0);
      await h.settle(page, 500);
      await h.record(page);
      await scrollThrough(page);
      return h.stop(page);
    },

    // The same in Algo, which keeps only suggestions.
    async 'feed-algo'(page, run) {
      await open(page, run, 'algo', () => false);
      await h.settle(page, 500);
      await h.record(page);
      await scrollThrough(page);
      return h.stop(page);
    },

    // A mouse wheel down Following: notches, smooth-scrolled by Firefox.
    async 'feed-wheel'(page, run) {
      await open(page, run, 'following', (n) => n % 3 === 0);
      await h.settle(page, 500);
      const vp = h.viewport();
      await page.mouse.move(vp.width / 2 + 100, vp.height / 2);
      await h.record(page);
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(90);
      }
      await page.waitForTimeout(1000);
      return h.stop(page);
    },

    // "Hide seen" off and on again.
    async 'toggle-seen'(page, run) {
      if (h.bare) return null; // no toggle without the extension
      await open(page, run, 'following', (n) => n % 3 === 0);
      await h.settle(page, 800);
      await h.record(page);
      for (let i = 0; i < 2; i++) {
        await page.click('.sinsta-toggle');
        await page.waitForTimeout(1200);
      }
      return h.stop(page);
    },

    // Following to Favourites and back, by the switcher's tabs.
    async 'switch-view'(page, run, bare) {
      await open(page, run, 'following', (n) => n % 3 === 0, false, bare);
      await h.settle(page, 800);
      await h.record(page);
      const loads = [];
      for (const view of ['favorites', 'following']) {
        await page.evaluate((view) => window.__perf.watchFeed(view), view);
        const tab = `.sinsta-tab[data-view="${view}"]`;
        if (await page.$(tab)) await page.click(tab);
        else await page.evaluate((view) => { // without the extension: as the tab would
          window.__perf.feed.t0 = performance.now();
          history.pushState({}, '', `/?variant=${view}`);
          dispatchEvent(new PopStateEvent('popstate'));
        }, view);
        await shown(page);
        loads.push(await overhead(page));
        await h.settle(page, 800);
      }
      return withLoad(page, await h.stop(page), loads);
    },
  };
  // These are judged by what the extension adds to the feed's own time,
  // from the same load without it (feed-skip can't load without it).
  scenarios['feed-open'].reference = true;
  scenarios['switch-view'].reference = true;
  return scenarios;
}
