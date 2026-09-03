import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api } from "./api.js";

export function Result({ result, onRetry, retrying }) {
  if (result.evaluationStatus === "FAILED") {
    return <div className="result bad">
      <b>Evaluation failed.</b>
      <p>{result.feedback?.overall || "AI evaluation is temporarily unavailable. Please try again."}</p>
      {onRetry && <button className="secondary" style={{marginTop:10}} onClick={onRetry} disabled={retrying}>{retrying ? "Retrying..." : "Retry Evaluation"}</button>}
    </div>;
  }

  const f = result.feedback || {};
  const methodLabel = f.scoringMethod === "ai" ? "AI Practice Evaluation" : "Heuristic Practice Evaluation";
  const criteriaEntries = f.criteria ? Object.entries(f.criteria) : [];
  return <div className="result-panel">
    <div className="score-ring"><strong>{result.score}</strong><small>/ {result.maxScore || 90}</small></div>
    <div>
      <h3>{methodLabel}</h3>
      {!!criteriaEntries.length && <div className="feedback-group"><b>Breakdown</b>{criteriaEntries.map(([key, value]) => <p key={key} style={{textTransform:"capitalize"}}>{key}: {value} / 100</p>)}</div>}
      {!!f.strengths?.length && <div className="feedback-group"><b>Strengths</b>{f.strengths.map((x, i) => <p key={i}><CheckCircle2 size={15} /> {x}</p>)}</div>}
      {!!f.improvements?.length && <div className="feedback-group"><b>Improvements</b>{f.improvements.map((x, i) => <p key={i}>{x}</p>)}</div>}
      {!!f.mistakes?.length && <div className="feedback-group"><b>Mistakes</b>{f.mistakes.map((m, i) => <div key={i} style={{marginBottom:10}}>
        <p style={{textTransform:"capitalize"}}><b>{m.type}</b>{m.studentText ? ` — "${m.studentText}"` : ""}</p>
        <p className="muted">{m.problem}</p>
        {m.correction && <p>Suggested correction: "{m.correction}"</p>}
        {m.explanation && <p className="muted">{m.explanation}</p>}
      </div>)}</div>}
      {f.overall && <p className="feedback-overall">{f.overall}</p>}
      {f.note && <p className="muted feedback-note">{f.note}</p>}
      <p className="disclaimer">Practice evaluation — not an official Pearson PTE score.</p>
    </div>
  </div>;
}

export function ObjectiveResult({ result }) {
  const f = result.feedback || {};
  const pct = result.maxScore ? Math.round((result.score / result.maxScore) * 100) : 0;
  return <div className={f.correct ? "result good" : "result bad"}>
    <b>{f.correct ? "Correct!" : "Not quite."}</b>
    <span>Practice score: {result.score} / {result.maxScore} ({pct}%)</span>
    {/* The server already knows the answer key — this is never AI-generated (see B4). Shown only
        when incorrect; "Your answer" is already shown by the caller (e.g. MockResultRow) or is
        visually evident from the disabled, still-selected option in the practice view itself. */}
    {!f.correct && f.correctAnswerText != null && <p className="muted">Correct answer: {f.correctAnswerText}</p>}
    {(f.feedback || []).map((x, i) => <p key={i}>{x}</p>)}
  </div>;
}

function ReorderList({ options, order, setOrder, disabled }) {
  function move(pos, dir) {
    const target = pos + dir;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[pos], next[target]] = [next[target], next[pos]];
    setOrder(next);
  }
  return <ol className="reorder-list">
    {order.map((optIdx, pos) => <li className="reorder-item" key={optIdx}>
      <span className="reorder-pos">{pos + 1}</span>
      <span className="reorder-text">{options[optIdx]}</span>
      <span className="reorder-controls">
        <button type="button" className="icon-btn" disabled={disabled || pos === 0} onClick={() => move(pos, -1)} aria-label="Move up">↑</button>
        <button type="button" className="icon-btn" disabled={disabled || pos === order.length - 1} onClick={() => move(pos, 1)} aria-label="Move down">↓</button>
      </span>
    </li>)}
  </ol>;
}

// Shared by ReadingTask and ListeningTask — a checkbox-based multi-select for mcq-multiple
// (Phase 17), the same evaluationType: "objective" contract as single-choice, just with an array
// answer. Server remains the sole authority on correctness (scoreMultipleChoice, already existing
// since Phase 9); this only collects the selection.
function MultiChoiceOptions({ options, selected, toggle, disabled }) {
  return <div className="options">{(options || []).map((x, i) => <label className={selected.includes(i) ? "option selected" : "option"} key={i}>
    <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} disabled={disabled} />{x}
  </label>)}</div>;
}

export function ReadingTask({ question, testSessionId, onAnswered }) {
  const [choice, setChoice] = useState("");
  const [multi, setMulti] = useState([]);
  const [order, setOrder] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChoice(""); setMulti([]);
    setOrder(question?.type === "reorder" ? (question.options || []).map((_, i) => i) : null);
    setResult(null);
    setError("");
  }, [question?._id]);

  if (!question) return <div className="panel task-main narrow"><Empty text="No reading question is available in the library for this task yet." /></div>;
  const isReorder = question.type === "reorder";
  const isMulti = question.type === "mcq-multiple";

  function toggleMulti(i) { setMulti(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]); }

  async function submit() {
    setBusy(true); setError("");
    const f = new FormData();
    f.append("section", "reading");
    f.append("type", question.type);
    f.append("answer", JSON.stringify(isReorder ? order : isMulti ? multi : choice));
    if (question._id) f.append("questionId", question._id);
    if (testSessionId) f.append("testSessionId", testSessionId);
    try {
      const d = await api.submit(f);
      setResult(d.submission);
      onAnswered?.(d.submission);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const canSubmit = isReorder ? !!order : isMulti ? multi.length > 0 : choice !== "";

  return <div className="panel task-main narrow">
    <div className="task-meta"><span className="chip">Reading</span><span>Timed practice</span></div>
    <h2>{question.title}</h2>
    <p className="instruction">{question.prompt}</p>
    {question.passage && <div className="passage">{question.passage}</div>}
    {isReorder
      ? <ReorderList options={question.options} order={order} setOrder={setOrder} disabled={!!result} />
      : isMulti
      ? <MultiChoiceOptions options={question.options} selected={multi} toggle={toggleMulti} disabled={!!result} />
      : <div className="options">{(question.options || []).map((x, i) => <label className={String(choice) === String(i) ? "option selected" : "option"} key={i}>
          <input type="radio" checked={String(choice) === String(i)} onChange={() => setChoice(i)} disabled={!!result} />{x}
        </label>)}</div>}
    {error && <div className="alert error">{error}</div>}
    {result
      ? <ObjectiveResult result={result} />
      : <button className="primary right" onClick={submit} disabled={busy || !canSubmit}>{busy ? "Submitting..." : "Submit Answer"}</button>}
  </div>;
}

export function ListeningTask({ question, testSessionId, onAnswered }) {
  const [choice, setChoice] = useState("");
  const [multi, setMulti] = useState([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => { setChoice(""); setMulti([]); setText(""); setResult(null); setError(""); }, [question?._id]);

  if (!question) return <div className="panel task-main narrow"><Empty text="No listening question is available in the library for this task yet." /></div>;
  const isChoice = question.type === "mcq-single";
  const isMulti = question.type === "mcq-multiple";
  const isFreeText = !isChoice && !isMulti;

  function toggleMulti(i) { setMulti(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]); }

  async function submit() {
    setBusy(true); setError("");
    const f = new FormData();
    f.append("section", "listening");
    f.append("type", question.type);
    f.append("answer", JSON.stringify(isChoice ? choice : isMulti ? multi : text));
    if (isFreeText) f.append("transcript", text);
    if (question._id) f.append("questionId", question._id);
    if (testSessionId) f.append("testSessionId", testSessionId);
    try {
      const d = await api.submit(f);
      setResult(d.submission);
      onAnswered?.(d.submission);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function retry() {
    setRetrying(true); setError("");
    try { setResult((await api.retryEvaluation(result._id)).submission); }
    catch (e) { setError(e.message); }
    finally { setRetrying(false); }
  }

  const canSubmit = isChoice ? choice !== "" : isMulti ? multi.length > 0 : !!text.trim();

  return <div className="panel task-main narrow">
    <div className="task-meta"><span className="chip">Listening</span><span>Audio practice</span></div>
    <h2>{question.title}</h2>
    <p className="instruction">{question.prompt}</p>
    {question.audioUrl && <audio className="audio" controls src={question.audioUrl} />}
    {isChoice
      ? <div className="options">{(question.options || []).map((x, i) => <label className={String(choice) === String(i) ? "option selected" : "option"} key={i}>
          <input type="radio" checked={String(choice) === String(i)} onChange={() => setChoice(i)} disabled={!!result} />{x}
        </label>)}</div>
      : isMulti
      ? <MultiChoiceOptions options={question.options} selected={multi} toggle={toggleMulti} disabled={!!result} />
      : <textarea className="answer-area compact" value={text} onChange={e => setText(e.target.value)} placeholder="Type your response..." disabled={!!result} />}
    {error && <div className="alert error">{error}</div>}
    {result
      ? (question.evaluationType === "objective" ? <ObjectiveResult result={result} /> : <Result result={result} onRetry={retry} retrying={retrying} />)
      : <button className="primary right" onClick={submit} disabled={busy || !canSubmit}>{busy ? "Evaluating..." : "Submit"}</button>}
  </div>;
}

function Empty({ text }) { return <div className="empty">{text}</div>; }
