import { describe, it, expect } from "vitest";
import {
  pct, scored, summarize, trajectory, improvement, changeOverDays,
  byTaskType, bySection, focusAreas, skillBalance, targetGap, formatDuration,
  pteScaled, ptePerformance,
  MIN_FOR_TREND, MIN_FOR_TASK_STAT
} from "../src/analytics/derive.js";

// The contract these pin is the one that matters for trust: every figure traces back to a real
// submission, and anything the data cannot support comes back null so the UI shows an empty
// state instead of a confident-looking number.

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const sub = (over = {}) => ({
  section: "reading", type: "mcq-single", score: 5, maxScore: 10,
  evaluationStatus: "COMPLETED", createdAt: day(1), ...over
});

describe("pct", () => {
  it("scales a score against its own maxScore", () => {
    expect(pct(sub({ score: 3, maxScore: 4 }))).toBe(75);
  });
  it("returns null rather than 0 when there is no usable scale", () => {
    expect(pct(sub({ maxScore: 0 }))).toBeNull();
    expect(pct(sub({ score: undefined }))).toBeNull();
    expect(pct(null)).toBeNull();
  });
});

describe("scored", () => {
  it("excludes attempts that were never evaluated, so they cannot drag an average down", () => {
    const rows = [sub(), sub({ evaluationStatus: "PENDING" }), sub({ evaluationStatus: "FAILED" })];
    expect(scored(rows)).toHaveLength(1);
  });
});

describe("summarize", () => {
  it("reports average, best and worst from scored attempts only", () => {
    const s = summarize([
      sub({ score: 4, maxScore: 10 }), sub({ score: 8, maxScore: 10 }),
      sub({ score: 6, maxScore: 10 }), sub({ score: 9, maxScore: 10, evaluationStatus: "FAILED" })
    ]);
    expect(s.attempts).toBe(3);
    expect(s.average).toBe(60);
    expect(s.best).toBe(80);
    expect(s.worst).toBe(40);
  });

  it("gives null, not zero, for a student who has not started", () => {
    const s = summarize([]);
    expect(s.attempts).toBe(0);
    expect(s.average).toBeNull();
    expect(s.best).toBeNull();
    expect(s.totalSeconds).toBeNull();
  });

  it("counts timed attempts separately, since many objective rows carry no duration", () => {
    const s = summarize([sub({ durationSeconds: 30 }), sub(), sub({ durationSeconds: 90 })]);
    expect(s.attempts).toBe(3);
    expect(s.timedAttempts).toBe(2);
    expect(s.totalSeconds).toBe(120);
    expect(s.averageSeconds).toBe(60);
  });
});

describe("trajectory", () => {
  it("returns points oldest-first", () => {
    const rows = [
      sub({ score: 9, maxScore: 10, createdAt: day(1) }),
      sub({ score: 5, maxScore: 10, createdAt: day(9) }),
      sub({ score: 7, maxScore: 10, createdAt: day(5) }),
      sub({ score: 8, maxScore: 10, createdAt: day(3) })
    ];
    expect(trajectory(rows)).toEqual([50, 70, 80, 90]);
  });

  it("refuses to draw a trend from too few attempts", () => {
    expect(trajectory([sub(), sub()])).toBeNull();
    expect(trajectory(Array.from({ length: MIN_FOR_TREND }, () => sub()))).not.toBeNull();
  });
});

describe("improvement", () => {
  it("compares the first third with the last third", () => {
    const rows = [30, 40, 50, 60, 70, 90].map((v, i) =>
      sub({ score: v, maxScore: 100, createdAt: day(10 - i) }));
    // Thirds, not first-vs-last: with 6 points that is mean(30,40) against mean(70,90). One
    // unusually good or bad attempt at either end therefore cannot define the whole trend.
    const result = improvement(rows);
    expect(result.from).toBe(35);
    expect(result.to).toBe(80);
    expect(result.delta).toBe(45);
    expect(result.points).toBe(6);
  });
  it("is null when there is not enough history", () => {
    expect(improvement([sub(), sub()])).toBeNull();
  });
});

describe("changeOverDays", () => {
  it("needs attempts on both sides of the window", () => {
    const recent = [sub({ score: 9, maxScore: 10, createdAt: day(1) }), sub({ score: 8, maxScore: 10, createdAt: day(2) })];
    // Nothing older than the window — no baseline, so no claim.
    expect(changeOverDays(recent, 7)).toBeNull();

    const withBaseline = [...recent, sub({ score: 4, maxScore: 10, createdAt: day(40) })];
    const result = changeOverDays(withBaseline, 7);
    expect(result.delta).toBe(45);
    expect(result.sample).toBe(2);
  });
});

describe("byTaskType", () => {
  it("groups by type, weakest first, and flags which averages are reliable", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => sub({ type: "reorder", score: 4, maxScore: 10 })),
      ...Array.from({ length: 3 }, () => sub({ type: "mcq-single", score: 9, maxScore: 10 })),
      sub({ type: "fib-dropdown", score: 10, maxScore: 10 })
    ];
    const result = byTaskType(rows);
    expect(result[0].type).toBe("reorder");
    expect(result[0].average).toBe(40);
    expect(result.find(r => r.type === "reorder").reliable).toBe(true);
    // One attempt is not a task-type average worth ranking on.
    expect(result.find(r => r.type === "fib-dropdown").reliable).toBe(false);
  });
});

describe("focusAreas", () => {
  it("only recommends task types with enough attempts to mean something", () => {
    const rows = [
      ...Array.from({ length: MIN_FOR_TASK_STAT }, () => sub({ type: "reorder", score: 3, maxScore: 10 })),
      ...Array.from({ length: MIN_FOR_TASK_STAT }, () => sub({ type: "mcq-single", score: 9, maxScore: 10 })),
      sub({ type: "write-dictation", score: 1, maxScore: 10 })   // worst, but a single attempt
    ];
    const areas = focusAreas(rows);
    expect(areas.map(a => a.type)).toContain("reorder");
    expect(areas.map(a => a.type)).not.toContain("write-dictation");
    // Each recommendation carries the gap that justifies it.
    expect(areas[0].gap).toBeGreaterThan(0);
  });

  it("recommends nothing at all when there is not enough to compare", () => {
    expect(focusAreas([sub(), sub()])).toEqual([]);
  });
});

describe("bySection and skillBalance", () => {
  it("reports null averages for sections never attempted", () => {
    const result = bySection([sub({ section: "reading", score: 8, maxScore: 10 })]);
    expect(result.find(r => r.section === "reading").average).toBe(80);
    expect(result.find(r => r.section === "speaking").average).toBeNull();
    expect(result.find(r => r.section === "speaking").attempts).toBe(0);
  });

  it("names the strongest and weakest only once two sections have data", () => {
    expect(skillBalance([sub({ section: "reading" })])).toBeNull();
    const balance = skillBalance([
      sub({ section: "reading", score: 9, maxScore: 10 }),
      sub({ section: "speaking", score: 5, maxScore: 10 })
    ]);
    expect(balance.strongest.section).toBe("reading");
    expect(balance.weakest.section).toBe("speaking");
    expect(balance.spread).toBe(40);
  });
});

describe("targetGap", () => {
  it("reports distance to target in both directions", () => {
    expect(targetGap(82, 79)).toMatchObject({ gap: 3, met: true });
    expect(targetGap(70, 79)).toMatchObject({ gap: -9, met: false });
  });
  it("is null without a current average", () => {
    expect(targetGap(null, 79)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats and refuses nonsense", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
  });
});

describe("PTE-scale performance is kept apart from accuracy", () => {
  // Objective attempts are raw marks (1/1 is 100% accurate, not a score of 100); AI-evaluated
  // speaking and writing are stored on the real 0-90 scale. Only the latter may be compared
  // with a target.
  const objective = (over = {}) => sub({ score: 1, maxScore: 1, section: "reading", ...over });
  const ai = (score) => sub({ score, maxScore: 90, section: "writing", type: "essay", evaluationType: "subjective" });

  it("selects only attempts stored on the 90-point scale", () => {
    const rows = [objective(), objective(), ai(70), ai(80)];
    expect(pteScaled(rows)).toHaveLength(2);
  });

  it("averages those on their own scale, never as percentages", () => {
    const result = ptePerformance([objective(), ai(70), ai(80)]);
    expect(result.average).toBe(75);   // not (100 + 78 + 89) / 3
    expect(result.best).toBe(80);
    expect(result.enough).toBe(true);
  });

  it("refuses to estimate from a single AI-scored attempt", () => {
    const result = ptePerformance([objective(), objective(), ai(80)]);
    expect(result.average).toBeNull();
    expect(result.best).toBeNull();
    expect(result.enough).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it("gives null, not zero, when nothing has been AI-scored at all", () => {
    expect(ptePerformance([objective(), objective()]).average).toBeNull();
  });

  it("a target gap is only ever computed against the PTE-scale average", () => {
    const rows = [objective(), objective(), ai(70), ai(80)];
    // Accuracy across everything is much higher than the PTE average, which is exactly why the
    // two must not be mixed: the gap against a target of 90 is -15, not -40.
    expect(summarize(rows).average).toBeGreaterThan(ptePerformance(rows).average);
    expect(targetGap(ptePerformance(rows).average, 90)).toMatchObject({ gap: -15, met: false });
  });
});
