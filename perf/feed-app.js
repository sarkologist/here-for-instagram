// A stand-in for Instagram's home feed, for the perf harness: the parts the
// extension works with, built and behaving as Instagram's do.
//
// - Posts are ~150 elements each (about a dozen buttons, eight icons, ~20
//   text nodes), styled with atomic classes against a couple of thousand
//   rules, as Instagram's are.
// - The list is virtualized: only the posts near the viewport are in the
//   page (about nine), in a flex column whose padding stands in for the
//   rest. Each post's height is measured once, the first time it renders.
// - Pages of posts come from /perf/feed (slowly, as Instagram's do), and the
//   next one is asked for only when a scroll brings the end of the feed near.
// - Videos play while at least half of them shows.
// - Switching view (history.pushState plus popstate, as the extension's
//   go() does) starts that view's feed afresh.
(() => {
  const EST = 700; // px, a post's height before it is measured
  const ABOVE = 1000; // px rendered above the viewport, and below it:
  const BELOW = 1500;
  const ATOMS = 2000; // atomic CSS rules

  const viewOf = () => {
    const v = new URLSearchParams(location.search).get('variant');
    return v === 'following' || v === 'favorites' ? v : 'algo';
  };

  // ---- Styles ---------------------------------------------------------------

  const atoms = [];
  // Declarations that change nothing here, so the layout stays as below: the
  // rules are there for the cost of matching them.
  const PROPS = ['min-width:0', 'touch-action:manipulation', '-webkit-tap-highlight-color:transparent', 'text-decoration-thickness:auto',
    'list-style-position:outside', 'outline-offset:0', 'background-clip:border-box', 'pointer-events:auto', 'overflow-anchor:auto', 'font-kerning:auto'];
  for (let i = 0; i < ATOMS; i++) atoms.push(`.x${i.toString(36)}{${PROPS[i % PROPS.length]}}`);
  let hash = 1;
  const cls = (n = 8) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      hash = (hash * 16807) % 2147483647;
      out.push('x' + (hash % ATOMS).toString(36));
    }
    return out.join(' ');
  };
  const style = document.createElement('style');
  style.textContent = `${atoms.join('\n')}
body { margin: 0; background: #fff; color: #000; font: 14px -apple-system, system-ui, sans-serif; }
a { color: inherit; text-decoration: none; }
button { background: none; border: 0; padding: 0; color: inherit; }
.side { position: fixed; left: 0; top: 0; bottom: 0; width: 244px; border-right: 1px solid #dbdbdb; padding: 8px 12px; box-sizing: border-box; }
.side .ni a { display: flex; gap: 16px; align-items: center; padding: 12px; }
.side .ni img { width: 24px; height: 24px; border-radius: 50%; }
main { margin-left: 244px; display: flex; justify-content: center; }
.col { width: 470px; padding-top: 20px; }
.list { display: flex; flex-direction: column; position: relative; }
article { padding-bottom: 20px; border-bottom: 1px solid #dbdbdb; margin-bottom: 12px; }
.hd { display: flex; align-items: center; gap: 10px; height: 54px; }
.ring img { width: 32px; height: 32px; border-radius: 50%; display: block; }
.who { flex: 1; display: flex; flex-direction: column; }
.follow { color: #0095f6; font-weight: 600; cursor: pointer; }
.media { position: relative; border-radius: 4px; overflow: hidden; background: #efefef; }
.media .ratio { padding-bottom: 125%; }
.media .fill { position: absolute; inset: 0; }
.media img, .media video { width: 100%; height: 100%; object-fit: cover; display: block; }
.acts { display: flex; gap: 14px; padding: 8px 0; }
.acts .gap { flex: 1; }
.acts svg { width: 24px; height: 24px; }
.cap, .likes, .cmts { padding: 2px 0; }
.add textarea { border: 0; resize: none; width: 90%; height: 18px; font: inherit; }
.spin { height: 60px; display: flex; justify-content: center; align-items: center; }
`;
  document.head.append(style);

  // ---- Shell -----------------------------------------------------------------

  const svg = (label, d = 'M4 4h16v16H4z') =>
    `<svg aria-label="${label}" class="${cls(2)}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><title>${label}</title><path d="${d}"></path></svg>`;
  const item = (label, href) =>
    `<div class="ni ${cls(3)}"><span class="${cls(2)}"><a href="${href}" class="${cls(4)}">${svg(label)}<span class="${cls(3)}">${label}</span></a></span></div>`;
  const me = 'perf_me';
  document.getElementById('app').innerHTML = `
<div class="side ${cls(4)}"><div class="${cls(3)}">
  ${item('Home', '/')}${item('Search', '#search')}${item('Explore', '/explore/')}${item('Reels', '/reels/')}
  ${item('Messages', '/direct/inbox/')}${item('Notifications', '#notifications')}${item('New post', '#create')}
  <div class="ni ${cls(3)}"><span class="${cls(2)}"><a href="/${me}/" class="${cls(4)}"><span class="${cls(2)}"><img src="/perf/img/r0/me_150.jpg" alt=""></span><span class="${cls(3)}">Profile</span></a></span></div>
</div></div>
<main role="main" class="${cls(3)}"><div class="col ${cls(4)}"><div class="${cls(3)}"><div class="${cls(3)}"><div class="list ${cls(4)}"></div>
  <div class="spin ${cls(2)}"><svg aria-label="Loading..." viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9" fill="none" stroke="#999"/></svg></div>
</div></div></div></main>`;
  const list = document.querySelector('.list');

  // ---- Posts ---------------------------------------------------------------

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const div = (inner, n = 6) => `<div class="${cls(n)}">${inner}</div>`;
  const btn = (inner, label) => `<div role="button" tabindex="0" class="${cls(5)}"${label ? ` aria-label="${label}"` : ''}>${inner}</div>`;

  function postHTML(p) {
    const u = esc(p.user);
    const author = `<span class="${cls(3)}"><span class="${cls(3)}"><span class="${cls(3)}"><span class="${cls(3)}"><div class="${cls(4)}"><a href="/${u}/" class="${cls(6)}"><span class="${cls(3)}">${u}</span></a></div></span></span></span></span>`;
    const media = p.video
      ? `<video class="${cls(3)}" src="${p.video}" poster="${p.picture}" muted loop playsinline preload="none"></video>`
      : `<img class="${cls(3)}" src="${p.picture}" alt="Photo by ${u}" decoding="async">`;
    return `<div class="${cls(6)}"><div class="${cls(6)}">
<div class="hd ${cls(5)}">
  ${div(`<a href="/${u}/" class="${cls(5)}"><span class="ring ${cls(4)}"><img src="${p.pic}" alt="${u}'s profile picture"></span></a>`, 5)}
  <div class="who ${cls(5)}">${div(`${div(author, 4)}<span class="${cls(3)}"><span class="${cls(2)}"> • </span><a href="/p/${p.id}/" class="${cls(4)}"><time class="${cls(3)}" datetime="2026-01-01">${p.ago}</time></a></span>${p.kind === 'suggested' ? `<span class="${cls(2)}"> • </span>${btn('Follow')}` : ''}`, 5)}
    ${p.kind === 'suggested' ? div(`<span class="${cls(3)}">Suggested for you</span>`, 4) : ''}${p.kind === 'ad' ? div(`<span class="${cls(3)}">Sponsored</span>`, 4) : ''}
  </div>
  ${div(btn(svg('More options', 'M5 12h.01M12 12h.01M19 12h.01'), 'More options'), 4)}
</div>
<div class="media ${cls(4)}">${div(div(div(`<div class="ratio"></div><div class="fill ${cls(3)}">${media}</div>${div('', 3)}`, 4), 4), 4)}</div>
<div class="${cls(5)}"><div class="${cls(5)}">
  <section class="acts ${cls(4)}">
    <span class="${cls(3)}">${btn(svg('Like', 'M12 21l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z'))}</span>
    <span class="${cls(3)}">${btn(svg('Comment', 'M20 12a8 8 0 1 1-4-7l4-1-1 4'))}</span>
    <span class="${cls(3)}">${btn(svg('Share', 'M22 3L9 13M22 3l-7 19-3-9-9-3z'))}</span>
    <span class="gap"></span>
    <span class="${cls(3)}"><button type="button" class="${cls(5)}">${svg('Save', 'M19 21l-7-5-7 5V4h14z')}</button></span>
  </section>
  <section class="likes ${cls(4)}">${div(`<span class="${cls(3)}"><a href="/p/${p.id}/liked_by/" class="${cls(4)}"><span class="${cls(3)}">${p.likes.toLocaleString('en')}</span> likes</a></span>`, 4)}</section>
  <div class="cap ${cls(4)}"><span class="${cls(3)}"><span class="${cls(3)}"><a href="/${u}/" class="${cls(4)}"><span class="${cls(3)}">${u}</span></a></span></span> <span class="${cls(3)}">${esc(p.caption)}</span> ${btn('more')}</div>
  <div class="cmts ${cls(4)}"><a href="/p/${p.id}/" class="${cls(4)}"><span class="${cls(3)}">View all ${p.comments} comments</span></a></div>
  <section class="add ${cls(4)}">${div(`<form class="${cls(4)}" method="POST"><textarea aria-label="Add a comment…" placeholder="Add a comment…" class="${cls(5)}"></textarea>${btn('Post')}</form>${btn(svg('Emoji', 'M12 3a9 9 0 1 0 0 18'), 'Emoji')}`, 4)}</section>
</div></div>
</div></div>`;
  }

  // ---- Virtualized list --------------------------------------------------

  let feed = null; // { view, posts, heights: Map, nodes: Map, page, loading, more }
  let renderQueued = false;
  window.__feedLog = []; // pages: asked/arrived/rendered (performance.now)

  // Each post is measured once, the first time it is laid out.
  const sizes = new ResizeObserver((entries) => {
    let changed = false;
    for (const e of entries) {
      const id = e.target.dataset.id;
      if (!feed || feed.heights.has(id)) continue;
      feed.heights.set(id, e.borderBoxSize[0].blockSize + 12);
      changed = true;
    }
    if (changed) queueRender();
  });

  // Videos play while at least half of them shows.
  const playing = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.intersectionRatio >= 0.5) {
        v.preload = 'auto';
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    }
  }, { threshold: [0, 0.5, 1] });

  const heightOf = (p) => (feed.heights.has(p.id) ? feed.heights.get(p.id) : EST);
  const listTop = () => list.getBoundingClientRect().top + scrollY - (parseFloat(list.style.paddingTop) || 0);

  function render() {
    renderQueued = false;
    if (!feed) return;
    const top = listTop();
    const from = scrollY - ABOVE - top;
    const to = scrollY + innerHeight + BELOW - top;
    let y = 0;
    let padTop = 0;
    let padBottom = 0;
    const want = [];
    for (const p of feed.posts) {
      const h = heightOf(p);
      if (y + h < from) padTop += h;
      else if (y > to) padBottom += h;
      else want.push(p);
      y += h;
    }
    const keep = new Set(want.map((p) => p.id));
    for (const [id, node] of feed.nodes) {
      if (keep.has(id)) continue;
      sizes.unobserve(node);
      const v = node.querySelector('video');
      if (v) playing.unobserve(v);
      node.remove();
      feed.nodes.delete(id);
    }
    let prev = null;
    for (const p of want) {
      let node = feed.nodes.get(p.id);
      if (!node) {
        node = document.createElement('article');
        node.className = cls(4);
        node.dataset.id = p.id;
        node.dataset.view = feed.view;
        node.innerHTML = postHTML(p);
        feed.nodes.set(p.id, node);
        sizes.observe(node);
        const v = node.querySelector('video');
        if (v) playing.observe(v);
      }
      const at = prev ? prev.nextSibling : list.firstChild;
      if (node !== at) list.insertBefore(node, at);
      prev = node;
    }
    list.style.paddingTop = `${padTop}px`;
    list.style.paddingBottom = `${padBottom}px`;
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  // Asks for the next page when the end of the loaded posts is within two
  // screens: only on scroll, as Instagram does.
  function nearEnd() {
    if (!feed || feed.loading || !feed.more) return;
    const end = listTop() + feed.posts.reduce((a, p) => a + heightOf(p), 0);
    if (end < scrollY + 2 * innerHeight) loadPage();
  }

  async function loadPage() {
    const f = feed;
    f.loading = true;
    const log = { view: f.view, page: f.page, asked: performance.now() };
    window.__feedLog.push(log);
    let data = null;
    try {
      data = await (await fetch(`/perf/feed?view=${f.view}&page=${f.page}`)).json();
    } catch (_) {}
    log.arrived = performance.now();
    if (f !== feed) return; // switched view meanwhile
    f.loading = false;
    if (!data) return;
    f.page++;
    f.more = data.more;
    f.posts.push(...data.posts);
    queueRender();
  }

  function start() {
    if (feed) for (const node of feed.nodes.values()) node.remove();
    feed = { view: viewOf(), posts: [], heights: new Map(), nodes: new Map(), page: 0, loading: false, more: true };
    list.style.padding = '0';
    window.scrollTo(0, 0);
    loadPage();
  }

  window.addEventListener('scroll', () => {
    queueRender();
    nearEnd();
  }, { passive: true });
  window.addEventListener('resize', queueRender);
  window.addEventListener('popstate', () => {
    if (location.pathname === '/' && (!feed || viewOf() !== feed.view)) start();
  });
  start();
})();
