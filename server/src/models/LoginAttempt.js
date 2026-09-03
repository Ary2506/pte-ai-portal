import mongoose from "mongoose";

// A small, purpose-built model rather than reusing AuditLog: AuditLog.adminUser is required,
// since that model exists specifically for "what did an admin do to a user account" — a login
// attempt has no admin actor at all, so retrofitting it would mean relaxing a constraint every
// existing consumer (logAdminAction, GET /admin/audit-log) already depends on, for a genuinely
// different concern (an authentication event, not an admin action).
const loginAttemptSchema = new mongoose.Schema({
  // Set only when a real account was matched (even if the attempt then failed for another
  // reason — wrong password, device mismatch, blocked, etc.). Left null when the username
  // itself doesn't exist, so this can never be used to reconstruct which usernames are real —
  // it mirrors exactly what the signin response itself already reveals (or doesn't).
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  success: { type: Boolean, required: true },
  // The exact `code` the signin response itself already returns for this outcome — no finer
  // categorization than what the student-facing API already exposes.
  reason: { type: String, required: true },
  // Already collected elsewhere for a successful login (Session.deviceId/ipAddress) — not a new
  // category of sensitive information, just recorded here too for a rejected attempt.
  deviceId: { type: String, default: null },
  ipAddress: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

loginAttemptSchema.index({ user: 1, createdAt: -1 });
// Auto-expires after 30 days — the same TTL-index retention pattern already used for Session
// (models/Session.js), so this never grows unbounded without a cron job or background worker.
loginAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model("LoginAttempt", loginAttemptSchema);
