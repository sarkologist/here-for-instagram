# AMO store listing

Paste-ready text for the addons.mozilla.org Developer Hub. Keep the name and summary in sync with `manifest.json`.

## Name

**Here for Instagram**

This matches `manifest.name`. AMO allows up to 50 characters, and the trademark sits in the "for Instagram" position its policies expect.

## Summary

At most 250 characters; this is 224.

> Instagram on your terms. Home splits into Following, Favourites and Algo, with each post in exactly one. Posts you've seen are hidden, Home, Explore, Reels and profiles become a grid with a player, and stories play in order.

## Description

**You came for the people you follow. Here's just that.**

Instagram's Home mixes the accounts you follow with suggestions, ads and reshuffled old posts, so you never know if you've seen everything. Here for Instagram splits it into three views that never overlap, each in a predictable order.

**Three views, no overlap**
- **Following:** the accounts you follow, newest first, with their stories on top.
- **Favourites:** only the accounts you starred, newest first, with every one of their stories.
- **Algo:** Instagram's suggestions, kept apart, for when you want them.
- Opening Instagram returns to the view you were last on. Ads are hidden everywhere.

**Caught up means caught up**
- "Hide seen" (on by default) removes posts you saw on an earlier visit, in all three views, Explore and profiles.
- A tick marks each post as it counts as seen; click it to undo.
- When nothing new is left, it says "You're caught up" instead of scrolling on forever.

**A list or a grid, everywhere**
- Home, Explore, Reels and profiles show as a list of photos and videos, or a grid of 1 to 8 columns. Hover a tile to see its caption and preview its video.
- Click a post to open the player, which goes through the view in order, with the caption, likes and comments beside it. Videos get a seekbar and playback speed, and photo posts play their song.
- Each post you open gets its own address, so Back and Forward work and links can be shared.
- Carousels swipe and scroll natively; in the grid, moving the pointer across one flips through it.

**Stories where you want them**
- Following and Favourites get a stories row, which Instagram doesn't show on those views. The Favourites row has every favourite's stories, not just the ones Instagram's tray happens to include.
- Start on an unwatched account and the viewer stops after the last unwatched story, instead of rolling on into ones you've already seen.
- Nothing moves on by itself: a photo stays until you click on, and a video loops.
- The accounts before and after the current one fan out on either side. Swipe or scroll to turn through them; hover one to flip through its stories.
- On your own story, a pill counts viewers, likes and replies; click it to see who.
- Replying, reacting and liking all still work.

**Small things**
- A star on account cards adds or removes Favourites.
- Saved gets its own place in the main menu.

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

1. `1-following.png`: Following shows the accounts you follow, newest first, with their stories on top. Here as a grid; a list is one click away.
2. `2-stories.png`: Stories play in order, with the accounts before and after fanned out on either side. Hover one to peek at its stories.
3. `3-reels-grid.png`: Reels as a grid. Pick from 1 to 8 columns, and hover to preview.
4. `4-reels-player.png`: Play any view in order, with likes and comments beside the post.

## Before you upload

- Build from a clean commit with `node scripts/package.mjs`, which writes `web-ext-artifacts/here-for-instagram-<version>.zip`.
- AMO never accepts a version number twice, so bump `version` in `manifest.json` for every later upload.
- Paste [reviewer-notes.md](reviewer-notes.md) into "Notes to reviewer". The code isn't minified, so no source zip is needed.

## Release notes

### 2.0.0

- Home, Explore, Reels and profiles: drawn by the extension, as a list or a grid of 1 to 8 columns, without ads.
- Player: click a post to go through the view in order, with the caption, likes and comments beside it. Videos get a seekbar and playback speed, and photo posts play their song.
- Each post and story you open gets its own address and history step, so Back and Forward work, and links can be shared.
- Hide seen: now in Algo, Explore and profiles too. A tick shows when a post counts as seen, and clicking it undoes that. In the grid, a post counts once scrolled past or hovered for a second.
- Carousels: swipe and scroll natively, with momentum; dots along the bottom; in the grid, moving the pointer across one flips through it.
- Stories: your own story shows a pill counting viewers, likes and replies, and who in a panel beside it.
- Stories: the name, bars and reply box show only on hover; a click outside the story closes the viewer; a profile's picture opens its story in the extension's viewer.
- Stories: watched accounts are remembered separately for each Instagram account.
- Reels is a tab in the bar and leaves Instagram's menu.
- New icon.

### 1.1.0

- Stories: swipe sideways on a trackpad, or scroll a mouse wheel, to turn the carousel of accounts.
- Stories: the accounts beside the current one show their profile picture and a dot per story: pink for unwatched, grey for watched.
- Stories: hovering an account fans the deck open there; moving across it flips through that account's stories, and clicking lands on the one shown.
- Stories: nothing moves on by itself any more. A photo stays until you click on, and a video loops.
- Stories: stories, videos especially, show sooner, and the carousel turns more smoothly.
- Carousels in the feed: a trackpad is left to Instagram's own carousel, which scrolls sideways with momentum, while scrolling up and down moves the feed. A mouse wheel still steps through slides.

### 1.0.1

- Fixed: on Reels, Instagram's sidebar now widens over the grid on hover, instead of being covered by it, and the grid no longer resizes when it does.
- Fixed: Saved in the main menu showed no label, and a ring round its icon, in Instagram's new sidebar.

### 1.0.0

First public release.
