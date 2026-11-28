import express from "express";
import crypto from "crypto";
import path from "path";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import Submission from "../models/Submission.js";
import ShareLink, { SHARE_LIFETIME_MS, SHARED_AUDIO_PREFIX } from "../models/ShareLink.js";
import { QUESTION_TYPES } from "../questionTypes.js";
import { config } from "../config.js";
import { requireAuth, requireActiveSubscription } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { copyObject, deleteObject, objectExists, signedObjectUrl, isRemoteStorage, localObjectPath } from "../storage.js";

// Share Answer: a student sends one completed speaking answer to anyone, as a link.
//
//   POST   /api/submissions/:submissionId/share              owner, active subscription
//   DELETE /api/submissions/:submissionId/share              owner
//   GET    /api/public/shared-answers/:token                 anyone holding the link
//   GET    /api/public/shared-answers/:token/audio-url       anyone holding the link
//   GET    /api/public/shared-answers/:token/audio           local-disk development only
//
// A link opens exactly one report and one recording, for SHARE_LIFETIME_DAYS from creation. The
// public routes take no session, read only through the token, and return a whitelisted report —
// never the submission document, its ids, the owner, or any storage key.

// R2 caps a presigned GET at 7 days; the page asks for a fresh URL whenever one lapses, so an hour
// is plenty and limits what a leaked URL is worth.
export const AUDIO_URL_TTL_SECONDS = 60 * 60;
// 32 random bytes, base64url: 43 characters, 256 bits of entropy.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const hashShareToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const newShareToken = () => crypto.randomBytes(32).toString("base64url");
const shareUrlFor = (token) => `${config.clientUrl.replace(/\/+$/, "")}/shared-answer/${token}`;
// The short task codes PTE students use, for the copied share message.
const TASK_CODES = {
  "read-aloud": "RA", "repeat-sentence": "RS", "describe-image": "DI",
  "answer-short-question": "ASQ", "respond-to-situation": "RTS"
};

// ---------------------------------------------------------------------------------------------
// Owner routes, mounted under /api/submissions.

export const ownerShareRoutes = express.Router();

// Each share makes a copy in storage, so creating them is limited per student.
const createShareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `share:${req.user?._id || req.ip}`,
  message: { message: "Too many share links created. Please try again later.", code: "RATE_LIMITED" }
});

async function ownedSubmission(req, res) {
  if (!mongoose.isValidObjectId(req.params.submissionId)) {
    res.status(400).json({ message: "Invalid identifier in request", code: "VALIDATION_ERROR" });
    return null;
  }
  const submission = await Submission.findById(req.params.submissionId);
  if (!submission) {
    res.status(404).json({ message: "Submission not found", code: "NOT_FOUND" });
    return null;
  }
  if (String(submission.user) !== String(req.user._id)) {
    res.status(403).json({ message: "You can only share your own answers", code: "FORBIDDEN" });
    return null;
  }
  return submission;
}

ownerShareRoutes.post("/:submissionId/share", requireAuth, requireActiveSubscription, createShareLimiter, asyncRoute(async (req, res) => {
  const submission = await ownedSubmission(req, res);
  if (!submission) return;

  if (submission.section !== "speaking") {
    return res.status(400).json({ message: "Only speaking answers can be shared.", code: "SHARE_NOT_ALLOWED" });
  }
  if (submission.evaluationStatus !== "COMPLETED") {
    return res.status(409).json({ message: "This answer can be shared once it has been scored.", code: "SHARE_NOT_READY" });
  }
  // A bare filename is a recording from before object storage, still on one server's disk; it
  // cannot be copied into the bucket from here.
  const original = submission.audioPath;
  const unavailable = () => res.status(409).json({
    message: "The recording for this answer is no longer stored, so it cannot be shared.",
    code: "RECORDING_UNAVAILABLE"
  });
  if (!original || (isRemoteStorage && !original.includes("/"))) return unavailable();
  if (!(await objectExists(original))) return unavailable();

  // The copy is named after the link's own id, so it is fixed before the row is written.
  const shareId = new mongoose.Types.ObjectId();
  const sharedKey = `${SHARED_AUDIO_PREFIX}${shareId}/${path.basename(original)}`;
  try {
    await copyObject(original, sharedKey);
    if (!(await objectExists(sharedKey))) throw new Error("shared copy not found after copying");
  } catch (err) {
    console.error("shared audio copy failed:", err?.message || err);
    return res.status(503).json({ message: "The answer could not be shared right now. Please try again.", code: "SHARE_COPY_FAILED" });
  }

  const token = newShareToken();
  const now = new Date();
  let share;
  try {
    share = await ShareLink.create({
      _id: shareId,
      owner: req.user._id,
      submission: submission._id,
      tokenHash: hashShareToken(token),
      sharedAudioObjectKey: sharedKey,
      // One instant for both, so the link lasts exactly SHARE_LIFETIME_MS from its creation.
      createdAt: now,
      expiresAt: new Date(now.getTime() + SHARE_LIFETIME_MS)
    });
  } catch (err) {
    // Nothing points at the copy just made; remove it rather than leave an orphan.
    await deleteObject(sharedKey).catch(() => {});
    throw err;
  }

  // Sharing again adds a link; it never cancels one already sent, which would leave everyone who
  // was given the earlier link looking at "no longer shared". Each link keeps its own 30 days and
  // its own audio copy, and DELETE below withdraws them all at once.

  // What the copied message says about the answer, e.g. "RA · Visit to Canada · PTE CORE AI Score 71/90".
  await submission.populate("question", "title");
  const summary = {
    taskCode: TASK_CODES[submission.type] || null,
    taskLabel: QUESTION_TYPES[submission.type]?.label || submission.type,
    questionTitle: submission.question?.title || null,
    score: submission.score,
    maxScore: submission.maxScore
  };
  res.status(201).json({ share: { url: shareUrlFor(token), createdAt: share.createdAt, expiresAt: share.expiresAt, summary } });
}));

// No subscription check: a student whose plan has ended must still be able to withdraw a link.
ownerShareRoutes.delete("/:submissionId/share", requireAuth, asyncRoute(async (req, res) => {
  const submission = await ownedSubmission(req, res);
  if (!submission) return;
  const { modifiedCount } = await ShareLink.updateMany(
    { submission: submission._id, status: "ACTIVE" },
    { $set: { status: "REVOKED", revokedAt: new Date() } }
  );
  res.json({ revoked: modifiedCount });
}));

// ---------------------------------------------------------------------------------------------
// Public routes, mounted at /api/public/shared-answers. No session is read or required.

export const publicShareRoutes = express.Router();

publicShareRoutes.use((req, res, next) => {
  // A report is personal data reachable by URL: never cached, never indexed.
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

const publicLimiter = (max) => rateLimit({
  windowMs: 60_000,
  max,
  keyGenerator: (req) => `shared:${req.ip}`,
  message: { message: "Too many requests. Please wait a moment and try again.", code: "RATE_LIMITED" }
});

const SHARE_STATE_ERRORS = {
  NOT_FOUND: [404, "This shared answer could not be found. Check the link, or ask for a new one.", "SHARE_NOT_FOUND"],
  EXPIRED: [410, "This shared answer has expired. Shared links stay open for 30 days.", "SHARE_EXPIRED"],
  REVOKED: [410, "This shared answer is no longer available. Its owner has stopped sharing it.", "SHARE_REVOKED"]
};

/** The active link for req.params.token, or null after answering with why it is not. */
async function activeShare(req, res) {
  const token = String(req.params.token || "");
  const share = TOKEN_PATTERN.test(token)
    ? await ShareLink.findOne({ tokenHash: hashShareToken(token) })
    : null;
  const state = share ? share.stateAt() : "NOT_FOUND";
  if (state !== "ACTIVE") {
    const [status, message, code] = SHARE_STATE_ERRORS[state];
    res.status(status).json({ message, code });
    return null;
  }
  return share;
}

// Labels for the AI's per-criterion scores. Only criteria actually present on the submission are
// reported; nothing is added that the evaluation did not produce.
const CRITERION_LABELS = {
  content: "Content", fluency: "Fluency", pronunciation: "Pronunciation", vocabulary: "Vocabulary",
  grammar: "Grammar", form: "Form", coherence: "Coherence"
};
const stringList = (value) => (Array.isArray(value) ? value.filter((s) => typeof s === "string" && s.trim()) : []);

/** The report a link shows: an explicit whitelist built from the submission, never the document. */
export function publicReport(submission, share) {
  const feedback = submission.feedback && typeof submission.feedback === "object" ? submission.feedback : {};
  const criteria = feedback.criteria && typeof feedback.criteria === "object"
    ? Object.entries(feedback.criteria)
      .filter(([key, value]) => CRITERION_LABELS[key] && typeof value === "number" && Number.isFinite(value))
      .map(([key, value]) => ({ key, label: CRITERION_LABELS[key], value, max: 100 }))
    : [];
  const mistakes = Array.isArray(feedback.mistakes)
    ? feedback.mistakes
      .filter((m) => m && typeof m.problem === "string" && m.problem.trim())
      .map((m) => ({
        problem: m.problem,
        studentText: typeof m.studentText === "string" ? m.studentText : "",
        correction: typeof m.correction === "string" ? m.correction : ""
      }))
    : [];
  return {
    taskType: submission.type,
    taskLabel: QUESTION_TYPES[submission.type]?.label || submission.type,
    questionTitle: submission.question?.title || null,
    answeredAt: submission.createdAt,
    score: submission.score,
    maxScore: submission.maxScore,
    // The recording's length, so the page can show it on Play before any audio is loaded.
    durationSeconds: Number.isFinite(submission.durationSeconds) ? submission.durationSeconds : null,
    criteria,
    transcript: typeof submission.transcript === "string" ? submission.transcript : "",
    overall: typeof feedback.overall === "string" ? feedback.overall : null,
    strengths: stringList(feedback.strengths),
    improvements: stringList(feedback.improvements),
    mistakes,
    hasAudio: true,
    expiresAt: share.expiresAt
  };
}

publicShareRoutes.get("/:token", publicLimiter(60), asyncRoute(async (req, res) => {
  const share = await activeShare(req, res);
  if (!share) return;
  const submission = await Submission.findById(share.submission)
    .select("type score maxScore durationSeconds transcript feedback createdAt question evaluationStatus")
    .populate("question", "title")
    .lean();
  if (!submission || submission.evaluationStatus !== "COMPLETED") {
    const [status, message, code] = SHARE_STATE_ERRORS.NOT_FOUND;
    return res.status(status).json({ message, code });
  }
  res.json({ report: publicReport(submission, share) });
}));

publicShareRoutes.get("/:token/audio-url", publicLimiter(120), asyncRoute(async (req, res) => {
  const share = await activeShare(req, res);
  if (!share) return;
  if (!(await objectExists(share.sharedAudioObjectKey))) {
    return res.status(410).json({ message: "The recording for this shared answer is no longer available.", code: "SHARE_AUDIO_UNAVAILABLE" });
  }
  const expiresAt = new Date(Date.now() + AUDIO_URL_TTL_SECONDS * 1000);
  if (!isRemoteStorage) {
    // Development without R2: the bytes are streamed by the route below, still through the token.
    return res.json({ path: `/api/public/shared-answers/${req.params.token}/audio`, expiresAt });
  }
  const url = await signedObjectUrl(share.sharedAudioObjectKey, AUDIO_URL_TTL_SECONDS);
  res.json({ url, expiresAt });
}));

// Local-disk storage only. With R2 the browser reads from a presigned URL instead, and this route
// does not exist. sendFile answers Range requests, so seeking works.
publicShareRoutes.get("/:token/audio", publicLimiter(240), asyncRoute(async (req, res) => {
  if (isRemoteStorage) return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
  const share = await activeShare(req, res);
  if (!share) return;
  if (!(await objectExists(share.sharedAudioObjectKey))) {
    return res.status(410).json({ message: "The recording for this shared answer is no longer available.", code: "SHARE_AUDIO_UNAVAILABLE" });
  }
  res.sendFile(localObjectPath(share.sharedAudioObjectKey));
}));
