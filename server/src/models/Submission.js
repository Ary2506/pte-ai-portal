import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  question: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
  // Set only for standalone-practice content that has no real Question document at all (e.g.
  // Listening's bundled JSON, which uses its own short ids like "3942") — lets /submissions/history
  // match a submission back to that content's id for progress tracking, the same way `question`
  // does for real DB questions. Always null whenever `question` is set.
  localQuestionId: { type: String, default: null },
  testSession: { type: mongoose.Schema.Types.ObjectId, ref: "TestSession", default: null },
  section: { type: String, required: true },
  type: { type: String, required: true },
  answer: mongoose.Schema.Types.Mixed,
  transcript: String,
  audioPath: String,
  score: { type: Number, default: 0 },
  maxScore: { type: Number, default: 1 },
  evaluationType: { type: String, enum: ["objective", "subjective"], required: true },
  evaluationStatus: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "COMPLETED" },
  scoringMethod: { type: String, default: null },
  feedback: mongoose.Schema.Types.Mixed,
  durationSeconds: Number
}, { timestamps: true });

// A score can never exceed the marks that were available for it, and can never be negative.
// Enforced here rather than at each call site because there are four ways a score reaches this
// document — objective marking, the AI evaluator, the heuristic fallback, and the client-supplied
// `localResult` for bundled practice content that has no Question row — and only some of them
// clamped. A single bad row does not just render as "100/90": every section total, dashboard
// average and progress percentage is a sum over these, so one row above its own maximum pushes a
// whole section past 100%.
submissionSchema.pre("validate", function clampScore(next) {
  const max = Number.isFinite(this.maxScore) && this.maxScore > 0 ? this.maxScore : 1;
  this.maxScore = max;
  const score = Number.isFinite(this.score) ? this.score : 0;
  this.score = Math.min(max, Math.max(0, score));
  next();
});

submissionSchema.index({ user: 1, createdAt: -1 });
submissionSchema.index({ testSession: 1 });
// The actual race-condition protection for mock-test duplicate answers (routes/submissions.js's
// findOne-then-create is only a fast-path check, not a guarantee under concurrent requests).
// A plain `sparse` index would NOT work here: testSession defaults to null (a real, present
// value) rather than being absent for standalone practice, so a sparse index would still index
// — and collide on — every standalone retry of the same question. A partial index scoped to
// "both fields are real ObjectIds" is what actually leaves standalone practice (testSession:
// null) and freeform submissions (no linked question) completely unconstrained, while still
// uniquely constraining testSession+question whenever both are real — verified empirically
// against a real MongoDB instance before adding this.
submissionSchema.index(
  { testSession: 1, question: 1 },
  { unique: true, partialFilterExpression: { testSession: { $type: "objectId" }, question: { $type: "objectId" } } }
);

export default mongoose.model("Submission", submissionSchema);
