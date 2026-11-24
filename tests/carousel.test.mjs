// Scrolling over a multi-photo post's photos steps through them, in
// Playwright's Firefox, with the extension's content scripts on a stand-in for
// instagram.com. The stand-in carousel works like Instagram's: its arrows are
// buttons labelled "Next" and "Go back", each gone at its end.
//
// Usage: cd tests && npm ci && npx playwright install firefox && npm test
// EXT_SRC=dir runs the scripts from dir instead (e.g. an older version).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';

const ROOT = resolve(process.env.EXT_SRC || join(dirname(fileURLToPath(import.meta.url)), '..'));
const ORIGIN = 'https://www.instagram.com';

// Three slides. `wrap` holds the post: an <article> in the feed and in a
// post's window, nothing on a post's own page.
const carousel = `<div class="media">
  <div role="presentation" style="overflow-x:auto"><div><ul>
    <li>one</li><li>two</li><li>three</li>
  </ul></div></div>
</div>`;
const page = (post) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/test/ext/content.css">
<script src="/test/ext/stories.js"></script><script src="/test/ext/content.js"></script><script src="/test/ext/reels.js"></script>
</head><body><main><div>${post}</div></main>
<script>
  window.slide = 0;
  const media = document.querySelector('.media');
  const arrow = (label, step) => {
    const b = document.createElement('button');
    b.setAttribute('aria-label', label);
    b.onclick = () => { window.slide += step; draw(); };
    return b;
  };
  function draw() {
    for (const b of media.querySelectorAll(':scope > button')) b.remove();
    if (window.slide > 0) media.prepend(arrow('Go back', -1));
    if (window.slide < 2) media.append(arrow('Next', 1));
  }
  draw();
</script></body></html>`;
const PAGES = {
  '/nasa/p/Dtest0001/': page(`${carousel}<p class="caption">caption</p>`),
  '/p/Dtest0002/': page(`<article>${carousel}<p class="caption">caption</p></article>`),
  '/explore/': page(carousel),
};

let browser;
let context;
let tab;

before(async () => {
  browser = await firefox.launch();
  context = await browser.newContext();
  tab = await context.newPage();
  tab.on('pageerror', (e) => console.error('page error:', e));
  await tab.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (PAGES[path]) return route.fulfill({ contentType: 'text/html', body: PAGES[path] });
    const ext = path.match(/^\/test\/ext\/([\w.]+)$/);
    if (ext) return route.fulfill({ contentType: ext[1].endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(join(ROOT, ext[1])) });
    return route.fulfill({ status: 401, body: '' });
  });
});
after(() => browser && browser.close());

// Scrolls over `selector` as a mouse wheel (in lines) or a trackpad (in
// pixels) does, past the gap that ends a gesture. Returns the slide shown and
// whether the scroll was kept from the page.
async function wheel(selector, { x = 0, y = 0, lines = true } = {}) {
  await tab.waitForTimeout(400);
  return tab.evaluate(({ selector, x, y, lines }) => {
    const e = new WheelEvent('wheel', { deltaX: x, deltaY: y, deltaMode: lines ? 1 : 0, bubbles: true, cancelable: true });
    document.querySelector(selector).dispatchEvent(e);
    return { slide: window.slide, kept: e.defaultPrevented };
  }, { selector, x, y, lines });
}

for (const [where, path] of [['a post\'s own page', '/nasa/p/Dtest0001/'], ['a post\'s window', '/p/Dtest0002/']]) {
  test(`Mouse wheel steps through the photos on ${where}`, async () => {
    await tab.goto(ORIGIN + path);
    assert.deepEqual(await wheel('li', { y: 3 }), { slide: 1, kept: true });
    assert.deepEqual(await wheel('li', { y: 3 }), { slide: 2, kept: true });
    // Past the last photo, the page scrolls.
    assert.deepEqual(await wheel('li', { y: 3 }), { slide: 2, kept: false });
    assert.deepEqual(await wheel('li', { x: -3 }), { slide: 1, kept: true });
    assert.deepEqual(await wheel('li', { y: -3 }), { slide: 0, kept: true });
  });

  test(`Trackpad swipes on ${where} scroll the photos natively, and not back a page at the ends`, async () => {
    await tab.goto(ORIGIN + path);
    assert.deepEqual(await wheel('li', { x: 40, lines: false }), { slide: 0, kept: false });
    assert.deepEqual(await wheel('li', { x: -40, lines: false }), { slide: 0, kept: true });
    assert.deepEqual(await wheel('li', { y: 40, lines: false }), { slide: 0, kept: false });
  });
}

test('Scrolling over the caption scrolls the page', async () => {
  await tab.goto(`${ORIGIN}/nasa/p/Dtest0001/`);
  assert.deepEqual(await wheel('.caption', { y: 3 }), { slide: 0, kept: false });
});

test('Elsewhere, a carousel outside a post is left alone', async () => {
  await tab.goto(`${ORIGIN}/explore/`);
  assert.deepEqual(await wheel('li', { y: 3 }), { slide: 0, kept: false });
});
