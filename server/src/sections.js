// The four practice sections, in display order. The one list every section-aware piece of the
// server reads — per-section access (utils/subscription.js), the mock test's paper
// (routes/testSessions.js) and the admin purchase routes — so they can never disagree about what
// a "section" is.
export const SECTIONS = ["speaking", "writing", "reading", "listening"];

export function isSection(value) {
  return SECTIONS.includes(value);
}

/**
 * Validates a `sections` value from a request body.
 *
 * Returns { sections } — de-duplicated and in SECTIONS order, so the same purchase is always stored
 * the same way however the admin's form happened to order it — or { error } for anything that is
 * not a non-empty list of real section names. `undefined` is passed through as { sections: null }
 * so a caller can tell "not specified, use your default" apart from a bad value.
 */
export function parseSections(value) {
  if (value === undefined || value === null) return { sections: null };
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "Choose at least one section." };
  }
  const unknown = value.filter(v => !isSection(v));
  if (unknown.length) {
    return { error: `Unknown section: ${unknown.join(", ")}.` };
  }
  return { sections: SECTIONS.filter(s => value.includes(s)) };
}
