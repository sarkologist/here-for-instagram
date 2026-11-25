// What Home's views and Reels show when the extension draws them (feed.js),
// on the stand-in for instagram.com (stand-in.mjs).
//
// Usage: cd tests && npm ci && npx playwright install firefox && npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, NOW, accounts, media, ad, suggested, page, freshContext, logIn, settled } from './stand-in.mjs';

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

test('Carousels: moving the pointer across one flips through it; leaving puts it back', async () => {
  for (const [storage, node] of [[GRID, '.sf-tile[href="/p/Ccarol1/"]'], [LIST, '.sf-post:has(.sf-dots)']]) {
    await open('following', storage);
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
});
