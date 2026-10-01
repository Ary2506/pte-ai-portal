import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";

// Moves client/content/speaking/read-aloud/read_aloud.json into the question bank, so Read Aloud
// stops being the one speaking task served from a bundled file.
//
// Two things happen here, because the two halves of the bank disagree about where the text to be
// read aloud lives. The 36 rows already in the database keep it in `prompt`, which Speaking.jsx
// renders as a one-line instruction. The JSON (and ReadAloudPractice) treat it as a `passage` —
// a block of prose in its own bordered box. The passage reading is the correct one: it matches
// how Reading tasks model the same thing (prompt = what to do, passage = the text), and it is
// what students see today. So this inserts new rows in that shape *and* normalises the existing
// 36 to match, rather than leaving the collection half one way and half the other.
//
//   node src/migrateReadAloudToDb.js [--write]
//
// Dry run by default. Safe to re-run: questions are matched on passage text, not title, since the
// JSON uses descriptive titles ("Language Appearance") while 21 database rows are called
// "Read Aloud 1..21" — a title match would miss every real duplicate.

const SOURCE = path.resolve("../client/content/speaking/read-aloud/read_aloud.json");
const INSTRUCTION = "Read the passage aloud. You have 60 seconds.";

// Compares the words only, so punctuation or whitespace differences between the JSON and a row
// seeded from the same source text still count as the same question.
const normalize = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const write = process.argv.includes("--write");
  const items = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  if (!Array.isArray(items) || !items.length) {
    console.error("read_aloud.json is empty or not an array — refusing to run.");
    process.exit(1);
  }

  await connectDb();
  const existing = await Question.find({ section: "speaking", type: "read-aloud" })
    .select("title prompt passage answer sourceGroup")
    .lean();

  // A row's text may be in either field depending on whether it has been normalised yet.
  const existingText = new Map(existing.map(row => [normalize(row.passage || row.prompt), row]));

  // The stable link back to the file, written on every row this script inserts. It is what makes
  // the JSON an authoring source rather than a one-time import: edit a passage in the file,
  // re-run, and the linked row is updated. Without it a reworded passage would simply fail the
  // text match above and be inserted a second time, quietly duplicating the question.
  const bySource = new Map(existing.filter(row => row.sourceGroup).map(row => [row.sourceGroup, row]));

  // 13 JSON entries share a title with a database row but carry a differently-worded passage on
  // the same topic — paraphrases, not duplicates. Both are usable practice, so neither is
  // dropped; the incoming one is suffixed so the two can be told apart in the question list and
  // the admin panel. They are reported below so they can be reviewed and one deleted if the
  // near-repetition is not wanted.
  const takenTitles = new Set(existing.map(row => normalize(row.title)));
  const renamed = [];
  function uniqueTitle(title) {
    if (!takenTitles.has(normalize(title))) {
      takenTitles.add(normalize(title));
      return title;
    }
    let n = 2;
    while (takenTitles.has(normalize(`${title} (${n})`))) n += 1;
    const next = `${title} (${n})`;
    takenTitles.add(normalize(next));
    renamed.push(next);
    return next;
  }

  const toInsert = [];
  const toUpdate = [];
  const toLink = [];
  const duplicates = [];
  for (const item of items) {
    const text = item.question;
    if (!text || !item.title) {
      console.error(`skipping malformed entry id=${item.id}: missing title or question text`);
      continue;
    }

    // Checked before the text match, so an edited passage updates its own row instead of looking
    // like a brand-new question.
    const linked = bySource.get(`read_aloud.json#${item.id}`);
    if (linked) {
      const changed = normalize(linked.passage) !== normalize(text) || (linked.answer || "") !== (item.answer || "");
      // Title is deliberately left alone: this script suffixes titles on insert to resolve
      // collisions ("Visit to Canada (2)"), and an admin may have renamed a question since.
      // Overwriting it from the file would undo both.
      if (changed) toUpdate.push({ _id: linked._id, title: linked.title, passage: text, answer: item.answer || undefined });
      continue;
    }

    const match = existingText.get(normalize(text));
    if (match) {
      duplicates.push(item.title);
      // Stamp the link onto the row this entry already matches. Without it a skipped duplicate
      // stays unlinked, so editing its passage in the file would fail the text match on the next
      // run and insert a second copy instead of updating the one that is already there.
      if (!match.sourceGroup) toLink.push({ _id: match._id, sourceGroup: `read_aloud.json#${item.id}` });
      continue;
    }
    toInsert.push({
      section: "speaking",
      type: "read-aloud",
      title: uniqueTitle(item.title),
      prompt: INSTRUCTION,
      passage: text,
      // The JSON's model answer, revealed on demand by Show Answer. Never auto-graded — read-aloud
      // is scored by the AI from the transcript (see services/ai/evaluator.js).
      answer: item.answer || undefined,
      evaluationType: "subjective",
      difficulty: "medium",
      // Records which bundled file this came from, so a later cleanup can tell migrated content
      // apart from questions an admin authored by hand.
      sourceGroup: `read_aloud.json#${item.id}`,
      active: true
    });
  }

  // Rows still holding their text in `prompt` need it moved, or the same question would render as
  // an instruction line in one place and a passage box in another.
  const needsNormalising = existing.filter(row => !row.passage && row.prompt);

  console.log(`JSON entries            : ${items.length}`);
  console.log(`already in the database : ${duplicates.length}`);
  console.log(`new, to insert          : ${toInsert.length}`);
  console.log(`linked rows to update   : ${toUpdate.length}  (passage edited in the JSON)`);
  console.log(`duplicates to link      : ${toLink.length}  (stamping sourceGroup so future edits track)`);
  console.log(`existing rows to reshape: ${needsNormalising.length}  (prompt -> passage)`);
  console.log(`same title, different passage: ${renamed.length}  (suffixed, review these)`);
  if (duplicates.length) console.log(`  exact duplicates e.g.: ${duplicates.slice(0, 4).join(" | ")}`);
  if (renamed.length) console.log(`  suffixed: ${renamed.join(" | ")}`);

  if (!write) {
    console.log("\nDry run. Re-run with --write to apply.");
    process.exit(0);
  }

  if (toInsert.length) await Question.insertMany(toInsert);
  for (const l of toLink) {
    await Question.updateOne({ _id: l._id }, { $set: { sourceGroup: l.sourceGroup } });
  }
  for (const u of toUpdate) {
    await Question.updateOne({ _id: u._id }, { $set: { passage: u.passage, answer: u.answer } });
  }
  for (const row of needsNormalising) {
    await Question.updateOne({ _id: row._id }, { $set: { passage: row.prompt, prompt: INSTRUCTION } });
  }

  const total = await Question.countDocuments({ section: "speaking", type: "read-aloud" });
  console.log(`\ninserted ${toInsert.length}, updated ${toUpdate.length}, reshaped ${needsNormalising.length}`);
  console.log(`read-aloud questions now in the bank: ${total}`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error("Migration failed:", error.message);
    process.exit(1);
  });
}
