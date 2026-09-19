import React, { useEffect, useState } from "react";
import { Activity, Play, Sparkles, Trophy, AlertCircle, CreditCard, Flame, Check, X, HelpCircle } from "lucide-react";
import { NavLink } from "react-router-dom";
import { api } from "../api.js";
import { Badge, Empty, Page, SkeletonRows } from "../components/common.jsx";

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
function StreakCard({ streak, weeklyActivity }) {
  if (!streak) return null;
  return (
    <div className="panel streak-hero">
      <div className="streak-hero-head">
        <h3>🔥 {streak.currentStreak} Day Streak</h3>
        <div className="streak-hero-head-actions">
          <Badge tone={streak.learnedToday ? "good" : "warn"}>
            {streak.learnedToday ? "Learned today" : "Not yet today"}
          </Badge>
          <span
            className="streak-help"
            role="img"
            aria-label="About your streak"
            title="Complete one practice activity each day to keep your streak going."
          >
            <HelpCircle size={16} />
          </span>
        </div>
      </div>

      <div className="streak-pill">
        <span>Your Streak</span>
        <strong>{streak.currentStreak}</strong>
      </div>

      <div className="streak-meta">
        <div>
          <span>Longest streak</span>
          <b>
            {streak.longestStreak} day{streak.longestStreak === 1 ? "" : "s"}
          </b>
        </div>
        <div>
          <span>Last activity</span>
          <b>{streak.lastLearningDate || "—"}</b>
        </div>
      </div>

      {!!weeklyActivity?.length && (
        <div className="streak-week">
          <span className="streak-week-label">This Week</span>
          <div className="streak-week-dots">
            {weeklyActivity.map((d) => (
              <span
                key={d.date}
                className={d.active ? "streak-day-dot active" : "streak-day-dot"}
                aria-label={d.active ? "Learned" : "No activity"}
                title={
                  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                    new Date(`${d.date}T00:00:00Z`).getUTCDay()
                  ]
                }
              >
                {d.active ? (
                  <Check size={14} strokeWidth={3} />
                ) : (
                  <X size={14} strokeWidth={3} />
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="streak-foot">
        {streak.learnedToday
          ? "Keep learning every day!"
          : "Complete a practice activity today to keep your streak going."}
      </p>

      <div className="streak-hero-flames" aria-hidden="true">
        <Flame className="flame flame-1" />
        <Flame className="flame flame-2" />
        <Flame className="flame flame-3" />
      </div>
    </div>
  );
}
function ScoreCard({ title, value, sub, featured = false }) {
  return (
    <div className={featured ? "score-card featured" : "score-card"}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
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
      title="Welcome back 👋"
      subtitle="Keep practicing to achieve your target PTE score."
    >
      {accessDenied && (
        <div className="alert error">
          <AlertCircle size={17} />
          {accessDenied}
        </div>
      )}
      <div className="stats-row">
        <SubscriptionCard user={user} />
        <StreakCard streak={data?.streak} weeklyActivity={data?.weeklyActivity} />
      </div>
      <div className="hero-row dashboard-hero">
        <div>
          <span className="eyebrow">YOUR TARGET</span>
          <h1>{stats?.targetScore || 79}</h1>
          <span className="muted">Overall target score</span>
        </div>
        <div className="dashboard-hero-copy">
          <span className="hero-status">
            <Sparkles size={14} /> Your next score is built today
          </span>
          <p>
            Choose a focused practice task and turn your progress into a
            stronger PTE result.
          </p>
        </div>
        <NavLink className="primary" to="/speaking">
          <Play size={17} /> Continue Practice
        </NavLink>
      </div>
      <div className="score-grid">
        <ScoreCard
          title="Overall Score"
          value={stats?.overall || 0}
          sub="Practice average"
          featured
        />
        {(data?.bySection || []).map((x) => (
          <ScoreCard
            key={x.section}
            title={x.section}
            value={x.score}
            sub="Average score"
          />
        ))}
      </div>
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
