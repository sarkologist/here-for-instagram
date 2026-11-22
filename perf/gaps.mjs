// Reads a profile from `run.mjs --gecko-profile p.json` and shows the longest
// gaps between the page's refresh ticks, with what each thread was busy with
// meanwhile: markers over 1 ms, and the content main thread's hottest frames.
//
//   node gaps.mjs p.json [count]

import { readFileSync } from 'node:fs';

const [file, count = '8'] = process.argv.slice(2);
const profile = JSON.parse(readFileSync(file, 'utf8'));

// All threads of all processes, with their process start offset applied.
const threads = [];
(function collect(p) {
  const shift = (p.meta.startTime || 0) - (profile.meta.startTime || 0);
  for (const t of p.threads) threads.push({ ...t, shift });
  for (const c of p.processes || []) collect(c);
})(profile);

const str = (t, i) => (t.stringTable || t.stringArray)[i];
const markersOf = (t) => {
  const s = t.markers.schema;
  return t.markers.data.filter((m) => m[s.phase] == null || m[s.phase] === 1 || m[s.phase] === 0).map((m) => ({
    phase: m[s.phase],
    name: str(t, m[s.name]),
    start: (m[s.startTime] ?? 0) + t.shift,
    end: (m[s.endTime] ?? m[s.startTime] ?? 0) + t.shift,
    data: m[s.data],
  }));
};

// The page's main thread: the content process main thread with the most
// refresh ticks.
const mains = threads.filter((t) => t.name === 'GeckoMain' && t.processType !== 'default');
let page = null;
let ticks = [];
for (const t of mains) {
  const ms = markersOf(t).filter((m) => m.name === 'RefreshDriverTick');
  if (ms.length > ticks.length) {
    page = t;
    ticks = ms;
  }
}
if (!page) throw new Error('no content main thread with refresh ticks');
ticks.sort((a, b) => a.start - b.start);
// Only while run.mjs records (probe.js marks it).
const marks = markersOf(page).filter((m) => m.name === 'UserTiming' && m.data && /^perf-(start|stop)$/.test(m.data.name))
  .sort((a, b) => a.start - b.start);
const spans = [];
for (const m of marks) {
  if (m.data.name === 'perf-start') spans.push([m.start, Infinity]);
  else if (spans.length) spans[spans.length - 1][1] = m.start;
}
const recorded = (x) => !spans.length || spans.some(([a, b]) => x >= a && x <= b);
const RENDER = /^(GeckoMain|Compositor|Renderer|RenderBackend|SceneBuilder|WRWorker|ImgDecoder|ImageIO|Canvas)/;
const SKIP = /^(Awake|RefreshDriverTick|TimerThread::Wait|UserTiming|Runnable|IPC|PostTimerEvent|AddRemoveTimer)/;
const gaps = ticks.slice(1).map((m, i) => ({ from: ticks[i].start, to: m.start, ms: m.start - ticks[i].start }))
  .filter((g) => recorded(g.from) && g.ms < 300)
  .sort((a, b) => b.ms - a.ms)
  .slice(0, Number(count));

// The leaf-most named JS or label frame of a sample's stack.
function hottest(t, from, to, leaf = false) {
  const s = t.samples.schema;
  const counts = new Map();
  for (const row of t.samples.data) {
    const time = row[s.time] + t.shift;
    if (time < from || time > to) continue;
    let stack = row[s.stack];
    const names = [];
    while (stack != null && names.length < 40) {
      const st = t.stackTable.data[stack];
      const frame = t.frameTable.data[st[t.stackTable.schema.frame]];
      names.push(str(t, frame[t.frameTable.schema.location]));
      stack = st[t.stackTable.schema.prefix];
    }
    const pick = leaf ? names.slice(0, 3).join(' < ') : names.find((n) => /stories\.js|probe\.js/.test(n))
      || names.find((n) => !/^0x|^\(root\)|libsystem|libdyld/.test(n)) || names[0] || '?';
    const key = pick.replace(/ \(https?:\/\/[^)]*\)/, '').slice(0, 90);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
}

const t0 = spans.length ? spans[0][0] : ticks[0].start;
console.log(`${spans.length} recordings, ${ticks.length} ticks; gaps below are ms from the first recording's start`);
for (const g of gaps) {
  console.log(`\n== ${g.ms.toFixed(1)} ms gap at ${(g.from - t0).toFixed(0)} ms`);
  for (const t of threads) {
    if (!RENDER.test(t.name) || (t.name === 'GeckoMain' && t !== page && t.processType !== 'gpu')) continue;
    const busy = markersOf(t)
      .filter((m) => m.phase === 1 && m.end > g.from && m.start < g.to && m.end - m.start >= 1 && m.end - m.start < 300 && !SKIP.test(m.name))
      .map((m) => `${m.name}${m.data && m.data.category ? `:${m.data.category}` : ''}${m.data && m.data.type && m.data.type !== m.name ? `(${m.data.type})` : ''} ${(m.end - m.start).toFixed(1)}`);
    if (busy.length) console.log(`  ${t.name}[${t.processType}]: ${[...new Set(busy)].slice(0, 12).join(', ')}`);
  }
  console.log(`  page samples: ${hottest(page, g.from, g.to).map(([n, c]) => `${n} ×${c}`).join(', ')}`);
  for (const t of threads.filter((x) => /^(Compositor|Renderer|WR|SW)/.test(x.name) && x.samples.data.length)) {
    console.log(`  ${t.name} samples: ${hottest(t, g.from, g.to, true).map(([n, c]) => `${n} ×${c}`).join(', ')}`);
  }
}
