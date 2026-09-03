import { app } from "./app.js";
import { connectDb } from "./db.js";
import { config } from "./config.js";
import { seedQuestions } from "./seed.js";
import { seedAdmin } from "./seedAdmin.js";
import { migrateLegacyUsers } from "./migrateLegacyUsers.js";
import { migrateQuestions, deactivateLegacyBrokenMedia } from "./migrateQuestions.js";
import { seedPhase18Content } from "./seedPhase18Content.js";
import User from "./models/User.js";

await connectDb();
// Assign a username to any account created before Phase 1 (the old email-based
// signup had none), then rebuild indexes to match the current schema — needed
// because MongoDB does not retroactively convert an existing unique index (e.g.
// the old non-sparse `email` index) when the Mongoose schema changes it to sparse.
await migrateLegacyUsers();
await User.syncIndexes();
await seedQuestions();
// Backfill evaluationType/maxScore on any question seeded before Phase 3.
await migrateQuestions();
// Backfill: deactivate any pre-Phase-18 active question missing media the Phase 18 validation
// now requires (this is exactly how the known broken describe-image/repeat-sentence questions
// stayed active in the first place — see migrateQuestions.js).
await deactivateLegacyBrokenMedia();
// Phase 18: unlike seedQuestions() above (gated on an empty collection, so it can never run
// again against this already-populated database), this seeder re-checks every candidate against
// the database on every boot and only inserts what's genuinely new — safe to run every start.
await seedPhase18Content();
await seedAdmin();

app.listen(config.port, () => console.log(`API running at http://localhost:${config.port}`));
