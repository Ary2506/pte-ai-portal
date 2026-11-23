import mongoose from "mongoose";

// One public link to one speaking submission, created by the submission's owner.
//
// The link carries a random token; only its SHA-256 hash is stored here, so this collection alone
// cannot be turned back into working links. Each link has its own copy of the recording under
// shared-audio/<this _id>/ (storage.js), made when the link is created, because the original
// recording may be removed by its own, shorter retention rule while the link is still valid.
//
// Retention of that copy is an R2 lifecycle rule on the shared-audio/ prefix, configured in the
// Cloudflare dashboard to at least SHARE_LIFETIME_DAYS (35 days is recommended). Nothing in the
// application deletes a shared copy while its link can still be opened.
export const SHARE_LIFETIME_DAYS = 30;
export const SHARE_LIFETIME_MS = SHARE_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
export const SHARED_AUDIO_PREFIX = "shared-audio/";

const shareLinkSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  submission: { type: mongoose.Schema.Types.ObjectId, ref: "Submission", required: true },
  // Hex SHA-256 of the token in the URL. The token itself is never stored.
  tokenHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
  sharedAudioObjectKey: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ["ACTIVE", "REVOKED"], default: "ACTIVE" },
  revokedAt: { type: Date, default: null }
}, { timestamps: true });

shareLinkSchema.index({ tokenHash: 1 }, { unique: true });
shareLinkSchema.index({ submission: 1, status: 1 });
shareLinkSchema.index({ owner: 1, createdAt: -1 });
// Rows are removed 30 days after their link expires. Until then an expired link is reported as
// expired rather than as unknown; the shared audio copy is governed by R2, not by this index.
shareLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: SHARE_LIFETIME_DAYS * 24 * 60 * 60 });

/** ACTIVE, REVOKED or EXPIRED at `now`. Expiry is derived from expiresAt, never stored. */
shareLinkSchema.methods.stateAt = function stateAt(now = new Date()) {
  if (this.status === "REVOKED" || this.revokedAt) return "REVOKED";
  if (this.expiresAt <= now) return "EXPIRED";
  return "ACTIVE";
};

export default mongoose.model("ShareLink", shareLinkSchema);
