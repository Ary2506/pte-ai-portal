import React, { useEffect, useRef, useState } from "react";
import { Clock3, Mic, Sparkles } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";
import { RECORDER_OPTIONS } from "./recording.js";

const SPEAKING_DURATION_LIMITS = {
  "read-aloud": 60,
  "repeat-sentence": 15,
  "describe-image": 60,
  // Listed explicitly rather than left to fall through to DEFAULT_SPEAKING_DURATION_LIMIT: this
  // task's 60s is a deliberate choice, and leaving it implicit would silently change it again the
  // next time the default moves (or hand 60s to whatever new task type is added without an entry).
  "respond-to-situation": 60,
  "answer-short-question": 10,
};
const DEFAULT_SPEAKING_DURATION_LIMIT = 40;

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

// A fixed seed, so the waveform is a stable shape rather than re-randomising on every render.
const RECORD_WAVE = [26, 48, 70, 38, 88, 56, 94, 44, 66, 82, 34, 72, 50, 90, 40, 62, 78, 30, 58, 86];

// Advice that actually differs by task. A type with no entry falls back to GENERIC_TIPS, so
// adding a speaking type never leaves an empty panel. Read Aloud's wording is carried over from
// the dedicated component this one replaced, so its students see the same guidance as before.
const GENERIC_TIPS = [
  "Maintain steady fluency.",
  "Pronounce words clearly.",
  "Avoid long pauses.",
  "Focus on the whole prompt.",
];
const TASK_TIPS = {
  "read-aloud": [
    "Read at a natural, steady pace.",
    "Pronounce every word clearly.",
    "Use natural intonation, not a flat monotone.",
    "Don't rush — fluency matters more than speed.",
  ],
  "repeat-sentence": [
    "Listen to the whole sentence before speaking.",
    "Match the speaker's rhythm and stress.",
    "Repeat it in one go, without restarting.",
  ],
  "describe-image": [
    "Open by saying what kind of image it is.",
    "Give the highest and lowest values, or the main trend.",
    "Close with one sentence of interpretation.",
  ],
  "answer-short-question": [
    "Answer in one or two words — nothing more is expected.",
    "Reply as soon as the audio ends.",
  ],
  "respond-to-situation": [
    "Address the person and the situation directly.",
    "Keep a polite, natural register.",
    "Cover every part of what you were asked to say.",
  ],
};
const TASK_TIP_HEADINGS = {
  "read-aloud": "Read Aloud",
  "repeat-sentence": "Repeat Sentence",
  "describe-image": "Describe Image",
  "answer-short-question": "Answer Short Question",
  "respond-to-situation": "Respond to a Situation",
};

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
  const [result, setResult] = useState(() => existingResult || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // Describe Image, Respond to a Situation, and Answer Short Question only — no other Speaking
  // type has ever shown a reference answer. Resets to hidden automatically on every new question
  // because PracticeTask remounts this component via key={question._id}, the same mechanism that
  // already resets recording/result state.
  const [showAnswer, setShowAnswer] = useState(false);
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

  // Guarantees the microphone is released if this component unmounts while still recording —
  // e.g. navigating to another Mock Test question mid-recording. Stopping the tracks directly
  // (rather than calling recorder.current.stop()) avoids triggering onstop after unmount, which
  // would otherwise finalize a blob/object URL that nothing is left to clean up.
  useEffect(() => () => {
    clearInterval(timer.current);
    activeStreamRef.current?.getTracks().forEach((track) => track.stop());
    activeStreamRef.current = null;
    recorder.current = null;
    recognition.current?.stop();
    recognition.current = null;
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

  function stop() {
    if (!recorder.current) return;
    clearInterval(timer.current);
    recorder.current.stop();
    recorder.current = null;
    recognition.current?.stop();
    recognition.current = null;
    setRecording(false);
  }

  function start() {
    setError("");
    setResult(null);
    setBlob(null);
    setTranscript("");
    chunks.current = [];
    elapsed.current = 0;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        activeStreamRef.current = stream;
        const mediaRecorder = new MediaRecorder(stream, RECORDER_OPTIONS);
        recorder.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size) chunks.current.push(event.data);
        };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          activeStreamRef.current = null;
          if (!resettingRef.current) {
            setBlob(new Blob(chunks.current, { type: "audio/webm" }));
          }
        };
        mediaRecorder.start();
        setRecording(true);
        setSeconds(0);
        timer.current = setInterval(() => {
          elapsed.current += 1;
          setSeconds(elapsed.current);
          if (elapsed.current >= limit) stop();
        }, 1000);
        const SpeechRecognition =
          window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          const speech = new SpeechRecognition();
          speech.continuous = true;
          speech.interimResults = true;
          speech.lang = "en-US";
          speech.onresult = (event) => {
            if (resettingRef.current) return;
            let value = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1)
              value += `${event.results[i][0].transcript} `;
            setTranscript(value.trim());
          };
          speech.start();
          recognition.current = speech;
        }
      })
      .catch(() =>
        setError(
          "Microphone permission is required. Check your browser permissions and try again.",
        ),
      );
  }

  async function submit() {
    if (!blob) {
      setError("Record an answer first.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("audio", blob, "speaking.webm");
    form.append("section", "speaking");
    form.append("type", type);
    form.append("transcript", transcript);
    form.append("durationSeconds", seconds);
    if (question?._id) form.append("questionId", question._id);
    if (testSessionId) form.append("testSessionId", testSessionId);
    try {
      const data = await api.submit(form);
      setResult(data.submission);
      onAnswered?.(data.submission);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setRetrying(true);
    setError("");
    try {
      setResult((await api.retryEvaluation(result._id)).submission);
    } catch (retryError) {
      setError(retryError.message);
    } finally {
      setRetrying(false);
    }
  }

  function resetQuestion() {
    resettingRef.current = true;
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
    recognition.current?.stop();
    recognition.current = null;
    chunks.current = [];
    elapsed.current = 0;
    setRecording(false);
    setSeconds(0);
    setBlob(null);
    setTranscript("");
    setResult(null);
    setError("");
    setBusy(false);
    setRetrying(false);
    setShowAnswer(false);
    // Allow a future recording's onstop/onresult to set blob/transcript normally again.
    setTimeout(() => {
      resettingRef.current = false;
    }, 0);
  }

  const durationLabel = recording
    ? `${formatMMSS(seconds * 1000)} / ${formatMMSS(limit * 1000)}`
    : `Limit ${formatMMSS(limit * 1000)}`;

  // One source of truth for which of the five states the workspace is in, read in priority
  // order: a scored result wins over everything, then evaluation, then live recording.
  const recordState = result ? "result" : busy ? "evaluating" : recording ? "recording" : blob ? "recorded" : "ready";
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
                src={question.imageUrl}
                alt={question?.title || "Practice question image"}
              />
            </div>
          ) : (
            <img
              src={question.imageUrl}
              alt={question?.title || "Practice question image"}
              style={{ maxWidth: "100%", borderRadius: 9, margin: "12px 0" }}
            />
          )
        )}
        {question?.audioUrl && (
          <audio className="audio" controls src={question.audioUrl} />
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
          <p className="muted">{RECORD_STATES[recordState].note}</p>
        </div>
        {transcript && (
          <div className="transcript">
            <b>Live transcript</b>
            <p>{transcript}</p>
          </div>
        )}
        {error && <div className="alert error">{error}</div>}
        {result ? (
          <Result result={result} onRetry={retry} retrying={retrying} />
        ) : (
          <div className="task-actions">
            <button
              className="secondary"
              onClick={recording ? stop : start}
              disabled={busy}
            >
              {recording ? "Stop Recording" : "Start Recording"}
            </button>
            {replayUrl && (
              <button
                type="button"
                className="secondary"
                onClick={() => replayRef.current?.play()}
                disabled={recording || busy}
              >
                Replay Recording
              </button>
            )}
            <button
              className="primary"
              disabled={!blob || busy}
              onClick={submit}
            >
              {busy ? "Evaluating..." : "Submit for AI Feedback"}
            </button>
          </div>
        )}
        {replayUrl && <audio ref={replayRef} src={replayUrl} style={{ display: "none" }} />}
        {/* Standalone practice only — Mock Test's timed, one-attempt-per-question flow is
            untouched (gated on testSessionId, exactly as Mock always passes it and standalone
            practice never does). Always available, including after AI evaluation. */}
        {!testSessionId && (
          <div className="task-actions">
            <button
              type="button"
              className="secondary"
              onClick={resetQuestion}
              disabled={busy || retrying}
            >
              Re-do
            </button>
          </div>
        )}
        {(question?.type === "describe-image" || question?.type === "respond-to-situation" || question?.type === "answer-short-question" || question?.type === "read-aloud") && (
          question?.answer ? (
            <>
              <button
                type="button"
                className="secondary answer-toggle"
                onClick={() => setShowAnswer((value) => !value)}
              >
                {showAnswer ? "Hide Answer" : "Show Answer"}
              </button>
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
      <aside className="panel tips">
        <h3>{TASK_TIP_HEADINGS[question?.type] || "Speaking"} tips</h3>
        <ul>
          {(TASK_TIPS[question?.type] || GENERIC_TIPS).map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
        <div className="tip-box">
          <Sparkles size={18} />
          <b>AI analysis</b>
          <p>
            We evaluate your submitted response and return a practice score.
          </p>
        </div>
      </aside>
    </div>
  );
}

export { Speaking };
