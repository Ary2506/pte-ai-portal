import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import Submission from "../models/Submission.js";
import Question from "../models/Question.js";
import TestSession from "../models/TestSession.js";
import { requireAuth, requireActiveSubscription } from "../middleware/auth.js";
import { expireIfNeeded } from "./testSessions.js";
import { evaluateAnswer } from "../scoring/index.js";
import { evaluateSubjective } from "../services/ai/index.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { recordLearningActivity } from "../utils/streak.js";

const router = express.Router();
const uploadDir = path.resolve("uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const MAX_TEXT_LENGTH = 6000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

// Browser-supplied Content-Type is a first filter only — never trusted alone (see the magic-byte
// check below, which verifies the file's actual binary header after upload).
const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/wave",
  "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac"
]);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-z0-9._-]/gi, "_")}`)
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_AUDIO_MIME.has(file.mimetype)) return cb(new Error("UNSUPPORTED_AUDIO_TYPE"));
    cb(null, true);
  }
});

function uploadAudio(req, res, next) {
  upload.single("audio")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Audio file is too large (max 15MB).", code: "AUDIO_TOO_LARGE" });
    }
    if (err.message === "UNSUPPORTED_AUDIO_TYPE") {
      return res.status(400).json({ message: "Unsupported audio format.", code: "UNSUPPORTED_AUDIO_TYPE" });
    }
    return res.status(400).json({ message: "Audio upload failed.", code: "AUDIO_UPLOAD_ERROR" });
  });
}

// Known container/file signatures for the formats MediaRecorder actually produces across
// browsers (webm/opus in Chrome, ogg/opus in Firefox, mp4/aac in Safari), plus wav/mp3 for
// completeness. The browser-reported MIME type alone is not proof of file content.
const AUDIO_SIGNATURES = [
  { bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // webm/mkv (EBML header)
  { bytes: [0x4f, 0x67, 0x67, 0x53] }, // "OggS"
  { bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (wav)
  { bytes: [0x49, 0x44, 0x33] }, // "ID3" (mp3)
  { bytes: [0xff, 0xfb] }, // raw mp3 frame sync
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] } // "ftyp" (mp4/m4a)
];

function hasValidAudioSignature(filePath) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(filePath, "r");
  const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  if (bytesRead < 4) return false;
  return AUDIO_SIGNATURES.some(sig => {
    const offset = sig.offset || 0;
    return sig.bytes.every((b, i) => buf[offset + i] === b);
  });
}

// Rejects submissions that would spend AI credits on an oversized or empty payload before any
// evaluation is attempted.
const submissionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many submissions in a short time. Please slow down.", code: "RATE_LIMITED" }
});
const retryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many retry attempts. Please wait a moment.", code: "RATE_LIMITED" }
});

// If the submission is linked to a real Question, the question's own evaluationType decides
// objective vs subjective scoring. Only a submission with no linked question (legacy/freeform)
// falls back to a purely subjective AI/heuristic read — there is no correct answer on file to
// grade it against objectively.
async function evaluateSubmission(question, { section, type, answer, transcript, durationSeconds }) {
  const text = transcript || (typeof answer === "string" ? answer : "");
  if (question) return evaluateAnswer(question, { answer, text, durationSeconds });
  const ai = await evaluateSubjective({ type, text, durationSeconds });
  return {
    score: ai.score,
    maxScore: ai.maxScore,
    evaluationType: "subjective",
    evaluationStatus: ai.evaluationStatus,
    scoringMethod: ai.scoringMethod,
    feedback: {
      strengths: ai.strengths, improvements: ai.improvements, overall: ai.overall, note: ai.note, scoringMethod: ai.scoringMethod,
      criteria: ai.criteria ?? null, mistakes: ai.mistakes ?? []
    }
  };
}

router.post("/", requireAuth, requireActiveSubscription, submissionLimiter, uploadAudio, async (req, res) => {
  try {
    // Only these named fields are ever read from the request body — a client cannot influence
    // score, scoringMethod, evaluationStatus, or feedback no matter what it sends; those are
    // always computed below, server-side.
    const { section, type, answer, transcript, durationSeconds, questionId, testSessionId } = req.body;
    if (!section || !type) return res.status(400).json({ message: "Section and type are required", code: "VALIDATION_ERROR" });

    let question = null;
    if (questionId) {
      question = await Question.findById(questionId);
      if (!question) return res.status(404).json({ message: "Question not found", code: "NOT_FOUND" });
    }

    let testSession = null;
    if (testSessionId) {
      testSession = await TestSession.findById(testSessionId);
      if (!testSession || String(testSession.user) !== String(req.user._id)) {
        return res.status(403).json({ message: "You can only submit to your own test session", code: "FORBIDDEN" });
      }
      await expireIfNeeded(testSession);
      if (testSession.status === "EXPIRED") {
        return res.status(409).json({ message: "Your allotted test time has ended. This test can no longer accept answers.", code: "TEST_SESSION_EXPIRED" });
      }
      if (testSession.status !== "IN_PROGRESS") {
        return res.status(409).json({ message: "This test has already been completed and cannot accept more answers", code: "SESSION_ALREADY_COMPLETED" });
      }
      // A session created before Phase 7 has no recorded question set — it keeps behaving
      // exactly as it did before this check existed, rather than locking the student out of an
      // attempt that was legitimately already in progress.
      if (question && testSession.questionIds?.length) {
        const belongs = testSession.questionIds.some(id => String(id) === String(question._id));
        if (!belongs) {
          return res.status(403).json({ message: "This question is not part of your current test session.", code: "QUESTION_NOT_IN_SESSION" });
        }
      }
      if (question) {
        const existing = await Submission.findOne({ testSession: testSession._id, question: question._id });
        if (existing) {
          return res.status(409).json({ message: "You have already answered this question in this test attempt.", code: "DUPLICATE_SUBMISSION" });
        }
      }
    }

    const parsedAnswer = answer ? JSON.parse(answer) : undefined;
    const answerText = typeof parsedAnswer === "string" ? parsedAnswer : "";
    const responseText = transcript || answerText;
    // Checked independently, not just the transcript-prioritized text used for evaluation —
    // otherwise a short transcript paired with a huge `answer` field would slip past this check
    // even though the oversized text still gets stored.
    if ((transcript && transcript.length > MAX_TEXT_LENGTH) || (answerText && answerText.length > MAX_TEXT_LENGTH)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: `Response is too long (max ${MAX_TEXT_LENGTH} characters).`, code: "ANSWER_TOO_LONG" });
    }
    if (section === "writing" && !responseText.trim()) {
      return res.status(400).json({ message: "Write a response before submitting.", code: "EMPTY_ANSWER" });
    }

    if (req.file && !hasValidAudioSignature(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: "The uploaded file does not look like a valid audio recording.", code: "INVALID_AUDIO_SIGNATURE" });
    }

    const isSubjective = question ? question.evaluationType === "subjective" : true;

    // Objective scoring is instant and deterministic — a single write is enough. Subjective
    // (AI/heuristic) scoring gets a real PENDING row first, so a mid-request crash leaves an
    // honest PENDING record rather than silently losing the attempt.
    const base = {
      user: req.user._id,
      question: question?._id,
      testSession: testSession?._id || null,
      section, type,
      answer: parsedAnswer,
      transcript,
      durationSeconds: Number(durationSeconds || 0),
      audioPath: req.file ? req.file.filename : undefined
    };

    let submission;
    if (isSubjective) {
      submission = await Submission.create({ ...base, score: 0, maxScore: 90, evaluationType: "subjective", evaluationStatus: "PENDING", scoringMethod: null, feedback: null });
      submission.evaluationStatus = "PROCESSING";
      await submission.save();

      const evaluation = await evaluateSubmission(question, { section, type, answer: parsedAnswer, transcript, durationSeconds: Number(durationSeconds || 0) });
      submission.score = evaluation.score;
      submission.maxScore = evaluation.maxScore;
      submission.evaluationStatus = evaluation.evaluationStatus;
      submission.scoringMethod = evaluation.scoringMethod || null;
      submission.feedback = evaluation.feedback;
      await submission.save();
    } else {
      const evaluation = await evaluateSubmission(question, { section, type, answer: parsedAnswer, transcript, durationSeconds: Number(durationSeconds || 0) });
      if (evaluation.invalid) {
        return res.status(400).json({ message: "Submitted answer was not in a valid format for this question.", code: "INVALID_ANSWER_FORMAT" });
      }
      submission = await Submission.create({
        ...base,
        score: evaluation.score,
        maxScore: evaluation.maxScore,
        evaluationType: evaluation.evaluationType,
        evaluationStatus: evaluation.evaluationStatus,
        scoringMethod: evaluation.scoringMethod || null,
        feedback: evaluation.feedback
      });
    }

    if (testSession) {
      testSession.answeredQuestions += 1;
      await testSession.save();
    }

    // A successfully-created submission is "completing a practice/question attempt" (Phase 16,
    // Part A1, item 1) regardless of whether the answer was right or an AI evaluation later
    // failed — the learning attempt itself happened. Never reached by a 400/403/404/409 above
    // (no Submission was created), so a failed or duplicate request never earns streak credit.
    // Swallowed like every other non-critical side-effect write in this codebase (e.g.
    // LoginAttempt in routes/auth.js) — a transient streak-save failure must never turn an
    // otherwise-successful submission into a 500.
    await recordLearningActivity(req.user).catch(() => {});

    res.status(201).json({ submission });
  } catch (e) {
    // This route catches its own errors (rather than using asyncRoute) so it can clean up an
    // uploaded file on failure — but that means these never reached app.js's global handlers.
    // Matching those same conventions here rather than falling through to a generic 500 for
    // what is just bad input or a losing race, not a real server failure.
    if (e.name === "CastError") {
      return res.status(400).json({ message: "Invalid identifier in request", code: "VALIDATION_ERROR" });
    }
    // JSON.parse(answer) above throws this for a malformed (non-JSON) answer value — bad
    // client input, not a server error.
    if (e.name === "SyntaxError") {
      return res.status(400).json({ message: "The submitted answer was not valid JSON.", code: "VALIDATION_ERROR" });
    }
    // E11000 from the unique partial index on (testSession, question) — the findOne pre-check
    // above is only a fast-path convenience; this is what actually stops a concurrent duplicate
    // from ever being written, so a request that loses the race lands here instead of the
    // pre-check. Same response contract as the pre-check's own 409, never the raw Mongo error.
    if (e.code === 11000) {
      return res.status(409).json({ message: "You have already answered this question in this test attempt.", code: "DUPLICATE_SUBMISSION" });
    }
    console.error(e);
    res.status(500).json({ message: "Submission failed" });
  }
});

router.post("/:id/retry-evaluation", requireAuth, requireActiveSubscription, retryLimiter, asyncRoute(async (req, res) => {
  const submission = await Submission.findById(req.params.id);
  if (!submission) return res.status(404).json({ message: "Submission not found", code: "NOT_FOUND" });
  if (String(submission.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "You cannot retry another user's submission", code: "FORBIDDEN" });
  }
  // Cost control: a completed evaluation is never re-run. Only a genuinely FAILED one may retry.
  if (submission.evaluationStatus !== "FAILED") {
    return res.status(409).json({ message: "Only a failed evaluation can be retried", code: "RETRY_NOT_ALLOWED" });
  }

  const question = submission.question ? await Question.findById(submission.question) : null;
  const text = submission.transcript || (typeof submission.answer === "string" ? submission.answer : "");

  submission.evaluationStatus = "PROCESSING";
  await submission.save();

  const result = await evaluateSubjective({
    type: submission.type,
    prompt: question?.prompt,
    passage: question?.passage,
    text,
    durationSeconds: submission.durationSeconds
  });

  submission.evaluationStatus = result.evaluationStatus;
  submission.score = result.score;
  submission.maxScore = result.maxScore;
  submission.scoringMethod = result.scoringMethod;
  submission.feedback = {
    strengths: result.strengths, improvements: result.improvements, overall: result.overall, note: result.note, scoringMethod: result.scoringMethod,
    criteria: result.criteria ?? null, mistakes: result.mistakes ?? []
  };
  await submission.save();

  res.json({ submission });
}));

router.get("/:id/audio", requireAuth, asyncRoute(async (req, res) => {
  const submission = await Submission.findById(req.params.id);
  if (!submission || !submission.audioPath) return res.status(404).json({ message: "Recording not found", code: "NOT_FOUND" });
  if (String(submission.user) !== String(req.user._id)) {
    return res.status(403).json({ message: "You cannot access another user's recording", code: "FORBIDDEN" });
  }
  const filePath = path.join(uploadDir, path.basename(submission.audioPath));
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Recording not found", code: "NOT_FOUND" });
  res.sendFile(filePath);
}));

router.get("/history", requireAuth, requireActiveSubscription, asyncRoute(async (req, res) => {
  const submissions = await Submission.find({ user: req.user._id, testSession: null })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("question", "title type section");
  res.json({ submissions });
}));

export default router;
