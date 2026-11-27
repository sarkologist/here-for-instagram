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

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/story.webm');
const SONG = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/song.webm');
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

// An account whose one story is a 4-second video.
export const videoReel = (id, username) => {
  const r = reel(id, username, { ago: 300 });
  Object.assign(r.items[0], { media_type: 2, video_versions: [{ width: 90, height: 160, url: `${ORIGIN}/test/vid/story-${id}.mp4` }] });
  return r;
};

// A post as Instagram's feed query returns it. `following`: whether you
// follow its author (null: the feed doesn't say). `song`: the title of the
// song it plays, which, as on Instagram, the feed query leaves out and the
// post's own page (`posts`, by pk) has: 1s to 3s of a 4-second file.
let pks = 1000;
export const songs = {};
export const media = (code, username, { following = true, ago = 3600, slides = 1, video = false, caption = '', song = null, saved = false } = {}) => {
  const pk = String(pks++);
  if (song) {
    songs[pk] = {
      music_info: {
        music_asset_info: { title: song, display_artist: 'Band', progressive_download_url: `${ORIGIN}/test/aud/${code}.m4a` },
        music_consumption_info: { audio_asset_start_time_in_ms: 1000, overlap_duration_in_ms: 2000, should_mute_audio: false },
      },
    };
  }
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
    like_count: 12, comment_count: 3, caption: caption ? { text: caption } : null, has_viewer_saved: saved,
    ...pic(0),
    ...(slides > 1 ? { carousel_media: Array.from({ length: slides }, (_, i) => pic(i)) } : {}),
  };
};
export const ad = (m) => ({ ad: true, media: m });
// A suggested post, as the home feed sends it.
export const suggested = (m) => ({ explore_story: { media: m } });

// What Instagram tells each logged-in account: its stories tray, its
// favourites, its home feeds (`feeds[variant]`: edges, newest first;
// null makes the query fail) and Explore's grid (`explore`: media, or
// { ad: media }; null fails).
export const accounts = {};
export const songLookups = []; // pks of the posts asked for their song
// Saving: { doc, input } of each save, unsave, add-to-collection and
// new-collection mutation, in order.
export const saveCalls = [];
export const queryLog = [];
export const requestLog = []; // every request to Instagram's API: { path, at }
// Following: { kind: 'follow' | 'unfollow', id } of each mutation, and
// whom each account follows now, by user id, where that changed.
export const followCalls = [];
const FOLLOW_DOCS = { '30480713304862233': 'follow', '25174972798866458': 'unfollow' };
const SAVE_DOCS = {
  '27365486596441074': 'save', '27371251859134880': 'unsave', '39663440886576281': 'add', '27305499509043563': 'new',
};
// Who has seen each of your own stories (by pk): { username, liked, reply }.
export const storyViewers = {};
function reset() {
  songLookups.length = 0;
  saveCalls.length = 0;
  queryLog.length = 0;
  requestLog.length = 0;
  followCalls.length = 0;
  for (const k of Object.keys(storyViewers)) delete storyViewers[k];
  for (const k of Object.keys(accounts)) delete accounts[k];
  accounts['111'] = {
    tray: [reel('1', 'alice', { watched: true }), reel('2', 'carol', { ago: 600 }), reel('3', 'fav_of_a', { ago: 900 })],
    favourites: ['3'],
    feeds: { following: null, favorites: null, home: null },
    explore: null,
    collections: [{ id: 'c1', name: 'trips' }, { id: 'c2', name: 'recipes' }],
  };
  accounts['222'] = {
    tray: [reel('4', 'dave'), reel('5', 'fav_of_b', { ago: 1200 })],
    favourites: ['5'],
    feeds: { following: null, favorites: null, home: null },
  };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script>window.__tokens = ['"DTSGInitialData",[],{"token":"t-dtsg"}', '"LSD",[],{"token":"t-lsd"}', '"device_id":"t-device"', '"RelayAPIConfigDefaults",[],{"accessToken":"","actorID":"17841400000000001"', '"InstagramSecurityConfig",[],{"csrf_token":"t-csrf"'];</script>
<link rel="stylesheet" href="/test/ext/content.css">
<script src="/test/ext/stories.js"></script><script src="/test/ext/content.js"></script><script src="/test/ext/feed.js"></script>
</head><body><nav><div>${['Home', 'Reels', 'Explore', 'Messages', 'Notifications', 'Create']
  .map((n) => `<div><span><a href="${{ Home: '/', Reels: '/reels/' }[n] || `/${n.toLowerCase()}/`}"><svg aria-label="${n}"></svg>${n}</a></span></div>`).join('')}
<div><a href="/me/"><div><img src="/test/pic/me.jpg"></div><div class="label" style="display: none; opacity: 0;"><span>Profile</span></div></a></div></div></nav>
<main><div><div class="col"><article><a href="/p/Dtest0001/">post</a></article></div></div></main></body></html>`;

// A profile, as Instagram renders it: the header, where the picture is a
// button, not a link; the tabs (Posts on /<name>/, Reels, Tagged); and the
// Posts grid. Clicks that reach the page are counted, as Instagram's own
// handler.
const PROFILE = (id, username, tab = '') => PAGE.replace(/<main>.*<\/main>/, `<script>window.__igClicks = 0; // "profile_id":"${id}"
document.addEventListener('click', (e) => { if (e.target.closest('[role=button]')) window.__igClicks++; });</script>
<main><div class="profile"><header><section><div role="button" tabindex="0"><span role="link" tabindex="-1">
<img alt="${username}'s profile picture" src="/test/pic/${id}.jpg"></span></div></section></header>
<div class="tabs">${['', 'reels/', 'tagged/'].map((t) => `<a role="link" aria-selected="${t === tab}" href="/${username}/${t}">${t || 'posts'}</a>`).join('')}</div>
<div class="grid"><div><a href="/p/Pnative${tab ? '-' + tab.slice(0, -1) : ''}/"><img alt=""></a></div></div></div></main>`);
// Explore, as Instagram renders it: a search box above its grid. Focusing
// the box turns the page into search results, with a Back button beside
// the box, which turns it back.
const EXPLORE = PAGE.replace(/<main>.*<\/main>/, `<style>nav { position: fixed; top: 0; left: 0; width: 72px; overflow: hidden; }
main { margin-left: 72px; }</style>
<main><div>
<div class="search"><div><span class="back"></span><input type="text" placeholder="Search" aria-label="Search input"></div></div>
<div class="results" style="height: 3000px"><a href="/p/Dnative1/"><img alt=""></a></div></div>
<script>
const row = document.querySelector('.search > div');
const results = document.querySelector('.results');
row.querySelector('input').addEventListener('focus', () => {
  row.querySelector('.back').innerHTML = '<div role="button"><svg aria-label="Back"></svg></div>';
  results.innerHTML = '<div class="recent">Recent</div>';
});
row.querySelector('.back').addEventListener('click', () => {
  row.querySelector('.back').replaceChildren();
  row.querySelector('input').value = '';
  results.innerHTML = '<a href="/p/Dnative1/"><img alt=""></a>';
});
</script></main>`);

// Profiles there are pages for: alice and carol have stories, nostory doesn't.
// What their Posts tabs hold is up to each account (`posts`).
const PROFILES = { alice: '1', carol: '2', nostory: '9' };

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
    if (path === '/explore/') return route.fulfill({ contentType: 'text/html', body: EXPLORE });
    const profile = path.match(/^\/([\w.]+)\/((?:reels|tagged)\/)?$/);
    if (profile && PROFILES[profile[1]]) return route.fulfill({ contentType: 'text/html', body: PROFILE(PROFILES[profile[1]], profile[1], profile[2] || '') });
    const ext = path.match(/^\/test\/ext\/([\w.]+)$/);
    if (ext) return route.fulfill({ contentType: ext[1].endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(join(ROOT, ext[1])) });
    // Every video is the same 4 seconds (VP9: Playwright's Firefox has no H.264).
    if (path.startsWith('/test/vid/')) return route.fulfill({ contentType: 'video/webm', body: readFileSync(VIDEO) });
    // Every song the same 4 seconds of a tone.
    if (path.startsWith('/test/aud/')) return route.fulfill({ contentType: 'audio/webm', body: readFileSync(SONG) });
    if (/^\/(api|graphql)\//.test(path)) requestLog.push({ path, at: Date.now() });
    if (!acc) return route.fulfill({ status: 401, body: '' });
    const info = path.match(/^\/api\/v1\/media\/(\d+)\/info\/$/);
    if (info) {
      songLookups.push(info[1]);
      return json({ items: [{ pk: info[1], media_type: 1, music_metadata: songs[info[1]] || null }] });
    }
    if (path === '/api/v1/feed/reels_tray/') return json({ tray: acc.tray });
    const seenBy = path.match(/^\/api\/v1\/media\/(\d+)\/list_reel_media_viewer\/$/);
    if (seenBy) {
      // Pages of 20, max_id being the index to start at.
      const all = storyViewers[seenBy[1]] || [];
      const start = Number(new URL(req.url()).searchParams.get('max_id') || 0);
      const more = start + 20 < all.length;
      return json({
        total_viewer_count: all.length,
        next_max_id: more ? String(start + 20) : null,
        viewers: all.slice(start, start + 20).map((v) => ({
          user: { pk: `u-${v.username}`, username: v.username, full_name: v.username.toUpperCase(), profile_pic_url: `${ORIGIN}/test/pic/${v.username}.jpg` },
          has_liked: !!v.liked, reply_text: v.reply || '',
        })),
      });
    }
    if (path === '/api/v1/friendships/feed_favorites/') {
      const all = Object.values(accounts).flatMap((a) => a.tray);
      return json({ users: acc.favourites.map((id) => all.find((r) => r.id === id).user) });
    }
    if (path === '/api/v1/discover/web/explore_grid/') {
      if (!acc.explore) return route.fulfill({ status: 500, body: '' });
      // Pages of 6, in sections of 3, max_id being the page's number.
      const n = Number(new URL(req.url()).searchParams.get('max_id') || 0);
      const page = acc.explore.slice(n * 6, n * 6 + 6);
      const more = (n + 1) * 6 < acc.explore.length;
      const sections = [page.slice(0, 3), page.slice(3)].filter((p) => p.length).map((p) => ({
        layout_type: 'media_grid',
        layout_content: { medias: p.map((m) => (m.ad ? { media: { ...m.ad, ad_id: '1' } } : { media: m })) },
      }));
      return json({ sectional_items: sections, more_available: more, next_max_id: more ? String(n + 1) : null, rank_token: 'r' });
    }
    // Every query asked, as { path, doc } (`blocked`: the session's queries
    // all get Instagram's "Page not found" page).
    if (path === '/api/graphql' || path === '/graphql/query') {
      queryLog.push({ path, doc: new URLSearchParams(req.postData() || '').get('doc_id'), at: Date.now() });
      if (acc && acc.blocked) return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><title>Page Not Found • Instagram</title></html>' });
    }
    // Without the CSRF token (`requireCsrf`), Instagram answers queries with
    // its "Page not found" page. The page holds the token in its security
    // config; the cookie scripts can read may be missing.
    if (path === '/graphql/query' && acc.requireCsrf && (await req.allHeaders())['x-csrftoken'] !== 't-csrf') {
      return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><title>Page Not Found • Instagram</title></html>' });
    }
    if (path === '/api/graphql' || path === '/graphql/query') {
      const form = new URLSearchParams(req.postData() || '');
      const vars = JSON.parse(form.get('variables') || '{}');
      const fkind = FOLLOW_DOCS[form.get('doc_id')];
      if (fkind) {
        followCalls.push({ kind: fkind, id: vars.target_user_id });
        acc.follows = { ...acc.follows, [vars.target_user_id]: fkind === 'follow' };
        return json({ data: { [`xdt_${fkind}`]: { friendship_status: { following: fkind === 'follow', outgoing_request: false } } } });
      }
      const kind = SAVE_DOCS[form.get('doc_id')];
      if (kind) {
        saveCalls.push({ kind, input: vars.input });
        return json({ data: { [`xdt_${kind}`]: kind === 'new' ? { collection_id: 'c-new' } : { status: 'ok' } } });
      }
      if (vars.first === 20 && acc.collections) {
        // Your collections, all on one page.
        return json({
          data: {
            viewer: {
              media_collections: {
                edges: acc.collections.map((c) => ({ node: { collection_id: c.id, collection_name: c.name, cover_media: null } })),
                page_info: { has_next_page: false, end_cursor: null },
              },
            },
          },
        });
      }
      if (vars.reel_ids_arr) {
        const reels = vars.reel_ids_arr.map((id) => acc.tray.find((r) => r.id === id)).filter(Boolean);
        return json({ data: { xdt_api__v1__feed__reels_media: { reels_media: reels } } });
      }
      if (vars.userID) {
        // A name's hover card: its posts are those in the account's feeds.
        const all = Object.values(acc.feeds).flat().filter(Boolean)
          .map((e) => e.media || (e.explore_story && e.explore_story.media) || e);
        const theirs = all.filter((m) => m.user && m.user.pk === vars.userID);
        const user = theirs[0] && theirs[0].user;
        if (!user) return json({ data: null });
        const following = acc.follows && vars.userID in acc.follows ? acc.follows[vars.userID]
          : !theirs.some((m) => m.user.friendship_status && m.user.friendship_status.following === false);
        return json({
          data: {
            xig_user_by_igid_v2: {
              user_dict: {
                pk: user.pk, username: user.username, full_name: user.username.toUpperCase(), profile_pic_url: user.profile_pic_url,
                is_verified: false, is_private: false, media_count: theirs.length, follower_count: 65600, following_count: 418,
                friendship_status: { following, followed_by: false, is_feed_favorite: false },
              },
              polaris_ordered_timeline_connection: {
                edges: theirs.slice(0, 3).map((m) => ({ node: { media_dict: { code: m.code, image_versions2: m.image_versions2 } } })),
              },
            },
          },
        });
      }
      if (vars.username && vars.data) {
        // A profile's posts (`posts[username]`), in pages of 12.
        const posts = acc.posts && acc.posts[vars.username];
        if (!posts) return json({ data: null });
        const start = Number(vars.after || 0);
        const more = start + 12 < posts.length;
        return json({
          data: {
            xdt_api__v1__feed__user_timeline_graphql_connection: {
              edges: posts.slice(start, start + 12).map((m) => ({ node: m })),
              page_info: { has_next_page: more, end_cursor: more ? String(start + 12) : null },
            },
          },
        });
      }
      if (vars.variant && vars.data) {
        // The feed query ids this session accepts (`feedDocs`; all if unset).
        if (acc.feedDocs && !acc.feedDocs.includes(form.get('doc_id'))) {
          return json({ errors: [{ message: 'execution error', severity: 'CRITICAL' }] });
        }
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
