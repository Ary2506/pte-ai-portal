import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Page } from "../components/common.jsx";
import { Button, ButtonLink } from "../components/Button.jsx";
import {
  AnalyticsSkeleton, EmptyState, FocusAreas, Metric, MetricStrip,
  ScoreRing, SectionHeader, SkillSpectrum, titleCase
} from "../components/analytics.jsx";
import { bySection, focusAreas, pct, ptePerformance, scored, skillBalance, summarize, targetGap, PTE_MAX_SCORE } from "../analytics/derive.js";

// Target Score Plan.
//
// The plan is a recommendation computed from the student's own attempts, not a template: the
// week is ordered by which sections they are actually weakest in, and a day counts as done when
// there is a scored attempt in that section on that date. Nothing here is a canned task list —
// the previous version fell back to four hardcoded strings whenever the API was slow, which told
// every student the same thing regardless of how they were doing.

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toKey = (d) => d.toISOString().slice(0, 10);

/**
 * The seven dates of the CALENDAR week containing `today`, Monday first.
 *
 * This replaced a rolling "last seven days" window, which had three problems: the plan never
 * reset, the weekday labels appeared in whatever order the window happened to land in (THU, FRI,
 * SAT, SUN…), and a given weekday was assigned a different section each day as the window slid.
 * Anchoring to the calendar week means the plan is stable all week and starts fresh on Monday.
 */
export function weekDates(today = new Date()) {
  const monday = new Date(`${toKey(today)}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return toKey(d);
  });
}

/**
 * Assigns a focus to each day of the week.
 *
 * Mon-Fri rotate through the student's sections weakest-first, so the skill furthest behind gets
 * the most attention. Saturday is a full mock, which is the one thing practice alone does not
 * rehearse. Sunday is review — any practice counts.
 *
 * A suggestion derived from real section averages, stated as such on the page — not a schedule
 * the product pretends to have authored for this student personally.
 */
export function buildWeek(sections, history, mockSessions = [], today = new Date()) {
  const ranked = sections
    .filter(s => s.average !== null)
    .sort((a, b) => a.average - b.average)
    .map(s => s.section);
  // Nothing attempted yet: suggest each section once so the week is still a usable starting point.
  const order = ranked.length ? ranked : ["speaking", "writing", "reading", "listening"];

  const attempts = scored(history);
  const mockDates = new Set(
    (mockSessions || []).filter(m => m.submittedAt).map(m => m.submittedAt.slice(0, 10)));
  const todayKey = toKey(today);

  return weekDates(today).map((date, i) => {
    const kind = i === 5 ? "mock" : i === 6 ? "review" : "section";
    const section = kind === "section" ? order[i % order.length] : null;

    // Each kind of day is "done" for its own reason. The mock day previously counted ordinary
    // practice attempts, so nineteen reading questions marked the mock as complete.
    const onThisDate = attempts.filter(r => r.createdAt?.slice(0, 10) === date);
    const count = kind === "mock"
      ? (mockDates.has(date) ? 1 : 0)
      : kind === "review"
        ? onThisDate.length
        : onThisDate.filter(r => r.section === section).length;

    const isToday = date === todayKey;
    const isPast = date < todayKey;

    return {
      date,
      weekday: DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()],
      section,
      kind,
      isMockDay: kind === "mock",
      attempts: count,
      status: count ? "done" : isPast ? "missed" : isToday ? "today" : "upcoming"
    };
  });
}

export default function StudyPlan({ user }) {
  const [history, setHistory] = useState([]);
  const [mockSessions, setMockSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    const safely = (run) => Promise.resolve().then(run).catch(() => null);
    Promise.all([
      safely(() => api.history({ limit: 100, page: 1 })),
      safely(() => api.testSessions.list())
    ]).then(([hist, mocks]) => {
      if (!live) return;
      setHistory(hist?.submissions || []);
      setMockSessions(mocks?.testSessions || []);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const stats = useMemo(() => summarize(history), [history]);
  const sections = useMemo(() => bySection(history), [history]);
  const balance = useMemo(() => skillBalance(history), [history]);
  const areas = useMemo(() => focusAreas(history, { limit: 3 }), [history]);
  const pte = useMemo(() => ptePerformance(history), [history]);
  const gap = useMemo(() => targetGap(pte.average, user?.targetScore), [pte.average, user?.targetScore]);
  const week = useMemo(() => buildWeek(sections, history, mockSessions), [sections, history, mockSessions]);

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
        action={<Button variant="primary" onClick={() => navigate("/practice")}>Start practising</Button>}
      />
    </Page>;
  }

  return <Page
    title="Study plan"
    subtitle={
      gap
        ? gap.met
          ? `Your AI-scored average is ${gap.gap} point${gap.gap === 1 ? "" : "s"} above your target of ${gap.target}. Keep it there.`
          : `${Math.abs(gap.gap)} point${Math.abs(gap.gap) === 1 ? "" : "s"} from your target of ${gap.target}, on AI-scored tasks.`
        : `Complete ${pte.needed} AI-scored speaking or writing tasks to track progress against your target.`
    }
    actions={<ButtonLink variant="primary" to="/practice">Open practice library</ButtonLink>}
  >
    <div className="page-stack">
      <section className="command-hero">
        <ScoreRing value={pte.average} max={PTE_MAX_SCORE} size={164} caption="AI-scored average"/>
        <div className="command-hero__metrics">
          <MetricStrip>
            <Metric label="Target" value={user?.targetScore ?? null} hint="Set on your profile"/>
            <Metric label="Gap" value={gap ? (gap.gap > 0 ? `+${gap.gap}` : gap.gap) : null}
              hint={gap?.met ? "Above target" : "Below target"}/>
            <Metric label="Best AI score" value={pte.best}/>
            <Metric label="Practice accuracy" value={stats.average === null ? null : `${stats.average}%`}/>
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
            <li key={day.date} className={`plan-day is-${day.status}`} data-section={day.section || day.kind}>
              <span className="plan-day__weekday">{day.weekday}</span>
              <span className="plan-day__focus">{day.kind === "mock" ? "Mock test" : day.kind === "review" ? "Review" : titleCase(day.section)}</span>
              <span className="plan-day__status">
                {day.status === "done" ? (day.kind === "mock" ? "Completed" : `${day.attempts} done`)
                  : day.status === "today" ? "Today"
                  : day.status === "missed" ? "Missed"
                  : "Upcoming"}
              </span>
              {!day.isMockDay && day.status !== "done" && (
                <Button variant="tertiary" size="sm" className="plan-day__go" onClick={() => navigate(`/${day.section}`)}>
                  Practise
                </Button>
              )}
              {day.isMockDay && day.status !== "done" && (
                <Button variant="tertiary" size="sm" className="plan-day__go" onClick={() => navigate("/mock")}>
                  Start
                </Button>
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
    </div>
  </Page>;
}
