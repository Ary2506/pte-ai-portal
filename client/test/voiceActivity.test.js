import { describe, it, expect } from "vitest";
import { createVoiceDetector, rmsOf, recordedPeakLevel, SILENT_RECORDING_PEAK, VAD_DEFAULTS } from "../src/practice/voiceActivity.js";

// Drives the detector with a synthetic loudness track, one reading every 50 ms. `track` is a list of
// [seconds, level] segments. Returns when the detector first reports `finished` / `no-speech`.
const STEP = 50;
function run(track, options) {
  const d = createVoiceDetector(options);
  let t = 0;
  let last = null;
  for (const [seconds, level] of track) {
    for (let i = 0; i < Math.round((seconds * 1000) / STEP); i += 1) {
      last = d.feed(level + (i % 2 ? 0.0002 : 0), t); // a hair of jitter, like a real signal
      if (last.status === "finished" || last.status === "no-speech") return { status: last.status, at: t, heard: last.heardSpeech };
      t += STEP;
    }
  }
  return { status: last?.status, at: t, heard: last?.heardSpeech };
}
const QUIET = 0.003;   // a quiet room
const VOICE = 0.08;    // a normal speaking voice
const SOFT = 0.025;    // a soft speaker

describe("voice activity detection — finishing early", () => {
  it("stops about 1.8 s after the student finishes speaking (speech 2–9 s, silence after)", () => {
    const r = run([[2, QUIET], [7, VOICE], [20, QUIET]]);
    expect(r.status).toBe("finished");
    // the last loud reading is at 8.95 s (speech ran 2.0 -> 9.0 s), so 1.8 s of silence lands at 10.75 s
    expect(r.at).toBeGreaterThanOrEqual(9000 - STEP + VAD_DEFAULTS.silenceMs);
    expect(r.at).toBeLessThanOrEqual(9000 + VAD_DEFAULTS.silenceMs + 200);
  });

  it("works for an answer that ends late (speech 3–25 s)", () => {
    const r = run([[3, QUIET], [22, VOICE], [10, QUIET]]);
    expect(r.status).toBe("finished");
    expect(r.at).toBeGreaterThan(25000);
    expect(r.at).toBeLessThan(25000 + VAD_DEFAULTS.silenceMs + 200);
  });

  it("does NOT stop on natural pauses between words and clauses", () => {
    const track = [[1, QUIET], [1.5, VOICE], [0.4, QUIET], [1, VOICE], [1.0, QUIET], [1.2, VOICE], [1.5, QUIET], [1, VOICE]];
    const r = run(track);
    expect(r.status).not.toBe("finished"); // pauses of 0.4 s, 1.0 s and 1.5 s all ride out
  });

  it("a pause just under the limit is ridden out, just over it ends the answer", () => {
    expect(run([[1, VOICE], [1.7, QUIET], [1, VOICE]]).status).not.toBe("finished");
    expect(run([[1, VOICE], [1.9, QUIET], [1, VOICE]]).status).toBe("finished");
  });

  it("does not stop while the student is still speaking, however long they go", () => {
    const r = run([[1, QUIET], [40, VOICE]]);
    expect(r.status).toBe("speaking");
  });

  it("still hears a soft speaker, and does not cut them off at a quiet syllable", () => {
    expect(run([[1, QUIET], [6, SOFT], [4, QUIET]]).status).toBe("finished");
    // trailing words quieter than the middle of the sentence do not end the answer early
    const r = run([[1, QUIET], [3, VOICE], [1.5, SOFT * 0.8], [0.5, VOICE]]);
    expect(r.status).not.toBe("finished");
  });
});

describe("voice activity detection — noise and non-speech", () => {
  it("ignores low background noise: a silent room never counts as speech", () => {
    const r = run([[15, QUIET]]);
    expect(r.status).toBe("no-speech");
    expect(r.heard).toBe(false);
    expect(r.at).toBeLessThanOrEqual(VAD_DEFAULTS.noSpeechMs + STEP);
  });

  it("ignores a short cough or knock", () => {
    const r = run([[2, QUIET], [0.1, 0.3], [12, QUIET]]); // 100 ms loud burst
    expect(r.heard).toBe(false);
    expect(r.status).toBe("no-speech");
  });

  it("a real answer after a long wait still counts, so long as it starts before the no-speech limit", () => {
    const r = run([[8, QUIET], [3, VOICE], [5, QUIET]]);
    expect(r.status).toBe("finished");
    expect(r.heard).toBe(true);
  });

  it("learns a slightly noisy room, then only reacts to a voice above it", () => {
    const track = [[3, 0.005], [4, VOICE], [5, 0.005]];
    const r = run(track);
    expect(r.status).toBe("finished");
    expect(r.at).toBeGreaterThan(7000);
  });

  it("the detection threshold is capped, so a loud room cannot raise it above a normal voice", () => {
    const d = createVoiceDetector();
    for (let t = 0; t < 20000; t += STEP) d.feed(0.001, t); // very quiet
    expect(d.feed(0.001, 20000).threshold).toBeGreaterThanOrEqual(VAD_DEFAULTS.minThreshold);
    expect(d.feed(0.001, 20050).threshold).toBeLessThanOrEqual(VAD_DEFAULTS.maxThreshold);
  });
});

describe("rmsOf", () => {
  it("is 0 for silence and the amplitude for a constant signal", () => {
    expect(rmsOf(new Float32Array(1024))).toBe(0);
    expect(rmsOf(new Float32Array(1024).fill(0.5))).toBeCloseTo(0.5, 5);
  });
  it("is 0 for an empty frame instead of NaN", () => {
    expect(rmsOf(new Float32Array(0))).toBe(0);
    expect(rmsOf(undefined)).toBe(0);
  });
});

describe("recordedPeakLevel — judging the recording itself", () => {
  // A stand-in for the browser: decodes any blob into a mono buffer whose loudness the test chooses.
  const contextFor = (levels, rate = 48000) => class {
    async decodeAudioData() {
      const data = new Float32Array(levels.length * (rate / 10)); // one reading per 100 ms
      levels.forEach((l, i) => data.fill(l, i * (rate / 10), (i + 1) * (rate / 10)));
      return { sampleRate: rate, getChannelData: () => data };
    }
    close() {}
  };
  const blob = { arrayBuffer: async () => new ArrayBuffer(8) };

  it("reports the loudest 100 ms of the recording", async () => {
    expect(await recordedPeakLevel(blob, contextFor([0.001, 0.001, 0.2, 0.05, 0.001]))).toBeCloseTo(0.2, 3);
  });
  it("a recording with a quiet voice is still above the silent-recording line", async () => {
    expect(await recordedPeakLevel(blob, contextFor([0.0005, 0.01, 0.012, 0.0005]))).toBeGreaterThan(SILENT_RECORDING_PEAK);
  });
  it("a muted microphone is below it", async () => {
    expect(await recordedPeakLevel(blob, contextFor([0, 0, 0, 0.0004, 0]))).toBeLessThan(SILENT_RECORDING_PEAK);
  });
  it("says null, not silence, when it cannot decode or measure", async () => {
    expect(await recordedPeakLevel(blob, class { async decodeAudioData() { throw new Error("unsupported codec"); } })).toBeNull();
    expect(await recordedPeakLevel({}, contextFor([0.1]))).toBeNull();
    expect(await recordedPeakLevel(blob, null)).toBeNull();
  });
});
