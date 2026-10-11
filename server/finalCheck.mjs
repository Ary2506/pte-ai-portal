import "dotenv/config";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";
await mongoose.connect(process.env.MONGODB_URI);
const qs = await Question.find({ section: "speaking", type: "describe-image", active: true })
  .select("title category imageUrl answer sourceGroup").sort({ createdAt: 1 }).lean();
console.log("active describe-image questions: " + qs.length);
const cats = {};
for (const q of qs) cats[q.category || "(uncategorised)"] = (cats[q.category || "(uncategorised)"] || 0) + 1;
console.log("by category: " + JSON.stringify(cats));
console.log("remote images still active : " + qs.filter(q => /^https?:/i.test(q.imageUrl || "")).length);
console.log("missing a model answer     : " + qs.filter(q => !(q.answer || "").trim()).length);
console.log("missing a sourceGroup      : " + qs.filter(q => !q.sourceGroup).length);
console.log("duplicate sourceGroups     : " + (qs.length - new Set(qs.map(q => q.sourceGroup)).size));
console.log("duplicate images           : " + (qs.length - new Set(qs.map(q => q.imageUrl)).size));
console.log("\nfirst five:");
for (const q of qs.slice(0, 5)) console.log("   [" + (q.category || "core-p").padEnd(8) + "] " + q.title);
await mongoose.disconnect();
