import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import BlankSelect from "../src/practice/BlankSelect.jsx";

// The word picker inside a Fill in the Blanks blank. It replaced a native <select>, which could
// not be styled (an <option> ignores almost all CSS, and the open list is drawn by the operating
// system) and which painted its own focus border in the system accent colour.
//
// Replacing a native control means re-earning everything it gave away for free, so that is what
// these tests are about: the keyboard, the ARIA contract, and not committing an answer the
// student has only moved past.

const WORDS = ["any", "less", "some", "more"];

function Harness({ initial = null, disabled = false, onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return (
    <BlankSelect
      options={WORDS}
      value={value}
      disabled={disabled}
      label="Blank 1"
      onChange={(next) => { setValue(next); onChange(next); }}
    />
  );
}

const trigger = () => screen.getByRole("combobox", { name: "Blank 1" });
const list = () => screen.getByRole("listbox", { name: "Blank 1" });
const options = () => within(list()).getAllByRole("option");

describe("BlankSelect — the ARIA contract", () => {
  it("is a closed combobox that owns the list it opens", () => {
    render(<Harness/>);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger().getAttribute("aria-controls")).toBe(list().getAttribute("id"));
  });

  it("offers every word and nothing else — no placeholder row to pick by mistake", () => {
    render(<Harness/>);
    fireEvent.click(trigger());
    expect(options().map((o) => o.textContent)).toEqual(WORDS);
  });

  it("marks the chosen word as selected, and only that one", () => {
    render(<Harness initial={2}/>);
    fireEvent.click(trigger());
    expect(options().map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "false", "true", "false"]);
  });

  it("reads as empty until something is chosen", () => {
    render(<Harness/>);
    expect(trigger().textContent.trim()).toBe("");
  });
});

describe("BlankSelect — keyboard", () => {
  it("opens on Enter, on Space and on ArrowDown", () => {
    for (const key of ["Enter", " ", "ArrowDown"]) {
      const { unmount } = render(<Harness/>);
      fireEvent.keyDown(trigger(), { key });
      expect(trigger()).toHaveAttribute("aria-expanded", "true");
      unmount();
    }
  });

  it("opens at the end of the list on ArrowUp", () => {
    render(<Harness/>);
    fireEvent.keyDown(trigger(), { key: "ArrowUp" });
    expect(options()[WORDS.length - 1].className).toContain("is-active");
  });

  it("moves through the list without committing an answer", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange}/>);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "ArrowDown" });

    expect(options()[2].className).toContain("is-active");
    // Arrowing past a word is not choosing it — a native select commits as you move, and that
    // would let Submit enable on a word the student never settled on.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wraps at both ends, and Home/End jump to them", () => {
    render(<Harness/>);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "ArrowUp" });
    expect(options()[WORDS.length - 1].className).toContain("is-active");

    fireEvent.keyDown(list(), { key: "ArrowDown" });
    expect(options()[0].className).toContain("is-active");

    fireEvent.keyDown(list(), { key: "End" });
    expect(options()[WORDS.length - 1].className).toContain("is-active");
    fireEvent.keyDown(list(), { key: "Home" });
    expect(options()[0].className).toContain("is-active");
  });

  it("commits on Enter and closes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange}/>);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger().textContent.trim()).toBe("less");
  });

  it("Escape closes without changing the answer, and focus comes back to the blank", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange}/>);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "ArrowDown" });
    fireEvent.keyDown(list(), { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger());
  });
});

describe("BlankSelect — pointer", () => {
  it("chooses the clicked word", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange}/>);
    fireEvent.click(trigger());
    fireEvent.click(options()[3]);
    expect(onChange).toHaveBeenCalledWith(3);
    expect(trigger().textContent.trim()).toBe("more");
  });

  it("closes on a click outside, leaving the answer alone", () => {
    const onChange = vi.fn();
    render(<><Harness onChange={onChange}/><button type="button">elsewhere</button></>);
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clicking the trigger again closes the list", () => {
    render(<Harness/>);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("BlankSelect — once scored", () => {
  it("cannot be opened, so a marked answer stays as it was submitted", () => {
    render(<Harness initial={1} disabled/>);
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger().textContent.trim()).toBe("less");
  });
});
