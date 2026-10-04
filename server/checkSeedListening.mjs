// READ-ONLY. Checks whether the three seed listening questions named for removal have any
// student submissions attached. A question with submissions must be deactivated rather than
// deleted, or that student's history loses the question it refers to. Writes nothing.
import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
import Submission from "./src/models/Submission.js";

const IDS = [
  ["summarize-spoken-text", "6abbbbbb53774d47c0c10a8d"],
  ["mcq-single", "6abbbbbb53774d47c0c10a8f"],
  ["write-dictation", "6abbbbbb53774d47c0c10a8e"]
];

await mongoose.connect(process.env.MONGODB_URI);

for (const [type, id] of IDS) {
  const question = await Question.findById(id).select("title type section active").lean();
  const submissions = await Submission.countDocuments({ question: id });
  console.log(
    type + "\n" +
    "  _id:         " + id + "\n" +
    "  found:       " + (question ? '"' + question.title + '" (' + question.section + "/" + question.type + ", active=" + question.active + ")" : "NOT FOUND") + "\n" +
    "  submissions: " + submissions
  );
}

await mongoose.disconnect();
