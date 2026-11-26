// Made-up accounts, posts, stories, reels and comments for the listing
// screenshots, and the pictures they show, drawn as SVG scenes. Nothing here
// is a real account or a real photo.

// ---- Pictures ---------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grad = (id, stops, vertical = true) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops
    .map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;

// A jagged ridge across the picture, as a closed polygon down to the bottom.
function ridge(r, w, h, base, rough, steps) {
  const pts = [[0, h]];
  for (let i = 0; i <= steps; i++) {
    const x = (w * i) / steps;
    const y = base - r() * rough - (i % 2 ? rough * 0.35 : 0);
    pts.push([x, y]);
  }
  pts.push([w, h]);
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

// A smooth hill line, as a closed path down to the bottom.
function dune(r, w, h, base, amp) {
  const n = 4;
  let d = `M0 ${h} L0 ${base}`;
  for (let i = 0; i < n; i++) {
    const x0 = (w * i) / n;
    const x1 = (w * (i + 1)) / n;
    const y1 = base + (r() - 0.5) * amp;
    d += ` Q${(x0 + x1) / 2} ${base - amp * (0.4 + r() * 0.6)} ${x1} ${y1}`;
  }
  return `${d} L${w} ${h} Z`;
}

const SCENES = {
  sunset(r, w, h) {
    const hy = h * (0.55 + r() * 0.1);
    const sx = w * (0.3 + r() * 0.4);
    let streaks = '';
    for (let i = 0; i < 14; i++) {
      const y = hy + ((h - hy) * (i + 1)) / 16;
      const len = w * (0.08 + r() * 0.25) * (1 - i / 20);
      streaks += `<rect x="${sx - len / 2}" y="${y}" width="${len}" height="${h * 0.004}" fill="#ffd9a0" opacity="${0.7 - i * 0.04}"/>`;
    }
    return `<defs>${grad('s', ['#2b1055', '#7b2f7f', '#d4418e', '#ff9a62'])}${grad('w', ['#5a2a6b', '#1d0f33'])}
      <radialGradient id="g"><stop offset="0" stop-color="#fff4d6"/><stop offset="0.4" stop-color="#ffd08a" stop-opacity="0.8"/><stop offset="1" stop-color="#ff9a62" stop-opacity="0"/></radialGradient></defs>
      <rect width="${w}" height="${hy}" fill="url(#s)"/>
      <circle cx="${sx}" cy="${hy}" r="${w * 0.45}" fill="url(#g)"/>
      <circle cx="${sx}" cy="${hy}" r="${w * 0.09}" fill="#fff1cf"/>
      <rect y="${hy}" width="${w}" height="${h - hy}" fill="url(#w)"/>${streaks}`;
  },
  mountains(r, w, h) {
    const colors = ['#9db0cc', '#7489a8', '#53668a', '#36435e'];
    const layers = colors
      .map((c, i) => `<polygon fill="${c}" points="${ridge(r, w, h, h * (0.45 + i * 0.13), h * 0.14, 7 + i * 2)}"/>`)
      .join('');
    return `<defs>${grad('s', ['#f9d9c4', '#c9d6ee', '#9fb6dd'].reverse())}${grad('m', ['#ffffff00', '#ffffff99'])}</defs>
      <rect width="${w}" height="${h}" fill="url(#s)"/>
      <circle cx="${w * (0.2 + r() * 0.6)}" cy="${h * 0.22}" r="${w * 0.07}" fill="#fff6e8" opacity="0.9"/>
      ${layers}<rect y="${h * 0.5}" width="${w}" height="${h * 0.2}" fill="url(#m)"/>`;
  },
  dunes(r, w, h) {
    const colors = ['#f0b67f', '#e39a5e', '#cc7c44', '#a85d2f'];
    const layers = colors.map((c, i) => `<path fill="${c}" d="${dune(r, w, h, h * (0.5 + i * 0.12), h * 0.12)}"/>`).join('');
    return `<defs>${grad('s', ['#7ec3e6', '#cfe7ef', '#fbe3c3'])}</defs>
      <rect width="${w}" height="${h}" fill="url(#s)"/>
      <circle cx="${w * (0.25 + r() * 0.5)}" cy="${h * 0.3}" r="${w * 0.06}" fill="#fffbe9"/>${layers}`;
  },
  forest(r, w, h) {
    let trees = '';
    const rows = [
      ['#6f9e8c', 0.55, 0.16],
      ['#4d7f6d', 0.68, 0.2],
      ['#2f5d4f', 0.82, 0.26],
    ];
    for (const [c, base, size] of rows) {
      for (let x = -w * 0.05; x < w * 1.05; x += w * (0.05 + r() * 0.06)) {
        const th = h * size * (0.7 + r() * 0.5);
        const tw = th * 0.42;
        const y = h * base + r() * h * 0.03;
        trees += `<polygon fill="${c}" points="${x - tw / 2},${y} ${x},${y - th} ${x + tw / 2},${y}"/>`;
      }
      trees += `<rect y="${h * base}" width="${w}" height="${h * (1 - base)}" fill="${c}"/>`;
    }
    return `<defs>${grad('s', ['#e7f1e8', '#bcd9cf', '#8fbfb0'])}</defs>
      <rect width="${w}" height="${h}" fill="url(#s)"/>
      <circle cx="${w * (0.3 + r() * 0.4)}" cy="${h * 0.25}" r="${w * 0.08}" fill="#fbf7ea" opacity="0.9"/>${trees}`;
  },
  night(r, w, h) {
    let stars = '';
    for (let i = 0; i < 60; i++) stars += `<circle cx="${r() * w}" cy="${r() * h * 0.5}" r="${0.6 + r() * 1.8}" fill="#fff" opacity="${0.3 + r() * 0.7}"/>`;
    let city = '';
    for (let x = 0; x < w; ) {
      const bw = w * (0.06 + r() * 0.08);
      const bh = h * (0.18 + r() * 0.3);
      const top = h - bh;
      city += `<rect x="${x}" y="${top}" width="${bw - 3}" height="${bh}" fill="#141b33"/>`;
      for (let wy = top + 14; wy < h - 10; wy += 22) {
        for (let wx = x + 8; wx < x + bw - 14; wx += 16) {
          if (r() < 0.38) city += `<rect x="${wx}" y="${wy}" width="7" height="10" fill="#ffd27a" opacity="${0.6 + r() * 0.4}"/>`;
        }
      }
      x += bw;
    }
    return `<defs>${grad('s', ['#0b1026', '#1c2b55', '#3c4f8a'])}</defs>
      <rect width="${w}" height="${h}" fill="url(#s)"/>${stars}
      <circle cx="${w * 0.75}" cy="${h * 0.18}" r="${w * 0.06}" fill="#f5f0dc"/>${city}`;
  },
  lake(r, w, h) {
    const hy = h * 0.55;
    const peaks = ridge(r, w, hy, hy * 0.85, hy * 0.35, 9);
    return `<defs>${grad('s', ['#ffe3c4', '#f7b9a8', '#b9a7d6'])}${grad('w', ['#a99ccc', '#5c5a8e'])}</defs>
      <rect width="${w}" height="${hy}" fill="url(#s)"/>
      <polygon fill="#6d6a9c" points="${peaks}"/>
      <rect y="${hy}" width="${w}" height="${h - hy}" fill="url(#w)"/>
      <g transform="translate(0 ${2 * hy}) scale(1 -1)" opacity="0.35"><polygon fill="#3f3d6e" points="${peaks}"/></g>
      <rect y="${hy}" width="${w}" height="${h * 0.006}" fill="#fff" opacity="0.5"/>`;
  },
  bloom(r, w, h) {
    const hues = [340, 20, 45, 300, 200];
    let flowers = '';
    for (let i = 0; i < 7; i++) {
      const cx = r() * w;
      const cy = h * 0.15 + r() * h * 0.75;
      const s = w * (0.08 + r() * 0.1);
      const hue = hues[Math.floor(r() * hues.length)];
      let petals = '';
      for (let k = 0; k < 6; k++) petals += `<ellipse cx="0" cy="${-s * 0.55}" rx="${s * 0.32}" ry="${s * 0.55}" transform="rotate(${k * 60})" fill="hsl(${hue} 75% ${70 + r() * 10}%)"/>`;
      flowers += `<g transform="translate(${cx} ${cy}) rotate(${r() * 60})">${petals}<circle r="${s * 0.22}" fill="hsl(45 90% 60%)"/></g>`;
    }
    return `<defs>${grad('s', ['#f4f7ee', '#dbe9d3'])}</defs><rect width="${w}" height="${h}" fill="url(#s)"/>${flowers}`;
  },
  coffee(r, w, h) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const s = Math.min(w, h);
    return `<defs>${grad('t', ['#c99a6b', '#a8784d'], false)}
      <radialGradient id="c"><stop offset="0" stop-color="#e9cfa9"/><stop offset="0.55" stop-color="#b9824f"/><stop offset="1" stop-color="#6e3f1e"/></radialGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#t)"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect y="${(h * i) / 9}" width="${w}" height="2" fill="#8a5f3a" opacity="0.25"/>`).join('')}
      <circle cx="${cx}" cy="${cy}" r="${s * 0.36}" fill="#f4efe6"/>
      <circle cx="${cx}" cy="${cy}" r="${s * 0.25}" fill="#fbf8f2"/>
      <circle cx="${cx}" cy="${cy}" r="${s * 0.2}" fill="url(#c)"/>
      <path transform="translate(${cx} ${cy + s * 0.05}) scale(${s / 900})" fill="#f6e8d2" d="M0 60 C-90 0 -70 -80 0 -40 C70 -80 90 0 0 60Z"/>
      <rect x="${cx + s * 0.3}" y="${cy - s * 0.04}" width="${s * 0.14}" height="${s * 0.08}" rx="${s * 0.04}" fill="#f4efe6"/>`;
  },
};

// The SVG for a picture name such as "mountains-12-1080x1350" or
// "avatar-L-210" (initial, hue).
export function picture(name) {
  const av = name.match(/^avatar-(\w)-(\d+)$/);
  if (av) {
    const [, letter, hue] = av;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150" width="150" height="150">
      <defs>${grad('a', [`hsl(${hue} 70% 62%)`, `hsl(${(+hue + 40) % 360} 65% 45%)`])}</defs>
      <rect width="150" height="150" fill="url(#a)"/>
      <text x="75" y="99" font-family="Georgia, serif" font-size="76" fill="#fff" text-anchor="middle">${letter.toUpperCase()}</text></svg>`;
  }
  const m = name.match(/^(\w+)-(\d+)-(\d+)x(\d+)$/);
  if (!m || !SCENES[m[1]]) return null;
  const [, scene, seed, w, h] = m;
  // A seeded colour shift, so the same scene twice looks like two photos.
  const hue = Math.round((rng(+seed * 7919)() - 0.5) * 80);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <filter id="tone"><feColorMatrix type="hueRotate" values="${hue}"/></filter>
    <g filter="url(#tone)">${SCENES[scene](rng(+seed), +w, +h)}</g></svg>`;
}

// ---- Accounts and content ---------------------------------------------------

const MEDIA = 'https://www.instagram.com/__media/';
const pic = (scene, seed, w, h) => `${MEDIA}${scene}-${seed}-${w}x${h}.svg`;
const avatar = (user, hue) => `${MEDIA}avatar-${user[0]}-${hue}.svg`;
const SCENE_NAMES = Object.keys(SCENES);
const sceneFor = (i) => SCENE_NAMES[i % SCENE_NAMES.length];

let nextId = 7100000000000000000n;
const newId = () => String(nextId++);

export function makeData(now = Math.floor(Date.now() / 1000)) {
  const people = [
    ['linnea.inkwell', 12], ['tidepool.atelier', 190], ['marco.moves.slow', 30], ['nori.and.rice', 350],
    ['fieldnote.fridays', 95], ['salt.and.cedar', 160], ['quiet.pages.club', 260], ['ana.on.35mm', 5],
    ['ridgeline.rae', 120], ['bakehouse.lou', 40], ['paper.moon.press', 230], ['the.slow.road', 75],
  ].map(([username, hue]) => ({ username, id: newId(), pic: avatar(username, hue) }));
  const byName = Object.fromEntries(people.map((p) => [p.username, p]));
  const favourites = [byName['ana.on.35mm'], byName['the.slow.road']];

  // Stories: who posted, how many, how long ago (hours), watched or not.
  const storyPlan = [
    ['tidepool.atelier', 3, 0.6], ['linnea.inkwell', 2, 1.4], ['nori.and.rice', 4, 2.2], ['ridgeline.rae', 2, 3.1],
    ['marco.moves.slow', 3, 4.5], ['salt.and.cedar', 1, 5.2], ['bakehouse.lou', 2, 6.8], ['fieldnote.fridays', 2, 8.3],
    ['quiet.pages.club', 1, 9.9, true], ['paper.moon.press', 3, 12.5, true],
    ['ana.on.35mm', 2, 1.1], ['the.slow.road', 1, 7.4],
  ];
  const songs = [['Low Tide', 'Harbour Lights'], ['Paper Kites', 'The Meadowlarks'], ['Slow Sunday', 'Ivo Marne']];
  const reels = {};
  let seed = 1;
  storyPlan.forEach(([name, n, hoursAgo, watched], i) => {
    const p = byName[name];
    const latest = now - Math.round(hoursAgo * 3600);
    const items = Array.from({ length: n }, (_, k) => {
      const scene = sceneFor(i + k * 3);
      const s = seed++;
      const item = {
        pk: newId(),
        taken_at: latest - (n - 1 - k) * 1500,
        media_type: 1,
        image_versions2: { candidates: [1080, 640, 480].map((w) => ({ width: w, height: Math.round((w * 16) / 9), url: pic(scene, s, w, Math.round((w * 16) / 9)) })) },
        original_width: 1080,
        original_height: 1920,
        has_liked: false,
        can_reply: true,
      };
      if (k === 0 && i % 4 === 1) item.story_music_stickers = [{ music_asset_info: { title: songs[i % 3][0], display_artist: songs[i % 3][1] } }];
      return item;
    });
    reels[p.id] = { id: p.id, user: { pk_id: p.id, username: p.username, profile_pic_url: p.pic }, items, seen: watched ? latest : 0, latest };
  });
  const tray = Object.values(reels).map((r) => ({
    id: r.id,
    user: r.user,
    latest_reel_media: r.latest,
    seen: r.seen,
  }));

  // Following's posts, newest first, from accounts that aren't favourites.
  const captions = [
    'First light over the bay this morning. Worth the 5am alarm.',
    'Proofing, folding, waiting. Sourdough is mostly patience.',
    'Back on the ridge trail after the rain. Everything smells green.',
    'New linocut prints are drying. Three colours, twelve passes.',
    'Small batch of onigiri for the road.',
    'Same view, every evening. Never the same light.',
  ];
  const postAuthors = ['tidepool.atelier', 'bakehouse.lou', 'ridgeline.rae', 'linnea.inkwell', 'nori.and.rice', 'salt.and.cedar'];
  const posts = postAuthors.map((name, i) => ({
    user: byName[name],
    code: `HFI${String(i).padStart(2, '0')}demoPost`.slice(0, 11),
    picture: pic(['sunset', 'coffee', 'mountains', 'bloom', 'forest', 'lake'][i], 100 + i, 1080, 1350),
    caption: captions[i],
    likes: [1284, 342, 2071, 816, 129, 4410][i],
    comments: [41, 12, 87, 23, 6, 152][i],
    hoursAgo: [0.4, 1.3, 2.8, 4.1, 6.5, 9][i],
  }));

  // Reels: 24 of them, in two pages of 12.
  const reelCaptions = [
    'Timelapse of the tide coming in', 'How we fold a country loaf', 'Ridge run at golden hour', 'Printing day in the studio',
    'Rice, salt, patience', 'Cedar smoke and sea air', 'A quiet reading corner', 'Developing film at home',
    'Fog rolling over the pass', 'Morning bake', 'Moonrise over the press', 'Back roads in autumn',
  ];
  const clips = Array.from({ length: 24 }, (_, i) => {
    const p = people[i % people.length];
    const scene = sceneFor(i * 5 + 2);
    const s = 200 + i;
    return {
      pk: newId(),
      code: `HFIreel${String(i).padStart(2, '0')}xx`.slice(0, 11),
      user: { username: p.username, profile_pic_url: p.pic },
      caption: { text: reelCaptions[i % reelCaptions.length] },
      like_count: [18400, 2310, 951, 40200, 7720, 615, 12900, 3380][i % 8] + i * 37,
      comment_count: [214, 38, 12, 903, 77, 9, 160, 41][i % 8],
      has_liked: i === 0,
      image_versions2: { candidates: [1080, 540].map((w) => ({ width: w, height: Math.round((w * 16) / 9), url: pic(scene, s, w, Math.round((w * 16) / 9)) })) },
      video_versions: [{ url: `${MEDIA}${scene}-${s}-540x960.webm` }],
      taken_at: now - i * 7200,
      video: { scene, seed: s },
    };
  });

  // Comments on the first reel.
  const commenters = ['ridgeline.rae', 'nori.and.rice', 'quiet.pages.club', 'marco.moves.slow', 'paper.moon.press', 'salt.and.cedar', 'bakehouse.lou'];
  const texts = [
    'The way the water catches the light at 0:04 🤍',
    'Where is this? Adding it to the list for spring.',
    'Calmest thing I have watched all week.',
    'Those colours! Film or digital?',
    'We were there last summer, the evenings are unreal.',
    '@linnea.inkwell this needs to be a print',
    'Sound on for this one 🌊',
  ];
  const comments = commenters.map((name, i) => ({
    pk: newId(),
    text: texts[i],
    user: { username: name, profile_pic_url: byName[name].pic },
    created_at: now - [600, 2400, 5400, 9000, 15000, 30000, 70000][i],
    comment_like_count: [48, 12, 31, 7, 3, 19, 0][i],
    has_liked_comment: i === 2,
    child_comment_count: [3, 1, 0, 2, 0, 0, 0][i],
  }));

  return { people, favourites, reels, tray, posts, clips, comments, me: { username: 'you', pic: avatar('you', 280) } };
}

// ---- Real public posts --------------------------------------------------------

// The same shape as makeData, from public posts saved in screenshots/real/
// (an export of a few public accounts' recent posts, reels and stories, and
// the media they point to: see README.md). Only the posters are real: the
// commenters and their comments are still made up, and stories are made from
// each account's own photos.
export function makeRealData(accounts, files, picks = null, now = Math.floor(Date.now() / 1000)) {
  // picks: { photos: [code], reels: [code] }, the ones fit to show (no
  // identifiable people or busy text), reels in grid order. Without it,
  // everything goes.
  const photoOk = (x) => !picks || picks.photos.includes(x.code);
  const reelRank = (x) => (picks ? picks.reels.indexOf(x.code) : 0);
  const local = (url) => (url && files[url] ? `${MEDIA}real/${files[url]}` : null);
  const webm = (url) => local(url) && local(url).replace(/\.mp4$/, '.webm');
  const list = Object.values(accounts).filter((a) => a.posts.length);
  const people = list.map((a) => ({ username: a.username, id: a.id, pic: local(a.pic), full_name: a.full_name }));
  const byName = Object.fromEntries(people.map((p) => [p.username, p]));
  const favourites = ['nasawebb', 'nasaartemis'].map((u) => byName[u]).filter(Boolean);
  const isFav = (u) => favourites.some((f) => f.username === u);
  const candidate = (x) => ({ width: x.w, height: x.h, url: local(x.image) });

  // Stories: each account's three most-liked photos, cropped to 9:16 (by
  // the renderer, from the "story-" names), as if posted in the last few
  // hours. Live stories aren't used: they're often reshares of other
  // people's posts. The order puts nasahubble third, where the screenshot
  // opens the viewer.
  const ORDER = ['nasaearth', 'nasagoddard', 'nasahubble', 'nasa', 'nasajpl', 'iss', 'nasakennedy', 'nasawebb', 'nasaartemis'];
  const rank = (u) => (ORDER.includes(u) ? ORDER.indexOf(u) : ORDER.length);
  const reels = {};
  [...list].sort((m, n) => rank(m.username) - rank(n.username)).forEach((a, i) => {
    const p = byName[a.username];
    const latest = now - Math.round((0.4 + i * 1.1) * 3600);
    const photos = a.posts.filter((x) => local(x.image) && !x.video && photoOk(x)).sort((m, n) => (n.likes || 0) - (m.likes || 0)).slice(0, 3);
    const items = photos.map((x, k) => {
      const w = Math.min(x.w, Math.round((x.h * 9) / 16));
      const h = Math.min(x.h, Math.round((x.w * 16) / 9));
      return {
        pk: newId(), taken_at: latest - (photos.length - 1 - k) * 1800, media_type: 1,
        image_versions2: { candidates: [{ width: w, height: h, url: `${MEDIA}real/story-${files[x.image]}` }] },
        original_width: w, original_height: h, can_reply: true,
      };
    });
    if (!items.length) return;
    const watched = i >= list.length - 2 && !isFav(a.username);
    reels[p.id] = { id: p.id, user: { pk_id: p.id, username: p.username, profile_pic_url: p.pic }, items, seen: watched ? latest : 0, latest };
  });
  const tray = Object.values(reels).map((r) => ({ id: r.id, user: r.user, latest_reel_media: r.latest, seen: r.seen }));

  // Following's posts: photos from accounts that aren't favourites, newest first.
  const posts = list
    .filter((a) => !isFav(a.username))
    .flatMap((a) => a.posts.filter((x) => local(x.image) && !x.video && photoOk(x)).map((x) => ({ a, x })))
    .sort((m, n) => n.x.taken_at - m.x.taken_at)
    .slice(0, 12)
    .map(({ a, x }) => ({
      user: byName[a.username],
      code: x.code,
      picture: local(x.image),
      ratio: Math.min(1.91, Math.max(0.8, x.w / x.h)),
      caption: x.caption.split('\n')[0],
      likes: x.likes || 0,
      comments: x.comments || 0,
      hoursAgo: Math.max(0.1, (now - x.taken_at) / 3600),
    }));

  // Reels: every video post, newest first.
  const clips = list
    .flatMap((a) => a.posts.filter((x) => x.video && files[x.video] && local(x.image) && reelRank(x) >= 0).map((x) => ({ a, x })))
    .sort((m, n) => reelRank(m.x) - reelRank(n.x) || n.x.taken_at - m.x.taken_at)
    .map(({ a, x }, i) => ({
      pk: newId(),
      code: x.code,
      user: { username: a.username, profile_pic_url: byName[a.username].pic },
      caption: { text: x.caption.split('\n')[0] },
      like_count: x.likes || 0,
      comment_count: x.comments || 0,
      has_liked: i === 0,
      image_versions2: { candidates: [candidate(x)] },
      video_versions: [{ url: webm(x.video) }],
      taken_at: x.taken_at,
    }));

  // Made-up commenters and comments on the first reel.
  const commenters = [
    ['orbit.and.oats', 200], ['mira.looks.up', 20], ['quiet.pages.club', 260], ['marco.moves.slow', 30],
    ['paper.moon.press', 230], ['salt.and.cedar', 160], ['ana.on.35mm', 5],
  ];
  const texts = [
    'Watched this three times in a row 🚀',
    'Where could I see this from the ground?',
    'Calmest thing I have watched all week.',
    'The colours! Is that processed or how it really looks?',
    'Showing this to my kids tonight.',
    '@mira.looks.up we have to go to the next launch',
    'Sound on for this one 🔊',
  ];
  const comments = commenters.map(([name, hue], i) => ({
    pk: newId(),
    text: texts[i],
    user: { username: name, profile_pic_url: avatar(name, hue) },
    created_at: now - [600, 2400, 5400, 9000, 15000, 30000, 70000][i],
    comment_like_count: [48, 12, 31, 7, 3, 19, 0][i],
    has_liked_comment: i === 2,
    child_comment_count: [3, 1, 0, 2, 0, 0, 0][i],
  }));

  return { people, favourites, reels, tray, posts, clips, comments, me: { username: 'you', pic: avatar('you', 280) } };
}
