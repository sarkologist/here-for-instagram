// What the stories row on Following and Favourites shows, and what a
// profile's picture opens, in Playwright's
// Firefox, with the extension's content scripts on a stand-in for
// instagram.com (stand-in.mjs).
//
// Usage: cd tests && npm ci && npx playwright install firefox && npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, accounts, page, freshContext, logIn, settled } from './stand-in.mjs';

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
