import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Product-wide toasts.
//
// What belongs here and what does not, because the distinction decides whether a student can
// recover from a failure:
//
//   TOAST — a transient action failed and the page is still usable. Saving a target score,
//           submitting an answer, finishing a mock. The message is about something the student
//           just did, and the thing to do is try again.
//
//   INLINE — the page itself could not load, or a specific field is wrong. A toast that fades
//           after a few seconds is the wrong home for "this page is empty because the request
//           failed, here is Retry", and for a validation message that belongs beside its input.
//
// Toasts clear themselves, are dismissible by click, and are announced politely, never assertively: an error the
// student caused by pressing a button does not need to interrupt a screen reader mid-sentence.

const ToastContext = createContext(null);

// Errors get longer because they usually have something to read; both clear on their own.
const AUTO_DISMISS_MS = { success: 5000, error: 8000 };
const DEFAULT_DISMISS_MS = 6000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const push = useCallback((message, type = "error") => {
    if (!message) return null;
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, message: String(message), type }]);
    timers.current.set(id, setTimeout(() => dismiss(id), AUTO_DISMISS_MS[type] ?? DEFAULT_DISMISS_MS));
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  const value = useMemo(() => ({
    toast: push,
    error: (message) => push(message, "error"),
    success: (message) => push(message, "success"),
    dismiss
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Always returns a usable object, even with no provider above it — a component should not crash,
 * or have to null-check, because it was rendered in a test or a context that has no toast host.
 */
export function useToast() {
  return useContext(ToastContext) || NO_OP;
}

const NO_OP = { toast: () => null, error: () => null, success: () => null, dismiss: () => {} };

export function ToastHost({ toasts, dismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.type}`} onClick={() => dismiss(t.id)}>
          {t.message}
          <span className="sr-only"> — dismiss</span>
        </button>
      ))}
    </div>
  );
}
