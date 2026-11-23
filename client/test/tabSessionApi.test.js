import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The real request()/forceLogout with per-tab sign-ins (session.js), against a mocked fetch.
const reply = (ok, body) => () => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe("api.js with a sign-in per tab", () => {
  const originalLocation = window.location;
  beforeEach(() => {
    delete window.location;
    window.location = { href: "", pathname: "/dashboard" };
  });
  afterEach(() => {
    window.location = originalLocation;
    vi.restoreAllMocks();
    vi.resetModules();
  });
  const tab = (id, token) => {
    sessionStorage.setItem("pte_tab_token", token);
    sessionStorage.setItem("pte_tab_user", JSON.stringify({ id, username: id }));
  };
  const browser = (id, token) => {
    localStorage.setItem("pte_token", token);
    localStorage.setItem("pte_user", JSON.stringify({ id, username: id }));
  };

  it("sends this tab's own token, not another tab's newer sign-in", async () => {
    tab("student", "student-token");
    browser("admin", "admin-token");
    global.fetch = vi.fn(reply(true, {}));
    const { api } = await import("../src/api.js");
    await api.dashboard();
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer student-token");
  });

  it("a new tab sends the browser's most recent sign-in", async () => {
    browser("admin", "admin-token");
    global.fetch = vi.fn(reply(true, {}));
    const { api } = await import("../src/api.js");
    await api.dashboard();
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer admin-token");
  });

  it("a refused session signs out this tab only — another tab's account is untouched", async () => {
    tab("student", "student-token");
    browser("admin", "admin-token");
    global.fetch = vi.fn(reply(false, { code: "SESSION_REVOKED", message: "Signed out" }));
    const { api } = await import("../src/api.js");
    await expect(api.dashboard()).rejects.toThrow();
    expect(sessionStorage.getItem("pte_tab_token")).toBeNull();
    expect(localStorage.getItem("pte_token")).toBe("admin-token");
    expect(window.location.href).toBe("/");
  });

  it("when this same account signed in again in another tab, this tab carries on with that session", async () => {
    tab("student", "student-old-token");
    browser("student", "student-new-token");
    global.fetch = vi.fn(reply(false, { code: "SESSION_REVOKED", message: "Signed out" }));
    const { api } = await import("../src/api.js");
    await expect(api.dashboard()).rejects.toThrow();
    expect(window.location.href).toBe("");
    expect(sessionStorage.getItem("pte_tab_token")).toBe("student-new-token");
  });

  it("a refused session that is also the browser's most recent one clears both", async () => {
    browser("student", "student-token");
    global.fetch = vi.fn(reply(false, { code: "SESSION_EXPIRED", message: "Expired" }));
    const { api } = await import("../src/api.js");
    await expect(api.dashboard()).rejects.toThrow();
    expect(localStorage.getItem("pte_token")).toBeNull();
    expect(sessionStorage.getItem("pte_tab_token")).toBeNull();
    expect(window.location.href).toBe("/");
  });
});
