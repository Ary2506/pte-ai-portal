import { SHARE_TOKEN_PATTERN, metaTags, shareMeta, withShareMeta } from "./_shareMeta.js";

// Vercel serverless function behind /shared-answer/:token (see the rewrite in vercel.json).
//
// It returns the site's normal index.html with preview tags for that one report in <head>, so a
// link pasted into WhatsApp shows the question and score while a browser gets the same React page
// as before. Whether the link is valid is decided by the existing public share API, exactly as the
// page itself decides it; this function only reads the report's task, title and score from it.
//
// Written against plain Node req/res (no Vercel-only helpers), so it runs the same under a local
// test server.

const API_URL = (process.env.SHARE_PREVIEW_API_URL || process.env.VITE_API_URL || "").replace(/\/+$/, "");
const LOOKUP_TIMEOUT_MS = 4000;

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

/** The public report for a token, or null for an invalid, expired or revoked link (or any failure). */
async function lookupReport(token) {
  if (!SHARE_TOKEN_PATTERN.test(token) || !API_URL) return null;
  try {
    const res = await fetch(`${API_URL}/public/shared-answers/${token}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    return (await res.json())?.report || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const requestUrl = new URL(req.url, "http://placeholder");
  // The rewrite passes the token as ?token=; a direct /shared-answer/<token> path works too.
  const token = requestUrl.searchParams.get("token") || requestUrl.pathname.split("/shared-answer/")[1] || "";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = `${proto}://${host}`;
  const pageUrl = `${origin}/shared-answer/${encodeURIComponent(token)}`;

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");

  // The built app page, served by this same deployment as a static file.
  let indexHtml;
  try {
    indexHtml = await fetchText(`${origin}/index.html`);
  } catch (err) {
    console.error("shared-answer page: could not load index.html:", err?.message || err);
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("This page is temporarily unavailable. Please try again in a moment.");
    return;
  }

  const report = await lookupReport(token);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(withShareMeta(indexHtml, metaTags(shareMeta(report, pageUrl))));
}
