import React, { useEffect, useState } from "react";
import { Activity, Play, Sparkles, Trophy, AlertCircle } from "lucide-react";
import { NavLink } from "react-router-dom";
import { api } from "../api.js";
import { Badge, Empty, Page, SkeletonRows } from "../components/common.jsx";

function fmtLongDate(d) {
  return d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
}
function SubscriptionCard({ user }) {
  const daysLeft = user.subscriptionEndDate
    ? Math.max(
        0,
        Math.ceil((new Date(user.subscriptionEndDate) - Date.now()) / 86400000),
      )
    : null;
  return (
    <div className="panel subscription-card">
      <div className="subscription-card-head">
        <h3>Subscription</h3>
        <Badge tone="good">ACTIVE</Badge>
      </div>
      <div className="subscription-card-grid">
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
    </div>
  );
}
function StreakCard({ streak }) {
  if (!streak) return null;
  return (
    <div className="panel subscription-card">
      <div className="subscription-card-head">
        <h3>🔥 {streak.currentStreak} Day Streak</h3>
        <Badge tone={streak.learnedToday ? "good" : "warn"}>
          {streak.learnedToday ? "Learned today" : "Not yet today"}
        </Badge>
      </div>
      <div className="subscription-card-grid">
        <div>
          <span>Current streak</span>
          <b>
            {streak.currentStreak} day{streak.currentStreak === 1 ? "" : "s"}
          </b>
        </div>
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
      <p className="muted" style={{ marginTop: 12 }}>
        {streak.learnedToday
          ? "Keep learning every day!"
          : "Complete a practice activity today to keep your streak going."}
      </p>
    </div>
  );
}
function WeeklyActivity({ days }) {
  if (!days?.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <h3 style={{ marginTop: 0 }}>This Week</h3>
      <div
        style={{ display: "flex", gap: 10, justifyContent: "space-between" }}
      >
        {days.map((d) => (
          <div key={d.date} style={{ textAlign: "center" }}>
            <small
              className="muted"
              style={{ display: "block", marginBottom: 4 }}
            >
              {
                ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                  new Date(`${d.date}T00:00:00Z`).getUTCDay()
                ]
              }
            </small>
            <span
              style={{ fontSize: 18 }}
              aria-label={d.active ? "Learned" : "No activity"}
            >
              {d.active ? "✅" : "❌"}
            </span>
          </div>
        ))}
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
      <SubscriptionCard user={user} />
      <StreakCard streak={data?.streak} />
      <WeeklyActivity days={data?.weeklyActivity} />
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
