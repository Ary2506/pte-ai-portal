// Task guidance for every practice task, in one place.
//
// This started as a local constant inside Speaking.jsx, which is why the speaking workspace had a
// tips sidebar and the writing, reading and listening workspaces did not — the content existed,
// but only one component could see it. Moving it here is what lets all four render the same
// panel, and it means adding a task's advice is a change to one file rather than to whichever
// workspace happens to own that task.
//
// A task with no entry falls back to its section's list, so a newly-registered task never leaves
// an empty panel.

/** Fallbacks, by section — deliberately real advice, not placeholder text. */
export const SECTION_TIPS = {
  speaking: [
    "Maintain steady fluency.",
    "Pronounce words clearly.",
    "Avoid long pauses.",
    "Focus on the whole prompt."
  ],
  writing: [
    "Answer the exact task that was set.",
    "Use clear, complete sentences.",
    "Check grammar and spelling before submitting.",
    "Keep every idea relevant to the prompt."
  ],
  reading: [
    "Read the question before the passage.",
    "Look for the sentence that carries the answer.",
    "Rule out options that are only partly right.",
    "Trust the passage, not prior knowledge."
  ],
  listening: [
    "Read the question while the audio loads.",
    "Listen for the speaker's main point first.",
    "Note numbers and names as you hear them.",
    "Do not wait for a word to be repeated."
  ]
};

export const TASK_TIPS = {
  // --- Speaking ---
  "read-aloud": [
    "Read at a natural, steady pace.",
    "Pronounce every word clearly.",
    "Use natural intonation, not a flat monotone.",
    "Don't rush — fluency matters more than speed."
  ],
  "repeat-sentence": [
    "Listen to the whole sentence before speaking.",
    "Match the speaker's rhythm and stress.",
    "Repeat it in one go, without restarting."
  ],
  "describe-image": [
    "Open by saying what kind of image it is.",
    "Give the highest and lowest values, or the main trend.",
    "Close with one sentence of interpretation."
  ],
  "answer-short-question": [
    "Answer in one or two words — nothing more is expected.",
    "Reply as soon as the audio ends."
  ],
  "respond-to-situation": [
    "Address the person and the situation directly.",
    "Keep a polite, natural register.",
    "Cover every part of what you were asked to say."
  ],

  // --- Writing ---
  swt: [
    "Write one sentence — a full stop ends your answer.",
    "Keep it between 40 and 100 words.",
    "Include the passage's main idea and its key support.",
    "Join clauses with 'and', 'which' or 'because' rather than starting again."
  ],
  essay: [
    "Plan your position before you start writing.",
    "One idea per paragraph, each with an example.",
    "Aim for 200–300 words — longer is not better.",
    "Leave a minute to re-read for grammar and spelling."
  ],
  email: [
    "Open and close in the register the prompt asks for.",
    "Cover every bullet point you were given.",
    "Keep paragraphs short — one purpose each.",
    "Sign off the way the scenario expects."
  ],

  // --- Reading ---
  "mcq-single": [
    "Find the line in the passage that settles it.",
    "An option can be true and still not be the answer.",
    "Watch for 'always', 'never' and 'only'."
  ],
  "mcq-multiple": [
    "There is more than one correct option — find them all.",
    "A wrong selection costs you, so do not guess freely.",
    "Check each option against the passage separately."
  ],
  reorder: [
    "Find the sentence that introduces the topic — it opens.",
    "Follow pronouns and linking words to the next sentence.",
    "Read your order through before submitting."
  ],
  "fill-blanks-dragdrop": [
    "Read the whole sentence before choosing a word.",
    "Use grammar — the word before the blank narrows it fast.",
    "Some words in the pool are decoys and fit nowhere."
  ],
  "fill-blanks-typed": [
    "Spelling counts — type the word exactly.",
    "Use the sentence's grammar to pick the right form.",
    "Fill the blanks you are sure of first."
  ],

  // --- Listening ---
  "summarize-spoken-text": [
    "Note key points while listening — you hear it once.",
    "Write 50–70 words covering the main idea.",
    "Paraphrase rather than quoting the recording."
  ],
  "write-dictation": [
    "Type the sentence exactly as you heard it.",
    "Every correct word scores, so write what you caught.",
    "Check plurals, tense and capital letters."
  ],
  "highlight-incorrect-words": [
    "Follow the transcript with your eyes as it plays.",
    "Mark a word the moment it differs from the audio.",
    "A wrong mark costs you — leave it if you are unsure."
  ],
  "highlight-correct-summary": [
    "Listen for the overall point, not individual details.",
    "Rule out a summary that adds something never said.",
    "The longest option is not automatically the right one."
  ],
  "select-missing-word": [
    "The answer completes the speaker's final thought.",
    "Listen to how the sentence is heading, not just its last words."
  ]
};

/** The heading a task's panel carries — its proper name, not its slug. */
export const TASK_TIP_HEADINGS = {
  "read-aloud": "Read Aloud",
  "repeat-sentence": "Repeat Sentence",
  "describe-image": "Describe Image",
  "answer-short-question": "Answer Short Question",
  "respond-to-situation": "Respond to a Situation",
  swt: "Summarize Written Text",
  essay: "Write Essay",
  email: "Write Email",
  "mcq-single": "Multiple Choice",
  "mcq-multiple": "Multiple Choice",
  reorder: "Re-order Paragraphs",
  "fill-blanks-dragdrop": "Fill in the Blanks",
  "fill-blanks-typed": "Fill in the Blanks",
  "summarize-spoken-text": "Summarize Spoken Text",
  "write-dictation": "Write from Dictation",
  "highlight-incorrect-words": "Highlight Incorrect Words",
  "highlight-correct-summary": "Highlight Correct Summary",
  "select-missing-word": "Select Missing Word"
};

const SECTION_LABELS = {
  speaking: "Speaking", writing: "Writing", reading: "Reading", listening: "Listening"
};

/** The tips to show for a task, falling back to its section rather than to nothing. */
export function tipsFor(type, section) {
  return TASK_TIPS[type] || SECTION_TIPS[section] || [];
}

/** The panel's heading, falling back to the section name. */
export function tipHeadingFor(type, section) {
  return TASK_TIP_HEADINGS[type] || SECTION_LABELS[section] || "Practice";
}
