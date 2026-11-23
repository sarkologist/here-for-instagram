// Which account this page is signed in as, and reloading when that changes.
//
// The background script knows the account under each tab's cookie jar (see
// background.js). A page loaded for one account breaks once the jar switches
// to another, so it reloads: right away when hidden tabs come back into view,
// and after a moment when visible, which leaves the tab that made the switch
// time to navigate on its own.
const SinstaAccount = (() => {
  'use strict';

  const runtime = typeof browser === 'object' && browser.runtime && browser.runtime.sendMessage ? browser.runtime : null;
  const VISIBLE_WAIT = 3000;

  // The user id the page was loaded as; null when signed out or unknown.
  const userId = runtime
    ? runtime.sendMessage({ type: 'whoami' }).then((r) => (r && r.userId) || null, () => null)
    : Promise.resolve(null);

  let stale = false;
  function reloadWhenSeen() {
    if (stale) return;
    stale = true;
    if (document.hidden) {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) location.reload();
      });
    } else {
      setTimeout(() => location.reload(), VISIBLE_WAIT);
    }
  }

  if (runtime) {
    runtime.onMessage.addListener(async (m) => {
      if (!m || m.type !== 'account') return;
      if ((await userId) !== (m.userId || null)) reloadWhenSeen();
    });
  }

  // Name the account for the account list, from Instagram's Profile link.
  let reported = '';
  function report(username, pic) {
    const key = username + '|' + (pic || '');
    if (!runtime || !username || key === reported) return;
    reported = key;
    // With the page's own account: one loaded before a switch still shows
    // the old name, which must not be taken for the new account's.
    userId.then((id) => id && runtime.sendMessage({ type: 'viewer', userId: id, username, pic: pic || null }))
      .catch(() => {});
  }

  return { userId, report };
})();
