import React, { useEffect, useState } from "react";
import { Activity, Play, Trophy, AlertCircle, CreditCard, Flame, ArrowUpRight, Target, ListChecks } from "lucide-react";
import { NavLink } from "react-router-dom";
import { api } from "../api.js";
import { Badge, Empty, Page, SkeletonRows } from "../components/common.jsx";
import { Trajectory } from "../components/charts.jsx";

function fmtLongDate(d) {
  return d
    ? new Date(d).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";
}
const SUBSCRIPTION_NOTICE = {
  EXPIRED: {
    title: "Your 30-day subscription has expired.",
    body: "Please contact the administrator for renewal.",
  },
  NOT_ACTIVATED: {
    title: "Your subscription has not been activated yet.",
    body: "Please contact the administrator to get started.",
  },
};
function SubscriptionCard({ user }) {
  if (user.role === "admin") return null;
  const status = user.subscriptionStatus || "ACTIVE";
  const tone = status === "ACTIVE" ? "good" : status === "EXPIRED" ? "bad" : "warn";
  const notice = SUBSCRIPTION_NOTICE[status];
  const daysLeft = user.subscriptionEndDate
    ? Math.max(
        0,
        Math.ceil((new Date(user.subscriptionEndDate) - Date.now()) / 86400000),
      )
    : null;
  return (
    <div className="panel stat-card">
      <div className="stat-card-head">
        <div className="stat-card-icon tone-sub">
          <CreditCard size={19} />
        </div>
        <div className="stat-card-title">
          <h3>Subscription</h3>
          <span>Your access plan</span>
        </div>
        <Badge tone={tone}>{status.replace("_", " ")}</Badge>
      </div>
      {notice ? (
        <div className="stat-card-notice">
          <p className="stat-card-notice-title">{notice.title}</p>
          <p className="muted">{notice.body}</p>
        </div>
      ) : (
        <div className="stat-card-grid">
          <div>
            <span>Started</span>
            <b>{fmtLongDate(user.subscriptionStartDate)}</b>
          </div>
          <div>
            <span>Expires</span>
            <b>{fmtLongDate(user.subscriptionEndDate)}</b>
          </div>
          <div>
            <span>Days remaining</span>
            <b>{daysLeft ?? "—"}</b>
          </div>
        </div>
      )}
    </div>
  );
}
// A headline metric. Every one of these is read straight off the dashboard payload — there is no
// rank, percentile or month-over-month delta on this product, and inventing one would put a
// number on screen that nothing could ever reconcile.
function MetricCard({ icon: Icon, label, value, unit, sub, to }) {
  return (
    <div className="metric-card">
      <div className="metric-card-head">
        <Icon size={15} />
        <span>{label}</span>
        {to && (
          <NavLink to={to} className="metric-card-link" aria-label={`Open ${label}`}>
            <ArrowUpRight size={15} />
          </NavLink>
        )}
      </div>
      <div className="metric-card-value">
        <strong className="num-mono">{value}</strong>
        {unit && <span className="metric-card-unit">{unit}</span>}
      </div>
      {sub && <p className="metric-card-sub">{sub}</p>}
    </div>
  );
}

// Scores of the most recent attempts, oldest first, so the line reads left to right as time.
// `recent` arrives newest-first and excludes mock-test answers.
function ScoreProgress({ recent, target }) {
  const series = [...(recent || [])]
    .reverse()
    .map((s) => (typeof s.maxScore === "number" && s.maxScore > 0 ? Math.round((s.score / s.maxScore) * 100) : s.score))
    .filter((n) => Number.isFinite(n));

  return (
    <section className="panel progress-panel">
      <div className="panel-head">
        <div>
          <h3>Score progress</h3>
          <p className="muted">
            {series.length > 1
              ? `Your last ${series.length} practice attempts, oldest first.`
              : "Your attempts will chart here once you have a few."}
          </p>
        </div>
        <span className="progress-target num-mono">Target {target || 79}</span>
      </div>
      {series.length > 1 ? (
        <div className="progress-chart">
          <Trajectory points={series} width={560} height={150} />
        </div>
      ) : (
        <Empty text="Complete a few practice questions to see your trend." />
      )}
    </section>
  );
}

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

// Practice consistency. Deliberately plain: no flame art, no emoji, no red crosses for the days
// someone did not practise. A missed day is an empty cell, not a failure mark — this is a record
// of effort, and scolding a student for Tuesday is not what makes them open the app on Wednesday.
function StreakCard({ streak, weeklyActivity }) {
  if (!streak) return null;
  const days = weeklyActivity || [];
  const activeDays = days.filter((d) => d.active).length;

  return (
    <section className="panel streak-card">
      <div className="panel-head">
        <div>
          <h3>Practice streak</h3>
          <p className="muted">One practice activity a day keeps it running.</p>
        </div>
        <Badge tone={streak.learnedToday ? "good" : "warn"}>
          {streak.learnedToday ? "Done today" : "Not yet today"}
        </Badge>
      </div>

      <div className="streak-figure">
        <strong className="num-mono">{streak.currentStreak}</strong>
        <span>consecutive {streak.currentStreak === 1 ? "day" : "days"}</span>
      </div>

      {!!days.length && (
        <div className="streak-week">
          <div className="streak-week-head">
            <span className="stat-label">Last 7 days</span>
            <span className="muted">{activeDays} of {days.length}</span>
          </div>
          <ol className="streak-week-strip">
            {days.map((d) => {
              const weekday = DAY_INITIALS[new Date(`${d.date}T00:00:00Z`).getUTCDay()];
              return (
                <li key={d.date} className={d.active ? "streak-day is-active" : "streak-day"}>
                  <span className="streak-day-mark" aria-hidden="true" />
                  <span className="streak-day-label" aria-hidden="true">{weekday}</span>
                  <span className="sr-only">{d.date}: {d.active ? "practised" : "no practice"}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <dl className="streak-stats">
        <div>
          <dt>Longest streak</dt>
          <dd className="num-mono">{streak.longestStreak} {streak.longestStreak === 1 ? "day" : "days"}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd className="num-mono">{streak.lastLearningDate || "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

// Per-section averages against the student's target, which is the question the four numbers are
// actually there to answer: which skill is furthest from where it needs to be.
function SectionPerformance({ bySection, target }) {
  const rows = bySection || [];
  if (!rows.length) return null;
  const goal = target || 79;

  return (
    <section className="panel section-perf">
      <div className="panel-head">
        <div>
          <h3>Section performance</h3>
          <p className="muted">Average score per section, against your target of {goal}.</p>
        </div>
      </div>
      <div className="section-perf-rows">
        {rows.map((row) => {
          const pct = Math.max(0, Math.min(100, row.score));
          const gap = goal - row.score;
          return (
            <div className="section-perf-row" key={row.section} data-section={row.section}>
              <span className="section-perf-name">{row.section}</span>
              <span className="section-perf-track">
                <span className="section-perf-fill" style={{ width: `${pct}%` }} />
                <span className="section-perf-goal" style={{ left: `${Math.min(100, goal)}%` }} aria-hidden="true" />
              </span>
              <span className="section-perf-score num-mono">{row.score}</span>
              <span className={gap > 0 ? "section-perf-gap is-behind" : "section-perf-gap"}>
                {gap > 0 ? `${gap} to target` : "On target"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(() => {
    const notice = sessionStorage.getItem("pte_access_denied_notice");
    sessionStorage.removeItem("pte_access_denied_notice");
    return notice || "";
  });
  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const stats = data?.stats;
  return (
    <Page
      title="Welcome back"
      subtitle="Keep practicing to achieve your target PTE score."
      actions={
        <NavLink className="primary" to="/speaking">
          <Play size={16} /> Continue practice
        </NavLink>
      }
    >
      {accessDenied && (
        <div className="alert error">
          <AlertCircle size={17} />
          {accessDenied}
        </div>
      )}
      <div className="metric-row">
        <MetricCard icon={Target} label="Overall score" value={stats?.overall ?? 0}
          sub={`Practice average · target ${stats?.targetScore || 79}`} to="/history" />
        <MetricCard icon={ListChecks} label="Practice attempts" value={stats?.practiceCount ?? 0}
          sub="Questions you have answered" to="/history" />
        <MetricCard icon={Flame} label="Day streak" value={data?.streak?.currentStreak ?? 0} unit="days"
          sub={data?.streak?.learnedToday ? "Practised today" : "Practise today to keep it"} />
      </div>

      <div className="dashboard-split">
        <ScoreProgress recent={data?.recent} target={stats?.targetScore} />
        <StreakCard streak={data?.streak} weeklyActivity={data?.weeklyActivity} />
      </div>

      <SubscriptionCard user={user} />
      <SectionPerformance bySection={data?.bySection} target={stats?.targetScore} />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Recent Results</h3>
            <p className="muted">Your latest submissions</p>
          </div>
          <NavLink to="/history" className="link">
            View all
          </NavLink>
        </div>
        {loading ? (
          <SkeletonRows count={3} />
        ) : (data?.recent || []).length ? (
          <div className="recent-list">
            {data.recent.map((s) => (
              <div className="recent" key={s._id}>
                <div className="recent-icon">
                  <Activity size={16} />
                </div>
                <div>
                  <b>{s.type}</b>
                  <small>{s.section}</small>
                </div>
                <strong>{s.score}</strong>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Your practice attempts will appear here." />
        )}
      </section>
      <div className="mock-cta-banner">
        <div className="mock-cta-banner-icon">
          <Trophy size={22} />
        </div>
        <div className="mock-cta-banner-text">
          <h3>Ready for the real thing?</h3>
          <p className="muted">
            Take a full mock test and get a section-by-section practice report.
          </p>
        </div>
        <NavLink className="primary" to="/mock">
          Start Mock Test
        </NavLink>
      </div>
    </Page>
  );
}
