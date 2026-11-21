# Notes for AMO reviewers

Paste the section below into "Notes to reviewer" when uploading a version.

---

**Source.** The XPI is the source: plain JavaScript and CSS, not compiled, bundled or minified, with no build step and no third-party libraries. No source-code submission is needed.

**What it does.** It changes Instagram's web UI on www.instagram.com only. It splits Home into three non-overlapping views (suggested accounts, accounts you follow, and favourites), can hide posts you've already seen, shows Reels as a grid, has its own story viewer, and adds download buttons for posts, reels, stories and profile pictures.

**Network.** The content scripts make same-origin requests to www.instagram.com: Instagram's own web API and GraphQL queries, the same ones its web app sends, using the session the user is already signed in with. Downloads save the media URLs those API responses return (Instagram's CDN), through `browser.downloads` in the background script. Nothing is sent to the developer or to any third party. There is no remote code, `eval` or dynamically built HTML.

**Data.** `browser.storage.local` holds the IDs of posts and stories the user has seen (kept 60 days) and view settings. It never leaves the browser, so `data_collection_permissions.required` is `["none"]`.

**Permissions.**
- `storage`: the seen lists and settings above.
- `downloads`: saving media the user clicks to download.

There are no host permissions. The content scripts match `*://www.instagram.com/*` only.

**Testing.** This needs a signed-in Instagram account, ideally one that follows a few accounts. To try it:
1. Home shows the switcher (Algo / Following / Favourites).
2. The download button sits beside each post's Save button.
3. Open Reels to see the grid.
4. Click a story in Following to open the extension's viewer.
