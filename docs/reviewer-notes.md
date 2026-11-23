# Notes for AMO reviewers

Paste the section below into "Notes to reviewer" when uploading a version.

---

**Source.** The XPI is the source: plain JavaScript and CSS, not compiled, bundled or minified, with no build step and no third-party libraries. No source-code submission is needed.

**What it does.** It changes Instagram's web UI on www.instagram.com only. It splits Home into three non-overlapping views (suggested accounts, accounts you follow, and favourites), can hide posts you've already seen, shows Reels as a grid, and has its own story viewer. It can also keep different Instagram accounts signed in in different container tabs.

**Network.** The content scripts make same-origin requests to www.instagram.com: Instagram's own web API and GraphQL queries, the same ones its web app sends, using the session the user is already signed in with. Images and videos load from the CDN URLs those responses return, as on Instagram itself. Nothing is sent to the developer or to any third party. There is no remote code, `eval` or dynamically built HTML.

**Data.** `browser.storage.local` holds the IDs of posts and stories the user has seen (kept 60 days), view settings, and for the account list each signed-in account's Instagram user ID, username and profile-picture URL, plus the IDs of containers the extension made. It never leaves the browser, so `data_collection_permissions.required` is `["none"]`.

**Permissions.**
- `storage`: the data above.
- `cookies` and `*://*.instagram.com/*`: the background script reads Instagram's `ds_user_id` and `sessionid` cookies in each cookie store to tell which account is signed in where, and watches them change so tabs loaded for a previous account can reload. When the user makes a container for another account, it copies the current store's instagram.com cookies into the new container. Cookies are never read for any other site and never sent anywhere.
- `contextualIdentities`: to list containers, make one per additional account, and name it after its account.

The background script (`background.js`) makes no network requests. The address-bar button (`page_action`, shown on www.instagram.com only) opens `popup.html`, the account list. The content scripts match `*://www.instagram.com/*` only.

**Testing.** This needs a signed-in Instagram account, ideally one that follows a few accounts. To try it:
1. Home shows the switcher (Algo / Following / Favourites).
2. Hide seen is on by default in Following and Favourites.
3. Open Reels to see the grid.
4. Click a story in Following to open the extension's viewer.
5. Click the extension's address-bar button: it lists the signed-in account. "New tab for another account" opens a container tab signed in as the same account; switching account there (Instagram's own switcher) leaves the first tab on the first account.
