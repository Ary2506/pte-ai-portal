// Real, calendar-based daily learning streak. Deliberately small: three fields already added to
// User (currentStreak, longestStreak, lastLearningDate) are the entire data model — no new
// collection, no per-activity log, no analytics infrastructure.
//
// Timezone strategy: this project has no per-user timezone system anywhere (checked before
// adding one — see Phase 16 report). Every other date in this codebase (Session.expiresAt,
// LoginAttempt's TTL, TestSession timing) is already stored and compared as a UTC instant, so a
// student's "calendar day" here is defined the same way: the UTC calendar date, resetting at
// 00:00 UTC. This is a simple, consistent, honestly-documented choice, not a guess at any
// particular student's real timezone — the alternative (guessing IST, or building a per-user
// timezone system) would be exactly the "large timezone architecture" this feature should avoid.

// "YYYY-MM-DD" in UTC — the sole unit streak logic compares. Never a Date object, so two calls on
// the same UTC day are always trivially string-equal regardless of time-of-day.
export function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(earlier, later) {
  const a = Date.parse(`${earlier}T00:00:00.000Z`);
  const b = Date.parse(`${later}T00:00:00.000Z`);
  return Math.round((b - a) / 86400000);
}

// Called once per qualifying learning event (a successfully-created Submission, or a mock test
// reaching COMPLETED — see routes/submissions.js and routes/testSessions.js; never on login,
// dashboard views, or a rejected/invalid request, since those routes never call this at all).
// Idempotent within a single UTC day: a second call on the same day is a same-day no-op, which is
// what naturally collapses "practice, practice, mock, practice" on one day into a single credit —
// there is no separate de-duplication step because none is needed.
export async function recordLearningActivity(user) {
  const today = utcDateString();
  if (user.lastLearningDate === today) return user;

  const gap = user.lastLearningDate ? daysBetween(user.lastLearningDate, today) : null;
  user.currentStreak = gap === 1 ? user.currentStreak + 1 : 1;
  user.lastLearningDate = today;
  user.longestStreak = Math.max(user.longestStreak || 0, user.currentStreak);
  await user.save();
  return user;
}

export function getStreakInfo(user) {
  return {
    currentStreak: user.currentStreak || 0,
    longestStreak: user.longestStreak || 0,
    lastLearningDate: user.lastLearningDate || null,
    learnedToday: user.lastLearningDate === utcDateString()
  };
}
