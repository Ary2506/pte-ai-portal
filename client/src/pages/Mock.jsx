import React, { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BookOpen, CheckCircle2, Clock3, Headphones, Mic, PenLine, Trophy } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";
import { Page } from "../components/common.jsx";
import { PRACTICE_SECTIONS, SECTION_LABELS } from "../practiceTaskRegistry.js";
import { ReadingTask } from "../practice/Reading.jsx";
import { ListeningTask } from "../practice/Listening.jsx";
import SpeakingTaskModule from "../practice/Speaking.jsx";
import WritingTaskModule from "../practice/Writing.jsx";

const SECTION_ICONS = { speaking: Mic, writing: PenLine, reading: BookOpen, listening: Headphones };

function ScoreRing({ value, max, size }) {
  const percent = max ? Math.round((value / max) * 100) : 0;
  return <div className={`score-ring ${size === "lg" ? "large" : ""}`} style={{ "--score": `${percent}%` }}><strong>{value}</strong><small>/{max}</small></div>;
}

function ScoreCard({ title, value, sub }) {
  return <div className="score-card"><span>{title}</span><strong>{value}</strong><small>{sub}</small></div>;
}

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
  return <div className="mock-qnav" role="tablist" aria-label="Question overview">
    {questions.map((q, i) => {
      const state = i === idx ? "current" : answered[i] ? "answered" : "unanswered";
      return <button key={q._id || i} type="button" className={`mock-qnav-item ${state}`} onClick={() => onJump(i)} aria-current={i === idx || undefined} title={`Question ${i + 1} — ${state}`}>{i + 1}</button>;
    })}
  </div>;
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
      <div className="modal-actions"><button className="secondary" onClick={onCancel} disabled={busy}>Cancel</button><button className="primary" onClick={onConfirm} disabled={busy}>{busy ? "Working..." : confirmLabel}</button></div>
    </div>
  </div>;
}

function Mock() {
  const [session,setSession]=useState(null);
  const [idx,setIdx]=useState(0);
  const [answered,setAnswered]=useState({});
  const [result,setResult]=useState(null);
  const [starting,setStarting]=useState(false);
  const [finishing,setFinishing]=useState(false);
  const [error,setError]=useState("");
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
    setStarting(true); setError("");
    try {
      const d = await api.testSessions.start();
      autoSubmittedRef.current=false; lowTimeAnnouncedRef.current=false;
      setSession(d); setIdx(0); setAnswered({}); setTimeUp(false); setTerminal(null); setRemainingMs(null);
      setPoliteAnnouncement(""); setAssertiveAnnouncement("");
    } catch(e){ setError(e.message); } finally { setStarting(false); }
  }

  async function finish() {
    setFinishing(true); setError(""); setPoliteAnnouncement("Finishing your test…");
    try {
      const d = await api.testSessions.complete(session.testSession._id);
      setResult(d.testSession);
      setPoliteAnnouncement("Your mock test has been completed and scored.");
    } catch(e){
      if (e.code === "TEST_SESSION_EXPIRED") { setTerminal("EXPIRED"); setAssertiveAnnouncement("Your test session has expired."); }
      else if (e.code === "SESSION_ALREADY_COMPLETED") { setTerminal("ALREADY_COMPLETED"); setPoliteAnnouncement("This test was already completed."); }
      else setError(e.message);
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
    return <>{liveRegions}<Page title="Mock Test Complete" subtitle="Here is your practice report.">
      <div className="mock-result">
        <ScoreRing value={result.totalScore} max={result.totalMaxScore} size="lg"/>
        <h2>Practice Score</h2>
        <p className="muted">Based on your actual answers this attempt — a practice score, not an official Pearson PTE score.</p>
        <div className="score-grid">{result.sectionScores.map(s=><ScoreCard key={s.section} title={s.section} value={`${s.score}/${s.maxScore}`} sub="Section score"/>)}</div>
        <NavLink className="primary" to="/dashboard">Back to Dashboard</NavLink>
      </div>
    </Page></>;
  }

  if (terminal === "EXPIRED") {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
      <div className="mock-card panel mock-terminal expired">
        <div className="mock-icon-badge tone-danger"><Clock3 size={30}/></div>
        <h2>Mock Test Expired</h2>
        <p>Your allotted test time has ended. Your test can no longer accept answers.</p>
        <NavLink className="primary" to="/dashboard">Back to Dashboard</NavLink>
      </div>
    </Page></>;
  }

  if (terminal === "ALREADY_COMPLETED") {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
      <div className="mock-card panel mock-terminal">
        <div className="mock-icon-badge tone-success"><CheckCircle2 size={30}/></div>
        <h2>This Test Was Already Completed</h2>
        <p>This mock attempt has already been submitted and scored.</p>
        <NavLink className="primary" to="/history">View History</NavLink>
      </div>
    </Page></>;
  }

  if (!session) {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
      <div className="mock-card panel">
        <div className="mock-icon-badge"><Trophy size={30}/></div>
        <h2>Full PTE Practice Mock</h2>
        <p>One question per section, scored from your actual answers — not a preset result.</p>
        <div className="mock-section-chips">
          {PRACTICE_SECTIONS.map(s => { const Icon = SECTION_ICONS[s]; return <span className="mock-section-chip" key={s}>{Icon && <Icon size={14}/>} {SECTION_LABELS[s]}</span>; })}
        </div>
        <p className="muted">20 minutes total for this compact mock.</p>
        {error && <div className="alert error">{error}</div>}
        <button className="primary" disabled={starting} onClick={start}>{starting?"Preparing...":"Start Mock Test"}</button>
      </div>
    </Page></>;
  }

  if (timeUp) {
    return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
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
  const confirmMessage = `You have answered ${answeredCount} of ${session.questions.length} questions, with ${formatMMSS(remainingMs ?? 0)} remaining.`
    + (unansweredCount > 0 ? " You still have unanswered questions." : "");

  return <>{liveRegions}<Page title="Mock Tests" subtitle="Simulate a compact PTE test experience.">
    <div className="mock-progress-bar">
      <span>Question {idx+1} of {session.questions.length}</span>
      <span className="chip">{q.section}</span>
      <MockTimer remainingMs={remainingMs}/>
    </div>
    <div className="mock-progress-track" role="progressbar" aria-valuenow={idx+1} aria-valuemin={1} aria-valuemax={session.questions.length} aria-valuetext={`Question ${idx+1} of ${session.questions.length}`}>
      <div className="mock-progress-fill" style={{width: `${((idx+1)/session.questions.length)*100}%`}}/>
    </div>
    <MockQuestionNav questions={session.questions} idx={idx} answered={answered} onJump={setIdx}/>
    {q.section==="speaking" && <SpeakingTaskModule key={q._id} type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {q.section==="writing" && <WritingTaskModule type={q.title} question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {q.section==="reading" && <ReadingTask question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {q.section==="listening" && <ListeningTask question={q} testSessionId={session.testSession._id} onAnswered={onAnswered}/>}
    {error && <div className="alert error">{error}</div>}
    <div className="mock-nav">
      <button className="secondary" disabled={idx===0} onClick={()=>setIdx(i=>i-1)}>‹ Previous</button>
      {!isLast && <button className="primary" onClick={()=>setIdx(i=>i+1)}>Next ›</button>}
      <button className="secondary" disabled={finishing} onClick={()=>setShowConfirm(true)}>{finishing?"Finishing...":"Finish Test"}</button>
    </div>
    <ConfirmDialog open={showConfirm} title="Finish mock test?" message={confirmMessage} confirmLabel="Finish Test" busy={finishing} onConfirm={()=>{ setShowConfirm(false); finish(); }} onCancel={()=>setShowConfirm(false)}/>
  </Page></>;
}

export default Mock;
