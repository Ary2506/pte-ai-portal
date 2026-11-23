import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Student Website View, at the API layer: the real request()/forceLogout against a mocked fetch.
const VIEW = {
  token: "view-pass-token",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  student: { id: "s1", username: "pte001", name: "Student One", role: "student" }
};

describe("api.js in a student-view tab", () => {
  const originalLocation = window.location;
  beforeEach(() => {
    localStorage.setItem("pte_token", "admin-own-token");
    localStorage.setItem("pte_user", JSON.stringify({ id: "a1", username: "admin", role: "admin" }));
    sessionStorage.setItem("pte_student_view", JSON.stringify(VIEW));
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

  it("reads with the view pass, not the admin's own token", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ submissions: [] }) }));
    const { api } = await import("../src/api.js");
    await api.history();
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer view-pass-token");
  });

  it("refuses every write before sending it", async () => {
    global.fetch = vi.fn();
    const { api } = await import("../src/api.js");
    for (const attempt of [api.submit(new FormData()), api.shareSubmission("x"), api.unshareSubmission("x"), api.testSessions.start()]) {
      await expect(attempt).rejects.toMatchObject({ code: "READ_ONLY_VIEW" });
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows the student's own access limits without ending the view or touching the admin's sign-in", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ message: "expired", code: "SUBSCRIPTION_EXPIRED" }) }));
    const { api } = await import("../src/api.js");
    await expect(api.dashboard()).rejects.toThrow();
    expect(sessionStorage.getItem("pte_student_view")).not.toBeNull();
    expect(localStorage.getItem("pte_token")).toBe("admin-own-token");
    expect(window.location.href).toBe("");
  });

  it("when the view ends, returns this tab to the admin panel — the admin stays signed in", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ message: "ended", code: "STUDENT_VIEW_ENDED" }) }));
    const { api } = await import("../src/api.js");
    await expect(api.dashboard()).rejects.toThrow();
    expect(sessionStorage.getItem("pte_student_view")).toBeNull();
    expect(localStorage.getItem("pte_token")).toBe("admin-own-token");
    expect(localStorage.getItem("pte_user")).toContain("admin");
    expect(window.location.href).toBe("/");
  });

  it("when several requests all report the view ended at once, the admin still stays signed in", async () => {
    // A page loads several things together, so they fail together. Only the first ends the view;
    // the rest must not mistake the tab for an ordinary signed-in one and clear the sign-in.
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ message: "ended", code: "STUDENT_VIEW_ENDED" }) }));
    const { api } = await import("../src/api.js");
    const results = await Promise.allSettled([api.dashboard(), api.history(), api.auth.me(), api.testSessions.list()]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(sessionStorage.getItem("pte_student_view")).toBeNull();
    expect(localStorage.getItem("pte_token")).toBe("admin-own-token");
    expect(localStorage.getItem("pte_user")).toContain("admin");
    expect(sessionStorage.getItem("pte_login_notice")).toBeNull();
    expect(window.location.href).toBe("/");
  });

  it("an expired pass is ignored: the tab is the admin again", async () => {
    sessionStorage.setItem("pte_student_view", JSON.stringify({ ...VIEW, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    const { api } = await import("../src/api.js");
    await api.dashboard();
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer admin-own-token");
  });

  it("ending the view POSTs once to the end route with the view pass, not the admin's token", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ended: true }) }));
    const { endStudentViewSession } = await import("../src/api.js");
    await expect(endStudentViewSession()).resolves.toEqual({ ended: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url.endsWith("/student-view/end")).toBe(true);
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer view-pass-token");
    // Ending it is up to the caller, once this has succeeded.
    expect(sessionStorage.getItem("pte_student_view")).not.toBeNull();
  });

  it("a view the server already ended counts as ended", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ code: "STUDENT_VIEW_ENDED" }) }));
    const { endStudentViewSession } = await import("../src/api.js");
    await expect(endStudentViewSession()).resolves.toEqual({ ended: true });
  });

  it.each([
    ["a server error", () => Promise.resolve({ ok: false, json: () => Promise.resolve({ code: "SERVER_ERROR", message: "Unexpected server error" }) })],
    ["no connection", () => Promise.reject(new TypeError("Failed to fetch"))]
  ])("on %s it throws and leaves the view open", async (_label, reply) => {
    global.fetch = vi.fn(reply);
    const { endStudentViewSession } = await import("../src/api.js");
    await expect(endStudentViewSession()).rejects.toThrow(/end this student view/);
    expect(sessionStorage.getItem("pte_student_view")).not.toBeNull();
    expect(window.location.href).toBe("");
  });
});
