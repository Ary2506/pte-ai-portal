import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Deliberately does NOT mock ../src/api.js — this exercises the real request()/forceLogout
// logic against a mocked fetch, unlike every other test file which mocks the whole module.
describe("api.js force-logout on session/subscription failure codes", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.setItem("pte_token", "some-token");
    delete window.location;
    window.location = { href: "", pathname: "/dashboard" };
  });

  afterEach(() => {
    window.location = originalLocation;
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("clears the session and redirects when the server reports SUBSCRIPTION_EXPIRED", async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ message: "Your 30-day access has expired.", code: "SUBSCRIPTION_EXPIRED" })
    }));
    const { api } = await import("../src/api.js");

    await expect(api.dashboard()).rejects.toThrow();
    expect(localStorage.getItem("pte_token")).toBeNull();
    expect(window.location.href).toBe("/");
    expect(sessionStorage.getItem("pte_login_notice")).toMatch(/expired/i);
  });

  it("clears the session when the server reports ACCOUNT_BLOCKED", async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ message: "This account has been blocked.", code: "ACCOUNT_BLOCKED" })
    }));
    const { api } = await import("../src/api.js");

    await expect(api.dashboard()).rejects.toThrow();
    expect(localStorage.getItem("pte_token")).toBeNull();
    expect(window.location.href).toBe("/");
  });

  it("does not force-logout for an ordinary validation error", async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ message: "Write a response before submitting.", code: "EMPTY_ANSWER" })
    }));
    const { api } = await import("../src/api.js");

    await expect(api.dashboard()).rejects.toThrow();
    expect(localStorage.getItem("pte_token")).toBe("some-token");
    expect(window.location.href).toBe("");
  });
});
