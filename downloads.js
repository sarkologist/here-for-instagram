// Download buttons on Instagram's own posts and reels, and on profile
// pictures. (The story viewer and the reels player have theirs built in.)
//
// The files come from Instagram's media API, never from the page's <img> or
// <video> elements, and the buttons are plain additions beside Instagram's
// own: nothing of Instagram's is restacked, clipped or made click-through.
(() => {
  'use strict';

  const { downloadButton, downloadPost, downloadProfilePic } = Sinsta;

  const SAVE = 'svg[aria-label="Save"], svg[aria-label="Remove"]';
  const CODE = /\/(?:p|reels?)\/([\w-]+)/;

  // ---- Posts and reels ----------------------------------------------------

  // The shortcode of the post a Save button belongs to. A post open in a
  // dialog, on its own page or in Instagram's reels player is the one in the
  // address bar; in the feed, it's the one the post's links point to.
  function codeOf(save) {
    const article = !save.closest('[role="dialog"]') && save.closest('article');
    if (article) {
      for (const a of article.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
        const m = a.getAttribute('href').match(CODE);
        if (m) return m[1];
      }
    }
    const m = location.pathname.match(CODE);
    return m ? m[1] : null;
  }

  // The carousel's slide dots near a Save button: [current index, count], or
  // null for a single photo or video.
  function slidesOf(save) {
    const scope = save.closest('article') || save.closest('[role="dialog"]') || document;
    const current = scope.querySelector('[aria-current][aria-label^="Go to slide"]');
    if (!current) return null;
    const dots = [...current.parentElement.children];
    return [dots.indexOf(current), dots.length];
  }

  // Whether a Save button sits in a post's action bar, next to its Like
  // button ("Remove" is also the label of unrelated buttons).
  function nearLike(slot) {
    let n = slot.parentElement;
    for (let i = 0; n && i < 4; i++, n = n.parentElement) {
      if (n.querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]')) return true;
    }
    return false;
  }

  // The button goes inside the Save button's slot (its outermost wrapper
  // that holds nothing else), before it, so Instagram's row keeps its own
  // spacing. The slot lays the two out the way that row runs.
  function addPostButton(svg) {
    if (svg.closest('[data-sinsta-dl]')) return;
    let slot = svg.closest('[role="button"], button') || svg;
    while (slot.parentElement && slot.parentElement.children.length === 1) slot = slot.parentElement;
    if (!slot.parentElement || !nearLike(slot)) return;
    const column = getComputedStyle(slot.parentElement).flexDirection.startsWith('column');
    const b = downloadButton('sinsta-dl', 'Download', (e) => {
      const code = codeOf(b);
      const slides = slidesOf(b);
      return !!code && downloadPost(code, slides && e.shiftKey ? -1 : slides ? slides[0] : 0);
    });
    b.addEventListener('pointerenter', () => {
      const slides = slidesOf(b);
      if (!b.dataset.failed) b.title = slides ? `Download this slide (Shift-click: all ${slides[1]})` : 'Download';
    });
    slot.dataset.sinstaDl = column ? 'column' : 'row';
    slot.prepend(b);
  }

  // ---- Profile pictures ---------------------------------------------------

  // On a profile page, a button over the corner of the profile picture,
  // shown while the pointer is over it.
  function addProfileButton() {
    const header = document.querySelector('main header');
    const img = header && header.querySelector('img');
    if (!img) return;
    const named = img.alt.match(/^(.+)'s profile picture$/);
    const path = location.pathname.match(/^\/([\w.]+)\/(?:$|tagged\/|reels\/)/);
    const user = named ? named[1] : path && path[1];
    if (!user) return;
    // Beside the picture's link or button, not inside it, so a click on the
    // download button opens nothing.
    let target = img;
    for (let n = img; n && n !== header; n = n.parentElement) {
      if (n.matches('[role="button"], [role="link"], a, button')) target = n;
    }
    const frame = target.parentElement;
    if (!frame || frame === header) return;
    const old = frame.querySelector(':scope > .sinsta-dl-avatar');
    if (old && old.dataset.user === user) return;
    if (old) old.remove();
    const b = downloadButton('sinsta-dl-avatar', 'Download profile picture', () => downloadProfilePic(user));
    b.dataset.user = user;
    frame.dataset.sinstaAvatar = '';
    frame.append(b);
  }

  // ---- Wiring -------------------------------------------------------------

  function scan() {
    queued = false;
    for (const svg of document.querySelectorAll(SAVE)) {
      if (!svg.closest('.sinsta-hide, #sinsta-viewer, #sinsta-reel-player')) addPostButton(svg);
    }
    addProfileButton();
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(scan, 150);
  }

  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  schedule();
})();
