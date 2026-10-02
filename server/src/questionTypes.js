// Single source of truth for every supported question type. evaluationType is ALWAYS derived
// from this registry — never trusted from client input (see validation/questionValidation.js).
// "shape" tells the validator (and the admin form) which fields are required/relevant.
export const QUESTION_TYPES = {
  "read-aloud": { label: "Read Aloud", evaluationType: "subjective", shape: "prompt-only", sections: ["speaking"] },
  "repeat-sentence": { label: "Repeat Sentence", evaluationType: "subjective", shape: "prompt-only", sections: ["speaking"] },
  "describe-image": { label: "Describe Image", evaluationType: "subjective", shape: "prompt-image", sections: ["speaking"] },
  "answer-short-question": { label: "Answer Short Question", evaluationType: "subjective", shape: "prompt-only", sections: ["speaking"] },
  swt: { label: "Summarize Written Text", evaluationType: "subjective", shape: "prompt-passage", sections: ["writing"] },
  essay: { label: "Essay", evaluationType: "subjective", shape: "prompt-only", sections: ["writing"] },
  "mcq-single": { label: "Multiple Choice (single answer)", evaluationType: "objective", shape: "choice-single", sections: ["reading", "listening"] },
  "mcq-multiple": { label: "Multiple Choice (multiple answers)", evaluationType: "objective", shape: "choice-multiple", sections: ["reading", "listening"] },
  // Reused for both sections: same shape/scorer either way, the only difference is that the
  // listening variant needs an audio clip (already enforced generically — see
  // validation/questionValidation.js's section==="listening" check on the choice-single branch).
  reorder: { label: "Re-order Paragraphs", evaluationType: "objective", shape: "reorder", sections: ["reading"] },
  "summarize-spoken-text": { label: "Summarize Spoken Text", evaluationType: "subjective", shape: "prompt-audio", sections: ["listening"] },
  "write-dictation": { label: "Write From Dictation", evaluationType: "objective", shape: "dictation", sections: ["listening"] },

  // Phase 20 additions. Each reuses an existing shape/scorer wherever the underlying data model
  // is genuinely the same — new code was only written where the task is structurally different
  // (fill-blanks-dragdrop's per-blank word assignment has no existing equivalent).
  "respond-to-situation": {
    // Same shape as summarize-spoken-text (an audio prompt, evaluated from a transcript) — the
    // student's response here is spoken, not written, but that is decided by `section`
    // ("speaking"), not by shape; shape only drives what the admin form/validation require.
    label: "Respond to a Situation", evaluationType: "subjective", shape: "prompt-audio", sections: ["speaking"]
  },
  "write-email": { label: "Write Email", evaluationType: "subjective", shape: "prompt-only", sections: ["writing"] },
  "select-missing-word": {
    // Mechanically identical to listening mcq-single (audio + one correct option) — kept as its
    // own type so it gets its own content bucket and menu entry, not folded into mcq-single.
    label: "Select Missing Word", evaluationType: "objective", shape: "choice-single", sections: ["listening"]
  },
  "highlight-incorrect-words": {
    // The displayed transcript's words ARE the options (one word per option, in reading order);
    // the answer is the set of word-positions that are wrong — structurally identical to
    // mcq-multiple's "set of correct option indices" model, so it reuses that scorer unchanged.
    label: "Highlight Incorrect Words", evaluationType: "objective", shape: "choice-multiple", sections: ["listening"]
  },
  "fill-blanks-dragdrop": {
    label: "Fill in the Blanks (Drag and Drop)", evaluationType: "objective", shape: "drag-fill", sections: ["reading"]
  },
  // Listening's Fill in the Blanks, which is a different exercise from Reading's despite the
  // shared name: the student types a word into each of several blanks instead of picking one
  // option. It carried that name only because its questions used to live in a bundled file and
  // were scored in the browser, so nothing server-side ever had to tell the two apart.
  // Reading & Writing: Fill in the Blanks. Every blank carries its own four or five options, so
  // unlike fill-blanks-dragdrop there is no shared word bank and unlike fill-blanks there is more
  // than one blank — which is why it needs a type rather than bending either of those.
  "fib-dropdown": {
    label: "Fill in the Blanks (Dropdown)", evaluationType: "objective", shape: "dropdown-blanks", sections: ["reading"]
  },
  "fill-blanks-typed": {
    label: "Fill in the Blanks (Typed)", evaluationType: "objective", shape: "typed-blanks", sections: ["listening"]
  }
};

export const QUESTION_SECTIONS = ["speaking", "writing", "reading", "listening"];
