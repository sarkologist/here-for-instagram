// Accounts kept apart, tab by tab.
//
// Instagram keeps one signed-in account per cookie jar. Switching accounts in
// one tab swaps the session cookie under every other tab, whose pages still
// act for the old account and fail ("Sorry, something went wrong"). Firefox
// containers each have their own jar, so tabs in different containers can be
// signed in to different accounts at once.
//
// So when a tab switches accounts while other Instagram tabs share its jar,
// the response that signs it in to the new account doesn't reach the jar:
// its cookies go to that account's own container instead (an existing one
// signed in to it, or a new copy of the jar), and the tab reopens there. The
// other tabs keep their account. A tab alone in its jar just switches, as on
// Instagram. Tabs opened from a tab stay in its container, so on its account.
//
// This script also lists the accounts signed in across jars for the
// address-bar button, names the containers it made after their account,
// removes ones left empty and redundant, and tells tabs when the account
// under them changed anyway (signing out, say), so they reload.
'use strict';

const ORIGIN = 'https://www.instagram.com';
const DEFAULT_STORE = 'firefox-default';
const ACCOUNTS_KEY = 'sinsta-accounts'; // user id -> { username, pic }
const MADE_KEY = 'sinsta-containers'; // cookieStoreIds of containers made here
const COLORS = ['blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];
const IG_TABS = ['*://www.instagram.com/*'];
const HANDED_OFF_MS = 10000;

const hasContainers = () => !!browser.contextualIdentities;

async function stored(key, fallback) {
  return (await browser.storage.local.get(key))[key] || fallback;
}

// A session cookie's value starts with the account's user id.
function userOfSession(value) {
  let id = '';
  try {
    id = decodeURIComponent(value).split(':')[0];
  } catch (_) {}
  return /^\d+$/.test(id) ? id : null;
}

// The user id signed in to a cookie jar, or null. ds_user_id holds it too,
// should the session cookie's format change.
async function userIn(storeId) {
  const get = (name) => browser.cookies.get({ url: ORIGIN + '/', name, storeId }).catch(() => null);
  const [session, ds] = await Promise.all([get('sessionid'), get('ds_user_id')]);
  if (!session || !session.value) return null;
  return userOfSession(session.value) || (ds && /^\d+$/.test(ds.value) ? ds.value : null);
}

async function containers() {
  return (await queryContainers()) || [];
}

// Null when container tabs are turned off.
async function queryContainers() {
  if (!hasContainers()) return null;
  try {
    return await browser.contextualIdentities.query({});
  } catch (_) {
    return null;
  }
}

// Every jar, the default one first, with the account signed in to it.
async function jars() {
  const all = [{ cookieStoreId: DEFAULT_STORE, name: null, colorCode: null }, ...await containers()];
  return Promise.all(all.map(async (j) => ({ ...j, userId: await userIn(j.cookieStoreId) })));
}

async function listAccounts() {
  const [accounts, made, all] = await Promise.all([stored(ACCOUNTS_KEY, {}), stored(MADE_KEY, []), jars()]);
  return all.filter((j) => j.userId).map((j) => {
    const a = accounts[j.userId] || {};
    return {
      storeId: j.cookieStoreId,
      container: j.name,
      colorCode: j.colorCode,
      made: made.includes(j.cookieStoreId),
      userId: j.userId,
      username: a.username || null,
      pic: a.pic || null,
    };
  });
}

function igTabs(storeId) {
  return browser.tabs.query({ cookieStoreId: storeId, url: IG_TABS }).catch(() => []);
}

function openTab(storeId, after, active = true) {
  const props = { url: ORIGIN + '/', cookieStoreId: storeId, active };
  if (after) {
    props.windowId = after.windowId;
    props.index = after.index + 1;
  }
  return browser.tabs.create(props);
}

async function makeContainer() {
  const cis = await containers();
  const ci = await browser.contextualIdentities.create({
    name: 'Instagram',
    color: COLORS[cis.length % COLORS.length],
    icon: 'circle',
  });
  const made = await stored(MADE_KEY, []);
  await browser.storage.local.set({ [MADE_KEY]: [...made, ci.cookieStoreId] });
  return ci.cookieStoreId;
}

// Copy a jar's Instagram cookies into another: the device's cookies along
// with the session, so the copy looks like the same browser to Instagram.
async function copyCookies(from, to) {
  const all = await browser.cookies.getAll({ domain: 'instagram.com', storeId: from, firstPartyDomain: null });
  await Promise.all(all.map((c) => {
    const props = {
      url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      storeId: to,
    };
    if (!c.hostOnly) props.domain = c.domain;
    if (!c.session) props.expirationDate = c.expirationDate;
    if (c.firstPartyDomain) props.firstPartyDomain = c.firstPartyDomain;
    return browser.cookies.set(props).catch(() => {});
  }));
}

// ---- Set-Cookie headers -----------------------------------------------------

// Firefox hands several Set-Cookie headers over as one, joined by newlines.
function setCookieLines(headers) {
  const lines = [];
  for (const h of headers || []) {
    if (h.name.toLowerCase() === 'set-cookie' && h.value) lines.push(...h.value.split('\n').filter(Boolean));
  }
  return lines;
}

const SAME_SITE = { none: 'no_restriction', lax: 'lax', strict: 'strict' };

function parseSetCookie(line) {
  const [pair, ...attrs] = line.split(';');
  const eq = pair.indexOf('=');
  if (eq < 1) return null;
  const c = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
  for (const a of attrs) {
    const i = a.indexOf('=');
    const key = (i < 0 ? a : a.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? '' : a.slice(i + 1).trim();
    if (key === 'domain' && val) c.domain = val.startsWith('.') ? val : '.' + val;
    else if (key === 'path' && val.startsWith('/')) c.path = val;
    else if (key === 'expires' && c.maxAge === undefined) {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) c.expires = t / 1000;
    } else if (key === 'max-age' && /^-?\d+$/.test(val)) c.maxAge = Number(val);
    else if (key === 'secure') c.secure = true;
    else if (key === 'httponly') c.httpOnly = true;
    else if (key === 'samesite' && SAME_SITE[val.toLowerCase()]) c.sameSite = SAME_SITE[val.toLowerCase()];
  }
  if (c.maxAge !== undefined) c.expires = Date.now() / 1000 + c.maxAge;
  return c;
}

// Store cookies from a response in another jar, as Firefox would have.
async function applyCookies(cookies, host, storeId) {
  const now = Date.now() / 1000;
  for (const c of cookies) {
    const domain = c.domain || host;
    const url = `https://${domain.replace(/^\./, '')}${c.path || '/'}`;
    try {
      if (c.expires !== undefined && c.expires <= now) {
        await browser.cookies.remove({ url, name: c.name, storeId });
        continue;
      }
      const props = { url, name: c.name, value: c.value, path: c.path || '/', storeId };
      if (c.domain) props.domain = c.domain;
      if (c.secure) props.secure = true;
      if (c.httpOnly) props.httpOnly = true;
      if (c.sameSite) props.sameSite = c.sameSite;
      if (c.expires !== undefined) props.expirationDate = c.expires;
      await browser.cookies.set(props);
    } catch (_) {}
  }
}

// ---- Switching accounts in one tab --------------------------------------------

const handedOff = new Map(); // tab id -> when it was moved out

async function switchingTab(d, storeId) {
  if (d.tabId >= 0) return browser.tabs.get(d.tabId).catch(() => null);
  // A request from Instagram's service worker: take the tab last used.
  const tabs = await igTabs(storeId);
  return tabs.sort((a, b) => b.lastAccessed - a.lastAccessed)[0] || null;
}

// Move a tab signing in to `userId` into a jar of that account's own: one
// already signed in to it, or a new container copied from its jar with the
// response's cookies on top.
async function handOff(tab, from, userId, cookies, host) {
  handedOff.set(tab.id, Date.now());
  let target = (await jars()).find((j) => j.userId === userId && j.cookieStoreId !== from);
  let storeId = target && target.cookieStoreId;
  if (!storeId) {
    storeId = await makeContainer();
    await copyCookies(from, storeId);
    await applyCookies(cookies, host, storeId);
  }
  await openTab(storeId, tab, tab.active);
  await browser.tabs.remove(tab.id).catch(() => {});
}

function onHeaders(d) {
  const lines = setCookieLines(d.responseHeaders);
  if (!lines.length) return {};
  const strip = () => ({ responseHeaders: d.responseHeaders.filter((h) => h.name.toLowerCase() !== 'set-cookie') });
  // Late responses for a tab already moved out must not change its old jar.
  const off = handedOff.get(d.tabId);
  if (off && Date.now() - off < HANDED_OFF_MS) return strip();
  const cookies = lines.map(parseSetCookie).filter(Boolean);
  const session = cookies.find((c) => c.name === 'sessionid');
  const ds = cookies.find((c) => c.name === 'ds_user_id');
  const userId = session && session.value
    && (userOfSession(session.value) || (ds && /^\d+$/.test(ds.value) ? ds.value : null));
  if (!userId) return {}; // no sign-in here (signing out stays as on Instagram)
  return (async () => {
    const storeId = d.cookieStoreId || DEFAULT_STORE;
    const current = await userIn(storeId);
    if (!current || current === userId) return {}; // signing in, or a refresh
    const tab = await switchingTab(d, storeId);
    if (!tab || tab.cookieStoreId !== storeId) return {};
    const others = (await igTabs(storeId)).filter((t) => t.id !== tab.id);
    if (!others.length) return {}; // alone in its jar: nothing to keep apart
    if (!await queryContainers()) return {};
    const host = new URL(d.url).hostname;
    // Should moving fail, switch the jar after all, as Instagram would.
    handOff(tab, storeId, userId, cookies, host).catch(() => applyCookies(cookies, host, storeId));
    return strip();
  })();
}

browser.webRequest.onHeadersReceived.addListener(onHeaders, { urls: ['*://*.instagram.com/*'] }, ['blocking', 'responseHeaders']);

browser.tabs.onRemoved.addListener((tabId, info) => {
  setTimeout(() => handedOff.delete(tabId), HANDED_OFF_MS);
  // Not on closing a window, which may be reopened with its tabs.
  if (!info.isWindowClosing) tidy();
});

// ---- Containers made here -------------------------------------------------------

// Remove containers made here once they have no tabs and nothing to keep:
// signed out, or signed in to an account another jar also has. A container
// alone in holding its account stays, so the account list can still open it.
let tidying = null;
function tidy() {
  clearTimeout(tidying);
  tidying = setTimeout(async () => {
    const [made, all] = await Promise.all([stored(MADE_KEY, []), jars()]);
    const used = await Promise.all(all.map(async (j) => j.cookieStoreId === DEFAULT_STORE
      || !made.includes(j.cookieStoreId)
      || (await browser.tabs.query({ cookieStoreId: j.cookieStoreId }).catch(() => [])).length > 0));
    const kept = new Set(all.filter((j, i) => used[i] && j.userId).map((j) => j.userId));
    for (const [i, j] of all.entries()) {
      if (used[i]) continue;
      if (!j.userId || kept.has(j.userId)) {
        await browser.contextualIdentities.remove(j.cookieStoreId).catch(() => {});
      } else {
        kept.add(j.userId);
      }
    }
  }, 1000);
}

// A page reports who it is signed in as, read off Instagram's own menu, with
// the user id it was loaded as. Ignored if the jar has moved on since.
async function noteViewer(storeId, pageUserId, username, pic) {
  const userId = await userIn(storeId);
  if (!userId || userId !== pageUserId || !/^[\w.]+$/.test(username)) return;
  const accounts = await stored(ACCOUNTS_KEY, {});
  const prev = accounts[userId] || {};
  if (prev.username !== username || (pic && prev.pic !== pic)) {
    accounts[userId] = { username, pic: pic || prev.pic || null };
    await browser.storage.local.set({ [ACCOUNTS_KEY]: accounts });
  }
  const made = await stored(MADE_KEY, []);
  if (!made.includes(storeId)) return; // never rename someone else's container
  const name = '@' + username;
  try {
    const ci = await browser.contextualIdentities.get(storeId);
    if (ci.name !== name) await browser.contextualIdentities.update(storeId, { name });
  } catch (_) {}
}

browser.runtime.onMessage.addListener((m, sender) => {
  const tab = sender.tab;
  const store = tab ? tab.cookieStoreId || DEFAULT_STORE : null;
  switch (m && m.type) {
    case 'whoami':
      return userIn(store).then((userId) => ({ userId }));
    case 'viewer':
      return noteViewer(store, m.userId, m.username, m.pic);
    case 'list':
      return Promise.all([listAccounts(), queryContainers()]).then(([accounts, cis]) => ({ accounts, containers: !!cis }));
    case 'open':
      return openTab(m.storeId, m.after).then(() => true);
  }
  return undefined;
});

// Tell a jar's Instagram tabs when its account changes anyway (a tab alone
// in its jar switching, signing in or out), so pages loaded for the old
// account reload.
const pending = new Map();
browser.cookies.onChanged.addListener(({ removed, cookie, cause }) => {
  if (cookie.name !== 'sessionid') return;
  if (!/(^|\.)instagram\.com$/.test(cookie.domain)) return;
  if (removed && cause === 'overwrite') return; // the new value follows
  const storeId = cookie.storeId;
  clearTimeout(pending.get(storeId));
  pending.set(storeId, setTimeout(async () => {
    pending.delete(storeId);
    const userId = await userIn(storeId);
    for (const t of await igTabs(storeId)) browser.tabs.sendMessage(t.id, { type: 'account', userId }).catch(() => {});
  }, 200));
});

if (hasContainers()) {
  // Forget containers made here once they are removed.
  browser.contextualIdentities.onRemoved.addListener(async ({ contextualIdentity }) => {
    const made = await stored(MADE_KEY, []);
    if (made.includes(contextualIdentity.cookieStoreId)) {
      await browser.storage.local.set({ [MADE_KEY]: made.filter((s) => s !== contextualIdentity.cookieStoreId) });
    }
  });
}
