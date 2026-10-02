import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Session from "../models/Session.js";
import LoginAttempt from "../models/LoginAttempt.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { publicUser, getSubscriptionStatus } from "../utils/subscription.js";
import { asyncRoute } from "../utils/asyncRoute.js";

const router = express.Router();

const RATE_LIMITED = {
  message: "Too many login attempts. Please wait a few minutes and try again.",
  code: "RATE_LIMITED"
};

// Per-IP, and deliberately looser than the per-account limit below. A whole coaching centre —
// or anyone on carrier-grade NAT, which most Indian mobile broadband uses — shares one public
// address, so a tight per-IP cap punishes a roomful of students for each other's typos. Its job
// is only to stop one address hammering many different accounts.
const loginIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: RATE_LIMITED
});

// Per-account, and the one that actually blunts a password-guessing attack. Keying on the
// submitted username rather than the caller's address means spreading the attempt across a
// botnet does not buy an attacker extra guesses against a single account — which the per-IP
// limiter alone cannot do anything about. Five attempts per fifteen minutes is generous for a
// student mistyping their own password and hopeless for guessing someone else's.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: false, // The IP limiter above already sets these; two sets would conflict.
  legacyHeaders: false,
  // Mirrors the exact normalization the route itself applies below, so "Karan" and "karan "
  // cannot be used as separate buckets against the same account. Requests with no username
  // fall through to the IP key and are rejected by the route's own validation anyway.
  keyGenerator: (req) =>
    (req.body?.username || req.body?.userId || "").toString().toLowerCase().trim() || `ip:${req.ip}`,
  // Only failed attempts count. This limiter exists to blunt password guessing, and a sign-in
  // that succeeded was not a guess — counting it meant five legitimate sign-ins in a quarter of
  // an hour locked the account out. That is easy to reach now that signing in elsewhere takes
  // over rather than being refused: someone moving between a phone, a laptop and a lab machine
  // is doing exactly what the product invites them to do.
  skipSuccessfulRequests: true,
  message: RATE_LIMITED
});

// One row per signin attempt, at the exact outcome already being returned to the caller — never
// a finer-grained reason than the response itself already discloses. Awaited (not fire-and-
// forget) so a test can query it immediately after the HTTP response, but its own failure is
// swallowed so a transient audit-write problem can never itself block or deny a real login —
// this must only ever observe, never gate, authentication.
async function recordLoginAttempt(req, { user, success, reason }) {
  await LoginAttempt.create({
    user: user?._id || null,
    success,
    reason,
    deviceId: (req.headers["x-device-id"] || "").toString().trim() || null,
    ipAddress: req.ip
  }).catch(() => {});
}

function registrationDisabled(_req, res) {
  res.status(403).json({
    message: "Public registration is disabled. Please contact the administrator.",
    code: "PUBLIC_REGISTRATION_DISABLED"
  });
}
router.post("/signup", registrationDisabled);
router.post("/register", registrationDisabled);

router.post("/signin", loginIpLimiter, loginAccountLimiter, async (req, res) => {
  try {
    const username = (req.body.username || req.body.userId || "").toString().toLowerCase().trim();
    const password = req.body.password || "";
    if (!username || !password) {
      return res.status(400).json({ message: "User ID and password are required", code: "VALIDATION_ERROR" });
    }

    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      // `user` here may be a real, matched account (wrong password) or null (no such username) —
      // recorded either way, but the response itself never distinguishes the two, so this can
      // never be used to enumerate valid usernames any more than the API already prevents.
      await recordLoginAttempt(req, { user, success: false, reason: "INVALID_CREDENTIALS" });
      return res.status(401).json({ message: "Invalid User ID or password", code: "INVALID_CREDENTIALS" });
    }

    if (user.accountStatus === "BLOCKED") {
      await recordLoginAttempt(req, { user, success: false, reason: "ACCOUNT_BLOCKED" });
      return res.status(403).json({ message: "This account has been blocked. Contact the administrator.", code: "ACCOUNT_BLOCKED" });
    }
    if (user.accountStatus === "SUSPENDED") {
      await recordLoginAttempt(req, { user, success: false, reason: "ACCOUNT_SUSPENDED" });
      return res.status(403).json({ message: "This account is suspended. Contact the administrator.", code: "ACCOUNT_SUSPENDED" });
    }

    const subscriptionStatus = getSubscriptionStatus(user);
    if (subscriptionStatus === "EXPIRED" || subscriptionStatus === "CANCELLED") {
      await recordLoginAttempt(req, { user, success: false, reason: "SUBSCRIPTION_EXPIRED" });
      return res.status(403).json({
        message: "Your 30-day access has expired. Please contact the administrator to renew your subscription.",
        code: "SUBSCRIPTION_EXPIRED"
      });
    }
    if (subscriptionStatus === "NOT_ACTIVATED") {
      await recordLoginAttempt(req, { user, success: false, reason: "SUBSCRIPTION_INACTIVE" });
      return res.status(403).json({
        message: "Your subscription has not been activated yet. Please contact the administrator.",
        code: "SUBSCRIPTION_INACTIVE"
      });
    }

    // One account, one live session — on any device, in any browser. Signing in somewhere new is
    // allowed and takes over: whatever was signed in before is revoked here, and its next request
    // comes back SESSION_REVOKED, which the client already treats as a forced sign-out.
    //
    // This replaces two earlier rules. The first bound an account permanently to the device it
    // first signed in from and rejected every other one, which made a new laptop an administrator
    // ticket. The second rejected a second sign-in outright while a session was live, which left
    // an account stranded for up to seven days after a closed tab or a lost phone, since nothing
    // revokes a session when a browser simply goes away.
    //
    // Neither applied to administrators, which is why the same admin account could be signed in
    // to two browsers at once. Takeover applies to every role: one person, one session.
    const incomingDeviceId = (req.headers["x-device-id"] || "").toString().trim() || null;
    const revoked = await Session.updateMany(
      { user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { revokedAt: new Date() } }
    );
    if (revoked.modifiedCount) {
      // Recorded as its own outcome so "signed in, which signed someone else out" is visible in
      // the login history rather than looking like an ordinary sign-in.
      await recordLoginAttempt(req, { user, success: true, reason: "SESSION_TAKEN_OVER" });
    }

    // Still tracked, no longer enforced: the admin user list shows whether an account has a
    // device on record, and it now reflects where that account was last used.
    if (user.registeredDeviceId !== incomingDeviceId) {
      user.registeredDeviceId = incomingDeviceId;
      await user.save();
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = await Session.create({
      user: user._id,
      deviceId: req.headers["x-device-id"] || null,
      userAgent: req.headers["user-agent"] || null,
      ipAddress: req.ip,
      expiresAt
    });

    user.lastLoginAt = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id.toString(), sessionId: session._id.toString() },
      config.jwtSecret,
      { expiresIn: "7d" }
    );
    await recordLoginAttempt(req, { user, success: true, reason: "SUCCESS" });
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Sign in failed", code: "SERVER_ERROR" });
  }
});

router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post("/logout", requireAuth, asyncRoute(async (req, res) => {
  req.session.revokedAt = new Date();
  await req.session.save();
  res.json({ message: "Signed out" });
}));

export default router;
