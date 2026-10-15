/* Weatherdeck arcade concept: sprite sheet.
   Every sprite here was drawn for this concept and is dedicated to the public
   domain (CC0 1.0); see CREDITS.md. Each row is one line of pixels; each
   character picks a palette role from KEY, "." is transparent. Sprites render
   as inline SVG rects on the art-pixel grid, so they stay crisp at any integer
   scale and take their colours from the CSS tokens (day and night tables). */

const KEY = {
  a: "--amber", r: "--red", b: "--blue", g: "--mint", w: "--ink", i: "--ink2",
  f: "--fog", k: "--field", p: "--panel", m: "--rule2", n: "--trim",
};

const SPRITES = {
  // A call only the viewer can make: amber diamond with "!"
  call: [
    ".....aa.....",
    "....aaaa....",
    "...aaaaaa...",
    "..aaakkaaa..",
    ".aaaakkaaaa.",
    "aaaaakkaaaaa",
    "aaaaakkaaaaa",
    ".aaaaaaaaaa.",
    "..aaakkaaa..",
    "...aakkaa...",
    "....aaaa....",
    ".....aa.....",
  ],
  // Finished work waiting for the viewer's merge
  approve: [
    "...aaaaaa...",
    "..aaaaaaaa..",
    ".aaa....aaa.",
    ".aaa....aaa.",
    "........aaa.",
    ".......aaa..",
    ".....aaaa...",
    ".....aaa....",
    "............",
    ".....aaa....",
    ".....aaa....",
    "............",
  ],
  // Critical trouble: red triangle with "!"
  critical: [
    ".....rr.....",
    ".....rr.....",
    "....rrrr....",
    "....rkkr....",
    "...rrkkrr...",
    "...rrkkrr...",
    "..rrrkkrrr..",
    "..rrrkkrrr..",
    ".rrrrrrrrrr.",
    ".rrrrkkrrrr.",
    "rrrrrrrrrrrr",
    "rrrrrrrrrrrr",
  ],
  // A machine call (degraded): amber triangle with "!"
  warn: [
    ".....aa.....",
    ".....aa.....",
    "....aaaa....",
    "....akka....",
    "...aakkaa...",
    "...aakkaa...",
    "..aaakkaaa..",
    "..aaakkaaa..",
    ".aaaaaaaaaa.",
    ".aaaakkaaaa.",
    "aaaaaaaaaaaa",
    "aaaaaaaaaaaa",
  ],
  // Capacity running out: amber hourglass-battery
  capacity: [
    "....aaaa....",
    "..aaaaaaaa..",
    "..a......a..",
    "..a......a..",
    "..a......a..",
    "..a......a..",
    "..a......a..",
    "..aaaaaaaa..",
    "..aaaaaaaa..",
    "..aaaaaaaa..",
    "..aaaaaaaa..",
    "..aaaaaaaa..",
  ],
  // A step is running
  moving: [
    "..bb........",
    "..bbbb......",
    "..bbbbbb....",
    "..bbbbbbbb..",
    "..bbbbbbbbbb",
    "..bbbbbbbbbb",
    "..bbbbbbbbbb",
    "..bbbbbbbbbb",
    "..bbbbbbbb..",
    "..bbbbbb....",
    "..bbbb......",
    "..bb........",
  ],
  // Running far past its usual time: play mark with a trailing tail
  long: [
    "....ww......",
    "....wwww....",
    "....wwwwww..",
    "w.w.wwwwwwww",
    "w.w.wwwwwwww",
    "w.w.wwwwwwww",
    "w.w.wwwwwwww",
    "w.w.wwwwwwww",
    "w.w.wwwwwwww",
    "....wwwwww..",
    "....wwww....",
    "....ww......",
  ],
  // Landed or complete
  done: [
    "............",
    "..........gg",
    ".........ggg",
    "........ggg.",
    ".......ggg..",
    "gg....ggg...",
    "ggg..ggg....",
    ".gggggg.....",
    "..gggg......",
    "...gg.......",
    "............",
    "............",
  ],
  // A step failed
  failed: [
    "rr........rr",
    "rrr......rrr",
    ".rrr....rrr.",
    "..rrr..rrr..",
    "...rrrrrr...",
    "....rrrr....",
    "....rrrr....",
    "...rrrrrr...",
    "..rrr..rrr..",
    ".rrr....rrr.",
    "rrr......rrr",
    "rr........rr",
  ],
  // Waits on other work: a wall
  blocked: [
    "wwwwwwwwwwww",
    "w.....w....w",
    "w.....w....w",
    "wwwwwwwwwwww",
    "w..w.....w.w",
    "w..w.....w.w",
    "wwwwwwwwwwww",
    "w.....w....w",
    "w.....w....w",
    "wwwwwwwwwwww",
    "............",
    "............",
  ],
  // Fixing after review: round marker (circular arrow)
  round: [
    "...wwwww....",
    "..ww...ww.w.",
    ".ww.....www.",
    ".w.....wwww.",
    "ww..........",
    "ww..........",
    "ww..........",
    "ww........ww",
    ".w........w.",
    ".ww......ww.",
    "..ww....ww..",
    "...wwwwww...",
  ],
  // A question its own supervisor answers: hourglass
  mate: [
    "iiiiiiiiiiii",
    ".i........i.",
    ".i........i.",
    "..i......i..",
    "...i.ii.i...",
    "....iiii....",
    "....i..i....",
    "...i....i...",
    "..i..ii..i..",
    ".i.iiiiii.i.",
    ".iiiiiiiiii.",
    "iiiiiiiiiiii",
  ],
  // Investigating, no honest percent: magnifying glass
  scout: [
    "...iiii.....",
    "..i....i....",
    ".i......i...",
    "i...ii...i..",
    "i..i.....i..",
    "i........i..",
    ".i......i...",
    "..i....ii...",
    "...iiiiiii..",
    ".......iiii.",
    "........iiii",
    ".........ii.",
  ],
  // State only, no percent: a plain running dot
  coarse: [
    "............",
    "............",
    "....iiii....",
    "...iiiiii...",
    "..iiiiiiii..",
    "..iiiiiiii..",
    "..iiiiiiii..",
    "..iiiiiiii..",
    "...iiiiii...",
    "....iiii....",
    "............",
    "............",
  ],
  // No word, last known shown: dotted diamond with "?"
  unknown: [
    ".....f......",
    "....f.f.....",
    "...f...f....",
    "..f.fff.f...",
    ".f.f...f.f..",
    "f.....f...f.",
    ".f...f...f..",
    "..f.....f...",
    "...f.f.f....",
    "....f.f.....",
    ".....f......",
    "............",
  ],
  // Parked for the night
  asleep: [
    "......iiiiii",
    "..........i.",
    ".........i..",
    "........i...",
    ".......iiiii",
    "............",
    "iiiiiii.....",
    ".....i......",
    "....i.......",
    "...i........",
    "..i.........",
    ".iiiiiii....",
  ],
  // A machine ("life" in the bottom row): a small tower with a lit bay
  machine: [
    "..nnnnnnnn..",
    "..nmmmmmmn..",
    "..nmwwwwmn..",
    "..nmmmmmmn..",
    "..nmwwwwmn..",
    "..nmmmmmmn..",
    "..nmmmmmmn..",
    "..nmmggmmn..",
    "..nmmmmmmn..",
    "..nnnnnnnn..",
    ".nn......nn.",
    "............",
  ],
  // Machine health pips: square ok, triangle degraded, cross down
  pipOk: [
    "......",
    ".iiii.",
    ".iiii.",
    ".iiii.",
    ".iiii.",
    "......",
  ],
  pipWarn: [
    "..aa..",
    "..aa..",
    ".aaaa.",
    ".aaaa.",
    "aaaaaa",
    "aaaaaa",
  ],
  pipDown: [
    "rr..rr",
    ".rrrr.",
    "..rr..",
    ".rrrr.",
    "rr..rr",
    "......",
  ],
  pipSilent: [
    "f.f.f.",
    "......",
    "f....f",
    "......",
    "f.f.f.",
    "......",
  ],
  // Player 1, idle and ready (all-clear): 16 x 16 original figure
  player: [
    "................",
    ".....wwwwww.....",
    "....wwwwwwww....",
    "....wwkwwkww....",
    "....wwkwwkww....",
    "....wwwwwwww....",
    ".....wwkkww.....",
    "......wwww......",
    "...bbbbbbbbbb...",
    "..bbbbbbbbbbbb..",
    "..bb.bbbbbb.bb..",
    "..ww.bbbbbb.ww..",
    ".....bbbbbb.....",
    ".....bb..bb.....",
    ".....bb..bb.....",
    "....www..www....",
  ],
  // Landing star: one flash when the score changes
  star: [
    ".....g.....",
    ".....g.....",
    "....ggg....",
    "ggggggggggg",
    ".ggggggggg.",
    "..ggggggg..",
    "..ggg.ggg..",
    ".gg.....gg.",
    ".g.......g.",
    "...........",
  ],
  // Continue cursor (dialog "more" marker)
  cursor: [
    "aaaaaaa",
    ".aaaaa.",
    "..aaa..",
    "...a...",
  ],
  // No signal: a screen full of static
  nosignal: [
    "mmmmmmmmmmmmmmmm",
    "m..............m",
    "m.f.f..f.f.f..fm",
    "m..f.f...f..f..m",
    "m.f..f.f..f.f.fm",
    "m..f...f.f..f..m",
    "m.f.f.f...f.f..m",
    "m..f..f.f..f.f.m",
    "m..............m",
    "mmmmmmmmmmmmmmmm",
    "......mmmm......",
    "....mmmmmmmm....",
  ],
};

/* Turn a sprite into an inline SVG string. Runs of one colour become one rect,
   so a 12 x 12 sprite is a few dozen nodes. `scale` is in art pixels. */
function spriteSVG(name, scale = 1, label = "") {
  const rows = SPRITES[name];
  if (!rows) return "";
  const h = rows.length, w = rows[0].length;
  let rects = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      if (c === ".") { x++; continue; }
      let run = 1;
      while (x + run < w && row[x + run] === c) run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1" style="fill:var(${KEY[c]})"/>`;
      x += run;
    }
  });
  const a11y = label ? `role="img" aria-label="${label}"` : `aria-hidden="true"`;
  return `<svg class="spr spr-${name}" ${a11y} viewBox="0 0 ${w} ${h}" ` +
    `style="width:calc(var(--ap) * ${w * scale});height:calc(var(--ap) * ${h * scale})" ` +
    `shape-rendering="crispEdges">${rects}</svg>`;
}

window.ArcadeSprites = { SPRITES, spriteSVG };
