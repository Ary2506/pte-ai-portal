import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { AlertCircle, Mic, Play, Sparkles } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";
import readAloudContent from "../../content/speaking/read-aloud/read_aloud.json";

// client/content/speaking/read-aloud/read_aloud.json is the single source of truth: question
// count and order both come directly from the file's own length and array order. Adding,
// removing, or reordering questions requires editing only that JSON — no id list or count is
// maintained here. A structurally malformed entry (missing id/title/text, wrong type, or a
// duplicate id) is rejected wholesale rather than partially rendered — an honest empty state
// (below) is always safer than silently showing content that doesn't match the file.
const RECORD_LIMIT_SECONDS = 40;

function buildReadAloudQuestions() {
  const items = Array.isArray(readAloudContent) ? readAloudContent : [];
  const valid =
    items.length > 0 &&
    items.every((item) => item && item.id != null && item.title && item.question && item.answer && item.type === "Read Aloud") &&
    new Set(items.map((item) => item.id)).size === items.length;
  if (!valid) {
    console.error(
      "Read Aloud content failed validation (empty bank, missing fields, wrong type, or duplicate ids) — refusing to render it.",
    );
    return [];
  }
  // question/answer text is used exactly as-is from the JSON — never edited, corrected, or
  // reworded here.
  return items.map((item) => ({
    _id: String(item.id),
    title: item.title,
    passage: item.question,
    answer: item.answer,
  }));
}

const READ_ALOUD_QUESTIONS = buildReadAloudQuestions();

function formatMMSS(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function ReadAloudPractice() {
  const total = READ_ALOUD_QUESTIONS.length;
  const [idx, setIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // The real, actually-submitted result per question this session — used only to build an honest
  // completion summary (count attempted, real average score). Never a fabricated statistic.
  const [attempts, setAttempts] = useState({});
  const recorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const elapsed = useRef(0);
  const replayRef = useRef(null);

  const finished = idx >= total;
  const question = !finished ? READ_ALOUD_QUESTIONS[idx] : null;

  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    clearInterval(timer.current);
    if (recorder.current) {
      try { recorder.current.stop(); } catch { /* already stopped */ }
      recorder.current = null;
    }
    setRecording(false);
    setSeconds(0);
    setBlob(null);
    setAudioUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return null;
    });
    setShowAnswer(false);
    setError("");
    setBusy(false);
    setRetrying(false);
    elapsed.current = 0;
    chunks.current = [];
    setResult(question ? attempts[question._id] || null : null);
    // Only re-run when the question actually changes — attempts is read, not depended on, so
    // recording a result for the current question doesn't itself reset the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  function stop() {
    if (!recorder.current) return;
    clearInterval(timer.current);
    recorder.current.stop();
    recorder.current = null;
    setRecording(false);
  }

  function start() {
    setError("");
    setResult(null);
    setBlob(null);
    setAudioUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return null;
    });
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
          const recordedBlob = new Blob(chunks.current, { type: "audio/webm" });
          setBlob(recordedBlob);
          setAudioUrl(URL.createObjectURL(recordedBlob));
          stream.getTracks().forEach((track) => track.stop());
        };
        mediaRecorder.start();
        setRecording(true);
        setSeconds(0);
        timer.current = setInterval(() => {
          elapsed.current += 1;
          setSeconds(elapsed.current);
          if (elapsed.current >= RECORD_LIMIT_SECONDS) stop();
        }, 1000);
      })
      .catch(() =>
        setError("Microphone permission is required. Check your browser permissions and try again."),
      );
  }

  function replay() {
    replayRef.current?.play();
  }

  async function submit() {
    if (!blob) {
      setError("Record an answer first.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("audio", blob, "read-aloud.webm");
    form.append("section", "speaking");
    form.append("type", "read-aloud");
    form.append("durationSeconds", seconds);
    // Deliberately no questionId: these ids (269, 302, ...) are this JSON bank's own ids, not
    // MongoDB ObjectIds — sending one would fail Question.findById with a cast error. Omitting it
    // uses the exact same "freeform" AI-evaluated path the backend already supports for a
    // submission with no linked question (server/src/routes/submissions.js) — the real, existing
    // scoring pipeline, not a new one.
    try {
      const data = await api.submit(form);
      setResult(data.submission);
      setAttempts((previous) => ({ ...previous, [question._id]: data.submission }));
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!result?._id) return;
    setRetrying(true);
    setError("");
    try {
      const data = await api.retryEvaluation(result._id);
      setResult(data.submission);
      setAttempts((previous) => ({ ...previous, [question._id]: data.submission }));
    } catch (retryError) {
      setError(retryError.message);
    } finally {
      setRetrying(false);
    }
  }

  function goPrevious() {
    setIdx((i) => Math.max(0, i - 1));
  }
  function goNext() {
    setIdx((i) => Math.min(total, i + 1));
  }
  function restart() {
    setAttempts({});
    setIdx(0);
  }

  if (!total) {
    return (
      <div className="panel error-state">
        <AlertCircle size={30} />
        <h4>Read Aloud content is unavailable</h4>
        <p>The bundled Read Aloud question set did not pass validation. Please contact an administrator.</p>
      </div>
    );
  }

  if (finished) {
    const attemptedResults = Object.values(attempts);
    const scored = attemptedResults.filter((attempt) => attempt.evaluationStatus === "COMPLETED");
    const average = scored.length
      ? Math.round(scored.reduce((sum, attempt) => sum + attempt.score, 0) / scored.length)
      : null;
    return (
      <div className="panel task-main narrow">
        <div className="task-meta">
          <span className="chip">Read Aloud</span>
        </div>
        <h2>Practice Completed 🎉</h2>
        <p className="instruction">You've gone through all {total} Read Aloud questions.</p>
        <div className="answer-reveal" style={{ marginTop: 16 }}>
          <b>Session summary</b>
          <p>
            {attemptedResults.length} of {total} question{total === 1 ? "" : "s"} submitted for AI
            feedback.
          </p>
          {average !== null && <p>Average score on submitted questions: {average}/90.</p>}
        </div>
        <div className="task-actions" style={{ marginTop: 20 }}>
          <button className="secondary" onClick={restart}>
            Restart Practice
          </button>
          <NavLink className="primary" to="/practice">
            Back to Practice Hub
          </NavLink>
        </div>
      </div>
    );
  }

  const durationLabel = recording
    ? `${formatMMSS(seconds * 1000)} / ${formatMMSS(RECORD_LIMIT_SECONDS * 1000)}`
    : `Ready · limit ${formatMMSS(RECORD_LIMIT_SECONDS * 1000)}`;

  return (
    <>
      <div className="mock-progress-bar" role="group" aria-label="Question navigation">
        <span>
          Question {idx + 1} of {total}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="secondary" onClick={goPrevious} disabled={idx === 0}>
            Previous
          </button>
          <button className="primary" onClick={goNext}>
            {idx === total - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
      <div
        className="mock-progress-track"
        role="progressbar"
        aria-valuenow={idx + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuetext={`Question ${idx + 1} of ${total}`}
      >
        <div className="mock-progress-fill" style={{ width: `${((idx + 1) / total) * 100}%` }} />
      </div>
      <div className="task-layout">
        <section className="panel task-main">
          <div className="task-meta">
            <span className="chip">Read Aloud</span>
            <span className={seconds >= RECORD_LIMIT_SECONDS ? "speaking-duration-cap low" : "speaking-duration-cap"}>
              {durationLabel}
            </span>
          </div>
          <h2>{question.title}</h2>
          <div className="passage">{question.passage}</div>
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
                  Read the passage aloud clearly, then stop recording when you're done. Only your
                  recording is evaluated — pronunciation scoring is not part of this practice mode.
                </p>
              </>
            )}
          </div>
          {audioUrl && <audio ref={replayRef} src={audioUrl} style={{ display: "none" }} />}
          {error && <div className="alert error">{error}</div>}
          {result ? (
            <Result result={result} onRetry={retry} retrying={retrying} />
          ) : (
            <div className="task-actions">
              <button className="secondary" onClick={recording ? stop : start} disabled={busy}>
                {recording ? "Stop Recording" : "Start Recording"}
              </button>
              <button className="secondary" onClick={replay} disabled={!blob || recording}>
                <Play size={15} style={{ verticalAlign: "middle", marginRight: 4 }} />
                Replay Recording
              </button>
              <button className="primary" disabled={!blob || busy} onClick={submit}>
                {busy ? "Evaluating..." : "Submit for AI Feedback"}
              </button>
            </div>
          )}
          <button type="button" className="secondary answer-toggle" onClick={() => setShowAnswer((value) => !value)}>
            {showAnswer ? "Hide Answer" : "Show Answer"}
          </button>
          {showAnswer && (
            <div className="answer-reveal">
              <b>Answer</b>
              <p>{question.answer}</p>
            </div>
          )}
        </section>
        <aside className="panel tips">
          <h3>Read Aloud tips</h3>
          <ul>
            <li>Read at a natural, steady pace.</li>
            <li>Pronounce every word clearly.</li>
            <li>Use natural intonation, not a flat monotone.</li>
            <li>Don't rush — fluency matters more than speed.</li>
          </ul>
          <div className="tip-box">
            <Sparkles size={18} />
            <b>AI analysis</b>
            <p>We evaluate your submitted recording and return a practice score.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

export { ReadAloudPractice, READ_ALOUD_QUESTIONS };
