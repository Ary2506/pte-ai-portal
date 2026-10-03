import React, { useEffect, useMemo, useState } from "react";
import { Badge, Page } from "../components/common.jsx";
import { api } from "../api.js";
import { Metric, MetricStrip, ScoreRing, SectionHeader, SkillSpectrum, formatDuration, titleCase } from "../components/analytics.jsx";
import { bySection, scored, skillBalance, summarize, targetGap } from "../analytics/derive.js";
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : "—";
}
function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString() : "—";
}
function daysRemaining(user) {
  if (!user.subscriptionEndDate || user.subscriptionStatus !== "ACTIVE")
    return "—";
  return Math.max(
    0,
    Math.ceil((new Date(user.subscriptionEndDate) - Date.now()) / 86400000),
  );
}
function subscriptionTone(status) {
  return status === "ACTIVE"
    ? "good"
    : status === "EXPIRED"
      ? "bad"
      : "neutral";
}
export default function Profile({ user }) {
  const isAdmin = user.role === "admin";
  const [history, setHistory] = useState([]);

  // Practice statistics on the account page come from the student's own attempts, like everywhere
  // else. Failure is silent and the section simply does not render — an account page should not
  // break because an analytics request did.
  useEffect(() => {
    if (isAdmin) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => api.history({ limit: 100, page: 1 }))
      .then((d) => { if (live) setHistory(d?.submissions || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [isAdmin]);

  const stats = useMemo(() => summarize(history), [history]);
  const sections = useMemo(() => bySection(history), [history]);
  const balance = useMemo(() => skillBalance(history), [history]);
  const gap = useMemo(() => targetGap(stats.average, user?.targetScore), [stats.average, user?.targetScore]);
  const hasPractice = scored(history).length > 0;

  return (
    <Page title="Profile" subtitle="Manage your account.">
      <div className="profile-card panel">
        <div className="profile-header">
          <div className="profile-avatar">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2>{user.name}</h2>
            <p className="muted">User ID: {user.username}</p>
          </div>
        </div>
        <div className="detail-grid cols-2">
          <section>
            <h4>Account information</h4>
            <dl>
              <dt>Role</dt>
              <dd style={{ textTransform: "capitalize" }}>{user.role}</dd>
              <dt>Email</dt>
              <dd>{user.email || "—"}</dd>
              <dt>Target score</dt>
              <dd>{user.targetScore ?? "—"}</dd>
              <dt>Member since</dt>
              <dd>{fmtDate(user.createdAt)}</dd>
              <dt>Last login</dt>
              <dd>{fmtDateTime(user.lastLoginAt)}</dd>
            </dl>
          </section>
          <section>
            <h4>Subscription</h4>
            {isAdmin ? (
              <p className="muted">
                Administrator accounts are not subject to subscription limits.
              </p>
            ) : (
              <dl>
                <dt>Status</dt>
                <dd>
                  <Badge tone={subscriptionTone(user.subscriptionStatus)}>
                    {(user.subscriptionStatus || "").replace("_", " ")}
                  </Badge>
                </dd>
                <dt>Started</dt>
                <dd>{fmtDate(user.subscriptionStartDate)}</dd>
                <dt>Access until</dt>
                <dd>{fmtDate(user.subscriptionEndDate)}</dd>
                <dt>Days remaining</dt>
                <dd>{daysRemaining(user)}</dd>
              </dl>
            )}
          </section>
        </div>
        {!isAdmin && (
          <p className="muted profile-footnote">
            To change your password or extend access, contact your
            administrator.
          </p>
        )}
      </div>

      {!isAdmin && hasPractice && (
        <>
          <section className="command-hero">
            <ScoreRing value={stats.average} max={100} size={156} caption="Practice average" />
            <div className="command-hero__metrics">
              <MetricStrip>
                <Metric label="Target score" value={user.targetScore ?? null} />
                <Metric
                  label="Gap to target"
                  value={gap ? (gap.gap > 0 ? `+${gap.gap}` : gap.gap) : null}
                  hint={gap?.met ? "Above target" : "Below target"}
                />
                <Metric label="Best score" value={stats.best} />
                <Metric label="Attempts" value={stats.attempts || null} />
                <Metric
                  label="Time measured"
                  value={formatDuration(stats.totalSeconds)}
                  hint={stats.timedAttempts ? `${stats.timedAttempts} timed attempts` : "No timed attempts"}
                />
              </MetricStrip>
            </div>
          </section>

          <section className="panel">
            <SectionHeader
              label="Practice statistics"
              title="Section profile"
              description={
                balance
                  ? `${titleCase(balance.strongest.section)} is your strongest section, ${titleCase(balance.weakest.section)} your weakest.`
                  : "Practise in more than one section to compare them."
              }
            />
            <SkillSpectrum sections={sections} target={user.targetScore} />
          </section>
        </>
      )}
    </Page>
  );
}
