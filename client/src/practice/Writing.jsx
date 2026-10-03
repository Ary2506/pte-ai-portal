import React, { useState } from "react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";

const WRITING_WORD_RANGES = { swt: [40, 100], essay: [200, 300] };
const WRITING_TASK_NAMES = { swt: "Summarize Written Text", essay: "Write Essay", email: "Write Email" };

function WordCountBadge({ count, range }) {
  if (!range) return <span className="word-count">{count} words</span>;
  const [min, max] = range;
  const tone = count < min ? "low" : count > max ? "high" : "good";
  return (
    <span className={`word-count ${tone}`}>
      {count} / {min}–{max} words
    </span>
  );
}

export default function Writing({
  type,
  question,
  testSessionId,
  onAnswered,
  existingResult,
}) {
  const [text, setText] = useState(
    () =>
      existingResult?.transcript ||
      (typeof existingResult?.answer === "string" ? existingResult.answer : ""),
  );
  const [result, setResult] = useState(() => existingResult || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Reset per question by the key={question._id} remount PracticeTask already does.
  const [showAnswer, setShowAnswer] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function submit() {
    if (!text.trim()) {
      setError("Write a response before submitting.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("section", "writing");
    form.append("type", type);
    form.append("answer", JSON.stringify(text));
    form.append("transcript", text);
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
    setText("");
    setResult(null);
    setError("");
    setBusy(false);
    setRetrying(false);
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  // Counted the same way the badge is, so the panel and the badge can never disagree.
  const sentenceCount = text.trim() ? text.trim().split(/[.!?]+(?:\s|$)/).filter(Boolean).length : 0;
  const range = WRITING_WORD_RANGES[question?.type];
  const tone = range ? (wordCount < range[0] ? "low" : wordCount > range[1] ? "high" : "good") : "good";
  // The scale runs a little past the maximum so going over is visible rather than pinned at full.
  const overMax = range ? range[1] * 1.25 : 1;
  return (
    <div className="task-layout">
      <section className="panel task-main">
        <div className="task-meta">
          {/* The section, matching the other three task components — not `type`, which rendered
              the raw slug ("swt", "essay") that the breadcrumb and task tabs already show. */}
          <span className="chip">Writing</span>
          <WordCountBadge
            count={wordCount}
            range={WRITING_WORD_RANGES[question?.type]}
          />
        </div>
        <h2>{question?.title || type}</h2>
        <p className="instruction">
          {question?.prompt || "Write your answer below."}
        </p>
        {question?.passage && <div className="passage">{question.passage}</div>}
        <textarea
          className="answer-area"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type your answer here..."
          disabled={!!result}
        />
        {error && <div className="alert error">{error}</div>}
        {result ? (
          <Result result={result} onRetry={retry} retrying={retrying} />
        ) : (
          <button
            className="primary right"
            disabled={!text.trim() || busy}
            onClick={submit}
          >
            {busy ? "Evaluating..." : "Submit for AI Feedback"}
          </button>
        )}
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
        {/* Gated on a reference answer actually existing, not on the task type: Summarize Written
            Text has one for some questions and Essay has none at all, so keying this on type
            would either hide a real model answer or offer a button that reveals nothing.
            Writing is AI-scored, so this is a reference to compare against — never a key the
            student is marked on, which is why it can be shown before submitting. */}
        {typeof question?.answer === "string" && question.answer.trim() && (
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
                <b>Sample answer</b>
                <p>{question.answer}</p>
              </div>
            )}
          </>
        )}
      </section>
      <aside className="panel compose-panel">
        <span className="stat-label">Composition</span>
        <h3>{WRITING_TASK_NAMES[question?.type] || "Your response"}</h3>

        {range ? (
          <div className="compose-target">
            <div className="compose-target__head">
              <span className="muted">Word target</span>
              <b className="num-mono">{range[0]}–{range[1]}</b>
            </div>
            {/* The range drawn as a band, so being under, inside or over it is something the
                student sees rather than has to work out from two numbers. */}
            <div className="compose-target__track" role="img"
              aria-label={`${wordCount} words written, target ${range[0]} to ${range[1]}`}>
              <span className="compose-target__band"
                style={{ left: `${(range[0] / overMax) * 100}%`, width: `${((range[1] - range[0]) / overMax) * 100}%` }}/>
              <span className={`compose-target__fill is-${tone}`}
                style={{ width: `${Math.min(100, (wordCount / overMax) * 100)}%` }}/>
            </div>
            <p className={`compose-target__verdict is-${tone}`}>
              {tone === "low" ? `${range[0] - wordCount} more word${range[0] - wordCount === 1 ? "" : "s"} to reach the minimum.`
                : tone === "high" ? `${wordCount - range[1]} word${wordCount - range[1] === 1 ? "" : "s"} over the maximum.`
                : "Within the target range."}
            </p>
          </div>
        ) : (
          <p className="muted">This task has no fixed word target — answer it fully and concisely.</p>
        )}

        <dl className="compose-stats">
          <div><dt>Words</dt><dd className="num-mono">{wordCount}</dd></div>
          <div><dt>Characters</dt><dd className="num-mono">{text.length}</dd></div>
          <div><dt>Sentences</dt><dd className="num-mono">{sentenceCount}</dd></div>
        </dl>

        <ul className="compose-tips">
          <li>Answer the exact task.</li>
          <li>Use clear sentence structure.</li>
          <li>Check grammar and spelling.</li>
          <li>Keep your ideas relevant.</li>
        </ul>
      </aside>
    </div>
  );
}

export { Writing };
