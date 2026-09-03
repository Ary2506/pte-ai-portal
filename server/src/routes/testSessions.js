import express from "express";
import Question from "../models/Question.js";
import Submission from "../models/Submission.js";
import TestSession from "../models/TestSession.js";
import { requireAuth, requireActiveSubscription } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { QUESTION_TYPES } from "../questionTypes.js";
import { config } from "../config.js";
import { recordLearningActivity } from "../utils/streak.js";

const router = express.Router();
router.use(requireAuth, requireActiveSubscription);

const MOCK_SECTIONS = ["speaking", "writing", "reading", "listening"];
const STUDENT_SAFE_FIELDS = "-answer -explanation";
const MOCK_DURATION_MS = config.mockTestDurationMinutes * 60 * 1000;

// The one place "is this session out of time" is decided — reused by every route below and by
// submissions.js, so expiry can never be checked two different ways. A legacy session with no
// expiresAt (created before this field existed) has nothing to compare against and simply never
// auto-expires; it keeps behaving exactly as it did before Phase 7.
export async function expireIfNeeded(session) {
  if (session.status === "IN_PROGRESS" && session.expiresAt && Date.now() >= session.expiresAt.getTime()) {
    session.status = "EXPIRED";
    await session.save();
  }
  return session;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One question per section, chosen server-side so the client never sees the full bank (or
// any answer) before the attempt starts.
async function pickMockQuestions() {
  const picks = [];
  for (const section of MOCK_SECTIONS) {
    // The type allowlist is defense-in-depth: creation-time validation already guarantees every
    // question has a supported type, but this keeps the mock test safe even against legacy data.
    const candidates = await Question.find({ section, active: true, type: { $in: Object.keys(QUESTION_TYPES) } }).select(STUDENT_SAFE_FIELDS);
    if (candidates.length) picks.push(shuffle(candidates)[0]);
  }
  return picks;
}

router.post("/", asyncRoute(async (req, res) => {
  const questions = await pickMockQuestions();
  if (!questions.length) {
    return res.status(409).json({ message: "No practice questions are available to build a mock test right now.", code: "NO_QUESTIONS" });
  }

  // Starting a fresh attempt abandons any attempt the student left unfinished — Phase 3
  // deliberately does not build resume-in-place, only a clean "start again".
  await TestSession.updateMany({ user: req.user._id, status: "IN_PROGRESS" }, { status: "ABANDONED" });

  // startedAt/expiresAt are computed here, once, from the server clock — the client request
  // body is never read for any of this (see POST handler signature: no body fields consulted).
  const startedAt = new Date();
  const session = await TestSession.create({
    user: req.user._id,
    testType: "mock",
    totalQuestions: questions.length,
    questionIds: questions.map(q => q._id),
    startedAt,
    expiresAt: new Date(startedAt.getTime() + MOCK_DURATION_MS)
  });

  res.status(201).json({ testSession: session, questions });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const session = await TestSession.findById(req.params.id);
  if (!session || String(session.user) !== String(req.user._id)) {
    return res.status(404).json({ message: "Test session not found", code: "NOT_FOUND" });
  }
  await expireIfNeeded(session);
  res.json({ testSession: session });
}));

// Shared with the admin inspection view (routes/admin.js) — a submission's own answer/score/
// feedback are always safe to return to whoever is already allowed to see the submission at
// all (its owner, or an admin); only the linked question is ever filtered, and always through
// the same safe-field projection used everywhere else a student can see question content.
export async function loadSessionResults(sessionId) {
  const submissions = await Submission.find({ testSession: sessionId })
    .sort({ createdAt: 1 })
    .populate({ path: "question", select: STUDENT_SAFE_FIELDS });
  return submissions.map(s => ({
    _id: s._id,
    section: s.section,
    type: s.type,
    question: s.question,
    answer: s.answer,
    transcript: s.transcript,
    score: s.score,
    maxScore: s.maxScore,
    evaluationType: s.evaluationType,
    evaluationStatus: s.evaluationStatus,
    scoringMethod: s.scoringMethod,
    feedback: s.feedback,
    createdAt: s.createdAt
  }));
}

router.get("/:id/details", asyncRoute(async (req, res) => {
  const session = await TestSession.findById(req.params.id);
  if (!session || String(session.user) !== String(req.user._id)) {
    return res.status(404).json({ message: "Test session not found", code: "NOT_FOUND" });
  }
  await expireIfNeeded(session);
  const results = await loadSessionResults(session._id);
  res.json({ testSession: session, results });
}));

router.post("/:id/complete", asyncRoute(async (req, res) => {
  const session = await TestSession.findById(req.params.id);
  if (!session || String(session.user) !== String(req.user._id)) {
    return res.status(404).json({ message: "Test session not found", code: "NOT_FOUND" });
  }
  await expireIfNeeded(session);
  if (session.status === "EXPIRED") {
    return res.status(409).json({ message: "Your allotted test time has ended. This test can no longer accept answers.", code: "TEST_SESSION_EXPIRED" });
  }
  if (session.status !== "IN_PROGRESS") {
    return res.status(409).json({ message: "This test has already been completed", code: "SESSION_ALREADY_COMPLETED" });
  }

  const submissions = await Submission.find({ testSession: session._id });
  const sectionScores = MOCK_SECTIONS.map(section => {
    const rows = submissions.filter(s => s.section === section);
    return {
      section,
      score: rows.reduce((a, s) => a + s.score, 0),
      maxScore: rows.reduce((a, s) => a + s.maxScore, 0)
    };
  });

  session.status = "COMPLETED";
  session.submittedAt = new Date();
  session.sectionScores = sectionScores;
  session.totalScore = sectionScores.reduce((a, s) => a + s.score, 0);
  session.totalMaxScore = sectionScores.reduce((a, s) => a + s.maxScore, 0);
  session.pendingSubjective = submissions.some(s => s.evaluationStatus === "PENDING");
  await session.save();

  // "Completing a Mock Test" (Phase 16, Part A1, item 2) — a second qualifying event on the same
  // UTC day as an earlier practice submission is a same-day no-op inside recordLearningActivity,
  // so this can never double-count a day that a standalone submission already credited. Swallowed
  // (see submissions.js) — a transient streak-save failure must never block completion itself.
  await recordLearningActivity(req.user).catch(() => {});

  res.json({ testSession: session });
}));

router.get("/", asyncRoute(async (req, res) => {
  const sessions = await TestSession.find({ user: req.user._id, status: "COMPLETED" })
    .sort({ submittedAt: -1 })
    .limit(50);
  res.json({ testSessions: sessions });
}));

export default router;
