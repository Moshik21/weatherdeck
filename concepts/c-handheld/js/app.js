/* Handheld LCD: boot, scenario hash, art-pixel snapping, motion and the dev switcher.
   Hash: #<scenario>[+grey|+green][+door|+nodoor][+still][+dev][+phone|+tv]
   e.g. #trouble, #night+green, #one-source-silent+dev */
(function () {
  "use strict";
  const HH = window.HH;
  const root = document.documentElement;
  const screen = document.getElementById("screen");
  const live = document.getElementById("live");
  let FX = null;
  let lastKey = "";
  let opts = {};

  function parseHash() {
    const parts = decodeURIComponent(location.hash.replace(/^#/, "")).split("+").filter(Boolean);
    const o = { scenario: "normal", tint: null, door: true, still: false, dev: false, layout: null };
    parts.forEach((p) => {
      if (p === "grey" || p === "green") o.tint = p;
      else if (p === "nodoor") o.door = false;
      else if (p === "door") o.door = true;
      else if (p === "still") o.still = true;
      else if (p === "dev") o.dev = true;
      else if (p === "phone" || p === "tv") o.layout = p;
      else o.scenario = p;
    });
    return o;
  }

  function writeHash(o) {
    const bits = [o.scenario];
    if (o.tint) bits.push(o.tint);
    if (!o.door) bits.push("nodoor");
    if (o.still) bits.push("still");
    if (o.dev) bits.push("dev");
    if (o.layout) bits.push(o.layout);
    history.replaceState(null, "", "#" + bits.join("+"));
  }

  /* One art pixel = 6 device pixels on a 4K TV. Snap so ap x devicePixelRatio is whole. */
  function sizeScreen() {
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    const phone = opts.layout ? opts.layout === "phone" : W < 760;
    root.classList.toggle("is-phone", phone);
    root.classList.toggle("is-tv", !phone);
    let ap, fp;
    if (phone) {
      ap = Math.max(1, Math.round(2 * dpr)) / dpr;
      fp = Math.max(1, Math.round((5 / 3) * dpr)) / dpr;
    } else {
      const dev = Math.max(1, Math.floor(Math.min((W * dpr) / 640, (H * dpr) / 360)));
      ap = dev / dpr;
      fp = ap;
    }
    root.style.setProperty("--ap", ap + "px");
    root.style.setProperty("--fp", fp + "px");
    root.style.setProperty("--hair", 1 / dpr + "px");
    if (!phone) {
      const dev = ap * dpr;
      root.style.setProperty("--ox", Math.floor((W * dpr - 640 * dev) / 2) / dpr + "px");
      root.style.setProperty("--oy", Math.floor((H * dpr - 360 * dev) / 2) / dpr + "px");
    }
    return phone;
  }

  function reducedMotion() {
    return opts.still || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function applyTheme(v) {
    const night = !!(v && v.night);
    const tint = opts.tint || (night ? "grey" : "green");
    root.dataset.lcd = (night ? "night-" : "day-") + tint;
    root.classList.toggle("is-night", night);
    root.classList.toggle("no-door", !opts.door || night);
    root.classList.toggle("is-still", reducedMotion());
    root.classList.toggle("has-crit", !!(v && v.critical && v.critical.length));
    root.classList.toggle("is-lost", !!(v && v.allLost));
    const ground = getComputedStyle(root).getPropertyValue("--s0").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && ground) meta.setAttribute("content", ground);
  }

  /* Like a reflective LCD, a change leaves a short ghost of what was there (about 120 ms). */
  function ghost(oldBoard) {
    if (!oldBoard || reducedMotion()) return;
    const g = oldBoard.cloneNode(true);
    g.classList.add("ghost");
    g.setAttribute("aria-hidden", "true");
    screen.appendChild(g);
    setTimeout(() => g.remove(), 220);
  }

  let caretTimer = null;
  function announce(board, v, isNew) {
    clearTimeout(caretTimer);
    const plate = board.querySelector(".plate");
    if (!plate || reducedMotion()) {
      board.classList.add("is-rested");
      return;
    }
    if (isNew && v && v.callCount > 0) {
      // the dialog opens in four stepped frames, then the caret blinks for three seconds
      plate.classList.add("is-opening");
      if (v.critical && v.critical.length) root.classList.add("is-alarm");
    }
    caretTimer = setTimeout(() => {
      board.classList.add("is-rested");
      root.classList.remove("is-alarm");
    }, 3000);
  }

  /* Burn-in: drift the whole board one art pixel every 4 minutes inside a 3 x 2 box. */
  function drift(v) {
    const step = Math.floor((v && v.now ? v.now : 0) / 240000);
    const path = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]];
    const [x, y] = path[step % path.length];
    root.style.setProperty("--dx", x);
    root.style.setProperty("--dy", y);
  }

  function render() {
    opts = parseHash();
    const phone = sizeScreen();
    const v = HH.model.build(FX, opts.scenario);
    applyTheme(v);
    drift(v);
    const key = v.id + "|" + (phone ? "p" : "t");
    const isNew = key !== lastKey;
    const old = screen.querySelector(".board:not(.ghost)");
    const board = phone ? HH.render.phone(v) : HH.render.tv(v);
    if (old && isNew) ghost(old);
    if (old) old.remove();
    screen.appendChild(board);
    HH.render.fit(board);
    if (isNew) {
      board.classList.add("is-new");
      announce(board, v, true);
      live.textContent = summary(v);
    } else {
      board.classList.add("is-rested");
    }
    lastKey = key;
    document.title = (v.callCount ? "(" + v.callCount + ") " : "") + "Fleet LCD";
    syncDev();
  }

  function summary(v) {
    if (v.loading) return "Reading the fleet.";
    if (v.empty) return "No machine has reported yet.";
    const bits = [];
    bits.push(v.callCount ? v.callCount + " waiting on you. First: " + v.top.title : "Nothing waits on you.");
    if (v.off && v.off.length) bits.push(v.off.length + " lanes off course.");
    if (v.allLost) bits.push("No signal; everything is last known.");
    return bits.join(" ");
  }

  /* ---------- dev switcher, hidden until D is pressed or the hash says +dev ---------- */
  const dev = document.getElementById("dev");
  function buildDev() {
    const sel = document.getElementById("dev-scenario");
    HH.model.scenarioList(FX).forEach((s) => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.id + (s.derived ? " (derived)" : "");
      o.title = s.what;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => { opts.scenario = sel.value; writeHash(opts); render(); });
    document.getElementById("dev-tint").addEventListener("change", (e) => { opts.tint = e.target.value || null; writeHash(opts); render(); });
    document.getElementById("dev-door").addEventListener("change", (e) => { opts.door = e.target.checked; writeHash(opts); render(); });
    document.getElementById("dev-still").addEventListener("change", (e) => { opts.still = e.target.checked; writeHash(opts); render(); });
    document.getElementById("dev-close").addEventListener("click", () => { opts.dev = false; writeHash(opts); syncDev(); });
  }
  function syncDev() {
    dev.hidden = !opts.dev;
    const sel = document.getElementById("dev-scenario");
    sel.value = opts.scenario;
    const s = HH.model.scenarioList(FX).find((x) => x.id === opts.scenario);
    document.getElementById("dev-what").textContent = s ? s.what : "";
    document.getElementById("dev-tint").value = opts.tint || "";
    document.getElementById("dev-door").checked = opts.door;
    document.getElementById("dev-still").checked = opts.still;
  }
  document.addEventListener("keydown", (e) => {
    if (e.target && /^(SELECT|INPUT)$/.test(e.target.tagName)) return;
    if (e.key === "d" || e.key === "D") { opts.dev = !opts.dev; writeHash(opts); syncDev(); }
  });

  function boot(fx) {
    FX = fx;
    buildDev();
    render();
    window.addEventListener("hashchange", render);
    let rz = null;
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 120); });
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", render);
  }

  function fail(msg) {
    screen.textContent = "";
    const p = document.createElement("p");
    p.className = "bootfail";
    p.textContent = msg;
    screen.appendChild(p);
  }

  // fixture.js carries the same JSON for file:// opening; over http, fixture.json is read.
  const fonts = document.fonts
    ? Promise.all(['11px "Departure Mono"', '27px "Jersey 15"', '600 12px "Atkinson Hyperlegible Next"'].map((f) => document.fonts.load(f))).catch(() => null)
    : Promise.resolve();
  const data = window.HH_FIXTURE
    ? Promise.resolve(window.HH_FIXTURE)
    : fetch("fixture.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  Promise.all([data, fonts]).then(([fx]) => boot(fx)).catch((e) => {
    fail("The fixture did not load (" + e.message + "). Serve this folder over http, or keep fixture.js next to index.html.");
  });
})();
