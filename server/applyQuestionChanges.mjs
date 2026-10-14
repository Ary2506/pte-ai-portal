// Four requested changes, applied together so the dry run shows the whole picture.
//
//   node applyQuestionChanges.mjs           dry run, writes nothing
//   node applyQuestionChanges.mjs --write   applies, after writing a backup
//
// 1-3 deactivate placeholder-titled questions. Deactivated, never deleted: a student may already
// have answered one, and the row is what their history refers back to.
//
// The 15 Reorder questions are linked to reading/reorder.json, so their `active` flag is set to
// false in that file too. syncQuestions only writes fields present in an entry, so leaving the
// file alone would let the next sync flip them back on. Read Aloud and Fill in the Blanks have no
// content file behind them, so the database is their only source.
//
// 4 numbers the Write From Dictation titles, which were all the identical string "WFD" -- 45
// questions a student or an admin could not tell apart in a list, a search or a results table.
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const WRITE = process.argv.includes("--write");
const REORDER_JSON = path.resolve("../client/content/reading/reorder.json");
const WFD_JSON = path.resolve("../client/content/listening/write-from-dictation/write_from_dictation.json");

const DEACTIVATE = [
  ["Read Aloud 1-19", { type: "read-aloud" }, /^Read Aloud\s+([1-9]|1[0-9])$/],
  ["Reorder Paragraph 1-15", { type: "reorder" }, /^Reorder Paragraph\s+([1-9]|1[0-5])$/],
  ["Fill in the Blanks 1-15", { section: "reading", type: "fib-dropdown" }, /^Fill in the Blanks\s+([1-9]|1[0-5])$/],
];

await mongoose.connect(process.env.MONGODB_URI);
console.log((WRITE ? "APPLYING" : "DRY RUN") + "\n");

// ---- 1-3: deactivate -------------------------------------------------------
const toDeactivate = [];
for (const [label, filter, re] of DEACTIVATE) {
  const rows = (await Question.find({ ...filter, active: true }).select("title sourceGroup").sort({ createdAt: 1 }).lean())
    .filter(q => re.test(q.title || ""));
  console.log(`${label}: ${rows.length} active questions to deactivate`);
  toDeactivate.push(...rows);
}

// ---- 4: number the WFD titles ---------------------------------------------
const wfd = await Question.find({ type: "write-dictation", title: "WFD" })
  .select("title sourceGroup").sort({ createdAt: 1 }).lean();
// Zero-padded so they stay in order when sorted as text -- unpadded, "WFD 10" sorts before
// "WFD 2" in the admin list and in any CSV export.
const pad = String(wfd.length).length;
const renames = wfd.map((q, i) => ({ _id: q._id, sourceGroup: q.sourceGroup,
                                     title: `WFD ${String(i + 1).padStart(pad, "0")}` }));
console.log(`\nWrite From Dictation: ${renames.length} titles to number`);
if (renames.length) {
  console.log(`   "${renames[0].title}" ... "${renames.at(-1).title}"`);
}

if (!WRITE) {
  console.log("\nNothing written. Re-run with --write to apply.");
  await mongoose.disconnect();
  process.exit(0);
}

// ---- apply -----------------------------------------------------------------
fs.mkdirSync("uploads", { recursive: true });
const stamp = Date.now();
const backup = `uploads/question-changes-backup-${stamp}.json`;
fs.writeFileSync(backup, JSON.stringify({ deactivated: toDeactivate, renamed: renames }, null, 2));
console.log(`\nbackup written: ${backup}`);

const ids = toDeactivate.map(q => q._id);
if (ids.length) await Question.updateMany({ _id: { $in: ids } }, { $set: { active: false } });
console.log(`deactivated ${ids.length} questions`);

for (const r of renames) await Question.updateOne({ _id: r._id }, { $set: { title: r.title } });
console.log(`renamed ${renames.length} questions`);

// Keep the content files in step so a later sync or import does not undo either change.
const reorder = JSON.parse(fs.readFileSync(REORDER_JSON, "utf8"));
const offIds = new Set(toDeactivate.filter(q => (q.sourceGroup || "").includes("reorder.json"))
  .map(q => q.sourceGroup.split("#")[1]));
let reorderTouched = 0;
for (const entry of reorder) {
  if (offIds.has(entry.id) && entry.active !== false) { entry.active = false; reorderTouched++; }
}
fs.writeFileSync(REORDER_JSON, JSON.stringify(reorder, null, 2) + "\n");
console.log(`reorder.json: ${reorderTouched} entries marked inactive`);

const byGroupId = new Map(renames.filter(r => r.sourceGroup)
  .map(r => [r.sourceGroup.split("#")[1], r.title]));
const wfdFile = JSON.parse(fs.readFileSync(WFD_JSON, "utf8"));
let wfdTouched = 0;
for (const entry of wfdFile) {
  const t = byGroupId.get(String(entry.id));
  if (t && entry.title !== t) { entry.title = t; wfdTouched++; }
}
fs.writeFileSync(WFD_JSON, JSON.stringify(wfdFile, null, 2) + "\n");
console.log(`write_from_dictation.json: ${wfdTouched} titles updated`);

const left = await Question.countDocuments({ type: "write-dictation", title: "WFD" });
console.log(`\nremaining questions still titled just "WFD": ${left}`);
await mongoose.disconnect();
