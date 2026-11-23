// End-to-end check of accounts in containers (background.js, accounts.js,
// popup.js) in a real Firefox, over WebDriver BiDi. Instagram's pages are
// stubbed (nothing goes to the network) and its cookies are fake.
//
//   node tests/accounts.test.mjs [path to firefox]     (Node 22+, for WebSocket)
//
// BiDi can't open extension pages, so the extension is staged into a temp
// directory with one extra line that opens popup.html itself; scripts run
// there have the extension's APIs.
import { spawn } from 'node:child_process';
import { copyFileSync, appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIREFOX = process.argv[2] || (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');
const EXT = mkdtempSync(join(tmpdir(), 'acct-ext-'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const files = new Set(['manifest.json', 'popup.html', 'popup.js', 'popup.css', ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap((c) => [...c.js, ...(c.css || [])]), ...Object.values(manifest.icons)]);
for (const f of files) copyFileSync(join(ROOT, f), join(EXT, f));
appendFileSync(join(EXT, 'background.js'), "\nbrowser.tabs.create({ url: 'popup.html?test' });\n");
const UUID = '11111111-2222-3333-4444-555555555555';
const PORT = 9337;
const profile = mkdtempSync(join(tmpdir(), 'acct-test-'));
writeFileSync(join(profile, 'user.js'), [
  `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ 'here-for-instagram@extension': UUID }))});`,
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
].join('\n'));
const ff = spawn(FIREFOX,
  ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(PORT)], { stdio: 'ignore', env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  try {
    ws = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    break;
  } catch { ws = null; }
}
if (!ws) throw new Error('no BiDi');
let nextId = 1;
const waiting = new Map();
const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    const { res, rej } = waiting.get(m.id);
    waiting.delete(m.id);
    m.type === 'error' ? rej(new Error(m.error + ': ' + m.message)) : res(m.result);
  } else if (m.method) listeners.forEach((l) => l(m));
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = nextId++;
  waiting.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});

const STUB = `<!doctype html><html><head><title>IG stub</title></head><body>
<div id="menu">
  <div><a href="/"><svg aria-label="Home" width="24" height="24"></svg></a></div>
  <div><a href="/explore/">Explore</a></div><div><a href="/reels/">Reels</a></div>
  <div><a href="/direct/">Messages</a></div><div><a href="/notifications/">Notifications</a></div>
  <div><a href="/USER/"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">Profile</a></div>
</div><main></main></body></html>`;
let stubUser = 'alice';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

try {
  await send('session.new', { capabilities: {} });
  await send('session.subscribe', { events: ['network.beforeRequestSent', 'browsingContext.load'] });
  await send('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: 'www.instagram.com' }] });
  const loads = [];
  listeners.push((m) => {
    if (m.method === 'network.beforeRequestSent' && m.params.isBlocked) {
      const html = STUB.replace('USER', stubUser);
      send('network.provideResponse', {
        request: m.params.request.request,
        statusCode: 200,
        reasonPhrase: 'OK',
        headers: [{ name: 'content-type', value: { type: 'string', value: 'text/html; charset=utf-8' } }],
        body: { type: 'string', value: html },
      }).catch((e) => console.log('provideResponse', e.message));
    }
    if (m.method === 'browsingContext.load') loads.push({ context: m.params.context, url: m.params.url, t: Date.now() });
  });

  const ext = await send('webExtension.install', { extensionData: { type: 'path', path: EXT } });
  check('extension installs', !!ext.extension, ext.extension);

  await sleep(1500);
  const tree = await send('browsingContext.getTree', {});
  const extCtx = tree.contexts.find((c) => c.url.startsWith('moz-extension://'));
  if (!extCtx) throw new Error('no extension tab: ' + JSON.stringify(tree.contexts.map((c) => c.url)));
  const ctl = extCtx.context;
  const evalIn = async (context, expression) => {
    const r = await send('script.evaluate', { expression: `(async () => JSON.stringify(await (async () => { ${expression} })()))()`, target: { context }, awaitPromise: true });
    if (r.type === 'exception') throw new Error(JSON.stringify(r.exceptionDetails.text));
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
  const inExt = (expr) => evalIn(ctl, expr);

  // Signed in as 123 in the default jar.
  await inExt(`
    const url = 'https://www.instagram.com/';
    await browser.cookies.set({ url, name: 'sessionid', value: '123%3Aabc%3A1', secure: true, httpOnly: true, domain: '.instagram.com', expirationDate: Date.now()/1000 + 86400 });
    await browser.cookies.set({ url, name: 'ds_user_id', value: '123', secure: true, domain: '.instagram.com', expirationDate: Date.now()/1000 + 86400 });
    await browser.cookies.set({ url, name: 'csrftoken', value: 'tok', secure: true, domain: '.instagram.com', sameSite: 'lax', expirationDate: Date.now()/1000 + 86400 });
  `);
  let list = await inExt(`return browser.runtime.sendMessage({ type: 'list' })`);
  check('list: default jar account', list.containers && list.accounts.length === 1 && list.accounts[0].userId === '123' && list.accounts[0].storeId === 'firefox-default', JSON.stringify(list));

  // A default-jar Instagram tab.
  const tabA = tree.contexts.find((c) => c.context !== ctl).context;
  await send('browsingContext.navigate', { context: tabA, url: 'https://www.instagram.com/', wait: 'complete' });
  await sleep(1500);
  const accounts1 = await inExt(`return (await browser.storage.local.get('sinsta-accounts'))['sinsta-accounts']`);
  check('viewer reported for default jar', accounts1 && accounts1['123'] && accounts1['123'].username === 'alice', JSON.stringify(accounts1));

  // New container, seeded from the default jar.
  stubUser = 'alice';
  await inExt(`return browser.runtime.sendMessage({ type: 'new', from: 'firefox-default' })`);
  await sleep(2000);
  const state = await inExt(`
    const made0 = (await browser.storage.local.get('sinsta-containers'))['sinsta-containers'] || [];
    const cis = (await browser.contextualIdentities.query({})).filter((c) => made0.includes(c.cookieStoreId));
    const store = cis[0] && cis[0].cookieStoreId;
    const cookies = store ? await browser.cookies.getAll({ domain: 'instagram.com', storeId: store }) : [];
    const made = (await browser.storage.local.get('sinsta-containers'))['sinsta-containers'];
    const tabs = await browser.tabs.query({ cookieStoreId: store });
    return { cis: cis.map((c) => ({ name: c.name, store: c.cookieStoreId })), cookies: cookies.map((c) => [c.name, c.value, c.httpOnly, c.domain]), made, tabs: tabs.map((t) => t.url) };
  `);
  check('container created and recorded', state.cis.length === 1 && state.made && state.made[0] === state.cis[0].store, JSON.stringify(state.cis));
  const sess = state.cookies.find((c) => c[0] === 'sessionid');
  check('cookies copied (httpOnly kept)', state.cookies.length === 3 && sess && sess[2] === true && sess[3] === '.instagram.com', JSON.stringify(state.cookies));
  check('tab opened in container', state.tabs.length === 1 && state.tabs[0].startsWith('https://www.instagram.com/'), JSON.stringify(state.tabs));
  check('container named after its account', state.cis[0] && state.cis[0].name === '@alice', state.cis[0] && state.cis[0].name);
  const store = state.cis[0].store;

  list = await inExt(`return browser.runtime.sendMessage({ type: 'list' })`);
  check('list: both jars', list.accounts.length === 2 && list.accounts.every((a) => a.username === 'alice'), JSON.stringify(list.accounts.map((a) => [a.storeId, a.username, a.container])));

  // Switch the container to account 456 ("bob"): only its tabs should reload.
  const tree2 = await send('browsingContext.getTree', {});
  const tabB = tree2.contexts.find((c) => c.context !== ctl && c.context !== tabA && c.url.startsWith('https://www.instagram.com')).context;
  await evalIn(tabA, `window.__mark = 1`);
  await evalIn(tabB, `window.__mark = 1`);
  await send('browsingContext.activate', { context: tabB });
  stubUser = 'bob';
  await inExt(`
    const url = 'https://www.instagram.com/';
    await browser.cookies.set({ url, name: 'sessionid', value: '456%3Adef%3A1', secure: true, httpOnly: true, domain: '.instagram.com', storeId: '${store}', expirationDate: Date.now()/1000 + 86400 });
    await browser.cookies.set({ url, name: 'ds_user_id', value: '456', secure: true, domain: '.instagram.com', storeId: '${store}', expirationDate: Date.now()/1000 + 86400 });
  `);
  await sleep(4500);
  const markA = await evalIn(tabA, `return window.__mark || null`);
  const markB = await evalIn(tabB, `return window.__mark || null`);
  check('default-jar tab untouched by container switch', markA === 1);
  check('container tab reloaded after its account changed', markB === null);
  await sleep(1500);
  const ci = await inExt(`return (await browser.contextualIdentities.get('${store}')).name`);
  check('container renamed to new account', ci === '@bob', ci);
  list = await inExt(`return browser.runtime.sendMessage({ type: 'list' })`);
  check('list: two accounts', list.accounts.map((a) => a.username).sort().join() === 'alice,bob', JSON.stringify(list.accounts.map((a) => a.username)));

  // Hidden tab: reloads only once shown again.
  await evalIn(tabA, `window.__mark = 2`);
  await send('browsingContext.activate', { context: tabB }); // tabA in background
  const hiddenA = await evalIn(tabA, `return document.hidden`);
  await inExt(`
    await browser.cookies.set({ url: 'https://www.instagram.com/', name: 'ds_user_id', value: '789', secure: true, domain: '.instagram.com', expirationDate: Date.now()/1000 + 86400 });
    await browser.cookies.set({ url: 'https://www.instagram.com/', name: 'sessionid', value: '789%3Aghi%3A1', secure: true, httpOnly: true, domain: '.instagram.com', expirationDate: Date.now()/1000 + 86400 });
  `);
  await sleep(4000);
  const stillA = await evalIn(tabA, `return window.__mark || null`);
  check('hidden tab waits', !hiddenA || stillA === 2, `hidden=${hiddenA}`);
  await send('browsingContext.activate', { context: tabA });
  await sleep(1500);
  const afterA = await evalIn(tabA, `return window.__mark || null`);
  check('hidden tab reloads when shown', afterA === null);

  // Popup renders the accounts.
  await evalIn(ctl, `location.reload()`).catch(() => {});
  await sleep(1000);
  const popup = await inExt(`return [...document.querySelectorAll('#accounts .name')].map((e) => e.textContent).concat(document.getElementById('new').hidden ? 'new hidden' : 'new shown')`);
  console.log('popup:', popup.join(' | '));
} catch (e) {
  console.log('ERROR', e.stack || e.message);
  failures++;
} finally {
  try { await send('session.end'); } catch {}
  ff.kill();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
