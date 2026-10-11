// READ-ONLY. Which describe-image files on disk are actually used by a question?
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const DIR = path.resolve("../client/public/question-images/describe-image");
const onDisk = fs.readdirSync(DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();

await mongoose.connect(process.env.MONGODB_URI);
const qs = await Question.find({ type: "describe-image" })
  .select("title imageUrl active").sort({ createdAt: 1 }).lean();

const used = new Map();
for (const q of qs) {
  const f = (q.imageUrl || "").split("/").pop();
  if (f) used.set(f, q);
}
console.log("image files on disk      : " + onDisk.length);
console.log("describe-image questions : " + qs.length + "  (active " + qs.filter(q => q.active).length + ")");
console.log("files referenced         : " + onDisk.filter(f => used.has(f)).length);

const orphan = onDisk.filter(f => !used.has(f));
console.log("files with NO question   : " + orphan.length + "\n");
for (const f of orphan) {
  const kb = Math.round(fs.statSync(path.join(DIR, f)).size / 1024);
  console.log("   " + f.padEnd(28) + String(kb).padStart(5) + " KB");
}

const missing = qs.filter(q => { const f = (q.imageUrl || "").split("/").pop(); return !f || !onDisk.includes(f); });
console.log("\nquestions whose image file is missing: " + missing.length);
for (const m of missing) console.log('   ' + (m.active ? "active " : "inactive") + '  "' + m.title + '" -> ' + ((m.imageUrl || "(none)").slice(0, 60)));
await mongoose.disconnect();
