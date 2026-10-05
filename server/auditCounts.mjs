// READ-ONLY. Exact active/inactive counts per section and type, straight from the database, so
// the library figure can be checked against reality rather than against anyone's recollection.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.aggregate([
  { $group: { _id: { section: "$section", type: "$type", active: "$active" }, n: { $sum: 1 } } }
]);

const bySection = {};
for (const r of rows) {
  const { section, type, active } = r._id;
  bySection[section] ||= {};
  bySection[section][type] ||= { active: 0, inactive: 0 };
  bySection[section][type][active ? "active" : "inactive"] += r.n;
}

let totalActive = 0, totalInactive = 0;
for (const section of Object.keys(bySection).sort()) {
  let sa = 0, si = 0;
  const lines = [];
  for (const type of Object.keys(bySection[section]).sort()) {
    const { active, inactive } = bySection[section][type];
    sa += active; si += inactive;
    lines.push("    " + String(active).padStart(4) + " active" +
      (inactive ? "  (+" + inactive + " inactive)" : "") + "  " + type);
  }
  totalActive += sa; totalInactive += si;
  console.log(section.toUpperCase() + ": " + sa + " active" + (si ? ", " + si + " inactive" : ""));
  console.log(lines.join("\n"));
}
console.log("\nTOTAL ACTIVE   : " + totalActive);
console.log("TOTAL INACTIVE : " + totalInactive);
console.log("\nThis is the number the practice library must show: " + totalActive);
await mongoose.disconnect();
