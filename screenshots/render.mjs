// Renders the AMO listing screenshots into docs/screenshots/, in Playwright's
// Firefox, from made-up data (fixtures.mjs). No Instagram account or server is
// involved: every request to www.instagram.com is answered here, with a
// stand-in page for Instagram's own layout and fake API responses, and the
// extension's content scripts and CSS are loaded into it as they would be.
//
// Usage: node screenshots/render.mjs
// Needs Playwright with its Firefox (npm i -D playwright && npx playwright
// install firefox), resolved from this repo, or from the directory in
// PLAYWRIGHT_FROM if it's installed elsewhere. Needs ffmpeg for the reels'
// videos.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeData, makeRealData, picture } from "./fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const OUT = join(root, "docs/screenshots");
const CACHE = join(tmpdir(), "here-for-instagram-screenshots");
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const require = createRequire(import.meta.url);
const from = { paths: [process.env.PLAYWRIGHT_FROM || root, root] };
const pkg = ["playwright", "@playwright/test"].find((name) => {
  try {
    return require.resolve(name, from);
  } catch {
    return false;
  }
});
if (!pkg) throw new Error("Playwright not found: npm i -D playwright, or set PLAYWRIGHT_FROM to a project that has it");
const { firefox } = require(require.resolve(pkg, from));

// Real public posts when screenshots/real/ has them (and FAKE isn't set),
// else made-up ones.
const REAL = join(here, "real");
const real = !process.env.FAKE && existsSync(join(REAL, "media.json"));
const data = real
  ? makeRealData(
      JSON.parse(readFileSync(join(REAL, "hfi-nasa-demo.json"), "utf8")),
      JSON.parse(readFileSync(join(REAL, "media.json"), "utf8")),
      existsSync(join(REAL, "picks.json")) ? JSON.parse(readFileSync(join(REAL, "picks.json"), "utf8")) : null,
    )
  : makeData();
console.log(real ? "using real public posts from screenshots/real/" : "using made-up posts");
const read = (f) => readFileSync(join(root, f), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const cs = manifest.content_scripts[0];
// Playwright runs init scripts before <html> exists, which a real
// document_start content script never sees; start them once it does.
const SCRIPTS = `(() => {
  const run = () => {\n${cs.js.map(read).join("\n;\n")}\n};
  if (document.documentElement) return run();
  new MutationObserver((_, o) => {
    if (!document.documentElement) return;
    o.disconnect();
    run();
  }).observe(document, { childList: true });
})();`;
const CSS = cs.css.map(read).join("\n");

// ---- Instagram stand-in -----------------------------------------------------

const ICONS = {
  Home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  Search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  Explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  Reels: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 8h18M8 3l3 5M14 3l3 5M10 12v5l4.5-2.5z"/>',
  Messages: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  Notifications: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  Create: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
  More: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const svg = (name, size = 24) =>
  `<svg aria-label="${name}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

function sidebar(path) {
  const item = (name, href) =>
    `<div class="ni"><a href="${href}"${path === href ? ' aria-current="page"' : ""}>${svg(name)}<span>${name}</span></a></div>`;
  return `<div class="side"><div class="mark"></div><div class="menu">
    ${item("Home", "/")}${item("Search", "#search")}${item("Explore", "/explore/")}${item("Reels", "/reels/")}
    ${item("Messages", "/direct/inbox/")}${item("Notifications", "#notifications")}${item("Create", "#create")}
    <div class="ni"><a href="/${data.me.username}/"><img src="${data.me.pic}" alt=""><span>Profile</span></a></div>
    </div><div class="ni more"><a href="#more">${svg("More")}<span>More</span></a></div></div>`;
}

const ago = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 24 ? `${Math.round(h)}h` : h < 168 ? `${Math.floor(h / 24)}d` : `${Math.floor(h / 168)}w`);

function article(p) {
  return `<article>
    <div class="hd"><a class="av" href="/${p.user.username}/"><img src="${p.user.pic}" alt=""></a>
      <div class="who"><span><span><span><span><div><a href="/${p.user.username}/">${p.user.username}</a></div></span></span></span></span>
      <span class="dot">• <a href="/p/${p.code}/"><time>${ago(p.hoursAgo)}</time></a></span></div></div>
    <a class="media" href="/p/${p.code}/"><img src="${p.picture}" alt="" style="aspect-ratio: ${p.ratio || 0.8}"></a>
    <div class="acts">${svg("Notifications")}<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/></svg>${svg("Messages")}<span class="gap"></span>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-5-7 5V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1z"/></svg></div>
    <div class="likes">${p.likes.toLocaleString("en")} likes</div>
    <div class="cap"><b>${p.user.username}</b> ${p.caption}</div>
    <div class="more">View all ${p.comments} comments</div>
  </article>`;
}

function page(url) {
  const path = url.pathname;
  const home = path === "/";
  const body = home
    ? `<div class="row"><div class="feed">${data.posts.map(article).join("")}</div></div>`
    : `<div class="row"><div class="empty"></div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Instagram</title>
<script type="application/json">{"define":[["DTSGInitialData",[],{"token":"demo-dtsg"}],["LSD",[],{"token":"demo-lsd"}]],"device_id":"demo-device"}</script>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #000; font: 14px/18px -apple-system, "Helvetica Neue", Arial, sans-serif; }
a { color: inherit; text-decoration: none; }
.side { position: fixed; inset: 0 auto 0 0; width: 244px; padding: 8px 12px 20px; border-right: 1px solid #dbdbdb; display: flex; flex-direction: column; background: #fff; z-index: 2; }
.mark { height: 76px; } /* Instagram's logo goes here; left out */
.menu { flex: 1; }
.ni a { display: flex; align-items: center; gap: 16px; padding: 12px; margin: 2px 0; border-radius: 8px; font-size: 16px; }
.ni a:hover { background: #f2f2f2; }
.ni a[aria-current="page"] span { font-weight: 700; }
.ni img { width: 24px; height: 24px; border-radius: 50%; }
main { margin-left: 244px; min-height: 100vh; }
.row { display: flex; justify-content: center; padding-top: 22px; }
.feed { width: 470px; }
article { border-bottom: 1px solid #dbdbdb; padding-bottom: 16px; margin-bottom: 18px; }
.hd { display: flex; align-items: center; gap: 10px; padding: 0 4px 12px; }
.av img { width: 32px; height: 32px; border-radius: 50%; display: block; }
.who { display: flex; gap: 4px; font-weight: 600; }
.dot { color: #737373; font-weight: 400; }
.media img { display: block; width: 100%; object-fit: cover; border-radius: 4px; border: 1px solid #efefef; }
.acts { display: flex; gap: 14px; padding: 12px 2px 8px; }
.acts .gap { flex: 1; }
.likes { font-weight: 600; padding: 0 2px 6px; }
.cap { padding: 0 2px 6px; }
.more { color: #737373; padding: 0 2px; }
</style>
<style>${CSS}</style></head>
<body><div id="app">${sidebar(path)}<main role="main">${body}</main></div></body></html>`;
}

// ---- Fake API ----------------------------------------------------------------

const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

// A Following post as the home feed query returns it.
function feedMedia(p, i) {
  const w = 1080;
  return {
    pk: String(3700000000000000000n + BigInt(i)),
    code: p.code,
    media_type: 1,
    user: { username: p.user.username, profile_pic_url: p.user.pic, friendship_status: { following: true } },
    caption: { text: p.caption },
    like_count: p.likes,
    comment_count: p.comments,
    taken_at: Math.floor(Date.now() / 1000 - p.hoursAgo * 3600),
    image_versions2: { candidates: [{ url: p.picture, width: w, height: Math.round(w / (p.ratio || 0.8)) }] },
    music_metadata: null,
  };
}

function graphql(route) {
  const params = new URLSearchParams(route.request().postData() || "");
  const vars = JSON.parse(params.get("variables") || "{}");
  const doc = params.get("doc_id");
  const STORIES = "28739385832429456";
  const CLIPS = "29386172244354956";
  const FEED = "29639616438977013";
  if (doc === STORIES) {
    const reels_media = (vars.reel_ids_arr || []).map((id) => data.reels[id]).filter(Boolean);
    return json(route, { data: { xdt_api__v1__feed__reels_media: { reels_media } } });
  }
  if (doc === CLIPS) {
    const start = vars.after ? Number(vars.after) : 0;
    const page = data.clips.slice(start, start + 12);
    return json(route, {
      data: {
        xdt_api__v1__clips__home__connection_v2: {
          edges: page.map((media) => ({ node: { media } })),
          page_info: { has_next_page: start + 12 < data.clips.length, end_cursor: String(start + 12) },
        },
      },
    });
  }
  if (doc === FEED) {
    // Following is the posts; Favourites and Algo are empty (not shown).
    const posts = vars.variant === "following" ? data.posts : [];
    return json(route, {
      data: {
        xdt_api__v1__feed__timeline__connection: {
          edges: posts.map((p, i) => ({ node: { media: feedMedia(p, i) } })),
          page_info: { has_next_page: false, end_cursor: null },
        },
      },
    });
  }
  return json(route, { data: { ok: {} } }); // seen marks and the like: accepted
}

// The reels' videos: each its cover, held still, as VP9 (Playwright's
// Firefox has no H.264).
async function video(name, browser) {
  const file = join(CACHE, name);
  if (existsSync(file)) return readFileSync(file);
  const [, scene, seed] = name.match(/^(\w+)-(\d+)-540x960\.webm$/);
  const png = join(CACHE, `${scene}-${seed}.png`);
  const p = await browser.newPage({ viewport: { width: 540, height: 960 } });
  await p.setContent(`<body style="margin:0">${picture(`${scene}-${seed}-540x960`)}</body>`);
  await p.screenshot({ path: png });
  await p.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-t", "4", "-r", "24", "-c:v", "libvpx-vp9", "-b:v", "1M", "-pix_fmt", "yuv420p", file]);
  return readFileSync(file);
}

async function route(r, browser) {
  const req = r.request();
  const url = new URL(req.url());
  const path = url.pathname;
  if (path.startsWith("/__media/real/")) {
    const name = path.slice("/__media/real/".length).replace(/[^\w.-]/g, "");
    const file = join(REAL, "media", name);
    // A photo centre-cropped to 9:16, for stories.
    if (name.startsWith("story-") && !existsSync(file)) {
      const src = join(REAL, "media", name.slice("story-".length));
      if (existsSync(src)) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'", "-q:v", "3", file]);
    }
    if (!existsSync(file)) return r.fulfill({ status: 404 });
    const type = file.endsWith(".webm") ? "video/webm" : "image/jpeg";
    return r.fulfill({ status: 200, contentType: type, body: readFileSync(file) });
  }
  if (path.startsWith("/__media/")) {
    const name = path.slice("/__media/".length);
    if (name.endsWith(".webm")) return r.fulfill({ status: 200, contentType: "video/webm", body: await video(name, browser) });
    const body = picture(name.replace(/\.svg$/, ""));
    return body ? r.fulfill({ status: 200, contentType: "image/svg+xml", body }) : r.fulfill({ status: 404 });
  }
  if (path === "/api/v1/feed/reels_tray/") return json(r, { tray: data.tray });
  if (path === "/api/v1/friendships/feed_favorites/") return json(r, { users: data.favourites.map((u) => ({ pk_id: u.id, username: u.username })) });
  if (/^\/api\/v1\/media\/\d+\/comments\/$/.test(path)) return json(r, { comments: data.comments, has_more_comments: false });
  if (path === "/api/graphql" || path === "/graphql/query") return graphql(r);
  if (req.resourceType() === "document") return r.fulfill({ status: 200, contentType: "text/html", body: page(url) });
  return r.fulfill({ status: 404, body: "" });
}

// ---- Capture -------------------------------------------------------------------

const home = join(tmpdir(), "here-for-instagram-firefox-home"); // see Grove: macOS 27 TCC and Playwright's Firefox
mkdirSync(home, { recursive: true });
const browser = await firefox.launch({ env: { ...process.env, CFFIXED_USER_HOME: home } });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "light", locale: "en-US" });
await context.route("https://www.instagram.com/**", (r) => route(r, browser));
await context.addInitScript({ content: SCRIPTS });
const tab = await context.newPage();
tab.on("pageerror", (e) => console.error("page error:", e.message));

const settle = async () => {
  await tab.mouse.move(1279, 799);
  await tab.waitForFunction(
    () => [...document.images].every((i) => {
      const r = i.getBoundingClientRect();
      return i.complete || r.bottom < 0 || r.top > innerHeight || !r.width;
    }),
    null,
    { timeout: 15000 },
  );
  await tab.waitForTimeout(700);
};
const shot = async (name) => {
  await tab.screenshot({ path: join(OUT, name) });
  console.log(`wrote docs/screenshots/${name}`);
};

await tab.goto("https://www.instagram.com/?variant=following");
await tab.waitForSelector(".sinsta-story img");
await settle();
await shot("1-following.png");

await tab.locator(".sinsta-story").nth(2).click();
await tab.waitForSelector("#sinsta-viewer .sv-peek");
await tab.waitForFunction(() => !document.querySelector("#sinsta-viewer.sv-loading"));
await settle();
// Hover the next account's card, just right of the stage: the deck fans open
// there and shows its profile picture and a dot per story.
const stage = await tab.locator("#sinsta-viewer .sv-stage").boundingBox();
await tab.mouse.move(stage.x + stage.width + 24, stage.y + stage.height / 2, { steps: 4 });
await tab.waitForSelector("#sinsta-viewer .sv-peek-open-r");
await tab.waitForTimeout(700);
await shot("2-stories.png");
await tab.keyboard.press("Escape");

await tab.goto("https://www.instagram.com/reels/");
await tab.waitForSelector("#sinsta-surface .sf-tile img");
await tab.keyboard.press("+"); // 5 columns
await settle();
await shot("3-reels-grid.png");

await tab.locator("#sinsta-surface .sf-tile").first().click();
await tab.waitForSelector("#sinsta-reel-player .sr-video");
if (await tab.locator("#sinsta-reel-player .sr-comments").isHidden()) await tab.keyboard.press("c");
await tab.waitForSelector("#sinsta-reel-player .sr-c");
await settle();
await tab.waitForTimeout(1500); // the video, in a closed shadow root, has its first frame by now
await shot("4-reels-player.png");

await browser.close();
