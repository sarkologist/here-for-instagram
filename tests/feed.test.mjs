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
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#sinsta-reel-player .sr-dots i')].findIndex((d) => d.classList.contains('sr-on'))), 1);
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
