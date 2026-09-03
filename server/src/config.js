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
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
  subscriptionDefaultDays: Number(process.env.SUBSCRIPTION_DEFAULT_DAYS || 30),
  // Single knob for the compact 4-question mock's total duration — bump this (or add real
  // per-section timing) once the question bank is large enough for a full-length simulation.
  mockTestDurationMinutes: Number(process.env.MOCK_TEST_DURATION_MINUTES || 20)
};
