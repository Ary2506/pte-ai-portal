import summarizeSpokenText from "../../../content/listening/summarize-spoken-text/summarize_spoken_text.json";
import multipleChoiceSingle from "../../../content/listening/multiple-choice-single/multiple_choice_single.json";
import selectMissingWords from "../../../content/listening/select-missing-words/select_missing_words.json";

// Transcripts for listening questions, looked up from the authored content that ships with the
// client when the stored question does not carry one.
//
// Questions are served from MongoDB, and a row only has a transcript if whatever created it put
// one there. Rows written by `migrateListeningToDb.js` do; rows added later through the admin
// panel generally do not, because the question form has no transcript field. That is why the
// Transcript button appeared on some listening questions and not others.
//
// This used to live inline in PracticeObjective.jsx and covered exactly one type —
// summarize-spoken-text — which is why multiple-choice and select-missing-word had no fallback
// at all even though their own content files carry a transcript. Every type with authored local
// content is registered here instead.
//
// Only the small files are bundled. fill-in-the-blanks (172K) and write-from-dictation (20K) are
// deliberately left out: neither authors a transcript, and the blanked passage and the dictated
// sentence are already on screen, so there would be nothing for a transcript to add.

/** `transcript` sits at the top level in one file and under `audio` in the others. */
const readTranscript = item => item?.transcript || item?.audio?.transcript || "";

/** Each file is either an array of questions or a single question object. */
const asList = content => (Array.isArray(content) ? content : content ? [content] : []);

const SOURCES = [
  { type: "summarize-spoken-text", file: "summarize_spoken_text.json", items: asList(summarizeSpokenText) },
  { type: "mcq-single", file: "multiple_choice_single.json", items: asList(multipleChoiceSingle) },
  { type: "select-missing-word", file: "select_missing_words.json", items: asList(selectMissingWords) }
];

// sourceGroup is the only exact link to an authored item, and it is globally unique because it
// carries the filename. Everything else has to be scoped by question type: the authored ids
// restart per file, so summarize-spoken-text #72 and select-missing-word #72 are different
// questions, and an unscoped id map silently handed back the wrong transcript.
const BY_SOURCE_GROUP = new Map();
const BY_TYPE_ID = new Map();
const BY_TYPE_TITLE = new Map();

const typeKey = (type, value) => `${type}\u0000${value}`;

for (const { type, file, items } of SOURCES) {
  for (const item of items) {
    const transcript = readTranscript(item);
    if (!transcript) continue;
    if (item.id !== undefined) {
      BY_SOURCE_GROUP.set(`${file}#${item.id}`, transcript);
      BY_TYPE_ID.set(typeKey(type, item.id), transcript);
    }
    // First item wins a repeated title, which is the best that can be done — the alternative is
    // no fallback at all for either of them.
    const titled = typeKey(type, item.title);
    if (item.title && !BY_TYPE_TITLE.has(titled)) BY_TYPE_TITLE.set(titled, transcript);
  }
}

/**
 * The transcript to show for a listening question: the stored one if it has one, otherwise the
 * authored one, otherwise "" — which the caller must treat as "none exists", never as an error.
 */
export function localTranscriptFor(question) {
  if (!question) return "";
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
