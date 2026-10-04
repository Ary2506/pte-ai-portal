import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Row hover was inconsistent because two surfaces hardcoded their own colour (#252d45, left over
// from the old slate palette) while others used --bg-soft, which is near-invisible against the
// near-black surface. jsdom does not apply stylesheets, so this reads the source instead: every
// rule that paints a hovered row must go through the one token.

const css = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");

const RULE = /([^{}]+)\{([^}]*)\}/g;

// Whether a selector actually targets a hovered ROW, rather than merely containing the letters
// "tr" somewhere — ".reorder-controls .icon-btn:hover" matched a looser pattern through the "tr"
// inside "controls", which is not a row at all. Only the final simple selector counts: it is the
// element the :hover is on.
function targetsHoveredRow(selector) {
  return selector.split(",").some((part) => {
    const last = part.trim().split(/[\s>+~]+/).pop() || "";
    const [element] = last.split(":");
    return /(^|[.\w-])row$/.test(element) || element === "tr" || element.endsWith("tbody tr");
  }) && /:(hover|focus|active)/.test(selector);
}

/** Every rule that paints a hovered row, as [selector, declarations]. */
function rowHoverRules() {
  const found = [];
  for (const [, selector, body] of css.matchAll(RULE)) {
    if (targetsHoveredRow(selector)) found.push([selector.trim(), body]);
  }
  return found;
}

describe("one hover colour for every row in the product", () => {
  // Every row-like surface in the app, so one of them cannot quietly keep its own colour or lose
  // its hover entirely — which is how .focus-item, .recent, .skill-row and .plan-day ended up
  // with no hover background at all while the tables had one.
  it("gives every row-like surface the token", () => {
    for (const selector of [
      ".nav-item:hover", ".recent:hover", ".focus-item:hover", ".skill-row:hover",
      ".section-perf-row:hover", ".plan-day:hover", ".question-list-row:hover",
      ".perf-table tbody tr:hover", "tbody tr:hover"
    ]) {
      const at = css.indexOf(selector);
      expect(at, selector + " has no rule at all").toBeGreaterThan(-1);
      const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
      expect(body, selector).toMatch(/background:\s*var\(--row-hover\)/);
    }
  });

  it("actually finds the row-hover rules it is auditing", () => {
    const selectors = rowHoverRules().map(([s]) => s).join(" ");
    expect(selectors).toMatch(/question-list-row/);
    expect(selectors).toMatch(/perf-table/);
    expect(selectors).toMatch(/practice-row/);
    // The looser first version of this matcher caught ".reorder-controls .icon-btn:hover"
    // through the "tr" in "controls"; that is a button, not a row.
    expect(selectors).not.toMatch(/icon-btn/);
  });

  it("defines --row-hover in both themes", () => {
    expect(css).toMatch(/:root\{[\s\S]*?--row-hover:\s*#[0-9a-f]{6}/i);
    expect(css).toMatch(/html\[data-theme="dark"\]\{[\s\S]*?--row-hover:\s*#[0-9a-f]{6}/i);
  });

  it("never paints a hovered row with a literal colour", () => {
    const offenders = [];
    for (const [selector, body] of rowHoverRules()) {
      const background = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i);
      if (!background) continue;
      const value = background[1].trim();
      if (/^#|^rgb/i.test(value)) offenders.push(`${selector} → ${value}`);
    }
    expect(offenders).toEqual([]);
  });

  it("never paints a hovered row with --bg-soft, which is invisible on a dark surface", () => {
    const offenders = rowHoverRules()
      .filter(([, body]) => /background(?:-color)?\s*:\s*var\(--bg-soft\)/i.test(body))
      .map(([selector]) => selector);
    expect(offenders).toEqual([]);
  });

  it("keeps the dark value distinguishable from the surface it sits on", () => {
    const surface = css.match(/html\[data-theme="dark"\][\s\S]*?--surface:\s*#([0-9a-f]{6})/i)[1];
    const hover = css.match(/html\[data-theme="dark"\][\s\S]*?--row-hover:\s*#([0-9a-f]{6})/i)[1];
    const lum = (hex) => [0, 2, 4].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    // The product's hover is a deliberate, quiet DARKENING of the surface — measured from the
    // design it was chosen from, not inferred. An earlier version of this test demanded the
    // hover be lighter, which encoded a wrong guess as a requirement and pushed the colour
    // further from what was wanted on every pass. All that is required is that it differ.
    expect(hover).not.toBe(surface);
    expect(lum(surface) - lum(hover)).toBeGreaterThan(0);
  });
});

// "The footer floats mid-page when there is little content" is a layout contract, not a colour,
// so it is pinned the same source-level way.
describe("the footer sits at the bottom of short pages", () => {
  // Plain extraction: find the selector at the start of a line, then take what is between its
  // braces. Building this as a RegExp needed three levels of escaping and silently matched
  // nothing, which made the assertions pass against an empty string.
  const rule = (selector) => {
    const at = css.indexOf(selector + "{");
    if (at === -1) return "";
    return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  };

  it("makes the main column fill the viewport and the content absorb the slack", () => {
    const main = rule(".main");
    expect(main).toMatch(/min-height:\s*100vh/);
    expect(main).toMatch(/flex-direction:\s*column/);

    const content = rule(".content");
    expect(content).toMatch(/flex:\s*1/);
    // `margin:auto` inside a flex column centres the content vertically in the slack instead of
    // letting it push the footer down.
    expect(content).not.toMatch(/margin:\s*auto/);
  });

  it("keeps the footer from being stretched or squashed by that flex container", () => {
    expect(rule(".app-footer")).toMatch(/flex:\s*none/);
  });
});

// Both of these lost their intended fill to hardcoded dark overrides left from the old slate
// palette, more than once, so the tokens are asserted rather than trusted. The banner reads as a
// panel; the table header is the one surface that sits a shade off it.
describe("surfaces that share the row tone keep sharing it", () => {
  const body = (selector) => {
    const at = css.indexOf(selector + "{");
    if (at === -1) return "";
    return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  };

  it("gives table headers the row tone", () => {
    expect(body("th")).toMatch(/background:\s*var\(--row-hover\)/);
  });

  it("gives the mock banner the same surface as any other panel", () => {
    expect(body(".mock-cta-banner")).toMatch(/background:\s*var\(--surface\)/);
    expect(body(".panel")).toMatch(/background:\s*var\(--surface\)/);
  });

  it("has no dark-mode override re-hardcoding either of them", () => {
    for (const selector of ["th", ".mock-cta-banner"]) {
      const pattern = new RegExp('html\[data-theme="dark"\]\s*' + selector.replace(".", "\.") + '\{([^}]*)\}');
      const match = css.match(pattern);
      if (match) expect(match[1], selector).not.toMatch(/background:\s*#/);
    }
  });
});

// Panels sitting side by side looked broken when one was shorter than the other, because the
// grids sized each to its own content.
describe("side-by-side panels share a height", () => {
  const body = (selector) => {
    const at = css.indexOf(selector + "{");
    if (at === -1) return "";
    return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  };

  it("stretches both columns rather than starting each at its own height", () => {
    for (const selector of [".dashboard-split", ".intel-split"]) {
      expect(body(selector), selector).toMatch(/align-items:\s*stretch/);
      expect(body(selector), selector).not.toMatch(/align-items:\s*start/);
    }
  });

  it("keeps one shared gap between and within those rows", () => {
    for (const selector of [".dashboard-split", ".intel-split", ".page-stack"]) {
      expect(body(selector), selector).toMatch(/gap:\s*18px/);
    }
  });
});

// The practice hub inverts the usual pairing: its section boxes take the header tone, so a row
// inside one must lift to the panel surface rather than sink to the same colour as its container.
describe("the practice hub inverts the row pairing", () => {
  const body = (selector) => {
    const at = css.indexOf(selector + "{");
    if (at === -1) return "";
    return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  };

  it("puts the section box on the header tone", () => {
    expect(body(".practice-column")).toMatch(/background:\s*var\(--row-hover\)/);
  });

  it("lifts a hovered task row to the panel surface instead", () => {
    expect(body("button.practice-row:hover")).toMatch(/background:\s*var\(--surface\)/);
  });

  it("keeps the two different, so the hover is visible at all", () => {
    expect(body(".practice-column")).not.toMatch(/background:\s*var\(--surface\)/);
  });
});

// A response like "aaaa…" has no break opportunity, so without an explicit rule it runs past its
// container and scrolls the whole page sideways — which is what the evaluation panel did.
describe("long unbroken answers stay inside their panel", () => {
  it("never breaks the section labels, which are short and must stay whole", () => {
    // An earlier version applied the break rule to .feedback-group b as well, so "CONTENT"
    // rendered as "CO" / "NT" down the side of the panel.
    const at = css.indexOf(".feedback-group b{");
    expect(at, "label rule is missing").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toMatch(/word-break:\s*keep-all/);

    const wrapAt = css.indexOf(".feedback-group p,");
    const wrapBlock = css.slice(wrapAt, css.indexOf("{", wrapAt));
    expect(wrapBlock).not.toContain(".feedback-group b");
  });


  it("lets every surface that renders student or evaluator text break mid-word", () => {
    const at = css.indexOf(".feedback-group p,");
    expect(at, "wrapping block is missing entirely").toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf("}", at));
    expect(block).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block).toMatch(/word-break:\s*break-word/);
    // The surfaces it has to cover.
    for (const selector of [".feedback-group p", ".feedback-overall", ".answer-reveal p", ".perf-table td"]) {
      expect(block, selector).toContain(selector);
    }
  });
});
