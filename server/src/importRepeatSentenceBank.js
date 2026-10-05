import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Imports the audio-backed Repeat Sentence bank: 59 Core-P questions and 125 Normal Core ones.
//
//   node src/importRepeatSentenceBank.js            dry run — reads, validates, reports, writes nothing
//   node src/importRepeatSentenceBank.js --write    backs up, then inserts/updates
//
// The two sets are separate banks and never share a sourceGroup, audio file or row:
//   Core-P      sourceGroup "repeat-sentence/core-p/NNN"  audio /audio/repeat-sentence/core-p/
//   Normal Core sourceGroup "repeat-sentence/core/NNN"    audio /audio/repeat-sentence/core/
//
// `transcript` is what the AUDIO says (verified by speech-to-text, then checked by a person for the
// few rows that disagreed with the source PDF). It is the expected answer, and the only one. The
// source PDFs are used offline to confirm which clip is which question; their answers are never
// read here. Every row is linked back to its entry through `sourceGroup`, so re-running is safe:
// an unchanged row is skipped, an edited transcript updates its row, nothing is ever duplicated.
//
// A row whose transcript is null is PENDING human verification (Core-P 54 at the time of writing).
// It is imported with its audio attached but inactive, so students cannot be given a question
// that has nothing to be graded against. Set its transcript in data/repeatSentenceBank.json and
// re-run to fill it in, then activate it from the admin screen.

const BANK_PATH = path.resolve("src/data/repeatSentenceBank.json");
const BACKUP_DIR = path.resolve("uploads/backups"); // uploads/ is gitignored
const PROMPT = "Listen to the sentence, then repeat it exactly as you hear it.";

const SETS = {
  "core-p": { prefix: "repeat-sentence/core-p/", audioDir: "/audio/repeat-sentence/core-p/", expected: 59 },
  core: { prefix: "repeat-sentence/core/", audioDir: "/audio/repeat-sentence/core/", expected: 125 }
};

function buildDoc(entry) {
  const pending = !entry.transcript;
  return {
    section: "speaking",
    type: "repeat-sentence",
    title: entry.title,
    prompt: PROMPT,
    audioUrl: entry.audioUrl,
    ...(pending ? {} : { transcript: entry.transcript }),
    difficulty: "medium",
    sourceGroup: entry.sourceGroup,
    active: !pending
  };
}

function checkBank(bank) {
  const problems = [];
  const seenGroup = new Set(), seenAudio = new Set();
  for (const e of bank) {
    const set = SETS[e.set];
    if (!set) { problems.push(`${e.sourceGroup}: unknown set "${e.set}"`); continue; }
    if (!e.sourceGroup.startsWith(set.prefix)) problems.push(`${e.sourceGroup}: sourceGroup does not belong to set ${e.set}`);
    if (!e.audioUrl.startsWith(set.audioDir)) problems.push(`${e.sourceGroup}: audio ${e.audioUrl} is outside ${set.audioDir} (sets must not share audio)`);
    if (seenGroup.has(e.sourceGroup)) problems.push(`${e.sourceGroup}: duplicate sourceGroup`);
    if (seenAudio.has(e.audioUrl)) problems.push(`${e.audioUrl}: audio assigned to more than one question`);
    seenGroup.add(e.sourceGroup); seenAudio.add(e.audioUrl);
  }
  for (const [name, set] of Object.entries(SETS)) {
    const n = bank.filter(e => e.set === name).length;
    if (n !== set.expected) problems.push(`${name}: ${n} questions in the bank file, expected ${set.expected}`);
  }
  return problems;
}

export async function run({ write = false } = {}) {
  const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
  const problems = checkBank(bank);
  if (problems.length) throw new Error(`Bank file failed its own checks:\n  ${problems.join("\n  ")}`);

  // The audio must actually be on disk where audioUrl points: a question whose clip 404s is worse
  // than no question.
  const publicDir = path.resolve("../client/public");
  const missingAudio = bank.filter(e => !fs.existsSync(path.join(publicDir, e.audioUrl)));
  if (missingAudio.length) throw new Error(`Audio file missing for: ${missingAudio.map(e => e.sourceGroup).join(", ")}`);

  await connectDb();
  const existingRepeat = await Question.find({ type: "repeat-sentence" }).lean();
  const bySource = new Map(existingRepeat.filter(r => r.sourceGroup).map(r => [r.sourceGroup, r]));
  const byAudio = new Map(existingRepeat.filter(r => r.audioUrl).map(r => [r.audioUrl, r]));

  const plan = { insert: [], update: [], skipped: [], invalid: [] };
  for (const entry of bank) {
    const doc = buildDoc(entry);
    const { errors, normalized } = validateAndNormalizeQuestion(doc);
    if (errors.length) { plan.invalid.push({ sourceGroup: entry.sourceGroup, errors }); continue; }

    const linked = bySource.get(entry.sourceGroup) || byAudio.get(entry.audioUrl);
    if (!linked) { plan.insert.push({ entry, doc: { ...doc, ...normalized } }); continue; }
    const same = linked.audioUrl === doc.audioUrl && linked.title === doc.title && (linked.transcript || "") === (doc.transcript || "");
    if (same) plan.skipped.push(entry.sourceGroup);
    else plan.update.push({ entry, id: linked._id, set: { audioUrl: doc.audioUrl, title: doc.title, transcript: doc.transcript } });
  }

  const pending = bank.filter(e => !e.transcript).map(e => e.sourceGroup);
  console.log(`Bank file: ${bank.length} questions (core-p ${bank.filter(e => e.set === "core-p").length}, core ${bank.filter(e => e.set === "core").length}), pending verification: ${pending.join(", ") || "none"}`);
  console.log(`Plan: insert ${plan.insert.length}, update ${plan.update.length}, skip (already imported) ${plan.skipped.length}, invalid ${plan.invalid.length}`);
  if (plan.invalid.length) console.error("Invalid:", JSON.stringify(plan.invalid, null, 2));

  const report = { write, backupFile: null, inserted: 0, updated: 0, skipped: plan.skipped.length, invalid: plan.invalid.length, pending };
  if (!write) { console.log("Dry run — nothing written. Re-run with --write to apply."); return report; }
  if (plan.invalid.length) throw new Error("Refusing to write while any row is invalid.");

  // Backup first, and only proceed if it landed on disk: every existing Repeat Sentence row, plus
  // the per-type counts of the whole collection so a later comparison can prove nothing else moved.
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `repeat-sentence-before-import-${stamp}.json`);
  const countsByType = await Question.aggregate([{ $group: { _id: "$type", n: { $sum: 1 } } }]);
  fs.writeFileSync(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), totalQuestions: await Question.countDocuments(), countsByType, repeatSentenceQuestions: existingRepeat }, null, 2));
  if (!fs.existsSync(backupFile)) throw new Error("Backup was not written; aborting before any change.");
  report.backupFile = backupFile;
  console.log(`Backup written: ${backupFile}`);

  // Sequential, in question order, so createdAt (which the student list sorts on) follows the
  // numbering instead of ties resolving arbitrarily.
  for (const { doc } of plan.insert) { await Question.create(doc); report.inserted++; }
  for (const { id, set } of plan.update) {
    const $set = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
    await Question.updateOne({ _id: id }, { $set });
    report.updated++;
  }
  console.log(`Written: inserted ${report.inserted}, updated ${report.updated}.`);
  return report;
}

/** Reads the database back and checks it against the bank file; the proof that the import is whole. */
export async function verify() {
  const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
  await connectDb();
  const out = {};
  for (const [name, set] of Object.entries(SETS)) {
    const rows = await Question.find({ type: "repeat-sentence", sourceGroup: { $regex: `^${set.prefix}` } }).lean();
    const audioOk = rows.filter(r => r.audioUrl?.startsWith(set.audioDir)).length;
    const crossed = rows.filter(r => !r.audioUrl?.startsWith(set.audioDir)).length;
    const pendingRows = rows.filter(r => !r.transcript);
    const wrongTranscript = bank.filter(e => e.set === name && e.transcript).filter(e => rows.find(r => r.sourceGroup === e.sourceGroup)?.transcript !== e.transcript).length;
    out[name] = { questions: rows.length, expected: set.expected, audioMappings: audioOk, crossSetAudio: crossed, pending: pendingRows.map(r => r.sourceGroup), transcriptMismatches: wrongTranscript, uniqueAudio: new Set(rows.map(r => r.audioUrl)).size };
  }
  out.legacyRepeatSentenceUntouched = await Question.countDocuments({ type: "repeat-sentence", sourceGroup: { $exists: false } });
  out.totalQuestions = await Question.countDocuments();
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes("--write");
  const verifyOnly = process.argv.includes("--verify");
  try {
    if (verifyOnly) console.log(JSON.stringify(await verify(), null, 2));
    else {
      const report = await run({ write });
      if (write) console.log(JSON.stringify(await verify(), null, 2));
      console.log("Report:", JSON.stringify(report));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    const { default: mongoose } = await import("mongoose");
    await mongoose.disconnect();
  }
}
