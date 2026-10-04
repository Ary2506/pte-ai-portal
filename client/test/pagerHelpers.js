import { expect } from "vitest";
import { waitFor } from "@testing-library/react";

// The shared Pager renders its position as split markup — "Page <b>2</b> of <b>3</b> ·
// <b>25</b> items" — so the numbers can carry the tabular-figure treatment that keeps them from
// shifting as you page. getByText cannot match across those element boundaries, so tests read the
// readout container instead of asking for a text node that no longer exists.

/** Every pager position readout currently on screen, in DOM order. */
export function pagers() {
  return [...document.querySelectorAll(".pager__position")];
}

/** One pager's position, whitespace-normalised: "Page 2 of 3 · 25 items". */
export function pagerText(index = 0) {
  const el = pagers()[index];
  return el ? el.textContent.replace(/\s+/g, " ").trim() : undefined;
}

/** Waits for a pager to show `pattern` — the async counterpart of pagerText. */
export function findPagerText(pattern, index = 0) {
  return waitFor(() => expect(pagerText(index)).toMatch(pattern));
}
