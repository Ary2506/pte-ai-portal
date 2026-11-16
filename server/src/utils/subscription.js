import { SECTIONS } from "../sections.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS);
}

// ---------------------------------------------------------------------------------------------
// Account-level status. Unchanged in meaning: "can this account sign in and use the app at all".
// With per-section access it reads the account window, which is kept equal to the latest-ending
// section (recomputeAccountDates below) — so it answers "is at least one section active", and
// sign-in, the expiry logout and every admin filter that reads subscriptionEndDate keep working.
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Per-section access.
//
// Each section a student buys has its own window, so two sections bought today and a third bought
// next week expire on their own dates. `sectionAccess` on the User holds one entry per section.
//
// An account that has never been given section data (every account created before this existed,
// and every test fixture) has `sectionAccess` undefined. Such an account is read as holding all
// four sections over its one existing subscription window — exactly the access it had before — so
// nothing changes for it until an admin action writes real section data, and the server can go
// live before the migration (migrateSectionAccess.js) has run.
// ---------------------------------------------------------------------------------------------

/** The sections this user holds, as stored or as implied by a pre-section account's window. */
export function effectiveSectionAccess(user) {
  if (Array.isArray(user.sectionAccess)) return user.sectionAccess;
  if (user.paymentStatus !== "PAID" || !user.subscriptionEndDate) return [];
  return SECTIONS.map(section => ({
    section,
    startDate: user.subscriptionStartDate || null,
    endDate: user.subscriptionEndDate,
    cancelledAt: user.subscriptionCancelledAt || null
  }));
}

/** ACTIVE | EXPIRED | CANCELLED | NOT_PURCHASED for one section. Admins hold every section. */
export function sectionStatus(user, section, now = Date.now()) {
  if (user.role === "admin") return "ACTIVE";
  // Same rule the account status applies: nothing is usable on an unpaid or refunded account,
  // whatever dates it still carries.
  if (user.paymentStatus !== "PAID") return "NOT_PURCHASED";
  const entry = effectiveSectionAccess(user).find(e => e.section === section);
  if (!entry || !entry.endDate) return "NOT_PURCHASED";
  if (new Date(entry.endDate).getTime() > now) return "ACTIVE";
  return entry.cancelledAt ? "CANCELLED" : "EXPIRED";
}

export function canAccessSection(user, section) {
  return sectionStatus(user, section) === "ACTIVE";
}

export function activeSections(user) {
  return SECTIONS.filter(section => canAccessSection(user, section));
}

/** Every section active right now. What a mock test — which samples all four — requires. */
export function isFullAccess(user) {
  return activeSections(user).length === SECTIONS.length;
}

/** One row per section, status computed here so the client never compares dates itself. */
export function sectionSummaries(user) {
  const access = user.role === "admin" ? [] : effectiveSectionAccess(user);
  return SECTIONS.map(section => {
    const entry = access.find(e => e.section === section);
    return {
      section,
      status: sectionStatus(user, section),
      startDate: entry?.startDate || null,
      endDate: entry?.endDate || null
    };
  });
}

/**
 * The sections an admin action applies to when the request does not name any: whatever the user
 * already holds, or all four for an account that holds nothing yet. "Renew" with no sections thus
 * renews a Listening-only student's Listening, and a brand-new account's everything — which is
 * what every one of these endpoints did before sections existed.
 */
export function defaultSections(user) {
  const held = effectiveSectionAccess(user).map(e => e.section);
  return held.length ? SECTIONS.filter(s => held.includes(s)) : [...SECTIONS];
}

// ---------------------------------------------------------------------------------------------
// Writing section access. Every admin path that changes a student's subscription goes through
// these, so the account window can never drift from the sections it summarizes.
// ---------------------------------------------------------------------------------------------

/** Plain copies of the user's current entries, converting a pre-section account on the way. */
function editableAccess(user) {
  return effectiveSectionAccess(user).map(e => ({
    section: e.section,
    startDate: e.startDate || null,
    endDate: e.endDate || null,
    cancelledAt: e.cancelledAt || null
  }));
}

function store(user, access, now) {
  user.sectionAccess = SECTIONS.map(s => access.find(e => e.section === s)).filter(Boolean);
  recomputeAccountDates(user, now);
}

const isActiveAt = (entry, now) => !!entry?.endDate && new Date(entry.endDate).getTime() > now.getTime();

/**
 * Keeps the account window equal to what its sections add up to: it ends when the latest-ending
 * section ends, and it is "cancelled" only if that last section was cancelled rather than ran out.
 * The start is the earliest start among the sections active now (or, once none are, the start of
 * the last one), so a section that lapsed a year ago does not make a current subscription look
 * a year old. An account holding no dated sections is left alone.
 */
export function recomputeAccountDates(user, now = new Date()) {
  const dated = (user.sectionAccess || []).filter(e => e.endDate);
  if (!dated.length) return;
  const latest = dated.reduce((a, b) => (new Date(b.endDate) > new Date(a.endDate) ? b : a));
  const active = dated.filter(e => isActiveAt(e, now));
  const starts = (active.length ? active : [latest]).map(e => e.startDate).filter(Boolean);
  user.subscriptionStartDate = starts.length ? new Date(Math.min(...starts.map(d => new Date(d).getTime()))) : null;
  user.subscriptionEndDate = latest.endDate;
  user.subscriptionCancelledAt = latest.cancelledAt || null;
}

/**
 * A purchase or renewal of `days` for each of `sections`. A section that is still active is
 * extended from its current end, so no paid time is lost; one that has lapsed, was cancelled or
 * was never bought starts again from today. Marks the account paid.
 *
 * @returns {{section: string, previousEndDate: Date|null, endDate: Date}[]}
 */
export function grantSections(user, sections, days, now = new Date()) {
  const access = editableAccess(user);
  const changes = [];
  for (const section of sections) {
    let entry = access.find(e => e.section === section);
    const previousEndDate = entry?.endDate || null;
    if (entry && isActiveAt(entry, now)) {
      entry.endDate = addDays(entry.endDate, days);
    } else {
      if (!entry) { entry = { section }; access.push(entry); }
      entry.startDate = now;
      entry.endDate = addDays(now, days);
    }
    entry.cancelledAt = null;
    changes.push({ section, previousEndDate, endDate: entry.endDate });
  }
  user.paymentStatus = "PAID";
  store(user, access, now);
  return changes;
}

/**
 * Moves the end of each ACTIVE section among `sections` by `days` (negative to revoke). A section
 * that is not active is skipped: extending or revoking is only ever done to live access.
 *
 * @returns the sections actually changed
 */
export function shiftActiveSections(user, sections, days, now = new Date()) {
  const access = editableAccess(user);
  const changed = [];
  for (const entry of access) {
    if (!sections.includes(entry.section) || !isActiveAt(entry, now)) continue;
    entry.endDate = addDays(entry.endDate, days);
    changed.push(entry.section);
  }
  store(user, access, now);
  return changed;
}

/** Whole days left on the shortest of the ACTIVE sections among `sections`, or null if none are. */
export function minRemainingDays(user, sections, now = new Date()) {
  const remaining = effectiveSectionAccess(user)
    .filter(e => sections.includes(e.section) && isActiveAt(e, now))
    .map(e => Math.ceil((new Date(e.endDate).getTime() - now.getTime()) / DAY_MS));
  return remaining.length ? Math.min(...remaining) : null;
}

/** Ends each ACTIVE section among `sections` right now, marked cancelled. Returns those changed. */
export function cancelActiveSections(user, sections, now = new Date()) {
  const access = editableAccess(user);
  const changed = [];
  for (const entry of access) {
    if (!sections.includes(entry.section) || !isActiveAt(entry, now)) continue;
    entry.endDate = now;
    entry.cancelledAt = now;
    changed.push(entry.section);
  }
  store(user, access, now);
  return changed;
}

/**
 * Sets the window of each of `sections` directly — the admin "edit subscription dates" form.
 * Either date may be omitted to keep that end of the window. A section with no entry yet is only
 * created when an end date is given, since a window without an end is not access to anything.
 * A new end date is a new cycle, so it clears any earlier cancellation.
 */
export function setSectionWindow(user, sections, { startDate, endDate }, now = new Date()) {
  const access = editableAccess(user);
  for (const section of sections) {
    let entry = access.find(e => e.section === section);
    if (!entry) {
      if (!endDate) continue;
      entry = { section, startDate: startDate || now, endDate: null, cancelledAt: null };
      access.push(entry);
    }
    if (startDate) entry.startDate = startDate;
    if (endDate) { entry.endDate = endDate; entry.cancelledAt = null; }
  }
  store(user, access, now);
}

/** The section entries as plain objects, for a raw $set that bypasses Mongoose hooks. */
export function plainSectionAccess(user) {
  return (user.sectionAccess || []).map(e => ({
    section: e.section, startDate: e.startDate || null, endDate: e.endDate || null, cancelledAt: e.cancelledAt || null
  }));
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
    sections: sectionSummaries(user),
    targetScore: user.targetScore,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };
}
