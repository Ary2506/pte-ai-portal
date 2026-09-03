import bcrypt from "bcryptjs";
import User from "../src/models/User.js";
import Question from "../src/models/Question.js";

export async function createUser(overrides = {}) {
  const passwordHash = await bcrypt.hash(overrides.password || "password123", 12);
  const now = new Date();
  return User.create({
    username: overrides.username || `student${Date.now()}${Math.floor(Math.random() * 1000)}`,
    name: overrides.name || "Test Student",
    passwordHash,
    role: overrides.role || "student",
    accountStatus: overrides.accountStatus || "ACTIVE",
    paymentStatus: overrides.paymentStatus ?? "PAID",
    subscriptionStartDate: overrides.subscriptionStartDate === undefined ? now : overrides.subscriptionStartDate,
    subscriptionEndDate:
      overrides.subscriptionEndDate === undefined
        ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        : overrides.subscriptionEndDate
  });
}

export async function createAdmin(overrides = {}) {
  return createUser({ role: "admin", paymentStatus: "PAID", ...overrides });
}

export async function createQuestion(overrides = {}) {
  return Question.create({
    section: overrides.section || "reading",
    type: overrides.type || "mcq-single",
    title: overrides.title || "Test question",
    prompt: overrides.prompt || "Choose the best answer.",
    options: overrides.options,
    answer: overrides.answer,
    explanation: overrides.explanation || "Because the passage says so.",
    evaluationType: overrides.evaluationType || "objective",
    maxScore: overrides.maxScore,
    active: overrides.active === undefined ? true : overrides.active
  });
}
