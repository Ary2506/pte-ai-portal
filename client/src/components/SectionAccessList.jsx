import React from "react";
import { Badge } from "./common.jsx";
import { SECTION_LABELS } from "../practiceTaskRegistry.js";
import { formatShortDate } from "../access.js";

const DAY_MS = 86400000;

function describe(row) {
  if (row.status === "ACTIVE") {
    const days = Math.max(0, Math.ceil((new Date(row.endDate) - Date.now()) / DAY_MS));
    return { tone: "good", label: "Active", detail: `until ${formatShortDate(row.endDate)} · ${days} day${days === 1 ? "" : "s"} left` };
  }
  if (row.status === "NOT_PURCHASED") return { tone: "neutral", label: "Not in plan", detail: "" };
  return {
    tone: "bad",
    label: row.status === "CANCELLED" ? "Cancelled" : "Expired",
    detail: row.endDate ? `on ${formatShortDate(row.endDate)}` : ""
  };
}

/**
 * Each section's own access, for a student whose sections differ — some not bought, some lapsed,
 * or bought at different times and ending on different dates.
 *
 * Renders nothing when every section is active and ends on the same day: that plan is described
 * completely by the subscription dates already shown beside this, and repeating them four times
 * would add nothing. It is also nothing for an admin, or for a stored user from before
 * per-section access existed (no `sections` list yet).
 */
export function SectionAccessList({ user, className = "" }) {
  if (!user || user.role === "admin" || !Array.isArray(user.sections) || !user.sections.length) return null;
  const uniform = user.sections.every(r => r.status === "ACTIVE")
    && new Set(user.sections.map(r => new Date(r.endDate).getTime())).size === 1;
  if (uniform) return null;
  return (
    <ul className={`section-access-list ${className}`.trim()} aria-label="Access by section">
      {user.sections.map(row => {
        const { tone, label, detail } = describe(row);
        return (
          <li key={row.section} className={`section-access-row is-${row.status.toLowerCase()}`}>
            <span className="section-access-name">{SECTION_LABELS[row.section] || row.section}</span>
            <Badge tone={tone}>{label}</Badge>
            {detail && <span className="section-access-detail">{detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default SectionAccessList;
