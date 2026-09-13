import React, { useEffect, useRef, useState } from "react";
import { Clock3, Mic, Sparkles } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";

const SPEAKING_DURATION_LIMITS = {
  "read-aloud": 40,
  "repeat-sentence": 15,
  "describe-image": 40,
  "answer-short-question": 10,
};
const DEFAULT_SPEAKING_DURATION_LIMIT = 40;

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
  // Describe Image only — no other Speaking type has ever shown a reference answer. Resets to
  // hidden automatically on every new question because PracticeTask remounts this component via
  // key={question._id}, the same mechanism that already resets recording/result state.
  const [showAnswer, setShowAnswer] = useState(false);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const recognition = useRef(null);
  const elapsed = useRef(0);
  const limit =
    SPEAKING_DURATION_LIMITS[question?.type] || DEFAULT_SPEAKING_DURATION_LIMIT;

  useEffect(() => () => clearInterval(timer.current), []);

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
        const mediaRecorder = new MediaRecorder(stream);
        recorder.current = mediaRecorder;
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size) chunks.current.push(event.data);
        };
        mediaRecorder.onstop = () => {
          setBlob(new Blob(chunks.current, { type: "audio/webm" }));
          stream.getTracks().forEach((track) => track.stop());
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

  const durationLabel = recording
    ? `${formatMMSS(seconds * 1000)} / ${formatMMSS(limit * 1000)}`
    : `Ready · limit ${formatMMSS(limit * 1000)}`;
  return (
    <div className="task-layout">
      <section className="panel task-main">
        <div className="task-meta">
          <span className="chip">{type}</span>
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
        <p className="instruction">
          {question?.prompt ||
            "Your speaking question will load from the practice library."}
        </p>
        {question?.imageUrl && (
          <img
            src={question.imageUrl}
            alt={question?.title || "Practice question image"}
            style={{ maxWidth: "100%", borderRadius: 9, margin: "12px 0" }}
          />
        )}
        {question?.audioUrl && (
          <audio className="audio" controls src={question.audioUrl} />
        )}
        <div className="record-box">
          {recording ? (
            <>
              <div className="pulse">
                <Mic size={30} />
              </div>
              <h3>Recording...</h3>
            </>
          ) : (
            <>
              <div className="mic-circle">
                <Mic size={30} />
              </div>
              <h3>Record your answer</h3>
              <p className="muted">
                Speak naturally and clearly. Your browser can transcribe speech
                when supported. Only your transcript is evaluated —
                pronunciation and audio quality are not analyzed.
              </p>
            </>
          )}
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
            <button
              className="primary"
              disabled={!blob || busy}
              onClick={submit}
            >
              {busy ? "Evaluating..." : "Submit for AI Feedback"}
            </button>
          </div>
        )}
        {question?.type === "describe-image" && question?.answer && (
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
                <b>Model Answer</b>
                <p>{question.answer}</p>
              </div>
            )}
          </>
        )}
      </section>
      <aside className="panel tips">
        <h3>Speaking tips</h3>
        <ul>
          <li>Maintain steady fluency.</li>
          <li>Pronounce words clearly.</li>
          <li>Avoid long pauses.</li>
          <li>Focus on the whole prompt.</li>
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
