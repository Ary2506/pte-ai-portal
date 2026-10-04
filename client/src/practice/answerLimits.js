// Input limits for everything a student types into an answer.
//
// The server is the authority: routes/submissions.js rejects a transcript or answer over
// MAX_TEXT_LENGTH with ANSWER_TOO_LONG, and nothing here changes that. These exist so the limit
// is reached in the editor rather than after a round trip — a 100 KB essay was accepted by the
// textarea, counted, and only refused once it had been uploaded and rejected.
//
// Keep ANSWER_MAX_LENGTH in step with MAX_TEXT_LENGTH in server/src/routes/submissions.js.
export const ANSWER_MAX_LENGTH = 6000;

// A single blank holds one word. Generous enough for a long compound, small enough that a paste
// cannot turn one blank into an essay.
export const BLANK_MAX_LENGTH = 60;

// Per-task character caps. Deliberately NOT enforced with maxLength: a student has to be able to
// go over in order to see that they have, and to edit back down. Going over disables Submit
// instead, which is checked again on the server — a limit enforced only in the browser is not a
// limit. ANSWER_MAX_LENGTH above remains the hard ceiling on what can be typed at all.
export const TASK_CHAR_LIMITS = {
  // Writing
  swt: 500,
  essay: 1500,
  // Listening
  "summarize-spoken-text": 400,
  "write-dictation": 100
};

// A typed blank holds one word. Per-task because a listening blank is a single heard word, where
// the generic BLANK_MAX_LENGTH above is deliberately looser.
export const BLANK_CHAR_LIMITS = { "fill-blanks-typed": 15 };

/**
 * Characters excluding whitespace.
 *
 * Spaces, tabs and newlines are formatting, not content: counting them would let the same essay
 * pass or fail depending on how it was spaced, and would punish paragraph breaks.
 */
export function countCharacters(text) {
  return (text || "").replace(/\s/g, "").length;
}

/** Where a length sits relative to the limit, for the counter's tone. */
export function lengthState(length, max = ANSWER_MAX_LENGTH) {
  if (length > max) return "over";
  if (length === max) return "full";
  if (length >= max * 0.9) return "near";
  return "ok";
}

// The global search box filters a fixed list of page and task names; nothing it can hold is
// longer than that, so a longer query is only ever a paste accident.
export const SEARCH_MAX_LENGTH = 25;
