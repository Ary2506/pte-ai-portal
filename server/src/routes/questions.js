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
  const docs = await Question.find(filter).select(STUDENT_SAFE_FIELDS).sort({ createdAt: 1 }).limit(200);
  const questions = docs.map((doc) => {
    const question = doc.toObject();
    if (question.evaluationType === "objective") delete question.answer;
    return question;
  });
  res.json({ questions });
}));

export default router;
