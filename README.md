# Here for Instagram

Firefox extension that keeps Instagram's streams on separate surfaces.

Home gets a tab bar with three views that never overlap (each post and story appears in exactly one of them), plus Reels. The accounts you chose come first, then Instagram's picks:

| Tab | Posts | Order | Stories |
| --- | --- | --- | --- |
| Following | accounts you follow, except favourites | newest first | the same accounts |
| Favourites | accounts you starred | newest first | starred accounts only |
| Algo | suggested accounts you don't follow | Instagram's ranking | none |
| Reels | Instagram's Reels feed | Instagram's ranking | none |

Opening instagram.com reopens whichever of the first three you were last on.

The extension draws these views itself, from the feeds Instagram's own pages load, as a list or a grid (see below). Algo is Instagram's home feed keeping only posts from accounts you don't follow (about half of it); Following and Favourites are Instagram's chronological feeds, with favourites taken out of Following and a stories row added. Ads are left out everywhere.

If a feed can't be loaded, that view shows Instagram's own page instead, filtered the same way (by its "Suggested for you" and "Sponsored" labels). Explore is untouched.

## List and grid

The List / Grid switch in the tab bar (or `G`) applies to all four tabs.

- **List:** one post under another, showing just the photo or video. The name, buttons (like, comments, copy link), likes and the full caption appear over it while the pointer is on it. Videos play silently while on screen. Clicking a post opens it in the player (below); double-click likes it instead; with the pointer on it, `L` likes and `C` opens its comments. On Reels, List is Instagram's own player.
- **Grid:** tiles in columns, each post uncropped (within Instagram's 4:5 to 1.91:1) and reels 9:16. Hovering a tile shows its caption, name and likes, and plays a video silently. The − / + buttons beside the switch (or the `-` and `+` keys) set 1 to 8 columns, separately for each tab. Tiles never get taller than the window, so few columns leave margins on wide screens. Ctrl/⌘-click a tile to open it in a new tab.
- **Carousels:** in both, a post with several photos or videos has a dot per item along its bottom, always showing. Swiping sideways (trackpad, touch, or `Shift` + mouse wheel) goes through them, and the player opens on the one showing.
- **Player:** clicking a tile, or a post's comments, opens the player, which goes through the tab in order. The caption, in full, and the comments sit beside the post (`C` hides them). `↓` / `↑` (or scrolling, or the arrow buttons) move to the next and previous post; `←` / `→`, swiping sideways, or clicking (the left third goes back, elsewhere on) go through a carousel's photos, as in the story viewer; on anything else the arrow keys move between posts, and a click pauses a video. In a carousel, double-click doesn't like (two clicks go through it); `L` does. For videos, `Space` pauses, `M` toggles sound, the slider beside the sound button (or scrolling over it) sets the volume, the seekbar along the bottom seeks, and the speed button (or `<` / `>`) sets the playback speed from 0.5× to 2× (remembered). `L` likes, `Esc` closes and lands the view on the post you stopped at.
- **Likes and comments:** comments load as you scroll; replies load under their comment, and comments can be liked, replied to (Reply) and posted (`Enter`; `Shift+Enter` for a new line).

Each tab keeps its place while you visit the others, until the page reloads. The player doesn't report views to Instagram, so watching here doesn't tune its feeds the way its own pages do.

## Hide seen

Following and Favourites have a "Hide seen" toggle (on by default). With it on, posts you saw before this visit are removed from the feed, so it shows only what you haven't seen. Turn it off for the strict, complete timeline, where posts seen before this visit are dimmed.

- In the list, a post counts as seen once half of it (or half the screen) has shown it for a second, in any of the three views. In the grid, a post counts as seen when you open it.
- A visit starts when the page loads, when you switch view, and when you flip the toggle. Posts you see during a visit stay put until the next one.
- When the visible posts run out, the extension keeps loading older posts to find unseen ones, showing how many it has skipped. After 120 seen posts in a row it pauses with "You're caught up" and offers "Look further back" (another 120) or "Show posts you've seen". At the real end of the feed it says so.
- Seen posts are remembered in the extension's own storage for 60 days. Nothing is sent to Instagram.

## Stories on Following and Favourites

Clicking a story opens the extension's own viewer, which goes through the row in order (so Favourites stays within starred accounts) and preloads the next few stories. Nothing moves on by itself: a photo stays until you click on, and a video loops. Started on an unwatched account, it closes after the last unwatched one; started on a watched one, it plays to the end of the row. Viewing marks a story as seen, as on Instagram. The account's name, the progress bars, the buttons and the reply box show only while the pointer is over the story. The profile picture at the top of a profile opens that account's story in the same viewer, on its own.

The accounts before and after the current one fan out on either side of it: the nearest ones large and flat, farther ones smaller, narrower and slightly turned, as many as the window has room for. Each shows the story you'd land on (the last one of an account behind, the first unwatched one of an account ahead) with the account's profile picture and a dot per story under it: white for that story, pink for unwatched ones, grey for watched ones. Clicking it goes there. Hovering a card fans the deck open there, like a hand of cards: the cards on top of it slide aside so more of it shows. Moving across the part that shows flips through that account's stories, and clicking lands on the one it shows. After the carousel turns, a card that stops under the pointer waits for the pointer to move before opening.

Unwatched stories come first, then fully watched ones with a grey ring, each group newest first. Watched ones stay until their stories expire. The row shows profile pictures only; hovering one shows the account's name.

- **Favourites** asks Instagram for every favourite's stories directly, so the row is complete, including stories you watched on your phone.
- **Following** uses Instagram's stories tray, which is Instagram's own pick of at most 120 accounts, so it can miss some; favourites are left out. Accounts you fully watch in this browser are remembered (separately for each Instagram account you log in with) and kept at the end even after the tray drops them.

| Input | Action |
| --- | --- |
| Click right / `→` | next story |
| Click left third / `←` | previous story |
| `Shift` + `→` / `←` | next / previous account |
| Swipe sideways (trackpad), or scroll (mouse wheel) | turn the carousel of accounts |
| Hold, or `Space` | pause a video |
| `M` | sound on/off |
| Speed button, or `<` / `>` | playback speed of a video (0.5× to 2×) |
| `L` | like |
| Click outside the story, or `Esc` | close |

A video story has a seekbar above the reply box, with its time; dragging or clicking it seeks. The speed stays as set until the page reloads.

Scrolling only moves between accounts; clicks move between an account's stories. The carousel turns as you swipe, with the trackpad's momentum, and comes to rest on an account; a mouse wheel turns it smoothly and settles on the nearest account when you stop.

Stickers work as on Instagram: @mentions, hashtags and locations open their page, and links open in a new tab (the story pauses while the pointer is over one). Tapping the middle of a shared post, reel or story shows Instagram's bubble ("View reel", or the original poster's name), which opens it; the next tap elsewhere dismisses it. The same links sit under the account name ("View post" or "View reel", and "from @…"), beside the title of any song.

The bar along the bottom replies to the story in the author's DMs, as on Instagram: type and press `Enter`. While the reply box is open the story pauses and the quick reactions appear (😂 😮 😍 😢 👏 🔥 🎉 💯), each sent with one click. `Esc` leaves the box. The heart beside it likes the story. Stories whose author turned off replies show only the heart.

Polls, quizzes, sliders and question stickers can't be answered: Instagram only accepts those answers from its phone app, and its own website shows them as unsupported too.

## Reels

Reels is a tab in the bar, and leaves Instagram's menu. In the grid, more reels load as you scroll; the player and its likes and comments work as above.

- **Links:** opening a link to one reel (`/reels/<code>/`) puts it first in the grid and plays it.
- **List** is Instagram's own player, with the tab bar floating above it.

## Other tweaks

- **Saved** is in the main menu, under Profile, instead of only under "More".
- **Favourite star:** the card that pops up when hovering an account you follow has a star beside "Following" to add it to or remove it from Favourites. The account moves between Following and Favourites at once, except that someone added shows up in the Favourites feed only after a reload. Changes made elsewhere (the app, another tab) are picked up within 5 minutes. Instagram allows 50 favourites; when full, the star is dimmed.
- **App-only notifications:** some notifications, such as "X added to their story" for accounts you get alerts for, light the Notifications dot but never appear in the web panel. When that's the case, Notifications gets a phone icon with their count (visible when the sidebar shows labels) and a tooltip saying so. Checking doesn't clear the dot.
  - The extension checks once a minute and notes when the count rises. A notification arrives right after what it's about, so the tooltip names the stories and posts by followed accounts published in that gap, favourites first: "Probably" when the gap is under about 15 minutes, "Possibly" when it's wider (for example, Firefox was closed). Clicking the phone icon opens the first guess instead of the panel.
  - Stories come from Instagram's stories tray (at most 120 accounts) plus every favourite; posts from the Following feed.
- **Carousels:** with the cursor over a carousel's photos, scrolling steps through its slides (down = next, up = previous). Past the last slide, or before the first, the feed scrolls as usual. A trackpad is left to Instagram's own carousel, which scrolls sideways with momentum, while scrolling up and down moves the feed.

## Install

Temporary (gone on restart): open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", pick `manifest.json`. After editing files, click "Reload" there.

Permanent: sign it as an unlisted add-on with `npx web-ext sign` (needs AMO API keys), or use Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

## Publishing

`node scripts/package.mjs` writes `web-ext-artifacts/<name>-<version>.zip` for upload to AMO. It refuses a dirty tree and zips from `HEAD`. It ships only the files `manifest.json` references, and fails if any of them contains an absolute developer path or your user name, git name or git email. Paste the notes in [docs/reviewer-notes.md](docs/reviewer-notes.md) into "Notes to reviewer".

## Tests

`tests/` checks what the extension shows, in headless Firefox, with its own scripts on a stand-in instagram.com answering for made-up logged-in accounts: the stories row on Following and Favourites (including after switching accounts), what a profile's picture opens, and what each tab shows, in the list, the grid and the player, with Hide seen on and off, and when a feed can't be loaded. CI runs them.

```bash
cd tests && npm ci && npx playwright install firefox && npm test
```

## Performance evals

`perf/` measures the stories carousel and the feed in Firefox, against what people can perceive. It runs the extension's own scripts and `content.css` on a stand-in instagram.com, over a simulated 100 Mbps link with 40 ms round trips:
- **Stories:** synthetic accounts and stories, about 3 in 10 of them videos like Instagram's. It opens the viewer on a photo and on a video, watches a video, turns by key and click, steps through stories, hovers and scrubs cards, and swipes and scrolls.
- **Feed:** a stand-in for Instagram's home feed (`perf/feed-app.js`), built like the real one: posts of ~150 elements, only the ~9 near the screen in the page, pages of posts taking 2 s each from the server, and the next page asked for only on scroll. The extension's storage holds a 20,000-post seen history. It opens Following, opens it after three pages of posts already seen, scrolls Following and Algo by trackpad and mouse wheel, toggles "Hide seen", and switches view. This is Instagram's own page, which a view now only falls back to; the views the extension draws aren't measured yet.

Each scenario must keep:
- frames within 20 ms at the 99th percentile, and never more than two 60 Hz frames (33.4 ms);
- input painted within 50 ms (95th percentile), and never later than 100 ms;
- opening the viewer no more than 50 ms slower than the network allows, and the feed's first post no more than 50 ms slower than without the extension (or, after pages of seen posts, than the network allows, per page);
- videos dropping under 1% of their frames.

It also reports how long each move takes to show its story.

```
cd perf && npm install && npx playwright install firefox   # and ffmpeg with libx264, for the videos
node run.mjs                 # or: --suite feed, --suite stories
```

The Firefox window opens on a second display if there is one, and must stay uncovered and unresized while it runs (Firefox stops painting covered windows). Options (profiling, A/B testing CSS, comparing with an older version, the feed without the extension) are listed at the top of `perf/run.mjs`.

## Limits

- Posts are sorted by English UI labels ("Ad" and "Sponsored" for ads; "Suggested for you" or a Follow button for suggestions), and Instagram's stories row by its "Story by" labels.
- Home's views use the internal query Instagram's home page loads its feeds with, and Reels the one its Reels tab uses. If the home query changes, a view falls back to Instagram's own page; if the Reels one does, the grid says it couldn't load reels and List switches to Instagram's player. Algo also relies on the feed saying whether you follow each author; without that, it falls back too.
- Saving a post and sharing it to a chat aren't in the list or player yet: copy its link, or open it (Ctrl/⌘-click) on Instagram.
- Story replies, reactions and likes, and likes and comments in the list and player, use Instagram's comments endpoint and the saved queries its own like, comment and reply buttons send. If those change, a like flips back and a reply or comment says it couldn't be sent.
- The stories row and viewer rely on Instagram's internal endpoints (the stories tray, the favourites list, and two saved queries its own viewer uses). If the row's endpoints change, the row disappears; if the viewer's queries change, stories open in Instagram's viewer instead. The rest keeps working.
- On Instagram's own page (when a feed can't be loaded), when several hidden posts load in a row (in Algo, a run of posts from accounts you follow), a note says so and the space below stays blank until more arrive as you scroll.

## License

[MPL-2.0](LICENSE)
