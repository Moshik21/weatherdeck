/* The static demo's feed: answers the page's poll from recorded frames (demo-feed.js), never from a host.
   Frames are shown unchanged and in recorded order, on a gentle timer, looping; nothing is made up at runtime.
   The label in index.html is markup, not feed text: this script only fills in which frame is showing. */
(function () {
  const HOLD_S = 25;
  const feed = window.WEATHERDECK_DEMO_FEED;
  const frames = feed && Array.isArray(feed.frames) ? feed.frames.filter(f => f && f.view && f.server && typeof f.served_at === "number") : [];
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let idx = -1, shownAt = 0;
  const el = id => document.getElementById(id);
  function note() {
    const n = el("demo-note"), b = el("demo-next");
    if (!n) return;
    n.textContent = !frames.length
      ? "The recorded feed file is missing, so there is nothing to show. Nothing here is live."
      : "Invented sources, replayed from a recording; nothing here is live. Frame " + (idx + 1) + " of " + frames.length +
        (still.matches ? ", held (reduced motion)." : ", then it starts over.");
    if (b) b.hidden = !frames.length || !still.matches;
  }
  let dirty = false;
  function step() { idx = (idx + 1) % frames.length; shownAt = performance.now(); dirty = true; note(); }
  window.weatherdeckDemo = {
    files: window.WEATHERDECK_DEMO_FILES || {},
    /* null: no recording to show. Else the frame on screen, and whether it is a different one than last time. */
    poll() {
      if (!frames.length) { note(); return null; }
      if (idx < 0 || (!still.matches && performance.now() - shownAt >= HOLD_S * 1000)) step();
      const changed = dirty;
      dirty = false;
      return { frame: frames[idx], changed };
    },
    band() { const l = el("demo-label"); return l ? l.getBoundingClientRect().height : 0; },
    next() { if (frames.length) { step(); window.dispatchEvent(new Event("weatherdeck-demo-step")); } },
  };
  addEventListener("DOMContentLoaded", () => {
    const b = el("demo-next");
    if (b) b.addEventListener("click", () => { window.weatherdeckDemo.next(); });
    note();
  });
  still.addEventListener("change", note);
})();
