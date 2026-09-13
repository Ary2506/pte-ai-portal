import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connectDb } from "./db.js";
import Question from "./models/Question.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PUBLIC_DIR = path.resolve(__dirname, "../../client/public");
const LOCAL_IMAGE_PREFIX = "/question-images/";

function defaultImageExists(imageUrl) {
  const relative = imageUrl.replace(/^\//, "");
  return fs.existsSync(path.join(CLIENT_PUBLIC_DIR, relative));
}

// Pure, DB-agnostic core: given a list of plain describe-image question objects (title, imageUrl,
// answer) and an image-existence check, returns a structured validation report. Used both by
// runDescribeImageValidation() below (against the real, live database) and by
// test/describeImageDataIntegrity.test.js (against synthetic fixtures) — identical logic either
// way, so a passing test is real evidence the live check behaves the same way.
//
// Policy: every active question needs a non-empty imageUrl and a unique one (no two questions
// sharing an image). A *local* image (/question-images/...) — the ones we manage directly — must
// also resolve to a real file on disk and must have a non-empty answer, since those are exactly
// the questions Show Answer depends on. A non-local (externally hosted) question with no answer
// is flagged only as a warning, never an error — it's pre-existing content this task must not
// invent an answer for or otherwise alter.
export function validateDescribeImageQuestions(questions, imageExists = defaultImageExists) {
  const errors = [];
  const warnings = [];
  const seenImageUrl = new Map();

  for (const q of questions) {
    const label = `"${q.title}" (${q._id})`;

    if (!q.imageUrl || !q.imageUrl.trim()) {
      errors.push(`${label}: missing imageUrl`);
      continue;
    }

    const isLocal = q.imageUrl.startsWith(LOCAL_IMAGE_PREFIX);
    if (isLocal) {
      if (!imageExists(q.imageUrl)) errors.push(`${label}: local image file not found for ${q.imageUrl}`);
      if (!q.answer || !String(q.answer).trim()) errors.push(`${label}: local Describe Image question is missing its model answer`);
    } else if (!q.answer || !String(q.answer).trim()) {
      warnings.push(`${label}: no model answer configured (pre-existing content — Show Answer will not appear for it)`);
    }

    const existingLabel = seenImageUrl.get(q.imageUrl);
    if (existingLabel) errors.push(`Duplicate imageUrl "${q.imageUrl}" is used by both ${existingLabel} and ${label}`);
    else seenImageUrl.set(q.imageUrl, label);
  }

  return { ok: errors.length === 0, errors, warnings, checked: questions.length };
}

// Runs the same validation against the real database — a manual/CI check, not a Vitest test
// (backend tests run against an isolated, wiped-clean test database and can never see this real
// content; see test/setup.js).
export async function runDescribeImageValidation() {
  await connectDb();
  const docs = await Question.find({ section: "speaking", type: "describe-image", active: true })
    .select("title imageUrl answer")
    .sort({ createdAt: 1 })
    .lean();
  return { docs, report: validateDescribeImageQuestions(docs) };
}
