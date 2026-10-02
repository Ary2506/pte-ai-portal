import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../src/App.jsx";
import { api } from "../src/api.js";

// The sign-in error used to render above the fields, so every failed attempt pushed User ID and
// Password down and a corrected attempt pulled them back up. These tests pin the fix: the message
// lives below the fields now, in a slot that holds its height whether or not there is a message.

vi.mock("../src/api.js", () => ({
  api: {
    auth: { signin: vi.fn(), me: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
    admin: {
      getStats: vi.fn(), getAuditLog: vi.fn(), createUser: vi.fn(), listUsers: vi.fn(), getUser: vi.fn(),
      updateUser: vi.fn(), setStatus: vi.fn(), setSubscription: vi.fn(), renew: vi.fn(), resetPassword: vi.fn(), revokeSessions: vi.fn()
    },
    dashboard: vi.fn(), plan: vi.fn(), questions: vi.fn(), history: vi.fn(), submit: vi.fn(), retryEvaluation: vi.fn(),
    testSessions: { start: vi.fn(), get: vi.fn(), complete: vi.fn(), list: vi.fn() }
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

function renderSignIn() {
  return render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
}

// jsdom reports every element as zero-sized, so pixel positions prove nothing here. What can be
// checked is document order, which is what actually decides whether a field moves: a message
// rendered before the inputs pushes them, one rendered after them cannot.
function comesBefore(a, b) {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

async function failSignIn() {
  api.auth.signin.mockRejectedValue(Object.assign(new Error("Invalid User ID or password"), { code: "INVALID_CREDENTIALS" }));
  fireEvent.change(screen.getByPlaceholderText("e.g. pte001"), { target: { value: "pte001" } });
  fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  await screen.findByText("Invalid User ID or password");
}

describe("sign-in form stays put when an error appears", () => {
  it("renders the error after both fields, so neither can be pushed down", async () => {
    renderSignIn();
    await failSignIn();

    const userId = screen.getByPlaceholderText("e.g. pte001");
    const password = screen.getByPlaceholderText("Your password");
    const message = screen.getByText("Invalid User ID or password");

    expect(comesBefore(userId, message)).toBe(true);
    expect(comesBefore(password, message)).toBe(true);
  });

  it("keeps the message slot in the layout before any error, so showing one adds no new box", async () => {
    renderSignIn();
    const slot = document.querySelector(".auth-message-slot");
    expect(slot).toBeInTheDocument();
    expect(slot.children.length).toBe(0); // present, holding space, empty

    await failSignIn();
    expect(document.querySelectorAll(".auth-message-slot").length).toBe(1);
    expect(document.querySelector(".auth-message-slot").children.length).toBe(1);
  });

  it("clears the message back out of the slot on a successful sign-in", async () => {
    renderSignIn();
    await failSignIn();
    expect(document.querySelector(".auth-message-slot").children.length).toBe(1);

    api.auth.signin.mockResolvedValue({ token: "t", user: { role: "student", name: "S", username: "pte001" } });
    api.dashboard.mockResolvedValue({ stats: {}, bySection: [], recent: [], streak: {}, weeklyActivity: [] });
    fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(screen.queryByText("Invalid User ID or password")).not.toBeInTheDocument());
  });
});

describe("the sign-in policy notice describes what the app actually does", () => {
  it("promises one session at a time, not a permanent device lock", async () => {
    renderSignIn();
    expect(await screen.findByText(/One session at a time/i)).toBeInTheDocument();
    expect(screen.getByText(/only one at a time/i)).toBeInTheDocument();
    // Device binding was removed; claiming it here would be telling students something untrue.
    expect(screen.queryByText(/restricted to one device and one browser/i)).not.toBeInTheDocument();
  });
});
