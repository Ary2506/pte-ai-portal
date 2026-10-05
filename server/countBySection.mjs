import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.aggregate([
  { $match: { active: true } },
  { $group: { _id: "$section", n: { $sum: 1 } } }, { $sort: { _id: 1 } }
]);
let total = 0;
for (const r of rows) { total += r.n; console.log(r._id.padEnd(10), r.n, r.n > 200 ? "  <-- OVER THE 200 CAP" : ""); }
console.log("TOTAL ACTIVE:", total);
console.log("What the hub can see (min(section,200) summed):",
  rows.reduce((a, r) => a + Math.min(r.n, 200), 0));
await mongoose.disconnect();
