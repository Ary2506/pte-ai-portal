import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";

// Applies a section's JSON authoring files to the question bank.
//
//   node src/syncQuestions.js <section> [--write]
//
// This is the half that makes "author in JSON, serve from MongoDB" real rather than a one-time
// import. Every entry is matched to its row through `sourceGroup`, so editing a prompt and
// re-running updates that question — where an importer matching on text or title would fail the
// match and insert a second copy of it instead. An entry with no matching row is inserted and
// linked, so new questions can simply be appended to the file.
//
// Deletions are reported, never applied: removing an entry from the file leaves its question in
// the bank, because unpublishing content is a decision worth making deliberately in the admin
// panel rather than as a side effect of editing a file.

const CONTENT_ROOT = path.resolve("../client/content");

const SYNCED_FIELDS = [
  "title", "prompt", "passage", "transcript", "content",
  "imageUrl", "audioUrl", "options", "answer", "explanation",
  "difficulty", "category", "evaluationType", "maxScore", "active",
];

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function changedFields(entry, row) {
  return SYNCED_FIELDS.filter(field => field in entry && !sameValue(entry[field], row[field]));
}

async function main() {
  const section = process.argv.slice(2).find(a => !a.startsWith("--"));
  const write = process.argv.includes("--write");
  if (!section) {
    console.error("Usage: node src/syncQuestions.js <section> [--write]");
    process.exit(1);
  }

  const dir = path.join(CONTENT_ROOT, section);
  if (!fs.existsSync(dir)) {
    console.error(`No authoring directory at ${dir}. Run exportQuestions.js first.`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
  if (!files.length) {
    console.error(`No .json files in ${dir}.`);
    process.exit(1);
  }

  await connectDb();
  const rows = await Question.find({ section }).lean();
  const bySource = new Map(rows.filter(r => r.sourceGroup).map(r => [r.sourceGroup, r]));
  const seen = new Set();

  const inserts = [];
  const updates = [];
  const problems = [];

  for (const file of files) {
    const type = path.basename(file, ".json");
    const entries = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (!entry?.id) { problems.push(`${file}: an entry has no \`id\``); continue; }
      if (!entry.title) { problems.push(`${file}#${entry.id}: no \`title\``); continue; }
      const key = `${section}/${file}#${entry.id}`;
      if (seen.has(key)) { problems.push(`${file}: duplicate id "${entry.id}"`); continue; }
      seen.add(key);

      const row = bySource.get(key);
      if (!row) {
        inserts.push({ key, doc: { section, type, ...pickSynced(entry), sourceGroup: key } });
        continue;
      }
      const changed = changedFields(entry, row);
      if (changed.length) updates.push({ _id: row._id, key, changed, doc: pickSynced(entry) });
    }
  }

  // A row linked to this section's files but no longer present in them.
  const orphans = rows.filter(r => r.sourceGroup?.startsWith(`${section}/`) && !seen.has(r.sourceGroup));

  if (problems.length) {
    problems.forEach(p => console.error(`  PROBLEM  ${p}`));
    console.error(`\n${problems.length} problem(s) — nothing will be written until they are fixed.`);
    process.exit(1);
  }

  console.log(`files   : ${files.length}  (${seen.size} entries)`);
  console.log(`updates : ${updates.length}`);
  updates.slice(0, 8).forEach(u => console.log(`  ${u.key}  [${u.changed.join(", ")}]`));
  if (updates.length > 8) console.log(`  ... and ${updates.length - 8} more`);
  console.log(`inserts : ${inserts.length}`);
  inserts.slice(0, 8).forEach(i => console.log(`  ${i.key}`));
  console.log(`in the bank but no longer in the files: ${orphans.length}  (left alone)`);
  orphans.slice(0, 5).forEach(o => console.log(`  ${o.sourceGroup} — "${o.title}"`));

  if (!write) {
    console.log("\nDry run. Re-run with --write to apply.");
    process.exit(0);
  }

  for (const u of updates) await Question.updateOne({ _id: u._id }, { $set: u.doc });
  if (inserts.length) await Question.insertMany(inserts.map(i => i.doc));
  console.log(`\nupdated ${updates.length}, inserted ${inserts.length}`);
  console.log(`${section} questions in the bank: ${await Question.countDocuments({ section })}`);
  process.exit(0);
}

function pickSynced(entry) {
  const doc = {};
  for (const field of SYNCED_FIELDS) if (field in entry) doc[field] = entry[field];
  return doc;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Sync failed:", error.message);
    process.exit(1);
  });
}
