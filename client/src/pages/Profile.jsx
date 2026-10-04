import React, { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { Badge, Page } from "../components/common.jsx";
import { Button } from "../components/Button.jsx";
import { api } from "../api.js";
import { Metric, MetricStrip, SectionHeader } from "../components/analytics.jsx";
import StreakCalendar from "../components/StreakCalendar.jsx";
import { useToast } from "../components/toast.jsx";
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
const TARGET_MIN = 10;
const TARGET_MAX = 90;

/**
 * Set or change the student's target score.
 *
 * This lives on the profile because the target is account state, not page state: the dashboard,
 * study plan and performance pages all *read* it to compute a gap, and giving each of them its
 * own editor would mean three ways to change one number.
 */
function TargetScoreEditor({ user, onUserChange }) {
  const current = user.targetScore ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? TARGET_MAX);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function commit(targetScore) {
    setBusy(true);
    try {
      const data = await api.auth.setTargetScore(targetScore);
      onUserChange?.(data.user);
      setValue(data.user.targetScore);
      setEditing(false);
      toast.success("Target score updated.");
    } catch (e) {
      // Stays in the editor with the attempt intact, so the student can correct and retry.
      toast.error(e.message || "Could not save your target score.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="target-editor">
        <div className="target-editor__value">
          <span className="num-mono">{current ?? "—"}</span>
          {current !== null && <small>of {TARGET_MAX}</small>}
        </div>
        <div className="target-editor__actions">
          <Button variant="secondary" size="sm" icon={<Target/>} onClick={() => { setValue(current ?? TARGET_MAX); setEditing(true); }}>
            {current === null ? "Set target" : "Change target"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="target-editor is-editing"
      onSubmit={(e) => { e.preventDefault(); commit(Number(value)); }}
    >
      <label className="target-editor__field">
        <span className="sr-only">Target score</span>
        <input
          type="number"
          inputMode="numeric"
          min={TARGET_MIN}
          max={TARGET_MAX}
          step={1}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          aria-label="Target score"
        />
      </label>
      <span className="target-editor__hint">{TARGET_MIN}–{TARGET_MAX}</span>
      <Button type="submit" variant="primary" size="sm" loading={busy} loadingLabel="Saving...">Save</Button>
      <Button variant="tertiary" size="sm" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

export default function Profile({ user, onUserChange }) {
  const isAdmin = user.role === "admin";
  const [activity, setActivity] = useState(null);

  // Practice statistics on the account page come from the student's own attempts, like everywhere
  // else. Failure is silent and the section simply does not render — an account page should not
  // break because an analytics request did.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.activity())
      .then((act) => { if (live) setActivity(act); })
      .catch(() => {});
    return () => { live = false; };
  }, []);


  return (
    <Page title="Profile" subtitle="Manage your account.">
      <div className="page-stack">
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
                <dd><TargetScoreEditor user={user} onUserChange={onUserChange} /></dd>
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

        {activity?.streak && (
          <section className="panel streak-panel">
            <SectionHeader
              label="Practice streak"
              title="Your practice record"
              description="A day counts when you complete any practice question or finish a mock test."
            />
            <MetricStrip>
              <Metric label="Current streak" value={activity.streak.currentStreak ?? null} unit="days"
                hint={activity.streak.learnedToday ? "Practised today" : "Practise today to keep it going"} />
              <Metric label="Longest streak" value={activity.streak.longestStreak || null} unit="days" />
              <Metric label="Last activity" value={activity.streak.lastLearningDate || null} />
              <Metric label="Days practised" value={Object.keys(activity.days || {}).length || null}
                hint={activity.joinedAt ? `Since ${activity.joinedAt}` : undefined} />
            </MetricStrip>
            <StreakCalendar activity={activity} />
          </section>
        )}
      </div>
    </Page>
  );
}
