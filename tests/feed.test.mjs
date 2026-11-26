// What Home's views and Reels show when the extension draws them (feed.js),
// on the stand-in for instagram.com (stand-in.mjs).
//
// Usage: cd tests && npm ci && npx playwright install firefox && npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, NOW, accounts, media, ad, suggested, page, freshContext, logIn, settled, songLookups } from './stand-in.mjs';

const LIST = { 'sinsta-surface': { layout: 'list' } };
const GRID = { 'sinsta-surface': { layout: 'grid', cols: { following: 3 } } };

function feeds111() {
  accounts['111'].feeds.following = [
    media('Calice1', 'alice', { ago: 100, caption: 'first line\nsecond line #space' }),
    media('Cfav1', 'fav_of_a', { ago: 200 }),
    media('Ccarol1', 'carol', { ago: 300, slides: 3 }),
    media('Calice2', 'alice', { ago: 400, video: true }),
  ];
  accounts['111'].feeds.favorites = [media('Cfav1', 'fav_of_a', { ago: 200 })];
  accounts['111'].feeds.home = [
    media('Halice', 'alice'),
    suggested(media('Hstranger', 'stranger', { following: false })),
    ad(media('Had', 'brand', { following: false })),
    suggested(media('Hother', 'other', { following: false })),
  ];
}

// The usernames of the posts on screen, in feed order.
const posts = () => settled(() => page.evaluate(() => [...document.querySelectorAll('#sinsta-surface .sf-post .sf-user')]
  .map((a) => a.textContent)));

async function open(view, storage) {
  await freshContext(storage);
  await logIn('111');
  feeds111();
  await page.goto(`${ORIGIN}/?variant=${view}`);
}

test('Following: newest first, without favourites, over a hidden Instagram page', async () => {
  await open('following', LIST);
  assert.deepEqual(await posts(), ['alice', 'carol', 'alice']);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-sinsta-surface')), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main')).visibility), 'hidden');
  // The tab bar sits atop the surface, its stories row included.
  assert.equal(await page.evaluate(() => !!document.querySelector('#sinsta-surface #sinsta-bar .sinsta-stories')), true);
});

test('Favourites: only favourites', async () => {
  await open('favorites', LIST);
  assert.deepEqual(await posts(), ['fav_of_a']);
});

test('Algo: only accounts you don\'t follow, no ads', async () => {
  await open('', LIST);
  assert.deepEqual(await posts(), ['stranger', 'other']);
});

test('Algo: Hide seen leaves out suggestions seen before this visit', async () => {
  const seen = { 'sinsta-seen': { Hstranger: NOW - 86400 } };
  await open('', { ...LIST, ...seen });
  assert.deepEqual(await posts(), ['other']);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sinsta-toggle')).visibility), 'visible');
  await page.waitForFunction(() => document.querySelector('.sinsta-toggle .sinsta-count').textContent === '1');
  // Off, it shows dimmed.
  await page.click('.sinsta-toggle');
  assert.deepEqual(await posts(), ['stranger', 'other']);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sf-post.sf-seen').length), 1);
});

test('Algo falls back to Instagram\'s page when the feed doesn\'t say whom you follow', async () => {
  await freshContext(LIST);
  await logIn('111');
  feeds111();
  accounts['111'].feeds.home = [media('Hx', 'x', { following: null }), media('Hy', 'y', { following: null })];
  await page.goto(ORIGIN + '/');
  const covered = await settled(() => page.evaluate(() => (document.documentElement.hasAttribute('data-sinsta-surface') ? 'surface' : 'page')
    + (document.querySelector('main #sinsta-bar') ? '+bar' : '')), 3000);
  assert.equal(covered, 'page+bar');
});

test('A feed that fails to load falls back to Instagram\'s page', async () => {
  await freshContext(LIST);
  await logIn('111');
  await page.goto(`${ORIGIN}/?variant=following`);
  // Three tries, a second and then two apart.
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-sinsta-surface') && document.querySelector('main #sinsta-bar'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => document.querySelector('.sf-lay[title^="Grid"], .sf-lay[disabled]') !== null), true);
});

test('Hide seen leaves out posts seen before this visit; off, they show dimmed', async () => {
  const seen = { 'sinsta-seen': { Ccarol1: NOW - 86400 } };
  await open('following', { ...LIST, ...seen });
  assert.deepEqual(await posts(), ['alice', 'alice']);
  await open('following', { ...LIST, ...seen, 'sinsta-prefs': { hideSeen: false } });
  assert.deepEqual(await posts(), ['alice', 'carol', 'alice']);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sf-post.sf-seen').length), 1);
});

test('Hide seen counts the posts it leaves out', async () => {
  const seen = { 'sinsta-seen': { Ccarol1: NOW - 86400 } };
  await open('following', { ...LIST, ...seen });
  await posts();
  await page.waitForFunction(() => document.querySelector('.sinsta-toggle .sinsta-count').textContent === '1');
  assert.match(await page.getAttribute('.sinsta-toggle', 'title'), /Hiding 1 post you saw/);
  // Off, nothing is left out.
  await page.click('.sinsta-toggle');
  await page.waitForFunction(() => document.querySelector('.sinsta-toggle .sinsta-count').hidden);
});

test('A post\'s seen mark comes on once it counts as seen, and marks it either way', async () => {
  await open('following', LIST);
  await posts();
  const first = '.sf-post[data-pk]:first-child .sf-mark';
  // On screen for a second: seen.
  await page.waitForSelector(`${first}[data-on]`, { state: 'attached', timeout: 4000 });
  assert.match(await page.getAttribute(first, 'title'), /^Seen \d+m ago/);
  const stored = () => page.evaluate(() => new Promise((r) => setTimeout(() => r(JSON.parse(localStorage.getItem('sinsta-seen') || '{}')), 2500)));
  assert.ok((await stored()).Calice1);
  // Clicking it marks the post as not seen, which stays while it's on screen.
  await page.hover('.sf-post[data-pk]:first-child');
  await page.click(first);
  assert.equal(await page.evaluate((s) => document.querySelector(s).hasAttribute('data-on'), first), false);
  await page.mouse.wheel(0, 40);
  await page.mouse.wheel(0, -40);
  assert.equal((await stored()).Calice1, undefined);
  assert.equal(await page.evaluate((s) => document.querySelector(s).hasAttribute('data-on'), first), false);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#sinsta-reel-player').length), 0);
  // And back.
  await page.click(first);
  assert.ok((await stored()).Calice1);
});

test('Grid: a seen post\'s tile shows the mark; clicking it doesn\'t open the post', async () => {
  const seen = { 'sinsta-seen': { Ccarol1: NOW - 86400 } };
  await open('following', { ...GRID, ...seen, 'sinsta-prefs': { hideSeen: false } });
  await settled(() => page.evaluate(() => document.querySelectorAll('.sf-tile').length));
  const mark = '.sf-tile[href="/p/Ccarol1/"] .sf-mark';
  assert.equal(await page.evaluate((s) => document.querySelector(s).hasAttribute('data-on'), mark), true);
  assert.equal(await page.evaluate(() => document.querySelector('.sf-tile[href="/p/Ccarol1/"]').classList.contains('sf-seen')), true);
  await page.hover('.sf-tile[href="/p/Ccarol1/"]');
  await page.click(mark);
  assert.equal(await page.evaluate(() => document.querySelector('.sf-tile[href="/p/Ccarol1/"]').classList.contains('sf-seen')), false);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#sinsta-reel-player').length), 0);
});

test('Grid: a tile counts as seen once scrolled past, or once the pointer rests on it', async () => {
  await freshContext(GRID);
  await logIn('111');
  feeds111();
  accounts['111'].feeds.following = Array.from({ length: 24 }, (_, i) => media(`Cg${i}`, 'alice', { ago: 100 + i }));
  await page.goto(`${ORIGIN}/?variant=following`);
  await settled(() => page.evaluate(() => document.querySelectorAll('.sf-tile').length));
  const on = (code) => page.evaluate((c) => document.querySelector(`.sf-tile[href="/p/${c}/"] .sf-mark`).hasAttribute('data-on'), code);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  // On screen, however long: not yet.
  assert.equal(await on('Cg0'), false);
  // Scrolled past: seen. Further down, not.
  await page.evaluate(() => document.querySelector('#sinsta-surface').scrollBy(0, 1500));
  await page.waitForFunction(() => document.querySelector('.sf-tile[href="/p/Cg0/"] .sf-mark').hasAttribute('data-on'));
  assert.equal(await on('Cg23'), false);
  // The pointer resting on a tile for a second.
  await page.evaluate(() => document.querySelector('.sf-tile[href="/p/Cg23/"]').scrollIntoView({ block: 'center' }));
  await page.hover('.sf-tile[href="/p/Cg23/"]');
  await page.waitForFunction(() => document.querySelector('.sf-tile[href="/p/Cg23/"] .sf-mark').hasAttribute('data-on'), null, { timeout: 3000 });
});

test('List: name, buttons and caption appear only while hovered', async () => {
  await open('following', LIST);
  await posts();
  const opacity = () => page.evaluate(() => getComputedStyle(document.querySelector('.sf-post .sf-foot')).opacity);
  assert.equal(await opacity(), '0');
  await page.hover('.sf-post');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.sf-post .sf-foot')).opacity === '1');
  assert.match(await page.textContent('.sf-post .sf-cap'), /first line\nsecond line #space/);
});

test('Grid: tiles in columns; clicking one opens the player with the caption beside it', async () => {
  await open('following', GRID);
  const tiles = await settled(() => page.evaluate(() => document.querySelectorAll('#sinsta-surface .sf-col .sf-tile').length));
  assert.equal(tiles, 3);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#sinsta-surface .sf-col').length), 3);
  await page.click('.sf-tile[href="/p/Calice1/"]');
  await page.waitForSelector('#sinsta-reel-player .sr-photo');
  assert.equal(await page.textContent('#sinsta-reel-player .sr-cuser'), 'alice');
  assert.match(await page.textContent('#sinsta-reel-player .sr-cap'), /first line/);
  // Down goes to the next post, a carousel: right goes through its photos.
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('#sinsta-reel-player .sr-cuser').textContent === 'carol');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#sinsta-reel-player .sr-dots i').length), 3);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => [...document.querySelectorAll('#sinsta-reel-player .sr-dots i')].findIndex((d) => d.classList.contains('sr-on')) === 1);
  // Opening a post counts as seeing it.
  const stored = await page.evaluate(() => new Promise((r) => setTimeout(() => r(JSON.parse(localStorage.getItem('sinsta-seen') || '{}')), 2500)));
  assert.ok(stored.Calice1 && stored.Ccarol1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sinsta-reel-player', { state: 'detached' });
});

test('The tab bar: chosen accounts, then Instagram\'s picks, then List / Grid', async () => {
  await open('following', LIST);
  await posts();
  const groups = await page.evaluate(() => [...document.querySelectorAll('#sinsta-bar .sinsta-controls > *')]
    .map((n) => n.matches('.sinsta-tabs') ? [...n.querySelectorAll('.sinsta-tab')].map((t) => t.textContent).join('+') : n.className));
  assert.deepEqual(groups, ['Following+Favourites', 'sinsta-toggle', 'Algo+Reels', 'sinsta-slot']);
  // Story names are hidden; the ring's tooltip keeps the name.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sinsta-name')).display), 'none');
  // Reels has left Instagram's menu; Home stays.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('body > nav a')].map((a) => `${a.textContent}:${a.getClientRects().length > 0}`)
    .filter((t) => /^(Home|Reels):/.test(t))), ['Home:true', 'Reels:false']);
  // G switches to the grid.
  await page.keyboard.press('g');
  await page.waitForSelector('#sinsta-surface .sf-tile');
});

test('Space on a focused button scrolls rather than pressing it', async () => {
  await open('following', GRID);
  await settled(() => page.evaluate(() => document.querySelectorAll('.sf-tile').length));
  await page.focus('.sf-step[title^="More"]');
  await page.keyboard.press(' ');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent('.sf-count'), '3');
});

test('Caught up at the end of the feed: no going back to its start', async () => {
  const seen = { 'sinsta-seen': { Calice1: NOW - 86400, Ccarol1: NOW - 86400, Calice2: NOW - 86400 } };
  await open('following', { ...LIST, ...seen });
  const text = await settled(() => page.evaluate(() => document.querySelector('#sinsta-surface .sr-status')?.textContent || ''));
  assert.match(text, /that's as far back as this feed goes/);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#sinsta-surface .sr-status button')].map((b) => b.textContent)),
    ["Show posts you've seen"]);
});

test('The story viewer\'s videos aren\'t silenced by the surface', async () => {
  await open('following', LIST);
  await posts();
  const muted = await page.evaluate(() => new Promise((resolve) => {
    const v = document.createElement('video');
    const box = document.createElement('div');
    box.id = 'sinsta-viewer';
    box.append(v);
    document.body.append(box);
    v.dispatchEvent(new Event('play'));
    setTimeout(() => resolve(v.muted), 50);
  }));
  assert.equal(muted, false);
});

test('Algo skips past the posts of accounts you follow to Instagram\'s suggestions', async () => {
  await freshContext(LIST);
  await logIn('111');
  feeds111();
  // Three pages of followed accounts before the first suggestion.
  accounts['111'].feeds.home = [
    ...Array.from({ length: 30 }, (_, i) => media(`Hf${i}`, 'alice')),
    suggested(media('Hs1', 'stranger', { following: false })),
  ];
  await page.goto(ORIGIN + '/');
  assert.deepEqual(await posts(), ['stranger']);
});

test('Saved in the menu fades its label in and out with Profile\'s', async () => {
  await open('following', LIST);
  await page.waitForSelector('[data-sinsta-saved] .label', { state: 'attached' });
  const style = () => page.evaluate(() => document.querySelector('[data-sinsta-saved] .label').getAttribute('style'));
  assert.equal(await style(), 'display: none; opacity: 0;');
  // Instagram animates the label's inline style as the sidebar widens.
  await page.evaluate(() => document.querySelector('nav a[href="/me/"] .label').setAttribute('style', 'opacity: 0.4;'));
  await page.waitForFunction(() => document.querySelector('[data-sinsta-saved] .label').getAttribute('style') === 'opacity: 0.4;');
  await page.evaluate(() => document.querySelector('nav a[href="/me/"] .label').setAttribute('style', 'opacity: 1;'));
  await page.waitForFunction(() => document.querySelector('[data-sinsta-saved] .label').getAttribute('style') === 'opacity: 1;');
  assert.equal(await page.textContent('[data-sinsta-saved] .label'), 'Saved');
});

test('The surface stays under Instagram\'s sidebar when the sidebar comes after it', async () => {
  await open('following', LIST);
  await posts();
  // Instagram's app: its own stacking context, with the sidebar in a fixed
  // layer above the page. Drawn after the surface went up (in <body>).
  await page.evaluate(() => {
    document.querySelector('#sinsta-surface').scrollTop = 40;
    const app = document.createElement('div');
    app.id = 'app';
    app.style.cssText = 'position: relative; z-index: 0';
    const layer = document.createElement('div');
    layer.style.cssText = 'position: fixed; z-index: 10; top: 0; left: 0; bottom: 0; width: 72px';
    document.body.prepend(app);
    app.append(layer);
    layer.append(document.querySelector('body > nav'));
  });
  await page.waitForFunction(() => document.querySelector('#sinsta-surface').parentElement.id === 'app', null, { timeout: 4000 });
});

test('Player: a video\'s seekbar and playback speed, the speed remembered', async () => {
  await open('following', GRID);
  await page.click('.sf-tile[href*="Calice2"]');
  const clock = page.locator('#sinsta-reel-player .sinsta-clock');
  await clock.filter({ hasText: '/ 0:04' }).waitFor();
  const speed = page.locator('#sinsta-reel-player .sinsta-speed');
  assert.equal(await speed.textContent(), '1×');
  await speed.click();
  await page.keyboard.press('>');
  assert.equal(await speed.textContent(), '1.5×');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('sinsta-surface'))).speed, 1.5);
  // Clicking the seekbar at three quarters seeks there, staying on the post.
  const box = await page.locator('#sinsta-reel-player .sinsta-seek').boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await clock.filter({ hasText: /^0:0[23] \/ 0:04$/ }).waitFor({ timeout: 1000 });
  assert.equal(await page.textContent('#sinsta-reel-player .sr-cuser'), 'alice');
  // A photo has neither.
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('#sinsta-reel-player .sr-cuser').textContent === 'carol');
  assert.equal(await speed.isVisible(), false);
  assert.equal(await page.locator('#sinsta-reel-player .sinsta-seek').isVisible(), false);
});

test('Player: a photo post\'s song plays its part on a loop, with the sound controls; Space pauses it', async () => {
  // Media elements the page plays, whether or not they're in the document.
  await freshContext(GRID);
  await page.addInitScript(() => {
    window.__media = new Set();
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__media.add(this);
      return play.call(this);
    };
  });
  await logIn('111');
  const tune = media('Ctune', 'alice', { ago: 100, song: 'Tune' });
  const quiet = media('Cquiet', 'carol', { ago: 200 });
  const clip = media('Cclip', 'dave', { ago: 300, video: true });
  accounts['111'].feeds.following = [tune, quiet, clip];
  await page.goto(`${ORIGIN}/?variant=following`);
  const audio = () => page.evaluate(() => [...window.__media].filter((m) => m.tagName === 'AUDIO')
    .map((a) => ({ src: a.getAttribute('src') || '', paused: a.paused, t: a.currentTime })));
  const label = page.locator('#sinsta-reel-player .sr-song');
  const volume = page.locator('#sinsta-reel-player .sr-volume');

  await page.click('.sf-tile[href*="Ctune"]');
  await label.filter({ hasText: '♪ Tune · Band' }).waitFor();
  assert.equal(await volume.isVisible(), true);
  // The part from 1s to 3s, round and round.
  await page.waitForTimeout(3000);
  const [a] = await audio();
  assert.match(a.src, /\/test\/aud\/Ctune\.m4a$/);
  assert.equal(a.paused, false);
  assert.ok(a.t >= 1 && a.t < 3.5, `at ${a.t}s`);
  await page.keyboard.press(' ');
  assert.equal((await audio())[0].paused, true);
  await page.keyboard.press(' ');
  await page.waitForFunction(() => [...window.__media].some((m) => m.tagName === 'AUDIO' && !m.paused));

  // A post without one: the song stops; no sound controls on a photo.
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('#sinsta-reel-player .sr-cuser').textContent === 'carol');
  assert.deepEqual((await audio()).map((x) => x.paused), [true]);
  await page.waitForTimeout(300);
  assert.equal(await label.isVisible(), false);
  assert.equal(await volume.isVisible(), false);
  // Only photo posts are looked up; a video's sound has its song in it.
  assert.deepEqual(songLookups.sort(), [tune.pk, quiet.pk].sort());
});

test('Carousels: dots along the bottom without hovering; a sideways swipe scrolls through the photos', async () => {
  const src = (sel) => page.evaluate((s) => document.querySelector(s).currentSrc || document.querySelector(s).src, sel);
  const at = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].findIndex((d) => d.classList.contains('sf-on')), sel);
  for (const [storage, node] of [[GRID, '.sf-tile[href="/p/Ccarol1/"]'], [LIST, '.sf-post:has(.sf-dots)']]) {
    await open('following', storage);
    await page.waitForSelector(`${node} .sf-dots`);
    const dots = await page.evaluate((s) => {
      const n = document.querySelector(s);
      const d = n.querySelector('.sf-dots');
      const box = n.getBoundingClientRect();
      const r = d.getBoundingClientRect();
      return { count: d.children.length, opacity: getComputedStyle(d).opacity, nearBottom: box.bottom - r.bottom < 20 && r.top > box.top + box.height / 2 };
    }, node);
    assert.deepEqual(dots, { count: 3, opacity: '1', nearBottom: true });
    // Native scrolling, coming to rest on the nearest photo: a long swipe
    // carries on past several, a short one goes on to the next past halfway.
    const width = await page.evaluate((s) => document.querySelector(`${s} .sf-track`).clientWidth, node);
    const rest = (i) => page.waitForFunction(([s, i]) => {
      const t = document.querySelector(`${s} .sf-track`);
      return t.scrollLeft === i * t.clientWidth && (document.querySelector(s).dataset.slide || '0') === String(i);
    }, [node, i]);
    await page.hover(node, { position: { x: 5, y: 100 } }); // over its first photo
    await rest(0);
    await page.mouse.wheel(width * 1.6, 0);
    await rest(2);
    await page.waitForTimeout(300);
    await page.mouse.wheel(-width * 0.6, 0);
    await rest(1);
    assert.equal(await at(`${node} .sf-dots i`), 1);
    assert.match(await src(`${node} .sf-cell:nth-child(2) img`), /Ccarol1-1\.jpg/);
    // Clicking it opens the player on that photo.
    await page.click(node);
    await page.waitForSelector('#sinsta-reel-player .sr-photo');
    assert.equal(await page.textContent('#sinsta-reel-player .sr-cuser'), 'carol');
    await page.waitForFunction(() => {
      const t = document.querySelector('#sinsta-reel-player .sr-track');
      return t.scrollLeft === t.clientWidth;
    });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#sinsta-reel-player .sr-dots i')].findIndex((d) => d.classList.contains('sr-on'))), 1);
  }
});

test('Player: in a carousel, clicking goes through its photos as in the story viewer', async () => {
  await open('following', GRID);
  await page.click('.sf-tile[href="/p/Ccarol1/"]', { position: { x: 5, y: 100 } }); // on its first photo
  await page.waitForSelector('#sinsta-reel-player .sr-photo');
  const at = (i) => page.waitForFunction((i) => {
    const t = document.querySelector('#sinsta-reel-player .sr-track');
    return Math.abs(t.scrollLeft - i * t.clientWidth) < 1
      && [...document.querySelectorAll('#sinsta-reel-player .sr-dots i')].findIndex((d) => d.classList.contains('sr-on')) === i;
  }, i);
  const box = await page.locator('#sinsta-reel-player .sr-stage').boundingBox();
  const click = async (x) => {
    await page.mouse.click(box.x + box.width * x, box.y + box.height / 2);
    await page.waitForTimeout(500);
  };
  await click(0.8);
  await at(1);
  await click(0.8);
  await click(0.8); // the last photo: stays
  await at(2);
  await click(0.1);
  await at(1);
  // A sideways swipe scrolls it natively; up and down still moves between posts.
  await page.mouse.wheel(box.width * 0.6, 0);
  await at(2);
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 60);
  await page.waitForFunction(() => document.querySelector('#sinsta-reel-player .sr-cuser').textContent === 'alice');
});

test('List: clicking a post opens the player; each post links to itself', async () => {
  await open('following', LIST);
  await posts();
  assert.equal(await page.getAttribute('.sf-post .sf-acts a.sf-act', 'href'), '/p/Calice1/');
  await page.click('.sf-post[data-pk] .sf-media');
  await page.waitForSelector('#sinsta-reel-player .sr-photo');
  assert.equal(await page.textContent('#sinsta-reel-player .sr-cuser'), 'alice');
  assert.equal(await page.getAttribute('#sinsta-reel-player a.sr-act', 'href'), '/p/Calice1/');
});

test('Grid: moving the pointer across a carousel flips through it; leaving puts it back', async () => {
  {
    const node = '.sf-tile[href="/p/Ccarol1/"]';
    await open('following', GRID);
    await page.waitForSelector(`${node} .sf-dots`);
    await page.locator(node).scrollIntoViewIfNeeded();
    const box = await page.locator(node).boundingBox();
    const at = (i) => page.waitForFunction(([s, i]) => {
      const t = document.querySelector(`${s} .sf-track`);
      return Math.round(t.scrollLeft / t.clientWidth) === i && document.querySelector(s).dataset.slide === String(i);
    }, [node, i]);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 3 });
    await at(2);
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 3 });
    await at(1);
    await page.mouse.move(box.x - 40, y, { steps: 3 });
    await at(0);
    // Clicking opens the player on the one it shows.
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 3 });
    await at(2);
    await page.mouse.click(box.x + box.width * 0.9, y);
    await page.waitForFunction(() => {
      const t = document.querySelector('#sinsta-reel-player .sr-track');
      return t && Math.round(t.scrollLeft / t.clientWidth) === 2;
    });
    assert.equal(await page.textContent('#sinsta-reel-player .sr-cuser'), 'carol');
  }
  // Not in the list.
  await open('following', LIST);
  const node = '.sf-post:has(.sf-dots)';
  await page.waitForSelector(`${node} .sf-dots`);
  await page.locator(node).scrollIntoViewIfNeeded();
  const box = await page.locator(node).boundingBox();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 3 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate((s) => document.querySelector(`${s} .sf-track`).scrollLeft, node), 0);
});

test('Grid: a carousel tile has all its photos ready before it is hovered', async () => {
  await open('following', GRID);
  await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('.sf-tile[href="/p/Ccarol1/"] .sf-cell')];
    return cells.length === 3 && cells.every((c) => c.querySelector('img'));
  });
});

// ---- Explore ---------------------------------------------------------------

async function openExplore(storage = GRID) {
  await freshContext(storage);
  await logIn('111');
  accounts['111'].explore = [
    media('Ea', 'ann', { following: false }),
    media('Eb', 'bob', { following: false, video: true }),
    { ad: media('Ead', 'brand', { following: false }) },
    media('Ec', 'cat', { following: false, slides: 3 }),
    ...Array.from({ length: 14 }, (_, i) => media(`Ex${i}`, `user${i}`, { following: false })),
  ];
  await page.goto(`${ORIGIN}/explore/`);
}

const tiles = () => settled(() => page.evaluate(() => [...document.querySelectorAll('#sinsta-surface .sf-tile')]
  .map((a) => a.getAttribute('href'))));

test('Explore: its grid in the same tiles as Home, under Instagram\'s search box', async () => {
  await openExplore({ ...GRID, 'sinsta-prefs': { lastView: 'following' } });
  const got = await tiles();
  assert.ok(got.length >= 6, `tiles: ${got}`);
  assert.ok(got.includes('/p/Ea/') && got.includes('/reel/Eb/') && got.includes('/p/Ec/'));
  assert.ok(!got.includes('/p/Ead/'), 'no ads');
  // The search box shows, above the surface; Instagram's grid doesn't.
  const box = await page.evaluate(() => {
    const input = document.querySelector('main input');
    const surface = document.querySelector('#sinsta-surface').getBoundingClientRect();
    return {
      visible: getComputedStyle(input).visibility,
      native: getComputedStyle(document.querySelector('main .results')).visibility,
      above: input.getBoundingClientRect().bottom <= surface.top,
    };
  });
  assert.deepEqual(box, { visible: 'visible', native: 'hidden', above: true });
  // Hide seen and the layout controls, but not Home's tabs.
  const bar = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('#sinsta-surface .sinsta-tab')].filter((t) => t.offsetParent).length,
    toggle: !!document.querySelector('#sinsta-surface .sinsta-toggle').offsetParent,
    layout: !!document.querySelector('#sinsta-surface .sf-switch').offsetParent,
  }));
  assert.deepEqual(bar, { tabs: 0, toggle: true, layout: true });
  // More loads as you scroll.
  await page.evaluate(() => document.querySelector('#sinsta-surface').scrollTo(0, 1e6));
  await page.waitForFunction(() => document.querySelectorAll('#sinsta-surface .sf-tile').length >= 17);
  // Visiting Explore leaves the Home view to reopen as it was.
  const prefs = await page.evaluate(() => new Promise((r) => setTimeout(() => r(JSON.parse(localStorage.getItem('sinsta-prefs'))), 300)));
  assert.equal(prefs.lastView, 'following');
});

test('Explore: Hide seen leaves out posts seen before this visit', async () => {
  await openExplore({ ...GRID, 'sinsta-seen': { Ea: NOW - 86400 } });
  const got = await tiles();
  assert.ok(!got.includes('/p/Ea/'));
  await page.waitForFunction(() => document.querySelector('.sinsta-toggle .sinsta-count').textContent === '1');
});

test('Explore: the surface makes way for search results until Back', async () => {
  await openExplore();
  await tiles();
  await page.click('main input');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-sinsta-surface'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main .results')).visibility), 'visible');
  await page.keyboard.type('cats');
  assert.equal(await page.inputValue('main input'), 'cats');
  await page.click('main [role="button"]');
  await page.locator('main input').blur();
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-sinsta-surface'));
  assert.ok((await tiles()).length >= 6);
});

test('Explore falls back to Instagram\'s page when its grid can\'t be loaded', async () => {
  await freshContext(GRID);
  await logIn('111');
  await page.goto(`${ORIGIN}/explore/`);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-sinsta-surface')
    && getComputedStyle(document.querySelector('main .results')).visibility === 'visible', null, { timeout: 8000 });
});

// ---- Profiles ----------------------------------------------------------------

async function openProfile(storage = GRID, path = '/alice/') {
  await freshContext(storage);
  await logIn('111');
  accounts['111'].posts = {
    alice: [
      media('Pa1', 'alice', { video: true }),
      media('Pa2', 'alice', { slides: 3 }),
      ...Array.from({ length: 22 }, (_, i) => media(`Pa${i + 3}`, 'alice')),
    ],
  };
  await page.goto(ORIGIN + path);
}

test('Profile: its posts in the same tiles, in the page under its header and tabs', async () => {
  await openProfile();
  const got = await tiles();
  assert.equal(got[0], '/reel/Pa1/');
  assert.ok(got.includes('/p/Pa2/') && got.includes('/p/Pa3/'));
  const layout = await page.evaluate(() => {
    const surface = document.querySelector('#sinsta-surface');
    return {
      inline: surface.classList.contains('sf-inline') && getComputedStyle(surface).position,
      afterTabs: document.querySelector('.tabs').getBoundingClientRect().bottom <= surface.getBoundingClientRect().top + 1,
      header: getComputedStyle(document.querySelector('main header')).visibility,
      native: getComputedStyle(document.querySelector('main .grid')).display,
      covered: document.documentElement.hasAttribute('data-sinsta-surface'),
      tabs: [...surface.querySelectorAll('.sinsta-tab')].filter((n) => n.offsetParent).length,
      toggle: !!surface.querySelector('.sinsta-toggle').offsetParent,
      layoutControls: !!surface.querySelector('.sf-switch').offsetParent,
    };
  });
  assert.deepEqual(layout, { inline: 'static', afterTabs: true, header: 'visible', native: 'none', covered: false, tabs: 0, toggle: true, layoutControls: true });
  // The page scrolls, and more posts load as it does.
  await page.mouse.move(640, 600);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 800);
  await page.waitForFunction(() => window.scrollY > 0 && document.querySelectorAll('#sinsta-surface .sf-tile').length === 24);
  // Clicking a tile opens the player.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#sinsta-surface .sf-tile[href="/p/Pa2/"]');
  await page.waitForSelector('#sinsta-reel-player');
});

test('Profile: Hide seen leaves out posts seen before this visit; off, they show dimmed', async () => {
  await openProfile({ ...GRID, 'sinsta-seen': { Pa2: NOW - 86400 } });
  assert.ok(!(await tiles()).includes('/p/Pa2/'));
  assert.equal(await page.evaluate(() => !!document.querySelector('#sinsta-surface .sinsta-toggle').offsetParent), true);
  await page.waitForFunction(() => document.querySelector('.sinsta-toggle .sinsta-count').textContent === '1');
  await page.click('#sinsta-surface .sinsta-toggle');
  await page.waitForFunction(() => document.querySelector('.sf-tile[href="/p/Pa2/"].sf-seen .sf-mark[data-on]'));
});

test('Profile: the grid reaches out of Instagram\'s column to the room beside the sidebar', async () => {
  await openProfile();
  await tiles();
  await page.evaluate(() => { document.querySelector('main .profile').style.cssText = 'width: 500px; margin: 0 auto'; });
  await page.setViewportSize({ width: 1300, height: 900 }); // and measure again
  await page.waitForFunction(() => {
    const r = document.querySelector('#sinsta-surface').getBoundingClientRect();
    return r.width > 1000 && Math.abs(r.right - document.documentElement.clientWidth) <= 1;
  });
});
test('Profile: the grid keeps its place while the sidebar narrows after a hover, and takes a sidebar wide for good', async () => {
  await openProfile();
  await tiles();
  // Instagram's sidebar, fixed on the left, narrow but for its icons.
  await page.addStyleTag({ content: 'body > nav { position: fixed; top: 0; bottom: 0; left: 0; width: 72px; overflow: hidden; z-index: 10 } body > nav svg { display: block; width: 24px; height: 24px; margin-left: 24px }' });
  const nudge = () => page.evaluate(() => document.body.append(document.createElement('i')));
  const left = () => page.evaluate(() => Math.round(document.querySelector('#sinsta-surface').getBoundingClientRect().left));
  await page.waitForTimeout(1100);
  await nudge();
  await page.waitForFunction(() => Math.round(document.querySelector('#sinsta-surface').getBoundingClientRect().left) === 72);
  await page.waitForTimeout(1100);
  // The pointer has just left it: it's still wide when the page changes,
  // and narrows a moment later.
  await page.evaluate(() => { document.querySelector('body > nav').style.width = '238px'; });
  await nudge();
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.querySelector('body > nav').style.width = ''; });
  await nudge();
  for (let i = 0; i < 8; i++) {
    assert.equal(await left(), 72);
    await page.waitForTimeout(100);
  }
  // Wide for good (Instagram's labelled sidebar): the grid makes room.
  await page.waitForTimeout(1100);
  await page.evaluate(() => { document.querySelector('body > nav').style.width = '238px'; });
  await nudge();
  await page.waitForFunction(() => Math.round(document.querySelector('#sinsta-surface').getBoundingClientRect().left) === 238, null, { timeout: 3000 });
});

test('Profile, then straight to Home as Instagram swaps the page: the surface is beside the sidebar again', async () => {
  await freshContext(GRID);
  await logIn('111');
  feeds111();
  accounts['111'].posts = { alice: [media('Pa1', 'alice'), media('Pa2', 'alice')] };
  await page.goto(`${ORIGIN}/?variant=following`);
  await tiles();
  const homeMain = await page.evaluate(() => document.querySelector('main').outerHTML);
  const nav = (path, html) => page.evaluate(([p, h]) => {
    history.pushState({}, '', p);
    document.querySelector('main').outerHTML = h;
  }, [path, html]);
  const profileMain = await page.evaluate(async () => (await (await fetch('/alice/')).text()).match(/<main>[\s\S]*<\/main>/)[0]
    .replace('class="profile"', 'class="profile" style="width: 500px; margin: 0 auto"'));
  await nav('/alice/', profileMain);
  // Reaching out of the narrow column moves the box left of it.
  await page.waitForFunction(() => {
    const s = document.querySelector('main #sinsta-surface.sf-inline');
    return s && s.querySelector('.sf-tile') && parseFloat(s.style.marginLeft || getComputedStyle(s).marginLeft) < 0;
  });
  await nav('/?variant=following', homeMain);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-sinsta-surface'));
  const box = await page.evaluate(() => {
    const s = document.querySelector('#sinsta-surface');
    const r = s.getBoundingClientRect();
    return { left: Math.round(r.left), sidebar: parseFloat(s.style.getPropertyValue('--sr-left')), right: Math.round(r.right), page: document.documentElement.clientWidth };
  });
  assert.equal(box.left, box.sidebar);
  assert.ok(Math.abs(box.right - box.page) <= 1, `right ${box.right} vs ${box.page}`);
});

test('Profile: Reels and Tagged stay Instagram\'s own; so do posts that can\'t be loaded', async () => {
  await openProfile(GRID, '/alice/reels/');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => !!document.querySelector('#sinsta-surface')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main .grid')).display), 'block');
  await freshContext(GRID);
  await logIn('111');
  await page.goto(`${ORIGIN}/carol/`);
  await page.waitForFunction(() => !document.querySelector('#sinsta-surface') && getComputedStyle(document.querySelector('main .grid')).display === 'block', null, { timeout: 8000 });
});

test('Profile and back to Home, within the page: the grid moves between the page and the surface', async () => {
  await freshContext(LIST);
  await logIn('111');
  feeds111();
  accounts['111'].posts = { alice: [media('Pa1', 'alice'), media('Pa2', 'alice')] };
  await page.goto(`${ORIGIN}/?variant=following`);
  assert.deepEqual(await posts(), ['alice', 'carol', 'alice']);
  const homeMain = await page.evaluate(() => document.querySelector('main').outerHTML);
  // As Instagram's router does: a new address, a new page in main.
  const nav = (path, html) => page.evaluate(([p, h]) => {
    history.pushState({}, '', p);
    document.querySelector('main').outerHTML = h;
  }, [path, html]);
  const profileMain = await page.evaluate(async () => (await (await fetch('/alice/')).text()).match(/<main>[\s\S]*<\/main>/)[0]);
  await nav('/alice/', profileMain);
  await page.waitForFunction(() => document.querySelector('main #sinsta-surface.sf-inline .sf-post'));
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-sinsta-surface')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('main')).visibility), 'visible');
  // Instagram's next page takes the grid away with the profile's.
  await nav('/p/Pa1/', '<main><div>a post</div></main>');
  await page.waitForFunction(() => !Sinsta.surface.active());
  await nav('/alice/', profileMain);
  await page.waitForFunction(() => document.querySelector('main #sinsta-surface.sf-inline .sf-post'));
  await nav('/?variant=following', homeMain);
  assert.deepEqual(await posts(), ['alice', 'carol', 'alice']);
  const back = await page.evaluate(() => ({
    surface: document.documentElement.hasAttribute('data-sinsta-surface'),
    inline: document.querySelector('#sinsta-surface').classList.contains('sf-inline'),
    inMain: !!document.querySelector('main #sinsta-surface'),
    tabs: [...document.querySelectorAll('#sinsta-surface .sinsta-tab')].filter((t) => t.offsetParent).length,
  }));
  assert.deepEqual(back, { surface: true, inline: false, inMain: false, tabs: 4 });
});
