// Single source of truth for the desired PTE Practice navigation (Phase 17) — the mega-menu, the
// /practice hub, and the in-page tab strip all read from this, so they can never drift apart.
//
// `supported: true` means this exact slug is registered in server/src/questionTypes.js and is
// really validated/scored there — checked against that file directly before being marked true,
// never guessed. `hasAI` mirrors that type's evaluationType === "subjective". A supported type
// can still have zero active questions today (a *content* gap) — that is never encoded here; it
// is checked at runtime against the real GET /api/questions response (see PracticeHub).
//
// `bundledContent: true` is the exception to that rule, and only because the rule cannot apply:
// the task's material ships with the client instead of living in the question bank, so asking the
// API how many questions of that type exist will always answer "none" however complete the task
// is. Set it ONLY for a task whose content is genuinely client-side; a DB-backed type that simply
// has no rows yet is a content gap and must keep reporting itself as empty.
export const PRACTICE_SECTIONS = ["speaking", "writing", "reading", "listening"];

export const SECTION_LABELS = { speaking: "Speaking", writing: "Writing", reading: "Reading", listening: "Listening" };

export const PRACTICE_TASKS = {
  speaking: [
    { slug: "read-aloud", label: "Read Aloud", supported: true, hasAI: true },
    { slug: "repeat-sentence", label: "Repeat Sentence", supported: true, hasAI: true },
    { slug: "describe-image", label: "Describe Image", supported: true, hasAI: true },
    { slug: "answer-short-question", label: "Answer Short Question", supported: true, hasAI: true },
    { slug: "respond-to-situation", label: "Respond to a Situation", supported: true, hasAI: true }
  ],
  writing: [
    { slug: "swt", label: "Summarize Written Text", supported: true, hasAI: true },
    // Content is client/public/writing-resources/write-email-samples.pdf, rendered by
    // WriteEmailPdf — 12 worked samples to read, with no submission and so nothing AI-scored.
    { slug: "write-email", label: "Write Email", supported: true, hasAI: false, bundledContent: true, contentLabel: "Samples" },
    { slug: "essay", label: "Write Essay", supported: false, hasAI: true }
  ],
  reading: [
    { slug: "mcq-multiple", label: "Multiple Choice Multiple", supported: true, hasAI: false },
    { slug: "reorder", label: "Reorder Paragraph", supported: true, hasAI: false },
    { slug: "fill-blanks-dragdrop", label: "Fill in the Blanks Drag/Drop", supported: true, hasAI: false },
    { slug: "fib-dropdown", label: "Fill in the Blanks Dropdown", supported: true, hasAI: false },
    { slug: "mcq-single", label: "Multiple Choice Single", supported: true, hasAI: false }
  ],
  listening: [
    { slug: "summarize-spoken-text", label: "Summarize Spoken Text", supported: true, hasAI: true },
    { slug: "mcq-multiple", label: "Multiple Choice Multiple", supported: true, hasAI: false },
    { slug: "fill-blanks-typed", label: "Fill in the Blanks", supported: true, hasAI: false },
    { slug: "mcq-single", label: "Multiple Choice Single", supported: true, hasAI: false },
    { slug: "select-missing-word", label: "Select Missing Word", supported: true, hasAI: false },
    { slug: "highlight-incorrect-words", label: "Highlight Incorrect Words", supported: true, hasAI: false },
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
