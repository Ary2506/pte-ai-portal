import { useEffect, useRef, useState } from "react";
import { safeLocal } from "../safeStorage.js";

// Keeps what a student has typed, so closing the tab, a refresh, or a browser that reloads itself
// does not throw away a half-written essay.
//
// This is separate from the mock's Save button. Save is a deliberate act that marks a question as
// answered-but-not-submitted; this is the invisible safety net under the textarea, running on
// every keystroke and meaning nothing about the student's intent. A question with a persisted
// draft is NOT treated as saved and scores nothing on its own.
//
// Cleared as soon as the answer is submitted: a submitted question cannot be edited, so a leftover
// draft would only reappear as a ghost on a later visit.

/**
 * Where one question's in-progress text lives.
 *
 * Scoped by attempt for a mock, so a second sitting of the same test never inherits the first
 * one's typing, and by question alone for standalone practice, where there is no attempt to
 * scope to and returning to a half-written answer is the point.
 */
export function textDraftKey({ testSessionId, questionId }) {
  if (!questionId) return null;
  return testSessionId
    ? `pte_text_mock_${testSessionId}_${questionId}`
    : `pte_text_practice_${questionId}`;
}

/** Reads a stored draft, or "" when there is none. Never throws. */
export function readTextDraft(key) {
  if (!key) return "";
  const stored = safeLocal.getItem(key);
  return typeof stored === "string" ? stored : "";
}

export function clearTextDraft(key) {
  if (key) safeLocal.removeItem(key);
}

/**
 * Persists `text` under `key` as it changes.
 *
 * Writes are debounced because this runs on every keystroke and localStorage is synchronous —
 * writing a 1,500-character essay on each one would be janky on a slow device for no benefit.
 * The final value is flushed on unmount so navigating away never loses the last few characters.
 */
export function usePersistTextDraft(key, text, { enabled = true } = {}) {
  const latest = useRef(text);
  latest.current = text;

  useEffect(() => {
    if (!key || !enabled) return undefined;
    const id = setTimeout(() => {
      if (latest.current) safeLocal.setItem(key, latest.current);
      else safeLocal.removeItem(key);
    }, 400);
    return () => clearTimeout(id);
  }, [key, text, enabled]);

  useEffect(() => {
    if (!key || !enabled) return undefined;
    return () => {
      // Unmounting is the one moment a pending debounce would be lost, so flush it.
      if (latest.current) safeLocal.setItem(key, latest.current);
    };
  }, [key, enabled]);
}

/**
 * Text state that restores itself.
 *
 * `seed` is whatever the caller already had — a submitted answer, or a saved draft — and always
 * wins, because a persisted keystroke draft is the least authoritative of the three.
 */
export function usePersistedText(key, seed, { enabled = true } = {}) {
  const [text, setText] = useState(() => seed || (enabled ? readTextDraft(key) : ""));
  usePersistTextDraft(key, text, { enabled });
  return [text, setText];
}
