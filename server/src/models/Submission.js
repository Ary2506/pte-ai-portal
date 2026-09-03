import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  question: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
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
