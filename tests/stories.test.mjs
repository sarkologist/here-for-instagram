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
    { viewer: true, user: 'carol', cards: 0, instagramGotClick: false, path: '/stories/carol/2001/' });
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

test('Your own story: how many saw, liked and replied, and who', async () => {
  await freshContext();
  await logIn('111');
  accounts['111'].tray = [reel('111', 'me_myself', { ago: 120 }), reel('2', 'carol', { ago: 600 })];
  accounts['111'].favourites = [];
  // 25 viewers, in two pages; the one who liked comes after the first page.
  storyViewers['111001'] = [
    { username: 'eve', reply: 'nice' },
    ...Array.from({ length: 21 }, (_, i) => ({ username: `v${i}` })),
    { username: 'bob', liked: true },
    { username: 'zed', liked: true, reply: 'wow' },
    { username: 'last' },
  ];
  assert.deepEqual(await row('following'), ['me_myself', 'carol']);
  await page.click('.sinsta-story');
  const pill = page.locator('#sinsta-viewer .sv-seen');
  // Every page is read, so the counts are whole (the second page comes a
  // moment later: requests are paced).
  await pill.waitFor();
  const counts = () => page.evaluate(() => [...document.querySelectorAll('#sinsta-viewer .sv-seen .sv-stat')]
    .map((s) => (s.hidden ? '-' : `${s.title} ${s.textContent}`)));
  await page.waitForFunction(() => [...document.querySelectorAll('#sinsta-viewer .sv-seen .sv-stat')]
    .map((s) => (s.hidden ? '-' : `${s.title} ${s.textContent}`)).join('|') === 'Viewers 25|Likes 2|Replies 2', null, { timeout: 5000 });
  assert.deepEqual(await counts(), ['Viewers 25', 'Likes 2', 'Replies 2']);
  const foot = () => page.evaluate(() => ({
    reply: !document.querySelector('#sinsta-viewer .sv-reply').hidden,
    like: !document.querySelector('#sinsta-viewer .sv-like').hidden,
    pill: !document.querySelector('#sinsta-viewer .sv-seen').hidden,
  }));
  assert.deepEqual(await foot(), { reply: false, like: false, pill: true });

  // V opens the list beside the story: likers first, then Instagram's order.
  await page.keyboard.press('v');
  const names = () => page.evaluate(() => [...document.querySelectorAll('#sinsta-viewer .sv-viewer a')].map((a) => a.textContent));
  const panel = page.locator('#sinsta-viewer .sv-viewers');
  await panel.waitFor();
  const list = await names();
  assert.equal(list.length, 25);
  assert.deepEqual(list.slice(0, 4), ['bob', 'zed', 'eve', 'v0']);
  const [stage, side] = await Promise.all([page.locator('#sinsta-viewer .sv-stage').boundingBox(), panel.boundingBox()]);
  assert.ok(side.x >= stage.x + stage.width, 'beside the story, not over it');
  assert.equal(await page.locator('#sinsta-viewer .sv-viewer', { hasText: 'zed' }).locator('.sv-viewer-reply').textContent(), 'wow');
  // The filters. Clicked with the mouse: Playwright's own click scrolls the
  // panel into view, which turns the carousel (the viewer scrolls sideways).
  const tab = (n) => ({
    click: async () => {
      const b = await page.locator('#sinsta-viewer .sv-tab').nth(n).boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    },
  });
  assert.deepEqual(await page.locator('#sinsta-viewer .sv-tab').allTextContents(), ['All25', '2', '2']);
  await tab(1).click();
  assert.deepEqual(await names(), ['bob', 'zed']);
  await tab(2).click();
  assert.deepEqual(await names(), ['zed', 'eve']);
  await tab(0).click();

  // A click on the story closes the list, not the viewer, and doesn't move on.
  await page.mouse.click(stage.x + stage.width * 0.8, stage.y + 100);
  assert.equal(await panel.isHidden(), true);
  assert.equal(await page.locator('#sinsta-viewer .sv-user').textContent(), 'me_myself');
  // The pill opens it again; Esc closes only the list.
  await page.hover('#sinsta-viewer .sv-stage');
  await pill.click();
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await panel.isHidden(), true);
  assert.equal(await page.locator('#sinsta-viewer').count(), 1);

  // Someone else's story: the heart, no pill, and V does nothing.
  await page.keyboard.press('ArrowRight');
  await page.locator('#sinsta-viewer .sv-user', { hasText: 'carol' }).waitFor();
  assert.deepEqual(await foot(), { reply: false, like: true, pill: false });
  await page.keyboard.press('v');
  assert.equal(await panel.isHidden(), true);
});

test('Viewer: each story has its own address, and Back and Forward go through them', async () => {
  await freshContext();
  await logIn('111');
  accounts['111'].tray = [reel('111', 'me_myself', { ago: 120 }), reel('2', 'carol', { ago: 600 })];
  accounts['111'].favourites = [];
  storyViewers['111001'] = [{ username: 'eve', liked: true }];
  assert.deepEqual(await row('following'), ['me_myself', 'carol']);
  const where = () => page.evaluate(() => location.pathname + location.search);
  const user = (u) => page.locator('#sinsta-viewer .sv-user', { hasText: u }).waitFor();
  const panel = page.locator('#sinsta-viewer .sv-viewers');
  await page.evaluate(() => {
    window.__igPops = 0;
    addEventListener('popstate', () => window.__igPops++);
  });
  await page.click('.sinsta-story');
  await user('me_myself');
  await page.waitForFunction(() => location.pathname === '/stories/me_myself/111001/');
  // The list of viewers is a step of its own.
  await page.keyboard.press('v');
  await panel.waitFor();
  await page.keyboard.press('ArrowRight');
  await user('carol');
  assert.equal(await where(), '/stories/carol/2001/');
  await page.evaluate(() => history.back());
  await user('me_myself');
  await panel.waitFor();
  // Closing the list is a step too: Back opens it again.
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await where(), '/stories/me_myself/111001/');
  await page.evaluate(() => history.back());
  await panel.waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  // Closing the viewer is a step onto the row's address: Back reopens it
  // on the story it closed on.
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sinsta-viewer', { state: 'detached' });
  assert.equal(await where(), '/?variant=following');
  await page.evaluate(() => history.back());
  await user('me_myself');
  assert.equal(await where(), '/stories/me_myself/111001/');
  await page.evaluate(() => history.forward());
  await page.waitForSelector('#sinsta-viewer', { state: 'detached' });
  assert.equal(await where(), '/?variant=following');
  assert.equal(await page.evaluate(() => window.__igPops), 0);
});
