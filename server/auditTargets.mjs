// READ-ONLY. Exactly which questions the four requested changes would touch.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);

async function show(label, filter, re) {
  const all = await Question.find(filter).select("title active sourceGroup").sort({ createdAt: 1 }).lean();
  const hit = all.filter(q => re.test(q.title || ""));
  console.log(`\n${label}`);
  console.log(`   total of this type: ${all.length} (active ${all.filter(q => q.active).length})`);
  console.log(`   title matches pattern: ${hit.length} (active ${hit.filter(q => q.active).length})`);
  const nums = hit.map(q => Number((q.title.match(/(\d+)\s*$/) || [])[1])).filter(Number.isFinite).sort((a, b) => a - b);
  if (nums.length) console.log(`   numbers present: ${nums[0]}..${nums.at(-1)}  (${nums.length} of them)`);
  const sample = hit.slice(0, 3).map(q => `"${q.title}"`).join(", ");
  console.log(`   first few: ${sample}${hit.length > 3 ? " ..." : ""}`);
  const others = all.filter(q => !re.test(q.title || "")).slice(0, 3).map(q => `"${q.title}"`).join(", ");
  console.log(`   NOT matched (stay active): ${others}${all.length - hit.length > 3 ? " ..." : ""}`);
  return hit;
}

await show("1) Read Aloud 1-19", { type: "read-aloud" }, /^Read Aloud\s+([1-9]|1[0-9])$/);
await show("2) Reorder Paragraph 1-15", { type: "reorder" }, /^Reorder Paragraph\s+([1-9]|1[0-5])$/);
await show("3) Fill in the Blanks 1-15 (reading dropdown)", { section: "reading", type: "fib-dropdown" }, /^Fill in the Blanks\s+([1-9]|1[0-5])$/);

const wfd = await Question.find({ type: "write-dictation" }).select("title active").lean();
const titles = {};
for (const q of wfd) titles[q.title] = (titles[q.title] || 0) + 1;
console.log("\n4) Write From Dictation titles:");
for (const [t, n] of Object.entries(titles)) console.log(`   "${t}" x${n}`);
await mongoose.disconnect();
