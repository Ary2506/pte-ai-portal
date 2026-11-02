import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import User from "./models/User.js";
import AuditLog from "./models/AuditLog.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Inserts the "updated" Repeat Sentence set (src/data/repeatSentence.json, 60 questions) through the
// same authoring path the admin Questions screen uses (routes/adminQuestions.js POST /):
//   validateAndNormalizeQuestion -> Question.create -> a QUESTION_CREATED audit entry.
//
//   node src/importRepeatSentenceUpdated.js            dry run — validates and reports, writes nothing
//   node src/importRepeatSentenceUpdated.js --write    inserts
//
// `transcript` is what the clip says and is the expected answer. A row whose transcript is null is
// PENDING human verification (#1171): it is inserted with its audio attached but inactive, because
// nothing can be scored against it yet. Re-running is safe — a row is matched by its sourceGroup,
// so nothing is ever inserted twice and nothing existing is modified or deleted.

const DATA = path.resolve("src/data/repeatSentence.json");
const PROMPT = "Listen to the sentence, then repeat it exactly as you hear it.";
const PUBLIC_DIR = path.resolve("../client/public");

export async function run({ write = false } = {}) {
  const bank = JSON.parse(fs.readFileSync(DATA, "utf8"));
  if (new Set(bank.map(q => q.sourceGroup)).size !== bank.length) throw new Error("duplicate sourceGroup in data file");
  if (new Set(bank.map(q => q.audioUrl)).size !== bank.length) throw new Error("an audio file is assigned to more than one question");
  const missing = bank.filter(q => !fs.existsSync(path.join(PUBLIC_DIR, q.audioUrl)));
  if (missing.length) throw new Error(`audio file missing for: ${missing.map(q => q.number).join(", ")}`);

  await connectDb();
  const author = await User.findOne({ role: "admin", username: "admin" }).select("_id username");
  if (!author) throw new Error('admin account "admin" not found — needed to attribute the audit entries');

  const existing = new Set((await Question.find({ sourceGroup: /^repeat-sentence\/updated\// }).select("sourceGroup").lean()).map(r => r.sourceGroup));
  const plan = { insert: [], skipped: 0, invalid: [] };
  for (const q of bank) {
    if (existing.has(q.sourceGroup)) { plan.skipped++; continue; }
    const pending = !q.transcript;
    const doc = {
      section: "speaking", type: "repeat-sentence", title: q.title, prompt: PROMPT, audioUrl: q.audioUrl,
      ...(pending ? {} : { transcript: q.transcript }),
      difficulty: "medium", sourceGroup: q.sourceGroup, active: !pending
    };
    const { errors, normalized } = validateAndNormalizeQuestion(doc);
    if (errors.length) plan.invalid.push({ number: q.number, errors });
    else plan.insert.push({ ...doc, ...normalized, active: doc.active });
  }
  const pendingRows = bank.filter(q => !q.transcript).map(q => `#${q.number}`);
  console.log(`Data file: ${bank.length} questions | pending verification: ${pendingRows.join(", ") || "none"}`);
  console.log(`Plan: insert ${plan.insert.length} (active ${plan.insert.filter(d => d.active).length}, inactive ${plan.insert.filter(d => !d.active).length}), already present ${plan.skipped}, invalid ${plan.invalid.length}`);
  if (plan.invalid.length) { console.error("Invalid:", JSON.stringify(plan.invalid)); throw new Error("validation failed; nothing written"); }
  if (!write) { console.log("Dry run — nothing written. Re-run with --write."); return { inserted: 0 }; }

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
  const rows = await Question.find({ sourceGroup: /^repeat-sentence\/updated\// }).lean();
  const bySg = new Map(rows.map(r => [r.sourceGroup, r]));
  return {
    inDatabase: rows.length, expected: bank.length,
    withAudio: rows.filter(r => r.audioUrl?.startsWith("/audio/repeat-sentence/updatedAudios/")).length,
    active: rows.filter(r => r.active).length,
    inactivePending: rows.filter(r => !r.active).map(r => r.sourceGroup),
    transcriptMismatches: bank.filter(q => q.transcript && bySg.get(q.sourceGroup)?.transcript !== q.transcript).length,
    audioMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.audioUrl !== q.audioUrl).length,
    otherRepeatSentenceUntouched: await Question.countDocuments({ type: "repeat-sentence", sourceGroup: { $not: /^repeat-sentence\/updated\// } }),
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
