export function getSubscriptionStatus(user) {
  if (user.role === "admin") return "ACTIVE";
  if (user.paymentStatus !== "PAID" || !user.subscriptionEndDate) return "NOT_ACTIVATED";
  return new Date(user.subscriptionEndDate).getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
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
