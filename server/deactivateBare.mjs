// Deactivates the four remaining placeholder-titled questions from the original seed batch.
//   node deactivateBare.mjs           dry run
//   node deactivateBare.mjs --write   applies, after a backup
//
// "Re-order Paragraphs" is linked to reading/reorder.json, so its `active` flag is set false in
// that file too -- syncQuestions writes any field present in an entry, so the database alone
// would not hold. The other three have no content file behind them.
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const WRITE = process.argv.includes("--write");
const REORDER_JSON = path.resolve("../client/content/reading/reorder.json");
const TARGETS = [
  ["Read Aloud",          { type: "read-aloud" }],
  ["Read Aloud 20",       { type: "read-aloud" }],
  ["Re-order Paragraphs", { type: "reorder" }],
  ["Fill in the Blanks",  { section: "reading", type: "fib-dropdown" }],
];

await mongoose.connect(process.env.MONGODB_URI);
console.log((WRITE ? "APPLYING" : "DRY RUN") + "\n");

const found = [];
for (const [title, filter] of TARGETS) {
  const rows = await Question.find({ ...filter, title, active: true }).select("title sourceGroup").lean();
  console.log(`"${title}": ${rows.length} active match${rows.length === 1 ? "" : "es"}`);
  found.push(...rows);
}
console.log(`\ntotal to deactivate: ${found.length}`);

if (!WRITE) { console.log("\nNothing written. Re-run with --write to apply."); await mongoose.disconnect(); process.exit(0); }

fs.mkdirSync("uploads", { recursive: true });
const backup = `uploads/bare-titles-backup-${Date.now()}.json`;
fs.writeFileSync(backup, JSON.stringify(found, null, 2));
console.log(`backup written: ${backup}`);

await Question.updateMany({ _id: { $in: found.map(q => q._id) } }, { $set: { active: false } });
console.log(`deactivated ${found.length} questions`);

const offIds = new Set(found.filter(q => (q.sourceGroup || "").includes("reorder.json"))
  .map(q => q.sourceGroup.split("#")[1]));
if (offIds.size) {
  const reorder = JSON.parse(fs.readFileSync(REORDER_JSON, "utf8"));
  let touched = 0;
  for (const e of reorder) if (offIds.has(e.id) && e.active !== false) { e.active = false; touched++; }
  fs.writeFileSync(REORDER_JSON, JSON.stringify(reorder, null, 2) + "\n");
  console.log(`reorder.json: ${touched} entries marked inactive`);
}
await mongoose.disconnect();
