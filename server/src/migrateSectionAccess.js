import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import User from "./models/User.js";
import { effectiveSectionAccess } from "./utils/subscription.js";

// Gives every existing student explicit per-section access equal to what they already have.
//
// Before per-section access, a student had one subscription window covering everything. An account
// with no `sectionAccess` stored is still read that way (see effectiveSectionAccess), so this is not
// needed for anyone to keep working — the server is correct before and after it runs. It writes the
// implied sections down so the data says what the code assumes:
//
//   paid, with a subscription end date  -> all four sections, on that same start/end/cancellation
//   never activated, unpaid, refunded   -> no sections ([])
//
// Only `sectionAccess` is written. The subscription dates are left exactly as they are, and since
// four sections sharing one window add back up to that same window, nobody's access, expiry or
// status changes. Admin accounts are skipped: they hold every section by role, not by purchase.
//
//   node src/migrateSectionAccess.js [--write]
//
// Dry run by default. Safe to re-run: only accounts that have no `sectionAccess` at all are
// touched, so a second run finds nothing to do.

export async function migrateSectionAccess({ write = false, log = console.log } = {}) {
  const pending = await User.find({ role: { $ne: "admin" }, sectionAccess: { $exists: false } })
    .select("username paymentStatus subscriptionStartDate subscriptionEndDate subscriptionCancelledAt")
    .lean();

  let withSections = 0;
  let withoutSections = 0;
  const ops = pending.map(user => {
    const access = effectiveSectionAccess(user).map(e => ({
      section: e.section, startDate: e.startDate || null, endDate: e.endDate || null, cancelledAt: e.cancelledAt || null
    }));
    if (access.length) withSections += 1; else withoutSections += 1;
    return {
      updateOne: {
        // Re-checked at write time, so an account an admin converted between the read and the write
        // is left alone rather than overwritten with the stale implied value.
        filter: { _id: user._id, sectionAccess: { $exists: false } },
        update: { $set: { sectionAccess: access } }
      }
    };
  });

  log(`${pending.length} account(s) without section data: ${withSections} get all four sections, ${withoutSections} get none.`);
  if (!write) {
    log("Dry run — nothing written. Re-run with --write to apply.");
    return { pending: pending.length, withSections, withoutSections, written: 0 };
  }
  const result = ops.length ? await User.bulkWrite(ops) : { modifiedCount: 0 };
  log(`Wrote section data to ${result.modifiedCount} account(s).`);
  return { pending: pending.length, withSections, withoutSections, written: result.modifiedCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  connectDb()
    .then(() => migrateSectionAccess({ write: process.argv.includes("--write") }))
    .then(() => process.exit(0))
    .catch(error => {
      console.error("Migration failed:", error.message);
      process.exit(1);
    });
}
