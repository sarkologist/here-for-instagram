// Reels as a grid.
//
// Instagram's web Reels tab plays one reel at a time. This lays its feed out
// as a grid of covers instead, like the phone app's grids, with a
// configurable number of columns. Clicking a cover plays the grid in order
// in a small player; Instagram's own feed stays underneath, hidden and paused,
// and the toggle in the corner switches back to it.
(() => {
  'use strict';

  const {
    go, el, shadowVideo, hostOf, icon, onTop, seekbar, shiftSpeed, cycleSpeed, setRate, speedLabel, reelsPage, reelByCode, ago,
    likeMedia, likeComment, comments, replies, addComment,
  } = Sinsta;

  const KEY = 'sinsta-reels';
  const MIN_COLS = 1;
  const MAX_COLS = 8;
  const PREVIEW_MS = 250; // hover this long before a cover starts playing
  const WHEEL_STEP = 40; // px of scrolling that moves the player one reel
  const WHEEL_IDLE = 200; // ms without scroll events that ends a gesture
  const storage = typeof browser === 'object' && browser.storage && browser.storage.local;

  const GRID = ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'];
  const MINUS = ['M6 12h12'];
  const PLUS = ['M6 12h12', 'M12 6v12'];
  const HEART = ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'];
  const CLOSE = ['M6 6l12 12M18 6L6 18'];
  const UP = ['M6 15l6-6 6 6'];
  const DOWN = ['M6 9l6 6 6-6'];
  const COMMENT = ['M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z'];
  const LINK = ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'];
  const SOUND_OFF = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9.5l5 5M21.5 9.5l-5 5'];
  const SOUND_ON = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 8.5a5 5 0 0 1 0 7'];

  let prefs = { grid: true, columns: 4, muted: false, volume: 1, speed: 1, comments: false };

  // Feed state survives leaving /reels/ (the script lives across Instagram's
  // in-page navigation), so coming back finds the same grid at the same place.
  const items = [];
  const known = new Set(); // pks
  let after = null;
  let ended = false;
  let loading = false;
  let failed = false;
  let savedScroll = 0;
  let queued = false;
  let measuredAt = 0;
  let lastPath = null;

  // ---- DOM ----------------------------------------------------------------

  function button(cls, title, paths) {
    const b = el('button', { className: cls, type: 'button', title });
    b.append(icon(paths));
    return b;
  }

  const toggle = button('sr-toggle', '', GRID);
  toggle.append(el('span', {}, 'Grid'));
  const fewer = button('sr-step', 'Fewer columns (−)', MINUS);
  const more = button('sr-step', 'More columns (+)', PLUS);
  const count = el('span', { className: 'sr-count' });
  const stepper = el('div', { className: 'sr-stepper' }, fewer, count, more);
  const controls = el('div', { id: 'sinsta-reels-controls' }, toggle, stepper);

  const grid = el('div', { className: 'sr-grid' });
  const status = el('div', { className: 'sr-status' });
  const root = el('div', { id: 'sinsta-reels', tabIndex: -1 }, grid, status);

  toggle.addEventListener('click', () => {
    prefs.grid = !prefs.grid;
    save();
    schedule();
  });
  fewer.addEventListener('click', () => setColumns(prefs.columns - 1));
  more.addEventListener('click', () => setColumns(prefs.columns + 1));

  function syncControls() {
    toggle.setAttribute('aria-pressed', String(prefs.grid));
    toggle.title = prefs.grid ? 'Back to Instagram\'s player' : 'Show reels as a grid';
    stepper.hidden = !prefs.grid;
    // Setting text always replaces the node, which would wake the
    // MutationObserver and run this again every frame.
    if (count.textContent !== String(prefs.columns)) count.textContent = prefs.columns;
    count.title = `${prefs.columns} column${prefs.columns === 1 ? '' : 's'}`;
    fewer.disabled = prefs.columns <= MIN_COLS;
    more.disabled = prefs.columns >= MAX_COLS;
    root.style.setProperty('--sr-cols', prefs.columns);
  }

  function setColumns(n) {
    n = Math.max(MIN_COLS, Math.min(MAX_COLS, n));
    if (n === prefs.columns) return;
    // Keep the cover at the top of the view in place across the reflow.
    const anchor = topTile();
    prefs.columns = n;
    save();
    syncControls();
    syncSizes();
    if (anchor) anchor.scrollIntoView({ block: 'start' });
    fill();
  }

  function topTile() {
    const top = root.getBoundingClientRect().top + 60;
    for (const tile of grid.children) if (tile.getBoundingClientRect().bottom > top) return tile;
    return null;
  }

  // ---- Tiles --------------------------------------------------------------

  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    return n.toLocaleString('en');
  }

  function tile(item, index) {
    const a = el('a', { className: 'sr-tile', href: `/reel/${item.code}/`, title: item.username });
    a.dataset.index = index;
    if (item.thumbs.length) {
      const img = el('img', { alt: '', loading: 'lazy', decoding: 'async', src: item.thumbs[item.thumbs.length - 1].url });
      img.srcset = item.thumbs.map((c) => `${c.url} ${c.width}w`).join(', ');
      img.sizes = tileSize();
      a.append(img);
    }
    if (item.likes != null) {
      const likes = el('span', { className: 'sr-likes' }, compact(item.likes));
      likes.prepend(icon(HEART));
      a.append(likes);
    }
    return a;
  }

  function tileSize() {
    const width = grid.clientWidth || root.clientWidth || window.innerWidth;
    return Math.ceil(width / prefs.columns) + 'px';
  }

  function syncSizes() {
    const size = tileSize();
    for (const img of grid.querySelectorAll('img')) img.sizes = size;
  }

  grid.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('.sr-tile');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    openPlayer(Number(a.dataset.index));
  });

  // Hovering a cover plays it silently, as the app's grids do.
  let previewTile = null;
  let previewTimer = 0;
  const previews = new WeakMap(); // .sr-preview host -> its video

  function stopPreview() {
    clearTimeout(previewTimer);
    if (!previewTile) return;
    const host = previewTile.querySelector('.sr-preview');
    if (host) unload(previews.get(host));
    previewTile = null;
  }

  grid.addEventListener('pointerover', (e) => {
    const a = e.target.closest('.sr-tile');
    if (a === previewTile) return;
    stopPreview();
    if (!a || e.pointerType === 'touch') return;
    previewTile = a;
    previewTimer = setTimeout(() => {
      const item = items[Number(a.dataset.index)];
      const v = shadowVideo({ muted: true, loop: true, autoplay: true, playsInline: true, src: item.video }, 'cover');
      const host = hostOf(v);
      host.className = 'sr-preview';
      previews.set(host, v);
      v.addEventListener('playing', () => host.classList.add('sr-on'), { once: true });
      a.append(host);
    }, PREVIEW_MS);
  });
  grid.addEventListener('pointerleave', stopPreview);

  function unload(v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
    hostOf(v).remove();
  }

  // ---- Loading ------------------------------------------------------------

  async function loadMore() {
    if (loading || ended) return;
    loading = true;
    failed = false;
    syncStatus();
    // Right after a page load Instagram's session tokens may not be in the
    // page yet; give them a few tries before giving up.
    let page = null;
    for (let attempt = 0; attempt < 3 && !page; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000 * attempt));
      page = await reelsPage(after);
    }
    loading = false;
    if (!page) {
      failed = true;
      syncStatus();
      return;
    }
    const size = tileSize();
    const tiles = [];
    for (const item of page.items) {
      if (known.has(item.pk)) continue;
      known.add(item.pk);
      items.push(item);
      const t = tile(item, items.length - 1);
      const img = t.querySelector('img');
      if (img) img.sizes = size;
      tiles.push(t);
    }
    grid.append(...tiles);
    after = page.after;
    ended = !after;
    syncStatus();
    fill();
    if (playerOpen) syncPlayerArrows();
  }

  // A link to one reel (/reels/<code>/) puts it first in the grid and
  // plays it.
  async function openLinked(code) {
    let index = items.findIndex((it) => it.code === code);
    if (index < 0) {
      const item = await reelByCode(code);
      if (!item || !gridActive()) return;
      index = items.findIndex((it) => it.pk === item.pk);
      if (index < 0) {
        known.add(item.pk);
        items.unshift(item);
        grid.prepend(tile(item, 0));
        [...grid.children].forEach((t, i) => { t.dataset.index = i; });
        if (playerOpen) pi++;
        index = 0;
      }
    }
    if (gridActive()) openPlayer(index);
  }

  function syncStatus() {
    status.replaceChildren();
    if (loading) status.append(el('span', { className: 'sr-spinner' }));
    else if (failed) {
      const retry = el('button', { type: 'button', className: 'sr-retry' }, 'Try again');
      retry.addEventListener('click', loadMore);
      status.append(el('p', {}, 'Couldn\'t load reels.'), retry);
    } else if (ended) status.append(el('p', {}, 'That\'s all Instagram has for now.'));
  }

  // Keep a screen and a half of covers below the fold.
  function fill() {
    if (!root.isConnected || loading || ended || failed) return;
    if (root.scrollHeight - root.scrollTop - root.clientHeight < root.clientHeight * 1.5) loadMore();
  }

  root.addEventListener('scroll', fill, { passive: true });
  window.addEventListener('resize', () => {
    measuredAt = 0;
    syncSizes();
    schedule();
  });

  // ---- Player -------------------------------------------------------------

  let playerOpen = false;
  let pi = 0; // index into items
  let video = null;
  let preload = null; // { index, video } for the next reel
  let wheelSum = 0;
  let wheelLast = 0;
  let wheelActed = false;

  const stage = el('div', { className: 'sr-stage' });
  const seek = seekbar();
  const avatar = el('img', { className: 'sr-avatar', alt: '' });
  const userLink = el('a', { className: 'sr-user' });
  const muteBtn = button('sr-btn', 'Sound (M)', SOUND_ON);
  const slider = el('input', { type: 'range', min: 0, max: 1, step: 0.05, title: 'Volume' });
  const volumeBox = el('div', { className: 'sr-volume' }, muteBtn, slider);
  const speedBtn = el('button', { className: 'sr-btn sinsta-speed', type: 'button', title: 'Speed (< >)' });
  const head = el('div', { className: 'sr-head' }, avatar, userLink, el('span', { className: 'sr-gap' }), speedBtn, volumeBox);
  const caption = el('div', { className: 'sr-caption' });
  const foot = el('div', { className: 'sr-foot' }, caption, seek.row);
  stage.append(head, foot);

  // Like, comments and copy link, beside the video as in the app.
  function action(title, paths) {
    const b = button('sr-act', title, paths);
    b.append(el('span'));
    return b;
  }
  const likeBtn = action('Like (L)', HEART);
  const commentBtn = action('Comments (C)', COMMENT);
  const linkBtn = action('Copy link', LINK);
  const actions = el('div', { className: 'sr-actions' }, likeBtn, commentBtn, linkBtn);

  // The comments panel.
  const cList = el('div', { className: 'sr-clist' });
  const cClose = button('sr-btn', 'Close comments (C)', CLOSE);
  const cTitle = el('div', { className: 'sr-ctitle' }, 'Comments');
  const replyText = el('span');
  const replyCancel = button('sr-btn', 'Cancel reply', CLOSE);
  const replyBar = el('div', { className: 'sr-replying', hidden: true }, replyText, replyCancel);
  const cInput = el('textarea', { className: 'sr-cinput', rows: 1, placeholder: 'Add a comment…', maxLength: 2200 });
  const cPost = el('button', { type: 'button', className: 'sr-cpost', disabled: true }, 'Post');
  const cError = el('div', { className: 'sr-cerror', hidden: true });
  const cForm = el('div', { className: 'sr-cform' }, cInput, cPost);
  const cOff = el('div', { className: 'sr-coff', hidden: true }, 'Comments are turned off.');
  const panel = el('div', { className: 'sr-comments', hidden: true },
    el('div', { className: 'sr-chead' }, cTitle, cClose), cList, replyBar, cError, cForm, cOff);
  const prevBtn = button('sr-arrow', 'Previous (↑)', UP);
  const nextBtn = button('sr-arrow', 'Next (↓)', DOWN);
  const arrows = el('div', { className: 'sr-arrows' }, prevBtn, nextBtn);
  const closeBtn = button('sr-close', 'Close (Esc)', CLOSE);
  const player = el('div', { id: 'sinsta-reel-player' }, stage, actions, panel, arrows, closeBtn);

  closeBtn.addEventListener('click', closePlayer);
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute();
  });
  speedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSpeed(cycleSpeed(prefs.speed));
  });
  slider.addEventListener('input', () => setVolume(Number(slider.value)));
  slider.addEventListener('click', (e) => e.stopPropagation());
  userLink.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = userLink.getAttribute('href');
    closePlayer();
    go(href);
  });
  stage.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input') || !video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  player.addEventListener('click', (e) => {
    if (e.target === player) closePlayer();
  });
  player.addEventListener('wheel', (e) => {
    if (panel.contains(e.target)) return; // scrolls the comments
    e.preventDefault();
    // Over the volume control, scrolling sets the volume instead.
    if (volumeBox.contains(e.target)) {
      const v = prefs.muted ? 0 : prefs.volume;
      setVolume(Math.round((v - Math.sign(e.deltaY) * 0.05) * 20) / 20);
      return;
    }
    const now = Date.now();
    const gap = now - wheelLast;
    wheelLast = now;
    // One gesture (including a trackpad's momentum tail) moves one reel.
    if (gap > WHEEL_IDLE) {
      wheelSum = 0;
      wheelActed = false;
    }
    if (wheelActed) return;
    wheelSum += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if (Math.abs(wheelSum) < WHEEL_STEP) return;
    wheelActed = true;
    step(Math.sign(wheelSum));
  }, { passive: false });

  // ---- Like and comments ----------------------------------------------------

  likeBtn.addEventListener('click', toggleLike);
  commentBtn.addEventListener('click', toggleComments);
  cClose.addEventListener('click', toggleComments);
  linkBtn.addEventListener('click', async () => {
    const it = items[pi];
    if (!it) return;
    let ok = true;
    try {
      await navigator.clipboard.writeText(`https://www.instagram.com/reel/${it.code}/`);
    } catch (_) {
      ok = false;
    }
    linkBtn.lastChild.textContent = ok ? 'Copied' : 'Failed';
    clearTimeout(linkBtn.timer);
    linkBtn.timer = setTimeout(() => { linkBtn.lastChild.textContent = ''; }, 1500);
  });

  function syncActions() {
    const it = items[pi];
    if (!it) return;
    likeBtn.toggleAttribute('data-on', it.liked);
    likeBtn.title = it.liked ? 'Unlike (L)' : 'Like (L)';
    likeBtn.lastChild.textContent = it.likes != null ? compact(it.likes) : '';
    commentBtn.lastChild.textContent = it.comments ? compact(it.comments) : '';
    commentBtn.toggleAttribute('data-on', !panel.hidden);
  }

  // Reels whose like is on its way; another reel can be liked meanwhile.
  const liking = new WeakSet();

  async function toggleLike() {
    const it = items[pi];
    if (!it || liking.has(it)) return;
    const on = !it.liked;
    const flip = (v) => {
      it.liked = v;
      if (it.likes != null) it.likes += v ? 1 : -1;
      if (items[pi] === it) syncActions();
    };
    liking.add(it);
    flip(on);
    const ok = await likeMedia(it.pk, on, it.token);
    liking.delete(it);
    if (!ok) flip(!on);
  }

  function toggleComments() {
    panel.hidden = !panel.hidden;
    prefs.comments = !panel.hidden;
    save();
    player.classList.toggle('sr-with-comments', !panel.hidden);
    syncActions();
    if (!panel.hidden) loadComments();
  }

  // Comments of the reel on screen: { pk, next, loading, done, failed }.
  let thread = null;
  let replyTo = null; // { pk, username, box } of the comment being replied to

  function loadComments() {
    const it = items[pi];
    if (!it || (thread && thread.pk === it.pk)) return;
    thread = { pk: it.pk, token: it.token, next: null, loading: false, done: false };
    setReply(null);
    cError.hidden = true;
    cList.replaceChildren();
    cList.scrollTop = 0;
    cOff.hidden = !it.commentsOff;
    cForm.hidden = it.commentsOff;
    if (it.commentsOff && !it.comments) return;
    moreComments();
  }

  async function moreComments() {
    const t = thread;
    if (!t || t.loading || t.done) return;
    t.loading = true;
    const spinner = el('div', { className: 'sr-cstatus' }, el('span', { className: 'sr-spinner' }));
    cList.append(spinner);
    const page = await comments(t.pk, t.next);
    spinner.remove();
    if (t !== thread) return;
    t.loading = false;
    if (!page) {
      const retry = el('button', { type: 'button', className: 'sr-clink' }, 'Couldn\'t load comments. Try again');
      retry.addEventListener('click', () => {
        retry.parentElement.remove();
        moreComments();
      });
      cList.append(el('div', { className: 'sr-cstatus' }, retry));
      return;
    }
    const seen = new Set([...cList.querySelectorAll('.sr-c')].map((n) => n.dataset.pk));
    cList.append(...page.comments.filter((c) => !seen.has(c.pk)).map((c) => commentNode(c, null)));
    t.next = page.next;
    t.done = !page.next || !page.comments.length;
    if (t.done && !cList.querySelector('.sr-c')) {
      cList.append(el('div', { className: 'sr-cstatus' }, 'No comments yet.'));
    }
    fillComments();
  }

  function fillComments() {
    if (cList.scrollHeight - cList.scrollTop - cList.clientHeight < cList.clientHeight) moreComments();
  }
  cList.addEventListener('scroll', fillComments, { passive: true });

  // Comment text with @mentions and #hashtags as links.
  function richText(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(/([@#])([\p{L}\p{N}_.]+)/gu)) {
      if (m.index > 0 && /[\p{L}\p{N}_]/u.test(text[m.index - 1])) continue;
      // Usernames may contain dots, but not end with one; hashtags have none.
      const name = m[1] === '@' ? m[2].replace(/\.+$/, '') : m[2].split('.')[0];
      if (!name) continue;
      out.push(text.slice(last, m.index));
      const href = m[1] === '@' ? `/${name}/` : `/explore/tags/${encodeURIComponent(name)}/`;
      out.push(el('a', { href, className: 'sr-ctag' }, m[1] + name));
      last = m.index + 1 + name.length;
    }
    out.push(text.slice(last));
    return out;
  }

  // `parent`: the top-level comment a reply belongs to.
  function commentNode(c, parent) {
    const like = button('sr-clike', '', HEART);
    const meta = el('div', { className: 'sr-cmeta' }, el('span', {}, ago(c.at)));
    const likes = el('span');
    meta.append(likes);
    const reply = el('button', { type: 'button', className: 'sr-clink' }, 'Reply');
    meta.append(reply);
    const body = el('div', { className: 'sr-cbody' },
      el('div', { className: 'sr-ctext' }, el('a', { href: `/${c.username}/`, className: 'sr-cuser' }, c.username), ' ', ...richText(c.text)),
      meta);
    const node = el('div', { className: 'sr-c' },
      el('a', { href: `/${c.username}/`, className: 'sr-cpic' }, el('img', { src: c.pic, alt: '', loading: 'lazy' })),
      body, like);
    node.dataset.pk = c.pk;
    const box = parent ? parent.box : el('div', { className: 'sr-creplies' });
    const syncLike = () => {
      like.toggleAttribute('data-on', c.liked);
      like.title = c.liked ? 'Unlike' : 'Like';
      likes.textContent = c.likes ? `${c.likes.toLocaleString('en')} like${c.likes === 1 ? '' : 's'}` : '';
      likes.hidden = !c.likes;
    };
    syncLike();
    like.addEventListener('click', async () => {
      if (like.dataset.busy) return;
      const flip = (v) => {
        c.liked = v;
        c.likes += v ? 1 : -1;
        syncLike();
      };
      const on = !c.liked;
      flip(on);
      like.dataset.busy = '';
      const ok = await likeComment(c.pk, on);
      delete like.dataset.busy;
      if (!ok) flip(!on);
    });
    // Replies to a reply go to the thread's top comment, as on Instagram.
    const top = parent || { pk: c.pk, box };
    reply.addEventListener('click', () => setReply({ pk: top.pk, username: c.username, box: top.box }));
    if (parent) return node;
    body.append(box);
    if (c.replies) {
      let next = null;
      let shown = 0;
      const more = el('button', { type: 'button', className: 'sr-clink sr-cmore' });
      const label = () => {
        more.textContent = shown ? `View more replies (${c.replies - shown})` : `View replies (${c.replies})`;
      };
      label();
      more.addEventListener('click', async () => {
        if (more.disabled) return;
        more.disabled = true;
        const page = await replies(thread.pk, c.pk, next);
        more.disabled = false;
        if (!page) {
          more.textContent = 'Couldn\'t load replies. Try again';
          return;
        }
        const have = new Set([...box.children].map((n) => n.dataset.pk));
        const fresh = page.comments.filter((r) => !have.has(r.pk));
        box.append(...fresh.map((r) => commentNode(r, top)));
        shown += fresh.length;
        next = page.next;
        if (!next || !fresh.length) more.remove();
        else label();
      });
      body.append(more);
    }
    return node;
  }

  function setReply(r) {
    replyTo = r;
    replyBar.hidden = !r;
    if (!r) return;
    replyText.textContent = `Replying to @${r.username}`;
    if (!cInput.value.trim()) cInput.value = `@${r.username} `;
    syncInput();
    cInput.focus();
    cInput.setSelectionRange(cInput.value.length, cInput.value.length);
  }
  replyCancel.addEventListener('click', () => {
    if (replyTo && cInput.value.trim() === `@${replyTo.username}`) cInput.value = '';
    setReply(null);
    syncInput();
  });

  function syncInput() {
    cPost.disabled = !cInput.value.trim() || !!cPost.dataset.busy;
    cInput.style.height = 'auto';
    cInput.style.height = `${Math.min(cInput.scrollHeight, 120)}px`;
  }
  cInput.addEventListener('input', () => {
    cError.hidden = true;
    syncInput();
  });
  cPost.addEventListener('click', postComment);

  async function postComment() {
    const text = cInput.value.trim();
    const t = thread;
    if (!text || !t || cPost.dataset.busy) return;
    const r = replyTo;
    cPost.dataset.busy = '';
    cInput.disabled = true;
    syncInput();
    const c = await addComment(t.pk, text, r && r.pk, t.token);
    delete cPost.dataset.busy;
    cInput.disabled = false;
    if (!c) {
      cError.textContent = 'Couldn\'t post your comment. Try again.';
      cError.hidden = false;
      syncInput();
      return;
    }
    cInput.value = '';
    setReply(null);
    syncInput();
    const it = items.find((i) => i.pk === t.pk);
    if (it) it.comments++;
    syncActions();
    if (t !== thread) return;
    const empty = cList.querySelector('.sr-cstatus');
    if (empty && !empty.querySelector('*')) empty.remove();
    if (r) {
      const node = commentNode(c, r);
      r.box.append(node);
      node.scrollIntoView({ block: 'nearest' });
    } else {
      cList.prepend(commentNode(c, null));
      cList.scrollTop = 0;
    }
  }

  // Links in comments close the player and open in place.
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    closePlayer();
    go(href);
  });

  function setMuted(m) {
    prefs.muted = m;
    // Unmuting at zero volume would still be silent.
    if (!m && prefs.volume === 0) prefs.volume = 0.5;
    save();
    syncSound();
  }

  function toggleMute() {
    setMuted(!prefs.muted);
  }

  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    prefs.muted = v === 0;
    if (v > 0) prefs.volume = v;
    save();
    syncSound();
  }

  function setSpeed(rate) {
    prefs.speed = rate;
    save();
    syncSpeed();
  }

  function syncSpeed() {
    if (video) setRate(video, prefs.speed);
    speedBtn.textContent = speedLabel(prefs.speed);
  }

  function syncSound() {
    if (video) {
      video.muted = prefs.muted;
      video.volume = prefs.volume;
    }
    muteBtn.replaceChildren(icon(prefs.muted ? SOUND_OFF : SOUND_ON));
    // Writing the value during a press on the slider can cancel it in Firefox.
    const v = String(prefs.muted ? 0 : prefs.volume);
    if (slider.value !== v) slider.value = v;
  }

  function makeVideo(item) {
    const v = shadowVideo({ loop: true, playsInline: true, preload: 'auto', src: item.video }, 'contain');
    if (item.thumbs.length) v.poster = item.thumbs[0].url;
    return v;
  }

  // `handoff`: a video already playing this reel (the cover's hover
  // preview), which carries on from where it is.
  function show(handoff) {
    const item = items[pi];
    if (video) unload(video);
    video = handoff || (preload && preload.index === pi ? preload.video : makeVideo(item));
    if (preload && preload.index !== pi) unload(preload.video);
    preload = null;
    hostOf(video).className = 'sr-video';
    video.style.objectFit = 'contain';
    video.autoplay = false;
    syncSound();
    syncSpeed();
    seek.attach(video);
    stage.prepend(hostOf(video));
    const playing = video.play();
    // Sound needs a recent click or key press; without one, play muted.
    if (playing) playing.catch(() => {
      if (!video || video.muted) return;
      prefs.muted = true;
      syncSound();
      video.play().catch(() => {});
    });

    avatar.src = item.pic;
    userLink.textContent = item.username;
    userLink.href = `/${item.username}/`;
    caption.textContent = item.caption;
    caption.hidden = !item.caption;
    syncActions();
    if (!panel.hidden) loadComments();
    syncPlayerArrows();

    const next = items[pi + 1];
    if (next) preload = { index: pi + 1, video: makeVideo(next) };
    if (items.length - pi < 6) loadMore();
  }

  function syncPlayerArrows() {
    prevBtn.disabled = pi <= 0;
    nextBtn.disabled = pi >= items.length - 1;
  }

  function step(delta) {
    const n = pi + delta;
    if (n < 0 || n >= items.length) return;
    pi = n;
    show();
  }

  function openPlayer(index) {
    if (!items[index]) return;
    const host = previewTile === grid.children[index] && previewTile.querySelector('.sr-preview');
    const preview = host && previews.get(host);
    if (host) host.remove();
    stopPreview();
    pi = index;
    playerOpen = true;
    thread = null;
    panel.hidden = !prefs.comments;
    player.classList.toggle('sr-with-comments', prefs.comments);
    document.documentElement.classList.add('sinsta-viewing');
    onTop(player);
    show(preview || null);
  }

  function closePlayer() {
    if (!playerOpen) return;
    playerOpen = false;
    if (video) unload(video);
    if (preload) unload(preload.video);
    video = null;
    seek.attach(null);
    preload = null;
    thread = null;
    setReply(null);
    player.remove();
    document.documentElement.classList.remove('sinsta-viewing');
    // Land the grid on the reel the player stopped at.
    const t = grid.children[pi];
    if (t && root.isConnected) {
      t.scrollIntoView({ block: 'nearest' });
      t.focus({ preventScroll: true });
    }
  }

  // Registered once, at document start, so it runs before Instagram's own
  // key handlers, which could otherwise swallow the keys.
  window.addEventListener('keydown', (e) => {
    if (playerOpen) onPlayerKey(e);
  }, true);

  function onPlayerKey(e) {
    // Typing a comment: keep the keys from the player and from Instagram.
    if (panel.contains(e.target) && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        e.target.blur();
      } else if (e.target === cInput && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        postComment();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const keys = {
      ArrowDown: () => step(1),
      ArrowRight: () => step(1),
      j: () => step(1),
      ArrowUp: () => step(-1),
      ArrowLeft: () => step(-1),
      k: () => step(-1),
      ' ': () => video && (video.paused ? video.play().catch(() => {}) : video.pause()),
      m: toggleMute,
      M: toggleMute,
      l: toggleLike,
      L: toggleLike,
      c: toggleComments,
      C: toggleComments,
      '<': () => setSpeed(shiftSpeed(prefs.speed, -1)),
      '>': () => setSpeed(shiftSpeed(prefs.speed, 1)),
      Escape: () => (panel.hidden ? closePlayer() : toggleComments()),
    };
    const act = keys[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  }

  // ---- Grid keys ----------------------------------------------------------

  // While the grid is up, scrolling keys scroll it rather than reaching
  // Instagram's hidden player, and − / + change the number of columns.
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
  window.addEventListener('keydown', (e) => {
    if (playerOpen || !gridActive() || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === '-' || e.key === '+' || e.key === '=') {
      e.preventDefault();
      e.stopPropagation();
      setColumns(prefs.columns + (e.key === '-' ? -1 : 1));
      return;
    }
    if (!SCROLL_KEYS.has(e.key)) return;
    e.stopPropagation();
    if (!root.contains(t)) {
      root.focus({ preventScroll: true });
      e.preventDefault();
      const page = root.clientHeight * 0.85;
      const by = { ArrowUp: -80, ArrowDown: 80, PageUp: -page, PageDown: page, ' ': e.shiftKey ? -page : page };
      if (e.key === 'Home') root.scrollTo({ top: 0 });
      else if (e.key === 'End') root.scrollTo({ top: root.scrollHeight });
      else root.scrollBy({ top: by[e.key] });
    }
  }, true);

  // Instagram's player keeps running under the grid; keep it silent.
  document.addEventListener('play', (e) => {
    const v = e.target;
    if (!gridActive() || root.contains(v) || player.contains(v)) return;
    v.muted = true;
    v.pause();
  }, true);

  // ---- Wiring -------------------------------------------------------------

  function onReels() {
    return /^\/reels(\/|$)/.test(location.pathname);
  }

  function gridActive() {
    return prefs.grid && onReels();
  }

  // The Reels link in Instagram's sidebar. Links in Instagram's own (hidden)
  // page are skipped, though they keep their layout.
  function navLink() {
    return [...document.querySelectorAll('a[href="/reels/"]')]
      .find((a) => !root.contains(a) && !a.closest('main') && getComputedStyle(a).visibility === 'visible');
  }

  // Where the grid goes. Instagram's sidebar widens over the page on hover,
  // from a fixed layer (z-index 10) inside the app's own stacking context
  // (z-index 0). In <body> the grid would cover the whole app, widened
  // sidebar included; in that context, at z-index 1, it stays under the
  // sidebar and over the page.
  function gridHost() {
    let layer = navLink();
    while (layer && layer !== document.body) {
      const cs = getComputedStyle(layer);
      if (cs.position === 'fixed' && cs.zIndex !== 'auto') break;
      layer = layer.parentElement;
    }
    for (let e = layer && layer.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.position !== 'static' && cs.zIndex !== 'auto') return e;
    }
    return document.body;
  }

  // Instagram's sidebar is fixed on the left (or, in narrow windows, a bar
  // along the bottom); the grid fills the rest. The sidebar widens over the
  // grid while the pointer is on it, so its width then isn't the room it
  // takes: keep the last measurement (or, before the first, take the width
  // it has narrow, twice the centre of its icons, which stay put), and
  // measure again once the pointer has left and it has narrowed.
  let measured = false;
  let leaveWatched = null;
  function measure() {
    if (Date.now() - measuredAt < 1000) return;
    const link = navLink();
    let layer = link;
    while (layer && layer !== document.body && getComputedStyle(layer).position !== 'fixed') layer = layer.parentElement;
    if (layer && layer !== document.body && layer.matches(':hover') && layer.getBoundingClientRect().height > window.innerHeight / 2) {
      if (leaveWatched !== layer) {
        leaveWatched = layer;
        // It takes about 100 ms to narrow again; measure once it has.
        layer.addEventListener('mouseleave', () => {
          leaveWatched = null;
          measuredAt = Date.now() - 700; // and nothing measures before then
          setTimeout(measure, 320);
        }, { once: true });
      }
      const icon = !measured && link.querySelector('svg');
      if (icon) {
        const r = icon.getBoundingClientRect();
        root.style.setProperty('--sr-left', `${Math.round(r.left + r.right)}px`);
      }
      return;
    }
    measuredAt = Date.now();
    measured = true;
    let left = 0;
    let bottom = 0;
    for (let e = link; e && e !== document.body; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.width && r.height > window.innerHeight / 2 && r.width < window.innerWidth / 2) left = Math.max(left, r.right);
      else if (r.height && r.top > window.innerHeight / 2) bottom = Math.max(bottom, window.innerHeight - r.top);
      if (getComputedStyle(e).position === 'fixed') break;
    }
    root.style.setProperty('--sr-left', `${Math.round(left)}px`);
    root.style.setProperty('--sr-bottom', `${Math.round(bottom)}px`);
    controls.style.setProperty('--sr-bottom', `${Math.round(bottom)}px`);
  }

  function sync() {
    queued = false;
    const on = onReels();
    // Arriving at /reels/<code>/ from elsewhere means a link to that reel.
    // Within the tab, Instagram's own player rewrites the path as it plays.
    const path = location.pathname;
    const wasOn = lastPath !== null && /^\/reels(\/|$)/.test(lastPath);
    const linked = path !== lastPath && !wasOn && path.match(/^\/reels\/([\w-]+)\/?$/);
    lastPath = path;
    const active = on && prefs.grid;
    const html = document.documentElement;
    html.toggleAttribute('data-sinsta-reels-grid', active);
    if (!on) {
      closePlayer();
      if (controls.isConnected) controls.remove();
    } else if (!controls.isConnected && document.body) {
      document.body.append(controls);
    }
    if (active && !root.isConnected && document.body) {
      gridHost().append(root);
      measuredAt = 0;
      measure();
      syncSizes();
      root.scrollTop = savedScroll;
      root.focus({ preventScroll: true });
      for (const v of document.querySelectorAll('main video')) {
        v.muted = true;
        v.pause();
      }
      if (!items.length) loadMore();
      else fill();
    } else if (!active && root.isConnected) {
      savedScroll = root.scrollTop;
      stopPreview();
      closePlayer();
      root.remove();
    } else if (active) {
      measure();
    }
    if (linked && active) openLinked(linked[1]);
    syncControls();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function save() {
    try {
      if (storage) storage.set({ [KEY]: prefs });
      else localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (_) {}
  }

  async function load() {
    let stored = null;
    try {
      stored = storage ? (await storage.get(KEY))[KEY] : JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (_) {}
    if (stored) prefs = { ...prefs, ...stored };
    schedule();
  }

  syncControls();
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  load();
})();
