// localStorage and sessionStorage are not always available, and when they are not they do not
// return null -- they THROW. A browser with site data blocked, an in-app webview (students opening
// a link from WhatsApp or Instagram), or strict privacy settings all raise SecurityError on the
// first access.
//
// That mattered here because getDeviceId() in api.js touches localStorage on EVERY request. An
// unguarded throw there did not degrade one feature; it made every API call fail, so the app
// looked completely broken to exactly the users least able to work out why.
//
// These wrappers never throw. Reads return null when storage is unavailable and writes are no-ops,
// with an in-memory fallback so a session still works for as long as the tab is open -- the user
// stays signed in while browsing, and simply is not remembered after a reload. That is a far
// better outcome than a site that does not load at all.
const memory = new Map();

function backing(kind) {
  try {
    const store = kind === "session" ? window.sessionStorage : window.localStorage;
    // Presence is not enough: Safari exposes the object and throws on use. Probe it.
    const probe = "__pte_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

// Resolved once. A browser does not change its mind about this mid-session, and probing on every
// call would mean two extra storage writes per API request.
const stores = {
  local: backing("local"),
  session: backing("session")
};

export const storageAvailable = {
  get local() { return stores.local !== null; },
  get session() { return stores.session !== null; }
};

function read(kind, key) {
  const store = stores[kind];
  if (!store) return memory.has(`${kind}:${key}`) ? memory.get(`${kind}:${key}`) : null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(kind, key, value) {
  const store = stores[kind];
  if (!store) {
    memory.set(`${kind}:${key}`, String(value));
    return;
  }
  try {
    store.setItem(key, value);
  } catch {
    // Quota exceeded, or permission revoked after the probe succeeded. Keep it in memory so the
    // current tab carries on working.
    memory.set(`${kind}:${key}`, String(value));
  }
}

function remove(kind, key) {
  memory.delete(`${kind}:${key}`);
  const store = stores[kind];
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Nothing useful to do, and a failed sign-out cleanup must not throw into the caller.
  }
}

export const safeLocal = {
  getItem: (key) => read("local", key),
  setItem: (key, value) => write("local", key, value),
  removeItem: (key) => remove("local", key)
};

export const safeSession = {
  getItem: (key) => read("session", key),
  setItem: (key, value) => write("session", key, value),
  removeItem: (key) => remove("session", key)
};
