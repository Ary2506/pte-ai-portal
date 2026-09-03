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
  "fill-blanks": { label: "Fill in the Blanks", evaluationType: "objective", shape: "choice-single", sections: ["reading"] },
  reorder: { label: "Re-order Paragraphs", evaluationType: "objective", shape: "reorder", sections: ["reading"] },
  "summarize-spoken-text": { label: "Summarize Spoken Text", evaluationType: "subjective", shape: "prompt-audio", sections: ["listening"] },
  "write-dictation": { label: "Write From Dictation", evaluationType: "objective", shape: "dictation", sections: ["listening"] }
};

export const QUESTION_SECTIONS = ["speaking", "writing", "reading", "listening"];
