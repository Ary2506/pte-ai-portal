import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Badge, ConfirmDialog, DataTable, Modal } from "../../components/common.jsx";

const DIFFICULTIES = ["easy", "medium", "hard"];
const SECTIONS = ["speaking", "writing", "reading", "listening"];
// Shapes whose stored `answer` is free text written by a human (a model/expected answer for an
// AI-evaluated task), as opposed to choice-single/choice-multiple/reorder/drag-fill/dictation,
// where `answer` is a structural, objectively-checked value. Describe Image and Respond to a
// Situation already use this field today (Show/Hide Answer, AI expected-answer comparison —
// scoring/index.js reads any subjective question's string `answer` the same way) but the admin
// form never exposed a way to set it — this is a real gap being closed, not a new field.
const FREE_TEXT_ANSWER_SHAPES = new Set(["prompt-image", "prompt-audio", "prompt-only", "prompt-passage"]);

function emptyFormFor(types, section) {
  const firstType = types.find(t => t.sections.includes(section)) || types[0];
  return {
    section, type: firstType?.type || "", title: "", prompt: "", passage: "",
    options: ["", ""], answer: "", multiAnswer: [], reorderOrder: null, dragAnswer: null,
    modelAnswer: "", explanation: "", difficulty: "medium", active: true, audioUrl: "", imageUrl: ""
  };
}

function questionToForm(q, types) {
  const isReorder = q.type === "reorder";
  const isDragFill = q.type === "fill-blanks-dragdrop";
  const meta = types?.find(t => t.type === q.type);
  const isFreeTextAnswer = meta && FREE_TEXT_ANSWER_SHAPES.has(meta.shape);
  return {
    section: q.section, type: q.type, title: q.title || "", prompt: q.prompt || "", passage: q.passage || "",
    options: q.options?.length ? q.options : ["", ""],
    answer: typeof q.answer === "number" ? q.answer : "",
    multiAnswer: Array.isArray(q.answer) && !isReorder && !isDragFill ? q.answer : [],
    reorderOrder: isReorder && Array.isArray(q.answer) ? q.answer : null,
    dragAnswer: isDragFill && Array.isArray(q.answer) ? q.answer : null,
    modelAnswer: isFreeTextAnswer && typeof q.answer === "string" ? q.answer : "",
    explanation: q.explanation || "", difficulty: q.difficulty || "medium", active: q.active !== false,
    audioUrl: q.audioUrl || "", imageUrl: q.imageUrl || ""
  };
}

// Practical, shape-aware client-side checks that catch common mistakes before a round trip to
// the server — not a duplicate of every server rule (validation/questionValidation.js remains
// the final authority; the server re-validates everything regardless of what this returns).
// Returns a map of fieldKey -> message; an empty object means the form may be submitted.
function validateForm(form, meta) {
  const errors = {};
  if (!form.title.trim()) errors.title = "A question title is required.";
  if (!form.prompt.trim()) errors.prompt = "A prompt is required.";
  if (!meta) { errors.type = "Select a valid question type."; return errors; }
  const shape = meta.shape;

  if (shape === "prompt-passage" && !form.passage.trim()) {
    errors.passage = "A source passage is required for this task.";
  }
  if (shape === "drag-fill") {
    const blankCount = (form.passage.match(/____/g) || []).length;
    if (!form.passage.trim()) errors.passage = "A passage with blanks is required.";
    else if (blankCount < 1) errors.passage = "The passage must contain at least one blank, marked with ____.";
    const filledOptions = form.options.filter(o => o.trim());
    if (filledOptions.length < Math.max(2, blankCount)) {
      errors.options = "There must be at least as many word options as blanks (at least 2 total).";
    }
    if (!form.dragAnswer?.length || form.dragAnswer.length !== blankCount) {
      errors.dragAnswer = "Assign a correct word to every blank.";
    }
  }
  if (shape === "prompt-image" && !form.imageUrl.trim()) {
    errors.imageUrl = "An image is required for this question type.";
  }
  const needsAudio = shape === "prompt-audio" || shape === "dictation" || form.type === "repeat-sentence"
    || ((shape === "choice-single" || shape === "choice-multiple") && form.section === "listening");
  if (needsAudio && !form.audioUrl.trim()) {
    errors.audioUrl = "An audio file or URL is required for this question type.";
  }
  if (shape === "choice-single") {
    const filledOptions = form.options.filter(o => o.trim());
    if (filledOptions.length < 2) errors.options = "At least 2 options are required.";
    if (form.answer === "" || form.answer === null || form.answer === undefined) {
      errors.answer = "Select the correct option.";
    }
  }
  if (shape === "choice-multiple") {
    const filledOptions = form.options.filter(o => o.trim());
    if (filledOptions.length < 3) errors.options = "At least 3 options are required for a multiple-answer question.";
    if (!form.multiAnswer.length) errors.answer = "Select at least one correct option.";
  }
  if (shape === "reorder") {
    const filledOptions = form.options.filter(o => o.trim());
    if (filledOptions.length < 2) errors.options = "At least 2 items are required to build a re-order question.";
  }
  if (shape === "dictation") {
    if (!form.answer || !String(form.answer).trim()) errors.answer = "The exact sentence is required as the answer.";
    if (!form.audioUrl.trim()) errors.audioUrl = "An audio file or URL is required for a dictation question.";
  }
  // Subjective shapes (prompt-image/prompt-audio/prompt-only/prompt-passage) deliberately have no
  // required-answer check here — a model answer is optional, and none of them use an
  // options/correct-index structure, so there is nothing objective to force.
  return errors;
}

// A compact up/down re-order control — mirrors the student-facing reorder UI so an admin builds
// the correct order the same way a student would experience it.
function OrderPicker({ options, order, setOrder }) {
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
      <span className="reorder-text">{options[optIdx] || <em className="muted">(empty item)</em>}</span>
      <span className="reorder-controls">
        <button type="button" className="icon-btn" disabled={pos === 0} onClick={() => move(pos, -1)} aria-label="Move up">↑</button>
        <button type="button" className="icon-btn" disabled={pos === order.length - 1} onClick={() => move(pos, 1)} aria-label="Move down">↓</button>
      </span>
    </li>)}
  </ol>;
}

// The student-facing rendering shared by both the list view's "View" modal (QuestionPreview,
// unchanged) and the new live in-form preview below — one implementation, so the two can never
// drift apart. Deliberately renders only what a student would receive from the API — answer/
// explanation are never read here, matching the existing, already-established redaction.
function QuestionPreviewBody({ question }) {
  return <div className="panel" style={{ marginTop: 14 }}>
    <div className="task-meta"><span className="chip">{question.section || "—"}</span><span>{question.difficulty || "medium"}</span></div>
    <h2>{question.title || <em className="muted">(untitled question)</em>}</h2>
    <p className="instruction">{question.prompt || <em className="muted">(no prompt yet)</em>}</p>
    {question.passage && <div className="passage">{question.passage}</div>}
    {question.imageUrl && <img src={question.imageUrl} alt={question.title || "Question image"} style={{ maxWidth: "100%", borderRadius: 9, marginTop: 12 }}/>}
    {question.audioUrl && <audio className="audio" controls src={question.audioUrl}/>}
    {!!question.options?.length && <div className="options">{question.options.map((o, i) => <label className="option" key={i}><input type="radio" disabled/>{o || `Item ${i + 1}`}</label>)}</div>}
  </div>;
}

function QuestionForm({ types, initial, onCancel, onSave, saving, error }) {
  const [form, setForm] = useState(() => initial ? questionToForm(initial, types) : emptyFormFor(types, "reading"));
  const [fieldErrors, setFieldErrors] = useState({});
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState("");
  const meta = types.find(t => t.type === form.type);
  const shape = meta?.shape;
  const availableTypes = types.filter(t => t.sections.includes(form.section));
  const isEditing = !!initial;

  useEffect(() => {
    if (shape === "reorder" && (!form.reorderOrder || form.reorderOrder.length !== form.options.length)) {
      update({ reorderOrder: form.options.map((_, i) => i) });
    }
    // eslint-disable-next-line
  }, [shape, form.options.length]);

  // Keeps dragAnswer's length in sync with the number of "____" blanks actually present in the
  // passage — recomputed whenever the passage text or the option pool changes, defaulting any
  // newly-added blank to option 0 rather than leaving it unset.
  useEffect(() => {
    if (shape !== "drag-fill") return;
    const blankCount = (form.passage.match(/____/g) || []).length;
    if (!form.dragAnswer || form.dragAnswer.length !== blankCount) {
      const prev = form.dragAnswer || [];
      update({ dragAnswer: Array.from({ length: blankCount }, (_, i) => prev[i] ?? 0) });
    }
    // eslint-disable-next-line
  }, [shape, form.passage, form.options.length]);

  // Re-validate live once the admin has tried to save at least once, so fixing a field clears
  // its error immediately instead of waiting for the next save attempt.
  useEffect(() => {
    if (attemptedSave) setFieldErrors(validateForm(form, meta));
    // eslint-disable-next-line
  }, [form, attemptedSave]);

  function update(patch) { setForm(f => ({ ...f, ...patch })); }
  function updateOption(i, value) {
    const options = [...form.options]; options[i] = value; update({ options });
  }
  function addOption() { update({ options: [...form.options, ""] }); }
  function removeOption(i) { update({ options: form.options.filter((_, idx) => idx !== i) }); }
  function toggleMulti(i) {
    const has = form.multiAnswer.includes(i);
    update({ multiAnswer: has ? form.multiAnswer.filter(x => x !== i) : [...form.multiAnswer, i] });
  }

  async function handleFileSelected(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = ""; // always allow re-selecting the same file again afterward
    if (!file) return;
    const setUploading = kind === "image" ? setImageUploading : setAudioUploading;
    const setUploadError = kind === "image" ? setImageUploadError : setAudioUploadError;
    setUploading(true); setUploadError("");
    try {
      const res = await api.admin.media.upload(file);
      update(kind === "image" ? { imageUrl: res.url } : { audioUrl: res.url });
    } catch (err) {
      setUploadError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function buildPayload(activeValue) {
    const payload = {
      section: form.section, type: form.type, title: form.title.trim(), prompt: form.prompt.trim(),
      difficulty: form.difficulty, active: activeValue
    };
    if (shape === "prompt-passage") payload.passage = form.passage.trim();
    if (shape === "prompt-image") payload.imageUrl = form.imageUrl.trim();
    if (shape === "prompt-audio" || shape === "dictation") payload.audioUrl = form.audioUrl.trim();
    if (shape === "choice-single") {
      payload.options = form.options.map(o => o.trim());
      payload.answer = form.answer === "" ? undefined : Number(form.answer);
      payload.explanation = form.explanation.trim();
    }
    if (shape === "choice-multiple") {
      payload.options = form.options.map(o => o.trim());
      payload.answer = form.multiAnswer;
      payload.explanation = form.explanation.trim();
    }
    if (shape === "reorder") {
      payload.options = form.options.map(o => o.trim());
      payload.answer = form.reorderOrder;
      payload.explanation = form.explanation.trim();
    }
    if (shape === "dictation") {
      payload.answer = form.answer;
    }
    if (shape === "drag-fill") {
      payload.passage = form.passage.trim();
      payload.options = form.options.map(o => o.trim());
      payload.answer = form.dragAnswer;
      payload.explanation = form.explanation.trim();
    }
    if (FREE_TEXT_ANSWER_SHAPES.has(shape) && form.modelAnswer.trim()) {
      payload.answer = form.modelAnswer.trim();
    }
    return payload;
  }

  function attemptSave(activeValue) {
    setAttemptedSave(true);
    const errs = validateForm(form, meta);
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    onSave(buildPayload(activeValue));
  }

  const hasAnswerConfig = shape === "choice-single" || shape === "choice-multiple" || shape === "reorder" || shape === "drag-fill" || shape === "dictation";
  const isFreeTextAnswerShape = FREE_TEXT_ANSWER_SHAPES.has(shape);
  const needsImage = shape === "prompt-image";
  const needsAudio = shape === "prompt-audio" || shape === "dictation" || form.type === "repeat-sentence"
    || ((shape === "choice-single" || shape === "choice-multiple") && form.section === "listening");
  const busy = saving || imageUploading || audioUploading;
  const previewQuestion = {
    section: form.section, difficulty: form.difficulty, title: form.title, prompt: form.prompt,
    passage: (shape === "prompt-passage" || shape === "drag-fill") ? form.passage : "",
    imageUrl: needsImage ? form.imageUrl : "", audioUrl: needsAudio ? form.audioUrl : "",
    options: (shape === "choice-single" || shape === "choice-multiple" || shape === "reorder") ? form.options : []
  };

  return <form onSubmit={e => e.preventDefault()} className="question-form">
    {error && <div className="alert error">{error}</div>}
    {attemptedSave && Object.keys(fieldErrors).length > 0 && (
      <div className="alert error">Please fix {Object.keys(fieldErrors).length} field{Object.keys(fieldErrors).length === 1 ? "" : "s"} before saving.</div>
    )}

    <div className="form-section">
      <p className="form-section-title">Question information</p>
      <div className="admin-create-form">
        <label>Section
          <select value={form.section} onChange={e => {
            const section = e.target.value;
            const nextType = types.find(t => t.sections.includes(section))?.type || "";
            update({ section, type: nextType });
          }}>
            {SECTIONS.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
        <label>Question type
          <select value={form.type} onChange={e => update({ type: e.target.value })}>
            {availableTypes.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
        </label>
        <label>Difficulty
          <select value={form.difficulty} onChange={e => update({ difficulty: e.target.value })}>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
          </select>
        </label>
        <div>
          <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--ink-soft)" }}>Status</span>
          <div style={{ marginTop: 7 }}><Badge tone={form.active ? "good" : "warn"}>{form.active ? "Published" : "Draft"}</Badge></div>
        </div>
      </div>
      <label>Question title<input required value={form.title} onChange={e => update({ title: e.target.value })} placeholder="Short internal name for this question"/></label>
      {fieldErrors.title && <p className="field-error">{fieldErrors.title}</p>}
    </div>

    <div className="form-section">
      <p className="form-section-title">Content</p>
      <label>Prompt<textarea required className="answer-area compact" value={form.prompt} onChange={e => update({ prompt: e.target.value })} placeholder="What the student is asked to do"/></label>
      {fieldErrors.prompt && <p className="field-error">{fieldErrors.prompt}</p>}
      {shape === "prompt-passage" && <>
        <label>Source passage<textarea required className="answer-area compact" value={form.passage} onChange={e => update({ passage: e.target.value })} placeholder="The text the student must summarize"/></label>
        {fieldErrors.passage && <p className="field-error">{fieldErrors.passage}</p>}
      </>}
      {shape === "drag-fill" && <>
        <label>Passage (mark each blank with ____)<textarea required className="answer-area compact" value={form.passage} onChange={e => update({ passage: e.target.value })} placeholder="The ____ sat on the ____."/></label>
        {fieldErrors.passage && <p className="field-error">{fieldErrors.passage}</p>}
      </>}
    </div>

    {(needsImage || needsAudio) && <div className="form-section">
      <p className="form-section-title">Media</p>
      {needsImage && <div style={{ marginBottom: 16 }}>
        <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Upload an image, or paste an image URL below.</p>
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload image" disabled={imageUploading} onChange={e => handleFileSelected(e, "image")}/>
        {imageUploading && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Uploading image…</p>}
        {imageUploadError && <div className="alert error" style={{ marginTop: 8 }}>{imageUploadError}</div>}
        {form.imageUrl && !imageUploading && <img src={form.imageUrl} alt="Selected question" style={{ maxWidth: 220, borderRadius: 9, marginTop: 10, display: "block" }}/>}
        <label style={{ marginTop: 10 }}>Image URL<input required value={form.imageUrl} onChange={e => update({ imageUrl: e.target.value })} placeholder="https://..."/></label>
        {fieldErrors.imageUrl && <p className="field-error">{fieldErrors.imageUrl}</p>}
      </div>}
      {needsAudio && <div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Upload an audio file, or paste an audio URL below.</p>
        <input type="file" accept="audio/webm,audio/ogg,audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/*" aria-label="Upload audio" disabled={audioUploading} onChange={e => handleFileSelected(e, "audio")}/>
        {audioUploading && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Uploading audio…</p>}
        {audioUploadError && <div className="alert error" style={{ marginTop: 8 }}>{audioUploadError}</div>}
        {form.audioUrl && !audioUploading && <audio className="audio" controls src={form.audioUrl} style={{ marginTop: 10, display: "block" }}/>}
        <label style={{ marginTop: 10 }}>Audio URL<input required value={form.audioUrl} onChange={e => update({ audioUrl: e.target.value })} placeholder="https://..."/></label>
        {fieldErrors.audioUrl && <p className="field-error">{fieldErrors.audioUrl}</p>}
      </div>}
    </div>}

    {(hasAnswerConfig || isFreeTextAnswerShape) && <div className="form-section">
      <p className="form-section-title">Answer</p>

      {(shape === "choice-single" || shape === "choice-multiple" || shape === "reorder" || shape === "drag-fill") && <>
        <h4 className="form-subheading">{shape === "reorder" ? "Items (in their scrambled/displayed order)" : shape === "drag-fill" ? "Word pool (decoy words allowed — not every word needs a blank)" : "Options"}</h4>
        {form.type === "highlight-incorrect-words" && <p className="muted" style={{fontSize:12,marginTop:-4,marginBottom:8}}>Enter the displayed transcript one word per option, in reading order — then check the boxes for the word(s) that are wrong.</p>}
        <div className="option-editor">
          {form.options.map((opt, i) => <div className="option-editor-row" key={i}>
            {shape === "choice-single" && <input type="radio" checked={form.answer !== "" && Number(form.answer) === i} onChange={() => update({ answer: i })} aria-label={`Mark option ${i + 1} correct`}/>}
            {shape === "choice-multiple" && <input type="checkbox" checked={form.multiAnswer.includes(i)} onChange={() => toggleMulti(i)} aria-label={`Mark option ${i + 1} correct`}/>}
            <input value={opt} onChange={e => updateOption(i, e.target.value)} placeholder={`Item ${i + 1}`} aria-label={`Option ${i + 1} text`}/>
            <button type="button" className="text-button" onClick={() => removeOption(i)} disabled={form.options.length <= 2}>Remove</button>
          </div>)}
        </div>
        {fieldErrors.options && <p className="field-error">{fieldErrors.options}</p>}
        <button type="button" className="secondary" onClick={addOption} style={{marginTop:8}}>+ Add {shape === "reorder" ? "item" : "option"}</button>
        {(shape === "choice-single" || shape === "choice-multiple") && <>
          <p className="muted" style={{fontSize:12,marginTop:6}}>Select the correct option(s) — this is the objectively-graded answer key — using the {shape === "choice-single" ? "radio buttons" : "checkboxes"} to the left.</p>
          {fieldErrors.answer && <p className="field-error">{fieldErrors.answer}</p>}
        </>}
      </>}

      {shape === "reorder" && form.reorderOrder && <>
        <h4 className="form-subheading">Correct order</h4>
        <p className="muted" style={{fontSize:12,marginTop:-4,marginBottom:8}}>Arrange the items below into the correct order — this is what the student's answer will be checked against.</p>
        <OrderPicker options={form.options} order={form.reorderOrder} setOrder={order => update({ reorderOrder: order })}/>
      </>}

      {shape === "drag-fill" && form.dragAnswer && <>
        <h4 className="form-subheading">Correct word for each blank</h4>
        {!form.dragAnswer.length && <p className="muted" style={{fontSize:12}}>Add at least one ____ blank to the passage above first.</p>}
        <div className="option-editor">
          {form.dragAnswer.map((optIdx, blankIdx) => <div className="option-editor-row" key={blankIdx}>
            <span className="reorder-pos">{blankIdx + 1}</span>
            <select value={optIdx} aria-label={`Correct word for blank ${blankIdx + 1}`} onChange={e => { const next = [...form.dragAnswer]; next[blankIdx] = Number(e.target.value); update({ dragAnswer: next }); }}>
              {form.options.map((opt, i) => <option key={i} value={i}>{opt || `Item ${i + 1}`}</option>)}
            </select>
          </div>)}
        </div>
        {fieldErrors.dragAnswer && <p className="field-error">{fieldErrors.dragAnswer}</p>}
      </>}

      {shape === "dictation" && <>
        <label>Exact sentence (the correct answer — objectively graded)<input required value={form.answer} onChange={e => update({ answer: e.target.value })} placeholder="The sentence the student must type exactly"/></label>
        {fieldErrors.answer && <p className="field-error">{fieldErrors.answer}</p>}
      </>}

      {isFreeTextAnswerShape && <label>Model answer <span className="muted" style={{fontWeight:400}}>(optional — a strong example response; shown to students via Show/Hide Answer where supported, and used for AI comparison)</span>
        <textarea className="answer-area compact" value={form.modelAnswer} onChange={e => update({ modelAnswer: e.target.value })} placeholder="A model answer for this question"/>
      </label>}

      {(shape === "choice-single" || shape === "choice-multiple" || shape === "reorder" || shape === "drag-fill") &&
        <label>Explanation <span className="muted" style={{fontWeight:400}}>(shown to the student after they answer — optional)</span>
          <textarea className="answer-area compact" value={form.explanation} onChange={e => update({ explanation: e.target.value })} placeholder="Why this is the correct answer"/>
        </label>}
    </div>}

    <div className="form-section form-section-preview" data-testid="live-preview">
      <p className="form-section-title">Preview</p>
      <p className="muted" style={{fontSize:12,marginBottom:0}}>Admin preview — updates live as you edit. This is what a student will see; no answer key or explanation is shown here.</p>
      <QuestionPreviewBody question={previewQuestion}/>
    </div>

    <div className="form-section">
      <p className="form-section-title">Publishing</p>
      {!isEditing && <p className="muted" style={{fontSize:12,marginBottom:10}}>Save as Draft keeps this question hidden from students. Publish makes it available immediately.</p>}
      {isEditing && <p className="muted" style={{fontSize:12,marginBottom:10}}>{form.active ? "This question is published and visible to students." : "This question is a draft and is not visible to students."}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        {!isEditing && <>
          <button type="button" className="secondary" onClick={() => attemptSave(false)} disabled={busy}>{saving ? "Saving..." : "Save as Draft"}</button>
          <button type="button" className="primary" onClick={() => attemptSave(true)} disabled={busy}>{saving ? "Saving..." : "Publish"}</button>
        </>}
        {isEditing && <>
          <button type="button" className="secondary" onClick={() => attemptSave(!form.active)} disabled={busy}>{saving ? "Working..." : (form.active ? "Unpublish" : "Publish")}</button>
          <button type="button" className="primary" onClick={() => attemptSave(form.active)} disabled={busy}>{saving ? "Saving..." : "Update"}</button>
        </>}
      </div>
    </div>
  </form>;
}

function QuestionPreview({ question, onClose }) {
  return <Modal onClose={onClose} title="Student preview" ariaLabel="Student preview">
    <p className="muted" style={{marginTop:-6}}>This simulates exactly what a student sees — no answer key, no explanation.</p>
    <QuestionPreviewBody question={question}/>
  </Modal>;
}

const SUBSCRIPTION_STATUS_FILTERS = [["", "All statuses"], ["active", "Active"], ["inactive", "Inactive"]];

export function AdminQuestionsPanel({ notify }) {
  const [types, setTypes] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [section, setSection] = useState("");
  const [type, setType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [editId, setEditId] = useState(null);
  const [editQuestion, setEditQuestion] = useState(null);
  const [previewQuestion, setPreviewQuestion] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  useEffect(() => { api.admin.questions.types().then(d => setTypes(d.types)).catch(() => {}); }, []);

  function load(pageArg) {
    setLoading(true); setError("");
    api.admin.questions.list({ page: pageArg || page, limit: 20, search, section, type, difficulty, status })
      .then(d => { setRows(d.data); setTotal(d.total); setTotalPages(d.totalPages); setPage(d.page); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(1); }, [section, type, difficulty, status]);

  useEffect(() => {
    if (editId) {
      api.admin.questions.get(editId).then(d => setEditQuestion(d.question)).catch(e => notify("error", e.message));
    } else {
      setEditQuestion(null);
    }
  }, [editId]);

  async function createQuestion(payload) {
    setSaving(true); setFormError("");
    try {
      await api.admin.questions.create(payload);
      notify("success", `Question "${payload.title}" ${payload.active ? "published" : "saved as draft"}.`);
      setShowCreate(false);
      load(1);
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  }

  async function updateQuestion(payload) {
    setSaving(true); setFormError("");
    try {
      await api.admin.questions.update(editId, payload);
      notify("success", `Question "${payload.title}" updated.`);
      setEditId(null);
      load();
    } catch (e) { setFormError(e.message); } finally { setSaving(false); }
  }

  async function preview(id) {
    try { setPreviewQuestion((await api.admin.questions.get(id)).question); }
    catch (e) { notify("error", e.message); }
  }

  async function runConfirm() {
    if (!confirmAction) return;
    setConfirmBusy(true);
    try { await confirmAction.run(); notify("success", confirmAction.successMsg); setConfirmAction(null); load(); }
    catch (e) { notify("error", e.message); setConfirmAction(null); }
    finally { setConfirmBusy(false); }
  }

  return <div>
    <div className="panel-head">
      <div><span className="eyebrow">Content management</span><h3>Question Library</h3><p className="muted">{total} total</p></div>
      <button className="primary" onClick={() => setShowCreate(s => !s)}>{showCreate ? "Cancel" : "+ Create question"}</button>
    </div>
    {error && <div className="alert error">{error}<button type="button" className="text-button" style={{marginTop:0,marginLeft:"auto"}} onClick={() => load()}>Retry</button></div>}
    {showCreate && types.length > 0 && <QuestionForm types={types} onCancel={() => setShowCreate(false)} onSave={createQuestion} saving={saving} error={formError}/>}

    <div className="filter-bar">
      <div className="search admin-search"><span aria-hidden="true">⌕</span><input placeholder="Search by title, prompt, or question ID..." aria-label="Search questions" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && load(1)}/></div>
      <select value={section} onChange={e => setSection(e.target.value)} aria-label="Filter by section">
        <option value="">All sections</option>
        {SECTIONS.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
      </select>
      <select value={type} onChange={e => setType(e.target.value)} aria-label="Filter by question type">
        <option value="">All types</option>
        {types.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
      </select>
      <select value={difficulty} onChange={e => setDifficulty(e.target.value)} aria-label="Filter by difficulty">
        <option value="">All difficulties</option>
        {DIFFICULTIES.map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
      </select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status">
        {SUBSCRIPTION_STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>

    <DataTable
      loading={loading}
      rows={rows}
      rowKey={q => q._id}
      emptyText="No questions match these filters."
      pagination={{ page, totalPages, total, itemLabel: "questions", onPrevious: () => load(page - 1), onNext: () => load(page + 1) }}
      columns={[
        { key: "title", header: "Question", render: q => <b>{q.title}</b> },
        { key: "section", header: "Section", render: q => q.section },
        { key: "type", header: "Type", render: q => types.find(t => t.type === q.type)?.label || q.type },
        { key: "evaluationType", header: "Evaluation", render: q => <Badge tone={q.evaluationType === "objective" ? "info" : "neutral"}>{q.evaluationType}</Badge> },
        { key: "difficulty", header: "Difficulty", render: q => q.difficulty },
        { key: "status", header: "Status", render: q => <Badge tone={q.active ? "good" : "warn"}>{q.active ? "Published" : "Draft"}</Badge> },
        { key: "created", header: "Created", render: q => new Date(q.createdAt).toLocaleDateString() },
        { key: "actions", header: "Actions", cellClassName: "admin-actions", render: q => <>
          <button className="text-button" onClick={() => preview(q._id)}>View</button>
          <button className="text-button" onClick={() => setEditId(q._id)}>Edit</button>
          {q.active
            ? <button className="text-button" onClick={() => setConfirmAction({ title: "Unpublish this question?", message: `"${q.title}" will no longer be given to students. Existing submissions are unaffected.`, label: "Unpublish now", danger: true, successMsg: "Question moved to draft", run: () => api.admin.questions.setStatus(q._id, false) })}>Unpublish</button>
            : <button className="text-button" onClick={() => setConfirmAction({ title: "Publish this question?", message: `"${q.title}" will become available to students immediately.`, label: "Publish now", danger: false, successMsg: "Question published", run: () => api.admin.questions.setStatus(q._id, true) })}>Publish</button>}
          <button className="text-button" onClick={() => setConfirmAction({ title: "Delete this question?", message: `"${q.title}" will be permanently removed. This is only possible if no student has submitted an answer to it — otherwise unpublish it instead.`, label: "Delete permanently", danger: true, successMsg: "Question deleted", run: () => api.admin.questions.remove(q._id) })}>Delete</button>
        </> }
      ]}
    />

    {editId && editQuestion && types.length > 0 && <Modal onClose={() => setEditId(null)} title="Edit question" ariaLabel="Edit question">
      <QuestionForm types={types} initial={editQuestion} onCancel={() => setEditId(null)} onSave={updateQuestion} saving={saving} error={formError}/>
    </Modal>}

    {previewQuestion && <QuestionPreview question={previewQuestion} onClose={() => setPreviewQuestion(null)}/>}
    <ConfirmDialog open={!!confirmAction} title={confirmAction?.title} message={confirmAction?.message} confirmLabel={confirmAction?.label} danger={confirmAction?.danger} busy={confirmBusy} onConfirm={runConfirm} onCancel={() => setConfirmAction(null)}/>
  </div>;
}
