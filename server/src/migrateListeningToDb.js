import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";

// Moves the six bundled listening files into the question bank, so Listening stops being served
// from client/content while ten database rows of the same types sit unreachable behind it.
//
//   node src/migrateListeningToDb.js [--write]
//
// Dry run by default. Re-running is safe and picks up edits: every row is linked back to its
// source entry through `sourceGroup`, so a reworded transcript updates that row instead of
// inserting a second copy of the question.
//
// Deliberately stores the authored `content` array rather than the render-ready shape the client
// builds from it. Fill in the Blanks and Highlight Incorrect Words need per-blank answers, word
// segments and incorrect-word indices, and all of those are derived — see
// practice/listeningData/shared.js, which keeps doing the deriving after this migration.

const CONTENT_ROOT = path.resolve("../client/content/listening");

// audioUrl is stored as a root-relative path, not an absolute URL. The client prefixes it with
// VITE_AUDIO_BASE, so moving these clips to a CDN later is a configuration change rather than a
// rewrite of every stored question.
const audioPath = (folder, src) => (src ? `/audio/listening/${folder}/${src}` : undefined);

const SOURCES = [
  {
    type: "summarize-spoken-text",
    folder: "summarize-spoken-text",
    file: "summarize-spoken-text/summarize_spoken_text.json",
    evaluationType: "subjective",
    prompt: "Listen to the short practice audio and summarize the main idea in your own words.",
    // Unlike every other file here, this one keeps the transcript at the top level.
    transcript: item => item.transcript || "",
  },
  {
    type: "write-dictation",
    folder: "write-from-dictation",
    file: "write-from-dictation/write_from_dictation.json",
    evaluationType: "objective",
    prompt: "Listen to the recording and write the sentence you hear.",
    answer: item => item.answer,
  },
  {
    type: "mcq-single",
    folder: "multiple-choice-single",
    file: "multiple-choice-single/multiple_choice_single.json",
    evaluationType: "objective",
    choice: true,
  },
  {
    type: "select-missing-word",
    folder: "select-missing-words",
    file: "select-missing-words/select_missing_words.json",
    evaluationType: "objective",
    choice: true,
  },
  {
    type: "fill-blanks",
    folder: "fill-in-the-blanks",
    file: "fill-in-the-blanks/fill_in_the_blanks.json",
    evaluationType: "objective",
    structured: true,
  },
  {
    type: "highlight-incorrect-words",
    folder: "highlight-incorrect-words",
    file: "highlight-incorrect-words/highlight_incorrect_words.json",
    evaluationType: "objective",
    structured: true,
  },
];

// Mirrors normalizeOptions/normalizeChoiceAnswer in the client's shared.js: options may be plain
// strings or {id, text} objects, and a choice answer may be an option id rather than an index.
const optionText = options => (options || []).map(o => (typeof o === "string" ? o : o.text));
function choiceAnswerIndex(options, answer) {
  const index = (options || []).findIndex(o => o && o.id === answer);
  return index >= 0 ? index : answer;
}

function buildDoc(item, source) {
  const doc = {
    section: "listening",
    type: source.type,
    title: item.title,
    prompt: source.prompt || item.question || item.prompt || "Listen to the recording and answer the question.",
    audioUrl: audioPath(source.folder, item.audio?.src),
    transcript: source.transcript ? source.transcript(item) : item.audio?.transcript || "",
    evaluationType: source.evaluationType,
    difficulty: item.subtype === "core" ? "medium" : "easy",
    sourceGroup: `${path.basename(source.file)}#${item.id}`,
    active: true,
  };
  if (source.answer) doc.answer = source.answer(item);
  if (source.choice) {
    doc.options = optionText(item.options);
    doc.answer = choiceAnswerIndex(item.options, item.answer);
    doc.maxScore = 1;
  }
  if (source.structured) {
    // The authored array, untouched. maxScore is the number of things the student must get
    // right, which is what the objective scorers award partial credit against.
    doc.content = item.content;
    const blanks = (item.content || []).filter(p => p.type === "blank");
    const wrongWords = (item.content || []).filter(p => p.type === "word" && p.isIncorrect);
    doc.maxScore = Math.max(1, blanks.length || wrongWords.length);
  }
  return doc;
}

async function main() {
  const write = process.argv.includes("--write");
  await connectDb();

  const existing = await Question.find({ section: "listening" })
    .select("title type transcript sourceGroup")
    .lean();
  const bySource = new Map(existing.filter(r => r.sourceGroup).map(r => [r.sourceGroup, r]));
  const byTypeTitle = new Map(existing.map(r => [`${r.type}|${String(r.title || "").toLowerCase().trim()}`, r]));

  const toInsert = [];
  const toUpdate = [];
  const skipped = [];

  for (const source of SOURCES) {
    const full = path.join(CONTENT_ROOT, source.file);
    const items = JSON.parse(fs.readFileSync(full, "utf8"));
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) {
      if (!item?.title || item.id == null) {
        console.error(`  skipping malformed entry in ${source.file}`);
        continue;
      }
      const doc = buildDoc(item, source);

      const linked = bySource.get(doc.sourceGroup);
      if (linked) {
        if ((linked.transcript || "") !== (doc.transcript || "")) toUpdate.push({ _id: linked._id, doc });
        continue;
      }
      // A row seeded separately may already cover this question. Matched on type+title, since
      // the bundled files and the seeder use the same titles for listening (unlike Read Aloud,
      // where the seeder used generic "Read Aloud N" names).
      const sameTitle = byTypeTitle.get(`${doc.type}|${String(doc.title).toLowerCase().trim()}`);
      if (sameTitle && !sameTitle.sourceGroup) {
        skipped.push({ title: doc.title, type: doc.type, _id: sameTitle._id, sourceGroup: doc.sourceGroup });
        continue;
      }
      toInsert.push(doc);
    }
  }

  const byType = {};
  toInsert.forEach(d => { byType[d.type] = (byType[d.type] || 0) + 1; });
  console.log("to insert, by type:");
  Object.entries(byType).forEach(([t, n]) => console.log(`  ${t.padEnd(28)}${String(n).padStart(4)}`));
  console.log(`\ntotal to insert : ${toInsert.length}`);
  console.log(`linked updates  : ${toUpdate.length}`);
  console.log(`title matches an existing unlinked row: ${skipped.length}`);
  skipped.forEach(s => console.log(`  ${s.type} / "${s.title}" -> will be linked to ${String(s._id).slice(-6)}`));

  if (!write) {
    console.log("\nDry run. Re-run with --write to apply.");
    process.exit(0);
  }

  if (toInsert.length) await Question.insertMany(toInsert);
  for (const u of toUpdate) await Question.updateOne({ _id: u._id }, { $set: u.doc });
  // Stamp the link so a later edit to one of these entries updates the row it matched rather
  // than inserting a duplicate.
  for (const s of skipped) await Question.updateOne({ _id: s._id }, { $set: { sourceGroup: s.sourceGroup } });

  const total = await Question.countDocuments({ section: "listening" });
  console.log(`\ninserted ${toInsert.length}, updated ${toUpdate.length}, linked ${skipped.length}`);
  console.log(`listening questions now in the bank: ${total}`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Migration failed:", error.message);
    process.exit(1);
  });
}
