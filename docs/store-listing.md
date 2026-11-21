# AMO store listing

Paste-ready text for the addons.mozilla.org Developer Hub. Keep the name and summary in sync with `manifest.json`.

## Name

**Here for Instagram**

This matches `manifest.name`. AMO allows up to 50 characters, and the trademark sits in the "for Instagram" position its policies expect.

## Summary

At most 250 characters; this is 197.

> Instagram on your terms. Home splits into Algo, Following and Favourites, with each post in exactly one. Posts you've seen are hidden, stories play in order, and Reels become a grid you can browse.

## Description

**You came for the people you follow. Here's just that.**

Instagram's Home mixes the accounts you follow with suggestions, ads and reshuffled old posts, so you never know if you've seen everything. Here for Instagram splits it into three views that never overlap, each in a predictable order.

**Three views, no overlap**
- **Following:** the accounts you follow, newest first, with their stories on top.
- **Favourites:** only the accounts you starred, newest first, with every one of their stories.
- **Algo:** Instagram's suggestions, kept apart, for when you want them.
- Opening Instagram returns to the view you were last on. Ads are hidden everywhere.

**Caught up means caught up**
- "Hide seen" (on by default) removes posts you saw on an earlier visit, so Following and Favourites show only what's new.
- When nothing new is left, it says "You're caught up" instead of scrolling on forever.

**Stories where you want them**
- Following and Favourites get a stories row, which Instagram doesn't show on those views. The Favourites row has every favourite's stories, not just the ones Instagram's tray happens to include.
- Start on an unwatched account and the viewer stops after the last unwatched story, instead of rolling on into ones you've already seen.
- The accounts before and after the current one fan out on either side. Click one to jump straight to it.
- Replying, reacting and liking all still work.

**Reels as a grid**
- Browse Reels as a grid of covers, from 1 to 8 columns, and hover a cover to preview it.
- Click a cover to play the grid in order, with likes and comments beside the video.

**Small things**
- A star on account cards adds or removes Favourites.
- Saved gets its own place in the main menu.
- Scrolling over a carousel steps through its photos.

**Private**
Everything is stored in your browser. The extension talks only to Instagram, as Instagram's own website does, and sends nothing to its developer or anyone else.

Here for Instagram works with Instagram's English interface. It is not affiliated with or endorsed by Instagram or Meta.

## Permissions

- **Storage:** remembers which posts and stories you've seen (for 60 days) and your view settings, in your browser only.

It collects no data (`data_collection_permissions.required = ["none"]`), so no privacy policy is needed. Confirm this in the "Data collection" step of the submission form.

## Listing metadata

- **Category:** Social & Communication.
- **Tags:** social media, content blocker. AMO only offers a fixed list, which has no Instagram tag.
- **Homepage:** https://github.com/sarkologist/here-for-instagram. **Support website:** its Issues page.
- **Firefox for Android:** leave it unticked. The extension has only been used on desktop.
- **License:** Mozilla Public License 2.0, matching `LICENSE`.

## Screenshots

`node screenshots/render.mjs` renders these into `docs/screenshots/` at 1280×800 (see `screenshots/README.md`). The posts and reels are NASA's public ones, which are generally public domain, picked to leave out identifiable people. The commenters and comments are made up, and no personal account appears.

Captions, in order:

1. `1-following.png`: Following shows the accounts you follow, newest first, with their stories on top. Favourites and Algo are one click away.
2. `2-stories.png`: Stories play in order, with the accounts before and after fanned out on either side.
3. `3-reels-grid.png`: Reels as a grid. Pick from 1 to 8 columns, and hover to preview.
4. `4-reels-player.png`: Play the grid in order, with likes and comments beside the video.

## Before you upload

- Build from a clean commit with `node scripts/package.mjs`, which writes `web-ext-artifacts/here-for-instagram-<version>.zip`.
- AMO never accepts a version number twice, so bump `version` in `manifest.json` for every later upload.
- Paste [reviewer-notes.md](reviewer-notes.md) into "Notes to reviewer". The code isn't minified, so no source zip is needed.

## Release notes

### 1.0.1

- Fixed: on Reels, Instagram's sidebar now widens over the grid on hover, instead of being covered by it, and the grid no longer resizes when it does.
- Fixed: Saved in the main menu showed no label, and a ring round its icon, in Instagram's new sidebar.

### 1.0.0

First public release.
