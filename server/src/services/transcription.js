import { config } from "../config.js";

// Server-side speech-to-text for a student's recording, used ONLY as a fallback.
//
// The speaking tasks are scored from a transcript, and that transcript normally comes from the
// student's browser (the Web Speech API). That recognizer is the weak link: it does not exist in
// Firefox, it needs a network round trip to a cloud service in Chrome, and when it fails it fails
// silently -- the answer arrives with an empty transcript and the student is scored as if they had
// said nothing, although the recording itself uploaded perfectly well.
//
// So when a recording arrives with no browser transcript, it is transcribed here instead, with the
// same Groq account the AI evaluation already uses. The three outcomes are kept strictly apart,
// because they mean different things to the student:
//
//   speech    { text: "..." }            score it
//   silence   { text: "" }               the recording holds no speech: genuinely nothing said
//   failure   throws TranscriptionError  the system failed; this says nothing about the student
//
// A failure must never be turned into an empty string. That is exactly the bug this module exists
// to remove.

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.TRANSCRIPTION_MODEL || "whisper-large-v3";
const TIMEOUT_MS = 30_000;
// Whisper reports, per segment, how likely it is that the segment contains no speech at all.
// Without this, silence and background noise come back as short hallucinated phrases ("Thank
// you.", "you") that would be scored as if the student had said them.
const NO_SPEECH_THRESHOLD = 0.6;

// Whisper decides the format from the file name's extension, so it has to match the real container.
const EXTENSIONS = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac"
};
const baseMime = (value) => String(value || "").split(";")[0].trim().toLowerCase();

export class TranscriptionError extends Error {
  /**
   * @param {"unreadable"|"unavailable"} kind  unreadable: the audio itself was rejected (empty,
   *   corrupt, unsupported) so retrying the same file will not help. unavailable: the service
   *   could not be reached or failed, so a retry may well work.
   */
  constructor(kind, detail) {
    super(`transcription ${kind}${detail ? `: ${detail}` : ""}`);
    this.name = "TranscriptionError";
    this.kind = kind;
  }
}

/**
 * Off in tests unless a test opts in (TRANSCRIPTION_IN_TEST=1), so no test can reach the network by
 * accident, and off when no key is configured, in which case behaviour is exactly what it was.
 */
export function transcriptionEnabled() {
  if (!config.openaiKey) return false;
  return process.env.NODE_ENV !== "test" || process.env.TRANSCRIPTION_IN_TEST === "1";
}

export async function transcribeAudio({ buffer, mimetype }) {
  if (!buffer?.length) throw new TranscriptionError("unreadable", "empty audio");
  const extension = EXTENSIONS[baseMime(mimetype)] || "webm";

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: baseMime(mimetype) || "audio/webm" }), `recording.${extension}`);
  form.append("model", MODEL);
  form.append("language", "en");
  form.append("temperature", "0");
  form.append("response_format", "verbose_json");

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new TranscriptionError("unavailable", error?.name === "TimeoutError" ? "timed out" : "network error");
  }

  if (!response.ok) {
    // 400/413/415/422: the service looked at this audio and refused it. Anything else (429, 5xx,
    // 401 from a bad key) is on the service's side, not the recording's.
    const kind = [400, 413, 415, 422].includes(response.status) ? "unreadable" : "unavailable";
    throw new TranscriptionError(kind, `HTTP ${response.status}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new TranscriptionError("unavailable", "unreadable response");
  }
  if (typeof body?.text !== "string") throw new TranscriptionError("unavailable", "unexpected response");

  const text = body.text.trim();
  const segments = Array.isArray(body.segments) ? body.segments : [];
  // Needs a real word in it: on hiss or room noise Whisper can return bare punctuation (".") with
  // no no-speech signal at all, and that is not something the student said.
  const hasWords = /[\p{L}\p{N}]/u.test(text);
  const spoken = hasWords && (segments.length === 0 || segments.some((s) => !(Number(s?.no_speech_prob) >= NO_SPEECH_THRESHOLD)));
  return { text: spoken ? text : "" };
}

/** What the student is told when the system, not they, failed. */
export function transcriptionFailureMessage(error) {
  return error?.kind === "unreadable"
    ? "Your recording could not be read — it may be empty or damaged. Please record your answer again."
    : "The speech service is temporarily unavailable, so your answer could not be processed. This is not a score — please try again in a moment.";
}
