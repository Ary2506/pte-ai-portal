import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import User from "./models/User.js";
import AuditLog from "./models/AuditLog.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Replaces the Write From Dictation bank with the new 52-sentence set (src/data/writeFromDictation.json)
// through the same authoring path the admin Questions screen uses (routes/adminQuestions.js POST /):
//   validateAndNormalizeQuestion -> Question.create -> a QUESTION_CREATED audit entry.
//
//   node src/importWriteFromDictation.js            dry run: validates and reports, writes nothing
//   node src/importWriteFromDictation.js --write    inserts the new set and deactivates the old one
//
// `transcript` is the sentence as the clip says it and is also the answer the typed text is scored against.
// Numbers follow the source PDF, and rows are inserted in that order so createdAt (the listing order) matches.
// The previous questions (write-dictation rows outside GROUP) are deactivated, never deleted, since students
// may already have answered them; a backup of them is written first. Re-running is safe: a new row is matched
// by its sourceGroup, so nothing is inserted twice.

const DATA = path.resolve("src/data/writeFromDictation.json");
const PUBLIC_DIR = path.resolve("../client/public");
const GROUP = /^write-from-dictation\/new\//;
const PROMPT = "Listen to the recording and write the sentence you hear.";

export async function run({ write = false } = {}) {
  const bank = JSON.parse(fs.readFileSync(DATA, "utf8"));
  if (new Set(bank.map(q => q.sourceGroup)).size !== bank.length) throw new Error("duplicate sourceGroup in data file");
  if (new Set(bank.map(q => q.audioUrl)).size !== bank.length) throw new Error("an audio file is assigned to more than one question");
  const missing = bank.filter(q => !fs.existsSync(path.join(PUBLIC_DIR, q.audioUrl)));
  if (missing.length) throw new Error(`audio file missing for: ${missing.map(q => q.number).join(", ")}`);

  await connectDb();
  const author = await User.findOne({ role: "admin", username: "admin" }).select("_id username");
  if (!author) throw new Error('admin account "admin" not found, needed to attribute the audit entries');

  const existing = new Set((await Question.find({ sourceGroup: GROUP }).select("sourceGroup").lean()).map(r => r.sourceGroup));
  const plan = { insert: [], skipped: 0, invalid: [] };
  for (const q of bank) {
    if (existing.has(q.sourceGroup)) { plan.skipped++; continue; }
    const doc = {
      section: "listening", type: "write-dictation", title: q.title, prompt: PROMPT, transcript: q.transcript,
      answer: q.transcript, audioUrl: q.audioUrl, difficulty: "medium", sourceGroup: q.sourceGroup, active: true
    };
    const { errors, normalized } = validateAndNormalizeQuestion(doc);
    if (errors.length) plan.invalid.push({ number: q.number, errors });
    else plan.insert.push({ ...doc, ...normalized, active: true });
  }
  const toRetire = await Question.find({ type: "write-dictation", active: true, sourceGroup: { $not: GROUP } }).lean();
  console.log(`Data file: ${bank.length} questions`);
  console.log(`Plan: insert ${plan.insert.length}, already present ${plan.skipped}, invalid ${plan.invalid.length}, deactivate old ${toRetire.length}`);
  if (plan.invalid.length) { console.error("Invalid:", JSON.stringify(plan.invalid)); throw new Error("validation failed; nothing written"); }
  if (!write) { console.log("Dry run, nothing written. Re-run with --write."); return { inserted: 0, retired: 0 }; }

  if (toRetire.length) {
    fs.mkdirSync("uploads", { recursive: true });
    const backup = `uploads/write-from-dictation-backup-${Date.now()}.json`;
    fs.writeFileSync(backup, JSON.stringify(toRetire, null, 2));
    console.log(`Backup written: ${backup}`);
  }
  let inserted = 0;
  for (const doc of plan.insert) { // sequential, in order, so createdAt follows the listing order
    const question = await Question.create(doc);
    await AuditLog.create({ adminUser: author._id, targetUser: null, action: "QUESTION_CREATED",
      metadata: { questionId: question._id, title: question.title, section: question.section, type: question.type } });
    inserted++;
  }
  for (const q of toRetire) await Question.updateOne({ _id: q._id }, { $set: { active: false } });
  console.log(`Inserted ${inserted}, deactivated ${toRetire.length}.`);
  return { inserted, retired: toRetire.length };
}

export async function verify() {
  const bank = JSON.parse(fs.readFileSync(DATA, "utf8"));
  await connectDb();
  const rows = await Question.find({ sourceGroup: GROUP }).sort({ createdAt: 1 }).lean();
  const bySg = new Map(rows.map(r => [r.sourceGroup, r]));
  return {
    inDatabase: rows.length, expected: bank.length,
    active: rows.filter(r => r.active).length,
    inListingOrder: rows.map(r => r.sourceGroup).join() === bank.map(q => q.sourceGroup).join(),
    transcriptMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.transcript !== q.transcript).length,
    answerMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.answer !== q.transcript).length,
    audioMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.audioUrl !== q.audioUrl).length,
    oldWriteDictation: await Question.countDocuments({ type: "write-dictation", sourceGroup: { $not: GROUP } }),
    oldStillActive: await Question.countDocuments({ type: "write-dictation", sourceGroup: { $not: GROUP }, active: true }),
    totalQuestions: await Question.countDocuments()
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const write = process.argv.includes("--write");
    await run({ write });
    if (write || process.argv.includes("--verify")) console.log(JSON.stringify(await verify(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    const { default: mongoose } = await import("mongoose");
    await mongoose.disconnect();
  }
}
