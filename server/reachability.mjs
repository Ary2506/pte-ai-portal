// READ-ONLY. Can a student actually open every active question?
// Two things can hide one: a task type the practice registry has no row for, and the 200-document
// cap on the per-task-type fetch the workspace uses.
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const FULL_LIMIT = 200; // routes/questions.js
const registry = fs.readFileSync("../client/src/practiceTaskRegistry.js", "utf8");
const slugs = new Set([...registry.matchAll(/slug:\s*"([^"]+)"/g)].map(m => m[1]));

await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.aggregate([
  { $match: { active: true } },
  { $group: { _id: { section: "$section", type: "$type" }, n: { $sum: 1 } } },
  { $sort: { "_id.section": 1, "_id.type": 1 } }
]);

let total = 0, reachable = 0;
const problems = [];
for (const r of rows) {
  const { section, type } = r._id;
  total += r.n;
  if (!slugs.has(type)) {
    problems.push(`  ${section}/${type}: ${r.n} active, but no row in the practice registry — counted, not openable`);
    continue;
  }
  const served = Math.min(r.n, FULL_LIMIT);
  reachable += served;
  if (served < r.n) problems.push(`  ${section}/${type}: ${r.n} active, only ${served} served (200-document cap)`);
  else if (r.n > FULL_LIMIT * 0.85) problems.push(`  ${section}/${type}: ${r.n} active — within ${FULL_LIMIT - r.n} of the cap`);
}

console.log("active in database : " + total);
console.log("openable by a student: " + reachable);
console.log(problems.length ? "\nnotes:\n" + problems.join("\n") : "\nEvery active question is openable.");
await mongoose.disconnect();
