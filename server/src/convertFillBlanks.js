import fs from "fs";
import path from "path";
import crypto from "crypto";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";

// Converts authored multi-blank reading questions into the fill-blanks-dragdrop shape the app
// already renders and scores.
//
// The authored format gives every blank its own option list. fill-blanks-dragdrop has a single
// shared word bank instead, so this merges all the option lists into one pool and rewrites each
// blank's answer as an index into it. The other reading type, fill-blanks, is not an option here:
// its renderer does passage.split("____") and keeps only the first blank.
//
//   node src/convertFillBlanks.js <file.json> [--write]
//
// The file may hold a single question object or an array of them. Without --write it validates,
// converts and prints, touching nothing.

const DRAG_PROMPT = "Drag each word from the word bank into the correct blank.";
const BLANK = "____";
// Punctuation that attaches directly to the preceding word, so no space is inserted before it.
const CLOSING_PUNCTUATION = /^[,.;:!?)\]}'"’”]/;

// Seeded so a given question always produces the same word-bank order. An unseeded shuffle would
// reorder the bank on every run, rewriting `answer` indices and making re-imports inconsistent.
function seededShuffle(items, seedText) {
  const hash = crypto.createHash("sha256").update(seedText).digest();
  let state = hash.readUInt32LE(0) || 1;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The authored `content` entries are "text, then a blank" — the final entry has no blankId and is
// the passage's tail. Spacing has to be repaired here: authored text segments end and begin
// mid-sentence ("...the word we" + blank + " for weather..."), so a naive join yields "we____ for".
function buildPassage(content) {
  let passage = "";
  for (const part of content) {
    const text = part.text ?? "";
    if (text) {
      const needsSpace = passage && !/\s$/.test(passage) && !CLOSING_PUNCTUATION.test(text) && !/^\s/.test(text);
      passage += (needsSpace ? " " : "") + text;
    }
    if (part.blankId) {
      passage += (passage && !/\s$/.test(passage) ? " " : "") + BLANK;
    }
  }
  return passage.replace(/[ \t]+/g, " ").trim();
}

function convert(source, index) {
  const label = source.id || source.title || `question ${index + 1}`;
  const errors = [];

  const content = Array.isArray(source.content) ? source.content : [];
  const blanks = Array.isArray(source.blanks) ? source.blanks : [];
  if (!content.length) errors.push("no `content` array");
  if (!blanks.length) errors.push("no `blanks` array");
  if (!source.title) errors.push("no `title`");

  // Blank order comes from the passage, not from the `blanks` array — the scorer reads
  // `answer[n]` as "the nth blank in passage order", so the two must agree.
  const orderedIds = content.filter(p => p.blankId).map(p => p.blankId);
  const byId = new Map(blanks.map(b => [b.id, b]));

  for (const id of orderedIds) {
    if (!byId.has(id)) errors.push(`content references blank "${id}" with no matching entry in \`blanks\``);
  }
  for (const b of blanks) {
    if (!orderedIds.includes(b.id)) errors.push(`blank "${b.id}" is never placed in \`content\``);
    if (!Array.isArray(b.options) || !b.options.length) errors.push(`blank "${b.id}" has no options`);
    else if (!b.options.includes(b.answer)) errors.push(`blank "${b.id}" answer "${b.answer}" is not among its own options`);
  }
  if (new Set(orderedIds).size !== orderedIds.length) errors.push("the same blankId is used twice in `content`");

  if (errors.length) return { label, errors };

  // One shared pool. Duplicates across blanks collapse, which is correct: a word bank lists each
  // word once, and the scorer allows the same index to answer more than one blank.
  const pool = seededShuffle([...new Set(blanks.flatMap(b => b.options))], label);
  const answer = orderedIds.map(id => pool.indexOf(byId.get(id).answer));
  if (answer.some(i => i < 0)) return { label, errors: ["internal: an answer went missing from the merged pool"] };

  const passage = buildPassage(content);
  const blankCount = (passage.match(/____/g) || []).length;
  if (blankCount !== orderedIds.length) {
    return { label, errors: [`built ${blankCount} blanks in the passage but expected ${orderedIds.length}`] };
  }

  return {
    label,
    doc: {
      section: "reading",
      type: "fill-blanks-dragdrop",
      title: source.title,
      prompt: source.prompt || DRAG_PROMPT,
      passage,
      options: pool,
      answer,
      // The authored `transcript` is the completed passage. Stored on the question rather than
      // discarded; note it is not currently rendered anywhere for an objective result.
      explanation: source.transcript || undefined,
      evaluationType: "objective",
      maxScore: orderedIds.length,
      difficulty: source.difficulty || "medium",
      active: true
    }
  };
}

const [file] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const write = process.argv.includes("--write");
if (!file) {
  console.error("Usage: node src/convertFillBlanks.js <file.json> [--write]");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const sources = Array.isArray(raw) ? raw : [raw];
const results = sources.map(convert);
const good = results.filter(r => r.doc);
const bad = results.filter(r => r.errors);

for (const r of bad) {
  console.error(`REJECTED  ${r.label}`);
  r.errors.forEach(e => console.error(`          - ${e}`));
}

for (const r of good) {
  const d = r.doc;
  console.log(`\nOK  ${r.label}  (${d.maxScore} blanks, ${d.options.length} words in the bank)`);
  console.log(`    ${d.passage}`);
  console.log(`    bank:   ${d.options.join(" | ")}`);
  console.log(`    answer: [${d.answer.join(", ")}]  ->  ${d.answer.map(i => d.options[i]).join(", ")}`);
}

console.log(`\n${good.length} convertible, ${bad.length} rejected`);

if (!write) {
  console.log("\nDry run. Re-run with --write to insert into the question bank.");
  process.exit(bad.length ? 1 : 0);
}
if (bad.length) {
  console.error("\nRefusing to write while any question is invalid — fix them first.");
  process.exit(1);
}

await connectDb();
let inserted = 0;
let skipped = 0;
for (const r of good) {
  // Title is the only stable identifier the authored format and the database share, so it is
  // what makes a re-run safe to repeat rather than duplicating the bank.
  const exists = await Question.findOne({ section: "reading", type: "fill-blanks-dragdrop", title: r.doc.title });
  if (exists) { skipped += 1; console.log(`skipped (already present): ${r.doc.title}`); continue; }
  await Question.create(r.doc);
  inserted += 1;
}
console.log(`\ninserted ${inserted}, skipped ${skipped}`);
process.exit(0);
