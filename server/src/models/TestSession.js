import mongoose from "mongoose";

const testSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  testType: { type: String, enum: ["mock"], default: "mock" },
  status: { type: String, enum: ["IN_PROGRESS", "COMPLETED", "ABANDONED", "EXPIRED"], default: "IN_PROGRESS" },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date, default: null },
  totalQuestions: { type: Number, required: true },
  answeredQuestions: { type: Number, default: 0 },
  // The exact questions issued at start, server-picked — a submission's questionId is only
  // accepted for this session if it appears here (see routes/submissions.js). Not required at
  // the schema level so pre-Phase-7 sessions (created before this field existed) don't fail
  // validation on their next save; those legacy sessions simply skip this specific check.
  questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Question" }],
  // Server-computed at creation only (startedAt + config.mockTestDurationMinutes) — never
  // accepted from the client. Absent on legacy sessions, which never expire (see
  // routes/testSessions.js's expireIfNeeded).
  expiresAt: { type: Date, default: null },
  sectionScores: [{
    _id: false,
    section: String,
    score: Number,
    maxScore: Number
  }],
  totalScore: { type: Number, default: 0 },
  totalMaxScore: { type: Number, default: 0 },
  pendingSubjective: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model("TestSession", testSessionSchema);
