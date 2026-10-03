import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Page } from "../components/common.jsx";
import {
  AnalyticsSkeleton, EmptyState, FocusAreas, Metric, MetricStrip,
  ScoreRing, SectionHeader, SkillSpectrum, titleCase
} from "../components/analytics.jsx";
import { bySection, focusAreas, pct, scored, skillBalance, summarize, targetGap } from "../analytics/derive.js";

// Target Score Plan.
//
// The plan is a recommendation computed from the student's own attempts, not a template: the
// week is ordered by which sections they are actually weakest in, and a day counts as done when
// there is a scored attempt in that section on that date. Nothing here is a canned task list —
// the previous version fell back to four hardcoded strings whenever the API was slow, which told
// every student the same thing regardless of how they were doing.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The seven dates of the week ending today, oldest first, as YYYY-MM-DD in UTC. */
function weekDates() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Assigns a focus to each day of the week, weakest section first and cycling.
 *
 * This is a suggestion derived from real section averages — stated as such on the page — not a
 * schedule the product pretends to have authored for this student personally.
 */
function buildWeek(sections, history) {
  const ranked = sections
    .filter(s => s.average !== null)
    .sort((a, b) => a.average - b.average)
    .map(s => s.section);
  // Nothing attempted yet: suggest each section once so the week is still a usable starting point.
  const order = ranked.length ? ranked : ["speaking", "writing", "reading", "listening"];

  const done = scored(history);
  return weekDates().map((date, i) => {
    // The last day of the week is reserved for a full mock, which is the one thing practice
    // alone does not rehearse.
    const isMockDay = i === 6;
    const section = isMockDay ? null : order[i % order.length];
    const attempts = done.filter(
      r => r.createdAt?.slice(0, 10) === date && (!section || r.section === section));
    const isToday = date === weekDates()[6];
    const isPast = new Date(`${date}T23:59:59Z`).getTime() < Date.now() && !isToday;

    return {
      date,
      weekday: DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()],
      section,
      isMockDay,
      attempts: attempts.length,
      status: attempts.length ? "done" : isPast ? "missed" : isToday ? "today" : "upcoming"
    };
  });
}

export default function StudyPlan({ user }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.history({ limit: 100, page: 1 }))
      .then(d => { if (live) setHistory(d?.submissions || []); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const stats = useMemo(() => summarize(history), [history]);
  const sections = useMemo(() => bySection(history), [history]);
  const balance = useMemo(() => skillBalance(history), [history]);
  const areas = useMemo(() => focusAreas(history, { limit: 3 }), [history]);
  const gap = useMemo(() => targetGap(stats.average, user?.targetScore), [stats.average, user?.targetScore]);
  const week = useMemo(() => buildWeek(sections, history), [sections, history]);

  if (loading) {
    return <Page title="Study plan" subtitle="Built from your own practice history.">
      <AnalyticsSkeleton rows={5}/>
    </Page>;
  }

  if (!scored(history).length) {
    return <Page title="Study plan" subtitle="Built from your own practice history.">
      <EmptyState
        title="Your plan starts with your first attempt"
        body="Once you have practised a few questions, this page orders your week around the sections and task types you are weakest in."
        action={<button type="button" className="primary" onClick={() => navigate("/practice")}>Start practising</button>}
      />
    </Page>;
  }

  return <Page
    title="Study plan"
    subtitle={
      gap
        ? gap.met
          ? `You are ${gap.gap} point${gap.gap === 1 ? "" : "s"} above your target of ${gap.target}. Keep it there.`
          : `${Math.abs(gap.gap)} point${Math.abs(gap.gap) === 1 ? "" : "s"} to your target of ${gap.target}.`
        : "Set a target score on your profile to track the gap."
    }
    actions={<NavLink className="primary" to="/practice">Open practice library</NavLink>}
  >
    <section className="command-hero">
      <ScoreRing value={stats.average} max={100} size={164} caption="Practice average"/>
      <div className="command-hero__metrics">
        <MetricStrip>
          <Metric label="Target" value={user?.targetScore ?? null} hint="Set on your profile"/>
          <Metric label="Gap" value={gap ? (gap.gap > 0 ? `+${gap.gap}` : gap.gap) : null}
            hint={gap?.met ? "Above target" : "Below target"}/>
          <Metric label="Best" value={stats.best}/>
          <Metric label="Attempts" value={stats.attempts || null}/>
        </MetricStrip>
      </div>
    </section>

    <section className="panel">
      <SectionHeader
        label="This week"
        title="A suggested order, weakest section first"
        description="A day is marked done when you have a scored attempt in that section on that date."
      />
      <ol className="plan-week">
        {week.map(day => (
          <li key={day.date} className={`plan-day is-${day.status}`} data-section={day.section || "mock"}>
            <span className="plan-day__weekday">{day.weekday}</span>
            <span className="plan-day__focus">{day.isMockDay ? "Mock test" : titleCase(day.section)}</span>
            <span className="plan-day__status">
              {day.status === "done" ? `${day.attempts} done`
                : day.status === "today" ? "Today"
                : day.status === "missed" ? "Missed"
                : "Upcoming"}
            </span>
            {!day.isMockDay && day.status !== "done" && (
              <button type="button" className="plan-day__go" onClick={() => navigate(`/${day.section}`)}>
                Practise
              </button>
            )}
            {day.isMockDay && day.status !== "done" && (
              <button type="button" className="plan-day__go" onClick={() => navigate("/mock")}>
                Start
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>

    <div className="dashboard-split">
      <section className="panel">
        <SectionHeader label="Where you stand" title="Section profile"
          description={balance
            ? `${titleCase(balance.weakest.section)} is furthest behind, by ${balance.spread} points.`
            : "Practise more than one section to compare them."}/>
        <SkillSpectrum sections={sections} target={user?.targetScore}/>
      </section>

      <section className="panel">
        <SectionHeader label="Focus areas" title="Task types to work on"
          description="Scoring below your average, with enough attempts to be meaningful."/>
        <FocusAreas areas={areas} onPractice={(area) => navigate(`/${area.section}`)}/>
      </section>
    </div>
  </Page>;
}
