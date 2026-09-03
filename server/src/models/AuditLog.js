import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema({
  adminUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  action: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now }
});

auditLogSchema.index({ createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
