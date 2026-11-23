// End-to-end check of accounts kept apart in containers (background.js,
// accounts.js, popup.js) in a real Firefox, over WebDriver BiDi. Instagram is
// stubbed (nothing goes to the network): its pages show the account named by
// the request's session cookie, and POST /switch?to=<id> answers with the
// cookies of a sign-in to that account, as its account switcher's does.
//
//   node tests/accounts.test.mjs [path to firefox]     (Node 22+, for WebSocket)
//
// BiDi can't open extension pages, so the extension is staged into a temp
// directory with one extra line that opens popup.html itself; scripts run
// there have the extension's APIs. The stub is a local proxy that answers
// for www.instagram.com itself over TLS with a throwaway certificate (BiDi's
// own stubbed responses bypass webRequest, which the extension relies on).
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
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
const PROXY_PORT = 9338;
const profile = mkdtempSync(join(tmpdir(), 'acct-test-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=www.instagram.com',
  '-keyout', join(profile, 'stub.key'), '-out', join(profile, 'stub.crt')], { stdio: 'ignore' });
writeFileSync(join(profile, 'user.js'), [
  'user_pref("network.proxy.type", 1);',
  'user_pref("network.proxy.ssl", "127.0.0.1");',
  `user_pref("network.proxy.ssl_port", ${PROXY_PORT});`,
  'user_pref("network.proxy.http", "127.0.0.1");',
  `user_pref("network.proxy.http_port", ${PROXY_PORT});`,
  'user_pref("network.proxy.no_proxies_on", "");',
  `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ 'here-for-instagram@extension': UUID }))});`,
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
].join('\n'));

const USERS = { 123: 'alice', 456: 'bob', 789: 'carol' };
const session = (id) => `${id}%3Aabc${id}%3A1`;
const STUB = `<!doctype html><html><head><title>IG stub</title></head><body>
<div id="menu">
  <div><a href="/"><svg aria-label="Home" width="24" height="24"></svg></a></div>
  <div><a href="/explore/">Explore</a></div><div><a href="/reels/">Reels</a></div>
  <div><a href="/direct/">Messages</a></div><div><a href="/notifications/">Notifications</a></div>
  <div><a href="/USER/"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">Profile</a></div>
</div><main></main></body></html>`;

const stub = createHttpsServer({ key: readFileSync(join(profile, 'stub.key')), cert: readFileSync(join(profile, 'stub.crt')) }, (req, res) => {
  const url = new URL(req.url, 'https://www.instagram.com');
  const sid = ((req.headers.cookie || '').match(/(?:^|; )sessionid=([^;]+)/) || [])[1];
  const user = sid ? USERS[decodeURIComponent(sid).split(':')[0]] : null;
  if (url.pathname === '/switch') {
    const to = url.searchParams.get('to');
    const exp = new Date(Date.now() + 86400e3).toUTCString();
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': [
        `sessionid=${session(to)}; Domain=.instagram.com; Path=/; Expires=${exp}; Secure; HttpOnly; SameSite=Lax`,
        `ds_user_id=${to}; Domain=.instagram.com; Path=/; Max-Age=86400; Secure; SameSite=Lax`,
      ],
    });
    res.end('{"status":"ok"}');
    return;
  }
  if (url.pathname !== '/') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(STUB.replace('USER', user || 'nobody'));
});
const proxy = createHttpServer((req, res) => res.writeHead(403).end());
proxy.on('connect', (req, socket) => {
  if (!req.url.startsWith('www.instagram.com:')) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  stub.emit('connection', socket);
});
await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));

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

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

try {
  await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });

  const ext = await send('webExtension.install', { extensionData: { type: 'path', path: EXT } });
  check('extension installs', !!ext.extension, ext.extension);
  await sleep(1500);

  const evalIn = async (context, expression) => {
    const r = await send('script.evaluate', { expression: `(async () => JSON.stringify(await (async () => { ${expression} })()))()`, target: { context }, awaitPromise: true });
    if (r.type === 'exception') throw new Error(JSON.stringify(r.exceptionDetails.text));
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
  const contexts = async () => (await send('browsingContext.getTree', { maxDepth: 0 })).contexts;
  const ctl = (await contexts()).find((c) => c.url.startsWith('moz-extension://')).context;
  const inExt = (expr) => evalIn(ctl, expr);

  // The extension's view: jars with their account, and tabs with their jar.
  const state = () => inExt(`
    const made = (await browser.storage.local.get('sinsta-containers'))['sinsta-containers'] || [];
    const cis = (await browser.contextualIdentities.query({})).filter((c) => made.includes(c.cookieStoreId));
    const user = async (storeId) => {
      const c = await browser.cookies.get({ url: 'https://www.instagram.com/', name: 'sessionid', storeId });
      return c ? decodeURIComponent(c.value).split(':')[0] : null;
    };
    const tabs = await browser.tabs.query({ url: '*://www.instagram.com/*' });
    return {
      def: await user('firefox-default'),
      cs: await Promise.all(cis.map(async (c) => ({ id: c.cookieStoreId, name: c.name, user: await user(c.cookieStoreId) }))),
      tabs: tabs.map((t) => ({ index: t.index, store: t.cookieStoreId })),
    };
  `);
  // A new Instagram tab in a jar, and the browsing context for it.
  async function newTab(storeId) {
    const before = new Set((await contexts()).map((c) => c.context));
    await inExt(`await browser.tabs.create({ url: 'https://www.instagram.com/', cookieStoreId: '${storeId}' })`);
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const c = (await contexts()).find((x) => !before.has(x.context) && x.url.startsWith('https://www.instagram.com'));
      if (c) {
        await sleep(1000); // content scripts
        await evalIn(c.context, `window.__mark = 1`);
        return c.context;
      }
    }
    throw new Error('tab did not open');
  }
  const alive = async (ctx) => (await contexts()).some((c) => c.context === ctx);
  const marked = async (ctx) => (await alive(ctx)) && (await evalIn(ctx, `return window.__mark || null`)) === 1;
  const switchIn = (ctx, to) => evalIn(ctx, `await fetch('/switch?to=${to}', { method: 'POST' }); return true`);

  // Signed in as alice in the default jar, in two tabs.
  await inExt(`await browser.cookies.set({ url: 'https://www.instagram.com/', name: 'sessionid', value: '${session(123)}', secure: true, httpOnly: true, domain: '.instagram.com', expirationDate: Date.now()/1000 + 86400 });
    await browser.cookies.set({ url: 'https://www.instagram.com/', name: 'ds_user_id', value: '123', secure: true, domain: '.instagram.com', expirationDate: Date.now()/1000 + 86400 });
    await browser.cookies.set({ url: 'https://www.instagram.com/', name: 'ig_did', value: 'device', secure: true, httpOnly: true, domain: '.instagram.com', expirationDate: Date.now()/1000 + 86400 });`);
  const a1 = await newTab('firefox-default');
  const a2 = await newTab('firefox-default');
  const accounts = await inExt(`return (await browser.storage.local.get('sinsta-accounts'))['sinsta-accounts']`);
  check('page names its account', accounts && accounts['123'] && accounts['123'].username === 'alice', JSON.stringify(accounts));

  // 1. a2 switches to bob: it moves to a new container; a1 stays alice.
  await switchIn(a2, 456);
  await sleep(2500);
  let st = await state();
  check('1: default jar keeps alice', st.def === '123', st.def);
  check('1: new container for bob', st.cs.length === 1 && st.cs[0].user === '456', JSON.stringify(st.cs));
  const bobJar = st.cs[0] && st.cs[0].id;
  const copied = await inExt(`return (await browser.cookies.getAll({ domain: 'instagram.com', storeId: '${bobJar}' })).map((c) => c.name + '=' + c.value + (c.httpOnly ? ' httponly' : '')).sort()`);
  check('1: its cookies: the device copied, the sign-in applied', JSON.stringify(copied) === JSON.stringify(['ds_user_id=456', 'ig_did=device httponly', `sessionid=${session(456)} httponly`]), JSON.stringify(copied));
  check('1: switching tab reopened there', !(await alive(a2)) && st.tabs.filter((t) => t.store === bobJar).length === 1, JSON.stringify(st.tabs));
  check('1: other tab untouched', await marked(a1));
  check('1: container named after bob', st.cs[0] && st.cs[0].name === '@bob', st.cs[0] && st.cs[0].name);

  // 2. Another alice tab switches to bob: it joins bob's container.
  const a3 = await newTab('firefox-default');
  await switchIn(a3, 456);
  await sleep(2500);
  st = await state();
  check('2: reuses bob\'s container', st.cs.length === 1 && st.tabs.filter((t) => t.store === bobJar).length === 2, JSON.stringify(st));
  check('2: alice tab untouched', st.def === '123' && await marked(a1));

  // 3. A bob tab switches to alice: it joins the default jar.
  const bobTabs = (await contexts()).filter((c) => c.context !== a1 && c.url.startsWith('https://www.instagram.com'));
  const b1 = bobTabs[0].context;
  const b2 = bobTabs[1].context;
  await evalIn(b1, `window.__mark = 1`);
  await evalIn(b2, `window.__mark = 1`);
  await switchIn(b2, 123);
  await sleep(2500);
  st = await state();
  check('3: joins the default jar, no new container', st.cs.length === 1 && st.tabs.filter((t) => t.store === 'firefox-default').length === 2, JSON.stringify(st));
  check('3: bob\'s container keeps bob, its tab untouched', st.cs[0].user === '456' && await marked(b1));

  // 4. A tab alone in its jar switches as on Instagram: no move.
  await send('browsingContext.activate', { context: b1 }); // hidden tabs reload only once shown
  await switchIn(b1, 789);
  await sleep(4500);
  st = await state();
  check('4: alone in its jar: the jar switches', st.cs.length === 1 && st.cs[0].user === '789' && await alive(b1), JSON.stringify(st.cs));
  check('4: and the tab reloads', !(await marked(b1)));
  await sleep(1000);
  st = await state();
  check('4: container renamed', st.cs[0].name === '@carol', st.cs[0].name);

  // 5. Closing it keeps the container: only it has carol.
  await send('browsingContext.close', { context: b1 });
  await sleep(2000);
  st = await state();
  check('5: last holder of an account kept', st.cs.length === 1, JSON.stringify(st.cs));

  // 6. A spare container (empty, account held elsewhere) is removed.
  const c2 = await newTab(st.cs[0].id);
  await switchIn(c2, 123); // alone: the container becomes alice, like the default jar
  await sleep(2500);
  await send('browsingContext.close', { context: c2 });
  await sleep(2500);
  st = await state();
  check('6: spare container removed', st.cs.length === 0, JSON.stringify(st.cs));

  // Popup lists the accounts.
  await evalIn(ctl, `location.reload()`).catch(() => {});
  await sleep(1000);
  const popup = await inExt(`return [...document.querySelectorAll('#accounts .name')].map((e) => e.textContent)`);
  check('popup lists accounts', popup.join() === '@alice', popup.join(' | '));
} catch (e) {
  console.log('ERROR', e.stack || e.message);
  failures++;
} finally {
  try { await send('session.end'); } catch {}
  ff.kill();
  proxy.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
