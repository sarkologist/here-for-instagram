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
// Instagram. Tabs opened from a tab stay in its container, so on its account;
// a tab opened afresh goes to the jar of the Instagram tab last looked at.
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
const IG_TABS = ['*://www.instagram.com/*'];
const HANDED_OFF_MS = 10000;
// Containers made here look like ordinary tabs: the tab bar's line takes
// the toolbar's own colour.
const LOOK = { color: 'toolbar', icon: 'circle' };

const hasContainers = () => !!browser.contextualIdentities;

// ---- Diagnostics (temporary, while switching is worked out) ------------------
// What happens around account switches, for the popup's "Copy diagnostics":
// paths without query strings, cookie names, and the account id a session
// cookie names. No cookie values.
const LOG_KEY = 'sinsta-switch-log';
let log = null;
let logTimer = 0;
const logLoaded = browser.storage.local.get(LOG_KEY).then((r) => { log = (r[LOG_KEY] || []).concat(log || []); });
function note(event) {
  (log || (log = [])).push({ t: new Date().toISOString().slice(11, 23), ...event });
  if (log.length > 400) log = log.slice(-400);
  clearTimeout(logTimer);
  logTimer = setTimeout(() => logLoaded.then(() => browser.storage.local.set({ [LOG_KEY]: log })), 300);
}
const pathOf = (url) => {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.instagram.com', '') + u.pathname;
  } catch (_) {
    return '?';
  }
};
const AUTH_PATH = /log(in|out)|switch|one_?tap|accounts|session|nonce/i;

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

// Tabs opened here, which go where they're put (see "New tabs" below).
const ours = new Set();

// A tab opened at `url` in a jar. It opens blank first, so it's known as ours
// before it asks for Instagram.
async function openTab(storeId, url, props = {}) {
  const tab = await browser.tabs.create({ url: 'about:blank', cookieStoreId: storeId, ...props });
  ours.add(tab.id);
  await browser.tabs.update(tab.id, { url });
  return tab;
}

// Reopen a tab in another jar where it was and as it was: pinned, muted, in
// its group, under the same opener. The closed copy is forgotten, so undoing
// a closed tab doesn't bring it back on the old account.
async function reopen(tab, storeId, url) {
  const props = { windowId: tab.windowId, index: tab.index + 1, active: tab.active, pinned: tab.pinned };
  if (tab.openerTabId !== undefined) props.openerTabId = tab.openerTabId;
  const opened = await openTab(storeId, url, props);
  if (tab.mutedInfo && tab.mutedInfo.muted) await browser.tabs.update(opened.id, { muted: true }).catch(() => {});
  if (tab.groupId !== undefined && tab.groupId !== -1 && browser.tabs.group) {
    await browser.tabs.group({ groupId: tab.groupId, tabIds: [opened.id] }).catch(() => {});
  }
  await browser.tabs.remove(tab.id).catch(() => {});
  forgetClosed(tab).catch(() => {});
  return opened;
}

// Firefox records a closed tab a moment after it closes.
async function forgetClosed(tab) {
  if (!browser.sessions) return;
  const since = Date.now() - 1000;
  for (let i = 0; i < 20; i++) {
    const recent = await browser.sessions.getRecentlyClosed({ maxResults: 5 });
    const s = recent.find((r) => r.tab && r.tab.url === tab.url && r.tab.windowId === tab.windowId && (r.lastModified < 1e12 ? r.lastModified * 1000 : r.lastModified) >= since);
    if (s) return browser.sessions.forgetClosedTab(tab.windowId, s.tab.sessionId);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function makeContainer() {
  const ci = await browser.contextualIdentities.create({ name: 'Instagram', ...LOOK });
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
  const opened = await reopen(tab, storeId, ORIGIN + '/');
  note({ ev: 'handoff', from, to: storeId, reused: !!target, oldTab: tab.id, newTab: opened.id });
}

browser.webRequest.onBeforeRequest.addListener((d) => {
  if (AUTH_PATH.test(new URL(d.url).pathname)) {
    note({ ev: 'request', method: d.method, path: pathOf(d.url), type: d.type, tab: d.tabId, store: d.cookieStoreId });
  }
}, { urls: ['*://*.instagram.com/*'] });

function onHeaders(d) {
  const lines = setCookieLines(d.responseHeaders);
  if (!lines.length) return {};
  const auth = lines.map(parseSetCookie).filter((c) => c && (c.name === 'sessionid' || c.name === 'ds_user_id'));
  if (auth.length || AUTH_PATH.test(new URL(d.url).pathname)) {
    note({
      ev: 'response', status: d.statusCode, path: pathOf(d.url), type: d.type, tab: d.tabId, store: d.cookieStoreId,
      sets: lines.map((l) => {
        const c = parseSetCookie(l);
        if (!c) return '?';
        const gone = !c.value || (c.expires !== undefined && c.expires <= Date.now() / 1000);
        const who = c.name === 'sessionid' ? '(' + (userOfSession(c.value) || 'no id') + ')' : c.name === 'ds_user_id' ? '(' + c.value + ')' : '';
        return c.name + who + (gone ? ' DELETED' : '');
      }),
    });
  }
  const decide = (why, result) => {
    if (auth.length) note({ ev: 'decision', path: pathOf(d.url), tab: d.tabId, why });
    return result;
  };
  const strip = () => ({ responseHeaders: d.responseHeaders.filter((h) => h.name.toLowerCase() !== 'set-cookie') });
  // Late responses for a tab already moved out must not change its old jar.
  const off = handedOff.get(d.tabId);
  if (off && Date.now() - off < HANDED_OFF_MS) return decide('stripped: tab handed off', strip());
  const cookies = lines.map(parseSetCookie).filter(Boolean);
  const session = cookies.find((c) => c.name === 'sessionid');
  const ds = cookies.find((c) => c.name === 'ds_user_id');
  const userId = session && session.value
    && (userOfSession(session.value) || (ds && /^\d+$/.test(ds.value) ? ds.value : null));
  if (!userId) return decide('pass: no sign-in', {}); // signing out stays as on Instagram
  return (async () => {
    const storeId = d.cookieStoreId || DEFAULT_STORE;
    const current = await userIn(storeId);
    if (!current) return decide('pass: jar signed out', {});
    if (current === userId) return decide('pass: same account', {});
    const tab = await switchingTab(d, storeId);
    if (!tab || tab.cookieStoreId !== storeId) return decide('pass: no tab', {});
    const others = (await igTabs(storeId)).filter((t) => t.id !== tab.id);
    if (!others.length) return decide('pass: alone in jar', {});
    if (!await queryContainers()) return decide('pass: containers off', {});
    const host = new URL(d.url).hostname;
    // Should moving fail, switch the jar after all, as Instagram would.
    handOff(tab, storeId, userId, cookies, host).catch((e) => {
      note({ ev: 'handoff failed', error: String(e) });
      return applyCookies(cookies, host, storeId);
    });
    return decide(`moving tab ${tab.id} from ${current} to ${userId}`, strip());
  })();
}

browser.webRequest.onHeadersReceived.addListener(onHeaders, { urls: ['*://*.instagram.com/*'] }, ['blocking', 'responseHeaders']);

browser.tabs.onRemoved.addListener((tabId, info) => {
  setTimeout(() => handedOff.delete(tabId), HANDED_OFF_MS);
  ours.delete(tabId);
  // Not on closing a window, which may be reopened with its tabs.
  if (!info.isWindowClosing) tidy();
});

// ---- New tabs ---------------------------------------------------------------------
// On Instagram a new tab opens on the account last switched to. Here, a tab
// that opens Instagram afresh (typed into a new tab, a bookmark, a link from
// another site or app) opens on the account of the Instagram tab last looked
// at. Tabs opened from an Instagram tab keep its account, and a tab already
// showing a page stays where it is, so its back history isn't lost.

const LAST_KEY = 'sinsta-last-used'; // { storeId, userId } of the Instagram tab last looked at
const FRESH = /^about:(blank|newtab|home)$/;
const isIg = (url) => /^https?:\/\/www\.instagram\.com\//.test(url || '');
let lastUsed = null;

async function ourJar(storeId) {
  return storeId === DEFAULT_STORE || (await stored(MADE_KEY, [])).includes(storeId);
}

async function noteUsed(tab) {
  if (!tab || tab.incognito || !isIg(tab.url)) return;
  const storeId = tab.cookieStoreId || DEFAULT_STORE;
  if (!await ourJar(storeId)) return; // someone's own container: theirs to manage
  const userId = await userIn(storeId);
  if (!userId) return;
  if (!lastUsed) lastUsed = await stored(LAST_KEY, {});
  if (lastUsed.storeId === storeId && lastUsed.userId === userId) return;
  lastUsed = { storeId, userId };
  await browser.storage.local.set({ [LAST_KEY]: lastUsed });
}

browser.tabs.onActivated.addListener(({ tabId }) => browser.tabs.get(tabId).then(noteUsed, () => {}));
browser.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active) noteUsed(tab); }, { urls: IG_TABS, properties: ['url'] });
browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId < 0) return;
  browser.tabs.query({ windowId, active: true }).then(([t]) => noteUsed(t), () => {});
});

// The jar of the account last used: its tab's jar, or, should that be gone,
// another signed in to the same account.
async function lastUsedJar() {
  const last = lastUsed || (lastUsed = await stored(LAST_KEY, {}));
  if (!last.storeId) return null;
  const all = await jars();
  return all.find((j) => j.cookieStoreId === last.storeId && j.userId)
    || all.find((j) => j.userId === last.userId) || null;
}

browser.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0 || ours.has(d.tabId) || (d.cookieStoreId && d.cookieStoreId !== DEFAULT_STORE)) return {};
  return (async () => {
    const tab = await browser.tabs.get(d.tabId).catch(() => null);
    if (!tab || tab.incognito || !FRESH.test(tab.url)) return {};
    if (tab.openerTabId !== undefined) {
      const opener = await browser.tabs.get(tab.openerTabId).catch(() => null);
      if (opener && isIg(opener.url)) return {}; // opened from Instagram: on its account
    }
    const [jar, here] = await Promise.all([lastUsedJar(), userIn(DEFAULT_STORE)]);
    if (!jar || jar.cookieStoreId === DEFAULT_STORE || jar.userId === here) return {};
    if (!await queryContainers()) return {};
    note({ ev: 'follow', tab: tab.id, to: jar.cookieStoreId });
    reopen(tab, jar.cookieStoreId, d.url).catch(() => {
      ours.add(tab.id); // open it here after all
      browser.tabs.update(tab.id, { url: d.url }).catch(() => {});
    });
    return { cancel: true };
  })();
}, { urls: IG_TABS, types: ['main_frame'] }, ['blocking']);

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
    if (ci.name !== name || ci.color !== LOOK.color) await browser.contextualIdentities.update(storeId, { name, ...LOOK });
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
    case 'open': {
      const at = m.after ? { windowId: m.after.windowId, index: m.after.index + 1 } : {};
      return openTab(m.storeId, ORIGIN + '/', at).then(() => true);
    }
    case 'log':
      return logLoaded.then(() => log);
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
  note({ ev: 'cookie', store: cookie.storeId, removed, cause, user: removed ? null : userOfSession(cookie.value) });
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
