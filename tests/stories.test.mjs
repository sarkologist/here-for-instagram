// What the stories row on Following and Favourites shows, in Playwright's
// Firefox, with the extension's content scripts on a stand-in for
// instagram.com. Every request is answered here, from made-up accounts; which
// account is logged in comes from the ds_user_id cookie, as on Instagram.
//
// Usage: cd tests && npm ci && npx playwright install firefox && npm test
// EXT_SRC=dir runs the scripts from dir instead (e.g. an older version).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';

const ROOT = resolve(process.env.EXT_SRC || join(dirname(fileURLToPath(import.meta.url)), '..'));
const ORIGIN = 'https://www.instagram.com';
const NOW = Math.floor(Date.now() / 1000);

// An account's stories: `watched` ones are seen up to their latest story.
const reel = (id, username, { watched = false, ago = 3600 } = {}) => {
  const takenAt = NOW - ago;
  return {
    id, seen: watched ? takenAt : 0, latest_reel_media: takenAt,
    user: { pk: id, id, username, profile_pic_url: `${ORIGIN}/test/pic/${id}.jpg` },
    items: [{
      pk: `${id}001`, id: `${id}001`, taken_at: takenAt, media_type: 1, original_width: 1080, original_height: 1920,
      image_versions2: { candidates: [{ width: 1080, height: 1920, url: `${ORIGIN}/test/pic/${id}001.jpg` }] },
    }],
  };
};

// An account whose one story is a 4-second video.
const videoReel = (id, username) => {
  const r = reel(id, username, { ago: 300 });
  Object.assign(r.items[0], { media_type: 2, video_versions: [{ width: 90, height: 160, url: `${ORIGIN}/test/video/story.webm` }] });
  return r;
};

// What Instagram tells each logged-in account: its stories tray and its
// favourites. Tests change these as they go.
const accounts = {};
function reset() {
  accounts['111'] = {
    tray: [reel('1', 'alice', { watched: true }), reel('2', 'carol', { ago: 600 }), reel('3', 'fav_of_a', { ago: 900 })],
    favourites: ['3'],
  };
  accounts['222'] = {
    tray: [reel('4', 'dave'), reel('5', 'fav_of_b', { ago: 1200 })],
    favourites: ['5'],
  };
  accounts['333'] = { tray: [videoReel('6', 'vid')], favourites: [] };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script>window.__tokens = ['"DTSGInitialData",[],{"token":"t-dtsg"}', '"LSD",[],{"token":"t-lsd"}', '"device_id":"t-device"'];</script>
<link rel="stylesheet" href="/test/ext/content.css">
<script src="/test/ext/stories.js"></script><script src="/test/ext/content.js"></script><script src="/test/ext/reels.js"></script>
</head><body><main><div><div class="col"><article><a href="/p/Dtest0001/">post</a></article></div></div></main></body></html>`;

let browser;
let context;
let page;

before(async () => {
  browser = await firefox.launch();
});
after(() => browser && browser.close());

async function freshContext() {
  if (context) await context.close();
  reset();
  context = await browser.newContext();
  page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const me = ((await req.allHeaders()).cookie || '').match(/(?:^|; )ds_user_id=(\d+)/)?.[1];
    const acc = accounts[me];
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: PAGE });
    const ext = path.match(/^\/test\/ext\/([\w.]+)$/);
    if (ext) return route.fulfill({ contentType: ext[1].endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(join(ROOT, ext[1])) });
    if (path === '/test/video/story.webm') {
      return route.fulfill({ contentType: 'video/webm', body: readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/story.webm')) });
    }
    if (!acc) return route.fulfill({ status: 401, body: '' });
    if (path === '/api/v1/feed/reels_tray/') return json({ tray: acc.tray });
    if (path === '/api/v1/friendships/feed_favorites/') {
      const all = Object.values(accounts).flatMap((a) => a.tray);
      return json({ users: acc.favourites.map((id) => all.find((r) => r.id === id).user) });
    }
    if (path === '/api/graphql' || path === '/graphql/query') {
      const vars = JSON.parse(new URLSearchParams(req.postData() || '').get('variables') || '{}');
      if (vars.reel_ids_arr) {
        const reels = vars.reel_ids_arr.map((id) => acc.tray.find((r) => r.id === id)).filter(Boolean);
        return json({ data: { xdt_api__v1__feed__reels_media: { reels_media: reels } } });
      }
      return json({ data: null });
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

async function logIn(id) {
  await context.addCookies([{ name: 'ds_user_id', value: id, domain: 'www.instagram.com', path: '/', secure: true }]);
}

// The usernames in the stories row once it has settled, watched ones marked.
async function row(view) {
  await page.goto(`${ORIGIN}/?variant=${view}`);
  const read = () => page.evaluate(() => [...document.querySelectorAll('.sinsta-story')]
    .map((a) => a.title + (a.classList.contains('sinsta-seen') ? ' (watched)' : '')));
  let last = null;
  let stableSince = Date.now();
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const now = await read();
    if (JSON.stringify(now) !== JSON.stringify(last)) {
      last = now;
      stableSince = Date.now();
    } else if (now.length && Date.now() - stableSince > 400) break;
    await page.waitForTimeout(50);
  }
  return last;
}

test('Following: unwatched first, then watched, favourites left out', async () => {
  await freshContext();
  await logIn('111');
  assert.deepEqual(await row('following'), ['carol', 'alice (watched)']);
});

test('Favourites: only the favourites', async () => {
  await freshContext();
  await logIn('111');
  assert.deepEqual(await row('favorites'), ['fav_of_a']);
});

test('Following keeps a watched account after the tray drops it', async () => {
  await freshContext();
  await logIn('111');
  await row('following');
  accounts['111'].tray = accounts['111'].tray.filter((r) => r.username !== 'alice');
  assert.deepEqual(await row('following'), ['carol', 'alice (watched)']);
});

test('Switching accounts: each sees only its own stories', async () => {
  await freshContext();
  await logIn('111');
  assert.deepEqual(await row('following'), ['carol', 'alice (watched)']);
  await logIn('222');
  assert.deepEqual(await row('following'), ['dave']);
  assert.deepEqual(await row('favorites'), ['fav_of_b']);
  // Back on the first account, its remembered watched account is still there.
  accounts['111'].tray = accounts['111'].tray.filter((r) => r.username !== 'alice');
  await logIn('111');
  assert.deepEqual(await row('following'), ['carol', 'alice (watched)']);
});

test('Video story: seekbar and playback speed', async () => {
  await freshContext();
  await logIn('333');
  assert.deepEqual(await row('following'), ['vid']);
  await page.click('.sinsta-story');
  const clock = page.locator('#sinsta-viewer .sinsta-clock');
  await clock.filter({ hasText: '/ 0:04' }).waitFor();
  const speed = page.locator('#sinsta-viewer .sinsta-speed');
  const rate = () => page.evaluate(() => document.querySelector('#sinsta-viewer video').playbackRate);
  assert.equal(await speed.textContent(), '1×');
  await speed.click();
  assert.equal(await speed.textContent(), '1.25×');
  assert.equal(await rate(), 1.25);
  await page.keyboard.press('>');
  assert.equal(await rate(), 1.5);
  await page.keyboard.press('<');
  await page.keyboard.press('<');
  assert.equal(await speed.textContent(), '1×');
  // Dragging the seekbar to three quarters seeks there.
  const box = await page.locator('#sinsta-viewer .sinsta-seek').boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  const t = await page.evaluate(() => document.querySelector('#sinsta-viewer video').currentTime);
  assert.ok(t > 2.5 && t < 3.5, `seeked to ${t}`);
  // Seeking doesn't move on to another story or close the viewer.
  assert.equal(await page.locator('#sinsta-viewer').count(), 1);
  await clock.filter({ hasText: /^0:0[23] \/ 0:04$/ }).waitFor({ timeout: 1000 });
});
