// READ-ONLY. Active question counts per section and per type, to see whether a 20-per-section
// mock test can actually be built from the bank.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.aggregate([
  { $match: { active: true } },
  { $group: { _id: { section: "$section", type: "$type" }, n: { $sum: 1 } } },
  { $sort: { "_id.section": 1, "_id.type": 1 } }
]);
const bySection = {};
for (const r of rows) {
  (bySection[r._id.section] ||= []).push([r._id.type, r.n]);
}
for (const [section, types] of Object.entries(bySection)) {
  const total = types.reduce((sum, [, n]) => sum + n, 0);
  console.log(`\n${section.toUpperCase()} — ${total} active (${types.length} types)`);
  for (const [type, n] of types) console.log(`   ${String(n).padStart(4)}  ${type}`);
}
await mongoose.disconnect();
