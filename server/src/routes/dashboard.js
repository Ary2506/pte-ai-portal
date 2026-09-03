import express from "express";
import Submission from "../models/Submission.js";
import TestSession from "../models/TestSession.js";
import { requireAuth, requireActiveSubscription } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { getStreakInfo, utcDateString } from "../utils/streak.js";

const router = express.Router();

// Small, bounded 7-day lookup for the dashboard's weekly activity indicator (Phase 16, A7) — not
// a persisted analytics store, just the same two collections the rest of this route already
// reads, filtered to the last week. "Active" mirrors exactly what earns streak credit: a
// Submission or a completed TestSession on that UTC calendar day.
async function weeklyActivity(userId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [submissions, completedSessions] = await Promise.all([
    Submission.find({ user: userId, createdAt: { $gte: sevenDaysAgo } }).select("createdAt"),
    TestSession.find({ user: userId, status: "COMPLETED", submittedAt: { $gte: sevenDaysAgo } }).select("submittedAt")
  ]);
  const activeDates = new Set([
    ...submissions.map(s => utcDateString(s.createdAt)),
    ...completedSessions.map(s => utcDateString(s.submittedAt))
  ]);
  return Array.from({ length: 7 }, (_, i) => {
    const date = utcDateString(new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000));
    return { date, active: activeDates.has(date) };
  });
}

router.get("/", requireAuth, requireActiveSubscription, asyncRoute(async (req, res) => {
  const submissions = await Submission.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100);
  const avg = submissions.length ? Math.round(submissions.reduce((a, s) => a + s.score, 0) / submissions.length) : 0;
  const bySection = ["speaking", "writing", "reading", "listening"].map(section => {
    const rows = submissions.filter(s => s.section === section);
    return { section, score: rows.length ? Math.round(rows.reduce((a, s) => a + s.score, 0) / rows.length) : 0 };
  });
  res.json({
    stats: { overall: avg, practiceCount: submissions.length, targetScore: req.user.targetScore },
    bySection,
    // Mock-test answers count toward the section averages above, but are grouped into their
    // own result on the mock-test history rather than appearing as individual recent items here.
    recent: submissions.filter(s => !s.testSession).slice(0, 6),
    // Real calendar-based learning streak (Phase 16, Part A) — replaces the old
    // submissionCount/2 placeholder, which was never a real day-over-day streak.
    streak: getStreakInfo(req.user),
    weeklyActivity: await weeklyActivity(req.user._id)
  });
}));

router.get("/study-plan", requireAuth, requireActiveSubscription, asyncRoute(async (req, res) => {
  const submissions = await Submission.find({ user: req.user._id });
  const sectionScores = ["speaking", "writing", "reading", "listening"].map(section => {
    const rows = submissions.filter(s => s.section === section);
    return { section, score: rows.length ? Math.round(rows.reduce((a, s) => a + s.score, 0) / rows.length) : 0 };
  }).sort((a,b) => a.score-b.score);
  const weakest = sectionScores[0]?.section || "speaking";
  res.json({ weakest, tasks: [
    `Complete 10 ${weakest} questions`,
    "Review yesterday's mistakes for 15 minutes",
    "Learn 10 high-frequency academic words",
    "Complete one timed mini test"
  ], sectionScores });
}));

export default router;
