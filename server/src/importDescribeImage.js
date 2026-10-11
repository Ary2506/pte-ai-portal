import fs from "fs";
import path from "path";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

// Imports the Describe Image bank from its one authoring file.
//
//   node src/importDescribeImage.js            dry run -- reads, validates, reports, writes nothing
//   node src/importDescribeImage.js --write    backs up, then inserts/updates/retires
//
// Describe Image was the one task type with no authoring file: eight questions were hardcoded as
// a JavaScript array inside seedPhase18Content.js and six more were typed straight into the
// database, five of them pointing at a CloudFront URL rather than a local image. Meanwhile 41
// images sat in client/public/question-images/describe-image with no question at all.
//
// Every row is linked back to its entry by `sourceGroup`, so re-running is safe: an unchanged row
// is skipped, an edited title or answer updates its row, and nothing is ever duplicated. This is
// the same contract migrateListeningToDb.js and importRepeatSentenceBank.js already follow.
//
// Questions NOT in the file are retired (active:false) rather than deleted, because a student may
// already have a submission against one. That is what moves the five CloudFront questions out of
// circulation without breaking anyone's history.

const BANK_PATH = path.resolve("../client/content/speaking/describe-image/describe_image.json");
const IMAGE_DIR = path.resolve("../client/public/question-images/describe-image");
const IMAGE_URL_PREFIX = "/question-images/describe-image/";
const SOURCE_FILE = "describe_image.json";
const WRITE = process.argv.includes("--write");

const sourceGroupFor = entry => `${SOURCE_FILE}#${entry.id}`;

function buildDoc(entry) {
  // evaluationType and maxScore are DERIVED by the shared validator, never written by hand -- it
  // is the one place that decides how a question type is scored, and an importer that guessed
  // them could disagree with the admin form for the same question.
  const base = baseDoc(entry);
  const { normalized } = validateAndNormalizeQuestion(base);
  return { ...base, ...normalized };
}

function baseDoc(entry) {
  return {
    section: "speaking",
    type: "describe-image",
    title: entry.title,
    prompt: entry.question,
    imageUrl: IMAGE_URL_PREFIX + entry.image.src,
    answer: entry.answer || undefined,
    // Uncategorised entries appear under All but never under a specific type tab, which is how
    // the Core P batch has always behaved.
    category: entry.category || undefined,
    difficulty: "medium",
    sourceGroup: sourceGroupFor(entry),
    active: true
  };
}

function checkBank(bank) {
  const problems = [];
  const seenId = new Set();
  const seenImage = new Set();
  for (const entry of bank) {
    if (!entry.id) { problems.push("an entry has no id"); continue; }
    if (seenId.has(entry.id)) problems.push(`${entry.id}: duplicate id`);
    seenId.add(entry.id);

    const src = entry.image?.src;
    if (!src) { problems.push(`${entry.id}: no image src`); continue; }
    if (seenImage.has(src)) problems.push(`${entry.id}: image ${src} is already used by another question`);
    seenImage.add(src);
    if (!fs.existsSync(path.join(IMAGE_DIR, src))) problems.push(`${entry.id}: image ${src} is not on disk`);

    if (!entry.title?.trim()) problems.push(`${entry.id}: no title`);
    if (!entry.question?.trim()) problems.push(`${entry.id}: no prompt`);
    // A local image with no model answer breaks Show Answer, which is the whole point of having
    // written these by hand.
    if (!entry.answer?.trim()) problems.push(`${entry.id}: no model answer`);

    const { errors } = validateAndNormalizeQuestion(baseDoc(entry));
    for (const e of errors) problems.push(`${entry.id}: ${e}`);
  }
  return problems;
}

async function run() {
  const bank = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
  console.log(`${WRITE ? "APPLYING" : "DRY RUN"} - ${bank.length} entries in ${SOURCE_FILE}\n`);

  const problems = checkBank(bank);
  if (problems.length) {
    console.log(`${problems.length} problem(s) found, nothing written:`);
    for (const p of problems) console.log("   " + p);
    process.exit(1);
  }
  console.log("bank validates clean");

  // Unused images are reported, not an error -- they are simply content nobody has written yet.
  const used = new Set(bank.map(e => e.image.src));
  const unused = fs.readdirSync(IMAGE_DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f) && !used.has(f));
  console.log(`images on disk with no question: ${unused.length}${unused.length ? " (" + unused.join(", ") + ")" : ""}`);

  await connectDb();
  const existing = await Question.find({ section: "speaking", type: "describe-image" })
    .select("title answer imageUrl category prompt sourceGroup active").lean();
  const byGroup = new Map(existing.filter(q => q.sourceGroup).map(q => [q.sourceGroup, q]));
  // Rows that predate this file are adopted by their image rather than retired and re-created.
  // The eight Core P questions all carry the same non-unique sourceGroup "core-p", so they cannot
  // be matched that way -- and re-creating them would detach any submission already made against
  // one. An image is unique per question, which makes it a safe identity here.
  const byImage = new Map(existing.filter(q => q.imageUrl).map(q => [q.imageUrl, q]));
  const adopted = new Set();

  const toInsert = [], toUpdate = [];
  for (const entry of bank) {
    const doc = buildDoc(entry);
    const current = byGroup.get(doc.sourceGroup) || byImage.get(doc.imageUrl);
    if (!current) { toInsert.push(doc); continue; }
    adopted.add(String(current._id));
    const changed = ["title", "prompt", "imageUrl", "answer", "category"]
      .some(k => (current[k] || "") !== (doc[k] || "")) || current.active !== true;
    if (changed) toUpdate.push({ _id: current._id, doc });
  }
  // Anything this file does not describe stops being offered. Retired, never deleted: a student
  // may already have answered it.
  const keep = new Set(bank.map(e => sourceGroupFor(e)));
  const toRetire = existing.filter(q =>
    q.active && !keep.has(q.sourceGroup || "") && !adopted.has(String(q._id)));

  console.log(`\ninsert: ${toInsert.length}   update: ${toUpdate.length}   retire: ${toRetire.length}`);
  for (const q of toRetire) {
    const where = /^https?:/i.test(q.imageUrl || "") ? "remote image" : (q.imageUrl ? "local image" : "no image");
    console.log(`   retire "${q.title}" (${where})`);
  }

  if (!WRITE) {
    console.log("\nNothing written. Re-run with --write to apply.");
    process.exit(0);
  }

  fs.mkdirSync("uploads", { recursive: true });
  const backup = `uploads/describe-image-backup-${Date.now()}.json`;
  fs.writeFileSync(backup, JSON.stringify(existing, null, 2));
  console.log(`\nbackup written: ${backup}`);

  if (toInsert.length) await Question.insertMany(toInsert);
  for (const { _id, doc } of toUpdate) await Question.updateOne({ _id }, { $set: doc });
  for (const q of toRetire) await Question.updateOne({ _id: q._id }, { $set: { active: false } });

  const activeNow = await Question.countDocuments({ section: "speaking", type: "describe-image", active: true });
  console.log(`inserted ${toInsert.length}, updated ${toUpdate.length}, retired ${toRetire.length}`);
  console.log(`active describe-image questions now: ${activeNow}`);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
