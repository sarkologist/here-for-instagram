// What the stories row on Following and Favourites shows, and what a
// profile's picture opens, in Playwright's
// Firefox, with the extension's content scripts on a stand-in for
// instagram.com (stand-in.mjs).
//
// Usage: cd tests && npm ci && npx playwright install firefox && npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, accounts, reel, videoReel, storyViewers, page, freshContext, logIn, settled } from './stand-in.mjs';

// The usernames in the stories row once it has settled, watched ones marked.
async function row(view) {
  await page.goto(`${ORIGIN}/?variant=${view}`);
  return settled(() => page.evaluate(() => [...document.querySelectorAll('.sinsta-story')]
    .map((a) => a.title + (a.classList.contains('sinsta-seen') ? ' (watched)' : ''))), 5000);
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

// Clicks the profile picture on a profile; what the viewer then shows.
async function openFromProfile(username) {
  await page.goto(`${ORIGIN}/${username}/`);
  await page.click('header img');
  await page.waitForTimeout(1000);
  return page.evaluate(() => ({
    viewer: !!document.querySelector('#sinsta-viewer'),
    user: document.querySelector('#sinsta-viewer .sv-user')?.textContent ?? null,
    // Cards of other accounts: the account on stage has one of its own.
    cards: [...document.querySelectorAll('#sinsta-viewer .sv-peek-avatar')].filter((a) => a.alt !== document.querySelector('#sinsta-viewer .sv-user').textContent).length,
    instagramGotClick: window.__igClicks > 0,
    path: location.pathname,
  }));
}

test('Profile picture opens the story in the extension viewer, without a carousel', async () => {
  await freshContext();
  await logIn('111');
  assert.deepEqual(await openFromProfile('carol'),
    { viewer: true, user: 'carol', cards: 0, instagramGotClick: false, path: '/carol/' });
});

test('Profile picture without a story: the click goes on to Instagram', async () => {
  await freshContext();
  await logIn('111');
  assert.deepEqual(await openFromProfile('nostory'),
    { viewer: false, user: null, cards: 0, instagramGotClick: true, path: '/nostory/' });
});

test('A click outside the story closes the viewer; on the story, it does not', async () => {
  await freshContext();
  await logIn('111');
  await openFromProfile('carol');
  const isOpen = () => page.evaluate(() => !!document.querySelector('#sinsta-viewer'));
  // The left of the story: back, which on the first story stays put.
  const box = await page.locator('#sinsta-viewer .sv-stage').boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  assert.equal(await isOpen(), true);
  await page.mouse.click(10, box.y + box.height / 2);
  assert.equal(await isOpen(), false);
});

test('Name, buttons and reply box show only while the story is hovered', async () => {
  await freshContext();
  await logIn('111');
  await openFromProfile('carol');
  const opacity = () => page.evaluate(() => ['.sv-top', '.sv-foot']
    .map((s) => getComputedStyle(document.querySelector(`#sinsta-viewer ${s}`)).opacity).join());
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#sinsta-viewer .sv-top')).opacity === '0');
  assert.equal(await opacity(), '0,0');
  await page.hover('#sinsta-viewer .sv-stage');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#sinsta-viewer .sv-foot')).opacity === '1');
  assert.equal(await opacity(), '1,1');
});

test('Video story: seekbar and playback speed', async () => {
  await freshContext();
  await logIn('111');
  accounts['111'].tray = [videoReel('6', 'vid')];
  accounts['111'].favourites = [];
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
  // Clicking the seekbar at three quarters seeks there.
  const box = await page.locator('#sinsta-viewer .sinsta-seek').boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  const t = await page.evaluate(() => document.querySelector('#sinsta-viewer video').currentTime);
  assert.ok(t > 2.5 && t < 3.5, `seeked to ${t}`);
  // Seeking doesn't move on to another story or close the viewer.
  assert.equal(await page.locator('#sinsta-viewer').count(), 1);
  await clock.filter({ hasText: /^0:0[23] \/ 0:04$/ }).waitFor({ timeout: 1000 });
});

test('Your own story: who has seen it, and their list', async () => {
  await freshContext();
  await logIn('111');
  accounts['111'].tray = [reel('111', 'me_myself', { ago: 120 }), reel('2', 'carol', { ago: 600 })];
  accounts['111'].favourites = [];
  storyViewers['111001'] = [
    { username: 'bob', liked: true },
    { username: 'eve', reply: 'nice' },
    ...Array.from({ length: 23 }, (_, i) => ({ username: `v${i}` })),
  ];
  assert.deepEqual(await row('following'), ['me_myself', 'carol']);
  await page.click('.sinsta-story');
  const seen = page.locator('#sinsta-viewer .sv-seen');
  await seen.filter({ hasText: 'Seen by 25' }).waitFor();
  const foot = () => page.evaluate(() => ({
    reply: !document.querySelector('#sinsta-viewer .sv-reply').hidden,
    like: !document.querySelector('#sinsta-viewer .sv-like').hidden,
    seen: !document.querySelector('#sinsta-viewer .sv-seen').hidden,
    faces: document.querySelectorAll('#sinsta-viewer .sv-seen-faces img').length,
    likes: document.querySelector('#sinsta-viewer .sv-seen-likes').textContent,
  }));
  // One like among the first page of 20, with more to come.
  assert.deepEqual(await foot(), { reply: false, like: false, seen: true, faces: 3, likes: '1+' });

  // V opens the list; scrolling down loads the rest.
  await page.keyboard.press('v');
  const rows = page.locator('#sinsta-viewer .sv-viewer');
  await rows.first().waitFor();
  assert.equal(await page.locator('#sinsta-viewer .sv-viewers-title').textContent(), 'Viewers · 25');
  assert.equal(await rows.first().locator('.sv-viewer-liked').count(), 1);
  assert.equal(await rows.nth(1).locator('.sv-viewer-reply').textContent(), 'Replied: nice');
  await page.evaluate(() => { const l = document.querySelector('#sinsta-viewer .sv-viewers-list'); l.scrollTop = l.scrollHeight; });
  await page.waitForFunction(() => document.querySelectorAll('#sinsta-viewer .sv-viewer').length === 25);
  assert.equal(await page.locator('#sinsta-viewer .sv-seen-likes').textContent(), '1');

  // A click on the story closes the list, not the viewer, and doesn't move on.
  const box = await page.locator('#sinsta-viewer .sv-stage').boundingBox();
  await page.mouse.click(box.x + box.width * 0.8, box.y + 100);
  assert.equal(await page.locator('#sinsta-viewer .sv-viewers').isHidden(), true);
  assert.equal(await page.locator('#sinsta-viewer .sv-user').textContent(), 'me_myself');
  // Clicking "Seen by" opens it again; Esc closes only the list.
  await page.hover('#sinsta-viewer .sv-stage');
  await seen.click();
  assert.equal(await page.locator('#sinsta-viewer .sv-viewers').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sinsta-viewer .sv-viewers').isHidden(), true);
  assert.equal(await page.locator('#sinsta-viewer').count(), 1);

  // Someone else's story: the reply box and the heart, as before.
  await page.keyboard.press('ArrowRight');
  await page.locator('#sinsta-viewer .sv-user', { hasText: 'carol' }).waitFor();
  const theirs = await foot();
  assert.deepEqual([theirs.like, theirs.seen], [true, false]);
});
