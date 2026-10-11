// READ-ONLY. Where did each question type's content come from? sourceGroup set = authored in a
// file and imported; absent = typed straight into the database.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.aggregate([
  { $group: { _id: { section: "$section", type: "$type" }, n: { $sum: 1 },
      linked: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$sourceGroup", ""] } }, 0] }, 1, 0] } } } },
  { $sort: { "_id.section": 1, "_id.type": 1 } }
]);
console.log("section/type".padEnd(42) + "total  authored  db-only");
for (const r of rows) {
  const k = (r._id.section + "/" + r._id.type).padEnd(42);
  console.log(k + String(r.n).padStart(5) + String(r.linked).padStart(10) + String(r.n - r.linked).padStart(9));
}
const samples = await Question.find({ type: "describe-image" }).select("title sourceGroup imageUrl").lean();
console.log("\ndescribe-image rows, every one of them:");
for (const s of samples) {
  console.log("   " + (s.sourceGroup || "(no sourceGroup)").padEnd(20) + " " +
    (s.imageUrl || "(no image)").replace(/^https:\/\/[^/]+\/.*$/, "REMOTE cloudfront URL").slice(0, 52) +
    "   " + s.title);
}
await mongoose.disconnect();
