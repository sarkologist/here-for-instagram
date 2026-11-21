# Notes for AMO reviewers

Paste the section below into "Notes to reviewer" when uploading a version.

---

**Source.** The XPI is the source: plain JavaScript and CSS, not compiled, bundled or minified, with no build step and no third-party libraries. No source-code submission is needed.

**What it does.** It changes Instagram's web UI on www.instagram.com only. It splits Home into three non-overlapping views (suggested accounts, accounts you follow, and favourites), can hide posts you've already seen, shows Reels as a grid, and has its own story viewer.

**Network.** The content scripts make same-origin requests to www.instagram.com: Instagram's own web API and GraphQL queries, the same ones its web app sends, using the session the user is already signed in with. Images and videos load from the CDN URLs those responses return, as on Instagram itself. Nothing is sent to the developer or to any third party. There is no remote code, `eval` or dynamically built HTML.

**Data.** `browser.storage.local` holds the IDs of posts and stories the user has seen (kept 60 days) and view settings. It never leaves the browser, so `data_collection_permissions.required` is `["none"]`.

**Permissions.** Only `storage`, for the seen lists and settings above. There is no background script and there are no host permissions. The content scripts match `*://www.instagram.com/*` only.

**Testing.** This needs a signed-in Instagram account, ideally one that follows a few accounts. To try it:
1. Home shows the switcher (Algo / Following / Favourites).
2. Hide seen is on by default in Following and Favourites.
3. Open Reels to see the grid.
4. Click a story in Following to open the extension's viewer.
