import { describe, it, expect } from "vitest";
import { mediaUrl } from "../src/mediaUrl.js";

// The client and the API are different origins in production: the client on Vercel, the API on a
// Node host. Admin-uploaded question media is served by the API at /media/questions/..., so a
// root-relative value has to be prefixed with the API origin or it resolves against the client
// and 404s.
//
// The previous upload route sidestepped this by returning an absolute URL built from
// req.get("host") -- which baked "localhost:5000" into question rows created in development.
// Rows now store the path, and this helper decides where it points.
describe("resolving an admin-uploaded media path", () => {
  it("prefixes it with the API origin, not the /api prefix itself", () => {
    const resolved = mediaUrl("/media/questions/images/abc.jpg");
    expect(resolved).toBe("http://localhost:5000/media/questions/images/abc.jpg");
    // The mount sits above /api, so the suffix must be stripped rather than appended to.
    expect(resolved).not.toContain("/api/media");
  });

  it("handles audio the same way", () => {
    expect(mediaUrl("/media/questions/audio/abc.webm"))
      .toBe("http://localhost:5000/media/questions/audio/abc.webm");
  });
});

describe("values it must leave alone", () => {
  it("passes an external CDN URL through untouched", () => {
    // A handful of seeded listening questions load audio from an external host. Rewriting one
    // would turn it into a path under the API and break it.
    for (const url of [
      "https://d1234.cloudfront.net/clip.mp3",
      "http://cdn.pixabay.com/audio/x.mp3",
      "https://example.com/media/questions/images/decoy.jpg"
    ]) {
      expect(mediaUrl(url)).toBe(url);
    }
  });

  it("leaves the static question bank on the client's own origin", () => {
    // These ship with the client build and are served by its host, not the API.
    for (const path of [
      "/audio/listening/clip-01.mp3",
      "/question-images/describe-image/describe_image_01.png",
      "/writing-resources/sample-email.pdf"
    ]) {
      expect(mediaUrl(path)).toBe(path);
    }
  });

  it("passes data: and blob: URLs through, for a local preview before upload", () => {
    expect(mediaUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(mediaUrl("blob:http://localhost:5173/abc")).toBe("blob:http://localhost:5173/abc");
  });

  it("returns an empty string for a missing value rather than 'undefined'", () => {
    // A falsy src would otherwise render as the literal string and fire a bogus request.
    for (const empty of [undefined, null, ""]) expect(mediaUrl(empty)).toBe("");
  });
});
