// Performance evals for the stories carousel.
//
// Runs the extension's own stories.js and content.css in Firefox, on an
// instagram.com origin whose requests are answered with synthetic accounts
// and stories, drives the carousel the ways people use it, and measures what
// they would see: frame pacing while things move, and how long input takes
// to show. Each scenario passes when it is below what people can perceive
// (see LIMITS).
//
//   node run.mjs                  all scenarios, 3 runs each
//   node run.mjs --runs 5 --only turn-keys,peek-scrub
//   node run.mjs --profile        also time the carousel's functions
//   node run.mjs --gecko-profile p.json   record a Firefox profiler profile
//                                 (open it at profiler.firefox.com)
//   node run.mjs --css '.sv-peek{box-shadow:none}'   A/B test a CSS override
//   node run.mjs --src DIR        stories.js and content.css from DIR (e.g. an
//                                 older version, from `git show`)
//   node run.mjs --shot deck.png  screenshot the open viewer, and stop
//   node run.mjs --display 0      put the window on display 0 (the main one)
//   node run.mjs --headless       no window (software rendering: frames far
//                                 slower than real, so only for relative use)
//   node run.mjs --save base.json  write the results; --compare base.json
//                                 compares with them
//
// The window opens on a second display if there is one (else the main one)
// and the foreground goes straight back to the app that had it. It has to
// stay visible: Firefox stops painting a window that is covered or hidden.

import { firefox } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : args[i + 1];
};
const ROOT = resolve(opt('src', join(HERE, '..'))); // where stories.js and content.css come from
const RUNS = Number(opt('runs', 3));
const ONLY = opt('only', '') ? opt('only').split(',') : null;
const HEADLESS = args.includes('--headless');
let VIEWPORT = { width: 1728, height: 1000 }; // headless; else the window's
const ACCOUNTS = Number(opt('accounts', 80));
const LATENCY_MS = Number(opt('latency', 40)); // simulated network round trip
const MBPS = Number(opt('mbps', 100)); // simulated link: responses share it, first asked first served
// What opening takes at best on that network, set once the images are known:
// the stories request, then the picture's round trip and bytes. The open
// scenario counts only the time beyond it.
let netFloorMs = 2 * LATENCY_MS;
const PROFILE = args.includes('--profile');

// --profile: time the carousel's own functions. Each is renamed and wrapped by
// a function of its own name that adds its (inclusive) time to __perf.fns.
const PROFILED = ['layoutDeck', 'renderDeck', 'fillPeek', 'placement', 'handAt', 'peekCard', 'show', 'preload', 'sizeScroller',
  'beginTurn', 'arrived', 'scrub', 'peekAt', 'unpeek', 'toReel', 'jump', 'step', 'rest', 'settle', 'clearDeck', 'openViewer',
  'renderStickers', 'loadReels', 'tick', 'syncPause', 'syncScroll', 'dropPeek', 'snap', 'mediaEl', 'storyAt'];
function instrument(src) {
  for (const name of PROFILED) {
    const re = new RegExp(`\\n(\\s*)(async )?function ${name}\\(`);
    if (!re.test(src)) throw new Error(`--profile: no function ${name}`);
    src = src.replace(re, (_, ind, async) => `\n${ind}function ${name}(...a) { return window.__perf.time('${name}', ${name}__raw, this, a); }\n${ind}${async || ''}function ${name}__raw(`);
  }
  return src;
}

// What counts as imperceptible. Frame pacing: a single late frame in smooth
// motion goes unnoticed, two in a row (a 33 ms gap at 60 Hz) is a visible
// hitch. Input: under 50 ms from event to painted feels instant.
const LIMITS = {
  p99FrameMs: 20,
  maxFrameMs: 33.4,
  p95InputMs: 50,
  maxInputMs: 100,
};

// ---- Synthetic data -------------------------------------------------------

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const NOW = Math.floor(Date.now() / 1000);

// `run` namespaces the image URLs, so each run starts with nothing cached.
function makeAccounts(run) {
  seed = 7;
  const out = [];
  for (let a = 0; a < ACCOUNTS; a++) {
    const id = String(1000 + a);
    const n = 1 + Math.floor(rand() * rand() * 14);
    const items = [];
    for (let k = 0; k < n; k++) {
      const pk = `${id}${String(k).padStart(3, '0')}`;
      const img = (w, h) => ({ width: w, height: h, url: `https://www.instagram.com/perf/img/r${run}/${pk}_${w}.jpg` });
      items.push({
        pk, id: pk, taken_at: NOW - 3600 * 20 + a * 60 + k * 600, media_type: 1,
        original_width: 1080, original_height: 1920, can_reply: true, has_liked: false,
        image_versions2: { candidates: [img(1080, 1920), img(750, 1333), img(640, 1138), img(480, 853), img(320, 569), img(240, 427)] },
      });
    }
    const seen = a % 3 === 2 ? items[items.length - 1].taken_at : a % 3 === 1 ? items[0].taken_at : 0;
    out.push({
      id, seen, latest_reel_media: items[items.length - 1].taken_at, items,
      user: { pk: id, id, username: `account_${a}`, profile_pic_url: `https://www.instagram.com/perf/img/r${run}/pic${id}_150.jpg` },
    });
  }
  return out;
}

// Image bytes: a pool of noisy JPEGs per size, drawn by the browser itself
// (once: cached in .cache/), served under unique URLs so each card decodes
// its own.
const IMAGE_CACHE = join(HERE, '.cache', 'images.json');
async function makeImages(page) {
  if (existsSync(IMAGE_CACHE)) {
    const cached = JSON.parse(readFileSync(IMAGE_CACHE, 'utf8'));
    return Object.fromEntries(Object.entries(cached).map(([w, list]) => [w, list.map((b) => Buffer.from(b, 'base64'))]));
  }
  const sizes = { 1080: [1080, 1920], 750: [750, 1333], 640: [640, 1138], 480: [480, 853], 320: [320, 569], 240: [240, 427], 150: [150, 150] };
  const pool = {};
  for (const [w, [W, H]] of Object.entries(sizes)) {
    pool[w] = await page.evaluate(async ({ W, H, count }) => {
      const out = [];
      for (let i = 0; i < count; i++) {
        const c = new OffscreenCanvas(W, H);
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, `hsl(${(i * 47) % 360} 70% 45%)`);
        grad.addColorStop(1, `hsl(${(i * 47 + 140) % 360} 60% 25%)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `hsla(${(i * 31 + k * 17) % 360} 80% 60% / 0.5)`;
          g.beginPath();
          g.arc((k * 97 % 100) / 100 * W, (k * 61 % 100) / 100 * H, W * 0.05 * (1 + (k % 4)), 0, 7);
          g.fill();
        }
        // Grain, so the JPEGs weigh about what Instagram's do (1080 px: ~250 KB).
        const d = g.getImageData(0, 0, W, H);
        for (let p = 0; p < d.data.length; p += 4) {
          const n = (Math.random() - 0.5) * 12;
          d.data[p] += n; d.data[p + 1] += n; d.data[p + 2] += n;
        }
        g.putImageData(d, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
        out.push(btoa(bin));
      }
      return out;
    }, { W, H, count: 8 });
  }
  mkdirSync(dirname(IMAGE_CACHE), { recursive: true });
  writeFileSync(IMAGE_CACHE, JSON.stringify(pool));
  return Object.fromEntries(Object.entries(pool).map(([w, list]) => [w, list.map((b) => Buffer.from(b, 'base64'))]));
}

// ---- Page -----------------------------------------------------------------

const FILES = {
  '/perf/stories.js': [join(ROOT, 'stories.js'), 'text/javascript'],
  '/perf/content.css': [join(ROOT, 'content.css'), 'text/css'],
  '/perf/probe.js': [join(HERE, 'probe.js'), 'text/javascript'],
};

// One page for the whole session (one window, so it takes the foreground only
// once); load() reloads it with the given accounts.
async function openPage(page, images) {
  let byId = new Map();
  const delay = (ms = LATENCY_MS) => new Promise((r) => setTimeout(r, ms));
  // The link: each response's bytes take their turn, in the order the
  // requests were made (so asking for something first gets it first).
  let linkFree = 0;
  const transfer = (bytes) => {
    const start = Math.max(Date.now(), linkFree);
    linkFree = start + (bytes * 8) / (MBPS * 1000);
    return delay(linkFree - Date.now());
  };
  await page.route('https://www.instagram.com/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/' || path === '/perf/') {
      return route.fulfill({ contentType: 'text/html', body: readFileSync(join(HERE, 'harness.html')) });
    }
    if (FILES[path]) {
      let body = readFileSync(FILES[path][0], 'utf8');
      if (path === '/perf/content.css' && opt('css')) body += `\n/* --css */\n${opt('css')}\n`;
      if (PROFILE && path === '/perf/stories.js') body = instrument(body);
      return route.fulfill({ contentType: FILES[path][1], body });
    }
    const img = path.match(/^\/perf\/img\/r\d+\/(\w+?)_(\d+)\.jpg$/);
    if (img) {
      const pool = images[img[2]];
      const n = [...img[1]].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0);
      const body = pool[n % pool.length];
      const sent = transfer(body.length); // queued as asked
      await delay();
      await sent;
      return route.fulfill({ contentType: 'image/jpeg', headers: { 'cache-control': 'max-age=3600' }, body });
    }
    if (path === '/api/graphql' || path === '/graphql/query') {
      const body = new URLSearchParams(route.request().postData() || '');
      const vars = JSON.parse(body.get('variables') || '{}');
      await delay();
      if (vars.reel_ids_arr) {
        const reels = vars.reel_ids_arr.map((id) => byId.get(id)).filter(Boolean);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { xdt_api__v1__feed__reels_media: { reels_media: reels } } }) });
      }
      if (vars.reelId) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { xdt_mark_story_reel_seen: true } }) });
      return route.fulfill({ contentType: 'application/json', body: '{"data":null}' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  page.load = async (accounts) => {
    byId = new Map(accounts.map((r) => [r.id, r]));
    await page.goto('https://www.instagram.com/');
    await page.waitForFunction(() => window.__perf && typeof Sinsta === 'object');
  };
  return page;
}

// The displays, in screen points with the origin at the main display's top
// left (as Firefox places windows): the area below the menu bar and above
// the Dock.
function displays() {
  try {
    const js = 'ObjC.import("AppKit"); const s = $.NSScreen.screens; const out = [];'
      + ' for (let i = 0; i < s.count; i++) { const v = s.objectAtIndex(i).visibleFrame; const f = s.objectAtIndex(i).frame;'
      + ' out.push({ x: v.origin.x, y: v.origin.y, w: v.size.width, h: v.size.height, fh: f.size.height }); } JSON.stringify(out)';
    const list = JSON.parse(execSync(`osascript -l JavaScript -e '${js}'`).toString());
    const mainH = list[0].fh;
    return list.map((d) => ({ x: d.x, y: mainH - (d.y + d.h), w: d.w, h: d.h }));
  } catch (_) {
    return [];
  }
}

// The app in front when the evals started, to give the foreground back to.
const userApp = (() => {
  try {
    return execSync('lsappinfo info -only bundleid `lsappinfo front`').toString().match(/"([^"]+)"\s*$/m)[1];
  } catch (_) {
    return null;
  }
})();
function giveBackFocus() {
  if (!userApp || HEADLESS) return;
  try {
    execSync(`osascript -e 'tell application id "${userApp}" to activate'`);
  } catch (_) {}
}

// The row's reels, as content.js hands them to the viewer.
const rowOf = (accounts) => accounts.map((r) => ({
  id: r.id, username: r.user.username, pic: r.user.profile_pic_url, seenAt: r.seen,
  latest: r.latest_reel_media, unseen: r.items.some((it) => it.taken_at > r.seen),
}));

// Opens the viewer at account `index` and waits until its story is painted.
async function openViewer(page, accounts, index) {
  const row = rowOf(accounts).map((r) => ({ ...r, unseen: false })); // play through the whole row
  return page.evaluate(async ({ row, index }) => {
    const t0 = performance.now();
    Sinsta.openViewer(row, index);
    const viewer = document.getElementById('sinsta-viewer');
    while (viewer.classList.contains('sv-loading')) await new Promise((r) => requestAnimationFrame(r));
    const ms = (await window.__perf.painted()) - t0;
    // Where the time went: the stories request, and the stage's picture.
    const res = performance.getEntriesByType('resource').filter((e) => e.startTime >= t0);
    const src = viewer.querySelector('.sv-media > img, .sv-media > video');
    const pic = src && res.find((e) => e.name === (src.currentSrc || src.src));
    const gql = res.find((e) => e.name.includes('/api/graphql'));
    const at = (x) => Math.round(x - t0);
    window.__perf.openTimeline = {
      graphql: gql && `${at(gql.startTime)}–${at(gql.responseEnd)}`,
      picture: pic && `${at(pic.startTime)}–${at(pic.responseEnd)}`,
      requests: res.length,
      painted: Math.round(ms),
    };
    return ms;
  }, { row, index });
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);
const record = (page) => page.evaluate(() => window.__perf.start());
const stop = (page) => page.evaluate(() => window.__perf.stop());
const centre = () => ({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });

// Where the card `off` places from the stage is, on screen.
async function cardPoint(page, off) {
  return page.evaluate((off) => {
    const stage = document.querySelector('.sv-stage').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.sv-peek:not(.sv-peek-off):not(.sv-peek-centre)')]
      .map((c) => ({ c, r: c.getBoundingClientRect() }))
      .filter(({ r }) => (off > 0 ? r.right > stage.right + 4 : r.left < stage.left - 4))
      .sort((a, b) => (off > 0 ? a.r.right - b.r.right : b.r.left - a.r.left));
    const hit = cards[Math.abs(off) - 1];
    if (!hit) return null;
    // The part of it that shows: beyond the card on top of it.
    const over = Math.abs(off) === 1 ? stage : cards[Math.abs(off) - 2].r;
    const a = off > 0 ? Math.max(hit.r.left, over.right) : hit.r.left;
    const b = off > 0 ? hit.r.right : Math.min(hit.r.right, over.left);
    return { x: (a + b) / 2, y: (hit.r.top + hit.r.bottom) / 2, a, b };
  }, off);
}

// ---- Scenarios ------------------------------------------------------------

const SCENARIOS = {
  // Opening the viewer: story painted, deck laid out.
  async open(page, accounts) {
    await record(page);
    const ms = await openViewer(page, accounts, 10);
    await settle(page, 900);
    const out = await stop(page);
    out.inputs.push({ type: 'open', ms: ms - netFloorMs });
    out.did = { ...out.did, ...(await page.evaluate(() => window.__perf.openTimeline)) };
    return out;
  },

  // Next and previous account by keyboard: the carousel turns.
  async 'turn-keys'(page, accounts) {
    await openViewer(page, accounts, 10);
    await settle(page);
    await record(page);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(i < 4 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
      await page.waitForTimeout(550);
    }
    return stop(page);
  },

  // Clicking a neighbour card two places away.
  async 'turn-click'(page, accounts) {
    await openViewer(page, accounts, 10);
    await settle(page);
    await record(page);
    for (let i = 0; i < 4; i++) {
      const p = await cardPoint(page, i % 2 ? -2 : 2);
      if (p) await page.mouse.click(p.x, p.y);
      await page.mouse.move(centre().x, 20);
      await page.waitForTimeout(600);
    }
    return stop(page);
  },

  // Through an account's stories: the stage swaps its picture.
  async 'step-keys'(page, accounts) {
    const k = accounts.findIndex((r) => r.items.length >= 8 && !r.seen);
    await openViewer(page, accounts, k);
    await settle(page);
    await record(page);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press(i < 6 ? 'ArrowRight' : 'ArrowLeft');
      await page.waitForTimeout(250);
    }
    return stop(page);
  },

  // Hover onto the cards on the right, one after another, then scrub across
  // one; then the same on the left.
  async 'peek-scrub'(page, accounts) {
    await openViewer(page, accounts, 20);
    await settle(page);
    await page.mouse.move(centre().x, centre().y);
    await page.mouse.move(centre().x + 5, centre().y + 5);
    await record(page);
    for (const side of [1, -1]) {
      for (let off = 1; off <= 4; off++) {
        const p = await cardPoint(page, side * off);
        if (!p) break;
        await page.mouse.move(p.x, p.y, { steps: 8 });
        await page.waitForTimeout(350);
      }
      const p = await cardPoint(page, side * 2);
      if (p) {
        await page.mouse.move(p.a + 2, p.y, { steps: 6 });
        await page.mouse.move(p.b - 2, p.y, { steps: 40 });
        await page.waitForTimeout(300);
      }
      await page.mouse.move(centre().x, centre().y, { steps: 10 });
      await page.waitForTimeout(400);
    }
    return stop(page);
  },

  // A trackpad swipe across ~8 accounts, and back. Synthetic wheel events
  // have no gesture phases, so Firefox snaps after each one; a real swipe
  // scrolls freely with momentum and snaps once it ends. So: scroll the
  // viewer frame by frame with snapping off, decelerating, then let it snap.
  async 'trackpad-swipe'(page, accounts) {
    await openViewer(page, accounts, 10);
    await settle(page);
    await page.mouse.move(centre().x, centre().y);
    await record(page);
    for (const sign of [1, -1]) {
      await page.evaluate(async (sign) => {
        const root = document.getElementById('sinsta-viewer');
        const stops = root.querySelectorAll('.sv-stop');
        const unit = stops[1].offsetLeft - stops[0].offsetLeft;
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        // Each scroll step ends a programmatic scroll, but a swipe ends only
        // once its momentum does: hold scrollend back until then.
        const hold = (e) => e.stopImmediatePropagation();
        window.addEventListener('scrollend', hold, true);
        root.style.scrollSnapType = 'none';
        // Momentum: px per 16.7 ms, decaying, adding up to ~7.5 accounts.
        const decay = 0.95;
        let v = (7.5 * unit * (1 - decay));
        let last = await frame();
        while (v > 0.3) {
          const t = await frame();
          const k = (t - last) / 16.7;
          last = t;
          root.scrollLeft += sign * v * k;
          v *= decay ** k;
        }
        window.removeEventListener('scrollend', hold, true);
        root.style.scrollSnapType = ''; // snaps, then ends
      }, sign);
      await page.waitForTimeout(1000);
    }
    return stop(page);
  },

  // A mouse wheel: notches in lines (as Firefox reports a wheel), smooth
  // scrolling between them, settling on an account.
  async 'wheel-notches'(page, accounts) {
    await openViewer(page, accounts, 10);
    await settle(page);
    await record(page);
    for (const sign of [1, 1, 1, 1, 1, -1, -1, -1]) {
      await page.evaluate((sign) => {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: sign * 3, deltaMode: 1, bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
      }, sign);
      await page.waitForTimeout(90);
    }
    await page.waitForTimeout(1200);
    return stop(page);
  },
};

// ---- Stats ----------------------------------------------------------------

const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function frameStats(frames, vsync, work = []) {
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  let run = 0;
  let worstRun = 0;
  let dropped = 0;
  const worst = gaps.indexOf(Math.max(...gaps));
  for (const g of gaps) {
    const missed = Math.max(0, Math.round(g / vsync) - 1);
    dropped += missed;
    run = missed ? run + missed : 0;
    worstRun = Math.max(worstRun, run, missed);
  }
  return {
    frames: gaps.length,
    p50: quantile(gaps, 0.5),
    p99: quantile(gaps, 0.99),
    max: Math.max(0, ...gaps),
    dropped,
    worstRun,
    maxAt: worst >= 0 ? Math.round(frames[worst] - frames[0]) : null, // ms into the recording
    // Main-thread rendering work in the frames around the worst one.
    maxWork: worst >= 0 ? work.slice(Math.max(0, worst - 1), worst + 2).map((w) => Math.round(w || 0)).join('/') : '',
  };
}

const fmt = (x) => (x == null ? '-' : x.toFixed(1));

async function main() {
  // A fresh profile whose saved window position puts the window on the
  // chosen display, filling it.
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'here-perf-'));
  const screens = displays();
  const at = screens[Number(opt('display', screens.length > 1 ? 1 : 0))];
  if (at && !HEADLESS) {
    // A little inside the screen's edges: filling it exactly, macOS keeps
    // adjusting the window, which resizes the page mid-run.
    const w = Math.min(at.w - 40, 1760);
    const h = Math.min(at.h - 40, 1040);
    const win = { screenX: String(at.x + 20), screenY: String(at.y + 20), width: String(w), height: String(h), sizemode: 'normal' };
    writeFileSync(join(profile, 'xulstore.json'), JSON.stringify({ 'chrome://browser/content/browser.xhtml': { 'main-window': win } }));
    if (screens.length < 2) console.log('One display: keep the Firefox window uncovered while this runs.');
  }
  const geckoProfile = opt('gecko-profile');
  const context = await firefox.launchPersistentContext(profile, {
    headless: HEADLESS,
    env: geckoProfile ? {
      ...process.env,
      MOZ_PROFILER_STARTUP: '1',
      MOZ_PROFILER_SHUTDOWN: resolve(geckoProfile),
      MOZ_PROFILER_STARTUP_ENTRIES: '50000000',
      MOZ_PROFILER_STARTUP_INTERVAL: '1',
      MOZ_PROFILER_STARTUP_FEATURES: 'js,stackwalk,cpu,markersallthreads',
      MOZ_PROFILER_STARTUP_FILTERS: 'GeckoMain,Compositor,Renderer,RenderBackend,SceneBuilder,WRWorker,ImgDecoder,ImageIO,DOM Worker',
    } : undefined,
    viewport: HEADLESS ? VIEWPORT : null,
    deviceScaleFactor: HEADLESS ? 2 : undefined,
    // Not raised in front of the user's windows.
    ignoreDefaultArgs: ['-foreground'],
    firefoxUserPrefs: {
      // As in a normal Firefox: no frame-rate cap from automation, smooth scrolling on.
      'general.smoothScroll': true,
      'layout.frame_rate': -1,
      // Sub-millisecond performance.now(), for --profile.
      'privacy.reduceTimerPrecision': false,
    },
  });
  // One window for everything.
  const page = context.pages()[0] || await context.newPage();
  giveBackFocus();
  VIEWPORT = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (!existsSync(IMAGE_CACHE)) console.log('Drawing test images (once)…');
  const images = await makeImages(page);
  await openPage(page, images);
  const pictureBytes = images[1080].reduce((a, b) => a + b.length, 0) / images[1080].length;
  netFloorMs = 2 * LATENCY_MS + (pictureBytes * 8) / (MBPS * 1000);
  let run = 0;

  // The display's frame interval, from an idle page.
  await page.load(makeAccounts(run++));
  await record(page);
  await page.waitForTimeout(1500);
  const idle = await stop(page);
  const vsync = frameStats(idle.frames, 1).p50;
  console.log(`Frame interval ${vsync.toFixed(2)} ms (${(1000 / vsync).toFixed(0)} Hz); ${HEADLESS ? 'headless' : 'headed'}, ${VIEWPORT.width}x${VIEWPORT.height} @${await page.evaluate(() => devicePixelRatio)}x, ${ACCOUNTS} accounts\n`);

  if (opt('shot')) {
    const accounts = makeAccounts(run++);
    await page.load(accounts);
    await openViewer(page, accounts, 10);
    await settle(page, 1200);
    await page.screenshot({ path: opt('shot') });
    await context.close();
    rmSync(profile, { recursive: true, force: true });
    return;
  }

  // Warm-up, unrecorded: a fresh profile compiles its GPU shaders and loads
  // fonts on first use, which an everyday Firefox has long done (shaders
  // are cached on disk). Pages still reload before each run, so the
  // extension's script starts cold every time.
  {
    const accounts = makeAccounts(run++);
    await page.load(accounts);
    await SCENARIOS['turn-keys'](page, accounts);
    await SCENARIOS['trackpad-swipe'](page, accounts);
  }

  const results = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const accounts = makeAccounts(run++);
      await page.load(accounts);
      await page.mouse.move(VIEWPORT.width / 2, 20);
      const out = await scenario(page, accounts);
      runs.push({ ...frameStats(out.frames, vsync, out.work), inputs: out.inputs.map((x) => x.ms), did: out.did, fns: out.fns });
    }
    const inputs = runs.flatMap((r) => r.inputs);
    // Across runs: the median run's p99, the worst frame of any.
    results[name] = {
      p50: quantile(runs.map((r) => r.p50), 0.5),
      p99: quantile(runs.map((r) => r.p99), 0.5),
      max: Math.max(...runs.map((r) => r.max)),
      dropped: quantile(runs.map((r) => r.dropped), 0.5),
      worstRun: Math.max(...runs.map((r) => r.worstRun)),
      inputP95: inputs.length ? quantile(inputs, 0.95) : null,
      inputMax: inputs.length ? Math.max(...inputs) : null,
      runs,
    };
    const r = results[name];
    r.pass = r.p99 <= LIMITS.p99FrameMs && r.max <= LIMITS.maxFrameMs
      && (r.inputP95 == null || (r.inputP95 <= LIMITS.p95InputMs && r.inputMax <= LIMITS.maxInputMs));
    const did = Object.entries({ ...runs[0].did, maxAt: runs.map((x) => `${Math.round(x.max)}@${x.maxAt}(${x.maxWork})`).join(' ') }).map(([k, v]) => `${k} ${v}`).join(', ');
    if (PROFILE) {
      const fns = {};
      for (const run of runs) {
        for (const [f, x] of Object.entries(run.fns || {})) {
          const t = (fns[f] = fns[f] || { total: 0, n: 0, max: 0 });
          t.total += x.total / runs.length;
          t.n += x.n / runs.length;
          t.max = Math.max(t.max, x.max);
        }
      }
      const top = Object.entries(fns).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
      console.log(`      ${name}: ${top.map(([f, x]) => `${f} ${x.total.toFixed(0)}ms/${Math.round(x.n)} (max ${x.max.toFixed(1)})`).join(', ')}`);
    }
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name.padEnd(15)} frames p50 ${fmt(r.p50)}  p99 ${fmt(r.p99)}  max ${fmt(r.max)} ms  dropped ${r.dropped} (worst run ${r.worstRun})  input p95 ${fmt(r.inputP95)}  max ${fmt(r.inputMax)} ms  [${did}]`);
  }
  await context.close();
  rmSync(profile, { recursive: true, force: true });

  const compare = opt('compare');
  if (compare) {
    const base = JSON.parse(readFileSync(compare, 'utf8'));
    console.log(`\nvs ${compare}:`);
    for (const [name, r] of Object.entries(results)) {
      const b = base.results[name];
      if (!b) continue;
      const d = (k) => `${k} ${fmt(b[k])}→${fmt(r[k])}`;
      console.log(`  ${name.padEnd(15)} ${d('p99')}  ${d('max')}  ${d('inputP95')}  ${d('inputMax')}`);
    }
  }
  const save = opt('save');
  if (save) writeFileSync(save, JSON.stringify({ vsync, limits: LIMITS, results }, null, 2));
  const failed = Object.values(results).filter((r) => !r.pass).length;
  console.log(`\n${failed ? `${failed} scenario(s) above the limits` : 'All scenarios imperceptible'} (p99 frame ≤ ${LIMITS.p99FrameMs} ms, max ≤ ${LIMITS.maxFrameMs} ms, input p95 ≤ ${LIMITS.p95InputMs} ms, max ≤ ${LIMITS.maxInputMs} ms)`);
  process.exitCode = failed ? 1 : 0;
}

main();
