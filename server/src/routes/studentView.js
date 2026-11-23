import express from "express";
import StudentViewSession from "../models/StudentViewSession.js";
import AuditLog from "../models/AuditLog.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";

// Ending a Student View: "Back to Admin Panel" / "Exit student view" in the view tab.
//
//   POST /api/student-view/end      authorised with that tab's own view pass
//
// The only request a view pass may make that is not a read (middleware/auth.js lets exactly this
// one through). It ends that one view and nothing else: the student's sign-in and every other view,
// this admin's or another's, carry on. A pass whose view has already ended is refused before it
// gets here, and the update below only succeeds once, so the end is recorded exactly once even if
// the button is pressed twice. Closing the tab sends nothing; that pass simply expires.

const router = express.Router();

router.post("/end", requireAuth, asyncRoute(async (req, res) => {
  if (!req.studentView) {
    return res.status(400).json({ message: "This request needs a student view pass.", code: "NOT_A_STUDENT_VIEW" });
  }
  const endedAt = new Date();
  const view = await StudentViewSession.findOneAndUpdate(
    { _id: req.studentView.viewId, endedAt: null },
    { $set: { endedAt, endReason: "EXITED" } },
    { new: true }
  );
  // Lost a race with a second press: the other request ended it and recorded it.
  if (!view) return res.json({ ended: true });

  // Who viewed whom and for how long — ids and times only, never the pass itself.
  await AuditLog.create({
    adminUser: view.admin,
    targetUser: view.student,
    action: "STUDENT_VIEW_ENDED",
    metadata: { viewId: String(view._id), studentId: String(view.student), startedAt: view.startedAt, endedAt, reason: "EXITED" }
  }).catch((err) => console.error("Audit log write failed:", err.message));
  res.json({ ended: true, endedAt });
}));

export default router;
