# Here for Instagram

Firefox extension that keeps Instagram's streams on separate surfaces.

Home gets a switcher with three views that never overlap: each post and story appears in exactly one of them.

| View | Posts | Order | Stories |
| --- | --- | --- | --- |
| Algo | suggested accounts you don't follow | Instagram's ranking | none |
| Following | accounts you follow, except favourites | newest first | the same accounts |
| Favourites | accounts you starred | newest first | starred accounts only |

Opening instagram.com reopens whichever view you were last on.

Algo is Instagram's normal home feed keeping only its "Suggested for you" posts (about half of it), plus its suggested-accounts blocks. Posts from accounts you follow, ads, and Instagram's stories row are hidden there. Following and Favourites are Instagram's own views; the extension adds the stories row they lack and takes favourites out of Following. Ads are hidden everywhere.

Explore is untouched.

## Hide seen

Following and Favourites have a "Hide seen" toggle (on by default). With it on, posts you saw before this visit are removed from the feed, so it shows only what you haven't seen. Turn it off for the strict, complete timeline.

- A post counts as seen once half of it (or half the screen) has shown it for a second, in any of the three views.
- A visit starts when the page loads, when you switch view, and when you flip the toggle. Posts you see during a visit stay put until the next one.
- When the visible posts run out, the extension keeps Instagram loading older posts in the background to find unseen ones, showing how many it has skipped. After 120 seen posts in a row it pauses with "You're caught up" and offers "Look further back" (another 120) or "Show posts you've seen". At the real end of the feed it says so.
- Seen posts are remembered in the extension's own storage for 60 days. Nothing is sent to Instagram.

## Stories on Following and Favourites

Clicking a story opens the extension's own viewer, which goes through the row in order (so Favourites stays within starred accounts) and preloads the next few stories. Nothing moves on by itself: a photo stays until you click on, and a video loops. Started on an unwatched account, it closes after the last unwatched one; started on a watched one, it plays to the end of the row. Viewing marks a story as seen, as on Instagram.

The accounts before and after the current one fan out on either side of it: the nearest ones large and flat, farther ones smaller, narrower and slightly turned, as many as the window has room for. Each shows the story you'd land on (the last one of an account behind, the first unwatched one of an account ahead) and which of its stories that is, and clicking it goes there. Hovering a card fans the deck open there, like a hand of cards: the cards on top of it slide aside so more of it shows. After the carousel turns, a card that stops under the pointer waits for the pointer to move before opening.

Unwatched stories come first, then fully watched ones with a grey ring, each group newest first. Watched ones stay until their stories expire.

- **Favourites** asks Instagram for every favourite's stories directly, so the row is complete, including stories you watched on your phone.
- **Following** uses Instagram's stories tray, which is Instagram's own pick of at most 120 accounts, so it can miss some; favourites are left out. Accounts you fully watch in this browser are remembered and kept at the end even after the tray drops them.

| Input | Action |
| --- | --- |
| Click right / `→` | next story |
| Click left third / `←` | previous story |
| `Shift` + `→` / `←` | next / previous account |
| Swipe sideways (trackpad), or scroll (mouse wheel) | turn the carousel of accounts |
| Hold, or `Space` | pause a video |
| `M` | sound on/off |
| `L` | like |
| `Esc` | close |

Scrolling only moves between accounts; clicks move between an account's stories. The carousel turns as you swipe, with the trackpad's momentum, and comes to rest on an account; a mouse wheel turns it smoothly and settles on the nearest account when you stop.

Stickers work as on Instagram: @mentions, hashtags and locations open their page, and links open in a new tab (the story pauses while the pointer is over one). Tapping the middle of a shared post, reel or story shows Instagram's bubble ("View reel", or the original poster's name), which opens it; the next tap elsewhere dismisses it. The same links sit under the account name ("View post" or "View reel", and "from @…"), beside the title of any song.

The bar along the bottom replies to the story in the author's DMs, as on Instagram: type and press `Enter`. While the reply box is open the story pauses and the quick reactions appear (😂 😮 😍 😢 👏 🔥 🎉 💯), each sent with one click. `Esc` leaves the box. The heart beside it likes the story. Stories whose author turned off replies show only the heart.

Polls, quizzes, sliders and question stickers can't be answered: Instagram only accepts those answers from its phone app, and its own website shows them as unsupported too.

## Reels grid

Reels shows Instagram's Reels feed as a grid of covers, like the app's grids, instead of one reel at a time. More load as you scroll. Hovering a cover plays it silently.

- **Columns:** the − / + buttons in the top-right corner (or the `-` and `+` keys) set 1 to 8 columns. Covers never get taller than the window, so few columns leave margins on wide screens.
- **Player:** clicking a cover plays the grid in order from there, with sound, carrying on from where its hover preview got to. `↓` / `↑` (or scrolling, or the arrow buttons) move to the next and previous reel, `Space` pauses, `M` toggles sound, the slider beside the sound button (or scrolling over it) sets the volume, `Esc` closes and lands the grid on the reel you stopped at. Ctrl/⌘-click a cover to open it in a new tab instead.
- **Likes and comments:** beside the video are the like button (`L`), the comments button (`C`) with the comment count, and a button that copies the reel's link. Comments open in a panel beside the video, which stays open as you move between reels until you close it (`C` or `Esc`). It loads more as you scroll; replies load under their comment, and comments can be liked, replied to (Reply) and posted (`Enter`; `Shift+Enter` for a new line).
- **Links:** opening a link to one reel (`/reels/<code>/`) puts it first in the grid and plays it.
- **Grid** in the corner switches back to Instagram's own player and back; the choice and the column count are remembered. Leaving Reels and coming back keeps the grid where it was until the page reloads.
- The player doesn't report views to Instagram, so watching here doesn't tune the feed the way Instagram's player does.

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

## Limits

- Posts are sorted by English UI labels ("Ad" and "Sponsored" for ads; "Suggested for you" or a Follow button for suggestions), and Instagram's stories row by its "Story by" labels.
- The Reels grid uses the internal query Instagram's Reels tab loads its feed with. If it changes, the grid says it couldn't load reels; Grid in the corner switches back to Instagram's player.
- Story replies, reactions and likes, and likes and comments in the Reels grid's player, use Instagram's comments endpoint and the saved queries its own like, comment and reply buttons send. If those change, a like flips back and a reply or comment says it couldn't be sent.
- The stories row and viewer rely on Instagram's internal endpoints (the stories tray, the favourites list, and two saved queries its own viewer uses). If the row's endpoints change, the row disappears; if the viewer's queries change, stories open in Instagram's viewer instead. The rest keeps working.
- When several hidden posts load in a row (in Algo, a run of posts from accounts you follow), a note says so and the space below stays blank until more arrive as you scroll.

## License

[MPL-2.0](LICENSE)
