// Accounts in containers.
//
// Instagram keeps one signed-in account per cookie jar. Switching accounts in
// one tab swaps the session cookie under every other tab, whose pages still
// act for the old account and fail ("Sorry, something went wrong"). Firefox
// containers each have their own jar, so tabs in different containers can be
// signed in to different accounts at once.
//
// This script lists the accounts signed in across the default jar and every
// container, opens tabs in them, makes new containers for further accounts,
// names the containers it made after their account, and tells tabs when the
// account under them changed.
'use strict';

const ORIGIN = 'https://www.instagram.com';
const DEFAULT_STORE = 'firefox-default';
const ACCOUNTS_KEY = 'sinsta-accounts'; // user id -> { username, pic }
const MADE_KEY = 'sinsta-containers'; // cookieStoreIds of containers made here
const COLORS = ['blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'];

const hasContainers = () => !!browser.contextualIdentities;

async function stored(key, fallback) {
  return (await browser.storage.local.get(key))[key] || fallback;
}

// The user id signed in to a cookie jar, or null. ds_user_id holds it; the
// session cookie starts with it too, should ds_user_id be missing.
async function userIn(storeId) {
  const get = (name) => browser.cookies.get({ url: ORIGIN + '/', name, storeId }).catch(() => null);
  const [ds, session] = await Promise.all([get('ds_user_id'), get('sessionid')]);
  if (!session) return null;
  if (ds && /^\d+$/.test(ds.value)) return ds.value;
  const id = decodeURIComponent(session.value).split(':')[0];
  return /^\d+$/.test(id) ? id : null;
}

async function containers() {
  if (!hasContainers()) return [];
  try {
    return await browser.contextualIdentities.query({});
  } catch (_) {
    return []; // containers turned off
  }
}

// Every jar with an account signed in: the default one, then containers.
async function listAccounts() {
  const [accounts, made, cis] = await Promise.all([stored(ACCOUNTS_KEY, {}), stored(MADE_KEY, []), containers()]);
  const jars = [{ storeId: DEFAULT_STORE, name: null, colorCode: null }, ...cis];
  const rows = await Promise.all(jars.map(async (j) => {
    const userId = await userIn(j.cookieStoreId || j.storeId);
    if (!userId) return null;
    const a = accounts[userId] || {};
    return {
      storeId: j.cookieStoreId || j.storeId,
      container: j.name,
      colorCode: j.colorCode,
      made: made.includes(j.cookieStoreId),
      userId,
      username: a.username || null,
      pic: a.pic || null,
    };
  }));
  return rows.filter(Boolean);
}

function openTab(storeId, after) {
  const props = { url: ORIGIN + '/', cookieStoreId: storeId };
  if (after) {
    props.windowId = after.windowId;
    props.index = after.index + 1;
  }
  return browser.tabs.create(props);
}

// Copy a jar's Instagram cookies into another, so a new container starts
// signed in to the same account (and Instagram's account switcher there
// knows the same accounts).
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

// A new container for another account, starting as a copy of `from`.
async function newContainer(from, after) {
  const cis = await containers();
  const ci = await browser.contextualIdentities.create({
    name: 'Instagram',
    color: COLORS[cis.length % COLORS.length],
    icon: 'circle',
  });
  const made = await stored(MADE_KEY, []);
  await browser.storage.local.set({ [MADE_KEY]: [...made, ci.cookieStoreId] });
  if (from) await copyCookies(from, ci.cookieStoreId);
  return openTab(ci.cookieStoreId, after);
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
      return listAccounts().then((accounts) => ({ accounts, containers: hasContainers() }));
    case 'open':
      return openTab(m.storeId, m.after).then(() => true);
    case 'new':
      return newContainer(m.from, m.after).then(() => true);
  }
  return undefined;
});

// Tell a jar's Instagram tabs when its account changes (a switch, sign-in or
// sign-out), so pages loaded for the old account can reload. The session
// and ds_user_id cookies change together, so wait for both.
const pending = new Map();
browser.cookies.onChanged.addListener(({ removed, cookie, cause }) => {
  if (cookie.name !== 'ds_user_id' && cookie.name !== 'sessionid') return;
  if (!/(^|\.)instagram\.com$/.test(cookie.domain)) return;
  if (removed && cause === 'overwrite') return; // the new value follows
  const storeId = cookie.storeId;
  clearTimeout(pending.get(storeId));
  pending.set(storeId, setTimeout(async () => {
    pending.delete(storeId);
    const userId = await userIn(storeId);
    const tabs = await browser.tabs.query({ cookieStoreId: storeId, url: '*://www.instagram.com/*' }).catch(() => []);
    for (const t of tabs) browser.tabs.sendMessage(t.id, { type: 'account', userId }).catch(() => {});
  }, 200));
});

// Forget containers made here once they are removed.
if (hasContainers()) {
  browser.contextualIdentities.onRemoved.addListener(async ({ contextualIdentity }) => {
    const made = await stored(MADE_KEY, []);
    if (made.includes(contextualIdentity.cookieStoreId)) {
      await browser.storage.local.set({ [MADE_KEY]: made.filter((s) => s !== contextualIdentity.cookieStoreId) });
    }
  });
}
