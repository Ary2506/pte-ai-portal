import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import mongoose from "mongoose";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import User from "./models/User.js";
import AuditLog from "./models/AuditLog.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Inserts the 12 Write Email questions (src/data/writeEmail.json) through the same authoring path
// the admin Questions screen uses (routes/adminQuestions.js POST /):
//   validateAndNormalizeQuestion -> Question.create -> a QUESTION_CREATED audit entry.
//
//   node src/importWriteEmail.js                    dry run: validates and reports, writes nothing
//   node src/importWriteEmail.js --write            inserts, into a database on this machine only
//   node src/importWriteEmail.js --write --remote   inserts into a remote database (e.g. Atlas)
//
// The data file is extracted from client/public/writing-resources/write-email-samples.pdf, one
// question per page, in page order: `prompt` is the page's Question (scenario, then its three
// bullet points, one per line) and `answer` is the page's sample email, shown by "Show Answer".
// The PDF stays where it is as the source of record. Re-running is safe: a row is matched by its
// sourceGroup, so nothing is inserted twice and nothing existing is modified or deleted.

const DATA = path.resolve("src/data/writeEmail.json");
const GROUP = /^write-email\/pdf\//;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export async function run({ write = false, remote = false } = {}) {
  const bank = JSON.parse(fs.readFileSync(DATA, "utf8"));
  if (bank.length !== 12) throw new Error(`expected 12 questions in the data file, found ${bank.length}`);
  if (new Set(bank.map(q => q.sourceGroup)).size !== bank.length) throw new Error("duplicate sourceGroup in data file");
  if (bank.some((q, i) => q.number !== i + 1)) throw new Error("data file is not in page order 1-12");

  await connectDb();
  const host = mongoose.connection.host;
  console.log(`Database: ${host}/${mongoose.connection.name}`);
  if (write && !remote && !LOCAL_HOSTS.has(host)) {
    throw new Error(`refusing to write to remote database ${host}; pass --remote to do that deliberately`);
  }
  const author = await User.findOne({ role: "admin", username: "admin" }).select("_id username");
  if (!author) throw new Error('admin account "admin" not found, needed to attribute the audit entries');

  const existing = new Set((await Question.find({ sourceGroup: GROUP }).select("sourceGroup").lean()).map(r => r.sourceGroup));
  const plan = { insert: [], skipped: 0, invalid: [] };
  for (const q of bank) {
    if (existing.has(q.sourceGroup)) { plan.skipped++; continue; }
    const doc = {
      section: "writing", type: "write-email", title: q.title, prompt: q.prompt, answer: q.answer,
      difficulty: "medium", sourceGroup: q.sourceGroup, active: true
    };
    const { errors, normalized } = validateAndNormalizeQuestion(doc);
    if (errors.length) plan.invalid.push({ number: q.number, errors });
    else plan.insert.push({ ...doc, ...normalized, active: true });
  }
  console.log(`Data file: ${bank.length} questions`);
  console.log(`Plan: insert ${plan.insert.length}, already present ${plan.skipped}, invalid ${plan.invalid.length}`);
  if (plan.invalid.length) { console.error("Invalid:", JSON.stringify(plan.invalid)); throw new Error("validation failed; nothing written"); }
  if (!write) { console.log("Dry run, nothing written. Re-run with --write."); return { inserted: 0 }; }

  let inserted = 0;
  for (const doc of plan.insert) { // sequential, in order, so createdAt follows the page order
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
  const rows = await Question.find({ sourceGroup: GROUP }).sort({ createdAt: 1 }).lean();
  const bySg = new Map(rows.map(r => [r.sourceGroup, r]));
  return {
    inDatabase: rows.length, expected: bank.length,
    active: rows.filter(r => r.active).length,
    inPageOrder: rows.map(r => r.sourceGroup).join() === bank.map(q => q.sourceGroup).join(),
    titleMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.title !== q.title).length,
    promptMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.prompt !== q.prompt).length,
    answerMismatches: bank.filter(q => bySg.get(q.sourceGroup)?.answer !== q.answer).length,
    otherWriteEmail: await Question.countDocuments({ type: "write-email", sourceGroup: { $not: GROUP } }),
    totalQuestions: await Question.countDocuments()
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const write = process.argv.includes("--write");
    await run({ write, remote: process.argv.includes("--remote") });
    if (write || process.argv.includes("--verify")) console.log(JSON.stringify(await verify(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
