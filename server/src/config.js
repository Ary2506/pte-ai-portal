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

export const config = {
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pte_ai_portal",
  jwtSecret: required("JWT_SECRET", { minLength: 32 }),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
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
