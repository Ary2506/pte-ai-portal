import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { warmApi, resetWarmApiForTests } from "../src/warmApi.js";

// The API sleeps when idle and takes about a minute to boot. Without this, that whole wait lands
// on the student at the worst moment — right after they press Sign in. Firing a request as the
// landing page mounts moves the boot into the time they spend reading and typing.
//
// Everything here is about it being harmless: a warm-up that can throw, block rendering, or spam
// the server would cost more than the delay it saves.
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetWarmApiForTests();
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("waking the API", () => {
  it("requests the health endpoint on the API's own origin", () => {
    warmApi();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/health$/);
    // Not the /api prefix twice over — health sits at the origin's own /api/health.
    expect(url).not.toMatch(/\/api\/api\//);
  });

  it("bypasses the cache, since a cached 200 would never reach the sleeping server", () => {
    warmApi();
    const [, options] = globalThis.fetch.mock.calls[0];
    expect(options.cache).toBe("no-store");
  });

  it("fires once per page load, not once per effect run", () => {
    // React invokes effects twice in development StrictMode, and a remount should not mean a
    // second request either.
    warmApi();
    warmApi();
    warmApi();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("it can never break the page", () => {
  it("swallows a rejected request", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("service unavailable")));

    expect(() => warmApi()).not.toThrow();
    // An unhandled rejection here would surface as a console error on a page that is working
    // perfectly well; the sign-in attempt is what reports a real outage.
    await Promise.resolve();
  });

  it("swallows a synchronous throw", () => {
    globalThis.fetch = vi.fn(() => { throw new TypeError("unsupported option"); });
    expect(() => warmApi()).not.toThrow();
  });

  it("does nothing at all where fetch is unavailable", () => {
    globalThis.fetch = undefined;
    expect(() => warmApi()).not.toThrow();
  });
});
