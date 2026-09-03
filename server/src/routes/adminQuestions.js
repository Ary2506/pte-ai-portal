import express from "express";
import mongoose from "mongoose";
import Question from "../models/Question.js";
import Submission from "../models/Submission.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { validateAndNormalizeQuestion } from "../validation/questionValidation.js";
import { QUESTION_TYPES, QUESTION_SECTIONS } from "../questionTypes.js";

const router = express.Router();
router.use(requireAuth, requireAdmin);

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFilter(query) {
  const clauses = [];
  if (query.section && QUESTION_SECTIONS.includes(query.section)) clauses.push({ section: query.section });
  if (query.type && QUESTION_TYPES[query.type]) clauses.push({ type: query.type });
  if (query.evaluationType) clauses.push({ evaluationType: query.evaluationType });
  if (query.difficulty) clauses.push({ difficulty: query.difficulty });
  if (query.status === "active") clauses.push({ active: true });
  else if (query.status === "inactive") clauses.push({ active: false });
  if (query.search) {
    const term = query.search.toString().trim();
    const re = new RegExp(escapeRegex(term), "i");
    const or = [{ title: re }, { prompt: re }];
    if (mongoose.isValidObjectId(term)) or.push({ _id: term });
    clauses.push({ $or: or });
  }
  return clauses.length ? { $and: clauses } : {};
}

// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/types", (req, res) => {
  res.json({ types: Object.entries(QUESTION_TYPES).map(([type, meta]) => ({ type, ...meta })) });
});

router.get("/stats", asyncRoute(async (req, res) => {
  const [total, active, bySection, byEvaluationType, byDifficulty] = await Promise.all([
    Question.countDocuments({}),
    Question.countDocuments({ active: true }),
    Question.aggregate([{ $group: { _id: "$section", count: { $sum: 1 } } }]),
    Question.aggregate([{ $group: { _id: "$evaluationType", count: { $sum: 1 } } }]),
    Question.aggregate([{ $group: { _id: "$difficulty", count: { $sum: 1 } } }])
  ]);
  const toMap = rows => Object.fromEntries(rows.map(r => [r._id, r.count]));
  res.json({
    total,
    active,
    inactive: total - active,
    bySection: toMap(bySection),
    byEvaluationType: toMap(byEvaluationType),
    byDifficulty: toMap(byDifficulty)
  });
}));

router.get("/", asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = buildFilter(req.query);

  const [data, total] = await Promise.all([
    Question.find(filter).select("title section type evaluationType difficulty active createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Question.countDocuments(filter)
  ]);

  res.json({ data, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
}));

router.get("/:id", asyncRoute(async (req, res) => {
  const question = await Question.findById(req.params.id);
  if (!question) return res.status(404).json({ message: "Question not found", code: "NOT_FOUND" });
  res.json({ question });
}));

router.post("/", asyncRoute(async (req, res) => {
  const { errors, normalized } = validateAndNormalizeQuestion(req.body);
  if (errors.length) return res.status(400).json({ message: errors[0], errors, code: "VALIDATION_ERROR" });

  const question = await Question.create({
    ...req.body,
    ...normalized,
    active: req.body.active !== false
  });
  res.status(201).json({ question });
}));

router.put("/:id", asyncRoute(async (req, res) => {
  const existing = await Question.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: "Question not found", code: "NOT_FOUND" });

  const merged = { ...existing.toObject(), ...req.body };
  const { errors, normalized } = validateAndNormalizeQuestion(merged);
  if (errors.length) return res.status(400).json({ message: errors[0], errors, code: "VALIDATION_ERROR" });

  Object.assign(existing, req.body, normalized);
  await existing.save();
  // Editing only changes the live question document. Past Submissions already stored their own
  // snapshot of score/feedback/answer at submission time, so historical results are unaffected —
  // there is no versioning system, and none is needed at this scale.
  res.json({ question: existing });
}));

router.patch("/:id/status", asyncRoute(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== "boolean") return res.status(400).json({ message: "active must be true or false", code: "VALIDATION_ERROR" });

  const question = await Question.findById(req.params.id);
  if (!question) return res.status(404).json({ message: "Question not found", code: "NOT_FOUND" });

  // Deactivating is always safe. Activating is not — this route used to update `active` alone,
  // which is exactly how a question with a missing answer key could stay (or become) active
  // without ever going through the same validation POST/PUT already enforce. Re-running that
  // same check against the question's current state closes that gap without duplicating any
  // validation logic or touching the fields being validated.
  if (active) {
    const { errors } = validateAndNormalizeQuestion(question.toObject());
    if (errors.length) {
      return res.status(400).json({ message: `This question cannot be activated: ${errors[0]}`, errors, code: "VALIDATION_ERROR" });
    }
  }

  question.active = active;
  await question.save();
  res.json({ question });
}));

router.delete("/:id", asyncRoute(async (req, res) => {
  const inUse = await Submission.exists({ question: req.params.id });
  if (inUse) {
    return res.status(409).json({
      message: "This question has student submissions and cannot be deleted. Deactivate it instead.",
      code: "QUESTION_IN_USE"
    });
  }
  const question = await Question.findByIdAndDelete(req.params.id);
  if (!question) return res.status(404).json({ message: "Question not found", code: "NOT_FOUND" });
  res.json({ message: "Question deleted" });
}));

export default router;
