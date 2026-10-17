import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BookOpen, CheckCircle2, Clock3, Flag, Headphones, Mic, PenLine, Play, Trophy } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";
import { Page, Pager } from "../components/common.jsx";
import { Button, ButtonLink, NavButton } from "../components/Button.jsx";
import { useToast } from "../components/toast.jsx";
import { safeLocal } from "../safeStorage.js";
import {
  EmptyState, Metric, MetricStrip, PerformanceTable, ScoreRing, SectionHeader, taskLabel, titleCase
} from "../components/analytics.jsx";
import { PRACTICE_SECTIONS, SECTION_LABELS } from "../practiceTaskRegistry.js";
import { formatRaw, PTE_MAX_SCORE } from "../analytics/derive.js";
import { TaskRail } from "../practice/TaskTips.jsx";
import { ReadingTask } from "../practice/Reading.jsx";
import { ListeningTask } from "../practice/Listening.jsx";
import SpeakingTaskModule from "../practice/Speaking.jsx";
import WritingTaskModule from "../practice/Writing.jsx";

const SECTION_ICONS = { speaking: Mic, writing: PenLine, reading: BookOpen, listening: Headphones };

// Mirrors config.mockQuestionsPerSection on the server, which is where the real decision is made.
// Used only to describe the test on the start card — the server picks what it picks, and a thin
// section simply contributes fewer, which is why the copy says "up to".
const MOCK_QUESTIONS_PER_SECTION = 20;
// Ten per page, matching the attempt tables on My Results so the two read the same way.
const RESULT_ROWS_PER_PAGE = 10;

function formatMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60), s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function MockTimer({ remainingMs }) {
  const low = remainingMs !== null && remainingMs <= 2 * 60 * 1000;
  return <div className={low ? "mock-timer low" : "mock-timer"}>
    <Clock3 size={16} />
    <div><span className="mock-timer-label">Time Remaining</span><strong>{remainingMs === null ? "--:--" : formatMMSS(remainingMs)}</strong></div>
  </div>;
}

function MockQuestionNav({ questions, idx, answered, saved, onJump }) {
  // Grouped by section, keeping each question's position in the WHOLE test as its number, so the
  // overview and the "Question 34 of 80" readout always agree. A flat strip of eighty numbers was
  // readable at four and is a wall at eighty.
  const groups = [];
  questions.forEach((question, i) => {
    const last = groups[groups.length - 1];
    if (last && last.section === question.section) last.items.push({ question, i });
    else groups.push({ section: question.section, items: [{ question, i }] });
  });

  return <aside className="panel mock-qnav" role="tablist" aria-label="Question overview">
    {/* The two squares mean different things to a student's score, so say which is which rather
        than leaving them to infer it from colour alone. */}
    <div className="mock-qnav__key">
      <span><i className="mock-qnav-swatch is-answered" aria-hidden="true"/>Submitted</span>
      <span><i className="mock-qnav-swatch is-saved" aria-hidden="true"/>Saved</span>
    </div>
    {groups.map(group => {
      const answeredInGroup = group.items.filter(item => answered[item.i]).length;
      return <div className="mock-qnav__group" key={`${group.section}-${group.items[0].i}`}>
        <span className="mock-qnav__label">
          {SECTION_LABELS[group.section] || group.section}
          <b className="num-mono">{answeredInGroup}/{group.items.length}</b>
        </span>
        <div className="mock-qnav__row">
          {group.items.map(({ question, i }) => {
            // Submitted beats saved: a submitted answer is final, a saved one is still a draft.
            const state = i === idx ? "current"
              : answered[i] ? "answered"
              : saved[i] ? "saved"
              : "unanswered";
            return <button key={question._id || i} type="button" className={`mock-qnav-item ${state}`}
              onClick={() => onJump(i)} aria-current={i === idx || undefined}
              title={`Question ${i + 1} — ${state}`}>{i + 1}</button>;
          })}
        </div>
      </div>;
    })}
  </aside>;
}

function ConfirmDialog({ open, title, message, confirmLabel, busy, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onCancel(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return <div className="modal-overlay confirm-overlay" onClick={e => { e.stopPropagation(); onCancel(); }}>
    <div className="modal-panel confirm-panel mock-confirm" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <h3>{title}</h3><p className="muted">{message}</p>
      <div className="modal-actions btn-bar">
        <Button variant="tertiary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={onConfirm} loading={busy} loadingLabel="Working...">{confirmLabel}</Button>
      </div>
    </div>
  </div>;
}

function Mock() {
  const [session,setSession]=useState(null);
  const [idx,setIdx]=useState(0);
  const [answered,setAnswered]=useState({});
  // Saved-but-not-submitted drafts, keyed by question index. Deliberately client-only: saving is
  // not answering, so nothing reaches the server until the student submits. Only submitted
  // answers are ever scored — a draft left unsubmitted scores nothing, which is what the finish
  // confirmation warns about.
  const [saved,setSaved]=useState({});
  // Drafts are read from storage in an effect, which lands AFTER the first render. A task
  // component seeds its inputs once, on mount, so the question is held back until the drafts are
  // in — remounting it afterwards instead would wipe a selection made in the interim.
  const [draftsLoaded,setDraftsLoaded]=useState(false);
  const [result,setResult]=useState(null);
  const [resultRows,setResultRows]=useState([]);
  // The per-question table pages client side: every row arrives in the completion response, so
  // this is a slice rather than a refetch. A full mock is 80 questions, which is a long scroll
  // past the section summary most students actually came for.
  const [rowsPage,setRowsPage]=useState(1);
  const [starting,setStarting]=useState(false);
  const [finishing,setFinishing]=useState(false);
  const toast = useToast();
  const [remainingMs,setRemainingMs]=useState(null);
  const [timeUp,setTimeUp]=useState(false);
  const [terminal,setTerminal]=useState(null);
  const [showConfirm,setShowConfirm]=useState(false);
  // Until the server has been asked whether an attempt is already open, showing "Start Mock Test"
  // would invite the student to abandon one they are halfway through.
  const [resuming,setResuming]=useState(true);
  const [politeAnnouncement,setPoliteAnnouncement]=useState("");
  const [assertiveAnnouncement,setAssertiveAnnouncement]=useState("");
  const timerIdRef=useRef(null);
  const autoSubmittedRef=useRef(false);
  const lowTimeAnnouncedRef=useRef(false);

  // Resume an attempt left open on the server — after a refresh, a closed tab, or a browser that
  // decided to reload. The session keeps the exact questions it issued and the clock keeps
  // running, so the attempt is handed back whole rather than restarted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api.testSessions.active();
        if (cancelled || !d?.testSession) return;
        setSession({ testSession: d.testSession, questions: d.questions || [] });
        // Submissions come back keyed by question; this screen works in positions, so they are
        // mapped onto the question order the session was issued in.
        const position = new Map((d.questions || []).map((q, i) => [String(q._id), i]));
        const restored = {};
        for (const submission of d.submissions || []) {
          const id = String(submission.question?._id || submission.question || "");
          const at = position.get(id);
          if (at !== undefined) restored[at] = submission;
        }
        setAnswered(restored);
        autoSubmittedRef.current = false;
        lowTimeAnnouncedRef.current = false;
        setPoliteAnnouncement("Resuming your mock test where you left off.");
      } catch {
        // Nothing to resume, or the lookup failed. Either way the start screen is the right
        // fallback — it is never wrong to offer a new attempt.
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function start() {
    setStarting(true);
    try {
      const d = await api.testSessions.start();
      autoSubmittedRef.current=false; lowTimeAnnouncedRef.current=false;
      setSession(d); setIdx(0); setAnswered({}); setTimeUp(false); setTerminal(null); setRemainingMs(null);
      setPoliteAnnouncement(""); setAssertiveAnnouncement("");
    } catch(e){ toast.error(e.message); } finally { setStarting(false); }
  }

  // Drafts survive a refresh. They are keyed per test session so a new attempt never inherits an
  // older one's answers, and they are cleared the moment the test is finished — a completed
  // attempt cannot be edited, so keeping them would only leave stale answers in the browser.
  const draftKey = session?.testSession?._id ? `pte_mock_drafts_${session.testSession._id}` : null;
  const idxKey = session?.testSession?._id ? `pte_mock_idx_${session.testSession._id}` : null;

  useEffect(() => {
    if (!draftKey) return;
    try {
      const stored = JSON.parse(safeLocal.getItem(draftKey) || "{}");
      if (stored && typeof stored === "object") setSaved(stored);
    } catch {
      // A corrupt or half-written value is not worth failing a test attempt over; start empty.
      safeLocal.removeItem(draftKey);
    } finally {
      setDraftsLoaded(true);
    }
  }, [draftKey]);

  // Which question they were on. Restored alongside the drafts so a refresh lands them back where
  // they were rather than at question one of eighty.
  useEffect(() => {
    if (!idxKey) return;
    // Read before converting: Number(null) is 0, not NaN, so an absent key would look like a
    // stored position of zero rather than "nothing stored".
    const raw = safeLocal.getItem(idxKey);
    if (raw === null || raw === "") return;
    const stored = Number(raw);
    if (Number.isInteger(stored) && stored >= 0) setIdx(stored);
  }, [idxKey]);

  useEffect(() => {
    if (!idxKey || !draftsLoaded) return;
    safeLocal.setItem(idxKey, String(idx));
  }, [idxKey, draftsLoaded, idx]);

  useEffect(() => {
    // Only once the stored drafts have been read, or the empty initial state would immediately
    // overwrite them.
    if (!draftKey || !draftsLoaded) return;
    if (Object.keys(saved).length) safeLocal.setItem(draftKey, JSON.stringify(saved));
    else safeLocal.removeItem(draftKey);
  }, [draftKey, draftsLoaded, saved]);

  async function finish() {
    setFinishing(true); setPoliteAnnouncement("Finishing your test…");
    try {
      const d = await api.testSessions.complete(session.testSession._id);
      setResult(d.testSession);
      // Already in the response; the old report threw them away and showed section totals only.
      setResultRows(d.results || []);
      setRowsPage(1);
      // The attempt is over and cannot be edited, so the drafts have nothing left to restore.
      if (draftKey) safeLocal.removeItem(draftKey);
      if (idxKey) safeLocal.removeItem(idxKey);
      setSaved({});
      setPoliteAnnouncement("Your mock test has been completed and scored.");
    } catch(e){
      if (e.code === "TEST_SESSION_EXPIRED") { setTerminal("EXPIRED"); setAssertiveAnnouncement("Your test session has expired."); }
      else if (e.code === "SESSION_ALREADY_COMPLETED") { setTerminal("ALREADY_COMPLETED"); setPoliteAnnouncement("This test was already completed."); }
      else toast.error(e.message);
    } finally { setFinishing(false); }
  }

  useEffect(() => {
    if (!session || result || terminal) return;
    const expiresAtMs = new Date(session.testSession.expiresAt).getTime();
    function tick() {
      const remaining = expiresAtMs - Date.now();
      setRemainingMs(Math.max(0, remaining));
      if (remaining > 0 && remaining <= 2 * 60 * 1000 && !lowTimeAnnouncedRef.current) {
        lowTimeAnnouncedRef.current = true;
        setPoliteAnnouncement("Less than 2 minutes remaining.");
      }
      if (remaining <= 0) {
        clearInterval(timerIdRef.current);
        if (!autoSubmittedRef.current) {
          autoSubmittedRef.current = true;
          setAssertiveAnnouncement("Time is up. Submitting your test now.");
          setTimeUp(true);
          finish();
        }
      }
    }
    tick();
    timerIdRef.current = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timerIdRef.current);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [session?.testSession?._id, result, terminal]);

  const liveRegions = <>
    <div aria-live="polite" className="sr-only">{politeAnnouncement}</div>
    <div aria-live="assertive" className="sr-only">{assertiveAnnouncement}</div>
  </>;

  if (result) {
    // Marks, not a band. Every question in a mock is worth one mark, so the total is simply how
    // many of the 80 were earned — a figure the student can check against the question list.
    const marksEarned = Number(result.totalScore ?? 0);
    const marksAvailable = Number(result.totalMaxScore ?? 0);
    // Section rows, each as a percentage of its own maximum so sections of different lengths can
    // actually be compared with one another.
    const sectionRows = (result.sectionScores || []).map(s => ({
      ...s,
      percent: s.maxScore ? Math.min(100, Math.max(0, Math.round((s.score / s.maxScore) * 100))) : null
    }));
    // Counted from the mark the server assigned, so these always add up to the total above
    // rather than re-deriving the banding rule here and drifting from it.
    const correct = resultRows.filter(r => r.mark === 1).length;
    const partial = resultRows.filter(r => r.mark === 0.5).length;
    const incorrect = resultRows.filter(r => !r.mark).length;
    // The attempt's own size, from whichever source still knows it: the completion payload, the
    // session that is usually still in state, or — failing both — the rows themselves.
    const totalQuestions = result.totalQuestions
      ?? session?.questions?.length
      ?? session?.testSession?.totalQuestions
      ?? resultRows.length;
    // Counted from the rows the server returns. `answered` is the fallback for an attempt whose
    // rows could not be loaded — it is this screen's own record of what was submitted, so the
    // figure stays truthful rather than silently reading zero.
    const attemptedCount = resultRows.length || Object.keys(answered).length;
    const rowsTotalPages = Math.max(1, Math.ceil(resultRows.length / RESULT_ROWS_PER_PAGE));
    // Clamped rather than stored, so a page that no longer exists cannot strand the table empty.
    const safeRowsPage = Math.min(rowsPage, rowsTotalPages);
    const visibleRows = resultRows.slice((safeRowsPage - 1) * RESULT_ROWS_PER_PAGE, safeRowsPage * RESULT_ROWS_PER_PAGE);
    const notAttemptedCount = Math.max(0, totalQuestions - attemptedCount);

    return <>{liveRegions}<Page title="Mock Test Complete" subtitle="Here is your practice report.">
      <section className="exam-report__hero">
        <ScoreRing value={marksEarned} max={marksAvailable || totalQuestions} size={184} caption="Marks" round={false}/>
        <div className="exam-report__summary">
          <h2>Practice Score</h2>
          <p className="muted">Based on your actual answers this attempt — a practice score, not an official Pearson PTE score.</p>
          <MetricStrip>
            {/* Counted against the whole test, not against the rows that came back: a question
                never submitted produces no row, so resultRows.length alone would quietly report
                a 40-question attempt as a 40-question test. */}
            <Metric label="Correct" value={correct} hint="1 mark each"/>
            {/* Only AI-evaluated answers can land here (40-59%), so it is hidden on an attempt
                that had none rather than showing a permanent zero. */}
            {partial > 0 && <Metric label="Partly correct" value={partial} hint="half a mark each"/>}
            <Metric label="Incorrect" value={incorrect} hint="no marks"/>
            <Metric label="Attempted" value={attemptedCount}
              hint={`of ${totalQuestions} questions`}/>
            <Metric label="Not attempted" value={notAttemptedCount}
              hint={notAttemptedCount ? "scored nothing" : "nothing skipped"}/>
          </MetricStrip>
        </div>
      </section>

      <div className="page-stack">
      <section className="panel">
        <SectionHeader label="Section comparison" title="How each section scored"
          description="Each section is marked out of the questions it issued — one mark per question."/>
        <div className="skill-spectrum">
          {sectionRows.map(row => (
            <div className="skill-row" key={row.section} data-section={row.section}>
              <span className="skill-row__name">{titleCase(row.section)}</span>
              <span className="skill-row__track">
                {row.percent !== null && <span className="skill-row__fill" style={{ width: `${row.percent}%` }}/>}
              </span>
              <span className="skill-row__value num-mono">{row.percent ?? "—"}</span>
              <span className="skill-row__meta num-mono">{formatRaw(row.score, row.maxScore)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <SectionHeader label="Question level" title="Every answer in this attempt"/>
        <PerformanceTable
          columns={[
            { key: "section", label: "Section", render: r => titleCase(r.section) },
            { key: "task", label: "Task", render: r => r.question?.title || taskLabel(r.type) },
            { key: "score", label: "Mark", align: "right", render: r => <b className="num-mono">{r.mark ?? 0}/1</b> },
            { key: "status", label: "Result", render: r => r.evaluationStatus && r.evaluationStatus !== "COMPLETED"
                ? <span className="muted">{titleCase(r.evaluationStatus)}</span>
                : r.mark === 1 ? <span className="exam-mark is-full">Correct</span>
                : r.mark === 0.5 ? <span className="exam-mark is-part">Partly correct</span>
                : <span className="exam-mark is-none">Incorrect</span> }
          ]}
          rows={visibleRows.map((r, i) => ({ ...r, id: r._id || `${safeRowsPage}-${i}` }))}
          empty={<EmptyState title="Question-level detail is not available for this attempt"
            body="Your section scores above still reflect everything you answered."/>}
        />
        <Pager
          page={safeRowsPage}
          totalPages={rowsTotalPages}
          total={resultRows.length}
          itemLabel={resultRows.length === 1 ? "answer" : "answers"}
          onPrevious={() => setRowsPage(safeRowsPage - 1)}
          onNext={() => setRowsPage(safeRowsPage + 1)}
        />
      </section>
      </div>

      <div className="task-actions">
        <ButtonLink variant="secondary" to="/history">View all attempts</ButtonLink>
        <ButtonLink variant="primary" to="/dashboard">Back to Dashboard</ButtonLink>
      </div>
    </Page></>;
  }

  if (terminal === "EXPIRED") {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a full-length PTE test experience.">
      <div className="mock-card panel mock-terminal expired">
        <div className="mock-icon-badge tone-danger"><Clock3 size={30}/></div>
        <h2>Mock Test Expired</h2>
        <p>Your allotted test time has ended. Your test can no longer accept answers.</p>
        <ButtonLink variant="primary" to="/dashboard">Back to Dashboard</ButtonLink>
      </div>
    </Page></>;
  }

  if (terminal === "ALREADY_COMPLETED") {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a full-length PTE test experience.">
      <div className="mock-card panel mock-terminal">
        <div className="mock-icon-badge tone-success"><CheckCircle2 size={30}/></div>
        <h2>This Test Was Already Completed</h2>
        <p>This mock attempt has already been submitted and scored.</p>
        <ButtonLink variant="primary" to="/history">View History</ButtonLink>
      </div>
    </Page></>;
  }

  // Hold the start screen until the server has answered. Offering "Start Mock Test" to someone
  // who has an attempt open would let them abandon it with one click.
  if (resuming && !session) {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Sit a full-length, timed test and get a sectioned report.">
      <div className="mock-card panel"><p className="muted">Checking for a test in progress…</p></div>
    </Page></>;
  }

  if (!session) {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Sit a full-length, timed test and get a sectioned report.">
      <div className="mock-card panel">
        <div className="mock-icon-badge"><Trophy size={30}/></div>
        <h2>Full PTE Practice Mock</h2>
        <p>Up to {MOCK_QUESTIONS_PER_SECTION} questions per section across all four, scored from your
          actual answers — not a preset result.</p>
        <div className="mock-section-chips">
          {PRACTICE_SECTIONS.map(s => { const Icon = SECTION_ICONS[s]; return <span className="mock-section-chip" key={s}>{Icon && <Icon size={14}/>} {SECTION_LABELS[s]}</span>; })}
        </div>
        <p className="muted">Your time limit is set when you start and scales with the length of your test.</p>
        <Button variant="primary" size="lg" icon={<Play/>} loading={starting} loadingLabel="Preparing..." onClick={start}>Start Mock Test</Button>
        <NavLink className="link mock-card__history" to="/history">See your previous attempts</NavLink>
      </div>
    </Page></>;
  }

  if (timeUp) {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a full-length PTE test experience.">
      <div className="mock-card panel mock-terminal">
        <div className="mock-icon-badge tone-warning"><Clock3 size={30}/></div>
        <h2>Time's Up</h2>
        <p>Submitting your test now…</p>
      </div>
    </Page></>;
  }

  const q = session.questions[idx];
  const isLast = idx === session.questions.length - 1;
  const answeredCount = Object.keys(answered).length;
  const unansweredCount = session.questions.length - answeredCount;
  function onAnswered(submission){
    setAnswered(a=>({...a,[idx]:submission}));
    // Submitting supersedes any draft, so the question stops counting as "saved only".
    setSaved(d=>{ if(!(idx in d)) return d; const next={...d}; delete next[idx]; return next; });
  }
  function onSaveDraft(draft){ setSaved(d=>({...d,[idx]:draft})); }
  // Saved but never submitted. These score NOTHING — a draft is not an answer — so the
  // confirmation has to say so plainly while the student can still do something about it.
  const savedOnlyCount = Object.keys(saved).filter(key => !answered[key]).length;

  // Three cases, most urgent first. Saved-not-submitted is the one a student can lose real work
  // to, so it leads whenever it applies; an unanswered question is merely one never attempted.
  const confirmTitle = savedOnlyCount > 0
    ? "You have saved answers that are not submitted"
    : unansweredCount > 0 ? "Submit with questions unanswered?" : "Submit your test?";
  const confirmMessage = savedOnlyCount > 0
    ? `${savedOnlyCount} ${savedOnlyCount === 1 ? "question is" : "questions are"} saved but not submitted, `
      + `and saved answers score nothing — only submitted ones are marked. `
      + `You have attempted ${answeredCount} of ${session.questions.length} questions. `
      + "Go back and submit them, or finish anyway?"
    : unansweredCount > 0
    ? `You have attempted ${answeredCount} of ${session.questions.length} questions. `
      + `${unansweredCount} ${unansweredCount === 1 ? "question" : "questions"} will be left unanswered and score nothing. `
      + "Are you sure you want to submit?"
    : `You have attempted all ${session.questions.length} questions. `
      + "Are you sure you want to submit? You cannot return to this attempt afterwards.";

  return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a full-length PTE test experience.">
    <div className="mock-progress-bar">
      <span>Question {idx+1} of {session.questions.length}</span>
      <span className="chip">{q.section}</span>
      {/* Finish sits with the clock rather than at the foot of the page: it is the one action a
          student reaches for when time is running out, and at eighty questions the bottom of the
          page is a long scroll away from wherever they happen to be reading. It is the only
          Finish on screen — on the last question it simply takes the primary tier, because there
          it genuinely is the way forward. */}
      <div className="mock-progress-bar__end">
        <MockTimer remainingMs={remainingMs}/>
        <Button variant={isLast ? "primary" : "tertiary"} size="sm" icon={<Flag/>}
          loading={finishing} loadingLabel="Finishing..." onClick={()=>setShowConfirm(true)}>Finish Test</Button>
      </div>
    </div>
    <div className="mock-progress-track" role="progressbar" aria-valuenow={idx+1} aria-valuemin={1} aria-valuemax={session.questions.length} aria-valuetext={`Question ${idx+1} of ${session.questions.length}`}>
      <div className="mock-progress-fill" style={{width: `${((idx+1)/session.questions.length)*100}%`}}/>
    </div>
    {/* The overview is a SIBLING of the task, not a child of it.
        It used to be passed into the task's own rail — which sits inside the subtree that is
        keyed by q._id, so every Next unmounted and rebuilt the whole list of eighty buttons.
        Out here it stays mounted for the life of the test: clicking Next changes the question and
        nothing else, and the panel does not flicker or shift.
        taskPanels={false} still suppresses the task's own rail panels (tips, composition
        readout) — a timed exam should not be coaching a student through what it is scoring. */}
    <div className="mock-layout">
      <div className="mock-layout__main">
        <TaskRail taskPanels={false}>
        {/* key={q._id} on all four. Each task component holds the student's answer and its result
            in its own state, so without a key that changes, React reuses the same instance from
            one question to the next and that state comes with it.
            WRITING is where this actually bit: question 25 opened holding question 24's typed
            answer and its AI evaluation. Speaking already had the key, and Reading/Listening
            survive on a useEffect keyed to question._id that clears their own state (see
            PracticeObjective.jsx) — but that effect is one forgotten setter away from the same
            bug, and a key cannot be forgotten in the same way. */}
{draftsLoaded && <>
        {q.section==="speaking" && <SpeakingTaskModule key={q._id} type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered} existingResult={answered[idx]}/>}
        {q.section==="writing" && <WritingTaskModule key={q._id} type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered} existingResult={answered[idx]} savedDraft={saved[idx]} onSaveDraft={onSaveDraft}/>}
        {q.section==="reading" && <ReadingTask key={q._id} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered} existingResult={answered[idx]} savedDraft={saved[idx]} onSaveDraft={onSaveDraft}/>}
        {q.section==="listening" && <ListeningTask key={q._id} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered} existingResult={answered[idx]} savedDraft={saved[idx]} onSaveDraft={onSaveDraft}/>}
        </>}
        </TaskRail>
        <div className="mock-nav btn-group" role="group" aria-label="Test navigation">
          <NavButton direction="previous" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>Previous</NavButton>
          {!isLast && <NavButton direction="next" onClick={()=>setIdx(i=>i+1)}>Next</NavButton>}
        </div>
      </div>
      <MockQuestionNav questions={session.questions} idx={idx} answered={answered} saved={saved} onJump={setIdx}/>
    </div>
    <ConfirmDialog open={showConfirm} title={confirmTitle} message={confirmMessage} confirmLabel="Finish Test" busy={finishing} onConfirm={()=>{ setShowConfirm(false); finish(); }} onCancel={()=>setShowConfirm(false)}/>
  </Page></>;
}

export default Mock;
