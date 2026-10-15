"use strict";
/* The board: lays the zones out by role and fills them from the board model (docs/theme-spec.md
   sections 8 and 9). Every data string is set through textContent (feed text is untrusted). The
   page is rebuilt every second and patched into the live DOM node by node, so nothing changes on
   screen, and no node is touched, unless what it says changed. */

/* The "also" lines under the calls. An unverified share of the number comes first, with its reason (the card its source named
   as saying the same, `waiting.note`, is left out); the info cards follow as FYIs. */
function alsoLines(B, unver) {
  return [...unver.map(u => [L("also"), L("unverified_line", { name: u.name, reason: u.reason })]),
    ...(B.disagree ? B.disagree.lines.map(x => [B.disagree.badge, x]) : []),
    ...B.also.filter(a => !explainsUnverified(unver, a)).map(a => [L("fyi"), alsoText(a)])];
}
/* How old the waiting-on-you number is, said next to it (frontdoor.js asksAge): "as of 2 min ago", or "not reported". */
function asksAsOf(B) {
  return B.asksAgeS != null ? L("calls_as_of", { t: age(B.asksAgeS) }) : L("calls_as_of_unknown");
}

function setStyle(el, css) {
  for (const part of String(css).split(";")) {
    const i = part.indexOf(":");
    if (i > 0) el.style.setProperty(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
}
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") setStyle(el, v); // CSSOM, so a strict CSP allows it
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
/* Text in a type role (section 5) and a colour role. */
const t = (role, colour, text, extra) => h("span", { class: "t-" + role + (colour ? " c-" + colour : "") + (extra ? " " + extra : "") }, text);
const lbl = (text, colour, extra) => t("label", colour, text, extra);

/* Patch the live node a toward the freshly built node b, touching only what differs. */
function patch(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) { a.replaceWith(b); return; }
  if (a.nodeType === 3) { if (a.data !== b.data) a.data = b.data; return; }
  if (a.nodeType !== 1) return;
  if (a.nodeName === "CANVAS") {
    if (a.dataset.key !== b.dataset.key || a.width !== b.width || a.height !== b.height || a.className !== b.className) { a.replaceWith(b); return; }
  }
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of [...b.attributes]) {
    if (a.getAttribute(at.name) === at.value) continue;
    // A style attribute is copied through the CSSOM: the content security policy blocks style set as an attribute, which
    // left a moved plate (a machine's on the sea, a door on the plan) at its old place under its new words.
    if (at.name === "style") a.style.cssText = b.style.cssText;
    else a.setAttribute(at.name, at.value);
  }
  if (a.nodeName === "CANVAS" || a.hasAttribute("data-keep")) return;   // a kept node's children belong to the page (the sea's picture slot)
  const ak = [...a.childNodes], bk = [...b.childNodes];
  for (let i = 0; i < Math.max(ak.length, bk.length); i++) {
    if (!ak[i]) a.append(bk[i]);
    else if (!bk[i]) ak[i].remove();
    else patch(ak[i], bk[i]);
  }
}
function mount(parent, id, el) {
  const cur = document.getElementById(id);
  if (!el) { if (cur) cur.remove(); return; }
  el.id = id;
  if (!cur) parent.append(el);
  else patch(cur, el);
}

/* ---------- small parts ---------- */
let COL = {};
const G = (name, slot, opts) => glyphCanvas(S.theme, COL, name, slot, opts);
const sprite = (name, scale, cls) => spriteCanvas(S.theme, name, S.mode, scale, { cls });
const zoneStyle = z => z ? `--x:${z.x};--y:${z.y};--w:${z.w};--h:${z.h ?? z.h_max ?? 0}` : "";
const ZT = () => ((S.theme.zones || {}).tv || {});
/* A TV zone as it stands now: on the open sea (model.js B.open) the theme's open set (zones.tv.open) replaces the call,
   the scene window and the since plate; everything else keeps its zone. */
const ZO = (B, name) => (B && B.open && (ZT().open || {})[name]) || ZT()[name];
const sceneWin = B => (ZO(B, "scene") || {}).window || { x: 384, y: 41, w: 236, h: 164 };
/* Machine plates the scene positions (its zone has an anchor, not a box) instead of a panel. */
const scenePlates = () => !!((ZT().machines || {}).anchor) && !!S.theme.scene;
/* A range bar: a solid floor and a hatched span in the state slot, on the track (9.5). */
function rangeBar(r, slot, stale) {
  if (!r) return null;
  return h("span", { class: "rng" + (stale ? " stale" : "") + (r.reported ? " reported" : ""), style: `--lo:${r.lo};--hi:${r.hi}`, "data-slot": stale ? "fog" : slot, "aria-hidden": "true" },
    h("i", { class: "floor" }), h("i", { class: "span" }));
}
const RANGE_SLOT = { failed: "trouble", done: "done", approval: "done", call: "moving", pr_open: "done" };
const lampPip = tr => G(tr.lamp === "stale" ? "silent" : "lamp", tr.lamp === "live" ? "ink" : tr.lamp === "late" ? "ink2" : "fog", { cls: "lamp" });

/* Where to act, led by the source's recommendation when it sent one (one line, so the band keeps its shape). */
/* An FYI card in one line: its title, and its note when the page added one (a supervision alarm's "not reported"). */
const alsoText = a => [a.title, a.note].filter(Boolean).join(" · ");
const howLine = c => (c.recommend ? [L("recommend", { text: c.recommend }), c.how].filter(Boolean).join(" · ") : c.how) || null;

/* ---------- the bar ---------- */
function profileWord() {
  const p = S.view.profile;
  return p.privacy ? "profile_privacy" : p.redaction === "public" ? "profile_public" : p.redaction === "household" ? "profile_household" : "profile_guest";
}
function barTrust(B, phone) {
  const tr = B.trust;
  return h("div", Object.assign({ class: "trust" }, phone ? {} : seaDoor("logbook")), lampPip(tr), h("div", { class: "stack" },
    lbl(B.hostdown ? L("last_known") : L("trust_live", { live: tr.live, total: tr.total }) + (tr.resting ? " +" + L("trust_resting_n", { n: tr.resting }) : ""), B.hostdown ? "ink2" : "ink", "nowrap"),
    t("body", "ink2", tr.problems.length || tr.oldNotes.length || B.lost || B.hostdown ? (B.hostdown ? L("as_of", { t: hm(newestAt()) }) : tr.line2)
      : [B.sample ? L("sample") : null, B.redacted ? L(profileWord()) : null,
        L("trust_ok", { t: age(tr.newest), host: S.server.host || "" })].filter(Boolean).join(" · "), "ellipsis")));
}
function renderBar(B, g) {
  const bar = h("header", { class: "zone bar plate", style: zoneStyle(ZT().bar), role: "status" });
  const clock = t("numeral", "ink", hm(B.now), "clock");
  if (B.loading) { bar.append(h("span", { class: "spacer" }), clock); return bar; }
  if (B.empty) {
    bar.append(h("span", { class: "spacer" }), clock, h("div", { class: "trust" }, G("silent", "fog", { cls: "lamp" }),
      h("div", { class: "stack" }, lbl(L("empty_bar"), "ink"), t("body", "ink2", S.server.host ? L("served_by", { host: S.server.host }) : "", "ellipsis"))));
    return bar;
  }
  if (B.critical.length && !B.hostdown) {
    const c = B.critical[0];
    bar.classList.add("alarm");
    bar.setAttribute("role", "alert");
    bar.append(h("div", Object.assign({ class: "alarm-body" }, seaDoor("bridge", c.id)), G("failed", "trouble"), h("div", { class: "stack" },
      h("div", { class: "line" }, lbl(L("problem"), "trouble"), t("title", "ink", c.title || c.id, "ellipsis")),
      t("body", "ink2", [c.how, c.ageS != null ? L("ago", { t: age(c.ageS) }) : null, B.critical.length > 1 ? L("more", { n: B.critical.length - 1 }) : null].filter(Boolean).join(", "), "ellipsis"))));
  } else if (B.hostdown && !g.phone) {
    const at = newestAt();
    bar.classList.add("nohost");
    bar.append(h("div", { class: "alarm-body" }, lbl(L("no_host"), "ink2"), h("div", { class: "stack" },
      t("title", "ink", L("hail_title"), "ellipsis"),
      t("body", "ink2", at ? L("newest_line", { at: hm(at), t: coarse(nowS() - at) }) : "", "ellipsis"))));
  } else if (g.phone && B.lost) {
    const at = B.now - B.trust.newest, w = lostWords(B, at);
    bar.append(h("div", { class: "alarm-body" }, G("silent", "fog"), h("div", { class: "stack" },
      t("title", "ink", w.title), t("body", "ink2", w.body))));
  } else if (!g.phone) {
    const latest = B.score.latest;
    bar.append(h("div", Object.assign({ class: "score" }, seaDoor("cargo-hold")), t("numeral", "ink", String(B.score.n)), h("div", { class: "stack" },
      lbl(landedWord(B), "ink2", "nowrap"),
      t("body", WORLD.note ? "ink" : "ink2", WORLD.note ? WORLD.note.text : latest ? L("latest_line", { title: latest.title || "", t: age(B.now - epoch(latest.at)) }) : L("nothing_yet"), "ellipsis"))));
    const chart = h("canvas", { class: "px chart", width: 130, height: 20, "aria-hidden": "true" });
    paintChart(chart, B);
    bar.append(h("div", Object.assign({ class: "ahead-door" }, seaDoor("chart-room")), chart, lbl(L("ahead", { n: B.next.length }), "ink2", "nowrap ahead")));
  }
  if (!bar.querySelector(".alarm-body")) bar.append(h("span", { class: "spacer" }));
  bar.append(clock, barTrust(B, g.phone));
  if (g.phone && B.machines.length) {
    bar.append(h("div", { class: "pips" }, B.machines.map(m => h("span", { class: "pipline" }, G(m.pip, m.slot), lbl(m.label, m.key === "silent" ? "fog" : "ink"), lbl(m.word, m.slot === "ink2" ? "ink2" : m.slot)))));
  }
  return bar;
}
/* Lost contact, or, when every reporter is a machine that sleeps at night, a calm "asleep since". */
function lostWords(B, at) {
  if (B.asleep) return { title: L("asleep_title", { name: B.asleep.names, t: hm(B.asleep.since) }), body: L("asleep_body", { t: hm(at) }) };
  return { title: L("lost_title", { t: age(B.now - at) }), body: L("lost_body", { t: hm(at) }) };
}
/* The bar chart is theme art when the scene module draws one; otherwise days of done work. */
function paintChart(cv, B) {
  const ctx = cv.getContext("2d"), mod = S.theme.scene;
  const days = ((S.view.history || {}).by_day || []).map(d => Object.values(d.done || {}).reduce((a, b) => a + b, 0));
  const data = { days, landed: B.doneToday.map(d => epoch(d.at)), now: B.now, ahead: B.next.map(n => n.kind || "queued"),
    dayStart: dayStartEpoch(B.now), palette: COL, mode: S.mode };
  cv.dataset.key = JSON.stringify([days, data.landed.length, data.ahead, S.mode, Math.floor(B.now / 600)]);
  if (mod && mod.chart) { try { mod.chart(ctx, cv.width, cv.height, data); return; } catch (e) { warnOnce("chart", e); } }
  const max = Math.max(1, ...days), bw = Math.floor(cv.width / Math.max(1, days.length));
  days.forEach((n, i) => {
    const hh = n ? Math.max(1, Math.round((n / max) * (cv.height - 2))) : 1;
    ctx.fillStyle = i === days.length - 1 ? COL.ink : n ? COL.ink2 : COL.rule;
    ctx.fillRect(i * bw, cv.height - hh, Math.max(1, bw - 2), hh);
  });
}
function dayStartEpoch(now) {
  const q = cfg().display.quiet_hours, end = q && q.end ? parseHM(q.end) : 0;
  return now - ((minutesOf(now) - end + 1440) % 1440) * 60;
}

/* ---------- the call: the one focal point (9.2) ---------- */
/* How old the answer behind the waiting number is (feed: waiting.as_of): "answer 12 min old", naming the source when
   more than one gives one. Said on the plate itself, never only in the Logbook. */
function answerWord(B) {
  const a = (B.answers || [])[0];
  if (!a) return null;
  return B.answers.length > 1 ? L("answer_age_of", { name: a.name, t: age(a.s) }) : L("answer_age", { t: age(a.s) });
}
function callAge(c) {
  if (c.frozen) return L("as_of", { t: hm(c.asOf) });
  if (c.lastKnown) return L("call_last_known", { t: age(c.answerAgeS) });
  return c.ageS != null ? age(c.ageS) : "";
}
function renderCall(B, g) {
  const n = waitingOnYou(B.asks), z = ZO(B, "call"), el = h("section", { class: "zone call", style: zoneStyle(z), "aria-label": L("call_band") });
  if (B.loading) {
    el.classList.add("plate", "notice");
    el.append(lbl(L("reading"), "ink2"), h("div", { class: "skel" }), h("div", { class: "skel short" }));
    return el;
  }
  if (B.empty) {
    el.classList.add("plate", "notice");
    el.append(t("notice_title", "ink", L("empty_title")), t("body", "ink2", L("empty_body")), t("body", "ink2", L("empty_hint")));
    return el;
  }
  if (B.lost && !g.phone) {
    const at = B.now - B.trust.newest, w = lostWords(B, at);
    el.classList.add("plate", "notice", "lost");
    if (!B.asleep) el.setAttribute("role", "alert");
    el.append(t("notice_title", "ink", w.title), t("body", "ink2", w.body));
    if (n) el.append(t("body", "ink2", L("lost_calls", { n })));
    return el;
  }
  const unver = B.unverified || [];
  if (!n && unver.length) {   // no number at all rather than one from another path, and why
    el.classList.add("plate", "calm");
    el.append(t("numeral", "ink", L("waiting_unverified")),
      ...unver.slice(0, 2).map(u => t("body", "ink2", L("unverified_line", { name: u.name, reason: u.reason }), g.phone ? "" : "ellipsis")));
    return el;
  }
  if (!n && B.open) return renderOpenBanner(B, el);
  if (!n) {
    for (const [k, v] of Object.entries(seaDoor("bridge"))) el.setAttribute(k, v);
    el.classList.add("plate", "calm");
    // Never say "nothing is waiting" as a present fact while a source is not reporting (docs/feed-spec.md).
    el.append(t("numeral", "ink", L(B.trust.problems.length ? "all_clear_last" : "all_clear")), t("body", "ink2", [L("calm_line", { moving: B.underway.length, off: B.off.length, waiting: B.waiting.length, landed: B.score.n, when: landedWhen(B) }), answerWord(B)].filter(Boolean).join(" ")));
    if (B.also.length) el.append(t("body", "ink2", L("fyi") + " " + B.also.map(alsoText).join("; ")));
    // Without a scene behind it the plate keeps its whole zone, so it lists what landed today.
    if (!S.theme.scene && !g.phone && B.doneToday.length) {
      el.append(h("div", { class: "landed" }, lbl(landedWord(B), "ink2"),
        B.doneToday.slice(0, 4).map(d => h("div", { class: "lrow" }, lbl(hm(epoch(d.at)), "ink2"), t("body", "ink", d.title || d.id, "ellipsis")))));
    }
    return el;
  }
  const calls = B.askCards, frozenAll = calls.every(c => c.frozen);
  for (const [k, v] of Object.entries(seaDoor("bridge"))) el.setAttribute(k, v);
  el.classList.add("focal");
  el.dataset.tight = String(S.callTight || 0);
  if (S.anim.call) el.classList.add("arrive");
  const band = h("div", { class: "band" + (S.anim.call ? " blink" : "") },
    B.callsAtLeast ? lbl(L("at_least"), "band-ink", "lk") : null,
    t("numeral_hero", "band-ink", String(n), S.anim.call ? "bounce" : ""),
    lbl(L(n === 1 && !unver.length ? "call_band_one" : "call_band"), "band-ink"),
    frozenAll ? lbl(L("last_known"), "band-ink", "lk") : lbl(asksAsOf(B), "band-ink", "lk asof"),
    B.disagree ? h("span", { class: "t-label c-band-ink lk disagree", title: B.disagree.lines.join("\n") }, B.disagree.badge) : null,
    unver.length ? lbl(L("unverified_on", { names: unver.map(u => u.name).join(", ") }), "band-ink", "lk") : null,
    !frozenAll && !g.phone && answerWord(B) ? lbl(answerWord(B), "band-ink", "lk answer") : null,
    h("span", { class: "perch", id: "band-mark" }, S.anim.flying || !bandTokens().sprite ? null : sprite(bandTokens().sprite, 1, "mark")));
  const top = calls[0];
  const body = h("div", { class: "body" }, h("div", { class: "top" },
    G(top.frozen ? "silent" : top.glyph, top.frozen ? "call_ink2" : "needs", { ink: COL.glyph_ink }),
    t("title", "call-ink", top.title || top.id, g.phone ? "" : "clamp2"),
    lbl(callAge(top), "call-ink", "age"),
    howLine(top) ? t("body", "call-ink2", howLine(top), "where" + (g.phone ? "" : " ellipsis")) : null,
    top.detail ? t("body", "call-ink2", top.detail, "detail" + (g.phone ? "" : " ellipsis")) : null));
  const rest = calls.slice(1), fit = g.phone ? rest.length : (calls.length > 4 ? 2 : 3);
  if (rest.length) {
    body.append(h("hr"));
    const rows = h("div", { class: "rows" });
    for (const c of rest.slice(0, fit)) {
      rows.append(h("div", { class: "row" + (c.frozen ? " frozen" : "") },
        G(c.frozen ? "silent" : c.glyph, c.frozen ? "call_ink2" : "needs", { ink: COL.glyph_ink }),
        h("div", { class: "what" }, t("body", "call-ink", c.title || c.id, g.phone ? "" : "ellipsis"),
          g.phone && howLine(c) ? t("body", "call-ink2", howLine(c)) : null, g.phone && c.detail ? t("body", "call-ink2", c.detail) : null),
        lbl(callAge(c), "call-ink", "age")));
    }
    if (rest.length > fit) rows.append(h("div", { class: "row more" }, h("span"), t("body", "call-ink2", L("call_more", { n: rest.length - fit }))));
    body.append(rows);
  }
  const also = alsoLines(B, unver);
  if (g.phone && !frozenAll && answerWord(B)) also.unshift(["", answerWord(B)]);   // the phone's band has no room for it
  if (g.phone || calls.length <= 3) for (const [k, text] of also) body.append(h("div", { class: "also" }, lbl(k, "call-ink2"), t("body", "call-ink2", text, g.phone ? "" : "ellipsis")));
  el.append(band, body, h("i", { class: "cursor", "aria-hidden": "true" }));
  return el;
}

/* The open sea's banner: the calm plate in one line over the scene ("Nothing waits on you · 22 under way, ..."), so the
   sea has the whole upper area. It is still the Bridge's door, and says in its label what the line had to cut. */
function renderOpenBanner(B, el) {
  for (const [k, v] of Object.entries(seaDoor("bridge"))) el.setAttribute(k, v);
  el.classList.add("plate", "calm", "open");
  const head = L(B.trust.problems.length ? "all_clear_last" : "all_clear");
  const line = [L("calm_line", { moving: B.underway.length, off: B.off.length, waiting: B.waiting.length, landed: B.score.n, when: landedWhen(B) }), answerWord(B),
    B.also.length ? L("fyi") + " " + B.also.map(alsoText).join("; ") : null].filter(Boolean).join(" ");
  el.setAttribute("aria-label", head + ". " + line + " " + (el.getAttribute("aria-label") || ""));
  el.append(lbl(head, "ink", "nowrap head"), t("body", "ink2", line, "ellipsis line"));
  return el;
}

/* ---------- machines: a panel (no scene) or plates placed on the scene (9.4) ---------- */
function renderMachinesPanel(B) {
  const z = ZT().machines;
  const el = h("section", Object.assign({ class: "zone side plate machines", style: zoneStyle(z) }, seaDoor("crows-nest"), { "aria-label": L("machines") }), lbl(L("machines"), "ink2", "head"));
  const shown = B.machines.slice(0, 4);
  for (const m of shown) {
    el.append(h("div", { class: "mrow" + (m.key === "silent" || m.key === "lost" ? " stale" : "") },
      h("div", { class: "line" }, G(m.pip, m.slot), lbl(m.label, m.key === "silent" ? "fog" : "ink", "ellipsis name"), lbl(m.word, m.slot, "nowrap")),
      t("body", "ink2", m.vitals.length ? m.vitals.map(v => v.text).join(" · ") : m.role, "clamp2 vit")));
  }
  if (B.machines.length > 4) el.append(t("body", "ink2", L("more", { n: B.machines.length - 4 })));
  if (!B.machines.length) el.append(t("body", "ink2", L("no_machines")));
  return el;
}
/* Text width in art px for a type role, measured with the loaded face (layout is decided before
   anything is drawn, so a fitted board is never patched back and forth). */
const measurer = document.createElement("canvas").getContext("2d");
function textW(role, text) {
  const r = S.theme.type.roles[role], face = { pixel: "--f-pixel", numeral: "--f-numeral", data: "--f-data" }[r.face];
  measurer.font = r.weight + " " + r.size_ap * 10 + "px " + getComputedStyle(document.documentElement).getPropertyValue(face);
  return Math.ceil(measurer.measureText(r.case === "upper" ? text.toUpperCase() : text).width / 10);
}
/* Hull plates sit where the scene module puts each ship (theme-spec section 21): the flagship's under its hull, each escort's
   under it (the near row) or over its masthead (the far row), and the convoy's count plate over the convoy. Each row is
   laid out on its own: when plates would touch, words give way to short words, then words only for alarms and silence,
   then none; then the plates spread apart inside their row, and last, names are cut to fit. */
const LOUD = new Set(["alert", "down", "silent", "lost"]);
function fitRow(items, lo, hi) {
  const pad = 4, gap = 3;
  // Becalmed (a possible wedge, section 17) and declared rest (reserved, maintenance) keep their word as long as the alarms do.
  const keeps = it => it.m && (it.m.becalmed || it.m.resting || it.m.asleep);
  const wordOf = (it, level) => (it.calm || level >= 3 || (level === 2 && !it.loud && !keeps(it)) ? null : level >= 1 ? it.short : it.word);
  const extraOf = (it, level) => (level === 0 && it.extra ? it.extra : null);
  const width = (it, level, name) => pad * 2 + (it.pip ? 8 + gap : 0) + textW("label", name ?? it.name) + (wordOf(it, level) ? gap + textW("label", wordOf(it, level)) : 0) +
    (extraOf(it, level) ? gap + textW("label", extraOf(it, level)) : 0) + (it.badge || []).reduce((a, b) => a + gap * 2 + 10 + 1 + textW("label", String(b.n)), 0);
  let level = 0, xs = [];
  for (level = 0; level <= 3; level++) {
    let prev = lo - 2;
    xs = items.map(it => { const w = width(it, level), x = Math.max(Math.round(it.ax - w / 2), prev + 2); prev = x + w; return { x, w }; });
    const over = prev - hi;
    if (over > 0) for (const q of xs) q.x -= over;
    if (!xs.length || xs[0].x >= lo) break;
  }
  level = Math.min(level, 3);
  const names = items.map(it => it.name);
  if (xs.length && xs[0].x < lo) {
    // Still too wide with every word gone: equal shares of the row, each name cut to fit (never over a neighbour). A fixed
    // plate (the convoy's count) is never cut: its width comes off the row first.
    const fixed = items.filter(it => it.fixed), cut = items.length - fixed.length;
    const share = Math.floor((hi - lo - gap * (items.length - 1) - fixed.reduce((a, it) => a + width(it, level), 0)) / Math.max(1, cut));
    let x = lo;
    xs = items.map((it, i) => {
      if (it.fixed) { const q = { x, w: width(it, level) }; x += q.w + gap; return q; }
      const extra = width(it, level) - textW("label", it.name), room = Math.max(8, share - extra);
      names[i] = cutToWidth("label", it.name, room, textW);
      const q = { x, w: Math.min(share, extra + textW("label", names[i])) };
      x += q.w + gap;
      return q;
    });
  }
  for (const q of xs) q.x = Math.max(lo, q.x);
  return items.map((it, i) => ({ it, x: xs[i].x, w: xs[i].w, name: names[i], word: wordOf(it, level), extra: extraOf(it, level) }));
}
/* A ship plate's quiet badge (frontdoor.js badgeCounts): the calls waiting on the viewer from that machine, and its lanes off
   course plus its critical alerts, so nothing that needs the viewer hides on the sea. */
function shipBadge(B, id) {
  const { calls, trouble } = badgeCounts(id, { asks: B.asks, critical: B.critical, off: B.off, sources: S.view.sources });
  return [calls ? { glyph: "needs", slot: "needs", n: calls, say: L("ship_calls", { n: calls }) } : null,
    trouble ? { glyph: "failed", slot: "trouble", n: trouble, say: L("ship_trouble", { n: trouble }) } : null].filter(Boolean);
}
function renderScenePlates(B, g, anchors) {
  const box = h("div", { class: "splates" }), A = S.anchors || {}, fl = B.fleet || { ships: [], convoy: null };
  const win = sceneWin(B), right = win.x + win.w + 8, road = A.roadstead || null;
  const rows = { hull: [], above: [], below: [] };
  for (const sh of fl.ships) {
    const m = sh.m, a = anchors[m.id];
    if (!a) continue;
    const below = sh.role === "flagship" || a.full ? ((A.below || {})[m.id] || 0) : 0;   // a ship at full scale says its own below-decks count
    rows[a.row || "hull"].push({ m, ax: a.x, y: a.y, pip: true, name: m.label, word: m.word, short: m.short, calm: m.key === "ok" && !m.becalmed && !m.unconfirmed, loud: LOUD.has(m.key),
      extra: below ? L("below_decks", { n: below }) : null, sr: below ? L("below_decks_long", { n: below }) : null, door: seaDoor("crows-nest", m.id), stale: m.key === "silent" || m.key === "lost",
      badge: shipBadge(B, m.id) });
  }
  const cv = fl.convoy, ca = A.convoy;
  if (cv && ca) {
    const worst = (B.machines || []).filter(m => cv.ids.includes(m.id)).sort((a, b) => HULL_ORDER.indexOf(a.asleep ? "asleep" : a.key) - HULL_ORDER.indexOf(b.asleep ? "asleep" : b.key))[0];
    const words = cv.words.map(([w, k]) => k + " " + L("hull_" + w)).join(" · ");
    rows[ca.row || "above"].push({ m: worst, ax: ca.x, y: ca.y, pip: !!worst, name: L(cv.n === 1 ? "fleet_convoy_one" : "fleet_convoy", { n: cv.n }), word: words || null, short: words || null,
      calm: !words, loud: cv.words.some(([w]) => ["alert", "not_answering", "lost", "silent"].includes(w)), door: seaDoor("crows-nest"), stale: cv.stale, convoy: true, fixed: true });
  }
  const bounds = { hull: [win.x, right], above: [road ? road.x0 - 10 : win.x, right], below: [road ? road.below_x0 ?? road.x0 : win.x, right] };
  // Plates are laid out row by row, but read (and tabbed through) in the fleet's order, the convoy last; each says its ship.
  const placed = Object.entries(rows).flatMap(([row, items]) => items.length ? fitRow(items, bounds[row][0], bounds[row][1]).map(p => Object.assign(p, { row })) : []);
  const rank = p => (p.it.convoy ? 1e3 : fl.order.indexOf(p.it.m.id));
  for (const p of placed.sort((a, b) => rank(a) - rank(b))) {
    const { it, row } = p, m = it.m;
    const say = [it.name, it.word, it.sr, ...(it.badge || []).map(b => b.say)].filter(Boolean).join(", ") + ". " + (it.door["aria-label"] || "");
    box.append(h("div", Object.assign({ class: "splate plate" + (it.stale ? " stale" : "") + (it.convoy ? " convoy" : ""), style: `--x:${p.x};--y:${it.y ?? 185};--w:${p.w}`,
      "data-machine": it.convoy ? "@convoy" : m.id, "data-row": row }, it.door, { "aria-label": say }),
      it.pip && m ? G(m.pip, m.slot) : null, lbl(p.name, it.stale ? "fog" : "ink", "name"), p.name !== it.name ? h("span", { class: "sr" }, it.name) : null,
      p.word ? lbl(p.word, it.convoy ? "ink2" : m.slot, "word") : it.word ? h("span", { class: "sr" }, it.word) : null,
      p.extra ? lbl(p.extra, "ink2", "word") : it.sr ? h("span", { class: "sr" }, it.sr) : null,
      (it.badge || []).map(b => h("span", { class: "sbadge", "aria-hidden": "true" }, G(b.glyph, b.slot), lbl(String(b.n), "ink")))));
  }
  return box;
}

/* ---------- the log (9.5) ---------- */
/* The project chip before a title: the item's project, else its group (the title no longer repeats it). */
const chipEl = (l, phone) => (l.chip ? lbl(phone ? l.chip : l.chip.slice(0, 18), "ink2", "chip nowrap") : null);
/* A row's glyph and colour from its row word (frontdoor.js rowState): the lane kind's own glyph while the two agree, else the
   glyph of the word's plainest kind, so an old failed record never draws the failure glyph. */
const ROW_GLYPH = { you: "call", stuck: "blocked", unk: "unknown", work: "moving", other: "mate", done: "done" };
const ROW_KIND = { call: "you", approval: "you", failed: "stuck", blocked: "stuck", agent_gone: "stuck", unknown: "unk", moving: "work",
  regressed: "work", long: "work", scout: "work", mate: "other", pr_open: "other", pr_unread: "other", done: "done" };
const ROW_INK = { you: "needs", stuck: "trouble", unk: "fog", work: "ink", other: "ink", done: "ink" };
function rowGlyph(l) {
  if (ROW_KIND[l.kind] === l.rowKey) return { glyph: l.glyph, slot: l.slot };
  const g = GLYPHS.states[ROW_GLYPH[l.rowKey]] || GLYPHS.states.unknown || {};
  return { glyph: g.glyph || "silent", slot: (g.slot || "fog") === "needs" && l.rowKey !== "you" ? "ink2" : g.slot || "fog" };
}
function logRow(l, g, calm) {
  const look = rowGlyph(l), slot = l.stale ? "fog" : look.slot;
  // The row word, then how long the lane has been in that state (the host's age_in_state, counted on here).
  const word = h("span", { class: "w" }, lbl(l.rowWord, calm ? "ink2" : ROW_INK[l.rowKey] || "ink", "nowrap"),
    l.ageText ? h("span", { class: "age" }, lbl(l.ageText, "ink2", "nowrap"), h("span", { class: "sr" }, L("in_state", { t: age(l.inState) }))) : null,
    l.stale ? lbl(L("last_known"), "fog", "nowrap lk") : null);
  const rtext = l.range ? l.range.text : l.phase ? L("phase_of", { n: l.phase.n, m: l.phase.m }) : L("no_percent");
  const range = h("span", { class: "r" }, lbl(rtext, l.stale ? "fog" : l.range ? "ink" : "ink2", "nowrap"), rangeBar(l.range, RANGE_SLOT[l.kind] || "moving", l.stale));
  if (g.phone) {
    const ttl = logTitle(l, 0);
    return h("div", { class: "lane" + (l.stale ? " stale" : "") }, G(look.glyph, slot, { dither: l.stale }),
      h("div", { class: "what" }, h("div", { class: "tline" }, chipEl(l, true), t("title_log", l.stale ? "fog" : "ink", ttl.text)), h("div", { class: "line" }, word, range),
        l.steer && l.steer.row ? t("body", "needs", l.steer.row.text) : null, l.sentence ? t("body", "ink2", l.sentence) : null, lbl(l.machineLabel, "ink2")));
  }
  const ttl = logTitle(l, S.titleRoom || 0);
  return h("div", { class: "row" + (l.stale ? " stale" : "") + (calm ? " calm" : "") }, G(look.glyph, slot, { dither: l.stale }),
    h("span", { class: "title tcell" }, ttl.chip ? chipEl(l, false) : null, t("title_log", l.stale ? "fog" : calm ? "ink2" : "ink", ttl.text, "ellipsis")), word,
    // An instruction waiting unread (frontdoor.js steerNote) takes the sentence's cell, in amber, age first: the cell cuts its end.
    l.steer && l.steer.row ? t("body", "needs", l.steer.row.short, "detail") : t("body", "ink2", l.sentence, "detail"), range, lbl(l.machineLabel, "ink2", "nowrap m"));
}
/* A log title fitted to the width its column had on the last frame (S.titleRoom, art px; frontdoor.js fitTitle): whole words,
   no bracket left open, never one word (the chip gives way first), and "title not reported" when there is none. */
function logTitle(l, room) {
  const fit = fitTitle(l.rowTitle, room, l.chip ? textW("label", l.chip.slice(0, 18)) + 4 : 0, x => textW("title_log", x));
  return { text: fit.text || L("title_not_reported"), chip: fit.chip };
}
function renderLog(B, g) {
  if (B.empty) return null;
  const el = h("section", Object.assign({ class: "zone log plate", style: zoneStyle(ZT().log) }, g.phone ? {} : seaDoor("gun-deck"), { "aria-label": L("log_title") }));
  const head = h("div", { class: "head" }, lbl(L("log_title"), "ink"));
  if (B.loading) { el.append(head, h("div", { class: "skels" }, h("div", { class: "skel" }), h("div", { class: "skel short" }), h("div", { class: "skel" }))); return el; }
  head.append(lbl(L("off_course", { n: B.off.length }), "ink2"));
  head.append(h("span", { class: "spacer" }),
    h("span", { class: "count" }, G("moving", "moving"), lbl(L("under_way", { n: B.underway.length + B.scouts.length }), "ink2")),
    h("span", { class: "count" }, G("mate", "ink2"), lbl(L("waiting_n", { n: B.waiting.length }) + (B.oldest ? ", " + L("oldest_t", { t: ageShort(B.oldest.inState) }) : ""), "ink2")),
    h("span", { class: "count" }, G("done", "done"), lbl(L("landed", { n: B.landed.length }), "ink2")));
  const list = h("div", { class: g.phone ? "lanes" : "ledger" + (S.logTight ? " tight" : "") + (S.logTight > 1 ? " tighter" : "") });
  // One list in the one order (frontdoor.js sortRows): a row that is off course keeps its full ink, the rest are calm.
  for (const l of g.phone ? B.off : B.shown) list.append(logRow(l, g, !g.phone && !offCourse(l)));
  if (!g.phone && B.more) list.append(h("div", { class: "row overflow" }, t("body", "ink2", B.more)));
  if (!B.off.length && (g.phone || !B.shown.length)) list.append(t("body", "ink2", L("log_empty"), "empty"));
  const strip = g.phone ? null : stripRow(B);
  if (strip) list.append(strip);
  const quota = g.phone ? null : allowanceRow();
  if (quota) list.append(quota);
  const tools = g.phone ? null : cardChips();
  if (tools) list.append(tools);
  const library = g.phone ? null : libraryRow(B);
  if (library) list.append(library);
  el.append(head, list);
  return el;
}
/* ---------- allowance: one chip per account in the log header (the phone lists them in full) ---------- */
/* The host's allowance chips (src/weatherdeck/allowance.py), in its fixed order: provider, account, window, percent left and
   reset time, fullest form first. A source whose meters collector went bad says unavailable, never an old number. */
function allowanceChips() {
  return ((S.view.meters || {}).chips || []).map(c => {
    const cs = collectorState(c.source, "meters"), bad = c.state === "unavailable" || (cs && cs.bad);
    const forms = bad ? [c.provider + (c.account ? " " + c.account : "") + " " + L("chip_unavailable"), c.provider + " " + L("chip_unavailable"), String(c.provider).slice(0, 3) + " ?"] : c.forms;
    const slot = bad ? "fog" : c.state === "out" ? "trouble" : c.state === "low" ? "ink" : "ink2";   // amber is for what needs action
    return Object.assign({}, c, { bad, forms, slot, title: c.sentence || forms[0] });
  });
}
/* As many chips as fit in `room` art px beside the other header words, each in the fullest form that lets all of
   them fit; in the shortest form the ones that do not fit fold into "+N". The order never changes with the numbers.
   -> { el, used } or null. */
function quotaChips(room) { return fitChips(allowanceChips().slice(0, 6), room); }
function fitChips(chips, room) {
  if (!chips.length) return null;
  const depth = Math.max(...chips.map(c => c.forms.length));
  for (let f = 0; f < depth; f++) {
    const texts = chips.map(c => c.forms[Math.min(f, c.forms.length - 1)]);
    const widths = texts.map((x, i) => textW("label", x) + (i ? 10 : 0));
    const total = widths.reduce((a, b) => a + b, 0);
    if (total <= room || f === depth - 1) {
      let used = 0, n = 0;
      while (n < chips.length && used + widths[n] <= room) used += widths[n++];
      if (n < chips.length && n > 0) { while (n > 0 && used + 10 + textW("label", "+" + (chips.length - n)) > room) used -= widths[--n]; }
      if (!n) return null;
      const more = chips.length - n;
      return { used, el: h("span", { class: "quota" }, chips.slice(0, n).map((c, i) => h("span", { class: "count", title: c.title }, lbl(texts[i], c.slot, "nowrap"))),
        more ? lbl("+" + more, "ink2", "nowrap") : null) };
    }
  }
  return null;
}
/* One chip in full words, for the phone and the Crow's nest: the account, its lowest window, what is left and when it resets. */
function chipLine(c) {
  if (c.bad) return [c.account, L("chip_unavailable")].filter(Boolean).join(" · ");
  return [c.account, L("chip_resets", { window: (c.window && (c.window.label || c.window.short)) || "", pct: c.left + "%", t: c.resets || "?" })].filter(Boolean).join(" · ");
}
/* The sentence about running out, from the source's own projection only (never worked out here from percentages). */
function chipNote(c) {
  if (c.bad) { const cs = collectorState(c.source, "meters"); return cs && cs.bad && !cs.error ? L("old", { t: age(cs.age) }) : ""; }
  if (c.sentence) return c.sentence;
  return c.projection && c.projection.status === "through_reset" ? L("chip_lasts", { window: (c.window && (c.window.label || c.window.short)) || "", t: c.resets || "?" }) : "";
}
/* The watch strip (model.js stripChips): one last row of the TV log, queues, outside waits, unshipped merges and what
   comes up, in the fullest words that fit. */
function stripRow(B) {
  if (!(B.strip || []).length) return null;
  const room = (ZT().log || { w: 600 }).w - 20 - textW("label", L("strip_head")) - 10;
  const fit = fitChips(B.strip.slice(0, 6), room);
  return fit ? h("div", { class: "toolsrow striprow" }, lbl(L("strip_head"), "ink2", "nowrap"), fit.el) : null;
}
/* The allowance row: one last row of the TV log, the chips in the fullest form that fits the row. */
function allowanceRow() {
  if (!allowanceChips().length) return null;
  const room = (ZT().log || { w: 600 }).w - 20 - textW("label", L("allowance")) - 10;
  const fit = quotaChips(room);
  return fit ? h("div", { class: "toolsrow quotarow" }, lbl(L("allowance"), "ink2", "nowrap"), fit.el) : null;
}
/* The library row (feed 1.10): one last row of the TV log, a chip per mirrored folder, worst first, each in the fullest words
   that fit ("main/ UP TO DATE · CHECKED 14 MIN AGO", then "main/ UP TO DATE"); the phone and the Crow's nest list them in full. */
function libraryRow(B) {
  if (!(B.library || []).length) return null;
  const room = (ZT().log || { w: 600 }).w - 20 - textW("label", L("library")) - 10;
  const fit = fitChips(B.library, room);
  return fit ? h("div", { class: "toolsrow libraryrow" }, lbl(L("library"), "ink2", "nowrap"), fit.el) : null;
}
/* ---------- tool cards: one last row of the log, a chip per card, worst first (the phone lists them in full) ---------- */
function cardChips() {
  const cards = cardStates().slice(0, 6);
  if (!cards.length) return null;
  const room = (ZT().log || { w: 600 }).w - 20 - textW("label", L("tools")) - 10;
  const forms = [c => c.title + (c.mode ? " " + c.mode : "") + " " + c.word, c => c.title.slice(0, 9) + (c.mode ? " " + c.mode : "") + " " + c.word, c => c.title + " " + c.word, c => c.title.slice(0, 8) + " " + c.word];
  for (const [i, form] of forms.entries()) {
    let used = 0;
    const fit = [];
    for (const c of cards) {
      const text = form(c), w = 12 + 4 + textW("label", text) + (fit.length ? 10 : 0);
      if (used + w <= room) { used += w; fit.push([c, text]); }
    }
    if (fit.length === cards.length || i === forms.length - 1) {
      const hidden = cards.length - fit.length;
      return h("div", { class: "toolsrow" }, lbl(L("tools"), "ink2", "nowrap"), fit.map(([c, text]) =>
        h("span", { class: "count", title: c.headline || c.title }, G(c.glyph, c.slot), lbl(text, c.slot, "nowrap"))),
        hidden ? lbl(L("more", { n: hidden }), "ink2", "nowrap") : null);
    }
  }
  return null;
}
/* ---------- the anchor: quiet hours with nothing waiting (9.8) ---------- */
function anchorLine(B) {
  const bits = [];
  if (B.off.length) bits.push(L("off_course", { n: B.off.length }));
  for (const m of B.machines) if (!["ok", "unknown"].includes(m.key)) bits.push(L("machine_is", { name: m.label, word: m.word.toLowerCase() }));
  const q = cfg().display.quiet_hours;
  return (bits.length ? cap(bits.join(", ")) + ". " : "") + (q && q.end ? L("quiet_until", { t: q.end }) : "");
}
function renderAnchor(B) {
  const z = ZT().anchor || {}, p = z.plate || { x: 140, y: 192, w: 360, h: 156 };
  const el = h("section", { class: "zone anchor plate", style: zoneStyle(p), "aria-label": L("rest_statement") },
    t("numeral_clock_rest", "clock", hm(B.now), "rest-clock"),
    t("statement", "ink", L("rest_statement")),
    t("body_quiet", "ink2", anchorLine(B), "clamp2"),
    h("div", { class: "line" }, lampPip(B.trust), lbl(B.trust.line1, "ink2")));
  return el;
}

/* ---------- hailing the host (9.9) ---------- */
function renderHail(B, g) {
  const z = scenePlates() ? ZT().hail : (ZT().hail || ZT().machines);
  const secs = Math.max(0, Math.ceil((S.retryAt - performance.now()) / 1000));
  const failFor = (performance.now() - (S.failSince ?? performance.now())) / 1000;
  const at = newestAt();
  const hs = ((S.theme.components || {}).hail || {}).sprite;
  const mark = hs ? sprite(hs, 3, "hail-mark" + (S.anim.strike ? " strike" : "")) : null;
  const big = S.trying ? t("label_lg", "ink", L("hail_trying"), "trying") : t("numeral_countdown", "ink", String(secs), "count");
  const el = h("section", { class: "zone hail plate" + (g.phone ? "" : " tv"), style: g.phone ? "" : zoneStyle(z), role: "status", "aria-label": L("hail_head") },
    lbl(L("hail_head"), "ink"), h("div", { class: "countrow" }, mark, big), lbl(L("hail_next"), "ink2"));
  if (!g.phone) el.append(lbl(L("no_answer") + " " + coarse(failFor).toUpperCase(), "ink2"));
  else {
    el.append(t("statement", "ink", L("hail_title")), h("dl", { class: "facts" },
      h("dt", null, lbl(L("no_answer"), "ink2")), h("dd", null, lbl(coarse(failFor), "ink")),
      h("dt", null, lbl(L("newest_data"), "ink2")), h("dd", null, t("body", "ink", at ? L("newest_value", { at: hm(at), t: coarse(nowS() - at) }) : "?")),
      h("dt", null, lbl(L("likely"), "ink2")), h("dd", null, t("body", "ink2", L("host_causes")))));
  }
  return el;
}

/* A queue's line: who waits and for how long, who holds it (the holders' own labels), in words. */
function queueSub(q) {
  const held = q.held != null ? (q.cap != null ? L("queue_held", { n: q.held, cap: q.cap }) : L("queue_held_n", { n: q.held })) : null;
  const wait = q.length ? (q.waitS != null ? L("queue_waits", { n: q.length, t: age(q.waitS) }) : L("queue_waits_n", { n: q.length })) : L("queue_clear");
  const who = (q.holders || []).filter(x => x.label).slice(0, 3).map(x => x.label + (x.s != null ? " " + age(x.s + Math.max(0, nowS() - S.srv0)) : "")).join(", ");
  return [wait, held, who, q.stale ? L("last_known") : null].filter(Boolean).join(" · ");
}
/* A deploy's line: how far behind, since when, and the two versions. */
function deploySub(d) {
  if (d.state === "unknown") return L("deploy_unknown") + (d.error ? ": " + d.error : "");
  if (d.state === "current") return L("deploy_current", { v: d.deployed || "?" });
  return [d.oldS != null ? L("deploy_oldest", { t: age(d.oldS) }) : null, L("deploy_versions", { deployed: d.deployed || "?", head: d.head || "?" })].filter(Boolean).join(" · ");
}

/* ---------- phone: everything else, scrolled to ---------- */
function renderMore(B) {
  if (B.loading || B.empty) return null;
  const v = S.view, el = h("div", { class: "more" });
  const sec = (title, ...kids) => h("section", { class: "plate" }, lbl(title, "ink2", "head"), ...kids);
  const laneList = ls => ls.length ? h("div", { class: "lanes" }, ls.map(l => logRow(l, { phone: true }))) : t("body", "ink2", L("none"));
  const item = (left, title, sub) => h("div", { class: "item" }, lbl(left, "ink2"), h("div", null, t("body", "ink", title), sub ? t("body", "ink2", sub) : null));
  if (B.oldest) el.append(h("section", { class: "plate oldest" }, lbl(L("oldest_waiting", { t: age(B.oldest.inState) }), "ink2"), t("body", "ink", (B.oldest.chip ? B.oldest.chip + " · " : "") + B.oldest.title)));
  el.append(sec(L("waiting_lanes"), laneList(B.waitingLanes.filter(l => l.cls === "needs_action"))));
  el.append(sec(L("under_way", { n: B.underway.length }), laneList(B.underway)));
  if (B.waiting.length) el.append(sec(L("waiting_n", { n: B.waiting.length }), laneList(B.waiting)));
  if (B.quietLanes.length) el.append(sec(L("count_unknown", { n: B.quietLanes.length }), laneList(B.quietLanes)));
  el.append(sec(L("scouting", { n: B.scouts.length }), laneList(B.scouts)));
  // Old records last and folded, as on the Lists page: each says why it is one, and none is counted above.
  if (B.oldRecords.length) el.append(h("details", { class: "plate hk" }, h("summary", null, lbl(L(B.oldRecords.length === 1 ? "hk_head_one" : "hk_head", { n: B.oldRecords.length }), "ink2", "head")),
    laneList(B.oldRecords)));

  if (B.outside.length) el.append(sec(L("outside_n", { n: B.outside.length }), B.outside.map(w => item(w.ageS != null ? age(w.ageS) : "?", w.title, [w.chip, w.who].filter(Boolean).join(" · ")))));
  if (B.queues.length) el.append(sec(L("queues"), B.queues.map(q => item(q.length != null ? String(q.length) : "?", q.label, queueSub(q)))));
  if (B.deploys.length) el.append(sec(L("shipping"), B.deploys.map(d => item(d.behind != null ? "−" + d.behind : "?", d.label, deploySub(d)))));
  if (B.library.length) el.append(sec(L("library"), B.library.map(r => h("div", { class: "item" }, G(r.glyph, r.slot), h("div", null,
    h("div", null, lbl(r.label, r.stale ? "fog" : "ink"), " ", lbl(r.word, r.slot)), [...r.ages, r.why].some(Boolean) ? t("body", "ink2", [...r.ages, r.why].filter(Boolean).join(" · ")) : null)))));
  if (B.software.length) el.append(sec(L("software"), B.software.map(w => item(w.adapter, srcName(w.s) + (w.s.station ? " · " + w.s.station : ""),
    [w.pusher, w.host ? L("runs_on", { host: w.host }) : null, ...w.skew].filter(Boolean).join(" · ")))));
  if (B.coming.length) el.append(sec(L("coming_up"), B.coming.map(c => item(dueWord(c.at, c.date_only, c.date), c.title, L("up_word_" + c.word)))));
  el.append(sec(landedWord(B) + " " + B.score.n, B.doneToday.length ? B.doneToday.map(d => item(hm(epoch(d.at)), d.title || d.id, [d.group, d.via].filter(Boolean).join(", "))) : t("body", "ink2", L("nothing_yet"))));
  if (B.next.length) {
    el.append(sec(L("ahead", { n: B.next.length }), B.next.map(n => item(words(n.kind || ""), n.title || n.id,
      n.until ? L("deferred_to", { d: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(n.until + "T12:00:00Z")) }) : n.reason))));
  }
  const cps = (v.groups || []).filter(gr => gr.checkpoint);
  if (cps.length) {
    el.append(sec(L("checkpoints"), cps.map(gr => {
      const cp = gr.checkpoint, nx = cp.next || {}, g = cp.gate || {}, gate = g.value || "unknown";
      const titles = (nx.waiting_on || []).map(id => ((v.items || []).find(i => i.id === id) || {}).title || id).join(", ");
      // The floor verdict record: the exact commit tested, a verdict per tier, what failed, and the ship line.
      const failing = (g.failing || []).length ? (g.failing.length > 3 ? L("failing_n", { n: g.failing.length }) : g.failing.join(", ")) : null;
      const verdict = [g.sha ? String(g.sha).slice(0, 12) : null, ...(g.tiers || []).map(x => L("tier_word", { tier: x.id, verdict: x.verdict || "?" })),
        failing, g.ship ? L("ship_line", { text: g.ship }) : null].filter(Boolean).join(" · ");
      return item(gr.label || gr.id, (nx.version || "?") + (titles ? " " + L("waits_on") + " " + titles : ""),
        ((cp.live || {}).version || "?") + " " + L("live_word") + ", " + L("gate") + " " + L(gate === "pass" ? "gate_pass" : gate === "fail" ? "gate_fail" : "gate_unknown") + (verdict ? ". " + verdict : ""));
    })));
  }
  const chips = allowanceChips();
  if (chips.length) el.append(sec(L("allowance"), chips.map(c => item(c.provider, chipLine(c), chipNote(c)))));
  const cards = cardStates();
  if (cards.length || v.cards_rejected) {
    el.append(sec(L("tools"), cards.map(c => h("div", { class: "item" }, G(c.glyph, c.slot), h("div", null,
      h("div", null, lbl(c.title, "ink"), " ", lbl(c.word, c.slot), c.mode ? lbl(" · " + c.mode, "ink2") : null),
      c.headline ? t("body", c.key === "stale" ? "ink2" : "ink", c.headline) : null,
      c.last ? t("body", "ink2", c.last) : null,
      c.numbers.length ? t("body", "ink2", c.numbers.join(" · ")) : null,
      c.link ? t("body", "ink2", c.link, "ellipsis") : null))),
      v.cards_rejected ? t("body", "ink2", L("card_rejected", { n: v.cards_rejected })) : null));
  }
  el.append(sec(L("machines"), B.machines.map(m => h("div", { class: "item" }, G(m.pip, m.slot), h("div", null,
    h("div", null, lbl(m.label, "ink"), " ", lbl(m.word, m.slot)), t("body", "ink2", [m.role, ...m.vitals.map(x => x.text)].filter(Boolean).join(" · ")))))));
  el.append(sec(L("sources"), (v.sources || []).map(s => {
    const lv = srcLevel(s);
    return item(lv === "absent" ? L("src_absent") : L("src_" + lv), srcName(s), s.placeholder ? s.reason : (sourceSay(s).line || L("last_report", { t: age(srcAge(s)) })) + (s.rejected ? ". " + L("rejected_since", { name: "", t: hm(s.rejected.since), reason: s.rejected.reason }).trim() : ""));
  }), S.server.host ? t("body", "ink2", L("served_by", { host: S.server.host })) : null));
  const tl = ((v.history || {}).timeline || []).slice(0, 12);
  if (tl.length) el.append(sec(L("timeline"), tl.map(e => item(hm(e.at), e.text || "", (cfg().labels.event_kinds || {})[e.kind] || cap(words(e.kind))))));
  el.append(sec(L("key_title"), legendBody(true)));
  return el;
}

/* ---------- at a glance: what changed since this screen last looked (model.js glanceNow) ---------- */
function renderSince(B, g) {
  const d = B.since;
  if (!d || B.loading || B.empty || B.hostdown || B.anchor) return null;
  const w = sinceWords(d), z = ZO(B, "since");
  const ok = h("button", { type: "button", class: "since-ok", "data-glance": "seen", "aria-label": L("since_ok") + ": " + L("since_label") }, lbl(L("since_ok"), "ink"));
  if (g.phone) return h("section", { class: "zone since plate", "aria-label": L("since_label") }, h("div", { class: "line" }, lbl(w.head, "ink2"), ok), t("body", "ink", w.parts.join(", ")));
  if (!z) return null;
  // The head in the fullest words that fit beside its button: "Since you looked 3 h ago", else "Since 3 h ago".
  const room = z.w - 16 - textW("label", L("since_ok")) - 14;
  const head = textW("label", w.head) <= room ? w.head : w.short;
  return h("section", { class: "zone since plate", style: zoneStyle(z), "aria-label": L("since_label") },
    lbl(head, "ink2", "nowrap ellipsis head"), ok, t("body", "ink", w.parts.join(" · "), "ellipsis parts"));
}
/* ---------- the first visit: one hint, once per browser, that the ship (or every plate) opens its places ---------- */
const HINT_KEY = "weatherdeck.hint";
const HINT = { seen: null, shownFor: 0, last: 0 };
function hintSeen() {
  if (HINT.seen == null) { try { HINT.seen = localStorage.getItem(HINT_KEY) === "seen"; } catch (e) { HINT.seen = false; } }
  return HINT.seen;
}
function hintDone() {
  HINT.seen = true;
  try { localStorage.setItem(HINT_KEY, "seen"); } catch (e) { /* blocked: it stays gone for this page only */ }
}
function renderFirstHint(B, g) {
  const c = Object.assign({ enabled: true, show_s: 180 }, cfg().display.hint || {});
  // Never on the TV layout: a TV or a wall screen has no pointer and often no remote, so a "Got it" there would stay over the
  // sea for good. The key (?) still explains the board there; the phone keeps its one tap hint.
  if (!g.phone) return null;
  if (!c.enabled || hintSeen() || B.loading || B.empty || B.hostdown || B.anchor || B.lost || (B.critical || []).length) { HINT.last = 0; return null; }
  // Shown for show_s seconds of looking (a wall screen nobody touches), then never again on this browser.
  const now = performance.now();
  if (HINT.last && !document.hidden) HINT.shownFor += Math.min(5000, now - HINT.last);
  HINT.last = now;
  if (HINT.shownFor > c.show_s * 1000) { hintDone(); return null; }
  const title = L("hint_title_phone"), body = L("hint_body_phone");
  const ok = h("button", { type: "button", class: "hint-ok", "data-hint": "done" }, lbl(L("hint_ok"), "ink"));
  return h("section", { class: "zone hint plate phone", role: "note", "aria-label": title },
    h("i", { class: "tail", "aria-hidden": "true" }), t("label", "ink", title, "nowrap"), t("body", "ink2", body), ok);
}
/* ---------- the key: a small legend plate, opened from its button or with "?" ---------- */
const KEY_ROWS = [["needs", "needs", "key_needs"], ["approve", "needs", "key_approve"], ["failed", "trouble", "key_failed"], ["blocked", "ink", "key_blocked"],
  ["long", "ink", "key_long"], ["moving", "moving", "key_moving"], ["mate", "ink2", "key_mate"], ["done", "done", "key_done"], ["silent", "fog", "key_silent"], ["asleep", "fog", "key_asleep"]];
const SCENE_KEYS = ["fleet", "islands", "windows", "lighthouse", "becalmed", "livery"];
/* One line per creature kind: its name, what it means, then when it last came to this screen and the report that brought
   it (world.js WORLD.last, sightings.js), or that it has not come yet; an event that was only told in words says so. */
function seenLines(phone) {
  return SIGHT_KINDS.map(k => {
    const e = (WORLD.last || {})[k];
    const when = !e ? L("seen_never") : [dayHm(e.at), e.text, e.status === "words" && e.why ? L("seen_words", { why: e.why }) : null,
      e.status === "merged" && e.why ? L("seen_merged", { why: e.why }) : null].filter(Boolean).join(" · ");
    return h("div", { class: "seen" }, lbl(L("lg_" + k), "ink2", "nowrap kind"), t("body", e ? "ink" : "ink2", L("seen_mean_" + k) + " · " + when, phone ? "" : "ellipsis when"));
  });
}
/* A time with its day when it is not today: "14:02", "yesterday 14:02", "Tue 14:02". */
const dayHm = at => (dayKey(at) === dayKey(nowS()) ? hm(at) : dayKey(at) === dayKey(nowS() - 86400) ? L("day_yesterday") + " " + hm(at) : wkhm(at));
/* The replay button (also the R key): plays the newest real event again; greyed with none. */
function replayButton(phone) {
  const can = !!replayPick(WORLD.log, WORLD.gulls);
  return h("button", { type: "button", class: "key-replay", "data-key": "replay", disabled: can ? null : true, "aria-label": can ? L("replay_button") + " (" + L("replay_key") + ")" : L("replay_none") },
    lbl(can ? L("replay_button") + (phone ? "" : " (" + L("replay_key") + ")") : L("replay_none"), can ? "ink" : "ink2", "nowrap"));
}
function legendBody(phone) {
  const keys = h("div", { class: "keys" }, KEY_ROWS.map(([gl, slot, k]) => h("div", { class: "key" }, G(gl, slot, gl === "silent" ? { dither: true } : undefined), t("body", "ink", L(k)))));
  const never = t("body", "ink2", L("key_never_colour"));
  if (!S.theme.scene) return h("div", { class: "legend-body" }, keys, never);
  const sea = [lbl(L("key_scene"), "ink2", "sub"), t("body", "ink", SCENE_KEYS.map(k => L("key_sc_" + k)).join(" · "), phone ? "" : "scene-keys")];
  const seen = [lbl(L("seen_head"), "ink2", "sub"), ...seenLines(phone)];
  if (phone) return h("div", { class: "legend-body" }, keys, ...sea, ...seen, replayButton(true), never);
  return h("div", { class: "legend-body two" }, h("div", { class: "col" }, keys, ...sea), h("div", { class: "col" }, ...seen, never));
}
function renderKey(B, g) {
  const z = ZT().key;
  if (g.phone || !z || B.loading || B.empty || B.anchor) return null;
  return h("button", { type: "button", class: "zone keybtn plate", style: zoneStyle(z), "data-key": "toggle", "aria-expanded": String(!!S.legendOpen), "aria-controls": "legend" },
    lbl("?", "ink"), h("span", { class: "sr" }, L("key_title")));
}
function renderLegend(B, g) {
  const z = ZT().legend;
  if (!S.legendOpen || g.phone || !z || B.loading || B.empty || B.anchor) return null;
  return h("section", { class: "zone legend plate", style: zoneStyle(z), role: "dialog", "aria-label": L("key_title") },
    h("div", { class: "lhead" }, lbl(L("key_title"), "ink"), h("span", { class: "spacer" }), S.theme.scene ? replayButton(false) : null,
      h("button", { type: "button", class: "key-close", "data-key": "close", "aria-label": L("key_close") }, lbl(L("close_word"), "ink"))), legendBody(false));
}
