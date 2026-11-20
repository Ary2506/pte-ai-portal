import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Session from "../models/Session.js";
import AuditLog from "../models/AuditLog.js";
import StudentViewSession from "../models/StudentViewSession.js";
import TestSession from "../models/TestSession.js";
import LoginAttempt from "../models/LoginAttempt.js";
import SectionPurchase from "../models/SectionPurchase.js";
import jwt from "jsonwebtoken";
import { requireAuth, requireAdmin, isStudentViewAdmin, STUDENT_VIEW_KIND, STUDENT_VIEW_TTL_SECONDS } from "../middleware/auth.js";
import { publicUser, grantSections, setSectionWindow, defaultSections } from "../utils/subscription.js";
import { SECTIONS, parseSections } from "../sections.js";
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

// The longest single grant an admin can make. Past about 100,000,000 days a Date overflows and
// becomes Invalid; no real purchase is anywhere near this. Same cap the extension routes use.
const MAX_GRANT_DAYS = 3650;

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
  // Paged the same way GET /users is. `page` is additive: a caller that sends only `limit` (as
  // the dashboard did before this) still gets the newest `limit` entries, exactly as before —
  // the extra total/page/totalPages fields in the response are ignored by such a caller.
  const page = Math.max(1, Number(req.query.page) || 1);

  const [logs, total] = await Promise.all([
    AuditLog.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("adminUser", "username name")
      .populate("targetUser", "username name")
      // Read-only: every document is reshaped into a plain response object below, and nothing
      // calls a document method or .save() on one.
      .lean(),
    AuditLog.countDocuments({})
  ]);

  res.json({
    logs: logs.map(l => ({
      id: l._id,
      action: l.action,
      admin: l.adminUser ? { username: l.adminUser.username, name: l.adminUser.name } : null,
      target: l.targetUser ? { username: l.targetUser.username, name: l.targetUser.name } : null,
      // Defaulted here because this query is .lean(): Mongoose applies the schema default {}
      // when it hydrates a document, but lean returns the raw record, so a log written without
      // metadata arrives as undefined and every caller reading log.metadata.x throws.
      metadata: l.metadata ?? {},
      createdAt: l.createdAt
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  });
}));

router.post("/users", asyncRoute(async (req, res) => {
  try {
    const { username, name, email, password, paymentStatus, subscriptionDays } = req.body;
    if (!username?.trim() || !name?.trim()) {
      return res.status(400).json({ message: "User ID and name are required", code: "VALIDATION_ERROR" });
    }
    // Which sections a paid account starts with. Omitted means all four, which is what every
    // account got before sections could be bought separately, so an older client creates the same
    // account it always did.
    const parsed = parseSections(req.body.sections);
    if (parsed.error) return res.status(400).json({ message: parsed.error, code: "VALIDATION_ERROR" });
    const sections = parsed.sections || [...SECTIONS];
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

    const user = new User({
      username: normalized,
      name: name.trim(),
      email: email?.trim() ? email.trim().toLowerCase() : undefined,
      passwordHash,
      paymentStatus: "PENDING",
      createdBy: req.user._id
    });
    // A paid account is granted its sections, which also sets its subscription window and marks
    // it PAID. An unpaid one gets nothing yet: its sections are granted once it is paid for.
    const results = activate ? grantSections(user, sections, days, now) : null;
    await user.save();
    if (activate) {
      await SectionPurchase.create({ user: user._id, sections, days, kind: "CREATE", results, grantedBy: req.user._id });
    }

    logAdminAction(req.user, "USER_CREATED", user, {
      paymentStatus: user.paymentStatus,
      subscriptionDays: activate ? days : null,
      sections: activate ? sections : null
    });
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

// Student Website View: a read-only pass to see the student-facing site as one student sees it.
//
// Not a login as the student. The pass is a separate token (kind "student-view") that the API
// accepts for GET requests only (middleware/auth.js), tied to this admin's own session and to one
// student, and short-lived. No session is created for the student, so their own sign-in, token,
// password and account are untouched, and they can keep using the site at the same time.
router.post("/users/:id/view-session", asyncRoute(async (req, res) => {
  if (!isStudentViewAdmin(req.user)) {
    return res.status(403).json({ message: "This admin account is not allowed to open student views.", code: "FORBIDDEN" });
  }
  const student = await User.findById(req.params.id).select("-passwordHash");
  if (!student || student.role !== "student") {
    return res.status(404).json({ message: "Student not found", code: "NOT_FOUND" });
  }
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + STUDENT_VIEW_TTL_SECONDS * 1000);
  // The pass names this record, so the view can be ended for good before the pass expires
  // (POST /api/student-view/end) without touching the student or any other view.
  const view = await StudentViewSession.create({
    admin: req.user._id, student: student._id, adminSession: req.session._id, startedAt, expiresAt
  });
  const token = jwt.sign(
    { kind: STUDENT_VIEW_KIND, viewId: String(view._id), studentId: String(student._id), adminId: String(req.user._id), adminSessionId: String(req.session._id) },
    config.jwtSecret,
    { expiresIn: STUDENT_VIEW_TTL_SECONDS }
  );
  logAdminAction(req.user, "STUDENT_VIEW_STARTED", student, { viewId: String(view._id), username: student.username, startedAt });
  res.json({ token, expiresAt, student: publicUser(student) });
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

  const parsed = parseSections(req.body.sections);
  if (parsed.error) return res.status(400).json({ message: parsed.error, code: "VALIDATION_ERROR" });

  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });

  const nextStart = subscriptionStartDate ? new Date(subscriptionStartDate) : target.subscriptionStartDate;
  const nextEnd = subscriptionEndDate ? new Date(subscriptionEndDate) : target.subscriptionEndDate;
  if (nextStart && nextEnd && nextEnd <= nextStart) {
    return res.status(400).json({ message: "Expiry date must be after the start date", code: "VALIDATION_ERROR" });
  }

  const update = {};
  // Payment status first: whether the account is paid decides which sections it is read as
  // holding when its dates are written below.
  if (paymentStatus) { target.paymentStatus = paymentStatus; update.paymentStatus = paymentStatus; }
  if (subscriptionStartDate || subscriptionEndDate) {
    // The dates are written onto sections (the ones named, or by default all the account holds)
    // and the account window is recomputed from them. A new end date is a new cycle and clears
    // any earlier cancellation, as it always has.
    const sections = parsed.sections || defaultSections(target);
    setSectionWindow(target, sections, {
      startDate: subscriptionStartDate ? new Date(subscriptionStartDate) : null,
      endDate: subscriptionEndDate ? new Date(subscriptionEndDate) : null
    });
    if (subscriptionStartDate) update.subscriptionStartDate = new Date(subscriptionStartDate);
    if (subscriptionEndDate) update.subscriptionEndDate = new Date(subscriptionEndDate);
    update.sections = sections;
  }
  if (paymentId !== undefined) { target.paymentId = paymentId; update.paymentId = paymentId; }

  await target.save();
  logAdminAction(req.user, "SUBSCRIPTION_CHANGED", target, update);
  res.json({ user: publicUser(target) });
}));

router.post("/users/:id/renew", asyncRoute(async (req, res) => {
  const days = Number(req.body.days) > 0 ? Number(req.body.days) : config.subscriptionDefaultDays;
  const parsed = parseSections(req.body.sections);
  if (parsed.error) return res.status(400).json({ message: parsed.error, code: "VALIDATION_ERROR" });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  // Renews the sections named, or by default every section the account holds (all four for one
  // that holds none). Per section: still active extends from its current expiry so no time is
  // lost; lapsed or never bought starts from now; any earlier cancellation is cleared.
  const sections = parsed.sections || defaultSections(user);
  const results = grantSections(user, sections, days);
  await user.save();
  await SectionPurchase.create({ user: user._id, sections, days, kind: "RENEW", results, grantedBy: req.user._id });
  logAdminAction(req.user, "SUBSCRIPTION_RENEWED", user, { days, sections, newEndDate: user.subscriptionEndDate });
  res.json({ user: publicUser(user) });
}));

// ---------------------------------------------------------------------------------------------
// Section purchases. "Add purchase" grants `days` of each named section: a section still active
// is extended from its own expiry, and one that has lapsed or was never bought starts today, so
// sections bought at different times each run out on their own date. Every purchase is also
// recorded in SectionPurchase, the permanent history of what was granted.
// ---------------------------------------------------------------------------------------------
router.post("/users/:id/purchases", asyncRoute(async (req, res) => {
  const parsed = parseSections(req.body.sections);
  if (parsed.error || !parsed.sections) {
    return res.status(400).json({ message: parsed.error || "Choose at least one section.", code: "VALIDATION_ERROR" });
  }
  const days = req.body.days === undefined ? config.subscriptionDefaultDays : Number(req.body.days);
  if (!Number.isInteger(days) || days <= 0 || days > MAX_GRANT_DAYS) {
    return res.status(400).json({ message: `Days must be a whole number between 1 and ${MAX_GRANT_DAYS}.`, code: "VALIDATION_ERROR" });
  }
  const paymentId = typeof req.body.paymentId === "string" && req.body.paymentId.trim() ? req.body.paymentId.trim().slice(0, 200) : null;
  const note = typeof req.body.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  if (user.role === "admin") {
    return res.status(400).json({ message: "Admin accounts have every section already.", code: "CANNOT_MODIFY_ADMIN" });
  }

  const results = grantSections(user, parsed.sections, days);
  if (paymentId) user.paymentId = paymentId;
  await user.save();
  const purchase = await SectionPurchase.create({
    user: user._id, sections: parsed.sections, days, kind: "PURCHASE", paymentId, note, results, grantedBy: req.user._id
  });

  logAdminAction(req.user, "SECTION_PURCHASED", user, { sections: parsed.sections, days, paymentId, results });
  res.status(201).json({ user: publicUser(user), purchase: publicPurchase(purchase) });
}));

router.get("/users/:id/purchases", asyncRoute(async (req, res) => {
  const user = await User.findById(req.params.id).select("_id");
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });
  const purchases = await SectionPurchase.find({ user: user._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("grantedBy", "username name")
    .lean();
  res.json({ purchases: purchases.map(publicPurchase) });
}));

function publicPurchase(p) {
  return {
    id: p._id,
    kind: p.kind,
    sections: p.sections,
    days: p.days,
    paymentId: p.paymentId || null,
    note: p.note || null,
    results: (p.results || []).map(r => ({ section: r.section, previousEndDate: r.previousEndDate || null, endDate: r.endDate })),
    grantedBy: p.grantedBy && p.grantedBy.username ? { username: p.grantedBy.username, name: p.grantedBy.name } : null,
    createdAt: p.createdAt
  };
}

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
