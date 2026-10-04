import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";
import { Button, ButtonLink, IconButton, NavButton } from "../src/components/Button.jsx";

// The button system exists because the product had 136 hand-written <button> elements across 25
// files, sharing five loosely-related classes, eight of them patched with inline styles, Unicode
// arrows standing in for icons, and no loading state anywhere — "Evaluating..." was retyped at
// every call site with its own idea of whether to disable the control. These tests pin the parts
// that are easy to undo by accident.

function Wrap({ children }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("Button — tiers and sizes", () => {
  it("renders the requested tier and size as classes, defaulting to secondary/md", () => {
    const { container } = render(<Button>Save</Button>);
    expect(container.querySelector("button").className).toContain("btn--secondary");
    expect(container.querySelector("button").className).toContain("btn--md");
  });

  it("falls back to secondary/md rather than emitting a class no stylesheet defines", () => {
    const { container } = render(<Button variant="shiny" size="enormous">Save</Button>);
    const classes = container.querySelector("button").className;
    expect(classes).toContain("btn--secondary");
    expect(classes).toContain("btn--md");
    expect(classes).not.toContain("btn--shiny");
  });

  it("is type=button unless asked otherwise, so a button inside a form cannot submit it by accident", () => {
    render(<><Button>Cancel</Button><Button type="submit">Create</Button></>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Create" })).toHaveAttribute("type", "submit");
  });
});

describe("Button — loading", () => {
  it("disables itself, announces aria-busy, and shows the loading label", () => {
    render(<Button loading loadingLabel="Evaluating...">Submit</Button>);
    const button = screen.getByRole("button", { name: "Evaluating..." });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("cannot fire a second time while a request is in flight — the double-submission guard", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Submit</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the resting label when no loadingLabel is given, rather than blanking the button", () => {
    render(<Button loading>Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});

describe("Button — success", () => {
  it("swaps to the success label without disabling the button", () => {
    render(<Button success successLabel="Copied!">Copy message</Button>);
    const button = screen.getByRole("button", { name: "Copied!" });
    expect(button).not.toBeDisabled();
    expect(button.className).toContain("is-success");
  });
});

describe("IconButton", () => {
  it("refuses to render without a label — an icon with no accessible name is not a button", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<IconButton icon={<svg/>}/>)).toThrow(/requires a `label`/);
    quiet.mockRestore();
  });

  it("uses the label as both the accessible name and the tooltip", () => {
    render(<IconButton label="Close menu" icon={<svg/>}/>);
    const button = screen.getByRole("button", { name: "Close menu" });
    expect(button).toHaveAttribute("title", "Close menu");
    expect(button.className).toContain("btn--icon-only");
  });
});

describe("NavButton", () => {
  it("gives forward more weight than back, and keeps a disabled Previous visible", () => {
    render(<><NavButton direction="previous" disabled>Previous</NavButton><NavButton direction="next">Next</NavButton></>);
    const previous = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(previous.className).toContain("btn--tertiary");
    expect(next.className).toContain("btn--secondary");
    // Disabled, not removed: the control must not move position between questions.
    expect(previous).toBeDisabled();
    expect(previous).toBeVisible();
  });

  it("has a plain text accessible name — the Unicode arrows it replaced read aloud as punctuation", () => {
    render(<NavButton direction="next">Next</NavButton>);
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.queryByText("Next ›")).not.toBeInTheDocument();
  });
});

describe("ButtonLink", () => {
  it("renders a routed link that looks like a button", () => {
    render(<Wrap><ButtonLink variant="primary" to="/dashboard">Back to Dashboard</ButtonLink></Wrap>);
    const link = screen.getByRole("link", { name: "Back to Dashboard" });
    expect(link.className).toContain("btn--primary");
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("does not pick up the router's active class — a button is not styled by the route it points at", () => {
    render(<MemoryRouter initialEntries={["/dashboard"]}><ButtonLink to="/dashboard">Back</ButtonLink></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Back" }).className).not.toContain("active");
  });

  it("renders a plain anchor for a download or an external target", () => {
    render(<Wrap><ButtonLink href="/samples.pdf" download="samples.pdf">Download PDF</ButtonLink></Wrap>);
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("download", "samples.pdf");
  });
});

// --- Source guards ----------------------------------------------------------
// jsdom renders components, not the whole product, so these read the source instead: the point of
// the system is that no NEW surface reintroduces what it replaced.

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.jsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const SRC = path.resolve(__dirname, "../src");
const FILES = sourceFiles(SRC).map((f) => ({
  rel: path.relative(SRC, f).replace(/\\/g, "/"),
  text: fs.readFileSync(f, "utf8")
}));

// The landing page is deliberately its own family (`ld-btn`): a marketing surface with its own
// scale and weight, not an application control.
const LANDING = /^landing\//;

describe("no surface reintroduces the classes the system replaced", () => {
  it("has no bare primary/secondary class buttons or links left", () => {
    const offenders = FILES
      .filter((f) => !LANDING.test(f.rel))
      .filter((f) => /className="(primary|secondary|primary full|primary danger|primary right)"/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("has no .text-button left — compact row actions are ghost buttons now", () => {
    const offenders = FILES.filter((f) => /className="text-button"/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("has no Unicode arrow glyphs standing in for navigation icons", () => {
    const offenders = FILES
      .filter((f) => /[‹›]\s*(Previous|Next)|(Previous|Next)\s*[‹›]|>[↑↓]</.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("has no dark-theme rule that outranks a tier's own colour", () => {
    // The recurring failure mode in this stylesheet: a hardcoded html[data-theme="dark"] rule
    // beating a token-driven one. "html[data-theme=dark] button:active" is more specific than
    // ".btn--primary", so it was repainting a pressed primary button's label.
    const css = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");
    const offenders = [...css.matchAll(/(html\[data-theme="dark"\][^{}]*)\{([^}]*)\}/g)]
      .filter(([, selector, body]) =>
        /(^|[\s>+~])button(:|\s|$|,)/.test(selector) &&
        !/:not\(\.btn\)/.test(selector) &&
        /(^|;)\s*(color|background)/.test(body))
      .map(([, selector]) => selector.trim());
    expect(offenders).toEqual([]);
  });

  it("has no inline-styled buttons — spacing belongs to a class, not to a call site", () => {
    const offenders = FILES
      .filter((f) => /<(button|Button)\b[^>]*\bstyle=\{\{/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
