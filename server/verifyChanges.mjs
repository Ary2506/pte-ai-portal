import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const check = async (label, filter, re) => {
  const rows = (await Question.find(filter).select("title active").lean()).filter(q => re.test(q.title || ""));
  console.log(`${label}: ${rows.length} matched, still active: ${rows.filter(q => q.active).length}`);
};
await check("Read Aloud 1-19", { type: "read-aloud" }, /^Read Aloud\s+([1-9]|1[0-9])$/);
await check("Reorder Paragraph 1-15", { type: "reorder" }, /^Reorder Paragraph\s+([1-9]|1[0-5])$/);
await check("Fill in the Blanks 1-15", { section: "reading", type: "fib-dropdown" }, /^Fill in the Blanks\s+([1-9]|1[0-5])$/);

const wfd = await Question.find({ type: "write-dictation", active: true }).select("title").sort({ createdAt: 1 }).lean();
console.log(`\nWFD active: ${wfd.length}  unique titles: ${new Set(wfd.map(q => q.title)).size}`);
console.log("   " + wfd.slice(0, 3).map(q => q.title).join(", ") + " ... " + wfd.slice(-2).map(q => q.title).join(", "));

const rows = await Question.aggregate([
  { $match: { active: true } }, { $group: { _id: "$section", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
let t = 0; for (const r of rows) { t += r.n; console.log(`${r._id.padEnd(10)} ${r.n}`); }
console.log("TOTAL ACTIVE: " + t);
await mongoose.disconnect();
