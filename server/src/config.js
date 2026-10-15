import dotenv from "dotenv";
dotenv.config();

const isTest = process.env.NODE_ENV === "test";

function required(name, { minLength } = {}) {
  const value = process.env[name];
  if (!value || (minLength && value.length < minLength)) {
    console.error(`Missing or invalid required environment variable: ${name}. Set it in server/.env (see .env.example).`);
    if (isTest) throw new Error(`Missing env var ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * A variable with a development default that must still be set explicitly in production.
 *
 * Distinct from required() above, which has no usable default at all. These are the ones where a
 * sensible local fallback masks a missing production value, so the failure arrives later and
 * looks like something else.
 */
function requiredInProduction(name, developmentDefault) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    console.error(`Missing required environment variable in production: ${name}. Refusing to start on the development default.`);
    if (isTest) throw new Error(`Missing env var ${name}`);
    process.exit(1);
  }
  return developmentDefault;
}

export const config = {
  port: Number(process.env.PORT || 5000),
  // The local default is a development convenience. In production it is a trap: an unset
  // MONGODB_URI would quietly point the server at a database that does not exist on that host,
  // and the failure surfaces as a connection error with no hint that the variable was simply
  // missing. JWT_SECRET already refuses to start for the same reason; this now matches it.
  mongoUri: requiredInProduction("MONGODB_URI", "mongodb://127.0.0.1:27017/pte_ai_portal"),
  jwtSecret: required("JWT_SECRET", { minLength: 32 }),
  // Drives the CORS origin. Unset in production, every browser request from the real site is
  // blocked by CORS while the server itself looks perfectly healthy -- one of the hardest
  // deployment faults to diagnose from the symptoms.
  clientUrl: requiredInProduction("CLIENT_URL", "http://localhost:5173"),
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModels: (process.env.OPENAI_MODEL || "llama-3.3-70b-versatile").split(","),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  subscriptionDefaultDays: Number(process.env.SUBSCRIPTION_DEFAULT_DAYS || 30),
  // How many questions each section contributes to a mock test. 20 x 4 sections = 80, close to a
  // real PTE Core sitting. Picking is type-balanced, so a section whose bank is dominated by one
  // task type does not hand out twenty of it — see pickSectionQuestions in routes/testSessions.js.
  mockQuestionsPerSection: Number(process.env.MOCK_QUESTIONS_PER_SECTION || 20),
  // The duration is derived from the number of questions actually picked rather than fixed, so a
  // mock built from a thin bank is not given the same clock as a full one. The old flat 20
  // minutes was sized for a 4-question mock and would be unusable for 80.
  mockMinutesPerQuestion: Number(process.env.MOCK_MINUTES_PER_QUESTION || 1.5),
  // An absolute override. Unset by default — set it to pin the total regardless of question count.
  mockTestDurationMinutes: Number(process.env.MOCK_TEST_DURATION_MINUTES) || null
};
