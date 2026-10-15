import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { AppErrorBoundary, RouteErrorBoundary } from "../src/components/ErrorBoundary.jsx";

// Before this existed, a render-time throw anywhere unmounted the whole React tree and the user
// got a blank white page with no way back except a manual reload. These tests assert the two
// things that matter: the error is contained, and the surrounding UI survives.
function Boom() {
  throw new Error("render exploded");
}

// React logs caught render errors to console.error by design; silence it so a passing run is not
// full of red noise, and so a real unexpected error still stands out.
let consoleError;
beforeEach(() => { consoleError = vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { consoleError.mockRestore(); });

describe("a render error no longer blanks the page", () => {
  it("shows a recovery screen instead of nothing", () => {
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("renders children untouched when nothing throws", () => {
    render(<AppErrorBoundary><p>the real page</p></AppErrorBoundary>);

    expect(screen.getByText("the real page")).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });
});

describe("a broken page does not take the layout with it", () => {
  it("keeps the surrounding navigation usable", () => {
    render(
      <div>
        <nav><a href="/dashboard">Dashboard</a></nav>
        <RouteErrorBoundary resetKey="/progress"><Boom /></RouteErrorBoundary>
      </div>
    );

    // The page failed...
    expect(screen.getByText(/this page could not be loaded/i)).toBeInTheDocument();
    // ...but the user can still get somewhere else, which is the whole point of the inner boundary.
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("clears the error when the route changes", () => {
    function Page({ crash }) { return crash ? <Boom /> : <p>working page</p>; }

    const { rerender } = render(
      <RouteErrorBoundary resetKey="/progress"><Page crash /></RouteErrorBoundary>
    );
    expect(screen.getByText(/this page could not be loaded/i)).toBeInTheDocument();

    // Navigating away must recover on its own. Without the resetKey the fallback would persist
    // across navigation and the user would be stuck on it.
    rerender(<RouteErrorBoundary resetKey="/dashboard"><Page /></RouteErrorBoundary>);

    expect(screen.getByText("working page")).toBeInTheDocument();
    expect(screen.queryByText(/this page could not be loaded/i)).not.toBeInTheDocument();
  });

  it("recovers when the user clicks Try again", () => {
    let shouldCrash = true;
    function Page() { if (shouldCrash) throw new Error("render exploded"); return <p>recovered</p>; }

    render(<RouteErrorBoundary resetKey="/progress"><Page /></RouteErrorBoundary>);
    expect(screen.getByText(/this page could not be loaded/i)).toBeInTheDocument();

    shouldCrash = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("still reports the error, so a crash is never silent", () => {
    render(<RouteErrorBoundary resetKey="/x"><Boom /></RouteErrorBoundary>);

    const logged = consoleError.mock.calls.some(args =>
      args.some(a => typeof a === "string" && a.includes("[ErrorBoundary]"))
    );
    expect(logged).toBe(true);
  });
});
