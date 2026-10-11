// READ-ONLY. For Write From Dictation the transcript and the answer are the same sentence by
// definition. Anywhere they disagree, one of them is wrong and a student is marked against the
// answer while being shown the transcript.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.find({ section: "listening", type: "write-dictation" })
  .select("title answer transcript active sourceGroup").sort({ createdAt: 1 }).lean();

let withT = 0, same = 0, differ = [], noT = 0;
for (const r of rows) {
  const t = (r.transcript || "").trim();
  if (!t) { noT++; continue; }
  withT++;
  if (norm(t) === norm(r.answer)) same++;
  else differ.push(r);
}
console.log("write-dictation questions : " + rows.length);
console.log("  carry a transcript      : " + withT);
console.log("  transcript == answer    : " + same);
console.log("  transcript != answer    : " + differ.length);
console.log("  no transcript at all    : " + noT);
for (const d of differ.slice(0, 12)) {
  console.log("\n  [" + (d.sourceGroup || "no sourceGroup") + "]");
  console.log("    answer    : " + d.answer);
  console.log("    transcript: " + d.transcript);
}
await mongoose.disconnect();
