const MAX_MISTAKES = 5;
const VALID_MISTAKE_TYPES = new Set(["grammar", "vocabulary", "content", "structure", "form", "coherence"]);

// criteria/mistakes are diagnostic detail, not the authoritative result (score/strengths/
// improvements/overall already are, and are validated exactly as before). A missing or malformed
// criteria/mistakes field degrades that one field to null/empty rather than failing the whole
// evaluation — losing the mistake breakdown is not the same as fabricating a score.
function sanitizeCriteria(raw, allowedKeys) {
  if (!raw || typeof raw !== "object" || !Array.isArray(allowedKeys) || !allowedKeys.length) return null;
  const out = {};
  for (const key of allowedKeys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.max(0, Math.min(100, Math.round(value)));
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeMistakes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => m && typeof m === "object" && typeof m.problem === "string" && m.problem.trim())
    .slice(0, MAX_MISTAKES)
    .map(m => ({
      type: VALID_MISTAKE_TYPES.has(m.type) ? m.type : "other",
      studentText: typeof m.studentText === "string" ? m.studentText.trim().slice(0, 300) : "",
      problem: m.problem.trim().slice(0, 300),
      correction: typeof m.correction === "string" ? m.correction.trim().slice(0, 300) : "",
      explanation: typeof m.explanation === "string" ? m.explanation.trim().slice(0, 400) : ""
    }));
}

// Validates and normalizes a structured AI response before it's ever trusted. A malformed or
// empty response is rejected outright — the caller must treat that as a FAILED evaluation, never
// silently substitute a fabricated score. criteriaKeys (Phase 16, B2) is task-specific — see
// prompts.js's TASK_INFO — never a fixed set applied to every task.
export function validateAiResult(raw, maxScore = 90, criteriaKeys = []) {
  if (!raw || typeof raw !== "object") return { valid: false, reason: "response was not a JSON object" };
  if (typeof raw.score !== "number" || !Number.isFinite(raw.score)) {
    return { valid: false, reason: "score missing or not a number" };
  }

  const score = Math.max(0, Math.min(maxScore, Math.round(raw.score)));
  const strengths = Array.isArray(raw.strengths) ? raw.strengths.filter(s => typeof s === "string" && s.trim()).slice(0, 5) : [];
  const improvements = Array.isArray(raw.improvements) ? raw.improvements.filter(s => typeof s === "string" && s.trim()).slice(0, 5) : [];
  const overall = typeof raw.overall === "string" ? raw.overall.trim().slice(0, 600) : "";

  if (!strengths.length && !improvements.length && !overall) {
    return { valid: false, reason: "no usable feedback content in the response" };
  }

  const criteria = sanitizeCriteria(raw.criteria, criteriaKeys);
  const mistakes = sanitizeMistakes(raw.mistakes);

  return { valid: true, score, maxScore, strengths, improvements, overall, criteria, mistakes };
}
