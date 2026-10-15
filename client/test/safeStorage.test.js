import { describe, it, expect, vi, afterEach } from "vitest";

// localStorage does not return null when it is unavailable — it THROWS. A browser with site data
// blocked, an in-app webview (a student opening the link from WhatsApp or Instagram), or strict
// privacy settings all raise SecurityError on first use.
//
// That mattered because getDeviceId() in api.js touches localStorage on EVERY request, unguarded.
// One throw there did not break a feature, it made every API call fail — so the whole app looked
// dead to exactly the users least equipped to diagnose it.
//
// The module resolves its backing store once at import, so each scenario needs a fresh import
// with the environment already in place.
async function freshImport() {
  vi.resetModules();
  return import("../src/safeStorage.js");
}

const realLocal = Object.getOwnPropertyDescriptor(window, "localStorage");

function installStorage(impl) {
  Object.defineProperty(window, "localStorage", { value: impl, configurable: true, writable: true });
}

afterEach(() => {
  if (realLocal) Object.defineProperty(window, "localStorage", realLocal);
  vi.resetModules();
});

describe("when storage works normally", () => {
  it("reads and writes through to the real store", async () => {
    const { safeLocal } = await freshImport();

    safeLocal.setItem("pte_token", "abc123");
    expect(safeLocal.getItem("pte_token")).toBe("abc123");

    safeLocal.removeItem("pte_token");
    expect(safeLocal.getItem("pte_token")).toBeNull();
  });

  it("returns null for a key that was never set", async () => {
    const { safeLocal } = await freshImport();
    expect(safeLocal.getItem("never_written")).toBeNull();
  });
});

describe("when the browser blocks storage entirely", () => {
  // Safari with site data blocked: the object exists, and every method throws.
  const throwing = {
    getItem() { throw new DOMException("The operation is insecure.", "SecurityError"); },
    setItem() { throw new DOMException("The operation is insecure.", "SecurityError"); },
    removeItem() { throw new DOMException("The operation is insecure.", "SecurityError"); }
  };

  it("does not throw — which is the whole point", async () => {
    installStorage(throwing);
    const { safeLocal } = await freshImport();

    // Previously each of these took down every API request that touched it.
    expect(() => safeLocal.setItem("pte_token", "abc")).not.toThrow();
    expect(() => safeLocal.getItem("pte_token")).not.toThrow();
    expect(() => safeLocal.removeItem("pte_token")).not.toThrow();
  });

  it("keeps the value for the life of the tab via the in-memory fallback", async () => {
    installStorage(throwing);
    const { safeLocal } = await freshImport();

    safeLocal.setItem("pte_token", "abc123");

    // The user stays signed in while they browse; they are simply not remembered after a reload.
    // Far better than a site that cannot make a single request.
    expect(safeLocal.getItem("pte_token")).toBe("abc123");
  });

  it("reports that storage is unavailable", async () => {
    installStorage(throwing);
    const { storageAvailable } = await freshImport();
    expect(storageAvailable.local).toBe(false);
  });

  it("still forgets a removed key", async () => {
    installStorage(throwing);
    const { safeLocal } = await freshImport();

    safeLocal.setItem("pte_token", "abc123");
    safeLocal.removeItem("pte_token");

    // Sign-out has to work even with no durable storage, or a shared device leaks a session.
    expect(safeLocal.getItem("pte_token")).toBeNull();
  });
});

describe("when the store is full", () => {
  it("falls back to memory rather than throwing on write", async () => {
    installStorage({
      getItem: () => null,
      setItem() { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
      removeItem: () => {}
    });
    const { safeLocal } = await freshImport();

    expect(() => safeLocal.setItem("pte_token", "abc")).not.toThrow();
    expect(safeLocal.getItem("pte_token")).toBe("abc");
  });
});
