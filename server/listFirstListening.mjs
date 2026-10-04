// READ-ONLY. Prints the first few active questions of the three listening types named for
// removal, in the same order the student sees them (the /questions route sorts by createdAt), so
// the exact rows can be confirmed before anything is deleted. Writes nothing.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const TYPES = ["summarize-spoken-text", "mcq-single", "write-dictation"];

await mongoose.connect(process.env.MONGODB_URI);

for (const type of TYPES) {
  const rows = await Question.find({ section: "listening", type, active: true })
    .select("title prompt answer audioUrl sourceGroup createdAt")
    .sort({ createdAt: 1 })
    .limit(3)
    .lean();

  console.log(`\n=== ${type} — ${rows.length ? "" : "NO ACTIVE QUESTIONS"}`);
  rows.forEach((row, i) => {
    const answer = typeof row.answer === "string" ? row.answer : JSON.stringify(row.answer);
    console.log(
      `${i + 1}. _id=${row._id}\n` +
      `   title: ${row.title}\n` +
      `   sourceGroup: ${row.sourceGroup || "(none)"}\n` +
      `   audio: ${row.audioUrl || "(none)"}\n` +
      `   answer: ${(answer || "").slice(0, 90)}\n` +
      `   created: ${row.createdAt?.toISOString?.() || row.createdAt}`
    );
  });
}

await mongoose.disconnect();
