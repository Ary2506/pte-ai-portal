// READ-ONLY. Lists every repeat-sentence question with the fields that say whether it came in
// through the authoring pipeline (sourceGroup set, audio under /audio/...) or was typed into the
// admin panel (no sourceGroup, audio pointing wherever the author pasted). Writes nothing.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.find({ section: "speaking", type: "repeat-sentence" })
  .select("title prompt answer audioUrl transcript sourceGroup active createdAt")
  .sort({ createdAt: 1 })
  .lean();

console.log("repeat-sentence questions: " + rows.length + "\n");
for (const r of rows) {
  console.log(
    'title:       "' + r.title + '"\n' +
    "  active:      " + r.active + "\n" +
    "  sourceGroup: " + (r.sourceGroup || "(none — not authored)") + "\n" +
    "  audioUrl:    " + (r.audioUrl || "(none)") + "\n" +
    "  answer:      " + (typeof r.answer === "string" ? JSON.stringify(r.answer).slice(0, 80) : JSON.stringify(r.answer)) + "\n" +
    "  transcript:  " + (r.transcript ? JSON.stringify(r.transcript).slice(0, 80) : "(none)") + "\n" +
    "  created:     " + r.createdAt.toISOString()
  );
}
await mongoose.disconnect();
