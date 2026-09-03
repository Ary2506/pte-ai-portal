import AuditLog from "../models/AuditLog.js";

// Fire-and-forget: an audit-log write must never fail or delay the admin action it describes.
// `metadata` must never contain a password, token, or hash.
export function logAdminAction(adminUser, action, targetUser, metadata = {}) {
  AuditLog.create({ adminUser: adminUser._id, targetUser: targetUser?._id || targetUser || null, action, metadata }).catch(
    (err) => console.error("Audit log write failed:", err.message)
  );
}
