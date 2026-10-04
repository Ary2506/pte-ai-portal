import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ScrollTabs from "../src/components/ScrollTabs.jsx";

// The tab strip used to show a browser scrollbar under it at every width. It is arrow-driven now,
// but it is still a real scroll container — the arrows are an addition, not the only way across.

// jsdom reports every element as zero-sized, so scroll geometry has to be supplied.
function setGeometry(el, { scrollWidth, clientWidth, scrollLeft = 0 }) {
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  el.scrollLeft = scrollLeft;
}

function renderTabs({ scrollWidth = 900, clientWidth = 400, scrollLeft = 0 } = {}) {
  const view = render(
    <ScrollTabs className="practice-tabs">
      {["One", "Two", "Three"].map(t => <button key={t} className="tab">{t}</button>)}
    </ScrollTabs>
  );
  const track = document.querySelector(".scroll-tabs__track");
  setGeometry(track, { scrollWidth, clientWidth, scrollLeft });
  act(() => { fireEvent.scroll(track); });
  return { ...view, track };
}

const leftArrow = () => screen.queryByLabelText("Scroll tabs left");
const rightArrow = () => screen.queryByLabelText("Scroll tabs right");

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("arrows appear only where there is more to see", () => {
  it("shows only the right arrow at the start of an overflowing strip", () => {
    renderTabs({ scrollLeft: 0 });
    expect(leftArrow()).toHaveAttribute("hidden");
    expect(rightArrow()).not.toHaveAttribute("hidden");
  });

  it("shows both arrows in the middle", () => {
    renderTabs({ scrollLeft: 200 });
    expect(leftArrow()).not.toHaveAttribute("hidden");
    expect(rightArrow()).not.toHaveAttribute("hidden");
  });

  it("shows only the left arrow at the end", () => {
    // scrollWidth 900 - clientWidth 400 = 500 is the maximum.
    renderTabs({ scrollLeft: 500 });
    expect(leftArrow()).not.toHaveAttribute("hidden");
    expect(rightArrow()).toHaveAttribute("hidden");
  });

  it("shows no arrows at all when everything fits", () => {
    renderTabs({ scrollWidth: 300, clientWidth: 400 });
    expect(leftArrow()).toHaveAttribute("hidden");
    expect(rightArrow()).toHaveAttribute("hidden");
  });
});

describe("the arrows scroll the strip", () => {
  it("moves right by most of a screen, not the whole thing", () => {
    const { track } = renderTabs();
    track.scrollBy = vi.fn();
    fireEvent.click(rightArrow());
    expect(track.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ left: 320, behavior: "smooth" }));   // 400 * 0.8
  });

  it("moves left by the same amount", () => {
    const { track } = renderTabs({ scrollLeft: 400 });
    track.scrollBy = vi.fn();
    fireEvent.click(leftArrow());
    expect(track.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -320 }));
  });
});

describe("it remains a real scroll container", () => {
  it("keeps the tabs scrollable, so touch and trackpad still work", () => {
    const { track } = renderTabs();
    // The arrows are additive; removing them must not remove the ability to scroll.
    expect(track).toHaveClass("scroll-tabs__track");
    expect(track.querySelectorAll(".tab")).toHaveLength(3);
  });

  it("keeps the arrows out of the tab order", () => {
    renderTabs();
    // Tabbing through the strip should reach the tabs, not two scroll buttons around them.
    expect(rightArrow()).toHaveAttribute("tabindex", "-1");
  });
});
