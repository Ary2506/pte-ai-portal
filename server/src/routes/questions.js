import express from "express";
import Question from "../models/Question.js";
import { requireAuth, requireActiveSubscription } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";

const router = express.Router();

// `explanation` exists only to justify an objective answer after scoring — never sent up front,
// for any type. `answer` on an *objective* type (MCQ/fill-blanks/reorder/dictation) is the literal
// scoring key and must never reach the browser before submission, or a student could just read it
// out of the network tab. A *subjective* type (Describe Image, Read Aloud, ...) has nothing
// auto-graded from `answer` — when one is present it's an optional reference/model answer meant to
// be revealed to the student on demand (see Describe Image's Show Answer), so exposing it carries
// no scoring-exploit risk. Question creation/editing/deactivation now lives entirely under
// /api/admin/questions.
const STUDENT_SAFE_FIELDS = "-explanation";
// Full question documents carry passages and option lists, so there is still a cap — but it is
// sized for one task type, which is how the practice workspace fetches, and it must stay well
// clear of the largest bank. At 200 it did not: Repeat Sentence reached 183 and would have begun
// silently dropping questions at 201, which is the bug that just cost the library 309 of its 869
// questions, only one layer down.
//
// `truncated` is the real guard. A cap that is hit silently is indistinguishable from a bank
// that is simply smaller, which is exactly why the 200 went unnoticed for so long.
const FULL_LIMIT = 1000;
const INDEX_LIMIT = 5000;

router.get("/", requireAuth, requireActiveSubscription, asyncRoute(async (req, res) => {
  const filter = { active: true };
  if (req.query.section) filter.section = req.query.section;
  if (req.query.type) filter.type = req.query.type;
  // `index=1` returns only each question's id and type, for a caller that needs to know WHICH
  // questions exist rather than what is in them — the practice library's availability counts.
  // It used to download every question of a section in full just to count them, which ran into
  // the cap below: a section with more than 200 questions reported 200, and the questions past
  // that point were invisible to it. An id+type row is a few dozen bytes, so this mode is
  // capped far higher and carries nothing worth stripping.
  const index = req.query.index === "1";

  // Defensive scalability cap, not pagination — response shape, filtering, and sort order are
  // all unchanged. The full-document cap is what every task-type fetch uses (no single task type
  // comes close to it); the index cap only has to stay ahead of the whole bank.
  // .lean() returns plain objects straight from the driver rather than hydrated Mongoose
  // documents — which is both cheaper on this, the most-requested endpoint in the app, and
  // exactly what the map below wanted anyway (it was calling .toObject() on every doc just to
  // get a mutable copy it could delete `answer` off).
  const questions = await Question.find(filter)
    .select(index ? "_id type section" : STUDENT_SAFE_FIELDS)
    .sort({ createdAt: 1 })
    .limit(index ? INDEX_LIMIT : FULL_LIMIT)
    .lean();
  // Nothing to strip: an index row carries no answer, transcript or content in the first place.
  if (index) {
    return res.json({ questions, total: questions.length, truncated: questions.length >= INDEX_LIMIT });
  }
  for (const question of questions) {
    // Repeat Sentence's `transcript` is the sentence the student is about to repeat. Sent up
    // front it would turn a listening task into reading aloud and let anyone read the answer out
    // of the network tab. It is compared against server-side only, and revealed in the result.
    if (question.type === "repeat-sentence") { delete question.transcript; delete question.answer; }
    if (question.evaluationType !== "objective") continue;
    delete question.answer;
    // `content` carries the answer key too, inline: a Fill in the Blanks part is
    // {type:"blank", answer:"excess"} and a Highlight Incorrect Words part is
    // {type:"word", text:"...", isIncorrect:true}. That is the same scoring key `answer` holds,
    // so it is stripped on the same terms — otherwise deleting `answer` above would be theatre
    // while every correct response sat one level down in the network tab. The structure the
    // client needs to render (where the blanks fall, which tokens are words) is untouched.
    if (Array.isArray(question.content)) {
      question.content = question.content.map((part) => {
        if (part?.type === "blank") { const { answer, ...rest } = part; return rest; }
        if (part?.type === "word") { const { isIncorrect, answer, ...rest } = part; return rest; }
        return part;
      });
    }
  }
  // `truncated` says plainly that the cap was reached and questions were withheld, so a bank that
  // outgrows it surfaces as a visible flag rather than as a quietly shorter list.
  res.json({ questions, total: questions.length, truncated: questions.length >= FULL_LIMIT });
}));

export default router;
