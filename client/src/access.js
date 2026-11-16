import React, { useContext } from "react";
import { PRACTICE_SECTIONS, SECTION_LABELS } from "./practiceTaskRegistry.js";

// Per-section access, as the client sees it.
//
// The server decides who may open what and enforces it on every request (SECTION_LOCKED and
// SECTION_EXPIRED). Everything here only decides what to SHOW, from the `sections` list the server
// sends with the user — each row's status computed on the server, so the student's own clock can
// never unlock anything.
//
// A user with no `sections` list reads as having every section. That covers two real cases: a
// student still signed in from before this existed (their stored user has no such field until the
// next /auth/me refresh), and any component rendered without a signed-in user at all. In both, the
// server still has the final word.

/** The signed-in user, provided once in App.jsx. null outside it, which reads as full access. */
export const CurrentUserContext = React.createContext(null);

export function useCurrentUser() {
  return useContext(CurrentUserContext);
}

const ACTIVE = { status: "ACTIVE", endDate: null };

export function sectionInfo(user, section) {
  if (!user || user.role === "admin" || !Array.isArray(user.sections)) return ACTIVE;
  const row = user.sections.find(r => r.section === section);
  return row ? { status: row.status, endDate: row.endDate || null } : { status: "NOT_PURCHASED", endDate: null };
}

export function canAccessSection(user, section) {
  return sectionInfo(user, section).status === "ACTIVE";
}

export function isFullAccess(user) {
  return PRACTICE_SECTIONS.every(section => canAccessSection(user, section));
}

export function formatShortDate(value) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Why `section` is locked to this user, or null if it is not. Two cases, told apart because they
 * ask different things of the student: never bought ("add it") or bought and lapsed ("renew it").
 * A cancelled section reads as expired.
 */
export function lockReason(user, section) {
  const { status, endDate } = sectionInfo(user, section);
  if (status === "ACTIVE") return null;
  const name = SECTION_LABELS[section] || section;
  if (status === "NOT_PURCHASED") {
    return {
      kind: "not-purchased",
      label: "Not in your plan",
      message: `${name} is not part of your plan. Contact the administrator to add it.`
    };
  }
  return {
    kind: "expired",
    label: endDate ? `Expired ${formatShortDate(endDate)}` : "Expired",
    message: `Your ${name} access ${endDate ? `expired on ${formatShortDate(endDate)}` : "has expired"}. Contact the administrator to renew it.`
  };
}

/** Sections the user cannot open right now, in exam order. */
export function lockedSections(user) {
  return PRACTICE_SECTIONS.filter(section => !canAccessSection(user, section));
}

/** The active sections ordered by which runs out first, with their end dates. */
export function activeSectionsByExpiry(user) {
  if (!user || user.role === "admin" || !Array.isArray(user.sections)) return [];
  return user.sections
    .filter(r => r.status === "ACTIVE" && r.endDate)
    .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
}

/** Codes the server sends when a section is closed to the student — never a reason to sign out. */
export const SECTION_DENIAL_CODES = new Set(["SECTION_LOCKED", "SECTION_EXPIRED"]);
