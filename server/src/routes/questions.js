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

router.get("/", requireAuth, requireActiveSubscription, asyncRoute(async (req, res) => {
  const filter = { active: true };
  if (req.query.section) filter.section = req.query.section;
  if (req.query.type) filter.type = req.query.type;
  // Defensive scalability cap, not pagination — response shape, filtering, and sort order are
  // all unchanged. At today's bank size this never triggers; it only guards against an
  // unbounded response if the bank grows substantially later.
  // .lean() returns plain objects straight from the driver rather than hydrated Mongoose
  // documents — which is both cheaper on this, the most-requested endpoint in the app, and
  // exactly what the map below wanted anyway (it was calling .toObject() on every doc just to
  // get a mutable copy it could delete `answer` off).
  const questions = await Question.find(filter).select(STUDENT_SAFE_FIELDS).sort({ createdAt: 1 }).limit(200).lean();
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
  res.json({ questions });
}));

export default router;
