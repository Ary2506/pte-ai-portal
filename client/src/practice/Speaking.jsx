import React, { useEffect, useRef, useState } from "react";
import { Clock3, Eye, EyeOff, Mic, Play, RotateCcw, Sparkles, Square } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";
import { RECORDER_OPTIONS } from "./recording.js";
import { useToast } from "../components/toast.jsx";
import { Button } from "../components/Button.jsx";
import TaskTips, { AI_SCORING_NOTE } from "./TaskTips.jsx";
import { mediaUrl } from "../mediaUrl.js";
import { recordedPeakLevel, rmsOf, SILENT_RECORDING_PEAK } from "./voiceActivity.js";

const SPEAKING_DURATION_LIMITS = {
  "read-aloud": 45,
  "repeat-sentence": 30,
  "describe-image": 60,
  // Listed explicitly rather than left to fall through to DEFAULT_SPEAKING_DURATION_LIMIT: this
  // task's 60s is a deliberate choice, and leaving it implicit would silently change it again the
  // next time the default moves (or hand 60s to whatever new task type is added without an entry).
  "respond-to-situation": 60,
  "answer-short-question": 10,
};
const DEFAULT_SPEAKING_DURATION_LIMIT = 40;

// Tasks that run themselves, the way the real exam does: the prompt audio finishing is the start
// signal, the duration limit is the stop signal, and the answer is sent without the student
// touching a record button. Every other speaking task keeps the manual Start/Stop controls.
const AUTO_RECORD_TYPES = new Set(["repeat-sentence"]);

// How long to wait for a microphone that reports itself muted to start delivering audio. Covers a
// Bluetooth profile switch, which is the slowest case, with room to spare.
const MIC_WAKE_TIMEOUT_MS = 2000;
// An auto-flow task opens the microphone the instant the prompt audio ends, so it asks for the
// device while the earphone is still busy being a speaker. This pause lets the output side settle
// before the input side is claimed — the one thing a manual Start Recording press gave for free.
const AUTO_RECORD_SETTLE_MS = 300;
// Consecutive speech-preview sessions that end having heard nothing at all before the preview is
// declared unavailable, and the length below which an empty session counts as a failure rather
// than as a student who simply has not started speaking yet.
//
// Both halves matter. A microphone the speech service cannot hear ends sessions back to back in
// milliseconds; a student thinking, pausing between clauses, or waiting a beat before answering
// produces sessions that last seconds. Counting only the fast-failing ones is what keeps the
// preview from switching itself off on somebody who is merely quiet for a moment.
const MAX_SILENT_PREVIEW_SESSIONS = 4;
const QUICK_FAIL_SESSION_MS = 1200;

// Which English the preview is told to expect. Chrome's recognizer is markedly more accurate when
// the variety matches the speaker — en-IN on Indian English, en-GB on British, and so on — and
// the student's own browser locale is the best evidence available here. Anything that is not
// English falls back to en-US rather than asking the recognizer for a language the student is not
// being tested in. This only affects the on-screen preview; the score comes from the server's
// transcript of the recording itself.
export function previewLanguage(locale = globalThis.navigator?.language) {
  return /^en([-_]|$)/i.test(String(locale || "")) ? String(locale).replace("_", "-") : "en-US";
}

// The five states a speaking attempt moves through, and what each one tells the student. The
// disclosure about transcript-only evaluation lives in READY, where it is read before recording
// rather than after — it is the one thing a student needs to know up front.
const RECORD_STATES = {
  ready: {
    label: "Ready",
    title: "Record your answer",
    note: "Speak naturally and clearly. Your browser can transcribe speech when supported. Only your transcript is evaluated — pronunciation and audio quality are not analyzed."
  },
  recording: {
    label: "Recording",
    title: "Recording...",
    note: "Keep speaking until you are finished, or stop early when you are done."
  },
  recorded: {
    label: "Recorded",
    title: "Ready to submit",
    note: "Replay it if you want to check, or send it for AI feedback."
  },
  evaluating: {
    label: "Evaluating",
    title: "Scoring your answer",
    note: "Your transcript is being evaluated. This usually takes a few seconds."
  },
  result: {
    label: "Scored",
    title: "Evaluation complete",
    note: "Your feedback is below. Re-do the question to try again."
  }
};

// Earphones and headsets do not hand over their microphone instantly. A Bluetooth headset is in
// playback mode (A2DP) while the prompt audio is playing and has to renegotiate to headset mode
// (HFP) the moment the microphone is opened; a wired headset's input has to be selected. For that
// window the browser hands back a track that exists but is MUTED — it carries silence, and
// `muted` is precisely the browser's flag for "this track is not delivering data right now".
//
// Recording through that window is what loses the start of a spoken answer, and it is also what
// leaves the browser's speech preview with nothing to transcribe. So the recorder waits for the
// track to go live first. The cap matters as much as the wait: a microphone that never unmutes
// (a dead or hardware-muted headset) must still produce a recording, so the student gets the
// honest "we couldn't hear any sound" message afterwards rather than a screen that never starts.
export function waitForLiveMicTrack(track, timeoutMs = MIC_WAKE_TIMEOUT_MS) {
  if (track?.muted !== true || typeof track.addEventListener !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    const settled = () => {
      clearTimeout(timer);
      track.removeEventListener?.("unmute", settled);
      resolve();
    };
    const timer = setTimeout(settled, timeoutMs);
    track.addEventListener("unmute", settled);
  });
}

// A fixed seed, so the waveform is a stable shape rather than re-randomising on every render.
const RECORD_WAVE = [26, 48, 70, 38, 88, 56, 94, 44, 66, 82, 34, 72, 50, 90, 40, 62, 78, 30, 58, 86];

function formatMMSS(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function Speaking({
  type,
  question,
  testSessionId,
  onAnswered,
  existingResult,
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState(null);
  const [transcript, setTranscript] = useState("");
  // Display only: the live microphone level while recording. It never decides whether a recording
  // is accepted -- that is judged on the recorded audio itself, in submit().
  const [micLevel, setMicLevel] = useState(0);
  const [problem, setProblem] = useState("");
  // The words shown while speaking are the browser's own live preview: a draft for the student
  // to follow along with, never what is scored. "unavailable" = this browser has no speech
  // recognition (or refused to use it); "no-audio" = the preview ran but the microphone never
  // reached it, which is what an earphone handing over its microphone looks like. The two are
  // told apart because only one of them is something the student can do anything about.
  // Recording and scoring are unaffected either way.
  const [previewState, setPreviewState] = useState("idle");
  // The server's transcript of the uploaded recording, which replaces the preview once the
  // answer has been evaluated. It is the text the answer was scored on.
  const [serverText, setServerText] = useState("");
  const meterRef = useRef(null);
  const micLabelRef = useRef("");
  // Which input the browser actually gave us. Deliberately NOT shown next to the level meter:
  // the raw device string Windows reports ("Communications - Microphone (2- Realtek(R) Audio)")
  // is noise on a screen the student is trying to concentrate on. It is kept for the one place it
  // earns its space — the message shown when no sound is reaching the preview at all, where
  // naming the input is the whole point.
  const [micName, setMicName] = useState("");
  // Cleared on unmount. start() now awaits the microphone waking up, so by the time it is ready to
  // record the component may be gone — navigating between mock questions mid-start, for instance.
  const aliveRef = useRef(true);
  // Which start attempt is the current one. Bumped by every start() and every reset, and checked
  // after the awaits in start(), so a take abandoned while the microphone was still handing over
  // releases the device instead of recording into a question the student has already left.
  // resettingRef cannot answer this: it is cleared on a zero-delay timeout, which has long since
  // fired by the time a headset finishes waking up.
  const startTokenRef = useRef(0);
  const [result, setResult] = useState(() => existingResult || null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Describe Image, Respond to a Situation, and Answer Short Question only — no other Speaking
  // type has ever shown a reference answer. Resets to hidden automatically on every new question
  // because PracticeTask remounts this component via key={question._id}, the same mechanism that
  // already resets recording/result state.
  const [showAnswer, setShowAnswer] = useState(false);
  // Repeat Sentence's Transcript button. The transcript is the answer key, so the server never
  // sends it with the question — it is fetched the first time the student asks, then kept for the
  // rest of this question. Not offered in a mock test (testSessionId), which is closed-book.
  const [referenceText, setReferenceText] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  // Lets the student hear back what they just recorded before submitting it. Derived from `blob`
  // rather than created alongside it, so the one cleanup below covers every way a recording can
  // go away — a new take, Re-do clearing it, or the component unmounting — instead of each of
  // those having to remember to revoke the URL itself.
  const [replayUrl, setReplayUrl] = useState(null);
  const replayRef = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const recognition = useRef(null);
  const elapsed = useRef(0);
  // Holds the live getUserMedia stream while a recording is in progress, so it can be released
  // directly on unmount without going through MediaRecorder's stop()/onstop pipeline (which would
  // otherwise create a new blob/would-be object URL after the component is already gone).
  const activeStreamRef = useRef(null);
  // Set while resetQuestion() is stopping an in-progress recording, so the recorder's onstop (and
  // any late speech-recognition result) fired by that stop() don't repopulate blob/transcript
  // right after the reset just cleared them.
  const resettingRef = useRef(false);
  const limit =
    SPEAKING_DURATION_LIMITS[question?.type] || DEFAULT_SPEAKING_DURATION_LIMIT;
  // Repeat Sentence (see AUTO_RECORD_TYPES) drives itself: the prompt audio ending arms the
  // recorder, and the take is submitted either when the limit runs out or when the student says
  // they are done — so it shows no Start/Stop Recording button at all. Conditional on the clip
  // actually being there: without one there is nothing to end, and dropping the record button
  // would leave a question with missing audio impossible to answer at all.
  const autoFlow = AUTO_RECORD_TYPES.has(question?.type) && Boolean(question?.audioUrl);
  // Set once the prompt audio has armed the recorder, so replaying the audio (its controls stay
  // available) cannot start a second take over the top of the one already recorded. Cleared on
  // Re-do, and on a failed start, so the student can always get another attempt.
  const autoStartedRef = useRef(false);
  // Set when the current recording should be submitted the moment it finalizes. The blob only
  // exists after MediaRecorder's onstop, so the submit waits for it in the effect below rather
  // than racing stop().
  const autoSubmitRef = useRef(false);

  // Guarantees the microphone is released if this component unmounts while still recording —
  // e.g. navigating to another Mock Test question mid-recording. Stopping the tracks directly
  // (rather than calling recorder.current.stop()) avoids triggering onstop after unmount, which
  // would otherwise finalize a blob/object URL that nothing is left to clean up.
  function stopMeter() {
    if (!meterRef.current) return;
    clearInterval(meterRef.current.timer);
    try { meterRef.current.ctx.close?.(); } catch { /* already closed */ }
    meterRef.current = null;
    setMicLevel(0);
  }

  function startMeter(stream) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      Promise.resolve(ctx.resume?.()).catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser); // analyser only: never played back
      const samples = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        setMicLevel(Math.min(1, rmsOf(samples) * 6));
      }, 100);
      meterRef.current = { timer, ctx };
    } catch {
      meterRef.current = null; // a convenience only
    }
  }

  useEffect(() => {
    // Set on the way IN as well as cleared on the way out. StrictMode runs this effect mount →
    // cleanup → mount in development, so a flag only ever cleared in the cleanup stays false for
    // the whole life of the component — and every guard that reads it silently refuses to work.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopMeter();
      clearInterval(timer.current);
      activeStreamRef.current?.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
      recorder.current = null;
      const speech = recognition.current;
      recognition.current = null; // cleared first: it marks the recognizer's end as deliberate
      try { speech?.stop(); } catch { /* already stopped */ }
    };
  }, []);

  useEffect(() => {
    // Guarded rather than assumed: replay is a convenience, so a context without the Blob
    // object-URL APIs should simply not offer it. Calling through unguarded threw during render
    // and took the whole speaking task down with it — recording and submitting included.
    if (!blob || typeof URL.createObjectURL !== "function") {
      setReplayUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(blob);
    setReplayUrl(url);
    return () => URL.revokeObjectURL?.(url);
  }, [blob]);

  // Sends an auto-flow take as soon as the recording it was flagged for has finalized. The flag is
  // cleared before submitting, so a failed submit leaves the recording on screen with a working
  // Submit button rather than retrying itself.
  useEffect(() => {
    if (!blob || !autoSubmitRef.current) return;
    autoSubmitRef.current = false;
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed to the finished recording only
  }, [blob]);

  function stop() {
    if (!recorder.current) return;
    clearInterval(timer.current);
    stopMeter();
    recorder.current.stop();
    recorder.current = null;
    const speech = recognition.current;
    recognition.current = null; // cleared first: it marks the recognizer's end as deliberate
    try { speech?.stop(); } catch { /* already stopped */ }
    setRecording(false);
  }

  function start() {
    const token = (startTokenRef.current += 1);
    setResult(null);
    setBlob(null);
    setTranscript("");
    setServerText("");
    setProblem("");
    chunks.current = [];
    elapsed.current = 0;
    // Checked rather than optional-chained. `navigator.mediaDevices?.getUserMedia(...)` reads
    // safely but then calls .then() on undefined, which throws synchronously -- before the
    // .catch() at the end of this chain is attached, so the user would see nothing happen at all.
    // mediaDevices is absent on any non-secure origin, which is the usual way this is hit.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Recording is not supported in this browser. Try Chrome, Edge or Safari over https.");
      return;
    }
    navigator.mediaDevices
      // Echo cancellation and noise suppression are asked for explicitly rather than left to the
      // browser's default: a student wearing earphones is listening to the prompt on the same
      // device that is about to record them, and without these the headset's own feed of that
      // prompt audio can be captured alongside their voice.
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(async (stream) => {
        // Assigned before the await, so unmounting mid-start still releases the device.
        activeStreamRef.current = stream;
        const track = stream.getAudioTracks?.()[0];
        micLabelRef.current = track?.label || "";
        setMicName(track?.label || "");
        // The device handover. See waitForLiveMicTrack: a headset's microphone is not ready the
        // instant getUserMedia resolves, and recording into that gap is silence.
        if (autoFlow) await new Promise((resolve) => setTimeout(resolve, AUTO_RECORD_SETTLE_MS));
        await waitForLiveMicTrack(track);
        // Gone, reset, or already recording via another path while we waited: release and stop.
        if (!aliveRef.current || token !== startTokenRef.current || recorder.current) {
          stream.getTracks().forEach((t) => t.stop());
          if (activeStreamRef.current === stream) activeStreamRef.current = null;
          return;
        }
        const mediaRecorder = new MediaRecorder(stream, RECORDER_OPTIONS);
        recorder.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size) chunks.current.push(event.data);
        };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          activeStreamRef.current = null;
          if (!resettingRef.current) {
            // Take the type from the recorder, not a hardcoded "audio/webm". RECORDER_OPTIONS
            // deliberately sets no mimeType, so each browser picks its own: Chrome and Firefox
            // produce WebM, Safari and iOS produce MP4. Labelling an MP4 recording as WebM meant
            // it was stored with a .webm extension and an audio/webm content type, so playback
            // would be served bytes that contradict their declared format.
            // Without the codecs parameter: browsers report "audio/webm;codecs=opus" (Chrome) or
            // "audio/mp4;codecs=..." (Safari), and the server's allow-list matches the base type.
            const type = (mediaRecorder.mimeType || "audio/webm").split(";")[0].trim();
            setBlob(new Blob(chunks.current, { type }));
          }
        };
        mediaRecorder.start();
        startMeter(stream);
        setRecording(true);
        setSeconds(0);
        timer.current = setInterval(() => {
          elapsed.current += 1;
          setSeconds(elapsed.current);
          if (elapsed.current >= limit) {
            // Running out of time is the end of an auto-flow attempt, not a pause: the take goes
            // off for scoring by itself, exactly as it does in the real test.
            if (autoFlow) autoSubmitRef.current = true;
            stop();
          }
        }, 1000);
        // Live preview. Entirely separate from the recorder: nothing here can start, stop or
        // restart MediaRecorder, and any failure only switches the preview off.
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
          setPreviewState("unavailable");
        } else {
          setPreviewState("listening");
          let earlier = ""; // text of sessions the browser has already ended, kept across restarts
          let silentSessions = 0; // consecutive fast failures — see MAX_SILENT_PREVIEW_SESSIONS
          const listen = () => {
            const speech = new SpeechRecognition();
            let session = ""; // everything this session has heard so far, rebuilt from its whole list
            const openedAt = Date.now();
            speech.continuous = true;
            speech.interimResults = true;
            speech.lang = previewLanguage();
            speech.onresult = (event) => {
              if (resettingRef.current || recognition.current !== speech) return;
              // Rebuilt from the full result list every time rather than appended to: a phrase that
              // turns from interim into final is the same list entry, so it can never appear twice.
              let heard = "";
              for (let i = 0; i < event.results.length; i += 1) heard += `${event.results[i][0]?.transcript || ""} `;
              session = heard;
              setTranscript(`${earlier} ${session}`.replace(/\s+/g, " ").trim());
            };
            speech.onerror = (event) => {
              if (["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"].includes(event?.error)) {
                if (recognition.current === speech) recognition.current = null; // do not restart
                // "audio-capture" means the service could not get the microphone at all — a
                // device problem the student can act on, not a browser that cannot do previews.
                setPreviewState(event?.error === "audio-capture" ? "no-audio" : "unavailable");
              }
            };
            speech.onend = () => {
              // Browsers end a session by themselves after a pause. Natural pauses must not end
              // the preview, so while the student is still recording a new session continues it.
              if (recognition.current !== speech) return;
              earlier = `${earlier} ${session}`.replace(/\s+/g, " ").trim();
              // A microphone the speech service cannot hear — an earphone still handing over, or
              // one the service was not given — ends session after session instantly. Restarting
              // for ever leaves "Listening..." on screen for the whole answer and never admits
              // that no words are coming, so the preview gives up and says so instead.
              //
              // Only sessions that BOTH heard nothing and died immediately count. A session that
              // ran its course without words is a student pausing, not a broken microphone, and
              // cutting their preview off for thinking was the bug this clause is written against.
              const failedFast = !session.trim() && Date.now() - openedAt < QUICK_FAIL_SESSION_MS;
              silentSessions = failedFast ? silentSessions + 1 : 0;
              if (silentSessions >= MAX_SILENT_PREVIEW_SESSIONS) {
                recognition.current = null;
                setPreviewState("no-audio");
                return;
              }
              try { listen(); } catch { recognition.current = null; setPreviewState("unavailable"); }
            };
            recognition.current = speech;
            speech.start();
          };
          try { listen(); } catch { recognition.current = null; setPreviewState("unavailable"); }
        }
      })
      .catch(() => {
        // An auto-flow task has no record button to fall back on, so a refused or unavailable
        // microphone must leave the prompt audio able to arm the recorder again.
        autoStartedRef.current = false;
        toast.error("Microphone permission is required. Check your browser permissions and try again.");
      });
  }

  // The prompt audio finishing is the only thing that starts an auto-flow recording. Guarded on
  // every state that means an attempt already happened, so a replay of the audio is just a replay.
  function promptAudioEnded() {
    if (!autoFlow || autoStartedRef.current) return;
    if (recording || blob || busy || result) return;
    autoStartedRef.current = true;
    start();
  }

  // Submitting an auto-flow take while it is still being recorded: stop first, then let the effect
  // below send it once the blob exists. Manual tasks are unchanged — their Submit only ever runs
  // against a finished recording.
  function submitClicked() {
    if (autoFlow && recording) {
      autoSubmitRef.current = true;
      stop();
      return;
    }
    submit();
  }

  async function submit() {
    if (!blob) {
      toast.error("Record an answer first.");
      return;
    }
    setProblem("");
    // Is there any sound in the recording itself? Only a take that is silent all the way through
    // (muted or wrong microphone) with no browser transcript is held back: it would otherwise be
    // scored 0 for something the student never got the chance to say. Anything audible is sent and
    // the server transcribes it. If the level cannot be measured, the answer is sent.
    setBusy(true);
    if (!transcript.trim()) {
      const peak = await recordedPeakLevel(blob);
      if (peak !== null && peak < SILENT_RECORDING_PEAK) {
        setBusy(false);
        setProblem(`We couldn't hear any sound in your recording${micLabelRef.current ? ` from "${micLabelRef.current}"` : ""}. Check that this is the microphone you are speaking into and that it isn't muted, then record again.`);
        return;
      }
    }
    const form = new FormData();
    form.append("audio", blob, "speaking.webm");
    form.append("section", "speaking");
    // The practice page passes no `type` prop (Mock passes the question title), so this used to be
    // submitted as the literal string "undefined" for every practice answer. Fall back to the
    // question's own type; a caller that does pass one is unaffected.
    form.append("type", type ?? question?.type);
    form.append("transcript", transcript);
    // The live words are a draft: ask the server to transcribe the recording and score that.
    form.append("serverTranscript", "1");
    form.append("durationSeconds", seconds);
    if (question?._id) form.append("questionId", question._id);
    if (testSessionId) form.append("testSessionId", testSessionId);
    try {
      const data = await api.submit(form);
      setResult(data.submission);
      if (!testSessionId && typeof data.submission?.transcript === "string") setServerText(data.submission.transcript);
      onAnswered?.(data.submission);
      // A mock shows nothing else on submit — no score, no verdict — so without this the only
      // signal is the button quietly disappearing.
      if (testSessionId) toast.success("Question submitted.");
    } catch (submitError) {
      toast.error(submitError.message);
      setProblem(submitError.message || "Your answer could not be submitted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      setResult((await api.retryEvaluation(result._id)).submission);
    } catch (retryError) {
      toast.error(retryError.message);
    } finally {
      setRetrying(false);
    }
  }

  function resetQuestion() {
    resettingRef.current = true;
    // Re-arm the auto flow: the next play of the prompt audio starts a fresh take, and the take
    // being thrown away must not be submitted on its way out.
    autoStartedRef.current = false;
    autoSubmitRef.current = false;
    // Abandons any start attempt still waiting on a microphone (see startTokenRef).
    startTokenRef.current += 1;
    clearInterval(timer.current);
    timer.current = null;
    if (recorder.current) {
      try {
        if (recorder.current.state !== "inactive") recorder.current.stop();
      } catch {
        /* already stopped */
      }
    }
    recorder.current = null;
    activeStreamRef.current?.getTracks().forEach((track) => track.stop());
    activeStreamRef.current = null;
    stopMeter();
    setProblem("");
    setServerText("");
    setPreviewState("idle");
    const speech = recognition.current;
    recognition.current = null;
    try { speech?.stop(); } catch { /* already stopped */ }
    chunks.current = [];
    elapsed.current = 0;
    setRecording(false);
    setSeconds(0);
    setBlob(null);
    setTranscript("");
    setResult(null);
    setBusy(false);
    setRetrying(false);
    setShowAnswer(false);
    setMicName("");
    // Allow a future recording's onstop/onresult to set blob/transcript normally again.
    setTimeout(() => {
      resettingRef.current = false;
    }, 0);
  }

  async function toggleTranscript() {
    if (showTranscript) { setShowTranscript(false); return; }
    if (referenceText) { setShowTranscript(true); return; }
    setTranscriptLoading(true);
    try {
      const data = await api.questionTranscript(question._id);
      setReferenceText(data.transcript);
      setShowTranscript(true);
    } catch (transcriptError) {
      toast.error(transcriptError.message || "Could not load the transcript.");
    } finally {
      setTranscriptLoading(false);
    }
  }

  const durationLabel = recording
    ? `${formatMMSS(seconds * 1000)} / ${formatMMSS(limit * 1000)}`
    : `Limit ${formatMMSS(limit * 1000)}`;

  // One source of truth for which of the five states the workspace is in, read in priority
  // order: a scored result wins over everything, then evaluation, then live recording.
  const recordState = result ? "result" : busy ? "evaluating" : recording ? "recording" : blob ? "recorded" : "ready";
  // An auto-flow task has no record button, so what happens next has to be said rather than shown.
  // The READY text keeps its standard wording — the transcript-only disclosure included — and only
  // adds how recording begins.
  let stateNote = RECORD_STATES[recordState].note;
  if (autoFlow && recordState === "ready") {
    stateNote = `${stateNote} Recording starts on its own as soon as the audio has finished playing — there is no button to press.`;
  } else if (autoFlow && recordState === "recording") {
    stateNote = `Repeat the sentence now. Your answer is submitted automatically after ${limit} seconds, or press Submit as soon as you have finished.`;
  }
  return (
    <div className="task-layout">
      <section className="panel task-main">
        <div className="task-meta">
          {/* The section, matching ReadingTask's and ListeningTask's chips — not `type`, which
              rendered the raw slug ("read-aloud", "describe-image") and is already shown, properly
              capitalised, in the breadcrumb and the task tabs directly above this panel. */}
          <span className="chip">Speaking</span>
          <span
            className={
              seconds >= limit
                ? "speaking-duration-cap low"
                : "speaking-duration-cap"
            }
          >
            <Clock3 size={15} /> {durationLabel}
          </span>
        </div>
        <h2>{question?.title || type}</h2>
        {/* Answer Short Question is audio-only in the real PTE test — reading the question text
            up front would defeat the listening-comprehension point of the task, so unlike every
            other Speaking type, its prompt is withheld here and only revealed (as a transcript)
            together with the answer, via the toggle below. */}
        {question?.type === "answer-short-question" ? (
          !question?.audioUrl && (
            <p className="instruction">
              Your speaking question will load from the practice library.
            </p>
          )
        ) : (
          <p className="instruction">
            {question?.prompt ||
              "Your speaking question will load from the practice library."}
          </p>
        )}
        {/* The text a Read Aloud question asks the student to read, in its own bordered block
            rather than as an instruction line — `prompt` says what to do, `passage` is the
            material, the same split Reading tasks use. Any speaking type may carry one. */}
        {question?.passage && <div className="passage">{question.passage}</div>}
        {question?.imageUrl && (
          question?.type === "describe-image" ? (
            <div className="describe-image-frame">
              <img
                className="describe-image-photo"
                src={mediaUrl(question.imageUrl)}
                alt={question?.title || "Practice question image"}
              />
            </div>
          ) : (
            <img
              src={mediaUrl(question.imageUrl)}
              alt={question?.title || "Practice question image"}
              style={{ maxWidth: "100%", borderRadius: 9, margin: "12px 0" }}
            />
          )
        )}
        {question?.audioUrl && (
          <audio
            className="audio"
            controls
            src={mediaUrl(question.audioUrl)}
            onEnded={autoFlow ? promptAudioEnded : undefined}
          />
        )}
        {question?.type === "repeat-sentence" && !testSessionId && question?._id && (
          <>
            <Button
              variant="tertiary"
              size="sm"
              className="answer-toggle"
              icon={showTranscript ? <EyeOff/> : <Eye/>}
              loading={transcriptLoading}
              loadingLabel="Loading..."
              onClick={toggleTranscript}
            >
              {showTranscript ? "Hide Transcript" : "Transcript"}
            </Button>
            {showTranscript && referenceText && (
              <div className="answer-reveal">
                <b>Transcript</b>
                <p>{referenceText}</p>
              </div>
            )}
          </>
        )}
        {/* The speech lab's state machine. Each state looks different on purpose: a student
            mid-recording, a student waiting on the evaluator and a student who has not started
            are three different situations, and the box used to render the last two identically. */}
        <div className={`record-box is-${recordState}`} data-state={recordState}>
          <div className="record-box__status">
            <span className="stat-label">{RECORD_STATES[recordState].label}</span>
            <span className="record-box__timer num-mono">{durationLabel}</span>
          </div>

          {recordState === "recording" ? (
            <div className="record-wave" aria-hidden="true">
              {RECORD_WAVE.map((h, i) => (
                <span key={i} className="record-wave__bar" style={{ "--h": `${h}%`, "--i": i }} />
              ))}
            </div>
          ) : (
            <div className={recordState === "evaluating" ? "mic-circle is-working" : "mic-circle"}>
              <Mic size={28} />
            </div>
          )}

          <h3>{RECORD_STATES[recordState].title}</h3>
          <p className="muted" role={problem ? "alert" : undefined}>{problem || stateNote}</p>
          {recordState === "recording" && (
            <div style={{ width: "min(320px, 85%)", margin: "10px auto 0" }}>
              <div role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(micLevel * 100)} style={{ height: 6, borderRadius: 3, background: "rgba(127,127,127,.25)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.round(micLevel * 100)}%`, background: "var(--success)", transition: "width 80ms linear" }} />
              </div>
              <p className="muted" style={{ marginTop: 6, fontSize: ".85rem" }}>Microphone level</p>
            </div>
          )}
        </div>
        {(recording || transcript || serverText || blob) && (() => {
          const finalText = serverText || "";
          const shown = finalText || transcript;
          const heading = finalText ? "Final transcript" : recording ? "Live transcript" : "Transcript";
          const previewDown = previewState === "unavailable" || previewState === "no-audio";
          let status;
          if (finalText) status = "Final transcript received from the server.";
          else if (recording && previewState === "unavailable") status = "Live preview is unavailable in this browser. Your recording is still being captured; the final transcript will appear after it is processed.";
          else if (recording && previewState === "no-audio") status = `No sound is reaching the live preview${micName ? ` from "${micName}"` : ""}. If you are wearing earphones, check that the microphone you are speaking into is the one your browser has selected. Your recording is still being captured; the final transcript will appear after it is processed.`;
          else if (recording && !transcript) status = micLevel > 0.05 ? "Listening..." : "Waiting for you to speak...";
          else if (recording) status = "Listening...";
          else if (blob && !result) status = previewDown ? "Recording completed. The transcript will appear after your answer is processed." : "Recording completed.";
          else status = "";
          return (
            <div className="transcript" aria-live="polite">
              <b>{heading}</b>
              {shown ? <p>{shown}</p> : null}
              {status ? <p className="muted" style={{ fontSize: ".85rem" }}>{status}</p> : null}
            </div>
          );
        })()}
        {/* No Save for speaking: a recording is captured in one take, so there is no partial
            answer to come back and adjust. The verdict is still withheld during a mock — the
            score belongs on the results screen once the whole test is finished. */}
        {result ? (
          // Nothing is shown for a submitted mock answer: the inputs are locked, the buttons are
          // gone and the overview square has turned green. The score waits for the results screen.
          testSessionId ? null : <Result result={result} onRetry={retry} retrying={retrying} />
        ) : (
          <div className="task-actions btn-bar is-end">
            {!testSessionId && (
              <Button
                variant="tertiary"
                icon={<RotateCcw/>}
                onClick={resetQuestion}
                disabled={busy || retrying}
              >
                Re-do
              </Button>
            )}
            {/* The primary tier moves as the task does: recording is the point of the screen
                until a take exists, after which submitting it is. The two are never primary at
                the same time, so there is always exactly one obvious next step. Omitted entirely
                for an auto-flow task, which has nothing for the student to start or stop. */}
            {!autoFlow && (
              <Button
                variant={blob && !recording ? "secondary" : "primary"}
                className={recording ? "btn--record is-recording" : "btn--record"}
                icon={recording ? <Square/> : <Mic/>}
                onClick={recording ? stop : start}
                disabled={busy}
              >
                {recording ? "Stop Recording" : "Start Recording"}
              </Button>
            )}
            {replayUrl && (
              <Button
                variant="tertiary"
                icon={<Play/>}
                onClick={() => replayRef.current?.play()}
                disabled={recording || busy}
              >
                Replay Recording
              </Button>
            )}
            {/* Live during an auto-flow recording as well: it is how a student who has finished
                repeating the sentence sends the answer without waiting out the full limit. */}
            <Button
              variant="primary"
              icon={<Sparkles/>}
              disabled={!blob && !(autoFlow && recording)}
              loading={busy}
              loadingLabel="Evaluating..."
              onClick={submitClicked}
            >
              Submit for AI Feedback
            </Button>
          </div>
        )}
        {replayUrl && <audio ref={replayRef} src={replayUrl} style={{ display: "none" }} />}
        {/* Standalone practice only — Mock Test's timed, one-attempt-per-question flow is
            untouched (gated on testSessionId, exactly as Mock always passes it and standalone
            practice never does). Shown beside the recording controls while they are still on
            screen, and on its own once a result has replaced them. */}
        {!testSessionId && result && (
          <div className="task-actions">
            <Button
              variant="secondary"
              icon={<RotateCcw/>}
              onClick={resetQuestion}
              disabled={busy || retrying}
            >
              Re-do
            </Button>
          </div>
        )}
        {(question?.type === "describe-image" || question?.type === "respond-to-situation" || question?.type === "answer-short-question" || question?.type === "read-aloud") && (
          question?.answer ? (
            <>
              <Button
                variant="tertiary"
                size="sm"
                className="answer-toggle"
                icon={showAnswer ? <EyeOff/> : <Eye/>}
                onClick={() => setShowAnswer((value) => !value)}
              >
                {showAnswer ? "Hide Answer" : "Show Answer"}
              </Button>
              {showAnswer && (
                <div className="answer-reveal">
                  {question?.type === "answer-short-question" ? (
                    <>
                      <b>Transcript</b>
                      <p>{question.prompt}</p>
                      <b>Answer</b>
                      <p>{question.answer}</p>
                    </>
                  ) : (
                    <>
                      <b>Model Answer</b>
                      <p>{question.answer}</p>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            // Some Describe Image questions predate this feature and were never given a stored
            // model answer — an honest note instead of a silently-missing button, so this reads
            // as "no answer for this one" rather than "the feature is broken".
            <p className="muted answer-toggle">No model answer available for this question yet.</p>
          )
        )}
      </section>
      <TaskTips type={question?.type} section="speaking" note={AI_SCORING_NOTE}/>
    </div>
  );
}

export { Speaking };
