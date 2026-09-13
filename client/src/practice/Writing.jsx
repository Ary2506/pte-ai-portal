import React, { useState } from "react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";

const WRITING_WORD_RANGES = { swt: [40, 100], essay: [200, 300] };

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

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="task-layout">
      <section className="panel task-main">
        <div className="task-meta">
          <span className="chip">{type}</span>
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
      </section>
      <aside className="panel tips">
        <h3>Writing tips</h3>
        <ul>
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
