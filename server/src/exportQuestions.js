import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";

// Writes a section's questions out as JSON authoring files, and links each database row back to
// the entry it produced.
//
//   node src/exportQuestions.js <section> [--write]
//
// Reading and Writing were authored as inline arrays inside seedPhase18Content.js — a 110KB file
// that is disabled on boot and only ever inserts, so editing it changes nothing about questions
// already in the bank. This exports what is actually live instead of re-parsing that seeder,
// which matters because an admin may have edited or added questions since it last ran.
//
// Pair with syncQuestions.js: export once to create the files, then edit the JSON and sync.

const CONTENT_ROOT = path.resolve("../client/content");

// Everything that defines a question, and nothing that belongs to the database: no _id, no
// __v, no timestamps. `id` is the authoring handle that sourceGroup points at.
const EXPORTED_FIELDS = [
  "title", "prompt", "passage", "transcript", "content",
  "imageUrl", "audioUrl", "options", "answer", "explanation",
  "difficulty", "category", "evaluationType", "maxScore", "active",
];

function toAuthoringEntry(doc, index) {
  // A short stable handle. Derived from the Mongo id so re-exporting the same row always yields
  // the same handle, rather than a positional number that would shift as questions are added.
  const entry = { id: `${doc.type}-${String(doc._id).slice(-6)}`, _order: index + 1 };
  for (const field of EXPORTED_FIELDS) {
    const value = doc[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === "string" && !value.trim()) continue;
    entry[field] = value;
  }
  return entry;
}

async function main() {
  const section = process.argv.slice(2).find(a => !a.startsWith("--"));
  const write = process.argv.includes("--write");
  if (!section) {
    console.error("Usage: node src/exportQuestions.js <section> [--write]");
    process.exit(1);
  }

  await connectDb();
  const docs = await Question.find({ section }).sort({ type: 1, createdAt: 1 }).lean();
  if (!docs.length) {
    console.error(`No questions found in section "${section}".`);
    process.exit(1);
  }

  const byType = new Map();
  for (const doc of docs) {
    if (!byType.has(doc.type)) byType.set(doc.type, []);
    byType.get(doc.type).push(doc);
  }

  const links = [];
  for (const [type, rows] of byType) {
    const file = path.join(CONTENT_ROOT, section, `${type}.json`);
    const entries = rows.map((doc, i) => {
      const entry = toAuthoringEntry(doc, i);
      links.push({ _id: doc._id, sourceGroup: `${section}/${type}.json#${entry.id}` });
      return entry;
    });
    const already = rows.filter(r => r.sourceGroup).length;
    console.log(`${(section + "/" + type).padEnd(34)}${String(rows.length).padStart(4)} questions  ->  ${path.relative(path.resolve(".."), file)}${already ? `  (${already} already linked)` : ""}`);
    if (write) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
    }
  }

  console.log(`\n${docs.length} questions across ${byType.size} type(s)`);
  if (!write) {
    console.log("\nDry run. Re-run with --write to create the files and link the rows.");
    process.exit(0);
  }

  for (const link of links) {
    await Question.updateOne({ _id: link._id }, { $set: { sourceGroup: link.sourceGroup } });
  }
  console.log(`linked ${links.length} rows back to their authoring entry`);
  console.log("\nEdit the JSON, then apply with: node src/syncQuestions.js <section> --write");
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Export failed:", error.message);
    process.exit(1);
  });
}
