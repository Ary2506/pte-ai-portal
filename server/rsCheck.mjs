import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.aggregate([
  { $match: { active: true, section: { $in: ["speaking", "listening"] } } },
  { $group: { _id: { section: "$section", type: "$type" },
      total: { $sum: 1 },
      withAudio: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$audioUrl", ""] } }, 0] }, 1, 0] } } } },
  { $sort: { "_id.section": 1, "_id.type": 1 } }
]);
let t = 0, a = 0;
for (const r of rows) {
  t += r.total; a += r.withAudio;
  const note = r.withAudio === 0 ? "   <- no audio by design (student reads/speaks from text)"
    : r.withAudio < r.total ? "   <- " + (r.total - r.withAudio) + " MISSING audio" : "";
  console.log(String(r.total).padStart(4) + " questions, " + String(r.withAudio).padStart(4) +
    " with audio   " + r._id.section + "/" + r._id.type + note);
}
console.log("\nspeaking+listening active: " + t + "   of which reference audio: " + a);
await mongoose.disconnect();
