/* Fleet command, concept A: boot, scale, scenario routing, dev switcher, burn-in drift.
   Scenario by URL hash: #normal #all-clear #trouble #night #one-source-silent #lost #host-down
   #empty #loading. Add ",dev" (for example #trouble,dev) or press the ` key for the switcher;
   add ",still" to stop all motion.
   The page makes no network request: the fixture arrives as fixture.js next to it. */
"use strict";

(() => {
  const FX = window.WEATHERDECK_FIXTURE;
  const SCENARIOS = FX.scenarios.map(s => s.id).concat(["loading"]).filter((x, i, a) => a.indexOf(x) === i);
  const root = document.documentElement;
  const stage = document.getElementById("stage");
  const dev = document.getElementById("dev");
  let current = null;

  function parseHash() {
    const t = decodeURIComponent(location.hash.slice(1)).split(/[,&+]/).filter(Boolean);
    return { scenario: t.find(x => SCENARIOS.includes(x)) || "normal", dev: t.includes("dev"), still: t.includes("still") };
  }

  // One integer pixel grid: an art pixel is a whole number of device pixels.
  // TV: the 640 x 360 art-pixel canvas scaled by the largest integer that fits (6 on 4K, 3 on 1080p).
  // Phone: 6 device pixels per art pixel at DPR 3 (2 CSS px), never smoothed.
  function scale() {
    const W = innerWidth, H = innerHeight, dpr = devicePixelRatio || 1;
    const layout = W < 900 || W / H < 1.25 ? "phone" : "tv";
    let apDev;
    if (layout === "tv") apDev = Math.max(1, Math.floor(Math.min(W * dpr / 640, H * dpr / 360)));
    else apDev = Math.max(2, Math.round(2 * dpr));
    const ap = apDev / dpr;
    root.dataset.layout = layout;
    root.style.setProperty("--ap", ap + "px");
    // Pixel-font sizes for the phone: whole device pixels per font pixel (4 and 5 at DPR 3).
    root.style.setProperty("--fp", Math.max(1, Math.round(1.34 * dpr)) / dpr + "px");
    root.style.setProperty("--fp2", Math.max(1, Math.round(1.67 * dpr)) / dpr + "px");
    if (layout === "tv") {
      // centre on whole device pixels, so nothing lands between pixels
      const left = Math.floor((W * dpr - 640 * apDev) / 2) / dpr, top = Math.floor((H * dpr - 360 * apDev) / 2) / dpr;
      stage.style.left = Math.max(0, left) + "px";
      stage.style.top = Math.max(0, top) + "px";
    } else { stage.style.left = ""; stage.style.top = ""; }
    return { layout, ap, apDev };
  }

  function setFrames() {
    for (const k of ["steel", "well", "gold", "tile", "top", "crit", "socket", "calm", "fog"]) {
      const f = Sprites.frameURL(k);
      root.style.setProperty("--fr-" + k, `url("${f.url}")`);
    }
    root.style.setProperty("--tex-ground", `url("${Sprites.groundTile()}")`);
  }

  function render() {
    const { scenario, still } = parseHash();
    const sc = scale();
    const v = Model.build(FX, scenario);
    root.dataset.theme = v.theme;
    // Motion: full by day, calm in quiet hours (no idle loops), still when the OS asks for reduced
    // motion or the kiosk URL says ",still" (WCAG 2.2.2: every loop can be stopped).
    root.dataset.motion = still || reduced.matches ? "still" : v.theme === "night" ? "calm" : "full";
    Sprites.readPalette();
    setFrames();
    // The minimap is drawn at its panel's exact width in art pixels; measure, then redraw once.
    let artW = sc.layout === "tv" ? 316 : Math.max(120, Math.floor((innerWidth - 32) / sc.ap) - 12);
    let board = Render.board(v, sc.layout, artW);
    stage.replaceChildren(board);
    const wrap = board.querySelector(".map-wrap");
    if (wrap) {
      const real = Math.floor(wrap.clientWidth / sc.ap);
      if (real > 0 && real !== artW) { artW = real; board = Render.board(v, sc.layout, artW); stage.replaceChildren(board); }
    }
    stage.setAttribute("aria-busy", v.mode === "loading" ? "true" : "false");
    document.title = v.orders.length ? `(${v.orders.length}) Fleet Command` : "Fleet Command";
    current = scenario;
    buildDev(scenario);
  }

  function buildDev(active) {
    const { dev: show } = parseHash();
    dev.hidden = !show && !dev.dataset.open;
    dev.replaceChildren(...SCENARIOS.map(id => {
      const a = document.createElement("a");
      a.href = "#" + id + ",dev";
      a.textContent = id;
      if (id === active) a.setAttribute("aria-current", "page");
      return a;
    }));
  }

  // Burn-in: drift the whole board one art pixel every 4 minutes around a 3 x 2 box.
  const DRIFT = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
  let driftStep = 0;
  setInterval(() => {
    driftStep = (driftStep + 1) % DRIFT.length;
    root.style.setProperty("--dx", DRIFT[driftStep][0]);
    root.style.setProperty("--dy", DRIFT[driftStep][1]);
  }, 240000);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  reduced.addEventListener("change", render);
  addEventListener("hashchange", render);
  let rt = null;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  addEventListener("keydown", e => {
    if (e.key === "`") { dev.dataset.open = dev.dataset.open ? "" : "1"; buildDev(current); }
  });
  // Render only once the three self-hosted faces are in, so the board never flashes a fallback.
  const faces = ['11px "Departure Mono"', '27px "Jersey 15"', '400 12px "Atkinson Next"', '600 12px "Atkinson Next"'];
  (document.fonts ? Promise.all(faces.map(f => document.fonts.load(f))).catch(() => null) : Promise.resolve()).then(render);
})();
