// Voice activity detection for Repeat Sentence's smart auto-stop: decides, from the microphone's
// loudness alone, when the student has started speaking and when they have finished.
//
// It deliberately does NOT use the browser's SpeechRecognition (`onend` and friends): that service is
// missing in some browsers, ends on its own after a pause, and is exactly the component that has been
// failing. Loudness works the same everywhere the microphone does.
//
// Pure: it is fed one level reading at a time and holds no timers or audio objects, so the same
// code is driven by a real analyser in the browser and by synthetic levels in tests.

export const VAD_DEFAULTS = {
  // Silence that ends an answer. Long enough to ride out the pause between two clauses or while
  // recalling a word (those are well under a second), short enough to feel immediate.
  silenceMs: 1800,
  // Loudness must stay above the threshold this long to count as speech starting, so a cough or a
  // desk knock is not taken for the answer.
  minSpeechMs: 150,
  // The quietest level treated as a voice (RMS, 0..1; 0.008 is about -42 dBFS). A normal speaking
  // voice close to a microphone is several times louder than this; room noise is several times quieter.
  // Low enough for a quiet laptop microphone, which is where a higher bar read real voices as silence.
  minThreshold: 0.008,
  // How far above the background noise a voice has to be, once the noise has been measured.
  noiseMultiplier: 3,
  // The threshold never rises above this however noisy the room is: a threshold above a quiet
  // speaker's own voice would read their answer as silence and cut them off mid-sentence.
  maxThreshold: 0.06,
  // If nobody has spoken at all by this point, stop waiting.
  noSpeechMs: 10000,
  // Trailing words are quieter than the middle of a sentence, so the end of speech is judged
  // against a lower bar than its start.
  releaseRatio: 0.7
};

export function createVoiceDetector(options = {}) {
  const config = { ...VAD_DEFAULTS, ...options };
  let noiseFloor = config.minThreshold / 3; // assume a quiet room until measured
  let voiceSince = null;                    // when the current run of loud frames began
  let speechStartedAt = null;               // set once a run of loud frames lasted minSpeechMs
  let lastVoiceAt = null;                   // the last frame loud enough to count as still speaking
  let startedAt = null;

  const thresholdNow = () => Math.min(config.maxThreshold, Math.max(config.minThreshold, noiseFloor * config.noiseMultiplier));

  /**
   * @param {number} level RMS of the latest audio frame, 0..1
   * @param {number} now   milliseconds, any monotonic clock
   * @returns {{status: "waiting"|"speaking"|"finished"|"no-speech", threshold: number, heardSpeech: boolean}}
   */
  function feed(level, now) {
    if (startedAt === null) startedAt = now;
    const threshold = thresholdNow();
    const loud = level > threshold;

    if (loud) {
      if (voiceSince === null) voiceSince = now;
      lastVoiceAt = now;
      if (speechStartedAt === null && now - voiceSince >= config.minSpeechMs) speechStartedAt = voiceSince;
    } else {
      voiceSince = null;
      if (level > threshold * config.releaseRatio) {
        // A quiet trailing syllable: not loud enough to start speech, but the answer is not over.
        lastVoiceAt = now;
      } else {
        // The background noise is learned only from frames that are clearly not voice, and slowly,
        // so a long answer cannot teach the detector that the student's own voice is "noise".
        noiseFloor += (level - noiseFloor) * 0.05;
      }
    }

    let status = speechStartedAt === null ? "waiting" : "speaking";
    if (speechStartedAt !== null && now - lastVoiceAt >= config.silenceMs) status = "finished";
    else if (speechStartedAt === null && now - startedAt >= config.noSpeechMs) status = "no-speech";
    return { status, threshold: thresholdNow(), heardSpeech: speechStartedAt !== null };
  }

  return { feed, get heardSpeech() { return speechStartedAt !== null; }, config };
}

/**
 * The loudest moment of a finished recording, measured on the recording itself (RMS over 100 ms
 * windows, 0..1), or null when it cannot be measured here.
 *
 * This, not the live level watcher, is what decides whether a recording is "empty". The watcher is a
 * convenience for stopping early; it can be deaf for reasons that have nothing to do with the student
 * (a suspended audio context, a quiet microphone, a device quirk) while the recorder captured their
 * voice perfectly. A recording that is audible is sent for transcription; only one that is silent
 * all the way through (a muted or dead microphone) is not.
 */
export async function recordedPeakLevel(blob, AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext) {
  if (!AudioContextClass || typeof blob?.arrayBuffer !== "function") return null;
  let ctx;
  try {
    ctx = new AudioContextClass();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = decoded.getChannelData(0);
    const window = Math.max(1, Math.round(decoded.sampleRate * 0.1));
    let peak = 0;
    for (let start = 0; start + window <= data.length; start += window) peak = Math.max(peak, rmsOf(data.subarray(start, start + window)));
    if (data.length < window) peak = rmsOf(data);
    return peak;
  } catch {
    return null; // a format this browser cannot decode: say nothing rather than guess
  } finally {
    try { ctx?.close?.(); } catch { /* already closed */ }
  }
}

/** Below this the recording is silent for practical purposes (about -54 dBFS): a muted or dead microphone. */
export const SILENT_RECORDING_PEAK = 0.002;

/** Root-mean-square loudness of one frame of samples (-1..1). */
export function rmsOf(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
