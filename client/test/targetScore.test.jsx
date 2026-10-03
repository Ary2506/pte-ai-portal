import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// The target score drives every gap figure in the product (dashboard subtitle, study plan,
// performance intelligence), and until now it could only be changed in the database. It is
// edited on the profile because it is account state, not page state.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()), setTargetScore: vi.fn() },
    dashboard: vi.fn(() => Promise.resolve({ stats: {}, bySection: [], recent: [], streak: {}, weeklyActivity: [] })),
    history: vi.fn(() => Promise.resolve({ submissions: [], total: 0 })),
    activity: vi.fn(() => Promise.resolve(null)),
    questions: vi.fn(), plan: vi.fn(), submit: vi.fn(),
    admin: { getStats: vi.fn(), getAuditLog: vi.fn(), listUsers: vi.fn() },
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  },
  forceLogout: vi.fn()
}));

const student = (over = {}) => ({
  id: "s1", role: "student", name: "Sam", username: "pte001",
  subscriptionStatus: "ACTIVE", targetScore: 79, ...over
});

function renderProfile(user = student()) {
  localStorage.setItem("pte_token", "t");
  localStorage.setItem("pte_user", JSON.stringify(user));
  return render(<MemoryRouter initialEntries={["/profile"]}><App /></MemoryRouter>);
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe("setting a target", () => {
  it("offers Set target when the account has none", async () => {
    renderProfile(student({ targetScore: null }));
    expect(await screen.findByRole("button", { name: "Set target" })).toBeInTheDocument();
    expect(document.querySelector(".target-editor__value span")).toHaveTextContent("—");
  });

  it("saves a new target and reflects it without a reload", async () => {
    api.auth.setTargetScore.mockResolvedValue({ user: student({ targetScore: 85 }) });
    renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: "Change target" }));
    fireEvent.change(screen.getByLabelText("Target score"), { target: { value: "85" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.auth.setTargetScore).toHaveBeenCalledWith(85));
    await waitFor(() => expect(document.querySelector(".target-editor__value span")).toHaveTextContent("85"));
    // Persisted the same way sign-in does, so a reload keeps it.
    expect(JSON.parse(localStorage.getItem("pte_user")).targetScore).toBe(85);
  });

  it("constrains the input to the PTE range, so an impossible target cannot be submitted", async () => {
    renderProfile();
    fireEvent.click(await screen.findByRole("button", { name: "Change target" }));
    const input = screen.getByLabelText("Target score");
    // The browser blocks the submit itself; the server validates the same bounds independently,
    // because a constraint only enforced in the UI is not enforced at all.
    expect(input).toHaveAttribute("min", "10");
    expect(input).toHaveAttribute("max", "90");
    expect(input).toHaveAttribute("step", "1");
  });

  it("surfaces a failure from the server instead of silently keeping the old value", async () => {
    api.auth.setTargetScore.mockRejectedValue(new Error("Could not save your target score."));
    renderProfile();

    fireEvent.click(await screen.findByRole("button", { name: "Change target" }));
    fireEvent.change(screen.getByLabelText("Target score"), { target: { value: "85" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Errors are product-wide toasts now, not an inline line that pushes the form around.
    const toast = await screen.findByText("Could not save your target score.");
    expect(toast.closest(".toast")).toHaveClass("toast-error");
    // Still in the editor, with the attempt intact, rather than closed as if it had worked.
    expect(screen.getByLabelText("Target score")).toHaveValue(85);
  });

  it("can be cancelled without saving", async () => {
    renderProfile();
    fireEvent.click(await screen.findByRole("button", { name: "Change target" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.auth.setTargetScore).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Change target" })).toBeInTheDocument();
  });
});

describe("there is no reset control", () => {
  // The default is 90, which is also the top of the PTE scale, so "reset to default" said almost
  // nothing — and the control still advertised the previous default of 79.
  it("offers only Set and Change, never a reset", async () => {
    renderProfile(student({ targetScore: 85 }));
    await screen.findByRole("button", { name: "Change target" });
    expect(screen.queryByRole("button", { name: /Reset/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/79/)).not.toBeInTheDocument();
  });

  it("seeds the input with the top of the scale when no target is set", async () => {
    renderProfile(student({ targetScore: null }));
    fireEvent.click(await screen.findByRole("button", { name: "Set target" }));
    expect(screen.getByLabelText("Target score")).toHaveValue(90);
  });
});
