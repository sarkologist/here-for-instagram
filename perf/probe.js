// In-page recorder for the perf harness: frame times, each frame's
// main-thread rendering work, and how long input takes to show on screen.
(() => {
  const perf = {
    recording: false,
    frames: [],
    work: [],
    inputs: [],
    start() {
      this.frames = [];
      this.work = [];
      this.inputs = [];
      this.did = { turns: 0, peeks: 0, scrolls: 0 };
      this.fns = {};
      this.was = { user: null, hand: null, scrolling: false };
      this.recording = true;
      performance.mark('perf-start'); // for gaps.mjs
    },
    stop() {
      this.recording = false;
      performance.mark('perf-stop');
      return { frames: this.frames, work: this.work, inputs: this.inputs, did: this.did, fns: this.fns };
    },
    // For run.mjs --profile: a function's inclusive time.
    time(name, fn, self, args) {
      const t0 = performance.now();
      try {
        return fn.apply(self, args);
      } finally {
        if (this.recording) {
          const ms = performance.now() - t0;
          const t = (this.fns[name] = this.fns[name] || { total: 0, n: 0, max: 0, calls: [] });
          if (t.calls.length < 12) t.calls.push([Math.round(t0), Math.round(ms * 10) / 10]);
          t.total += ms;
          t.n++;
          t.max = Math.max(t.max, ms);
        }
      }
    },
    // Resolves after the next frame has been painted (roughly: a task queued
    // from the frame's rAF runs once it has been presented to the compositor).
    painted() {
      return new Promise((resolve) => requestAnimationFrame(() => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => resolve(performance.now());
        ch.port2.postMessage(0);
      }));
    },
  };

  // A frame's main-thread work after the rAF callbacks (style, layout,
  // building what to paint): from this rAF callback to the next task.
  const work = new MessageChannel();
  const pending = [];
  work.port1.onmessage = () => {
    const [k, start] = pending.shift();
    if (perf.recording) perf.work[k] = performance.now() - start;
  };

  // Also counts what the scenario got the viewer to do, as a sanity check:
  // accounts put on stage, peeks, scrolls.
  const loop = (t) => {
    requestAnimationFrame(loop);
    if (!perf.recording) return;
    perf.frames.push(t);
    pending.push([perf.frames.length - 1, performance.now()]);
    work.port2.postMessage(0);
    const root = document.getElementById('sinsta-viewer');
    if (!root) return;
    const user = root.querySelector('.sv-user').textContent;
    const hand = root.querySelector('.sv-peek-open-r, .sv-peek-open-l');
    const scrolling = root.classList.contains('sv-scrolling');
    if (perf.was.user != null && user !== perf.was.user) perf.did.turns++;
    if (hand && hand !== perf.was.hand) perf.did.peeks++;
    if (scrolling && !perf.was.scrolling) perf.did.scrolls++;
    perf.was = { user, hand, scrolling };
  };
  requestAnimationFrame(loop);

  window.addEventListener('resize', () => {
    if (perf.recording) perf.did.resizes = `${perf.did.resizes || ''} ${Math.round(performance.now())}:${innerWidth}x${innerHeight}`;
  });

  // Input latency: from the event's timestamp to the end of the frame that
  // shows its effect. Registered first and capturing, so it runs before the
  // viewer's own handlers; the frame it waits for comes after them.
  for (const type of ['keydown', 'click', 'pointerover', 'wheel']) {
    window.addEventListener(type, (e) => {
      if (!perf.recording) return;
      const t0 = e.timeStamp;
      const target = e.target && e.target.closest ? e.target.closest('.sv-peek, .sv-stage') : null;
      // A pointerover counts only when it enters another card (a peek starts).
      if (type === 'pointerover' && (!target || !target.classList.contains('sv-peek') || target === perf.lastOver)) return;
      if (type === 'pointerover') perf.lastOver = target;
      perf.painted().then((t1) => perf.inputs.push({ type, ms: t1 - t0 }));
    }, { capture: true, passive: true });
  }
  window.__perf = perf;
})();
