import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "./api.js";

function Badge({ tone, children }) { return <span className={`badge badge-${tone}`}>{children}</span>; }

function ConfirmDialog({ open, title, message, confirmLabel, danger, busy, onConfirm, onCancel }) {
  if (!open) return null;
  return <div className="modal-overlay confirm-overlay" onClick={e => { e.stopPropagation(); onCancel(); }}>
    <div className="modal-panel confirm-panel" onClick={e => e.stopPropagation()}>
      <h3>{title}</h3>
      <p className="muted">{message}</p>
      <div className="modal-actions">
        <button className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={danger ? "primary danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? "Working..." : confirmLabel}</button>
      </div>
    </div>
  </div>;
}

function Empty({ text }) { return <div className="empty">{text}</div>; }

function SkeletonTableRows({ count = 6 }) {
  return <div aria-hidden="true" style={{padding:"4px 0"}}>{Array.from({ length: count }).map((_, i) => <div key={i} className="skeleton skeleton-row"/>)}</div>;
}

const DIFFICULTIES = ["easy", "medium", "hard"];
const SECTIONS = ["speaking", "writing", "reading", "listening"];

function emptyFormFor(types, section) {
  const firstType = types.find(t => t.sections.includes(section)) || types[0];
  return {
    section, type: firstType?.type || "", title: "", prompt: "", passage: "",
    options: ["", ""], answer: "", multiAnswer: [], reorderOrder: null, dragAnswer: null,
    explanation: "", difficulty: "medium", active: true, audioUrl: "", imageUrl: ""
  };
}

function questionToForm(q) {
  const isReorder = q.type === "reorder";
  const isDragFill = q.type === "fill-blanks-dragdrop";
  return {
    section: q.section, type: q.type, title: q.title || "", prompt: q.prompt || "", passage: q.passage || "",
    options: q.options?.length ? q.options : ["", ""],
    answer: typeof q.answer === "number" ? q.answer : "",
    multiAnswer: Array.isArray(q.answer) && !isReorder && !isDragFill ? q.answer : [],
    reorderOrder: isReorder && Array.isArray(q.answer) ? q.answer : null,
    dragAnswer: isDragFill && Array.isArray(q.answer) ? q.answer : null,
    explanation: q.explanation || "", difficulty: q.difficulty || "medium", active: q.active !== false,
    audioUrl: q.audioUrl || "", imageUrl: q.imageUrl || ""
  };
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

function QuestionForm({ types, initial, onCancel, onSave, saving, error }) {
  const [form, setForm] = useState(() => initial ? questionToForm(initial) : emptyFormFor(types, "reading"));
  const meta = types.find(t => t.type === form.type);
  const shape = meta?.shape;
  const availableTypes = types.filter(t => t.sections.includes(form.section));

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

  function submit(e) {
    e.preventDefault();
    const payload = {
      section: form.section, type: form.type, title: form.title.trim(), prompt: form.prompt.trim(),
      difficulty: form.difficulty, active: form.active
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
    onSave(payload);
  }

  const hasAnswerConfig = shape === "choice-single" || shape === "choice-multiple" || shape === "reorder" || shape === "drag-fill" || shape === "dictation";

  return <form onSubmit={submit} className="question-form">
    {error && <div className="alert error">{error}</div>}

    <div className="form-section">
      <p className="form-section-title">Basic information</p>
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
        <label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={e => update({ active: e.target.checked })}/> Active (visible to students)</label>
      </div>
      <label>Question title<input required value={form.title} onChange={e => update({ title: e.target.value })} placeholder="Short internal name for this question"/></label>
    </div>

    <div className="form-section">
      <p className="form-section-title">Question content</p>
      <label>Prompt<textarea required className="answer-area compact" value={form.prompt} onChange={e => update({ prompt: e.target.value })} placeholder="What the student is asked to do"/></label>
      {shape === "prompt-passage" && <label>Source passage<textarea required className="answer-area compact" value={form.passage} onChange={e => update({ passage: e.target.value })} placeholder="The text the student must summarize"/></label>}
      {shape === "drag-fill" && <label>Passage (mark each blank with ____)<textarea required className="answer-area compact" value={form.passage} onChange={e => update({ passage: e.target.value })} placeholder="The ____ sat on the ____."/></label>}
    </div>

    {(shape === "prompt-image" || shape === "prompt-audio" || shape === "dictation" || form.type === "repeat-sentence"
      || ((shape === "choice-single" || shape === "choice-multiple") && form.section === "listening")) && <div className="form-section">
      <p className="form-section-title">Media</p>
      {shape === "prompt-image" && <label>Image URL<input required value={form.imageUrl} onChange={e => update({ imageUrl: e.target.value })} placeholder="https://..."/></label>}
      {(shape === "prompt-audio" || shape === "dictation" || form.type === "repeat-sentence"
        || ((shape === "choice-single" || shape === "choice-multiple") && form.section === "listening"))
        && <label>Audio URL<input required value={form.audioUrl} onChange={e => update({ audioUrl: e.target.value })} placeholder="https://..."/></label>}
    </div>}

    {hasAnswerConfig && <div className="form-section">
      <p className="form-section-title">Answer configuration</p>

      {(shape === "choice-single" || shape === "choice-multiple" || shape === "reorder" || shape === "drag-fill") && <>
        <h4 className="form-subheading">{shape === "reorder" ? "Items (in their scrambled/displayed order)" : shape === "drag-fill" ? "Word pool (decoy words allowed — not every word needs a blank)" : "Options"}</h4>
        {form.type === "highlight-incorrect-words" && <p className="muted" style={{fontSize:12,marginTop:-4,marginBottom:8}}>Enter the displayed transcript one word per option, in reading order — then check the boxes for the word(s) that are wrong.</p>}
        <div className="option-editor">
          {form.options.map((opt, i) => <div className="option-editor-row" key={i}>
            {shape === "choice-single" && <input type="radio" checked={Number(form.answer) === i} onChange={() => update({ answer: i })} aria-label={`Mark option ${i + 1} correct`}/>}
            {shape === "choice-multiple" && <input type="checkbox" checked={form.multiAnswer.includes(i)} onChange={() => toggleMulti(i)} aria-label={`Mark option ${i + 1} correct`}/>}
            <input value={opt} onChange={e => updateOption(i, e.target.value)} placeholder={`Item ${i + 1}`}/>
            <button type="button" className="text-button" onClick={() => removeOption(i)} disabled={form.options.length <= 2}>Remove</button>
          </div>)}
        </div>
        <button type="button" className="secondary" onClick={addOption} style={{marginTop:8}}>+ Add {shape === "reorder" ? "item" : "option"}</button>
        {(shape === "choice-single" || shape === "choice-multiple") && <p className="muted" style={{fontSize:12,marginTop:6}}>Select the correct option(s) using the {shape === "choice-single" ? "radio buttons" : "checkboxes"} to the left.</p>}
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
            <select value={optIdx} onChange={e => { const next = [...form.dragAnswer]; next[blankIdx] = Number(e.target.value); update({ dragAnswer: next }); }}>
              {form.options.map((opt, i) => <option key={i} value={i}>{opt || `Item ${i + 1}`}</option>)}
            </select>
          </div>)}
        </div>
      </>}

      {shape === "dictation" && <label>Exact sentence (the answer)<input required value={form.answer} onChange={e => update({ answer: e.target.value })} placeholder="The sentence the student must type exactly"/></label>}

      {(shape === "choice-single" || shape === "choice-multiple" || shape === "reorder" || shape === "drag-fill") &&
        <label>Explanation (shown to the student after they answer)<textarea className="answer-area compact" value={form.explanation} onChange={e => update({ explanation: e.target.value })} placeholder="Why this is the correct answer"/></label>}
    </div>}

    <div className="modal-actions">
      <button type="button" className="secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      <button type="submit" className="primary" disabled={saving}>{saving ? "Saving..." : "Save question"}</button>
    </div>
  </form>;
}

function QuestionPreview({ question, onClose }) {
  // Deliberately renders only what a student would receive from the API — answer/explanation
  // are never read here, even though the admin's own fetch included them.
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-panel" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h3>Student preview</h3><button className="icon-btn" onClick={onClose}><X size={18}/></button></div>
      <p className="muted" style={{marginTop:-6}}>This simulates exactly what a student sees — no answer key, no explanation.</p>
      <div className="panel" style={{marginTop:14}}>
        <div className="task-meta"><span className="chip">{question.section}</span><span>{question.difficulty}</span></div>
        <h2>{question.title}</h2>
        <p className="instruction">{question.prompt}</p>
        {question.passage && <div className="passage">{question.passage}</div>}
        {question.imageUrl && <img src={question.imageUrl} alt="" style={{maxWidth:"100%",borderRadius:9,marginTop:12}}/>}
        {question.audioUrl && <audio className="audio" controls src={question.audioUrl}/>}
        {!!question.options?.length && <div className="options">{question.options.map((o, i) => <label className="option" key={i}><input type="radio" disabled/>{o}</label>)}</div>}
      </div>
    </div>
  </div>;
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
      notify("success", `Question "${payload.title}" created.`);
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
      <div><h3>Question bank</h3><p className="muted">{total} total</p></div>
      <button className="primary" onClick={() => setShowCreate(s => !s)}>{showCreate ? "Cancel" : "+ Create question"}</button>
    </div>
    {error && <div className="alert error">{error}<button type="button" className="text-button" style={{marginTop:0,marginLeft:"auto"}} onClick={() => load()}>Retry</button></div>}
    {showCreate && types.length > 0 && <QuestionForm types={types} onCancel={() => setShowCreate(false)} onSave={createQuestion} saving={saving} error={formError}/>}

    <div className="filter-bar">
      <div className="search admin-search"><span>⌕</span><input placeholder="Search by title, prompt, or question ID..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === "Enter" && load(1)}/></div>
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

    {loading ? <SkeletonTableRows/> : !rows.length ? <Empty text="No questions match these filters."/> : <>
      <div className="table-wrap"><table><thead><tr>
        <th>Question</th><th>Section</th><th>Type</th><th>Evaluation</th><th>Difficulty</th><th>Active</th><th>Created</th><th>Actions</th>
      </tr></thead><tbody>
        {rows.map(q => <tr key={q._id}>
          <td><b>{q.title}</b></td>
          <td>{q.section}</td>
          <td>{types.find(t => t.type === q.type)?.label || q.type}</td>
          <td><Badge tone={q.evaluationType === "objective" ? "info" : "neutral"}>{q.evaluationType}</Badge></td>
          <td>{q.difficulty}</td>
          <td><Badge tone={q.active ? "good" : "bad"}>{q.active ? "Active" : "Inactive"}</Badge></td>
          <td>{new Date(q.createdAt).toLocaleDateString()}</td>
          <td className="admin-actions">
            <button className="text-button" onClick={() => preview(q._id)}>View</button>
            <button className="text-button" onClick={() => setEditId(q._id)}>Edit</button>
            {q.active
              ? <button className="text-button" onClick={() => setConfirmAction({ title: "Deactivate this question?", message: `"${q.title}" will no longer be given to students. Existing submissions are unaffected.`, label: "Deactivate now", danger: true, successMsg: "Question deactivated", run: () => api.admin.questions.setStatus(q._id, false) })}>Deactivate</button>
              : <button className="text-button" onClick={() => setConfirmAction({ title: "Activate this question?", message: `"${q.title}" will become available to students again.`, label: "Activate now", danger: false, successMsg: "Question activated", run: () => api.admin.questions.setStatus(q._id, true) })}>Activate</button>}
            <button className="text-button" onClick={() => setConfirmAction({ title: "Delete this question?", message: `"${q.title}" will be permanently removed. This is only possible if no student has submitted an answer to it — otherwise deactivate it instead.`, label: "Delete permanently", danger: true, successMsg: "Question deleted", run: () => api.admin.questions.remove(q._id) })}>Delete</button>
          </td>
        </tr>)}
      </tbody></table></div>
      <div className="pager">
        <button className="secondary" disabled={page <= 1} onClick={() => load(page - 1)}>‹ Previous</button>
        <span className="muted">Page {page} of {totalPages} · {total} questions</span>
        <button className="secondary" disabled={page >= totalPages} onClick={() => load(page + 1)}>Next ›</button>
      </div>
    </>}

    {editId && editQuestion && types.length > 0 && <div className="modal-overlay" onClick={() => setEditId(null)}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>Edit question</h3><button className="icon-btn" onClick={() => setEditId(null)}><X size={18}/></button></div>
        <QuestionForm types={types} initial={editQuestion} onCancel={() => setEditId(null)} onSave={updateQuestion} saving={saving} error={formError}/>
      </div>
    </div>}

    {previewQuestion && <QuestionPreview question={previewQuestion} onClose={() => setPreviewQuestion(null)}/>}
    <ConfirmDialog open={!!confirmAction} title={confirmAction?.title} message={confirmAction?.message} confirmLabel={confirmAction?.label} danger={confirmAction?.danger} busy={confirmBusy} onConfirm={runConfirm} onCancel={() => setConfirmAction(null)}/>
  </div>;
}
