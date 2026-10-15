import { beforeAll, afterEach, afterAll } from "vitest";
import mongoose from "mongoose";
import Submission from "../src/models/Submission.js";

process.env.NODE_ENV = "test";

// Force the local-disk storage driver for the whole suite.
//
// src/config.js calls dotenv.config() at import time, and every test imports src/app.js, so
// without this the real server/.env is loaded and src/storage.js comes up pointing at the live
// R2 bucket -- the suite then writes its fixtures into production storage. It already had:
// 44 objects under recordings/ and 11 under question-media/ were 67-68 byte test files.
//
// Empty strings rather than `delete`, because dotenv only sets a key that is not already present
// in process.env; deleting these would let it put the real values straight back. storage.js
// treats an empty value as absent, so isRemoteStorage ends up false.
//
// A test that needs to exercise the R2 driver should assert against whichever driver is
// configured (see test/recordingStorage.test.js) rather than re-enabling these.
// Same reasoning for every other live credential in .env. OPENAI_API_KEY is the expensive one:
// services/ai/evaluator.js only falls back to heuristic scoring when the key is absent, so with
// the real key loaded the suite was calling the paid API on every run -- billed, slow, and
// nondeterministic, which is why tests asserting scoringMethod === "heuristic" were failing with
// "ai". Tests that do want the AI path mock ../src/config.js wholesale and supply their own key,
// so they are unaffected by this.
for (const name of [
  "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_RECORDINGS_BUCKET",
  "OPENAI_API_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"
]) {
  process.env[name] = "";
}

// JWT_SECRET is overridden rather than blanked, because config.js requires at least 32 characters
// and would refuse to load without one. The point is the same: tests were signing their tokens
// with the production secret, so any token left in a log, a snapshot or a CI artifact was a valid
// production credential. This one is obviously fake and valid nowhere.
process.env.JWT_SECRET = "test-only-jwt-secret-not-valid-anywhere-0123456789";

const TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017/pte_ai_portal_test";

// This suite calls dropDatabase() in afterAll and deleteMany() on every collection after every
// single test. That is correct for a scratch database and catastrophic for any other kind, and
// nothing above this line checks which one it is pointed at.
//
// MONGODB_URI in server/.env is a live Atlas cluster. One mistaken copy-paste into
// MONGODB_TEST_URI, and `npx vitest run` would delete production. The cost of being wrong is
// unbounded and unrecoverable, so refuse to start rather than rely on nobody making that mistake.
function assertSafeToDestroy(uri) {
  const reasons = [];
  if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI) {
    reasons.push("it is the same URI as MONGODB_URI");
  }
  // Atlas and other hosted clusters use the SRV scheme; a scratch database does not.
  if (/^mongodb\+srv:\/\//i.test(uri)) reasons.push("it is a hosted (mongodb+srv) cluster");
  // The database name is the last path segment, before any query string.
  const dbName = uri.split("/").pop().split("?")[0];
  if (!/test/i.test(dbName)) reasons.push(`the database name "${dbName}" does not contain "test"`);

  if (reasons.length) {
    throw new Error(
      `Refusing to run the test suite against this database because ${reasons.join(", and ")}.\n` +
      `The suite drops the database it connects to. Point MONGODB_TEST_URI at a local scratch ` +
      `database whose name contains "test", or leave it unset to use the default.`
    );
  }
}
assertSafeToDestroy(TEST_URI);

beforeAll(async () => {
  await mongoose.connect(TEST_URI);
  // Mongoose's autoIndex builds indexes in the background after connect() resolves — it does
  // not block writes on it. Without waiting here, a test that writes to Submission immediately
  // (e.g. asserting the unique testSession+question index rejects a duplicate) can race ahead
  // of index creation and see no constraint at all. Model.init() resolves once its indexes are
  // actually built.
  await Submission.init();
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) await collection.deleteMany({});
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});
