import User from "./models/User.js";

// One-time, idempotent migration for accounts created before Phase 1 (username-based
// login, admin-only accounts). Those older documents have no `username`, which the
// new unique index requires. Assigns each one a derived, unique username instead of
// discarding the account.
export async function migrateLegacyUsers() {
  const legacy = await User.find({ $or: [{ username: null }, { username: { $exists: false } }] });
  for (const user of legacy) {
    let base = (user.email?.split("@")[0] || user.name || "user")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (!base) base = "user";
    let candidate = base;
    let suffix = 1;
    while (await User.findOne({ username: candidate, _id: { $ne: user._id } })) {
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
    user.username = candidate;
    if (!user.accountStatus) user.accountStatus = "ACTIVE";
    if (!user.paymentStatus) user.paymentStatus = "PENDING";
    await user.save();
    console.log(`Migrated legacy account "${user.name}" -> username "${candidate}" (no password change; ask the administrator to reset it)`);
  }
}
