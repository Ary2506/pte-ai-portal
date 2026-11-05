import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import User from "./models/User.js";
import AuditLog from "./models/AuditLog.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Inserts the new Respond to a Situation set (src/data/respondToSituation.json, 21 questions) through the
// same authoring path the admin Questions screen uses (routes/adminQuestions.js POST /):
//   validateAndNormalizeQuestion -> Question.create -> a QUESTION_CREATED audit entry.
//
//   node src/importRespondToSituation.js            dry run: validates and reports, writes nothing
//   node src/importRespondToSituation.js --write    inserts
//
// Per question: `transcript` is the situation as the audio says it, `prompt` is the same text (the practice
// screen shows the prompt as the task text, exactly as the existing Respond to a Situation questions do),
// `answer` is the model answer shown by "Show Answer", and `audioUrl` is its clip. Re-running is safe: a row
// is matched by its sourceGroup, so nothing is inserted twice and nothing existing is modified or deleted.

const DATA = path.resolve("src/data/respondToSituation.json");
const PUBLIC_DIR = path.resolve("../client/public");
const GROUP = /^respond-to-situation\/new\//;

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
      section: "speaking", type: "respond-to-situation", title: q.title, prompt: q.transcript, transcript: q.transcript,
      ...(q.answer ? { answer: q.answer } : {}),
      audioUrl: q.audioUrl, difficulty: "medium", sourceGroup: q.sourceGroup, active: true
    };
    const { errors, normalized } = validateAndNormalizeQuestion(doc);
    if (errors.length) plan.invalid.push({ number: q.number, errors });
    else plan.insert.push({ ...doc, ...normalized, active: true });
  }
  const noAnswer = bank.filter(q => !q.answer).map(q => `#${q.number}`);
  console.log(`Data file: ${bank.length} questions | without a model answer: ${noAnswer.join(", ") || "none"}`);
  console.log(`Plan: insert ${plan.insert.length}, already present ${plan.skipped}, invalid ${plan.invalid.length}`);
  if (plan.invalid.length) { console.error("Invalid:", JSON.stringify(plan.invalid)); throw new Error("validation failed; nothing written"); }
  if (!write) { console.log("Dry run, nothing written. Re-run with --write."); return { inserted: 0 }; }

  let inserted = 0;
  for (const doc of plan.insert) { // sequential, in order, so createdAt follows the listing order
    const question = await Question.create(doc);
    await AuditLog.create({ adminUser: author._id, targetUser: null, action: "QUESTION_CREATED",
      metadata: { questionId: question._id, title: question.title, section: question.section, type: question.type } });
    inserted++;
  }
  console.log(`Inserted ${inserted}.`);
  return { inserted };
}

export async function verify() {
  const bank = JSON.parse(fs.readFileSync(DATA, "utf8"));
  await connectDb();
  const rows = await Question.find({ sourceGroup: GROUP }).lean();
  const bySg = new Map(rows.map(r => [r.sourceGroup, r]));
  return {
    inDatabase: rows.length, expected: bank.length,
    active: rows.filter(r => r.active).length,
    withAudio: rows.filter(r => r.audioUrl?.startsWith("/audio/respond-to-situation/new-response/")).length,
    withAnswer: rows.filter(r => r.answer).length,
    withoutAnswer: rows.filter(r => !r.answer).map(r => r.sourceGroup),
    transcriptMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.transcript !== q.transcript).length,
    answerMismatches: bank.filter(q => (bySg.get(q.sourceGroup)?.answer || null) !== (q.answer || null)).length,
    audioMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.audioUrl !== q.audioUrl).length,
    oldRespondToSituation: await Question.countDocuments({ type: "respond-to-situation", sourceGroup: { $not: GROUP } }),
    oldStillActive: await Question.countDocuments({ type: "respond-to-situation", sourceGroup: { $not: GROUP }, active: true }),
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
