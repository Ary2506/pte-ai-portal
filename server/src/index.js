import { app } from "./app.js";
import { connectDb } from "./db.js";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";
import { assertStorageConfigured } from "./storage.js";

// Checked before anything else: in production a missing R2 configuration would otherwise let the
// server accept recordings, report success, and lose every one of them at the next deploy.
assertStorageConfigured();

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

const server = app.listen(config.port, () => console.log(`API running at http://localhost:${config.port}`));

// ---------------------------------------------------------------- staying up, and going down well
//
// Without the two handlers below, a single rejected promise that no route caught terminates the
// whole process: since Node 15 an unhandled rejection is fatal by default. One student hitting one
// bad code path would take the site down for everyone, and the only trace would be a container
// restart with no explanation.
//
// The two cases are deliberately treated differently.
//
// An unhandled REJECTION is almost always one request's async call that nobody awaited properly.
// The rest of the process is fine, so it is logged loudly and the server keeps serving. Crashing
// every user over one broken request is the worse outcome.
process.on("unhandledRejection", (reason) => {
  console.error("[fatal-guard] unhandled promise rejection — the server is staying up:", reason);
});

// An uncaught EXCEPTION is different: it escaped every try/catch and the process state can no
// longer be trusted, so the honest move is to stop taking new work, let in-flight requests finish,
// and exit non-zero for the host to restart. Staying up on corrupted state risks serving wrong
// data, which is worse than a short restart.
process.on("uncaughtException", (err) => {
  console.error("[fatal-guard] uncaught exception — shutting down:", err);
  shutdown("uncaughtException", 1);
});

// Container hosts send SIGTERM before replacing an instance. Without this the process is killed
// with requests mid-flight and Mongo connections left open; with it, in-flight work completes.
let shuttingDown = false;
function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received — closing the server`);

  // Hard deadline. If a connection refuses to drain, exit anyway rather than hang until the host
  // SIGKILLs us, which would drop those requests with no log at all.
  const deadline = setTimeout(() => {
    console.error("[shutdown] did not finish in 10s — exiting now");
    process.exit(code || 1);
  }, 10_000).unref();

  server.close(async () => {
    clearTimeout(deadline);
    try {
      const mongoose = (await import("mongoose")).default;
      await mongoose.connection.close(false);
    } catch (err) {
      console.error("[shutdown] closing the database connection failed:", err?.message || err);
    }
    console.log("[shutdown] done");
    process.exit(code);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
