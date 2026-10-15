/* Handheld LCD: state glyphs and the lookout bird.
   Every sprite is original pixel art drawn for this concept and offered as CC0 (see CREDITS.md).
   Legend: "#" ink (currentColor), "+" shade 2, ":" shade 1, "o" paper, "." transparent.
   Sprites become inline SVG with one rect per horizontal run and crispEdges, so they scale
   by whole art pixels and take their colours from the four LCD shade tokens. */
(function () {
  "use strict";

  const G = {
    // a call only the viewer can make: "!" knocked out of a diamond
    call: [
      ".....##.....",
      "....####....",
      "...##..##...",
      "..###..###..",
      ".####..####.",
      "#####..#####",
      "#####..#####",
      ".##########.",
      "..###..###..",
      "...######...",
      "....####....",
      ".....##.....",
    ],
    // finished, waiting for the viewer's merge
    approve: [
      "...######...",
      "..########..",
      ".###....###.",
      ".###....###.",
      "........###.",
      "......####..",
      ".....###....",
      ".....###....",
      "............",
      ".....###....",
      ".....###....",
      "............",
    ],
    // critical trouble: a rotating beacon
    critical: [
      ".#...##...#.",
      "..#.####.#..",
      "...######...",
      "#.##o##o##.#",
      "..##o##o##..",
      "..########..",
      "..##o##o##..",
      "..########..",
      ".##########.",
      "############",
      "############",
      "............",
    ],
    moving: [
      "..#.........",
      "..##........",
      "..###.......",
      "..####......",
      "..#####.....",
      "..######....",
      "..######....",
      "..#####.....",
      "..####......",
      "..###.......",
      "..##........",
      "..#.........",
    ],
    done: [
      "............",
      "...........#",
      "..........##",
      ".........###",
      "#.......###.",
      "##.....###..",
      "###...###...",
      ".###.###....",
      "..#####.....",
      "...###......",
      "....#.......",
      "............",
    ],
    failed: [
      "##........##",
      "###......###",
      ".###....###.",
      "..###..###..",
      "...######...",
      "....####....",
      "....####....",
      "...######...",
      "..###..###..",
      ".###....###.",
      "###......###",
      "##........##",
    ],
    // waits on other work: a brick wall
    blocked: [
      "............",
      "###.#####.##",
      "###.#####.##",
      "............",
      "#####.#####.",
      "#####.#####.",
      "............",
      "###.#####.##",
      "###.#####.##",
      "............",
      "#####.#####.",
      "#####.#####.",
    ],
    // a question its own supervisor answers: hourglass
    mate: [
      "############",
      ".##......##.",
      "..##....##..",
      "...##..##...",
      "....####....",
      ".....##.....",
      ".....##.....",
      "....#..#....",
      "...#.##.#...",
      "..#.####.#..",
      ".##########.",
      "############",
    ],
    // investigating, no honest percent: spyglass
    scout: [
      "............",
      "............",
      "..........##",
      ".......#####",
      "###.########",
      "###.########",
      "###.########",
      ".......#####",
      "..........##",
      "............",
      "............",
      "............",
    ],
    // no word from the lane: dotted diamond
    unknown: [
      ".....#......",
      "......#.....",
      "...#....#...",
      "..#......#..",
      ".#........#.",
      "#..........#",
      ".#........#.",
      "..#......#..",
      "...#....#...",
      "....#..#....",
      ".....#......",
      "............",
    ],
    // running past its p90: a snail
    long: [
      "............",
      "..####....#.",
      ".#....#..#..",
      "#..##..#.#..",
      "#.#..#.#.##.",
      "#.#.##.#.###",
      "#..#...#.##.",
      ".#....#..##.",
      "..####...##.",
      "############",
      ".##########.",
      "............",
    ],
    // no output for a while: an empty speech bubble
    quiet: [
      "............",
      ".##########.",
      "#..........#",
      "#..........#",
      "#.##.##.##.#",
      "#..........#",
      "#..........#",
      ".####.#####.",
      "....#.#.....",
      "....##......",
      "............",
      "............",
    ],
    // went back a round: a looping arrow
    regressed: [
      "...#####....",
      "..#.....#...",
      ".#.......#..",
      "#.........#.",
      "#.........#.",
      "#........###",
      "#.........#.",
      ".#..........",
      "..#.....#...",
      "...#####....",
      "............",
      "............",
    ],
    landed: [
      "..########..",
      "############",
      "#.########.#",
      "#.########.#",
      ".#.######.#.",
      "..########..",
      "....####....",
      ".....##.....",
      ".....##.....",
      "...######...",
      "..########..",
      "............",
    ],
  };

  // the dialog's "more to read" marker, 12 x 12 with the art at the bottom
  G.cont = [
    "............", "............", "............", "............", "............",
    "..########..", "...######...", "....####....", ".....##.....", "............", "............", "............",
  ];

  // Machine pips, 8 x 8: shape carries the state.
  const M = {
    ok: [
      "########",
      "########",
      "########",
      "########",
      "########",
      "########",
      "########",
      "########",
    ],
    warn: [
      "...##...",
      "...##...",
      "..####..",
      "..#..#..",
      ".##..##.",
      ".######.",
      "###..###",
      "########",
    ],
    down: [
      "##....##",
      "###..###",
      ".######.",
      "..####..",
      "..####..",
      ".######.",
      "###..###",
      "##....##",
    ],
    silent: [
      "#.#.#.#.",
      "........",
      "#......#",
      "........",
      "#......#",
      "........",
      "#......#",
      ".#.#.#.#",
    ],
    unknown: [
      "#.#.#.#.",
      "........",
      "#......#",
      "........",
      "#......#",
      "........",
      "#......#",
      ".#.#.#.#",
    ],
  };

  // Live lamp, 6 x 6.
  const L = {
    live: [".####.", "######", "######", "######", "######", ".####."],
    late: [".####.", "#....#", "#.##.#", "#.##.#", "#....#", ".####."],
    stale: [".####.", "#....#", "#....#", "#....#", "#....#", ".####."],
    lost: [".#..#.", "......", "#....#", "#....#", "......", ".#..#."],
    host: ["#....#", ".#..#.", "..##..", "..##..", ".#..#.", "#....#"],
  };

  // The lookout: a small round bird, 16 x 16, original. Eye and crest change with the mood.
  const BIRD = [
    "................",
    "......#####.....",
    "....##+++++##...",
    "...#+++++++++#..",
    "..#++++++++#o+#.",
    "..#++++++++##+##",
    ".#+++++++++++###",
    ".#+++++++++++#..",
    "##++##+++:::::#.",
    "#+++++##:::::::#",
    "#++++++#::::::#.",
    ".#++++#:::::::#.",
    "..#+++:::::::#..",
    "...###+++####...",
    "......#..#......",
    ".....##.##......",
  ];

  function birdRows(mood) {
    const rows = BIRD.slice();
    const set = (y, x, str) => { rows[y] = rows[y].slice(0, x) + str + rows[y].slice(x + str.length); };
    if (mood === "asleep") {
      // eye shut, head sunk, beak tucked
      set(4, 11, "++");
      set(5, 10, "##+");
    }
    if (mood === "alert") {
      // crest up, eye wide
      set(0, 7, "#.#");
      set(1, 6, "#+#+#");
      set(4, 11, "#o");
      set(5, 11, "#o");
    }
    if (mood === "worried") {
      // a brow over the eye
      set(3, 10, "##");
    }
    return rows;
  }

  const NS = "http://www.w3.org/2000/svg";
  const CLS = { "#": "px-ink", "+": "px-s2", ":": "px-s1", o: "px-paper" };

  function svg(rows, opts) {
    opts = opts || {};
    const h = rows.length;
    const w = rows[0].length;
    const el = document.createElementNS(NS, "svg");
    el.setAttribute("viewBox", "0 0 " + w + " " + h);
    el.setAttribute("width", w);
    el.setAttribute("height", h);
    el.setAttribute("shape-rendering", "crispEdges");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("focusable", "false");
    el.setAttribute("class", "spr " + (opts.cls || ""));
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      let x = 0;
      while (x < w) {
        const c = row[x];
        if (c === "." || c === undefined) { x++; continue; }
        let x2 = x;
        while (x2 < w && row[x2] === c) x2++;
        const r = document.createElementNS(NS, "rect");
        r.setAttribute("x", x);
        r.setAttribute("y", y);
        r.setAttribute("width", x2 - x);
        r.setAttribute("height", 1);
        r.setAttribute("class", CLS[c] || "px-ink");
        el.appendChild(r);
        x = x2;
      }
    }
    return el;
  }

  window.HH = window.HH || {};
  window.HH.glyph = function (name, cls) {
    return svg(G[name] || G.unknown, { cls: "g12 " + (cls || "") });
  };
  window.HH.pip = function (name) {
    return svg(M[name] || M.unknown, { cls: "g8" });
  };
  window.HH.lamp = function (name) {
    return svg(L[name] || L.stale, { cls: "g6" });
  };
  window.HH.bird = function (mood) {
    return svg(birdRows(mood), { cls: "g16 bird" });
  };
  window.HH.glyphNames = Object.keys(G);
})();
