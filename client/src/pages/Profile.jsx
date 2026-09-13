import React from "react";
import { Badge, Page } from "../components/common.jsx";
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
    </Page>
  );
}
