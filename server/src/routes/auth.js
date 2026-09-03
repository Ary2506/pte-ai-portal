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

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please wait a few minutes and try again.", code: "RATE_LIMITED" }
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

router.post("/signin", loginLimiter, async (req, res) => {
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
    if (subscriptionStatus === "EXPIRED") {
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

    // One-device/one-browser enforcement, reusing the same client-generated X-Device-Id every
    // request already carries — never IP address, never a fingerprinting library. Registered on
    // this account's first successful sign-in; every later sign-in must present the same value.
    // A missing header never satisfies an existing registration (that would let a client bypass
    // the check just by omitting it). Admin accounts are exempt, matching every other per-student
    // restriction in this project (subscription checks, single-session limit).
    if (user.role !== "admin") {
      const incomingDeviceId = (req.headers["x-device-id"] || "").toString().trim() || null;
      if (!user.registeredDeviceId) {
        user.registeredDeviceId = incomingDeviceId;
        await user.save();
      } else if (user.registeredDeviceId !== incomingDeviceId) {
        await recordLoginAttempt(req, { user, success: false, reason: "DEVICE_NOT_REGISTERED" });
        return res.status(403).json({
          message: "Your account is restricted to the device and browser where it was first registered. Please use your registered device and browser to continue.\n\nIf you need to change your device or browser, please contact the administrator.",
          code: "DEVICE_NOT_REGISTERED"
        });
      }
    }

    const activeSession = await Session.findOne({ user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } });
    if (activeSession && user.role !== "admin") {
      await recordLoginAttempt(req, { user, success: false, reason: "ACCOUNT_ALREADY_ACTIVE" });
      return res.status(409).json({
        message: "This account is already active on another device. Ask the administrator to sign you out of the other device if this wasn't you.",
        code: "ACCOUNT_ALREADY_ACTIVE"
      });
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
