import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Session from "../models/Session.js";
import AuditLog from "../models/AuditLog.js";
import TestSession from "../models/TestSession.js";
import LoginAttempt from "../models/LoginAttempt.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { publicUser } from "../utils/subscription.js";
import { generateTempPassword } from "../utils/password.js";
import { logAdminAction } from "../utils/audit.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { config } from "../config.js";
import { loadSessionResults } from "./testSessions.js";

const router = express.Router();
router.use(requireAuth, requireAdmin);

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds a Mongo filter from query params without letting two `$or` clauses (e.g. search
// and the "not activated" subscription filter) clobber each other.
function buildUserFilter(query) {
  const clauses = [];
  if (query.status) clauses.push({ accountStatus: query.status });
  if (query.paymentStatus) clauses.push({ paymentStatus: query.paymentStatus });
  if (query.search) {
    const re = new RegExp(escapeRegex(query.search.toString().trim()), "i");
    clauses.push({ $or: [{ username: re }, { name: re }, { email: re }] });
  }

  const now = new Date();
  if (query.subscription === "ACTIVE") {
    clauses.push({ paymentStatus: "PAID", subscriptionEndDate: { $gt: now } });
  } else if (query.subscription === "EXPIRED") {
    clauses.push({ paymentStatus: "PAID", subscriptionEndDate: { $lte: now } });
  } else if (query.subscription === "EXPIRING") {
    clauses.push({ paymentStatus: "PAID", subscriptionEndDate: { $gt: now, $lte: addDays(now, 7) } });
  } else if (query.subscription === "NOT_ACTIVATED") {
    clauses.push({ $or: [{ paymentStatus: { $ne: "PAID" } }, { subscriptionEndDate: null }] });
  }

  return clauses.length ? { $and: clauses } : {};
}

router.get("/dashboard/stats", asyncRoute(async (req, res) => {
  const now = new Date();
  const in7Days = addDays(now, 7);
  const studentFilter = { role: "student" };

  const [
    totalUsers,
    activeAccounts, blockedAccounts, suspendedAccounts,
    pendingPayment, paidPayment, failedPayment, refundedPayment,
    activeSubs, expiredSubs, notActivated, expiringSoon
  ] = await Promise.all([
    User.countDocuments(studentFilter),
    User.countDocuments({ ...studentFilter, accountStatus: "ACTIVE" }),
    User.countDocuments({ ...studentFilter, accountStatus: "BLOCKED" }),
    User.countDocuments({ ...studentFilter, accountStatus: "SUSPENDED" }),
    User.countDocuments({ ...studentFilter, paymentStatus: "PENDING" }),
    User.countDocuments({ ...studentFilter, paymentStatus: "PAID" }),
    User.countDocuments({ ...studentFilter, paymentStatus: "FAILED" }),
    User.countDocuments({ ...studentFilter, paymentStatus: "REFUNDED" }),
    User.countDocuments({ ...studentFilter, paymentStatus: "PAID", subscriptionEndDate: { $gt: now } }),
    User.countDocuments({ ...studentFilter, paymentStatus: "PAID", subscriptionEndDate: { $lte: now } }),
    User.countDocuments({ ...studentFilter, $or: [{ paymentStatus: { $ne: "PAID" } }, { subscriptionEndDate: null }] }),
    User.countDocuments({ ...studentFilter, paymentStatus: "PAID", subscriptionEndDate: { $gt: now, $lte: in7Days } })
  ]);

  res.json({
    totalUsers,
    accountStatus: { active: activeAccounts, blocked: blockedAccounts, suspended: suspendedAccounts },
    paymentStatus: { pending: pendingPayment, paid: paidPayment, failed: failedPayment, refunded: refundedPayment },
    subscription: { active: activeSubs, expired: expiredSubs, notActivated, expiringWithin7Days: expiringSoon }
  });
}));

router.get("/audit-log", asyncRoute(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const logs = await AuditLog.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("adminUser", "username name")
    .populate("targetUser", "username name");
  res.json({
    logs: logs.map(l => ({
      id: l._id,
      action: l.action,
      admin: l.adminUser ? { username: l.adminUser.username, name: l.adminUser.name } : null,
      target: l.targetUser ? { username: l.targetUser.username, name: l.targetUser.name } : null,
      metadata: l.metadata,
      createdAt: l.createdAt
    }))
  });
}));

router.post("/users", asyncRoute(async (req, res) => {
  try {
    const { username, name, email, password, paymentStatus, subscriptionDays } = req.body;
    if (!username?.trim() || !name?.trim()) {
      return res.status(400).json({ message: "User ID and name are required", code: "VALIDATION_ERROR" });
    }
    const normalized = username.toLowerCase().trim();
    if (await User.findOne({ username: normalized })) {
      return res.status(409).json({ message: "This User ID is already taken", code: "USERNAME_TAKEN" });
    }

    const plainPassword = (password || "").trim() || generateTempPassword();
    if (plainPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters", code: "VALIDATION_ERROR" });
    }
    const passwordHash = await bcrypt.hash(plainPassword, 12);

    const days = Number(subscriptionDays) > 0 ? Number(subscriptionDays) : config.subscriptionDefaultDays;
    const activate = paymentStatus === "PAID";
    const now = new Date();

    const user = await User.create({
      username: normalized,
      name: name.trim(),
      email: email?.trim() ? email.trim().toLowerCase() : undefined,
      passwordHash,
      paymentStatus: activate ? "PAID" : "PENDING",
      subscriptionStartDate: activate ? now : null,
      subscriptionEndDate: activate ? addDays(now, days) : null,
      createdBy: req.user._id
    });

    logAdminAction(req.user, "USER_CREATED", user, { paymentStatus: user.paymentStatus, subscriptionDays: activate ? days : null });
    res.status(201).json({ user: publicUser(user), temporaryPassword: plainPassword });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: "This User ID or email is already in use", code: "DUPLICATE" });
    }
    throw e;
  }
}));

router.get("/users", asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = buildUserFilter(req.query);

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter)
  ]);

  const now = new Date();
  const activeSessionUserIds = new Set(
    (
      await Session.find({ user: { $in: users.map(u => u._id) }, revokedAt: null, expiresAt: { $gt: now } }).select("user")
    ).map(s => String(s.user))
  );

  res.json({
    users: users.map(u => ({ ...publicUser(u), sessionStatus: activeSessionUserIds.has(String(u._id)) ? "ACTIVE" : "NONE" })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  });
}));

router.get("/users/:id", asyncRoute(async (req, res) => {
  const user = await User.findById(req.params.id).populate("createdBy", "username name");
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  const sessions = await Session.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);
  // Reusing this same already-open "investigate one student's account" view rather than adding a
  // new admin page/tab — the natural moment this matters is exactly when an admin is already
  // looking at this specific account (e.g. a student reports they can't log in).
  const loginAttempts = await LoginAttempt.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);
  const now = new Date();
  res.json({
    user: {
      ...publicUser(user),
      createdBy: user.createdBy ? { username: user.createdBy.username, name: user.createdBy.name } : null,
      // Whether this account is currently locked to a device/browser — never the raw id itself,
      // which stays purely internal (see models/User.js).
      deviceRegistered: !!user.registeredDeviceId
    },
    sessions: sessions.map(s => ({
      id: s._id,
      deviceId: s.deviceId,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      status: s.revokedAt ? "REVOKED" : s.expiresAt < now ? "EXPIRED" : "ACTIVE"
    })),
    loginAttempts: loginAttempts.map(a => ({
      id: a._id,
      success: a.success,
      reason: a.reason,
      deviceId: a.deviceId,
      ipAddress: a.ipAddress,
      createdAt: a.createdAt
    }))
  });
}));

router.patch("/users/:id", asyncRoute(async (req, res) => {
  const { name, email } = req.body;
  const update = {};
  if (name !== undefined) update.name = name.trim();
  if (email !== undefined) update.email = email?.trim() ? email.trim().toLowerCase() : undefined;
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  logAdminAction(req.user, "USER_UPDATED", user, update);
  res.json({ user: publicUser(user) });
}));

router.patch("/users/:id/status", asyncRoute(async (req, res) => {
  const { accountStatus } = req.body;
  if (!["ACTIVE", "BLOCKED", "SUSPENDED"].includes(accountStatus)) {
    return res.status(400).json({ message: "Invalid status", code: "VALIDATION_ERROR" });
  }
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(400).json({ message: "You cannot change your own account status", code: "CANNOT_MODIFY_SELF" });
  }
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  if (target.role === "admin") {
    return res.status(403).json({ message: "Admin accounts cannot be blocked or suspended here", code: "CANNOT_MODIFY_ADMIN" });
  }

  target.accountStatus = accountStatus;
  await target.save();
  if (accountStatus !== "ACTIVE") {
    await Session.updateMany({ user: target._id, revokedAt: null }, { revokedAt: new Date() });
  }
  logAdminAction(
    req.user,
    accountStatus === "BLOCKED" ? "USER_BLOCKED" : accountStatus === "SUSPENDED" ? "USER_SUSPENDED" : "USER_ACTIVATED",
    target,
    { accountStatus }
  );
  res.json({ user: publicUser(target) });
}));

router.patch("/users/:id/subscription", asyncRoute(async (req, res) => {
  const { paymentStatus, subscriptionStartDate, subscriptionEndDate, paymentId } = req.body;
  if (paymentStatus && !["PENDING", "PAID", "FAILED", "REFUNDED"].includes(paymentStatus)) {
    return res.status(400).json({ message: "Invalid payment status", code: "VALIDATION_ERROR" });
  }

  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });

  const nextStart = subscriptionStartDate ? new Date(subscriptionStartDate) : target.subscriptionStartDate;
  const nextEnd = subscriptionEndDate ? new Date(subscriptionEndDate) : target.subscriptionEndDate;
  if (nextStart && nextEnd && nextEnd <= nextStart) {
    return res.status(400).json({ message: "Expiry date must be after the start date", code: "VALIDATION_ERROR" });
  }

  const update = {};
  if (paymentStatus) update.paymentStatus = paymentStatus;
  if (subscriptionStartDate) update.subscriptionStartDate = new Date(subscriptionStartDate);
  if (subscriptionEndDate) update.subscriptionEndDate = new Date(subscriptionEndDate);
  if (paymentId !== undefined) update.paymentId = paymentId;

  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
  logAdminAction(req.user, "SUBSCRIPTION_CHANGED", user, update);
  res.json({ user: publicUser(user) });
}));

router.post("/users/:id/renew", asyncRoute(async (req, res) => {
  const days = Number(req.body.days) > 0 ? Number(req.body.days) : config.subscriptionDefaultDays;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  const now = new Date();
  // If still active, extend from the existing expiry so the user never loses remaining time.
  // If already expired (or never activated), the new period starts from now.
  const base = user.subscriptionEndDate && user.subscriptionEndDate > now ? user.subscriptionEndDate : now;
  user.subscriptionStartDate = user.subscriptionStartDate && base > now ? user.subscriptionStartDate : now;
  user.subscriptionEndDate = addDays(base, days);
  user.paymentStatus = "PAID";
  await user.save();
  logAdminAction(req.user, "SUBSCRIPTION_RENEWED", user, { days, newEndDate: user.subscriptionEndDate });
  res.json({ user: publicUser(user) });
}));

router.patch("/users/:id/password", asyncRoute(async (req, res) => {
  const plainPassword = (req.body.password || "").trim() || generateTempPassword();
  if (plainPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters", code: "VALIDATION_ERROR" });
  }
  const passwordHash = await bcrypt.hash(plainPassword, 12);
  const user = await User.findByIdAndUpdate(req.params.id, { passwordHash }, { new: true });
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  logAdminAction(req.user, "PASSWORD_RESET", user, {});
  res.json({ user: publicUser(user), temporaryPassword: plainPassword });
}));

router.post("/users/:id/revoke-sessions", asyncRoute(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  const result = await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  // Force-logout is also this project's mechanism for letting a student register a new
  // device/browser (see routes/auth.js) — the message shown at account creation and on a
  // device-mismatch rejection both promise "contact the administrator" for exactly this, and
  // ending the session alone would still leave them locked out everywhere else.
  const deviceWasRegistered = !!user.registeredDeviceId;
  user.registeredDeviceId = null;
  await user.save();
  logAdminAction(req.user, "FORCE_LOGOUT", user, { revokedCount: result.modifiedCount, deviceReset: deviceWasRegistered });
  res.json({ message: "Active sessions revoked", revokedCount: result.modifiedCount });
}));

// Read-only mock-test visibility. Reuses TestSession/Submission exactly as the student-facing
// routes do — no new collection, no aggregation infrastructure. requireAdmin (applied to the
// whole router above) is the only access check; unlike every /users/:id route, this
// deliberately has no ownership restriction, since an admin inspecting any student's attempt is
// the entire point of the feature.
router.get("/test-sessions", asyncRoute(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.user) filter.user = req.query.user;

  const [sessions, total] = await Promise.all([
    TestSession.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("user", "username name"),
    TestSession.countDocuments(filter)
  ]);

  res.json({
    testSessions: sessions,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  });
}));

router.get("/test-sessions/:id", asyncRoute(async (req, res) => {
  const session = await TestSession.findById(req.params.id).populate("user", "username name email");
  if (!session) return res.status(404).json({ message: "Test session not found", code: "NOT_FOUND" });
  // Same safe-field projection as the student's own detail view (loadSessionResults) — admin
  // access to full question content already exists via the admin question-bank routes, so this
  // view doesn't need to duplicate that exposure to serve its purpose (spotting a failed
  // evaluation, checking a score, confirming a student's attempt happened).
  const results = await loadSessionResults(session._id);
  res.json({ testSession: session, results });
}));

export default router;
