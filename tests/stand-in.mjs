// A stand-in for instagram.com, in Playwright's Firefox, running the
// extension's content scripts. Every request is answered here, from made-up
// accounts; which account is logged in comes from the ds_user_id cookie, as
// on Instagram. Tests change `accounts` as they go.
//
// EXT_SRC=dir runs the scripts from dir instead (e.g. an older version).

import { before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';

const ROOT = resolve(process.env.EXT_SRC || join(dirname(fileURLToPath(import.meta.url)), '..'));
export const ORIGIN = 'https://www.instagram.com';
export const NOW = Math.floor(Date.now() / 1000);

// An account's stories: `watched` ones are seen up to their latest story.
export const reel = (id, username, { watched = false, ago = 3600 } = {}) => {
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

// A post as Instagram's feed query returns it. `following`: whether you
// follow its author (null: the feed doesn't say).
let pks = 1000;
export const media = (code, username, { following = true, ago = 3600, slides = 1, video = false, caption = '' } = {}) => {
  const pk = String(pks++);
  const pic = (n) => ({
    original_width: 1080, original_height: 1350,
    image_versions2: { candidates: [{ width: 1080, height: 1350, url: `${ORIGIN}/test/pic/${code}-${n}.jpg` }] },
    ...(video ? { video_versions: [{ url: `${ORIGIN}/test/vid/${code}.mp4` }] } : {}),
  });
  return {
    pk, id: `${pk}_1`, code, taken_at: NOW - ago, product_type: video ? 'clips' : slides > 1 ? 'carousel_container' : 'feed',
    user: {
      pk: `u-${username}`, username, profile_pic_url: `${ORIGIN}/test/pic/${username}.jpg`,
      ...(following === null ? {} : { friendship_status: { following } }),
    },
    like_count: 12, comment_count: 3, caption: caption ? { text: caption } : null,
    ...pic(0),
    ...(slides > 1 ? { carousel_media: Array.from({ length: slides }, (_, i) => pic(i)) } : {}),
  };
};
export const ad = (m) => ({ ad: true, media: m });
// A suggested post, as the home feed sends it.
export const suggested = (m) => ({ explore_story: { media: m } });

// What Instagram tells each logged-in account: its stories tray, its
// favourites and its home feeds (`feeds[variant]`: edges, newest first;
// null makes the query fail).
export const accounts = {};
function reset() {
  for (const k of Object.keys(accounts)) delete accounts[k];
  accounts['111'] = {
    tray: [reel('1', 'alice', { watched: true }), reel('2', 'carol', { ago: 600 }), reel('3', 'fav_of_a', { ago: 900 })],
    favourites: ['3'],
    feeds: { following: null, favorites: null, home: null },
  };
  accounts['222'] = {
    tray: [reel('4', 'dave'), reel('5', 'fav_of_b', { ago: 1200 })],
    favourites: ['5'],
    feeds: { following: null, favorites: null, home: null },
  };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script>window.__tokens = ['"DTSGInitialData",[],{"token":"t-dtsg"}', '"LSD",[],{"token":"t-lsd"}', '"device_id":"t-device"'];</script>
<link rel="stylesheet" href="/test/ext/content.css">
<script src="/test/ext/stories.js"></script><script src="/test/ext/content.js"></script><script src="/test/ext/feed.js"></script>
</head><body><nav><div>${['Home', 'Reels', 'Explore', 'Messages', 'Notifications', 'Create']
  .map((n) => `<div><span><a href="${{ Home: '/', Reels: '/reels/' }[n] || `/${n.toLowerCase()}/`}"><svg aria-label="${n}"></svg>${n}</a></span></div>`).join('')}
<div><a href="/me/"><div><img src="/test/pic/me.jpg"></div><div class="label" style="display: none; opacity: 0;"><span>Profile</span></div></a></div></div></nav>
<main><div><div class="col"><article><a href="/p/Dtest0001/">post</a></article></div></div></main></body></html>`;

let browser;
let context;
export let page;

before(async () => {
  browser = await firefox.launch();
});
after(() => browser && browser.close());

// A new browser profile. `storage`: localStorage to start with (the
// extension's own storage falls back to it outside an extension).
export async function freshContext(storage = {}) {
  if (context) await context.close();
  reset();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((s) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
  }, storage);
  page = await context.newPage();
  page.on('pageerror', (e) => console.error('page error:', e));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const me = ((await req.allHeaders()).cookie || '').match(/(?:^|; )ds_user_id=(\d+)/)?.[1];
    const acc = accounts[me];
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/' || /^\/reels\//.test(path)) return route.fulfill({ contentType: 'text/html', body: PAGE });
    const ext = path.match(/^\/test\/ext\/([\w.]+)$/);
    if (ext) return route.fulfill({ contentType: ext[1].endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(join(ROOT, ext[1])) });
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
      if (vars.variant && vars.data) {
        const edges = acc.feeds[vars.variant];
        // As on Instagram: the home feed fails with a pagination source, the
        // others need theirs.
        const source = vars.data.pagination_source;
        if (!edges || (vars.variant === 'home' ? source : source !== vars.variant)) return json({ data: null });
        // Pages of 12, the cursor being the index to start at.
        const start = Number(vars.after || 0);
        const page = edges.slice(start, start + 12);
        const more = start + 12 < edges.length;
        return json({
          data: {
            xdt_api__v1__feed__timeline__connection: {
              edges: page.map((e) => (e.media || e.explore_story ? { node: e } : { node: { media: e } })),
              page_info: { has_next_page: more, end_cursor: more ? String(start + 12) : null },
            },
          },
        });
      }
      return json({ data: null });
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

export async function logIn(id) {
  await context.addCookies([{ name: 'ds_user_id', value: id, domain: 'www.instagram.com', path: '/', secure: true }]);
}

// Polls `read` until it returns the same non-empty value for a while, and
// returns that (or the last value after `ms`).
export async function settled(read, ms = 6000) {
  let last = null;
  let stableSince = Date.now();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const now = await read();
    if (JSON.stringify(now) !== JSON.stringify(last)) {
      last = now;
      stableSince = Date.now();
    } else if ((Array.isArray(now) ? now.length : now) && Date.now() - stableSince > 400) break;
    await page.waitForTimeout(50);
  }
  return last;
}
