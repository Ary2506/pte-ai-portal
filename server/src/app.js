import express from "express";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import adminQuestionRoutes from "./routes/adminQuestions.js";
import adminMediaRoutes from "./routes/adminMedia.js";
import questionMediaRoutes from "./routes/questionMedia.js";
// Temporary/emergency admin feature — isolated on purpose, see the removal note at the top of
// models/SubscriptionExtension.js for exactly what to delete to remove it later.
import adminSubscriptionExtensionRoutes from "./routes/adminSubscriptionExtension.js";
import questionRoutes from "./routes/questions.js";
import submissionRoutes from "./routes/submissions.js";
import testSessionRoutes from "./routes/testSessions.js";
import dashboardRoutes from "./routes/dashboard.js";

export const app = express();

// Every rate limiter in this app keys on req.ip, which is only meaningful if Express knows how
// many reverse proxies sit in front of it. Behind one (Vercel, nginx, Cloudflare) and without
// this, req.ip is the proxy's own address — identical for every visitor — so the login limiter
// would count the whole world's attempts into a single bucket and lock everyone out after ten.
//
// The count matters and must not be guessed: `true` would trust the entire X-Forwarded-For
// chain, letting a client forge a new "IP" per request by prepending one, which defeats the
// limiter completely. So this is opt-in via TRUST_PROXY_HOPS, set to the number of proxies
// actually in front (1 for Vercel), and stays off for local development where there are none.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

// Express advertises itself in every response by default. It tells an attacker which stack to
// target and gains nothing in return.
app.disable("x-powered-by");

// Security headers.
//
// Written out rather than pulled in via helmet: this is an API returning JSON plus a couple of
// redirects, so it needs four headers, each with a reason. A dependency for that is more supply
// chain than it is worth, and the defaults would need overriding anyway.
app.use((req, res, next) => {
  // Stops a browser from second-guessing Content-Type. Without it a response that an attacker can
  // influence may be sniffed as HTML and executed.
  res.set("X-Content-Type-Options", "nosniff");
  // No page here is ever meant to be framed, so clickjacking has no legitimate use case to break.
  res.set("X-Frame-Options", "DENY");
  // Keeps the API's URLs — which carry record ids — out of the Referer header sent to other sites.
  res.set("Referrer-Policy", "no-referrer");
  // This origin serves JSON and redirects, never a document that should load scripts or be framed.
  // 'none' is the correct default for an API and costs nothing, since nothing here renders HTML.
  res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  // HSTS only where the connection is actually secure. Sent over plain HTTP it is ignored by
  // browsers, and in local development it would pin localhost to https in the developer's browser.
  if (req.secure || req.get("x-forwarded-proto") === "https") {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Mounted first so it covers every response below, including the static question-media mount.
// Every API payload here is JSON — question lists, submission history, AI feedback — which is
// exactly what gzip is best at; audio and images are already-compressed formats and are skipped
// automatically by compression's own content-type filter, so this costs them nothing.
app.use(compression());
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: "2mb" }));
// Rate limited per signed-in user where possible, falling back to IP for anonymous traffic.
//
// Keying purely on IP punishes exactly the deployment this product is sold into: a coaching centre
// where thirty students share one public address looks like one very busy client, and all of them
// get 429s at the same moment. The bearer token identifies the real actor, so an authenticated
// request is counted against that student rather than the building they are sitting in.
//
// Note this still depends on TRUST_PROXY_HOPS being set in production (see above). Without it,
// every request behind the host's proxy carries the proxy's address and anonymous traffic shares
// a single bucket.
app.use(rateLimit({
  windowMs: 60_000,
  max: 180,
  keyGenerator: (req) => {
    const header = req.get("authorization");
    // The token itself, not a decode: this runs before auth middleware, and a stable opaque
    // string is all a counter needs. A forged token still only shares a bucket with itself.
    if (header?.startsWith("Bearer ")) return `t:${header.slice(7, 64)}`;
    return `ip:${req.ip}`;
  },
  // Health checks come from the host's monitor on one address and would otherwise eat the
  // anonymous budget that real sign-in attempts need.
  skip: (req) => req.path === "/api/health"
}));
// Recorded audio is served only through the ownership-checked GET /api/submissions/:id/audio
// route — there is deliberately no public static mount for the private uploads/ directory.
// Admin-authored question media is different: it must be viewable by every student. It used to be
// an express.static mount on server/public/question-media, but a container's disk does not survive
// a deploy, so it now lives in object storage. The URL shape is unchanged, so question rows that
// already store /media/questions/... keep resolving; routes/questionMedia.js explains why this
// route has no auth where the submissions one does.
app.use("/media/questions", questionMediaRoutes);

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
  // A document that fails schema validation is a malformed REQUEST, not a server fault. Reporting
  // it as 500 told the client to retry something that could never succeed, logged a full stack
  // trace for ordinary bad input, and buried real faults in the noise.
  if (err.name === "ValidationError") {
    return res.status(400).json({ message: "Some fields in the request are invalid", code: "VALIDATION_ERROR" });
  }
  // body-parser attaches a real status to its own errors -- 413 for a body over the limit, 415 for
  // an unsupported encoding. Honour it instead of flattening everything to 500; a client that
  // sends too much data needs to know that, not that the server broke.
  if (err.type && typeof err.type === "string" && err.type.startsWith("entity.")) {
    const status = err.status || err.statusCode || 400;
    if (status === 413) {
      return res.status(413).json({ message: "Request body is too large", code: "PAYLOAD_TOO_LARGE" });
    }
    if (status !== 500) {
      return res.status(status).json({ message: "Request body could not be read", code: "VALIDATION_ERROR" });
    }
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
