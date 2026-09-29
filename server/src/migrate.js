import { pathToFileURL } from "url";
import { connectDb } from "./db.js";
import { seedQuestions } from "./seed.js";
import { seedAdmin } from "./seedAdmin.js";
import { migrateLegacyUsers } from "./migrateLegacyUsers.js";
import { migrateQuestions, deactivateLegacyBrokenMedia } from "./migrateQuestions.js";
import User from "./models/User.js";

// The one-off schema/content work that used to run inline in index.js before app.listen().
//
// It lives here because that arrangement assumes a process that boots once and then serves
// traffic for days. On a serverless host there is no boot: every cold start runs the whole
// module again, so this chain would re-run on each one — repeatedly issuing syncIndexes and
// re-scanning the question bank, against a shared-tier cluster with a limited operations
// budget, while the request that triggered the cold start waits for all of it.
//
// Every step is already idempotent (that is what makes running it on each boot survivable
// today), so running it twice is safe — it is the cost, not the correctness, that matters.
export async function runMigrations() {
  // Assign a username to any account created before Phase 1 (the old email-based signup had
  // none), then rebuild indexes to match the current schema — needed because MongoDB does not
  // retroactively convert an existing unique index (e.g. the old non-sparse `email` index) when
  // the Mongoose schema changes it to sparse.
  await migrateLegacyUsers();
  await User.syncIndexes();
  await seedQuestions();
  // Backfill evaluationType/maxScore on any question seeded before Phase 3.
  await migrateQuestions();
  // Backfill: deactivate any pre-Phase-18 active question missing media the Phase 18 validation
  // now requires (this is exactly how the known broken describe-image/repeat-sentence questions
  // stayed active in the first place — see migrateQuestions.js).
  await deactivateLegacyBrokenMedia();
  // Phase 18 content seeding stays disabled, exactly as it was in index.js before this moved.
  // Unlike seedQuestions() above (gated on an empty collection, so it can never run again
  // against this already-populated database), that seeder re-checks every candidate against the
  // database and inserts only what is genuinely new — so it is safe to re-enable when wanted:
  //   import { seedPhase18Content } from "./seedPhase18Content.js";
  //   await seedPhase18Content();
  await seedAdmin();
}

// Run standalone via `npm run migrate` — the intended way to apply this against a deployed
// database, since nothing runs it automatically once NODE_ENV is production. Comparing the
// module's own URL against the entry point is exact, unlike matching on the filename: it does
// not fire when index.js imports runMigrations, and it handles Windows paths, which are not
// URLs and so never compare equal to import.meta.url directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await connectDb();
  await runMigrations();
  console.log("Migrations and seeding complete.");
  process.exit(0);
}
