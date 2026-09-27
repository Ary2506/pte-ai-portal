export function getSubscriptionStatus(user) {
  if (user.role === "admin") return "ACTIVE";
  if (user.paymentStatus !== "PAID" || !user.subscriptionEndDate) return "NOT_ACTIVATED";
  if (new Date(user.subscriptionEndDate).getTime() > Date.now()) return "ACTIVE";
  // Same "not usable right now" outcome as a natural expiry — only the label differs, so an
  // admin can tell the two apart. Treated identically everywhere access is actually gated (see
  // requireActiveSubscription and the /auth/signin check, both of which block EXPIRED and
  // CANCELLED the same way).
  return user.subscriptionCancelledAt ? "CANCELLED" : "EXPIRED";
}

export function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    name: user.name,
    email: user.email || null,
    role: user.role,
    accountStatus: user.accountStatus,
    paymentStatus: user.paymentStatus,
    subscriptionStartDate: user.subscriptionStartDate,
    subscriptionEndDate: user.subscriptionEndDate,
    subscriptionStatus: getSubscriptionStatus(user),
    targetScore: user.targetScore,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };
}
