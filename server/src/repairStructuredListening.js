import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";

// Repairs the listening questions that migrateListeningToDb.js stored incompletely.
//
// That migration kept only the authored `content` array, on the reasoning that the client derives
// everything else from it. That is true for *rendering* and false for *scoring*: the server scores
// objective questions from `question.options` and `question.answer`, so rows carrying neither
// failed validation and were deactivated. Those two fields are derived here instead — the same
// derivation the client does, run once and stored, because the server needs them too.
//
//   node src/repairStructuredListening.js [--write]
//
// Two repairs, for two different causes:
//
//   highlight-incorrect-words — derive options/answer and reactivate.
//   fill-blanks               — a free-text, many-blank exercise that was sharing a type name
//                               with Reading's pick-one-option version, which routed it to
//                               scoreSingleChoice and could never score it correctly. Moved to
//                               its own type, fill-blanks-typed, with its own scorer.

// Mirrors applyStructuredContent in client/src/practice/listeningData/shared.js: every word in
// the passage becomes an option so clicking behaves uniformly, and only the words the content
// marks `isIncorrect` are the ones worth catching.
function deriveHighlightFields(content) {
  let wordIndex = 0;
  const words = [];
  const incorrect = [];
  for (const part of content || []) {
    if (part.type === "word") {
      words.push(part.text);
      if (part.isIncorrect) incorrect.push(wordIndex);
      wordIndex += 1;
      continue;
    }
    const raw = part.value || part.text || "";
    for (const token of raw.split(/(\s+)/)) {
      if (token === "" || /^\s+$/.test(token)) continue;
      words.push(token);
      wordIndex += 1;
    }
  }
  return { options: words, answer: incorrect };
}

// Mirrors the fill-blanks branch of applyStructuredContent: the passage is the prose with each
// blank replaced by ____, and the answer key is each blank's word in passage order.
function deriveTypedBlankFields(content) {
  const blanks = (content || []).filter(part => part.type === "blank");
  const passage = (content || [])
    .map(part => (part.type === "blank" ? "____" : part.value || part.text || ""))
    .join("");
  const answer = blanks.map(b => b.answer).filter(a => typeof a === "string" && a.trim());
  return { passage, answer };
}

async function main() {
  const write = process.argv.includes("--write");
  await connectDb();

  const rows = await Question.find({ section: "listening", type: "highlight-incorrect-words" }).lean();
  const fixes = [];
  for (const row of rows) {
    if (!row.content) {
      console.error(`  ${row.title}: no content array — cannot derive, left alone`);
      continue;
    }
    const { options, answer } = deriveHighlightFields(row.content);
    if (!options.length || !answer.length) {
      console.error(`  ${row.title}: derived ${options.length} options / ${answer.length} answers — skipping`);
      continue;
    }
    fixes.push({ _id: row._id, title: row.title, options, answer, maxScore: answer.length });
  }

  console.log(`highlight-incorrect-words rows: ${rows.length}`);
  console.log(`repairable                    : ${fixes.length}`);
  fixes.slice(0, 8).forEach(f =>
    console.log(`  ${String(f.title).padEnd(22)} ${String(f.options.length).padStart(3)} words, ${f.answer.length} incorrect`));

  if (!write) {
    console.log("\nDry run. Re-run with --write to repair and reactivate.");
    process.exit(0);
  }

  for (const f of fixes) {
    await Question.updateOne(
      { _id: f._id },
      { $set: { options: f.options, answer: f.answer, maxScore: f.maxScore, active: true } }
    );
  }
  console.log(`\nrepaired and reactivated ${fixes.length} highlight-incorrect-words`);

  // --- listening fill-blanks -> fill-blanks-typed ---
  // Re-reads from the database rather than reusing anything above: this half is about a type
  // change, not a missing field, and the two sets of rows never overlap.
  const fb = await Question.find({ section: "listening", type: "fill-blanks", content: { $exists: true } }).lean();
  const typed = [];
  for (const row of fb) {
    const { passage, answer } = deriveTypedBlankFields(row.content);
    if (!answer.length) {
      console.error(`  ${row.title}: no blank answers found — left deactivated`);
      continue;
    }
    typed.push({ _id: row._id, title: row.title, passage, answer, maxScore: answer.length });
  }
  console.log(`\nlistening fill-blanks rows: ${fb.length}, convertible: ${typed.length}`);
  for (const t of typed) {
    await Question.updateOne(
      { _id: t._id },
      {
        $set: { type: "fill-blanks-typed", passage: t.passage, answer: t.answer, maxScore: t.maxScore, active: true },
        // The migration never set options on these, and the typed shape has none — a student
        // writes the word rather than choosing it.
        $unset: { options: "" }
      }
    );
  }
  console.log(`converted and reactivated ${typed.length} as fill-blanks-typed`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Repair failed:", error.message);
    process.exit(1);
  });
}
