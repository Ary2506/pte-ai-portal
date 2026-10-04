import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  pct, scored, summarize, bySection, byTaskType, skillBalance, ptePerformance, formatRaw,
  PTE_MAX_SCORE
} from "../src/analytics/derive.js";
import { ScoreRing, SkillSpectrum } from "../src/components/analytics.jsx";

// No analytics figure may exceed its own maximum — no percentage over 100, no "100/90".
//
// Scores are clamped at the model now, but rows written before that are still in the database
// and every derived figure is a sum or mean over them. A single out-of-range row does not render
// as one odd cell: it lifts a section average, a best, a trend, a bar width and a ring all at
// once, and a student who sees 111% has no reason to trust the other numbers either.
//
// Everything here feeds deliberately out-of-range submissions through the real derivations.

function row(score, maxScore, extra = {}) {
  return {
    score, maxScore, evaluationStatus: "COMPLETED", section: "writing", type: "essay",
    createdAt: "2026-01-01T00:00:00.000Z", ...extra
  };
}

/** Rows no honest scorer would produce, which is the point. */
const OVER = [row(100, 90), row(140, 90), row(95, 90)];

describe("pct — the chokepoint every percentage flows through", () => {
  it("never returns more than 100", () => {
    expect(pct(row(100, 90))).toBe(100);
    expect(pct(row(9999, 1))).toBe(100);
  });

  it("never returns less than 0", () => {
    expect(pct(row(-50, 90))).toBe(0);
  });

  it("leaves an honest score alone", () => {
    expect(pct(row(45, 90))).toBe(50);
    expect(pct(row(0, 90))).toBe(0);
    expect(pct(row(90, 90))).toBe(100);
  });

  it("still returns null for a submission with no usable scale", () => {
    expect(pct(row(5, 0))).toBeNull();
    expect(pct(null)).toBeNull();
  });
});

describe("every derived figure inherits the ceiling", () => {
  it("summarize: average, best and worst all stay within range", () => {
    const stats = summarize(OVER);
    expect(stats.average).toBeLessThanOrEqual(100);
    expect(stats.best).toBeLessThanOrEqual(100);
    expect(stats.worst).toBeGreaterThanOrEqual(0);
  });

  it("bySection: a section average never exceeds 100", () => {
    for (const section of bySection(OVER)) {
      if (section.average !== null) expect(section.average).toBeLessThanOrEqual(100);
      if (section.best !== null) expect(section.best).toBeLessThanOrEqual(100);
    }
  });

  it("byTaskType: a task-type average never exceeds 100", () => {
    const rows = byTaskType([...OVER, row(120, 90), row(130, 90)], { min: 1 });
    expect(rows.length).toBeGreaterThan(0);
    for (const task of rows) expect(task.average).toBeLessThanOrEqual(100);
  });

  it("skillBalance: strongest, weakest and the spread between them stay in range", () => {
    const mixed = [...OVER, row(200, 90, { section: "reading" }), row(180, 90, { section: "reading" })];
    const balance = skillBalance(mixed);
    expect(balance).toBeTruthy();
    expect(balance.strongest.average).toBeLessThanOrEqual(100);
    expect(balance.weakest.average).toBeGreaterThanOrEqual(0);
    expect(balance.spread).toBeLessThanOrEqual(100);
  });

  it("ptePerformance: an average on the PTE scale never exceeds 90", () => {
    const performance = ptePerformance(OVER);
    expect(performance.enough).toBe(true);
    expect(performance.average).toBeLessThanOrEqual(PTE_MAX_SCORE);
    expect(performance.best).toBeLessThanOrEqual(PTE_MAX_SCORE);
  });

  it("scored still keeps the rows — clamping is not the same as discarding them", () => {
    expect(scored(OVER)).toHaveLength(3);
  });
});

describe("formatRaw — the one formatter for a score out of its maximum", () => {
  it("never prints a score above its maximum", () => {
    expect(formatRaw(100, 90)).toBe("90/90");
    expect(formatRaw(-5, 90)).toBe("0/90");
  });

  it("leaves an honest pair alone", () => {
    expect(formatRaw(15, 90)).toBe("15/90");
    expect(formatRaw(0, 7)).toBe("0/7");
  });

  it("returns a dash rather than NaN when there is nothing to show", () => {
    expect(formatRaw(undefined, 90)).toBe("—");
    expect(formatRaw(5, null)).toBe("—");
    expect(formatRaw(null, null)).toBe("—");
  });

  it("keeps 0/0, which is a real result and not missing data", () => {
    // A mock section the student answered nothing in genuinely scored 0 out of 0.
    expect(formatRaw(0, 0)).toBe("0/0");
  });
});

describe("the components that draw these figures", () => {
  it("ScoreRing prints the clamped value, not the raw one", () => {
    render(<ScoreRing value={100} max={90} caption="Overall"/>);
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.queryByText("100")).not.toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("90 out of 90");
  });

  it("ScoreRing's arc never draws past a full circle", () => {
    const { container } = render(<ScoreRing value={500} max={90}/>);
    const arc = container.querySelector(".score-ring__arc");
    const [drawn, circumference] = arc.getAttribute("stroke-dasharray").split(" ").map(Number);
    expect(drawn).toBeLessThanOrEqual(circumference + 0.001);
  });

  it("SkillSpectrum caps both the bar and the number beside it", () => {
    const { container } = render(<SkillSpectrum sections={[
      { section: "writing", average: 160, attempts: 3 },
      { section: "reading", average: 40, attempts: 2 }
    ]}/>);
    const fill = container.querySelector(".skill-row__fill");
    expect(fill.style.width).toBe("100%");
    const values = [...container.querySelectorAll(".skill-row__value")].map(n => n.textContent);
    expect(values).toContain("100");
    expect(values).not.toContain("160");
  });
});

// A source guard, because the failure mode is a NEW surface computing its own percentage rather
// than going through pct()/formatRaw() — which is how the mock report and My Results each ended
// up with an unclamped one of their own.
describe("no surface computes an unclamped percentage of its own", () => {
  const SRC = path.resolve(__dirname, "../src");

  function jsFiles(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) jsFiles(full, acc);
      else if (/\.jsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
  }

  it("multiplies a score ratio by 100 only inside a Math.min", () => {
    const offenders = [];
    for (const file of jsFiles(SRC)) {
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        // A score-over-max ratio scaled to a percentage. Question-position bars (idx / length)
        // are a different thing and cannot exceed their own total.
        if (!/(score|Score)\s*\/\s*\w*(max|Max)\w*/.test(line)) continue;
        if (!/\*\s*100/.test(line)) continue;
        if (/Math\.min/.test(line)) continue;
        offenders.push(`${path.relative(SRC, file).replace(/\\/g, "/")}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
