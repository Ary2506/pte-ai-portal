// READ-ONLY. Which listening types carry a transcript, and for which of them is that transcript
// effectively the answer key?
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.aggregate([
  { $match: { section: "listening", active: true } },
  { $group: { _id: "$type", n: { $sum: 1 },
      withT: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$transcript", ""] } }, 0] }, 1, 0] } } } },
  { $sort: { _id: 1 } }
]);
const VERDICT = {
  "write-dictation": "LEAK - the transcript IS the sentence to write",
  "fill-blanks-typed": "LEAK - the transcript contains every blanked word",
  "highlight-incorrect-words": "LEAK - the transcript shows which words differ",
  "select-missing-word": "LEAK - the transcript contains the missing word",
  "mcq-single": "LEAK - the transcript answers the comprehension question",
  "summarize-spoken-text": "safe - you summarise it, you do not transcribe it",
};
for (const r of rows) {
  console.log(String(r.withT).padStart(3) + " of " + String(r.n).padEnd(4) + " carry a transcript   " +
    r._id.padEnd(26) + (VERDICT[r._id] || "?"));
}
await mongoose.disconnect();
