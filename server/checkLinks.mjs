import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const sets = [
  ["read-aloud", /^Read Aloud\s+([1-9]|1[0-9])$/, {}],
  ["reorder", /^Reorder Paragraph\s+([1-9]|1[0-5])$/, {}],
  ["fib-dropdown", /^Fill in the Blanks\s+([1-9]|1[0-5])$/, { section: "reading" }],
];
for (const [type, re, extra] of sets) {
  const rows = (await Question.find({ type, ...extra }).select("title sourceGroup").lean())
    .filter(q => re.test(q.title || ""));
  const linked = rows.filter(q => q.sourceGroup);
  console.log(`${type}: ${rows.length} matched, ${linked.length} linked to a content file`);
  if (linked.length) console.log("   e.g. " + linked.slice(0, 2).map(q => `${q.title} -> ${q.sourceGroup}`).join(" | "));
}
await mongoose.disconnect();
