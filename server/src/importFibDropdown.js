import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Imports client/content/reading/fib_dropdown.json into the question bank as `fib-dropdown`.
//
//   node src/importFibDropdown.js [--write]
//
// The authored file keeps a question's prose and its blanks apart — `content` is the passage with
// blankId markers, `blanks` is the option list and answer for each. The stored question merges
// them: each blank becomes one {type:"blank", options, answer} part inside `content`, in passage
// order, and the question's own `answer` is the chosen option's index per blank.
//
// That merge is the whole point. Scoring compares indices, and the renderer needs each blank's
// options exactly where the blank falls in the sentence — keeping two parallel arrays in sync by
// id at render time would be the same information with more ways to go wrong.
//
// Safe to re-run: each row links back through sourceGroup, so editing the file updates the
// question it produced rather than inserting a second copy.

const SOURCE = path.resolve("../client/content/reading/fib_dropdown.json");
const SOURCE_FILE = "reading/fib_dropdown.json";
const PROMPT = "Choose the word that best completes each blank.";

// The authored entries end and begin mid-sentence ("...the word we" + blank + " for weather"),
// so joining them naively yields "we for weather". A space goes in before a blank unless the
// text already ends in one, and after it unless the next part opens with punctuation.
const CLOSING_PUNCTUATION = /^[,.;:!?)\]}'"’”]/;

function buildContent(entry) {
  const byId = new Map((entry.blanks || []).map(b => [b.id, b]));
  const parts = [];
  const answer = [];

  for (const piece of entry.content || []) {
    const text = piece.text ?? "";
    if (text) {
      const previous = parts[parts.length - 1];
      const needsSpace =
        previous?.type === "blank" && !CLOSING_PUNCTUATION.test(text) && !/^\s/.test(text);
      parts.push({ type: "text", value: (needsSpace ? " " : "") + text });
    }
    if (!piece.blankId) continue;

    const blank = byId.get(piece.blankId);
    if (!blank) return { error: `content references blank "${piece.blankId}" with no entry in \`blanks\`` };
    const options = Array.isArray(blank.options) ? blank.options : [];
    const index = options.indexOf(blank.answer);
    if (index < 0) return { error: `blank "${blank.id}" answer "${blank.answer}" is not among its own options` };

    // Trailing space on the text before a blank, so the dropdown doesn't butt against the word.
    const previous = parts[parts.length - 1];
    if (previous?.type === "text" && !/\s$/.test(previous.value)) previous.value += " ";

    parts.push({ type: "blank", options, answer: blank.answer });
    answer.push(index);
  }

  if (!answer.length) return { error: "no blanks were placed in the passage" };
  return { content: parts, answer };
}

async function main() {
  const write = process.argv.includes("--write");
  const entries = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const list = Array.isArray(entries) ? entries : [entries];

  await connectDb();
  const existing = await Question.find({ section: "reading", type: "fib-dropdown" }).select("sourceGroup title").lean();
  const bySource = new Map(existing.filter(r => r.sourceGroup).map(r => [r.sourceGroup, r]));

  const inserts = [];
  const updates = [];
  const problems = [];

  for (const entry of list) {
    if (!entry?.id || !entry.title) { problems.push(`entry ${entry?.id ?? "(no id)"}: missing id or title`); continue; }
    const { content, answer, error } = buildContent(entry);
    if (error) { problems.push(`${entry.id}: ${error}`); continue; }

    const doc = {
      section: "reading",
      type: "fib-dropdown",
      title: entry.title,
      prompt: entry.prompt || PROMPT,
      // The completed passage. Stored as `transcript`, not `explanation`: explanation is what the
      // objective scorers append to their feedback, so putting a whole paragraph there printed it
      // under every result.
      transcript: entry.transcript || undefined,
      content,
      answer,
      evaluationType: "objective",
      maxScore: answer.length,
      difficulty: entry.difficulty || "medium",
      sourceGroup: `${SOURCE_FILE}#${entry.id}`,
      active: true
    };

    const { errors } = validateAndNormalizeQuestion(doc);
    if (errors.length) { problems.push(`${entry.id}: ${errors.join("; ")}`); continue; }

    const linked = bySource.get(doc.sourceGroup);
    if (linked) updates.push({ _id: linked._id, doc });
    else inserts.push(doc);
  }

  if (problems.length) {
    problems.slice(0, 10).forEach(p => console.error(`  PROBLEM  ${p}`));
    console.error(`\n${problems.length} problem(s) — nothing is written until they are fixed.`);
    process.exit(1);
  }

  const blanks = [...inserts, ...updates.map(u => u.doc)].map(d => d.answer.length);
  console.log(`entries in file : ${list.length}`);
  console.log(`to insert       : ${inserts.length}`);
  console.log(`to update       : ${updates.length}`);
  console.log(`blanks per q    : min ${Math.min(...blanks)}, max ${Math.max(...blanks)}`);
  if (inserts.length) {
    const sample = inserts[0];
    console.log(`\nsample: "${sample.title}" (${sample.answer.length} blanks)`);
    console.log(`  ${sample.content.map(p => (p.type === "blank" ? `[${p.options.join("/")}]` : p.value)).join("").slice(0, 150)}...`);
    console.log(`  answer indexes: ${JSON.stringify(sample.answer)} -> ${sample.content.filter(p => p.type === "blank").map((p, i) => p.options[sample.answer[i]]).join(", ")}`);
  }

  if (!write) {
    console.log("\nDry run. Re-run with --write to import.");
    process.exit(0);
  }

  if (inserts.length) await Question.insertMany(inserts);
  for (const u of updates) await Question.updateOne({ _id: u._id }, { $set: u.doc });
  console.log(`\ninserted ${inserts.length}, updated ${updates.length}`);
  console.log(`fib-dropdown questions in the bank: ${await Question.countDocuments({ section: "reading", type: "fib-dropdown" })}`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Import failed:", error.message);
    process.exit(1);
  });
}
