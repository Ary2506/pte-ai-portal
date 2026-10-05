// READ-ONLY. Joins the files on disk to the questions that reference them, folder by folder.
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Question from "./src/models/Question.js";

const PUBLIC = path.resolve("../client/public");
await mongoose.connect(process.env.MONGODB_URI);
const qs = await Question.find({}).select("active audioUrl").lean();

const refActive = new Set(), refInactive = new Set();
let remote = 0;
for (const q of qs) {
  if (!q.audioUrl) continue;
  if (!q.audioUrl.startsWith("/")) { if (q.active) remote++; continue; }
  (q.active ? refActive : refInactive).add(q.audioUrl);
}

const folders = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!e.name.toLowerCase().endsWith(".mp3")) continue;
    const url = "/" + path.relative(PUBLIC, full).split(path.sep).join("/");
    const folder = url.split("/").slice(2, -1).join("/");
    folders[folder] ||= { files: 0, active: 0, inactive: 0, orphan: 0 };
    const f = folders[folder];
    f.files++;
    if (refActive.has(url)) f.active++;
    else if (refInactive.has(url)) f.inactive++;
    else f.orphan++;
  }
})(path.join(PUBLIC, "audio"));

console.log("%s %6s %8s %9s %7s".replace(/%s|%6s|%8s|%9s|%7s/g, m => m) );
console.log("folder".padEnd(40) + "files".padStart(6) + "  in use".padStart(9) + "  held back".padStart(12) + "  orphan".padStart(9));
console.log("-".repeat(78));
let t = { files: 0, active: 0, inactive: 0, orphan: 0 };
for (const k of Object.keys(folders).sort()) {
  const f = folders[k];
  for (const key of Object.keys(t)) t[key] += f[key];
  console.log(k.padEnd(40) + String(f.files).padStart(6) + String(f.active).padStart(9) +
    String(f.inactive).padStart(12) + String(f.orphan).padStart(9));
}
console.log("-".repeat(78));
console.log("TOTAL".padEnd(40) + String(t.files).padStart(6) + String(t.active).padStart(9) +
  String(t.inactive).padStart(12) + String(t.orphan).padStart(9));
console.log("\nactive questions served by a LOCAL file : " + t.active);
console.log("active questions served by a REMOTE url : " + remote);
console.log("active questions needing audio, total   : " + (t.active + remote));
await mongoose.disconnect();
