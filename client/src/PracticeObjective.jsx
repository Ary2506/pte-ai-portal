import { useEffect, useState, Fragment } from "react";
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

// Highlight Incorrect Words (Phase 20): the transcript's individual words ARE question.options
// (in reading order); the student clicks each word that doesn't match what they heard. Reuses the
// exact same selected-indices array and toggle() the checkbox-based MultiChoiceOptions uses — only
// the rendering differs (inline flowing words, not a vertical list) — so it submits and scores
// (scoreMultipleChoice) identically to mcq-multiple, with zero new backend logic.
function HighlightWords({ options, selected, toggle, disabled }) {
  return <p className="highlight-words" role="group" aria-label="Click every word that does not match what you heard">
    {(options || []).map((word, i) => <button type="button" key={i}
      className={selected.includes(i) ? "highlight-word selected" : "highlight-word"}
      onClick={() => toggle(i)} disabled={disabled} aria-pressed={selected.includes(i)}>{word}</button>)}
  </p>;
}

// Fill in the Blanks — inline dropdown (Phase 20, Part 6): question.passage carries the sentence
// with a single "____" blank; renders it as real prose with a native <select> standing in for the
// blank, instead of listing the options as a separate generic choice list below the passage.
// fill-blanks only ever has one blank (a single answer index) — see FillBlanksDragDrop below for
// the multi-blank drag-and-drop variant.
function FillBlankInline({ passage, options, value, onChange, disabled }) {
  const [before, after] = passage.split("____");
  return <p className="passage fill-blank-inline">
    {before}
    <select value={value} onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))} disabled={disabled} aria-label="Choose the word that completes the sentence">
      <option value="">— choose —</option>
      {(options || []).map((o, i) => <option key={i} value={i}>{o}</option>)}
    </select>
    {after}
  </p>;
}

// Fill in the Blanks — Drag and Drop (Phase 20, Part 6): question.passage carries the text with
// N "____" blanks; question.options is the draggable word pool (may include decoy words never
// used). `placement` is an array of length N — placement[i] is the pool index filling blank i, or
// null if empty. Real HTML5 drag-and-drop is layered on top of a click-to-select-then-click-to-
// place interaction that is the primary path — every blank and every word is a native <button>,
// so the whole thing is keyboard-operable (Tab + Enter/Space) without a separate code path.
function DragFillBlanks({ passage, options, placement, setPlacement, disabled }) {
  const [selectedPool, setSelectedPool] = useState(null);
  const segments = passage.split("____");
  const blankCount = segments.length - 1;
  const usedPoolIdx = new Set(placement.filter(v => v !== null && v !== undefined));
  const poolIndices = options.map((_, i) => i).filter(i => !usedPoolIdx.has(i));

  function placeAt(blankIdx, poolIdx) {
    if (disabled) return;
    const next = [...placement];
    next[blankIdx] = poolIdx;
    setPlacement(next);
    setSelectedPool(null);
  }
  function clearBlank(blankIdx) {
    if (disabled) return;
    const next = [...placement];
    next[blankIdx] = null;
    setPlacement(next);
  }
  function onBlankActivate(blankIdx) {
    if (disabled) return;
    if (placement[blankIdx] !== null && placement[blankIdx] !== undefined) { clearBlank(blankIdx); return; }
    if (selectedPool !== null) placeAt(blankIdx, selectedPool);
  }
  function onWordActivate(poolIdx) {
    if (disabled) return;
    setSelectedPool(prev => (prev === poolIdx ? null : poolIdx));
  }
  function onDrop(e, blankIdx) {
    e.preventDefault();
    if (disabled) return;
    const poolIdx = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isInteger(poolIdx)) placeAt(blankIdx, poolIdx);
  }

  return <div className="drag-fill">
    <p className="passage drag-fill-passage">
      {segments.map((seg, i) => <Fragment key={i}>
        {seg}
        {i < blankCount && <button type="button"
          className={placement[i] !== null && placement[i] !== undefined ? "drag-fill-blank filled" : "drag-fill-blank"}
          onClick={() => onBlankActivate(i)} onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, i)} disabled={disabled}
          aria-label={placement[i] !== null && placement[i] !== undefined
            ? `Blank ${i + 1}: ${options[placement[i]]}. Activate to clear it.`
            : `Blank ${i + 1}: empty. Select a word below, then activate this blank to place it.`}>
          {placement[i] !== null && placement[i] !== undefined ? options[placement[i]] : "＿＿＿＿"}
        </button>}
      </Fragment>)}
    </p>
    <div className="drag-fill-pool" role="listbox" aria-label="Available words">
      {poolIndices.map(i => <button type="button" key={i} draggable={!disabled}
        onDragStart={e => e.dataTransfer.setData("text/plain", String(i))}
        className={selectedPool === i ? "drag-fill-chip selected" : "drag-fill-chip"}
        onClick={() => onWordActivate(i)} disabled={disabled} aria-pressed={selectedPool === i}>{options[i]}</button>)}
      {!poolIndices.length && <span className="muted" style={{fontSize:12}}>All words placed.</span>}
    </div>
  </div>;
}

export function ReadingTask({ question, testSessionId, onAnswered, existingResult }) {
  const [choice, setChoice] = useState("");
  const [multi, setMulti] = useState([]);
  const [order, setOrder] = useState(null);
  const [dragPlacement, setDragPlacement] = useState(null);
  const [result, setResult] = useState(() => existingResult || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const isReorderQ = question?.type === "reorder";
    const isMultiQ = question?.type === "mcq-multiple";
    const isDragFillQ = question?.type === "fill-blanks-dragdrop";
    const blankCount = isDragFillQ ? (question.passage?.match(/____/g) || []).length : 0;
    const submittedAnswer = existingResult?.answer;
    // Reopening an already-answered question (Phase 19, Part 10) shows its real stored result —
    // never re-scored, never re-sent to AI — instead of a blank form, with the selection/order
    // seeded from what was actually submitted so the disabled options visually show the real
    // answer (same convention ObjectiveResult already relies on for a fresh submission).
    // existingResult is only ever set by the standalone practice flow (PracticeTask), which
    // already remounts this component fresh per question; Mock never passes it, so this is a
    // no-op there, exactly as before.
    setChoice(existingResult && !isReorderQ && !isMultiQ && !isDragFillQ && submittedAnswer !== undefined ? submittedAnswer : "");
    setMulti(existingResult && isMultiQ && Array.isArray(submittedAnswer) ? submittedAnswer : []);
    setOrder(isReorderQ ? (existingResult && Array.isArray(submittedAnswer) ? submittedAnswer : (question.options || []).map((_, i) => i)) : null);
    setDragPlacement(isDragFillQ ? (existingResult && Array.isArray(submittedAnswer) ? submittedAnswer : Array(blankCount).fill(null)) : null);
    setResult(existingResult || null);
    setError("");
  }, [question?._id]);

  if (!question) return <div className="panel task-main narrow"><Empty text="No reading question is available in the library for this task yet." /></div>;
  const isReorder = question.type === "reorder";
  const isMulti = question.type === "mcq-multiple";
  const isInlineFillBlank = question.type === "fill-blanks" && question.passage?.includes("____");
  const isDragFill = question.type === "fill-blanks-dragdrop";

  function toggleMulti(i) { setMulti(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]); }

  async function submit() {
    setBusy(true); setError("");
    const f = new FormData();
    f.append("section", "reading");
    f.append("type", question.type);
    f.append("answer", JSON.stringify(isReorder ? order : isMulti ? multi : isDragFill ? dragPlacement : choice));
    if (question._id) f.append("questionId", question._id);
    if (testSessionId) f.append("testSessionId", testSessionId);
    try {
      const d = await api.submit(f);
      setResult(d.submission);
      onAnswered?.(d.submission);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const canSubmit = isReorder ? !!order : isMulti ? multi.length > 0
    : isDragFill ? !!dragPlacement && dragPlacement.every(v => v !== null && v !== undefined)
    : choice !== "";

  return <div className="panel task-main narrow">
    <div className="task-meta"><span className="chip">Reading</span><span>Timed practice</span></div>
    <h2>{question.title}</h2>
    <p className="instruction">{question.prompt}</p>
    {question.passage && !isInlineFillBlank && !isDragFill && <div className="passage">{question.passage}</div>}
    {isReorder
      ? <ReorderList options={question.options} order={order} setOrder={setOrder} disabled={!!result} />
      : isMulti
      ? <MultiChoiceOptions options={question.options} selected={multi} toggle={toggleMulti} disabled={!!result} />
      : isDragFill
      ? (dragPlacement && <DragFillBlanks passage={question.passage} options={question.options} placement={dragPlacement} setPlacement={setDragPlacement} disabled={!!result} />)
      : isInlineFillBlank
      ? <FillBlankInline passage={question.passage} options={question.options} value={choice} onChange={setChoice} disabled={!!result} />
      : <div className="options">{(question.options || []).map((x, i) => <label className={String(choice) === String(i) ? "option selected" : "option"} key={i}>
          <input type="radio" checked={String(choice) === String(i)} onChange={() => setChoice(i)} disabled={!!result} />{x}
        </label>)}</div>}
    {error && <div className="alert error">{error}</div>}
    {result
      ? <ObjectiveResult result={result} />
      : <button className="primary right" onClick={submit} disabled={busy || !canSubmit}>{busy ? "Submitting..." : "Submit Answer"}</button>}
  </div>;
}

export function ListeningTask({ question, testSessionId, onAnswered, existingResult }) {
  const [choice, setChoice] = useState("");
  const [multi, setMulti] = useState([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState(() => existingResult || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // mcq-single, fill-blanks, and select-missing-word are all mechanically the same "pick one
    // option" shape for listening — only the task framing differs, which the prompt/instructions
    // already convey.
    const isChoiceQ = ["mcq-single", "fill-blanks", "select-missing-word"].includes(question?.type);
    const isMultiQ = ["mcq-multiple", "highlight-incorrect-words"].includes(question?.type);
    const submittedAnswer = existingResult?.answer;
    // Same reopened-completed-question behavior as ReadingTask (Phase 19, Part 10) — seeded from
    // the stored submission, never re-evaluated.
    setChoice(existingResult && isChoiceQ && submittedAnswer !== undefined ? submittedAnswer : "");
    setMulti(existingResult && isMultiQ && Array.isArray(submittedAnswer) ? submittedAnswer : []);
    setText(existingResult && !isChoiceQ && !isMultiQ ? (existingResult.transcript || (typeof submittedAnswer === "string" ? submittedAnswer : "")) : "");
    setResult(existingResult || null);
    setError("");
  }, [question?._id]);

  if (!question) return <div className="panel task-main narrow"><Empty text="No listening question is available in the library for this task yet." /></div>;
  const isChoice = ["mcq-single", "fill-blanks", "select-missing-word"].includes(question.type);
  const isHighlight = question.type === "highlight-incorrect-words";
  const isMulti = question.type === "mcq-multiple" || isHighlight;
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
    {/* Listening Fill in the Blanks needs the blanked sentence itself visible to read along with
        the audio — ReadingTask has always shown its passage; this was the one place Listening
        never did. Harmless no-op for every other listening type, which never sets a passage. */}
    {question.passage && <div className="passage">{question.passage}</div>}
    {isChoice
      ? <div className="options">{(question.options || []).map((x, i) => <label className={String(choice) === String(i) ? "option selected" : "option"} key={i}>
          <input type="radio" checked={String(choice) === String(i)} onChange={() => setChoice(i)} disabled={!!result} />{x}
        </label>)}</div>
      : isHighlight
      ? <HighlightWords options={question.options} selected={multi} toggle={toggleMulti} disabled={!!result} />
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
