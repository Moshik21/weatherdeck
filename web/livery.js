"use strict";
/* Livery (docs/theme-spec.md section 25): which machine a ship is, at a distance. Pure: plain data in, plain data out.
   The one real field is machines[].id. A ship's tone is one of the theme's six fixed muted tones, picked by the FNV-1a
   hash of the id modulo six, so a machine keeps its colour; it takes no state, no name text and no clock. A missing id
   (or a theme without six tones) draws no livery: never a guess. tests/test_livery.py runs this file in Node. */

const LIVERY_TONES = 6;

/* FNV-1a, 32 bit, over the UTF-16 units of the id. */
function liveryHash(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/* The tone index (0 to 5) for a machine id, or null when the id is missing. */
function liveryIndex(id) {
  return id == null || id === "" ? null : liveryHash(id) % LIVERY_TONES;
}

/* The tone for a machine id from a theme's six tones, or null (no livery drawn). */
function liveryTone(id, tones) {
  const i = liveryIndex(id);
  return i == null || !Array.isArray(tones) || tones.length !== LIVERY_TONES ? null : tones[i] || null;
}

/* What a ship of a role carries: the flagship a hull stripe and a pennant; an escort (full scale or small) a larger
   pennant and no stripe. */
function liveryMarks(role) {
  return role === "escort" ? { stripe: false, pennant: 5 } : { stripe: true, pennant: 4 };
}

if (typeof module !== "undefined") module.exports = { LIVERY_TONES, liveryHash, liveryIndex, liveryTone, liveryMarks };
