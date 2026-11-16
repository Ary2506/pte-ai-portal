import mongoose from "mongoose";
import { SECTIONS } from "../sections.js";
import { recomputeAccountDates } from "../utils/subscription.js";

// One section a student has bought, with its own window — see utils/subscription.js for the
// rules. No _id: an entry is identified by its section, and there is at most one per section.
const sectionAccessSchema = new mongoose.Schema({
  section: { type: String, enum: SECTIONS, required: true },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  cancelledAt: { type: Date, default: null }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  role: { type: String, enum: ["student", "admin"], default: "student" },
  accountStatus: { type: String, enum: ["ACTIVE", "BLOCKED", "SUSPENDED"], default: "ACTIVE" },
  paymentStatus: { type: String, enum: ["PENDING", "PAID", "FAILED", "REFUNDED"], default: "PENDING" },
  paymentId: { type: String, default: null },
  subscriptionStartDate: { type: Date, default: null },
  subscriptionEndDate: { type: Date, default: null },
  // Set only by the admin "Cancel Subscription" action (routes/adminSubscriptionExtension.js) so
  // getSubscriptionStatus() can tell a subscription an admin ended early apart from one that ran
  // out naturally — both leave subscriptionEndDate in the past, but only one should ever be
  // labeled "Cancelled" instead of "Expired". Cleared back to null whenever the subscription is
  // renewed or its dates are changed by an admin (routes/admin.js), so a later, unrelated cycle
  // is never mislabeled from a stale cancellation.
  subscriptionCancelledAt: { type: Date, default: null },
  // Per-section access. Deliberately `default: undefined` rather than Mongoose's usual [] for an
  // array: an account with NO stored value is a pre-section account and is read as holding all four
  // sections over its subscription window above, while an empty array means "holds nothing". The
  // two must stay distinguishable, or every existing student would lose access the moment this
  // field appeared. The subscription dates above are derived from this once it is set — see the
  // pre-save hook below.
  sectionAccess: { type: [sectionAccessSchema], default: undefined },
  targetScore: { type: Number, default: 90 },
  lastLoginAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // The client-generated, per-browser id already sent as X-Device-Id on every request (see
  // client/src/api.js's getDeviceId) — set on this student's first successful sign-in, then
  // compared on every later one. null means "not yet registered" (or, for admin accounts,
  // permanently exempt — see routes/auth.js). Never returned to the student themselves; admin
  // sees only whether it's set, never the raw value (routes/admin.js).
  registeredDeviceId: { type: String, default: null },
  // Daily learning-streak state (see utils/streak.js — the only place these are written).
  // lastLearningDate is a "YYYY-MM-DD" calendar-day string in UTC (this portal's chosen,
  // documented streak timezone — see utils/streak.js), never a Date, so day-equality is a plain
  // string comparison with no time-of-day or timezone-offset ambiguity.
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastLearningDate: { type: String, default: null }
}, { timestamps: true });

userSchema.index({ email: 1 }, { unique: true, sparse: true });

// The account window is a summary of the sections, so whenever the sections change it is
// recomputed from them. The admin routes already do this through the helpers in
// utils/subscription.js; this is the backstop for any write that changes sectionAccess without
// going through one. Only on a change to the sections, so an unrelated save (a login timestamp)
// never moves the dates. Raw updates (updateOne/bulkWrite) bypass this hook and must set the
// account dates themselves — routes/adminSubscriptionExtension.js's bulk extension does.
userSchema.pre("save", function syncAccountWindow(next) {
  if (Array.isArray(this.sectionAccess) && this.sectionAccess.length && this.isModified("sectionAccess")) {
    recomputeAccountDates(this);
  }
  next();
});

export default mongoose.model("User", userSchema);
