// One dynamic import per listening question type, instead of the static imports this file used
// to hold. Those pulled all six type modules — and through them all six JSON content files,
// about 235KB of prompts, transcripts, options and answers — into the main bundle, so opening
// Summarize Spoken Text also paid for 173KB of fill-in-the-blanks, and the Practice hub paid for
// every one of them merely to list which types exist.
//
// Each entry resolves to that type's question array, and Vite gives each its own chunk, fetched
// the first time that task is opened and cached by the browser afterwards. Adding a type is
// still one file plus one line here.
const LOADERS = {
  "summarize-spoken-text": () => import("./summarizeSpokenText.js").then(m => m.summarizeSpokenTextQuestions),
  "fill-blanks": () => import("./fillBlanks.js").then(m => m.fillBlanksQuestions),
  "mcq-single": () => import("./mcqSingle.js").then(m => m.mcqSingleQuestions),
  "select-missing-word": () => import("./selectMissingWord.js").then(m => m.selectMissingWordQuestions),
  "highlight-incorrect-words": () => import("./highlightIncorrectWords.js").then(m => m.highlightIncorrectWordsQuestions),
  "write-dictation": () => import("./writeDictation.js").then(m => m.writeDictationQuestions),
};

// The type slugs alone, derived from the loader map so the two can never disagree. This is what
// lets the Practice hub show which listening types have local content without loading any of it
// — previously it read the same fact off the fully-materialised question list.
export const LISTENING_TYPES = Object.keys(LOADERS);

// Returns a promise for one type's questions, or an empty list for a type with no local content
// (every listening type that is served from the question database instead).
export function loadListeningQuestions(type) {
  const loader = LOADERS[type];
  return loader ? loader() : Promise.resolve([]);
}
