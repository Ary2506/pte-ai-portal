import express from "express";
import Question from "../models/Question.js";
import { requireAuth, requireActiveSubscription } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";

const router = express.Router();

// The correct answer and explanation must never reach the browser before a submission is
// scored — otherwise a student can just read them out of the network tab. Question
// creation/editing/deactivation now lives entirely under /api/admin/questions.
const STUDENT_SAFE_FIELDS = "-answer -explanation";

router.get("/", requireAuth, requireActiveSubscription, asyncRoute(async (req, res) => {
  const filter = { active: true };
  if (req.query.section) filter.section = req.query.section;
  if (req.query.type) filter.type = req.query.type;
  // Defensive scalability cap, not pagination — response shape, filtering, and sort order are
  // all unchanged. At today's bank size this never triggers; it only guards against an
  // unbounded response if the bank grows substantially later.
  const questions = await Question.find(filter).select(STUDENT_SAFE_FIELDS).sort({ createdAt: 1 }).limit(200);
  res.json({ questions });
}));

export default router;
