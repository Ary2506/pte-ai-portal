// Write From Dictation: the transcript is what the audio says, so it IS the answer. The `answer`
// field held the original question-bank sentence, which the audio was never generated from --
// every difference is a deliberate paraphrase ("vernacular" -> "traditional", "morning" ->
// "afternoon", "ten" -> "fifteen"), never an acoustic confusion. Students were being marked
// against a sentence the clip does not speak.
//
//   node fixWfdAnswers.mjs           dry run, writes nothing
//   node fixWfdAnswers.mjs --write   applies, after writing a backup
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const WRITE = process.argv.includes("--write");
const words = s => String(s || "").trim().split(/\s+/).filter(Boolean).length;

await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.find({ section: "listening", type: "write-dictation" })
  .select("title answer transcript maxScore sourceGroup active").lean();

const plan = [];
for (const r of rows) {
  const t = (r.transcript || "").trim();
  if (!t || t === (r.answer || "").trim()) continue;
  plan.push({ _id: r._id, sourceGroup: r.sourceGroup, from: r.answer, to: t,
              maxFrom: r.maxScore, maxTo: Math.max(1, words(t)) });
}

console.log((WRITE ? "APPLYING" : "DRY RUN") + " - " + plan.length + " of " + rows.length + " questions change\n");
for (const p of plan.slice(0, 5)) {
  console.log("  [" + (p.sourceGroup || "?") + "]  maxScore " + p.maxFrom + " -> " + p.maxTo);
  console.log("     was: " + p.from);
  console.log("     now: " + p.to);
}
if (plan.length > 5) console.log("  ... and " + (plan.length - 5) + " more");

const changedMax = plan.filter(p => p.maxFrom !== p.maxTo).length;
console.log("\nquestions whose word count (and so maxScore) changes: " + changedMax);

if (!WRITE) { console.log("\nNothing written. Re-run with --write to apply."); await mongoose.disconnect(); process.exit(0); }

const backup = "uploads/wfd-answers-backup-" + Date.now() + ".json";
fs.mkdirSync("uploads", { recursive: true });
fs.writeFileSync(backup, JSON.stringify(rows, null, 2));
console.log("\nbackup written: " + backup);

let n = 0;
for (const p of plan) {
  await Question.updateOne({ _id: p._id }, { $set: { answer: p.to, maxScore: p.maxTo } });
  n++;
}
console.log("updated " + n + " questions");

const left = await Question.find({ section: "listening", type: "write-dictation" })
  .select("answer transcript").lean();
const bad = left.filter(r => (r.transcript || "").trim() && (r.transcript || "").trim() !== (r.answer || "").trim());
console.log("remaining rows where transcript != answer: " + bad.length);
await mongoose.disconnect();
