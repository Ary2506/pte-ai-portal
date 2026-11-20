import mongoose from "mongoose";

// One open Student View (an admin's read-only view of one student's site). The view pass names
// this record, and every request made with the pass checks it, so ending the view here stops the
// pass at once instead of when it would have expired.
//
// Nothing in it belongs to the student: it says who is looking at whom, from which admin session,
// and when the view ended and why. Rows are removed 30 days after the pass would have expired; the
// audit log (STUDENT_VIEW_STARTED / STUDENT_VIEW_ENDED) is the lasting record.
const studentViewSessionSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  adminSession: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  endReason: { type: String, enum: ["EXITED", null], default: null }
}, { timestamps: false });

studentViewSessionSchema.index({ admin: 1, endedAt: 1 });
studentViewSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model("StudentViewSession", studentViewSessionSchema);
