import express from "express";
import Question from "../models/Question.js";
import Submission from "../models/Submission.js";
import TestSession from "../models/TestSession.js";
import { requireAuth, requireActiveSubscription } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { QUESTION_TYPES } from "../questionTypes.js";
import { TRANSCRIPT_IS_ANSWER } from "../transcriptPolicy.js";
import { config } from "../config.js";
import { recordLearningActivity } from "../utils/streak.js";

const router = express.Router();
router.use(requireAuth, requireActiveSubscription);

const MOCK_SECTIONS = ["speaking", "writing", "reading", "listening"];

/**
 * What one answer is worth in a mock: 1, 0.5 or 0.
 *
 * A mock is marked per QUESTION, not per the raw points a task happens to carry. Without this,
 * a 90-point speaking answer and a 1-point multiple choice contributed wildly different amounts
 * to the same total, so a section's score said more about which task types it contained than
 * about how the student did.
 *
 * The two kinds of question are judged differently because their scores mean different things:
 *
 *   AI-evaluated (subjective) — a graded percentage, so it earns a band:
 *       under 40%  -> 0      40-59% -> 0.5      60% and over -> 1
 *   Everything else (objective) — either the answer matches the key or it does not:
 *       full marks -> 1      anything less -> 0
 *
 * An answer still being evaluated, or one whose evaluation failed, scores 0: there is no graded
 * result to band, and inventing one would flatter the attempt.
 */
export function markForSubmission(submission) {
  if (!submission || !submission.maxScore) return 0;
  if (submission.evaluationStatus && submission.evaluationStatus !== "COMPLETED") return 0;

  if (submission.evaluationType === "subjective") {
    const percent = (submission.score / submission.maxScore) * 100;
    if (percent < 40) return 0;
    if (percent < 60) return 0.5;
    return 1;
  }
  return submission.score >= submission.maxScore ? 1 : 0;
}
const STUDENT_SAFE_FIELDS = "-answer -explanation";

/** Total clock for a mock, from the number of questions it actually ended up with. */
function mockDurationMs(questionCount) {
  const minutes = config.mockTestDurationMinutes || questionCount * config.mockMinutesPerQuestion;
  return Math.round(minutes) * 60 * 1000;
}

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

/** Fisher-Yates, in place. Every ordering equally likely, unlike a sort() with a random comparator. */
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// Questions are chosen server-side so the client never sees the full bank (or any answer) before
// the attempt starts. Only _ids are pulled for the candidate pool, which is cheap even for the
// 344-question reading bank; the full documents are fetched once, for the chosen few.
//
// Selection is TYPE-BALANCED, not a flat random sample. The banks are lopsided — reading is 147
// fib-dropdown and 104 drag-fill out of 344, writing is 16 essays out of 23 — so drawing twenty
// at random would hand a student twenty of whatever that section happens to hold most of, and a
// writing section of fifteen essays. Instead the types are visited round-robin, one random unused
// question from each per pass, until the section's quota is met. A mock therefore covers as many
// task types as the bank can offer, and only doubles up once every type has been drawn from.
async function pickSectionQuestions(section, wanted) {
  // The type allowlist is defense-in-depth: creation-time validation already guarantees every
  // question has a supported type, but this keeps the mock test safe even against legacy data.
  const candidates = await Question.find(
    { section, active: true, type: { $in: Object.keys(QUESTION_TYPES) } },
    "_id type"
  ).lean();
  if (!candidates.length) return [];

  // One shuffled bucket per type: taking from the front of each is already a random draw.
  const byType = new Map();
  for (const candidate of candidates) {
    if (!byType.has(candidate.type)) byType.set(candidate.type, []);
    byType.get(candidate.type).push(candidate._id);
  }
  for (const bucket of byType.values()) shuffle(bucket);

  // Round-robin over the types, in a random order so the same type does not always open the
  // section. A type whose bucket runs dry simply stops contributing.
  const buckets = shuffle([...byType.values()]);
  const chosenIds = [];
  while (chosenIds.length < wanted) {
    const before = chosenIds.length;
    for (const bucket of buckets) {
      if (chosenIds.length >= wanted) break;
      if (bucket.length) chosenIds.push(bucket.pop());
    }
    // Every bucket empty — the section's whole bank is smaller than the quota.
    if (chosenIds.length === before) break;
  }

  // One query for the documents, then put them back into the chosen (random) order: $in returns
  // them in whatever order the index yields, which would undo the shuffle.
  const docs = await Question.find({ _id: { $in: chosenIds } }).select(STUDENT_SAFE_FIELDS);
  // Same rule as GET /questions: for most audio tasks the transcript is the answer key, so it
  // never goes out with the question.
  for (const doc of docs) if (TRANSCRIPT_IS_ANSWER.has(doc.type)) doc.set("transcript", undefined);
  const byId = new Map(docs.map(doc => [String(doc._id), doc]));
  return chosenIds.map(id => byId.get(String(id))).filter(Boolean);
}

async function pickMockQuestions() {
  // The 4 sections are independent of each other, so picking them concurrently instead of in a
  // sequential loop cuts the wall-clock DB round-trip time without changing what gets picked.
  const perSection = await Promise.all(
    MOCK_SECTIONS.map(section => pickSectionQuestions(section, config.mockQuestionsPerSection))
  );
  // Sections stay in their exam order — a real sitting is Speaking, then Writing, then Reading,
  // then Listening, and shuffling across that boundary would mean a student switching skill every
  // question. The randomisation is WITHIN each section: which questions, and in what order.
  return perSection.flat();
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
    expiresAt: new Date(startedAt.getTime() + mockDurationMs(questions.length))
  });

  res.status(201).json({ testSession: session, questions });
}));

// Resuming an attempt in progress.
//
// A mock is long, and a refresh, a closed tab or a flat battery used to drop the student back on
// the "Start Mock Test" screen with their attempt still open on the server and the clock still
// running. The session already stores the exact questions it issued, in order, so the whole
// attempt can be handed back: the same questions, the answers already submitted, and the
// remaining time.
//
// Declared BEFORE "/:id" — Express matches in order, and "active" would otherwise be read as an
// id and fail its ObjectId cast.
router.get("/active", asyncRoute(async (req, res) => {
  const session = await TestSession.findOne({ user: req.user._id, status: "IN_PROGRESS" })
    .sort({ startedAt: -1 });
  if (!session) return res.json({ testSession: null });

  await expireIfNeeded(session);
  // Expiring is the honest answer to "is there an attempt to resume?" — there is not, and the
  // results screen is reached through the normal completion path rather than by resuming.
  if (session.status !== "IN_PROGRESS") return res.json({ testSession: null });

  // Rehydrated in the order they were issued, so question 34 is the same question 34 it was
  // before the refresh. A find() returns them in storage order, hence the explicit re-sort.
  const docs = await Question.find({ _id: { $in: session.questionIds } }).select(STUDENT_SAFE_FIELDS);
  const byId = new Map(docs.map(d => [String(d._id), d]));
  const questions = session.questionIds.map(id => byId.get(String(id))).filter(Boolean);

  const submissions = await loadSessionResults(session._id);
  res.json({ testSession: session, questions, submissions });
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
    // What this answer was worth in the mock's own marking: 1, 0.5 or 0. Sent so the results
    // screen counts correct/partial/incorrect from the same rule the total was built from,
    // rather than re-implementing the bands in the browser and drifting from them.
    mark: markForSubmission(s),
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
  // A section is marked out of the questions it ISSUED, not the ones that came back. A question
  // never attempted scores nothing but still counts against the total, which is what makes
  // "12 / 20" mean the same thing on every attempt.
  const issued = await Question.find({ _id: { $in: session.questionIds } }).select("section").lean();
  const issuedPerSection = new Map(MOCK_SECTIONS.map(section => [section, 0]));
  for (const question of issued) {
    if (issuedPerSection.has(question.section)) {
      issuedPerSection.set(question.section, issuedPerSection.get(question.section) + 1);
    }
  }

  const hasIssuedRecord = issued.length > 0;
  const sectionScores = MOCK_SECTIONS.map(section => {
    const rows = submissions.filter(s => s.section === section);
    return {
      section,
      score: rows.reduce((a, s) => a + markForSubmission(s), 0),
      // Sessions created before questionIds existed have no record of what they issued, so the
      // answers themselves are the only denominator available.
      maxScore: hasIssuedRecord ? (issuedPerSection.get(section) || 0) : rows.length
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

  // The per-question rows the results screen renders. They were never sent, so its "Every
  // answer in this attempt" table has always been empty and anything counted from it — such as
  // how many questions were attempted — read as zero even on an attempt that scored.
  // The same loader the resume and detail views use, so every surface sees the same rows with
  // the same per-answer mark — a report that disagreed with the total would be worse than none.
  const results = await loadSessionResults(session._id);

  res.json({ testSession: session, results });
}));

router.get("/", asyncRoute(async (req, res) => {
  const sessions = await TestSession.find({ user: req.user._id, status: "COMPLETED" })
    .sort({ submittedAt: -1 })
    .limit(50);
  res.json({ testSessions: sessions });
}));

export default router;
