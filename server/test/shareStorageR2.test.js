import { describe, it, expect, vi, afterEach } from "vitest";
import { AUDIO_URL_TTL_SECONDS } from "../src/routes/shareLinks.js";

// The R2 side of Share Answer, without a bucket: storage.js is loaded fresh with R2 credentials set
// and the AWS SDK replaced, and the requests it would send are inspected. Scoped with doMock and
// resetModules so nothing here reaches the rest of the suite, which runs on the local disk driver.
const R2_ENV = { R2_ENDPOINT: "https://example.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "pte-test" };

async function loadR2Storage() {
  const sent = [];
  const signed = [];
  vi.resetModules();
  for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v);
  vi.doMock("@aws-sdk/client-s3", () => {
    const command = (name) => class { constructor(input) { this.name = name; this.input = input; } };
    return {
      S3Client: class { async send(cmd) { sent.push(cmd); return {}; } },
      PutObjectCommand: command("Put"), GetObjectCommand: command("Get"), HeadObjectCommand: command("Head"),
      CopyObjectCommand: command("Copy"), DeleteObjectCommand: command("Delete")
    };
  });
  vi.doMock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: async (_client, cmd, options) => { signed.push({ cmd, options }); return "https://signed.example/audio"; }
  }));
  const storage = await import("../src/storage.js");
  return { storage, sent, signed };
}

afterEach(() => {
  vi.doUnmock("@aws-sdk/client-s3");
  vi.doUnmock("@aws-sdk/s3-request-presigner");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("shared audio on R2", () => {
  it("copies the recording inside the bucket with one CopyObject, leaving the source alone", async () => {
    const { storage, sent } = await loadR2Storage();
    expect(storage.isRemoteStorage).toBe(true);
    await storage.copyObject("recordings/u1/1700000000000-abc.webm", "shared-audio/s1/1700000000000-abc.webm");
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe("Copy");
    expect(sent[0].input).toEqual({
      Bucket: "pte-test",
      Key: "shared-audio/s1/1700000000000-abc.webm",
      CopySource: "pte-test/recordings/u1/1700000000000-abc.webm"
    });
  });

  it("signs a GET for the shared copy with the one-hour window, far inside R2's 7-day maximum", async () => {
    const { storage, signed } = await loadR2Storage();
    expect(AUDIO_URL_TTL_SECONDS).toBe(3600);
    expect(AUDIO_URL_TTL_SECONDS).toBeLessThan(7 * 24 * 60 * 60);
    await storage.signedObjectUrl("shared-audio/s1/a.webm", AUDIO_URL_TTL_SECONDS);
    expect(signed[0].cmd.name).toBe("Get");
    expect(signed[0].cmd.input).toEqual({ Bucket: "pte-test", Key: "shared-audio/s1/a.webm" });
    expect(signed[0].options).toEqual({ expiresIn: 3600 });
  });
});
