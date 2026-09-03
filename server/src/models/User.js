import mongoose from "mongoose";

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
  targetScore: { type: Number, default: 79 },
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

export default mongoose.model("User", userSchema);
