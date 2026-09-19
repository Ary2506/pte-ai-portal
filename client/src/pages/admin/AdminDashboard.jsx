import React, { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../../api.js";
import { Badge, Empty, SkeletonCards, SkeletonRows } from "../../components/common.jsx";
import { fmtDateTime } from "./adminFormat.js";

function StatTile({label,value,tone,onClick}) {
  return <button type="button" className={`stat-tile${onClick?" clickable":""}${tone?` stat-${tone}`:""}`} onClick={onClick} disabled={!onClick}>
    <span className="stat-value">{value}</span>
    <span className="stat-label">{label}</span>
  </button>
}

const ACTIVITY_LABELS = {
  USER_CREATED:"created", USER_BLOCKED:"blocked", USER_ACTIVATED:"activated", USER_SUSPENDED:"suspended",
  USER_UPDATED:"updated", PASSWORD_RESET:"reset the password of", SUBSCRIPTION_RENEWED:"renewed the subscription of",
  SUBSCRIPTION_CHANGED:"changed the subscription of", FORCE_LOGOUT:"force-logged-out",
  // Question Management actions (Phase 2 audit logging) — the stored action name is never
  // changed, only how it's displayed here; a.target is always null for these (see
  // adminQuestions.js's logAdminAction calls), so the sentence ends after the verb.
  QUESTION_CREATED:"created a question", QUESTION_UPDATED:"updated a question",
  QUESTION_ACTIVATED:"published a question", QUESTION_DEACTIVATED:"unpublished a question",
  QUESTION_DELETED:"deleted a question"
};
const QUESTION_ACTIVITY_ACTIONS = new Set(["QUESTION_CREATED", "QUESTION_UPDATED", "QUESTION_ACTIVATED", "QUESTION_DEACTIVATED", "QUESTION_DELETED"]);

export function AdminDashboard({notify, goToUsers, goToQuestions}) {
  const [stats,setStats]=useState(null);
  const [questionStats,setQuestionStats]=useState(null);
  const [activity,setActivity]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  useEffect(()=>{ load(); },[]);

  function load() {
    setLoading(true); setError("");
    Promise.all([api.admin.getStats(), api.admin.getAuditLog(8), api.admin.questions.stats()])
      .then(([s,a,q])=>{setStats(s);setActivity(a.logs);setQuestionStats(q)})
      .catch(e=>{setError(e.message);notify("error",e.message)})
      .finally(()=>setLoading(false));
  }

  if (loading) return <div className="admin-dashboard">
    <SkeletonCards count={8} gridClass="stat-grid"/>
    <SkeletonRows count={4}/>
  </div>;
  if (error) return <div className="panel error-state"><AlertCircle size={30}/><h4>Unable to load the dashboard</h4><p>Please check your connection and try again.</p><button className="secondary" onClick={load}>Retry</button></div>;

  return <div className="admin-dashboard">
    <section className="admin-hero">
      <div>
        <span className="eyebrow">ADMIN COMMAND CENTER</span>
        <h2>Run your learning portal with clarity.</h2>
        <p>Manage student access, subscriptions, and practice content from one focused workspace.</p>
      </div>
      <div className="admin-hero-metric">
        <span>Active learners</span>
        <strong>{stats.accountStatus.active}</strong>
        <small><span className="live-dot"/> Live account status</small>
      </div>
    </section>
    <div className="stat-grid">
      <StatTile label="Total users" value={stats.totalUsers}/>
      <StatTile label="Active accounts" value={stats.accountStatus.active} tone="good" onClick={()=>goToUsers({status:"ACTIVE"})}/>
      <StatTile label="Blocked" value={stats.accountStatus.blocked} tone="bad" onClick={()=>goToUsers({status:"BLOCKED"})}/>
      <StatTile label="Suspended" value={stats.accountStatus.suspended} tone="warn" onClick={()=>goToUsers({status:"SUSPENDED"})}/>
      <StatTile label="Pending payment" value={stats.paymentStatus.pending} tone="warn" onClick={()=>goToUsers({paymentStatus:"PENDING"})}/>
      <StatTile label="Paid" value={stats.paymentStatus.paid} tone="good" onClick={()=>goToUsers({paymentStatus:"PAID"})}/>
      <StatTile label="Expiring within 7 days" value={stats.subscription.expiringWithin7Days} tone="warn" onClick={()=>goToUsers({subscription:"EXPIRING"})}/>
      <StatTile label="Expired subscriptions" value={stats.subscription.expired} tone="bad" onClick={()=>goToUsers({subscription:"EXPIRED"})}/>
    </div>
    {questionStats && <>
      <h2 className="section-title">Question library</h2>
      <div className="stat-grid mini-grid">
        <StatTile label="Total questions" value={questionStats.total} onClick={goToQuestions}/>
        <StatTile label="Published" value={questionStats.active} tone="good" onClick={goToQuestions}/>
        <StatTile label="Draft" value={questionStats.inactive} tone="warn" onClick={goToQuestions}/>
        <StatTile label="Objective" value={questionStats.byEvaluationType.objective||0} onClick={goToQuestions}/>
        <StatTile label="Subjective" value={questionStats.byEvaluationType.subjective||0} onClick={goToQuestions}/>
      </div>
    </>}
    <section className="panel">
      <div className="panel-head"><div><h3>Recent admin activity</h3><p className="muted">Last {activity.length} action{activity.length===1?"":"s"}</p></div></div>
      {activity.length ? <div className="activity-list">{activity.map(a=><div className="activity-row" key={a.id}>
          <span className="activity-dot"/>
          <div><p><b>{a.admin?.username||"admin"}</b> {ACTIVITY_LABELS[a.action]||a.action.toLowerCase()} {a.target ? <b>{a.target.username}</b> : QUESTION_ACTIVITY_ACTIONS.has(a.action) && a.metadata?.title ? <b>"{a.metadata.title}"</b> : ""}</p><small className="muted">{fmtDateTime(a.createdAt)}</small></div>
        </div>)}</div> : <Empty text="No admin activity yet."/>}
    </section>
  </div>
}
