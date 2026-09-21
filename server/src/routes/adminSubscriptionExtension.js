import express from "express";
import User from "../models/User.js";
import { SubscriptionExtension, BulkExtensionRequest, nextExtensionId } from "../models/SubscriptionExtension.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getSubscriptionStatus, publicUser } from "../utils/subscription.js";
import { logAdminAction } from "../utils/audit.js";
import { asyncRoute } from "../utils/asyncRoute.js";

// Temporary/emergency Admin Subscription Extension feature — deliberately isolated in its own
// route file (see the comment at the top of models/SubscriptionExtension.js for the full removal
// steps). Every route here is admin-only and re-checks subscription eligibility itself; it never
// trusts a status the frontend already displayed. Nothing here changes login, purchase/payment,
// existing renew/setSubscription behavior, or how subscription status is computed anywhere else —
// it only ever writes `subscriptionEndDate` on an already-active subscription, via the same
// addDays arithmetic routes/admin.js already uses for /renew.

const router = express.Router();
router.use(requireAuth, requireAdmin);

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// A currently-active subscription, defined identically to getSubscriptionStatus()'s "ACTIVE"
// branch (role !== admin is implicit — students are the only role subscriptions apply to) so the
// bulk query can never disagree with what the rest of the app considers "active".
function activeSubscriptionFilter() {
  return { role: "student", paymentStatus: "PAID", subscriptionEndDate: { $gt: new Date() } };
}

function validateDaysAndReason(body) {
  const days = Number(body.days);
  if (!Number.isInteger(days) || days <= 0) {
    return { error: "Extra days must be a positive whole number." };
  }
  const reason = (body.reason || "").trim();
  if (!reason) {
    return { error: "A reason is required." };
  }
  return { days, reason };
}

// ---------------------------------------------------------------------------
// Individual extension — only ever applies to a user whose subscription is active right now,
// re-checked server-side regardless of what the admin's screen showed a moment ago.
// ---------------------------------------------------------------------------
router.post("/users/:id", asyncRoute(async (req, res) => {
  const { error, days, reason } = validateDaysAndReason(req.body);
  if (error) return res.status(400).json({ message: error, code: "VALIDATION_ERROR" });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "User not found", code: "NOT_FOUND" });

  if (getSubscriptionStatus(user) !== "ACTIVE") {
    return res.status(409).json({
      message: "This user does not currently have an active subscription to extend.",
      code: "SUBSCRIPTION_NOT_ACTIVE"
    });
  }

  const previousExpiry = user.subscriptionEndDate;
  const newExpiry = addDays(previousExpiry, days);
  user.subscriptionEndDate = newExpiry;
  await user.save();

  const extensionId = await nextExtensionId();
  await SubscriptionExtension.create({
    extensionId, type: "INDIVIDUAL", user: user._id,
    previousExpiry, daysAdded: days, newExpiry, reason, performedBy: req.user._id
  });

  logAdminAction(req.user, "SUBSCRIPTION_EXTENDED", user, { extensionId, days, reason, previousExpiry, newExpiry });
  res.json({ success: true, user: publicUser(user), extensionId, previousExpiry, newExpiry, daysAdded: days });
}));

// ---------------------------------------------------------------------------
// Bulk preview — read-only, no writes, safe to call repeatedly while an admin adjusts the days
// field. Eligibility is computed with the exact same filter the confirm step will use.
// ---------------------------------------------------------------------------
router.post("/bulk/preview", asyncRoute(async (req, res) => {
  const days = Number(req.body.days);
  if (!Number.isInteger(days) || days <= 0) {
    return res.status(400).json({ message: "Extra days must be a positive whole number.", code: "VALIDATION_ERROR" });
  }

  const eligible = await User.find(activeSubscriptionFilter()).select("username name subscriptionEndDate").sort({ subscriptionEndDate: 1 }).limit(5);
  const affectedUsers = await User.countDocuments(activeSubscriptionFilter());

  res.json({
    affectedUsers,
    days,
    sample: eligible.map(u => ({
      username: u.username,
      name: u.name,
      previousExpiry: u.subscriptionEndDate,
      newExpiry: addDays(u.subscriptionEndDate, days)
    }))
  });
}));

// ---------------------------------------------------------------------------
// Bulk confirm — the only route in this file that writes to more than one user. Standalone
// MongoDB here has no replica set (checked live — replSetGetStatus fails with "not running with
// --replSet"), so multi-document ACID transactions aren't available; each user's update is still
// individually atomic (MongoDB always guarantees single-document atomicity), and the
// BulkExtensionRequest unique-index claim below is what protects against a double-submit
// re-running this whole loop, not a cross-document transaction.
// ---------------------------------------------------------------------------
router.post("/bulk", asyncRoute(async (req, res) => {
  const { error, days, reason } = validateDaysAndReason(req.body);
  if (error) return res.status(400).json({ message: error, code: "VALIDATION_ERROR" });

  const clientRequestId = (req.body.clientRequestId || "").trim();
  if (!clientRequestId) {
    return res.status(400).json({ message: "Missing request id.", code: "VALIDATION_ERROR" });
  }

  let claim;
  try {
    claim = await BulkExtensionRequest.create({ clientRequestId, days, reason, performedBy: req.user._id });
  } catch (e) {
    if (e.code === 11000) {
      const existing = await BulkExtensionRequest.findOne({ clientRequestId });
      return res.json({
        success: true, affectedUsers: existing.affectedUsers, daysAdded: existing.days,
        extensionId: existing.extensionId, duplicate: true
      });
    }
    throw e;
  }

  const eligible = await User.find(activeSubscriptionFilter()).select("subscriptionEndDate");
  const extensionId = await nextExtensionId();

  const bulkOps = eligible.map(u => {
    const previousExpiry = u.subscriptionEndDate;
    const newExpiry = addDays(previousExpiry, days);
    return {
      updateOne: {
        // Re-checks the exact expiry this read saw, so a user who somehow changed between the
        // find() and this write is left untouched rather than double-extended.
        filter: { _id: u._id, subscriptionEndDate: previousExpiry },
        update: { $set: { subscriptionEndDate: newExpiry } }
      }
    };
  });

  const result = bulkOps.length ? await User.bulkWrite(bulkOps) : { modifiedCount: 0 };
  const affectedUsers = result.modifiedCount;

  if (affectedUsers) {
    const historyDocs = eligible.map(u => ({
      extensionId, type: "BULK", user: u._id,
      previousExpiry: u.subscriptionEndDate, daysAdded: days,
      newExpiry: addDays(u.subscriptionEndDate, days), reason, performedBy: req.user._id
    }));
    await SubscriptionExtension.insertMany(historyDocs);
  }

  claim.extensionId = extensionId;
  claim.affectedUsers = affectedUsers;
  await claim.save();

  logAdminAction(req.user, "SUBSCRIPTION_BULK_EXTENDED", null, { extensionId, days, reason, affectedUsers });
  res.json({ success: true, affectedUsers, daysAdded: days, extensionId });
}));

// ---------------------------------------------------------------------------
// History — read-only, for verifying this feature and for a possible future UI. Not wired into
// any admin page yet (Step 8's UI only asked for the two action buttons), but the data it reads
// is exactly what Step 5 requires be stored.
// ---------------------------------------------------------------------------
router.get("/history", asyncRoute(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const filter = {};
  if (req.query.userId) filter.user = req.query.userId;
  if (req.query.extensionId) filter.extensionId = req.query.extensionId;

  const rows = await SubscriptionExtension.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("user", "username name")
    .populate("performedBy", "username name");

  res.json({
    history: rows.map(r => ({
      id: r._id,
      extensionId: r.extensionId,
      type: r.type,
      user: r.user ? { id: r.user._id, username: r.user.username, name: r.user.name } : null,
      previousExpiry: r.previousExpiry,
      daysAdded: r.daysAdded,
      newExpiry: r.newExpiry,
      reason: r.reason,
      performedBy: r.performedBy ? { username: r.performedBy.username, name: r.performedBy.name } : null,
      createdAt: r.createdAt
    }))
  });
}));

export default router;
