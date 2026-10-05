// READ-ONLY. Reconciles the audio the question bank REFERENCES against the files on disk.
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const PUBLIC = path.resolve("../client/public");
await mongoose.connect(process.env.MONGODB_URI);

const qs = await Question.find({ active: true }).select("section type title audioUrl").lean();
const needsAudio = qs.filter(q => q.audioUrl);
const local = needsAudio.filter(q => q.audioUrl.startsWith("/"));
const remote = needsAudio.filter(q => !q.audioUrl.startsWith("/"));

console.log("active questions                 : " + qs.length);
console.log("  with an audioUrl               : " + needsAudio.length);
console.log("    local file (/audio/...)      : " + local.length);
console.log("    remote URL (someone's CDN)   : " + remote.length);

const bySection = {};
for (const q of needsAudio) bySection[q.section] = (bySection[q.section] || 0) + 1;
console.log("  by section                     : " + JSON.stringify(bySection));

const missing = local.filter(q => !fs.existsSync(path.join(PUBLIC, q.audioUrl)));
console.log("\nreferenced local files MISSING from disk: " + missing.length);
for (const m of missing.slice(0, 10)) console.log('   "' + m.title + '" -> ' + m.audioUrl);

// Files on disk that nothing points at.
const onDisk = [];
(function walk(dir, base) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base);
    else if (e.name.toLowerCase().endsWith(".mp3")) onDisk.push("/" + path.relative(base, full).split(path.sep).join("/"));
  }
})(path.join(PUBLIC, "audio"), PUBLIC);

const referenced = new Set(local.map(q => q.audioUrl));
const orphans = onDisk.filter(f => !referenced.has(f));
console.log("\nmp3 files on disk               : " + onDisk.length);
console.log("  referenced by an active question: " + (onDisk.length - orphans.length));
console.log("  orphaned (nothing points at them): " + orphans.length);
const byFolder = {};
for (const o of orphans) { const k = o.split("/").slice(0, 3).join("/"); byFolder[k] = (byFolder[k] || 0) + 1; }
for (const o of orphans) console.log("     " + o);

console.log("\nremote-hosted question audio (not in this project at all):");
for (const r of remote.slice(0, 8)) console.log('   ' + r.section + "/" + r.type + '  "' + r.title + '"');
if (remote.length > 8) console.log("   ... and " + (remote.length - 8) + " more");
await mongoose.disconnect();
