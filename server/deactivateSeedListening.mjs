// Deactivates the three seed listening questions (the original demo rows: generic titles, no
// sourceGroup, placeholder Pixabay audio). active:false removes them from the practice library
// and from mock-test selection, which is what a student sees as "gone", while leaving the two
// existing submissions with a question to refer back to in that student's history.
//
// Deliberately not a delete: adminQuestions.js refuses to delete a question that has submissions
// ("Deactivate it instead"), and two of these do.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const IDS = [
  "6abbbbbb53774d47c0c10a8d", // listening/summarize-spoken-text — "Summarize Spoken Text"
  "6abbbbbb53774d47c0c10a8f", // listening/mcq-single            — "Multiple Choice"
  "6abbbbbb53774d47c0c10a8e"  // listening/write-dictation       — "Write From Dictation"
];

await mongoose.connect(process.env.MONGODB_URI);

for (const id of IDS) {
  const before = await Question.findById(id).select("title type active").lean();
  if (!before) { console.log(id + ": NOT FOUND — skipped"); continue; }
  if (!before.active) { console.log('"' + before.title + '" was already inactive — no change'); continue; }
  await Question.updateOne({ _id: id }, { $set: { active: false } });
  const after = await Question.findById(id).select("active").lean();
  console.log('"' + before.title + '" (' + before.type + ') active: ' + before.active + " -> " + after.active);
}

const remaining = await Question.countDocuments({ section: "listening", active: true });
console.log("\nActive listening questions remaining: " + remaining);

await mongoose.disconnect();
