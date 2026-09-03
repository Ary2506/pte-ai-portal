import { beforeAll, afterEach, afterAll } from "vitest";
import mongoose from "mongoose";
import Submission from "../src/models/Submission.js";

process.env.NODE_ENV = "test";

const TEST_URI = process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017/pte_ai_portal_test";

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
