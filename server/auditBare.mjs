import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const TARGETS = [
  ["Read Aloud",          { type: "read-aloud" }],
  ["Read Aloud 20",       { type: "read-aloud" }],
  ["Re-order Paragraphs", { type: "reorder" }],
  ["Fill in the Blanks",  { section: "reading", type: "fib-dropdown" }],
];
for (const [title, filter] of TARGETS) {
  const rows = await Question.find({ ...filter, title }).select("title active sourceGroup createdAt").lean();
  console.log(`"${title}"  (${filter.section || "any"}/${filter.type})`);
  for (const r of rows) {
    console.log(`   active=${r.active}  sourceGroup=${r.sourceGroup || "(none)"}  created=${r.createdAt.toISOString().slice(0,10)}`);
  }
  if (!rows.length) console.log("   NO MATCH");
}
// Same bare title elsewhere, so nothing is caught by accident.
const others = await Question.find({ title: "Fill in the Blanks", active: true })
  .select("section type title").lean();
console.log(`\n"Fill in the Blanks" across all sections: ${others.length}`);
for (const o of others) console.log(`   ${o.section}/${o.type}`);
await mongoose.disconnect();
