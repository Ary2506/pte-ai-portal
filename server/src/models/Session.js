import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  deviceId: { type: String, default: null },
  userAgent: { type: String, default: null },
  ipAddress: { type: String, default: null },
  lastActiveAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });

// MongoDB removes a session once `expiresAt` is in the past (checked ~every 60s), including
// already-revoked ones (they keep their original 7-day expiresAt). This is purely storage
// cleanup — requireAuth already rejects an expired or revoked session before this ever runs.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Session", sessionSchema);
