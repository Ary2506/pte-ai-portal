import path from "path";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import adminQuestionRoutes from "./routes/adminQuestions.js";
import adminMediaRoutes from "./routes/adminMedia.js";
// Temporary/emergency admin feature — isolated on purpose, see the removal note at the top of
// models/SubscriptionExtension.js for exactly what to delete to remove it later.
import adminSubscriptionExtensionRoutes from "./routes/adminSubscriptionExtension.js";
import questionRoutes from "./routes/questions.js";
import submissionRoutes from "./routes/submissions.js";
import testSessionRoutes from "./routes/testSessions.js";
import dashboardRoutes from "./routes/dashboard.js";

export const app = express();
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 180 }));
// Recorded audio is served only through the ownership-checked GET /api/submissions/:id/audio
// route — there is deliberately no public static mount for the private uploads/ directory.
// Admin-authored question media is different: it must be publicly viewable by every student, so
// it lives in its own directory (server/public/question-media/, written only by the admin-only
// POST /api/admin/media/upload route) with its own public static mount below.
app.use("/media/questions", express.static(path.resolve("public/question-media")));

app.get("/api/health", (_, res) => res.json({ ok: true, service: "pte-core-ai" }));
app.use("/api/auth", authRoutes);
app.use("/api/admin/media", adminMediaRoutes);
app.use("/api/admin/questions", adminQuestionRoutes);
app.use("/api/admin/subscription-extension", adminSubscriptionExtensionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/submissions", submissionRoutes);
app.use("/api/test-sessions", testSessionRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use((err, req, res, next) => {
  if (err.name === "CastError") {
    return res.status(400).json({ message: "Invalid identifier in request", code: "VALIDATION_ERROR" });
  }
  // express.json() sets this exact `type` when the request body isn't valid JSON at all
  // (distinct from a valid JSON request containing a malformed value in one field, which
  // individual routes already handle themselves) — a client mistake, not a server fault.
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body must be valid JSON", code: "VALIDATION_ERROR" });
  }
  console.error(err);
  res.status(500).json({ message: "Unexpected server error", code: "SERVER_ERROR" });
});
