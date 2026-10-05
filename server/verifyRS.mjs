// READ-ONLY. Health check on the imported Repeat Sentence bank.
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const bank = JSON.parse(fs.readFileSync("src/data/repeatSentenceBank.json", "utf8"));
await mongoose.connect(process.env.MONGODB_URI);
const rows = await Question.find({ section: "speaking", type: "repeat-sentence" })
  .select("title audioUrl transcript sourceGroup active").lean();

const byGroup = new Map(rows.map(r => [r.sourceGroup, r]));
console.log("bank entries: " + bank.length + "   db rows: " + rows.length);
console.log("active: " + rows.filter(r => r.active).length + "   inactive: " + rows.filter(r => !r.active).length);

const missing = bank.filter(e => !byGroup.has(e.sourceGroup));
console.log("bank entries with no db row: " + missing.length);
const orphan = rows.filter(r => !bank.some(e => e.sourceGroup === r.sourceGroup));
console.log("db rows with no bank entry: " + orphan.length);
for (const o of orphan) console.log('   orphan: "' + o.title + '" [' + (o.sourceGroup || "no sourceGroup") + "]");

const noGroup = rows.filter(r => !r.sourceGroup);
console.log("db rows with NO sourceGroup (admin-panel style): " + noGroup.length);
for (const n of noGroup) console.log('   "' + n.title + '"  audio:' + (n.audioUrl || "none"));

const noTranscript = rows.filter(r => !(r.transcript || "").trim());
console.log("rows with no transcript: " + noTranscript.length +
  (noTranscript.length ? "  (active: " + noTranscript.filter(r => r.active).length + ")" : ""));
for (const n of noTranscript) console.log('   "' + n.title + '" active=' + n.active);

// Every clip the DB points at must exist on disk, or the question is unanswerable.
const PUBLIC = path.resolve("../client/public");
const missingAudio = rows.filter(r => !r.audioUrl || !fs.existsSync(path.join(PUBLIC, r.audioUrl)));
console.log("rows whose audio file is missing on disk: " + missingAudio.length);
for (const m of missingAudio.slice(0, 10)) console.log('   "' + m.title + '" -> ' + m.audioUrl);

// Two questions must never share a clip.
const byAudio = new Map();
for (const r of rows) byAudio.set(r.audioUrl, (byAudio.get(r.audioUrl) || 0) + 1);
const dupAudio = [...byAudio].filter(([, n]) => n > 1);
console.log("audio files used by more than one question: " + dupAudio.length);
for (const [url, n] of dupAudio.slice(0, 10)) console.log("   " + url + " x" + n);

await mongoose.disconnect();
