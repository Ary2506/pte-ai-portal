import React, { useEffect, useMemo, useState } from "react";
import { Play, Trophy, AlertCircle, CreditCard } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Badge, Empty, Page } from "../components/common.jsx";
import { Trajectory } from "../components/charts.jsx";
import {
  AnalyticsSkeleton, EmptyState, FocusAreas, Metric, MetricStrip, PerformanceTable,
  ScoreRing, SectionHeader, SkillSpectrum, taskLabel, titleCase
} from "../components/analytics.jsx";
import {
  bySection, focusAreas, improvement, pct, scored, skillBalance, summarize, targetGap, trajectory
} from "../analytics/derive.js";

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

// Dashboard — the student's command centre. It answers, in order: where am I, how far from
// target, am I improving, how consistent am I, which skill is weak, what should I practise next,
// and what did I just do.
//
// Two requests in parallel: /dashboard for the server's own rollup (streak, weekly activity) and
// one page of /history, which is what makes the derived analytics — trajectory, task-type gaps,
// focus areas — possible without a new endpoint. Either failing degrades the page rather than
// breaking it, because both are caught and every component renders an empty state for absent data.
export default function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(() => {
    const notice = sessionStorage.getItem("pte_access_denied_notice");
    sessionStorage.removeItem("pte_access_denied_notice");
    return notice || "";
  });
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    // Started inside a promise so a SYNCHRONOUS throw becomes a rejection too, not just a
    // rejected request. Without that, anything that fails before the fetch is even made escapes
    // the catch below and takes the whole page down — which is the opposite of degrading.
    const safely = (run) => Promise.resolve().then(run).catch(() => null);
    Promise.all([
      safely(() => api.dashboard()),
      safely(() => api.history({ limit: 100, page: 1 }))
    ]).then(([dash, hist]) => {
      if (!live) return;
      setData(dash);
      setHistory(hist?.submissions || []);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const stats = data?.stats;
  const target = stats?.targetScore;

  // Derived from the student's own attempts — analytics/derive.js holds the thresholds that
  // decide when each of these is allowed to say anything at all.
  const derived = useMemo(() => summarize(history), [history]);
  const series = useMemo(() => trajectory(history), [history]);
  const trend = useMemo(() => improvement(history), [history]);
  const sections = useMemo(() => bySection(history), [history]);
  const balance = useMemo(() => skillBalance(history), [history]);
  const areas = useMemo(() => focusAreas(history, { limit: 2 }), [history]);
  const gap = useMemo(() => targetGap(derived.average, target), [derived.average, target]);

  if (loading) {
    return (
      <Page title="Welcome back" subtitle="Keep practicing to achieve your target PTE score.">
        <AnalyticsSkeleton rows={5} />
      </Page>
    );
  }

  const subtitle = gap
    ? gap.met
      ? `You are ${gap.gap} point${gap.gap === 1 ? "" : "s"} above your target of ${gap.target}.`
      : `You are ${Math.abs(gap.gap)} point${Math.abs(gap.gap) === 1 ? "" : "s"} away from your target of ${gap.target}.`
    : "Keep practicing to achieve your target PTE score.";

  return (
    <Page
      title="Welcome back"
      subtitle={subtitle}
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

      {/* --- Where am I ------------------------------------------------------------------- */}
      <section className="command-hero">
        <ScoreRing value={derived.average} max={100} size={172} caption="Practice average" />
        <div className="command-hero__metrics">
          <MetricStrip>
            <Metric label="Target score" value={target ?? null} hint="Set on your profile" />
            <Metric label="Best score" value={derived.best} hint={`Across ${derived.attempts} attempts`} />
            <Metric label="Attempts" value={stats?.practiceCount ?? derived.attempts ?? null} />
            <Metric
              label="Overall change"
              value={trend ? `${trend.delta > 0 ? "+" : ""}${trend.delta}` : null}
              hint={trend ? `Over ${trend.points} attempts` : "Needs more attempts"}
            />
          </MetricStrip>
        </div>
      </section>

      {/* --- Am I improving, and how consistent am I -------------------------------------- */}
      <div className="dashboard-split">
        <section className="panel">
          <SectionHeader
            label="Score trajectory"
            title="Your recent attempts"
            description={series ? "Each point is one scored attempt, oldest first." : "A trend needs a few more attempts."}
            actions={<NavLink to="/progress" className="link">Full analysis</NavLink>}
          />
          {series ? (
            <div className="progress-chart">
              <Trajectory points={series} width={560} height={160} />
            </div>
          ) : (
            <EmptyState
              title="Not enough attempts to chart a trend"
              body="Keep practising — your trajectory appears once there is enough to show a direction."
            />
          )}
        </section>

        <StreakCard streak={data?.streak} weeklyActivity={data?.weeklyActivity} />
      </div>

      {/* --- Which skill is weak, and what to do about it ---------------------------------- */}
      <div className="dashboard-split">
        <section className="panel">
          <SectionHeader
            label="Skill profile"
            title="Section comparison"
            description={
              balance
                ? `${titleCase(balance.strongest.section)} leads ${titleCase(balance.weakest.section)} by ${balance.spread} points.`
                : "Practise in more than one section to compare them."
            }
          />
          <SkillSpectrum sections={sections} target={target} />
        </section>

        <section className="panel">
          <SectionHeader label="Next best practice" title="What to work on" />
          <FocusAreas areas={areas} onPractice={(area) => navigate(`/${area.section}`)} />
        </section>
      </div>

      <SubscriptionCard user={user} />

      {/* --- What did I just do ------------------------------------------------------------ */}
      <section className="panel">
        <SectionHeader
          label="Recent performance"
          title="Latest attempts"
          actions={<NavLink to="/history" className="link">View all</NavLink>}
        />
        <PerformanceTable
          columns={[
            { key: "when", label: "Date", render: (r) => new Date(r.createdAt).toLocaleDateString() },
            { key: "section", label: "Section", render: (r) => titleCase(r.section) },
            { key: "task", label: "Task", render: (r) => r.question?.title || taskLabel(r.type) },
            { key: "score", label: "Score", align: "right", render: (r) => <b className="num-mono">{pct(r)}</b> },
            { key: "raw", label: "Raw", align: "right", render: (r) => <span className="num-mono muted">{r.score}/{r.maxScore}</span> }
          ]}
          rows={scored(history).slice(0, 6).map((r) => ({ ...r, id: r._id }))}
          empty={<Empty text="Your practice attempts will appear here." />}
        />
      </section>

      <div className="mock-cta-banner">
        <div className="mock-cta-banner-icon">
          <Trophy size={22} />
        </div>
        <div className="mock-cta-banner-text">
          <h3>Ready for the real thing?</h3>
          <p className="muted">Take a full mock test and get a section-by-section practice report.</p>
        </div>
        <NavLink className="primary" to="/mock">
          Start Mock Test
        </NavLink>
      </div>
    </Page>
  );
}
