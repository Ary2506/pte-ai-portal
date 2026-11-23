import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { shareMeta, metaTags, withShareMeta } from "../api/_shareMeta.js";

// Server-generated link previews for /shared-answer/:token (api/shared-answer-page.js).
const INDEX = fs.readFileSync(path.resolve("index.html"), "utf8");
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const REPORT = {
  taskType: "read-aloud", taskLabel: "Read Aloud", questionTitle: "University Workshops", score: 90, maxScore: 90,
  transcript: "secret words", criteria: [], strengths: [], improvements: [], mistakes: [], overall: null,
  answeredAt: "2026-11-18T00:00:00.000Z", expiresAt: "2026-12-18T00:00:00.000Z", hasAudio: true
};
const tag = (html, attr, name) => (html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`)) || [])[1];

describe("preview tags", () => {
  it("names the task, question and score for a valid report, and nothing private", () => {
    const html = withShareMeta(INDEX, metaTags(shareMeta(REPORT, `https://pte-ai-portal.vercel.app/shared-answer/${TOKEN}`)));
    expect(tag(html, "property", "og:title")).toBe("RA · University Workshops · PTE CORE AI Score 90/90");
    expect(tag(html, "property", "og:description")).toBe("Read Aloud answer shared from PTE CORE AI. Listen to the recording and see the AI score and feedback.");
    expect(tag(html, "property", "og:url")).toBe(`https://pte-ai-portal.vercel.app/shared-answer/${TOKEN}`);
    expect(tag(html, "property", "og:site_name")).toBe("PTE CORE AI");
    expect(tag(html, "name", "twitter:card")).toBe("summary");
    expect(tag(html, "name", "twitter:title")).toBe("RA · University Workshops · PTE CORE AI Score 90/90");
    expect(tag(html, "name", "robots")).toContain("noindex");
    expect(html).toContain("<title>RA · University Workshops · PTE CORE AI Score 90/90</title>");
    // No image is claimed: the site has no raster brand image to point at.
    expect(html).not.toContain("og:image");
    // The transcript and every other report field stay out of the page source.
    expect(html).not.toContain("secret words");
  });

  it("replaces the site's generic tags rather than duplicating them, and leaves the app untouched", () => {
    const html = withShareMeta(INDEX, metaTags(shareMeta(REPORT, "https://x/shared-answer/t")));
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    // Everything outside the replaced tags is the original page: same root, same scripts.
    const body = (s) => s.slice(s.indexOf("<body"));
    expect(body(html)).toBe(body(INDEX));
    expect(html).toContain('<div id="root"></div>');
  });

  it("gives an invalid, expired or revoked link generic tags only", () => {
    const html = withShareMeta(INDEX, metaTags(shareMeta(null, "https://x/shared-answer/t")));
    expect(tag(html, "property", "og:title")).toBe("Shared answer · PTE CORE AI");
    expect(tag(html, "property", "og:description")).toBe("This shared answer is not available. Practise PTE Core with AI scoring on PTE CORE AI.");
  });

  it("escapes a question title so it cannot break out of the tag", () => {
    const html = metaTags(shareMeta({ ...REPORT, questionTitle: `A "quoted" <b>title</b> & more` }, "https://x/y"));
    expect(html).toContain("A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt; &amp; more");
    expect(html).not.toContain("<b>");
  });
});

describe("the serverless page function", () => {
  let handler;
  const calls = [];
  beforeEach(async () => {
    calls.length = 0;
    vi.stubEnv("VITE_API_URL", "https://api.example/api");
    vi.resetModules();
    handler = (await import("../api/shared-answer-page.js")).default;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  function serve(apiAnswer) {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/index.html")) return new Response(INDEX, { status: 200 });
      return apiAnswer();
    }));
  }
  async function request(token) {
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
    await handler({ url: `/api/shared-answer-page?token=${token}`, headers: { host: "pte-ai-portal.vercel.app", "x-forwarded-proto": "https" } }, res);
    return res;
  }

  it("valid token: the app page with that report's tags, uncached and unindexed", async () => {
    serve(() => new Response(JSON.stringify({ report: REPORT }), { status: 200 }));
    const res = await request(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
    expect(tag(res.body, "property", "og:title")).toBe("RA · University Workshops · PTE CORE AI Score 90/90");
    expect(tag(res.body, "property", "og:url")).toBe(`https://pte-ai-portal.vercel.app/shared-answer/${TOKEN}`);
    expect(calls).toEqual(["https://pte-ai-portal.vercel.app/index.html", `https://api.example/api/public/shared-answers/${TOKEN}`]);
  });

  it.each([
    ["expired", 410, "SHARE_EXPIRED"],
    ["revoked", 410, "SHARE_REVOKED"],
    ["unknown", 404, "SHARE_NOT_FOUND"]
  ])("%s token: the same app page, with generic tags only", async (_label, status, code) => {
    serve(() => new Response(JSON.stringify({ message: "x", code }), { status }));
    const res = await request(TOKEN);
    expect(res.statusCode).toBe(200); // the React page then shows its own message, as before
    expect(tag(res.body, "property", "og:title")).toBe("Shared answer · PTE CORE AI");
    expect(res.body).toContain('<div id="root"></div>');
  });

  it("malformed token: the API is not even asked", async () => {
    serve(() => { throw new Error("should not be called"); });
    const res = await request("not-a-token");
    expect(tag(res.body, "property", "og:title")).toBe("Shared answer · PTE CORE AI");
    expect(calls).toEqual(["https://pte-ai-portal.vercel.app/index.html"]);
  });

  it("API down or slow: still serves the page, with generic tags", async () => {
    serve(() => { throw new Error("network down"); });
    const res = await request(TOKEN);
    expect(res.statusCode).toBe(200);
    expect(tag(res.body, "property", "og:title")).toBe("Shared answer · PTE CORE AI");
  });
});
