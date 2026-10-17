import summarizeSpokenText from "../../../content/listening/summarize-spoken-text/summarize_spoken_text.json";

// Transcripts for listening questions, looked up from the authored content that ships with the
// client when the stored question does not carry one.
//
// For most audio tasks the transcript IS the answer key, so it is never shown before the attempt:
// Repeat Sentence is the sentence to say back, Write From Dictation the sentence to type, Fill in
// the Blanks contains every blanked word, Highlight Incorrect Words shows exactly which words
// differ, and Select Missing Word ends on the missing word. The server strips the transcript from
// those payloads; TRANSCRIPT_IS_ANSWER below stops this fallback from putting it straight back.
//
// Summarize Spoken Text is the one listening task where a transcript is a genuine study aid
// rather than a key — you summarise that audio, you do not transcribe it — so it is the only
// content file bundled here. The others were removed once the rule above made them unreachable.

/** Mirrors TRANSCRIPT_IS_ANSWER in server/src/transcriptPolicy.js. */
export const TRANSCRIPT_IS_ANSWER = new Set([
  "repeat-sentence", "write-dictation", "fill-blanks-typed",
  "highlight-incorrect-words", "select-missing-word", "mcq-single"
]);

/** Each file is either an array of questions or a single question object. */
const asList = content => (Array.isArray(content) ? content : content ? [content] : []);

const SOURCES = [
  { type: "summarize-spoken-text", file: "summarize_spoken_text.json", items: asList(summarizeSpokenText) }
];

// sourceGroup is the only exact link to an authored item, and it is globally unique because it
// carries the filename. Everything else has to be scoped by question type: authored ids restart
// per file, so an unscoped id map could hand back another type's transcript.
const BY_SOURCE_GROUP = new Map();
const BY_TYPE_ID = new Map();
const BY_TYPE_TITLE = new Map();

const typeKey = (type, value) => `${type}\u0000${value}`;

for (const { type, file, items } of SOURCES) {
  for (const item of items) {
    const transcript = item?.transcript || item?.audio?.transcript || "";
    if (!transcript) continue;
    if (item.id !== undefined) {
      BY_SOURCE_GROUP.set(`${file}#${item.id}`, transcript);
      BY_TYPE_ID.set(typeKey(type, item.id), transcript);
    }
    // Titles are not unique in the authored bank — two Summarize Spoken Text items may cover the
    // same subject with different audio. First-wins would hand the second one the first one's
    // transcript, which is the failure this module exists to prevent, so an ambiguous title is
    // marked unusable instead. Those items are still reachable by sourceGroup or authored id,
    // both of which are exact.
    const titled = typeKey(type, item.title);
    if (!item.title) continue;
    if (BY_TYPE_TITLE.has(titled)) BY_TYPE_TITLE.set(titled, null);
    else BY_TYPE_TITLE.set(titled, transcript);
  }
}

/**
 * The transcript to show for a listening question: the stored one if it has one, otherwise the
 * authored one, otherwise "" — which the caller must treat as "none exists", never as an error.
 */
export function localTranscriptFor(question) {
  if (!question) return "";
  // Never surface a transcript that is the answer, whatever its source.
  if (TRANSCRIPT_IS_ANSWER.has(question.type)) return "";
  if (question.transcript?.trim()) return question.transcript;

  if (question.sourceGroup) {
    const bySource = BY_SOURCE_GROUP.get(question.sourceGroup);
    if (bySource) return bySource;
  }
  // Both remaining routes need a type to be safe. A question without one is a question this
  // cannot identify, and a wrong transcript is worse than none.
  if (!question.type) return "";
  return (
    BY_TYPE_ID.get(typeKey(question.type, question._id)) ||
    (question.title && BY_TYPE_TITLE.get(typeKey(question.type, question.title))) ||
    ""
  );
}
