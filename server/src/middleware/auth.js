import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Session from "../models/Session.js";
import { config } from "../config.js";
import { getSubscriptionStatus, sectionStatus } from "../utils/subscription.js";
import { isSection } from "../sections.js";

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
