import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "../src/components/toast.jsx";

// Toasts have to clear themselves. An error that sat on screen until clicked was the one
// behaviour that differed from the admin panel, which has always cleared its own.

function Raiser({ onReady }) {
  const toast = useToast();
  onReady(toast);
  return null;
}

function mount() {
  let api;
  render(<ToastProvider><Raiser onReady={(t) => { api = t; }} /></ToastProvider>);
  return api;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("toasts clear themselves", () => {
  it("removes a success toast after its own delay", () => {
    const toast = mount();
    act(() => { toast.success("Saved."); });
    expect(screen.getByText("Saved.")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(4999); });
    expect(screen.queryByText("Saved.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("gives an error longer, but still clears it", () => {
    const toast = mount();
    act(() => { toast.error("Failed to fetch"); });

    // Still there at the point a success toast would already be gone — errors have more to read.
    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  it("can still be dismissed by clicking before it expires", () => {
    const toast = mount();
    act(() => { toast.error("Network error"); });
    act(() => { screen.getByText("Network error").click(); });
    expect(screen.queryByText("Network error")).not.toBeInTheDocument();
  });

  it("times each toast independently rather than clearing the whole stack", () => {
    const toast = mount();
    act(() => { toast.success("First"); });
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { toast.success("Second"); });

    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("ignores an empty message rather than flashing a blank toast", () => {
    const toast = mount();
    act(() => { toast.error(""); });
    expect(document.querySelector(".toast")).toBeNull();
  });
});
