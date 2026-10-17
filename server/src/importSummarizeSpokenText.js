// Imports the Summarize Spoken Text bank from its authored JSON into MongoDB.
//
//   node src/importSummarizeSpokenText.js            dry run, writes nothing
//   node src/importSummarizeSpokenText.js --write     applies the plan
//
// Authoring lives in client/content/listening/summarize-spoken-text/summarize_spoken_text.json;
// MongoDB is what students are served from. Every row is linked back to its entry by
// `sourceGroup` ("summarize_spoken_text.json#<id>"), which is what makes re-running safe: an
// unchanged row is skipped, an edited one is updated, and nothing is ever duplicated.
//
// `audio.src` is a filename only. The full path is derived here so the JSON never has to know
// where the audio is mounted, and the file is checked on disk before anything is written — a
// question whose clip 404s is worse than one that does not exist.
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Question from "./models/Question.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

const WRITE = process.argv.includes("--write");

const CONTENT_FILE = path.resolve("../client/content/listening/summarize-spoken-text/summarize_spoken_text.json");
const PUBLIC_DIR = path.resolve("../client/public");
const AUDIO_DIR = "/audio/listening/summarize-spoken-text";

const PROMPT = "Listen to the short practice audio and summarize the main idea in your own words.";

// Entries deliberately not imported.
//
// Each repeats a topic already covered by an earlier question in the same bank, so importing them
// would hand students the same subject twice under slightly different titles. They stay in the
// JSON rather than being deleted: the decision is reversible by removing an id from this set, and
// the authored content is not lost.
const SKIP = new Map([
  [3, "topic duplicates #54 Rail Pass"],
  [5, "topic duplicates #53 Park Cleaning"],
  [6, "topic duplicates #68 Fruits and Vegetables"],
  [7, "topic duplicates #70 Transition to School"],
  [10, "topic duplicates #52 Skilled Trades"]
]);

function sourceGroupFor(entry) {
  return `summarize_spoken_text.json#${entry.id}`;
}

function toQuestion(entry) {
  return {
    section: "listening",
    type: "summarize-spoken-text",
    title: String(entry.title || "").trim(),
    prompt: PROMPT,
    transcript: String(entry.transcript || "").trim(),
    audioUrl: `${AUDIO_DIR}/${entry.audio.src}`,
    sourceGroup: sourceGroupFor(entry),
    evaluationType: "subjective",
    difficulty: "easy",
    active: true
  };
}

const bank = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
if (!Array.isArray(bank)) throw new Error(`${CONTENT_FILE} is not a JSON array`);

// ---------------------------------------------------------------- shape checks, before any IO
const problems = [];
const seenId = new Set();
const seenAudio = new Set();
for (const entry of bank) {
  const where = `entry id ${entry?.id}`;
  if (entry?.id === undefined || entry.id === null) problems.push("an entry has no id");
  else if (seenId.has(entry.id)) problems.push(`${where}: duplicate id`);
  else seenId.add(entry.id);

  if (!entry?.title?.trim()) problems.push(`${where}: missing title`);
  if (!entry?.transcript?.trim()) problems.push(`${where}: missing transcript`);
  if (!entry?.audio?.src) problems.push(`${where}: missing audio.src`);
  else {
    if (seenAudio.has(entry.audio.src)) problems.push(`${where}: audio ${entry.audio.src} is used by another entry`);
    seenAudio.add(entry.audio.src);
    const onDisk = path.join(PUBLIC_DIR, AUDIO_DIR, entry.audio.src);
    if (!fs.existsSync(onDisk)) problems.push(`${where}: audio file not found at ${onDisk}`);
  }
}
if (problems.length) {
  console.error("The content file has problems; nothing was imported:\n  " + problems.join("\n  "));
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);
console.log((WRITE ? "APPLYING" : "DRY RUN") + "\n");

const existing = await Question.find({ type: "summarize-spoken-text" })
  .select("title audioUrl transcript sourceGroup active maxScore").lean();
const bySource = new Map(existing.filter(r => r.sourceGroup).map(r => [r.sourceGroup, r]));

const plan = { create: [], update: [], unchanged: [], skipped: [], invalid: [] };

for (const entry of bank) {
  if (SKIP.has(entry.id)) {
    plan.skipped.push({ id: entry.id, title: entry.title, reason: SKIP.get(entry.id) });
    continue;
  }
  const draft = toQuestion(entry);
  // The validator returns only the fields it derives (evaluationType, maxScore) rather than a
  // whole document, so it is merged in rather than replacing what was built above.
  const { errors, normalized } = validateAndNormalizeQuestion(draft);
  if (errors.length) { plan.invalid.push({ id: entry.id, errors }); continue; }
  const doc = { ...draft, ...normalized };

  const linked = bySource.get(doc.sourceGroup);
  if (!linked) { plan.create.push({ entry, doc }); continue; }

  const same =
    linked.title === doc.title &&
    linked.audioUrl === doc.audioUrl &&
    (linked.transcript || "") === (doc.transcript || "") &&
    linked.maxScore === doc.maxScore &&
    linked.active === true;
  if (same) plan.unchanged.push({ id: entry.id, title: entry.title });
  else {
    const reasons = [];
    if (linked.title !== doc.title) reasons.push("title");
    if (linked.audioUrl !== doc.audioUrl) reasons.push("audio");
    if ((linked.transcript || "") !== (doc.transcript || "")) reasons.push("transcript");
    if (linked.maxScore !== doc.maxScore) reasons.push(`maxScore ${linked.maxScore} -> ${doc.maxScore}`);
    if (linked.active !== true) reasons.push("reactivate");
    plan.update.push({ entry, doc, _id: linked._id, reasons });
  }
}

console.log(`entries in the file : ${bank.length}`);
console.log(`already correct     : ${plan.unchanged.length}`);
console.log(`to create           : ${plan.create.length}`);
console.log(`to update           : ${plan.update.length}`);
console.log(`skipped (duplicate) : ${plan.skipped.length}`);
if (plan.invalid.length) console.log(`INVALID             : ${plan.invalid.length}`);

for (const c of plan.create) console.log(`   CREATE  #${String(c.entry.id).padStart(2)}  ${c.doc.audioUrl.split("/").pop().padEnd(8)}  ${c.doc.title}`);
for (const u of plan.update) console.log(`   UPDATE  #${String(u.entry.id).padStart(2)}  ${u.doc.title.padEnd(32)} (${u.reasons.join(", ")})`);
for (const s of plan.skipped) console.log(`   skip    #${String(s.id).padStart(2)}  ${s.title}  (${s.reason})`);
for (const i of plan.invalid) console.log(`   INVALID #${i.id}: ${i.errors.join("; ")}`);

if (plan.invalid.length) {
  console.error("\nRefusing to write while any entry is invalid.");
  await mongoose.disconnect();
  process.exit(1);
}

if (!WRITE) {
  console.log("\nNothing written. Re-run with --write to apply.");
  await mongoose.disconnect();
  process.exit(0);
}

let created = 0, updated = 0;
for (const c of plan.create) { await Question.create(c.doc); created++; }
for (const u of plan.update) { await Question.updateOne({ _id: u._id }, { $set: u.doc }); updated++; }

const total = await Question.countDocuments({ type: "summarize-spoken-text", active: true });
console.log(`\ncreated ${created}, updated ${updated}`);
console.log(`active summarize-spoken-text questions now: ${total}`);
await mongoose.disconnect();
