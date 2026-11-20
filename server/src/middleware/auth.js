import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Session from "../models/Session.js";
import { config } from "../config.js";
import { getSubscriptionStatus, sectionStatus } from "../utils/subscription.js";
import { isSection } from "../sections.js";
import { isStudentViewAdmin } from "../studentViewAccess.js";
import StudentViewSession from "../models/StudentViewSession.js";

// Student Website View (routes/admin.js POST /users/:id/view-session): a read-only pass that lets an
// admin see the student-facing site as one student sees it. Its token carries kind "student-view".
export const STUDENT_VIEW_KIND = "student-view";
export const STUDENT_VIEW_TTL_SECONDS = 2 * 60 * 60;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Who may open views: only the admins listed in STUDENT_VIEW_ADMIN_IDS, failing closed (see
// studentViewAccess.js). Re-exported here because the routes take their auth helpers from this file.
export { isStudentViewAdmin };

/**
 * A request made with a student-view pass. The viewed student becomes req.user, so every student
 * route returns exactly what that student would see — and is still held to that student's own
 * access. Nothing is written: no session is created or touched for anyone, and any request other
 * than a read is refused here, before it reaches a route.
 */
// The one action a view pass may take that is not a read: ending its own view
// (routes/studentView.js). It changes nothing that belongs to the student.
const END_VIEW_PATH = "/api/student-view/end";

const viewEnded = (res) => res.status(401).json({ message: "This student view has ended. Open it again from the admin panel.", code: "STUDENT_VIEW_ENDED" });

async function authenticateStudentView(payload, req, res, next) {
  const endingThisView = req.method === "POST" && req.originalUrl.split("?")[0] === END_VIEW_PATH;
  if (!READ_METHODS.has(req.method) && !endingThisView) {
    return res.status(403).json({ message: "Student view is read-only. Nothing can be changed from here.", code: "READ_ONLY_VIEW" });
  }
  // The pass's own record: once the view is ended there, the pass stops working immediately.
  const view = payload.viewId ? await StudentViewSession.findById(payload.viewId) : null;
  if (!view || view.endedAt || String(view.admin) !== payload.adminId || String(view.student) !== payload.studentId) {
    return viewEnded(res);
  }
  // Tied to the admin's own sign-in: signing out (or that session ending) ends every view it opened.
  const adminSession = await Session.findById(payload.adminSessionId);
  if (!adminSession || String(adminSession.user) !== payload.adminId || adminSession.revokedAt || adminSession.expiresAt < new Date()) {
    return viewEnded(res);
  }
  const admin = await User.findById(payload.adminId).select("-passwordHash");
  if (!isStudentViewAdmin(admin)) {
    return viewEnded(res);
  }
  const student = await User.findById(payload.studentId).select("-passwordHash");
  if (!student || student.role !== "student") {
    return res.status(404).json({ message: "Student not found", code: "NOT_FOUND" });
  }
  req.user = student;
  req.studentView = { adminId: admin._id, viewId: view._id };
  next();
}

export async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ message: "Authentication required", code: "AUTH_REQUIRED" });

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ message: "Invalid or expired token", code: "SESSION_INVALID" });
    }
    if (payload.kind === STUDENT_VIEW_KIND) return await authenticateStudentView(payload, req, res, next);

    const session = await Session.findById(payload.sessionId);
    if (!session || String(session.user) !== payload.userId) {
      return res.status(401).json({ message: "Invalid session", code: "SESSION_INVALID" });
    }
    if (session.revokedAt) {
      return res.status(401).json({ message: "You have been signed out of this session.", code: "SESSION_REVOKED" });
    }
    if (session.expiresAt < new Date()) {
      return res.status(401).json({ message: "Your session has expired. Please sign in again.", code: "SESSION_EXPIRED" });
    }

    const user = await User.findById(payload.userId).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "Account not found", code: "SESSION_INVALID" });

    if (user.accountStatus === "BLOCKED") {
      return res.status(403).json({ message: "This account has been blocked. Contact the administrator.", code: "ACCOUNT_BLOCKED" });
    }
    if (user.accountStatus === "SUSPENDED") {
      return res.status(403).json({ message: "This account is suspended. Contact the administrator.", code: "ACCOUNT_SUSPENDED" });
    }

    session.lastActiveAt = new Date();
    // Awaited (not fire-and-forget) — a route handler further down the chain that also saves
    // req.session (e.g. POST /auth/logout, which sets revokedAt) would otherwise race this save
    // on the very same document instance and hit Mongoose's ParallelSaveError. Still swallows a
    // failure here rather than blocking the request on a non-critical timestamp update.
    await session.save().catch(() => {});

    req.user = user;
    req.session = session;
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token", code: "SESSION_INVALID" });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required", code: "ADMIN_REQUIRED" });
  next();
}

const SECTION_NAMES = { speaking: "Speaking", writing: "Writing", reading: "Reading", listening: "Listening" };

/**
 * Why this user may not use `section`, as a 403 body, or null if they may.
 *
 * requireActiveSubscription (below) answers "may this account use the app at all" — true while
 * any section is active. This answers it for one section. Two codes, so the student is told which
 * case they are in: never bought (SECTION_LOCKED) or bought and lapsed (SECTION_EXPIRED; a
 * cancelled section reads as expired to the student). Neither is a reason to sign anyone out —
 * the client must not treat them like SUBSCRIPTION_EXPIRED.
 *
 * Only a real section name is ever refused. Anything else holds no content to protect, and is
 * left to behave as it did before sections existed (an empty question list, for example).
 */
export function sectionDenial(user, section) {
  if (!isSection(section)) return null;
  const status = sectionStatus(user, section);
  if (status === "ACTIVE") return null;
  const name = SECTION_NAMES[section];
  if (status === "NOT_PURCHASED") {
    return { message: `${name} is not part of your plan. Contact the administrator to add it.`, code: "SECTION_LOCKED", section };
  }
  return { message: `Your ${name} access has expired. Contact the administrator to renew it.`, code: "SECTION_EXPIRED", section };
}

export function requireActiveSubscription(req, res, next) {
  if (req.user?.role === "admin") return next();
  const status = getSubscriptionStatus(req.user);
  if (status === "EXPIRED" || status === "CANCELLED") {
    return res.status(403).json({
      message: "Your 30-day access has expired. Please contact the administrator to renew your subscription.",
      code: "SUBSCRIPTION_EXPIRED"
    });
  }
  if (status === "NOT_ACTIVATED") {
    return res.status(403).json({
      message: "Your subscription has not been activated yet. Please contact the administrator.",
      code: "SUBSCRIPTION_INACTIVE"
    });
  }
  next();
}
