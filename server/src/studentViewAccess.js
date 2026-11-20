// Who may open Student View (the admin's read-only view of one student's site).
//
// Only the admins whose ids are listed in STUDENT_VIEW_ADMIN_IDS, comma-separated:
//
//   STUDENT_VIEW_ADMIN_IDS=<24-hex id>,<24-hex id>
//
// It fails closed. A missing or empty value, or a list containing anything that is not a 24-hex
// MongoDB ObjectId (a typo, a username, a stray comma), denies Student View to every admin rather
// than guessing what was meant. Being listed is not enough on its own: the account must also be an
// active admin. Checked when a view is opened and again on every request made with it, so removing
// an id (or the admin losing the role) stops views already open.

const OBJECT_ID = /^[0-9a-f]{24}$/i;
let warnedAbout = null;

/** The configured admin ids, or null when the setting is missing, empty or malformed. */
export function studentViewAdminIds() {
  const raw = process.env.STUDENT_VIEW_ADMIN_IDS;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ids = raw.split(",").map((s) => s.trim());
  if (ids.some((id) => !OBJECT_ID.test(id))) {
    if (warnedAbout !== raw) {
      warnedAbout = raw;
      console.warn("[student-view] STUDENT_VIEW_ADMIN_IDS is malformed; Student View is disabled for every admin.");
    }
    return null;
  }
  return new Set(ids.map((id) => id.toLowerCase()));
}

/** Whether this account may open Student View. */
export function isStudentViewAdmin(user) {
  if (user?.role !== "admin" || user.accountStatus !== "ACTIVE") return false;
  const allowed = studentViewAdminIds();
  return Boolean(allowed) && allowed.has(String(user._id).toLowerCase());
}
