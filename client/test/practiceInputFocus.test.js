import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Focusing a practice input must not repaint its border. The answer textarea, the typed blanks
// and the dropdown blanks all used to turn blue on focus, which in a passage full of blanks made
// the paragraph flicker as the student tabbed through it. jsdom applies no stylesheets, so this
// reads the source — the same approach as the row-hover token guard.
//
// Focus is still shown, via --focus-ring-quiet: a neutral halo, which is a box-shadow and not a
// border colour, so the border itself is genuinely unchanged.

const css = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");
const RULE = /([^{}]+)\{([^}]*)\}/g;

/** The practice inputs this rule is about, by the class that identifies each. */
const PRACTICE_INPUTS = [".answer-area", ".listening-fill-input", ".dropdown-blank"];

function focusRulesForPracticeInputs() {
  const rules = [];
  for (const [, selector, body] of css.matchAll(RULE)) {
    if (!/:focus/.test(selector)) continue;
    if (!PRACTICE_INPUTS.some((cls) => selector.includes(cls))) continue;
    rules.push({ selector: selector.trim(), body });
  }
  return rules;
}

describe("practice inputs — focus never recolours a border", () => {
  it("has a focus rule for each of them, so this guard cannot pass by matching nothing", () => {
    const covered = new Set();
    for (const { selector } of focusRulesForPracticeInputs()) {
      for (const cls of PRACTICE_INPUTS) if (selector.includes(cls)) covered.add(cls);
    }
    expect([...covered].sort()).toEqual([...PRACTICE_INPUTS].sort());
  });

  it("never sets an accent border-color on focus", () => {
    const offenders = focusRulesForPracticeInputs()
      .filter(({ body }) => /border-color\s*:\s*var\(--(blue|violet|info)\)/.test(body))
      .map(({ selector }) => selector);
    expect(offenders).toEqual([]);
  });

  it("never draws the blue focus ring or a blue outline on them", () => {
    const offenders = focusRulesForPracticeInputs()
      .filter(({ body }) =>
        /box-shadow\s*:\s*var\(--focus-ring\)/.test(body) ||
        /outline\s*:[^;]*var\(--blue\)/.test(body))
      .map(({ selector }) => selector);
    expect(offenders).toEqual([]);
  });

  it("cancels the product-wide blue :focus-visible outline for them", () => {
    // button/a/input/textarea/select:focus-visible carries a 2.5px blue outline. Without an
    // explicit override these inputs would still get it, whatever their own focus rules say.
    const cancelled = focusRulesForPracticeInputs()
      .filter(({ selector, body }) => selector.includes(":focus-visible") && /outline\s*:\s*0/.test(body))
      .map(({ selector }) => selector)
      .join(" ");
    for (const cls of PRACTICE_INPUTS) expect(cancelled).toContain(cls);
  });

  it("still shows focus somehow — the quiet ring exists and is not blue", () => {
    const token = css.match(/--focus-ring-quiet:([^;]+);/);
    expect(token).toBeTruthy();
    expect(token[1]).not.toMatch(/var\(--blue/);
    const usesQuietRing = focusRulesForPracticeInputs()
      .some(({ body }) => /var\(--focus-ring-quiet\)/.test(body));
    expect(usesQuietRing).toBe(true);
  });
});
