import { app } from "./app.js";
import { connectDb } from "./db.js";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";

await connectDb();

// Development convenience only. The migration/seed chain used to run here unconditionally; it
// now runs on boot solely so `npm run dev` against a fresh local database still comes up ready
// to use. In production it is skipped and applied deliberately with `npm run migrate`, because
// a serverless host re-runs this module on every cold start — see the note in migrate.js.
// Set RUN_MIGRATIONS_ON_BOOT explicitly to override either default.
const runOnBoot = process.env.RUN_MIGRATIONS_ON_BOOT
  ? process.env.RUN_MIGRATIONS_ON_BOOT === "true"
  : process.env.NODE_ENV !== "production";

if (runOnBoot) {
  await runMigrations();
} else {
  console.log("Skipping migrations on boot — run them with `npm run migrate`.");
}

app.listen(config.port, () => console.log(`API running at http://localhost:${config.port}`));
