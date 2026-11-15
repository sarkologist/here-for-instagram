// Reels as a grid.
//
// Instagram's web Reels tab plays one reel at a time. This lays its feed out
// as a grid of covers instead, like the phone app's grids, with a
// configurable number of columns. Clicking a cover plays the grid in order
// in a small player; Instagram's own feed stays underneath, hidden and paused,
// and the toggle in the corner switches back to it.
(() => {
  'use strict';

  const { go, el, icon, onTop, layerReport, reelsPage } = Sinsta;

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
  const OPEN = ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'];
  const SOUND_OFF = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9.5l5 5M21.5 9.5l-5 5'];
  const SOUND_ON = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 8.5a5 5 0 0 1 0 7'];

  let prefs = { grid: true, columns: 4, muted: false, volume: 1 };

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

  function stopPreview() {
    clearTimeout(previewTimer);
    if (!previewTile) return;
    const v = previewTile.querySelector('video');
    if (v) unload(v);
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
      const v = el('video', { muted: true, loop: true, autoplay: true, playsInline: true, src: item.video });
      v.className = 'sr-preview';
      v.addEventListener('playing', () => v.classList.add('sr-on'), { once: true });
      a.append(v);
    }, PREVIEW_MS);
  });
  grid.addEventListener('pointerleave', stopPreview);

  function unload(v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.remove();
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
  const bar = el('i');
  const progress = el('div', { className: 'sr-progress' }, bar);
  const avatar = el('img', { className: 'sr-avatar', alt: '' });
  const userLink = el('a', { className: 'sr-user' });
  const muteBtn = button('sr-btn', 'Sound (M)', SOUND_ON);
  const slider = el('input', { type: 'range', min: 0, max: 1, step: 0.05, title: 'Volume' });
  const volumeBox = el('div', { className: 'sr-volume' }, muteBtn, slider);
  const openBtn = button('sr-btn', 'Open in Instagram to like, comment or share', OPEN);
  const head = el('div', { className: 'sr-head' }, avatar, userLink, el('span', { className: 'sr-gap' }), volumeBox, openBtn);
  const caption = el('div', { className: 'sr-caption' });
  const likesText = el('div', { className: 'sr-meta' });
  const foot = el('div', { className: 'sr-foot' }, caption, likesText);
  stage.append(head, foot, progress);
  const prevBtn = button('sr-arrow', 'Previous (↑)', UP);
  const nextBtn = button('sr-arrow', 'Next (↓)', DOWN);
  const arrows = el('div', { className: 'sr-arrows' }, prevBtn, nextBtn);
  const closeBtn = button('sr-close', 'Close (Esc)', CLOSE);
  const player = el('div', { id: 'sinsta-reel-player' }, stage, arrows, closeBtn);

  closeBtn.addEventListener('click', closePlayer);
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute();
  });
  slider.addEventListener('input', () => setVolume(Number(slider.value)));
  slider.addEventListener('click', (e) => e.stopPropagation());
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const href = `/reel/${items[pi].code}/`;
    closePlayer();
    go(href);
  });
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

  // TEMP: what happens to presses over the volume slider, for layerReport.
  // Listens on the window so it also sees presses that miss the slider.
  const sliderPresses = [];
  const nodeName = (n) => (n && n.tagName ? n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '') : String(n));
  for (const type of ['pointerdown', 'mousedown', 'click']) {
    window.addEventListener(type, (e) => {
      if (!playerOpen) return;
      const r = slider.getBoundingClientRect();
      if (e.clientX < r.left - 4 || e.clientX > r.right + 4 || e.clientY < r.top - 8 || e.clientY > r.bottom + 8) return;
      const entry = {
        type,
        x: Math.round(e.clientX - r.left),
        of: Math.round(r.width),
        target: nodeName(e.target),
        hit: nodeName(document.elementFromPoint(e.clientX, e.clientY)),
        before: slider.value,
        vol: video && +video.volume.toFixed(2),
      };
      sliderPresses.push(entry);
      if (sliderPresses.length > 15) sliderPresses.shift();
      setTimeout(() => {
        entry.prevented = e.defaultPrevented;
        entry.after = slider.value;
        entry.volAfter = video && +video.volume.toFixed(2);
      }, 50);
    }, true);
  }

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
    const v = el('video', { loop: true, playsInline: true, preload: 'auto', src: item.video });
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
    video.className = 'sr-video';
    video.autoplay = false;
    syncSound();
    video.addEventListener('timeupdate', onTime);
    stage.prepend(video);
    bar.style.width = video.duration ? `${(video.currentTime / video.duration) * 100}%` : '0';
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
    likesText.textContent = item.likes != null ? `${item.likes.toLocaleString('en')} likes` : '';
    syncPlayerArrows();

    const next = items[pi + 1];
    if (next) preload = { index: pi + 1, video: makeVideo(next) };
    if (items.length - pi < 6) loadMore();
  }

  function onTime(e) {
    const v = e.target;
    if (v === video && v.duration) bar.style.width = `${(v.currentTime / v.duration) * 100}%`;
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
    const preview = previewTile === grid.children[index] && previewTile.querySelector('video');
    if (preview) preview.remove();
    stopPreview();
    pi = index;
    playerOpen = true;
    document.documentElement.classList.add('sinsta-viewing');
    onTop(player);
    window.addEventListener('keydown', onPlayerKey, true);
    show(preview || null);
  }

  function closePlayer() {
    if (!playerOpen) return;
    playerOpen = false;
    window.removeEventListener('keydown', onPlayerKey, true);
    if (video) unload(video);
    if (preload) unload(preload.video);
    video = null;
    preload = null;
    player.remove();
    document.documentElement.classList.remove('sinsta-viewing');
    // Land the grid on the reel the player stopped at.
    const t = grid.children[pi];
    if (t && root.isConnected) {
      t.scrollIntoView({ block: 'nearest' });
      t.focus({ preventScroll: true });
    }
  }

  function onPlayerKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const actions = {
      ArrowDown: () => step(1),
      ArrowRight: () => step(1),
      j: () => step(1),
      ArrowUp: () => step(-1),
      ArrowLeft: () => step(-1),
      k: () => step(-1),
      ' ': () => video && (video.paused ? video.play().catch(() => {}) : video.pause()),
      m: toggleMute,
      M: toggleMute,
      Escape: closePlayer,
      l: () => layerReport(player, stage, { sliderPresses }), // TEMP
    };
    const act = actions[e.key];
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

  // Instagram's sidebar is fixed on the left (or, in narrow windows, a bar
  // along the bottom); the grid fills the rest.
  function measure() {
    if (Date.now() - measuredAt < 1000) return;
    measuredAt = Date.now();
    let left = 0;
    let bottom = 0;
    const link = [...document.querySelectorAll('a[href="/reels/"]')].find((a) => !root.contains(a));
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
      document.body.append(root);
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
