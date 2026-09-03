// Single source of truth for the desired PTE Practice navigation (Phase 17) — the mega-menu, the
// /practice hub, and the in-page tab strip all read from this, so they can never drift apart.
//
// `supported: true` means this exact slug is registered in server/src/questionTypes.js and is
// really validated/scored there — checked against that file directly before being marked true,
// never guessed. `hasAI` mirrors that type's evaluationType === "subjective". A supported type
// can still have zero active questions today (a *content* gap) — that is never encoded here; it
// is checked at runtime against the real GET /api/questions response (see PracticeHub).
export const PRACTICE_SECTIONS = ["speaking", "writing", "reading", "listening"];

export const SECTION_LABELS = { speaking: "Speaking", writing: "Writing", reading: "Reading", listening: "Listening" };

export const PRACTICE_TASKS = {
  speaking: [
    { slug: "read-aloud", label: "Read Aloud", supported: true, hasAI: true },
    { slug: "repeat-sentence", label: "Repeat Sentence", supported: true, hasAI: true },
    { slug: "describe-image", label: "Describe Image", supported: true, hasAI: true },
    { slug: "answer-short-question", label: "Answer Short Question", supported: true, hasAI: true },
    { slug: "respond-to-situation", label: "Respond to a Situation", supported: false, hasAI: false }
  ],
  writing: [
    { slug: "swt", label: "Summarize Written Text", supported: true, hasAI: true },
    { slug: "write-email", label: "Write Email", supported: false, hasAI: false },
    { slug: "essay", label: "Write Essay", supported: true, hasAI: true }
  ],
  reading: [
    { slug: "fill-blanks", label: "Fill in the Blanks", supported: true, hasAI: false },
    { slug: "mcq-multiple", label: "Multiple Choice Multiple", supported: true, hasAI: false },
    { slug: "reorder", label: "Reorder Paragraph", supported: true, hasAI: false },
    { slug: "fill-blanks-dragdrop", label: "Fill in the Blanks Drag/Drop", supported: false, hasAI: false },
    { slug: "mcq-single", label: "Multiple Choice Single", supported: true, hasAI: false }
  ],
  listening: [
    { slug: "summarize-spoken-text", label: "Summarize Spoken Text", supported: true, hasAI: true },
    { slug: "mcq-multiple", label: "Multiple Choice Multiple", supported: true, hasAI: false },
    { slug: "fill-blanks", label: "Fill in the Blanks", supported: false, hasAI: false },
    { slug: "mcq-single", label: "Multiple Choice Single", supported: true, hasAI: false },
    { slug: "select-missing-word", label: "Select Missing Word", supported: false, hasAI: false },
    { slug: "highlight-incorrect-words", label: "Highlight Incorrect Words", supported: false, hasAI: false },
    { slug: "write-dictation", label: "Write From Dictation", supported: true, hasAI: false }
  ]
};

// "More" menu items. `to: null` means the destination genuinely doesn't exist yet in this
// portal — rendered disabled with a Coming Soon tag, never a dead link pretending to work.
export const MORE_ITEMS = [
  { key: "vocabulary", label: "Vocabulary", to: null },
  { key: "shadowing", label: "Shadowing", to: null },
  { key: "ai-analysis", label: "AI Score Report Analysis", to: null },
  { key: "study-plan", label: "AI Study Plan", to: "/plan" },
  { key: "mock", label: "Mock Tests", to: "/mock" },
  { key: "study-materials", label: "Study Materials", to: null },
  { key: "history", label: "Practice History", to: "/history" }
];

export function supportedTasksFor(section) {
  return (PRACTICE_TASKS[section] || []).filter(t => t.supported);
}

export function taskInfo(section, slug) {
  return (PRACTICE_TASKS[section] || []).find(t => t.slug === slug) || null;
}
