import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BookOpen, CheckCircle2, Clock3, Flag, Headphones, Mic, PenLine, Play, Trophy } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";
import { Page } from "../components/common.jsx";
import { Button, ButtonLink, NavButton } from "../components/Button.jsx";
import { useToast } from "../components/toast.jsx";
import {
  EmptyState, Metric, MetricStrip, PerformanceTable, ScoreRing, SectionHeader, taskLabel, titleCase
} from "../components/analytics.jsx";
import { PRACTICE_SECTIONS, SECTION_LABELS } from "../practiceTaskRegistry.js";
import { formatRaw } from "../analytics/derive.js";
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

function MockQuestionNav({ questions, idx, answered, onJump }) {
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
    {groups.map(group => {
      const answeredInGroup = group.items.filter(item => answered[item.i]).length;
      return <div className="mock-qnav__group" key={`${group.section}-${group.items[0].i}`}>
        <span className="mock-qnav__label">
          {SECTION_LABELS[group.section] || group.section}
          <b className="num-mono">{answeredInGroup}/{group.items.length}</b>
        </span>
        <div className="mock-qnav__row">
          {group.items.map(({ question, i }) => {
            const state = i === idx ? "current" : answered[i] ? "answered" : "unanswered";
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
    <div className="modal-panel confirm-panel" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
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
  const [result,setResult]=useState(null);
  const [resultRows,setResultRows]=useState([]);
  const [starting,setStarting]=useState(false);
  const [finishing,setFinishing]=useState(false);
  const toast = useToast();
  const [remainingMs,setRemainingMs]=useState(null);
  const [timeUp,setTimeUp]=useState(false);
  const [terminal,setTerminal]=useState(null);
  const [showConfirm,setShowConfirm]=useState(false);
  const [politeAnnouncement,setPoliteAnnouncement]=useState("");
  const [assertiveAnnouncement,setAssertiveAnnouncement]=useState("");
  const timerIdRef=useRef(null);
  const autoSubmittedRef=useRef(false);
  const lowTimeAnnouncedRef=useRef(false);

  async function start() {
    setStarting(true);
    try {
      const d = await api.testSessions.start();
      autoSubmittedRef.current=false; lowTimeAnnouncedRef.current=false;
      setSession(d); setIdx(0); setAnswered({}); setTimeUp(false); setTerminal(null); setRemainingMs(null);
      setPoliteAnnouncement(""); setAssertiveAnnouncement("");
    } catch(e){ toast.error(e.message); } finally { setStarting(false); }
  }

  async function finish() {
    setFinishing(true); setPoliteAnnouncement("Finishing your test…");
    try {
      const d = await api.testSessions.complete(session.testSession._id);
      setResult(d.testSession);
      // Already in the response; the old report threw them away and showed section totals only.
      setResultRows(d.results || []);
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
    const overallPct = result.totalMaxScore
      ? Math.min(100, Math.max(0, Math.round((result.totalScore / result.totalMaxScore) * 100))) : null;
    // Section rows, each as a percentage of its own maximum so sections of different lengths can
    // actually be compared with one another.
    const sectionRows = (result.sectionScores || []).map(s => ({
      ...s,
      percent: s.maxScore ? Math.min(100, Math.max(0, Math.round((s.score / s.maxScore) * 100))) : null
    }));
    const ranked = sectionRows.filter(s => s.percent !== null).sort((a, b) => b.percent - a.percent);
    const correct = resultRows.filter(r => r.maxScore && r.score >= r.maxScore).length;

    return <>{liveRegions}<Page title="Mock Test Complete" subtitle="Here is your practice report.">
      <section className="exam-report__hero">
        <ScoreRing value={overallPct} max={100} size={184} caption="Overall"/>
        <div className="exam-report__summary">
          <h2>Practice Score</h2>
          <p className="muted">Based on your actual answers this attempt — a practice score, not an official Pearson PTE score.</p>
          <MetricStrip>
            <Metric label="Raw score" value={formatRaw(result.totalScore, result.totalMaxScore)}/>
            <Metric label="Questions" value={resultRows.length || null}/>
            <Metric label="Full marks" value={resultRows.length ? correct : null}
              hint={resultRows.length ? `of ${resultRows.length} questions` : undefined}/>
            <Metric label="Strongest" value={ranked.length ? titleCase(ranked[0].section) : null}
              hint={ranked.length ? `${ranked[0].percent}%` : undefined}/>
          </MetricStrip>
        </div>
      </section>

      <div className="page-stack">
      <section className="panel">
        <SectionHeader label="Section comparison" title="How each section scored"
          description={ranked.length > 1
            ? `${titleCase(ranked[0].section)} was your strongest; ${titleCase(ranked[ranked.length - 1].section)} your weakest.`
            : "Each section as a percentage of its own maximum."}/>
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
            { key: "score", label: "Score", align: "right", render: r => <b className="num-mono">{formatRaw(r.score, r.maxScore)}</b> },
            { key: "status", label: "Result", render: r => r.evaluationStatus === "COMPLETED"
                ? (r.maxScore && r.score >= r.maxScore
                    ? <span className="exam-mark is-full">Full marks</span>
                    : r.score > 0 ? <span className="exam-mark is-part">Partial</span>
                    : <span className="exam-mark is-none">No marks</span>)
                : <span className="muted">{titleCase(r.evaluationStatus || "pending")}</span> }
          ]}
          rows={resultRows.map((r, i) => ({ ...r, id: r._id || i }))}
          empty={<EmptyState title="Question-level detail is not available for this attempt"
            body="Your section scores above still reflect everything you answered."/>}
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
  function onAnswered(submission){ setAnswered(a=>({...a,[idx]:submission})); }
  // Both cases ask before submitting — an unfinished test warns about what is being left behind,
  // a finished one still confirms, because submitting ends the attempt either way.
  const confirmTitle = unansweredCount > 0 ? "Submit with questions unanswered?" : "Submit your test?";
  const confirmMessage = unansweredCount > 0
    ? `You have attempted ${answeredCount} of ${session.questions.length} questions. `
      + `${unansweredCount} ${unansweredCount === 1 ? "question" : "questions"} will be left unanswered and score nothing. `
      + `You still have ${formatMMSS(remainingMs ?? 0)} on the clock. Are you sure you want to submit?`
    : `You have attempted all ${session.questions.length} questions, with ${formatMMSS(remainingMs ?? 0)} remaining. `
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
        {q.section==="speaking" && <SpeakingTaskModule key={q._id} type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
        {q.section==="writing" && <WritingTaskModule key={q._id} type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
        {q.section==="reading" && <ReadingTask key={q._id} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
        {q.section==="listening" && <ListeningTask key={q._id} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
        </TaskRail>
        <div className="mock-nav btn-group" role="group" aria-label="Test navigation">
          <NavButton direction="previous" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>Previous</NavButton>
          {!isLast && <NavButton direction="next" onClick={()=>setIdx(i=>i+1)}>Next</NavButton>}
        </div>
      </div>
      <MockQuestionNav questions={session.questions} idx={idx} answered={answered} onJump={setIdx}/>
    </div>
    <ConfirmDialog open={showConfirm} title={confirmTitle} message={confirmMessage} confirmLabel="Finish Test" busy={finishing} onConfirm={()=>{ setShowConfirm(false); finish(); }} onCancel={()=>setShowConfirm(false)}/>
  </Page></>;
}

export default Mock;
