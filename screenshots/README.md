# Listing screenshots

`node screenshots/render.mjs` renders the AMO screenshots into `docs/screenshots/` at 1280×800 (2× pixels).

Rendering makes no request to Instagram. Playwright's Firefox opens a stand-in for Instagram's page at `www.instagram.com`, and the script answers every request itself: the page, the API calls the extension makes, and the media. The extension's real content scripts and CSS run inside the page, as Firefox would load them.

## Content

With `screenshots/real/` present (it isn't committed), the screenshots show recent public posts and reels from NASA's Instagram accounts. NASA's imagery is generally public domain. Only the posters are real:
- **Comments:** the commenters and their comments are made up ([fixtures.mjs](fixtures.mjs)).
- **Stories:** these are each account's own photos, cropped to 9:16. Live stories often reshare other people's posts, so they aren't used.
- **Picks:** `real/picks.json` lists which photos and reels may appear, and the reels' order. It leaves out identifiable people (whose likeness can carry publicity rights even in public-domain media) and text-heavy graphics.

`screenshots/real/` holds:
- `hfi-nasa-demo.json`: the accounts' recent posts, exported from a signed-in browser by opening each profile and asking Instagram's media-info API about the posts shown.
- `media/` and `media.json`: the images and videos those posts point to, with videos converted to VP9 (Playwright's Firefox has no H.264).
- `picks.json`: the hand-picked subset.

Without `screenshots/real/`, or with `FAKE=1`, the script falls back to made-up accounts with drawn pictures.

## Requirements

- Playwright with its Firefox: `npm i -D playwright && npx playwright install firefox`. If it's installed in another project, point `PLAYWRIGHT_FROM` at that project's directory.
- `ffmpeg` with libvpx (VP9).

Re-run it whenever the extension's look changes.
