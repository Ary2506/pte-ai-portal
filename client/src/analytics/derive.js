// Derived performance analytics.
//
// Every function here takes submissions the API already returned and computes something from
// them. Nothing invents a number, and nothing is allowed to imply more certainty than the data
// supports: each function that needs a minimum sample says so, and returns null below it rather
// than producing a confident-looking figure from two attempts.
//
// `null` from anything here means "not enough data to say" and the UI must render an empty state
// for it. It never means zero.

export const MIN_FOR_TREND = 4;      // a direction needs enough points to not be noise
export const MIN_FOR_TASK_STAT = 3;  // a per-task-type average below this is one bad day

/** Percentage score for one submission, or null when it carries no usable scale. */
export function pct(submission) {
  const max = Number(submission?.maxScore);
  const score = Number(submission?.score);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(score)) return null;
  return Math.round((score / max) * 100);
}

/** Only attempts that were actually scored. A PENDING or FAILED evaluation has no score to average. */
export function scored(submissions) {
  return (submissions || []).filter(s => s?.evaluationStatus === "COMPLETED" && pct(s) !== null);
}

/** Oldest-first, so any series reads left to right as time. */
export function chronological(submissions) {
  return [...(submissions || [])].sort(
    (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

const mean = (nums) => (nums.length ? Math.round(nums.reduce((a, n) => a + n, 0) / nums.length) : null);

/**
 * Headline figures over a set of attempts. Every field is null when it cannot be computed,
 * so a caller cannot accidentally render 0% accuracy for a student who has not started.
 */
export function summarize(submissions) {
  const rows = scored(submissions);
  const scores = rows.map(pct);
  const durations = rows.map(s => Number(s.durationSeconds)).filter(n => Number.isFinite(n) && n > 0);

  return {
    attempts: rows.length,
    average: mean(scores),
    best: scores.length ? Math.max(...scores) : null,
    worst: scores.length ? Math.min(...scores) : null,
    // Total seconds actually recorded. Many objective attempts carry no duration, so this is
    // explicitly "time we measured", not "time spent" — the caller labels it that way.
    timedAttempts: durations.length,
    totalSeconds: durations.length ? durations.reduce((a, n) => a + n, 0) : null,
    averageSeconds: durations.length ? Math.round(durations.reduce((a, n) => a + n, 0) / durations.length) : null
  };
}

/**
 * Score series oldest-first, for a trend chart. Null below MIN_FOR_TREND points: a line through
 * two dots is a line, but it is not a trend, and drawing one invites the student to read a
 * direction that is not there.
 */
export function trajectory(submissions, { min = MIN_FOR_TREND } = {}) {
  const points = chronological(scored(submissions)).map(pct);
  return points.length >= min ? points : null;
}

/**
 * Change between the first and last thirds of a series, which is steadier than first-vs-last.
 * Null when there is not enough to compare.
 */
export function improvement(submissions, { min = MIN_FOR_TREND } = {}) {
  const points = trajectory(submissions, { min });
  if (!points) return null;
  const slice = Math.max(1, Math.floor(points.length / 3));
  const early = mean(points.slice(0, slice));
  const late = mean(points.slice(-slice));
  if (early === null || late === null) return null;
  return { delta: late - early, from: early, to: late, points: points.length };
}

/** Change over a rolling window, or null when either side of the window is empty. */
export function changeOverDays(submissions, days) {
  const rows = scored(submissions);
  const cutoff = Date.now() - days * 86400000;
  const within = rows.filter(s => new Date(s.createdAt).getTime() >= cutoff).map(pct);
  const before = rows.filter(s => new Date(s.createdAt).getTime() < cutoff).map(pct);
  if (within.length < 2 || !before.length) return null;
  return { days, delta: mean(within) - mean(before), sample: within.length };
}

/**
 * Per-task-type performance. `label` prefers the question's own title where the API populated
 * one, falling back to the raw type so a row is never blank.
 */
export function byTaskType(submissions, { min = MIN_FOR_TASK_STAT } = {}) {
  const groups = new Map();
  for (const s of scored(submissions)) {
    const key = s.type || "unknown";
    if (!groups.has(key)) groups.set(key, { type: key, section: s.section, scores: [], attempts: 0 });
    const group = groups.get(key);
    group.scores.push(pct(s));
    group.attempts += 1;
  }
  return [...groups.values()]
    .map(g => ({
      type: g.type,
      section: g.section,
      attempts: g.attempts,
      average: mean(g.scores),
      best: Math.max(...g.scores),
      // Below the threshold the average is shown but never used to rank or to recommend —
      // see focusAreas, which filters on this.
      reliable: g.attempts >= min
    }))
    .sort((a, b) => a.average - b.average);
}

/** Per-section rollup from the same rows, so section and task views can never disagree. */
export function bySection(submissions) {
  const sections = ["speaking", "writing", "reading", "listening"];
  const rows = scored(submissions);
  return sections.map(section => {
    const mine = rows.filter(s => s.section === section);
    const scores = mine.map(pct);
    return {
      section,
      attempts: mine.length,
      average: mean(scores),
      best: scores.length ? Math.max(...scores) : null,
      trend: improvement(mine)
    };
  });
}

/**
 * The weakest task types worth acting on — the basis of "what to practise next".
 *
 * Only types with enough attempts to be meaningful are eligible, and each one is reported with
 * the gap that justifies it, so the UI states a reason drawn from data rather than asserting an
 * insight. Returns [] when nothing qualifies, which is the honest answer early on.
 */
export function focusAreas(submissions, { limit = 3 } = {}) {
  const types = byTaskType(submissions).filter(t => t.reliable);
  if (types.length < 2) return [];
  const overall = mean(types.map(t => t.average));
  return types
    .filter(t => t.average < overall)
    .slice(0, limit)
    .map(t => ({ ...t, gap: overall - t.average, comparedWith: overall }));
}

/** Strongest and weakest sections, or null when fewer than two sections have been attempted. */
export function skillBalance(submissions) {
  const withData = bySection(submissions).filter(s => s.average !== null);
  if (withData.length < 2) return null;
  const sorted = [...withData].sort((a, b) => b.average - a.average);
  return {
    strongest: sorted[0],
    weakest: sorted[sorted.length - 1],
    spread: sorted[0].average - sorted[sorted.length - 1].average,
    sections: withData
  };
}

/** Distance to the student's own target. Null when there is nothing to compare. */
export function targetGap(average, targetScore) {
  if (average === null || average === undefined || !Number.isFinite(Number(targetScore))) return null;
  const target = Number(targetScore);
  return { target, current: average, gap: average - target, met: average >= target };
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function titleCase(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}
