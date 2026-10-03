import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Page } from "../components/common.jsx";
import { Trajectory } from "../components/charts.jsx";
import {
  AnalyticsSkeleton, Delta, EmptyState, ErrorState, FocusAreas, Metric, MetricStrip,
  PerformanceTable, ScoreRing, SectionHeader, SkillSpectrum, StatLabel, formatDuration, taskLabel, titleCase
} from "../components/analytics.jsx";
import {
  bySection, byTaskType, changeOverDays, focusAreas, improvement, pct, scored,
  skillBalance, summarize, targetGap, trajectory, MIN_FOR_TREND
} from "../analytics/derive.js";

// Performance Intelligence — the product's analytical page.
//
// Every figure on it is computed from submissions the API already returns; nothing is requested
// from a new endpoint and nothing is invented. Where the data cannot support a statement the
// page says so rather than filling the space: a trend needs MIN_FOR_TREND attempts, a task-type
// average needs enough attempts to be worth ranking, and a window comparison needs attempts on
// both sides of the window.

const PAGE_SIZE = 100;

export default function Progress({ user }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sectionFilter, setSectionFilter] = useState("all");
  const navigate = useNavigate();

  function load() {
    setLoading(true);
    setError("");
    // The largest page the endpoint allows. Everything below is derived from exactly these rows,
    // so the figures describe a stated window rather than implying the student's whole history.
    api.history({ limit: PAGE_SIZE, page: 1 })
      .then(data => setRows(data.submissions || []))
      .catch(e => setError(e.message || "Could not load your practice history."))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const visible = useMemo(
    () => (sectionFilter === "all" ? rows || [] : (rows || []).filter(r => r.section === sectionFilter)),
    [rows, sectionFilter]);

  const stats = useMemo(() => summarize(visible), [visible]);
  const series = useMemo(() => trajectory(visible), [visible]);
  const trend = useMemo(() => improvement(visible), [visible]);
  const week = useMemo(() => changeOverDays(visible, 7), [visible]);
  const month = useMemo(() => changeOverDays(visible, 30), [visible]);
  const sections = useMemo(() => bySection(rows || []), [rows]);
  const balance = useMemo(() => skillBalance(rows || []), [rows]);
  const tasks = useMemo(() => byTaskType(visible), [visible]);
  const areas = useMemo(() => focusAreas(visible), [visible]);
  const gap = useMemo(() => targetGap(stats.average, user?.targetScore), [stats.average, user?.targetScore]);

  if (error) {
    return <Page title="Performance intelligence" subtitle="Everything below is computed from your own attempts.">
      <ErrorState title="Could not load your performance data" body={error} onRetry={load}/>
    </Page>;
  }

  if (loading) {
    return <Page title="Performance intelligence" subtitle="Everything below is computed from your own attempts.">
      <AnalyticsSkeleton rows={6}/>
    </Page>;
  }

  if (!scored(rows).length) {
    return <Page title="Performance intelligence" subtitle="Everything below is computed from your own attempts.">
      <EmptyState
        title="No scored attempts yet"
        body="Complete some practice questions and this page fills with your score trajectory, section profile and the task types worth working on."
        action={<button type="button" className="primary" onClick={() => navigate("/practice")}>Start practising</button>}
      />
    </Page>;
  }

  return <Page
    title="Performance intelligence"
    subtitle={`Derived from your last ${scored(rows).length} scored practice attempts.`}
    actions={
      <div className="filter-group" role="group" aria-label="Filter by section">
        {["all", "speaking", "writing", "reading", "listening"].map(value => (
          <button key={value} type="button"
            className={sectionFilter === value ? "filter-chip is-active" : "filter-chip"}
            aria-pressed={sectionFilter === value}
            onClick={() => setSectionFilter(value)}>
            {value === "all" ? "All sections" : titleCase(value)}
          </button>
        ))}
      </div>
    }
  >
    {/* --- Where am I, and how far from target ------------------------------------------- */}
    <section className="intel-hero">
      <ScoreRing value={stats.average} max={100} size={184} caption="Practice average"/>
      <div className="intel-hero__body">
        {gap
          ? <p className="intel-hero__headline">
              You are averaging <b className="num-mono">{gap.current}</b> against a target of{" "}
              <b className="num-mono">{gap.target}</b> —{" "}
              {gap.met
                ? <span className="is-good">{gap.gap} point{gap.gap === 1 ? "" : "s"} above it.</span>
                : <span className="is-behind">{Math.abs(gap.gap)} point{Math.abs(gap.gap) === 1 ? "" : "s"} to go.</span>}
            </p>
          : <p className="intel-hero__headline">Set a target score on your profile to track the gap.</p>}
        <MetricStrip>
          <Metric label="Best score" value={stats.best} />
          <Metric label="Attempts" value={stats.attempts} />
          <Metric label="Time measured" value={formatDuration(stats.totalSeconds)}
            hint={stats.timedAttempts ? `${stats.timedAttempts} of ${stats.attempts} attempts are timed` : "No timed attempts yet"} />
          <Metric label="Overall change" value={trend ? `${trend.delta > 0 ? "+" : ""}${trend.delta}` : null}
            hint={trend ? `First third vs last third of ${trend.points} attempts` : `Needs ${MIN_FOR_TREND} attempts`} />
        </MetricStrip>
      </div>
    </section>

    {/* --- Am I improving ----------------------------------------------------------------- */}
    <section className="panel">
      <SectionHeader label="Score trajectory" title="Every scored attempt, oldest first"
        description={series
          ? "Each point is one attempt, scored as a percentage of its own maximum."
          : `A trend needs at least ${MIN_FOR_TREND} scored attempts.`}
        actions={<div className="trend-windows">
          <span><StatLabel>7 days</StatLabel><Delta value={week?.delta ?? null}/></span>
          <span><StatLabel>30 days</StatLabel><Delta value={month?.delta ?? null}/></span>
        </div>}
      />
      {series
        ? <div className="intel-chart">
            <Trajectory points={series} width={820} height={200}/>
            <div className="intel-chart__legend">
              <span><StatLabel>Average</StatLabel><b className="num-mono">{stats.average}</b></span>
              <span><StatLabel>Best</StatLabel><b className="num-mono">{stats.best}</b></span>
              {gap && <span><StatLabel>Target</StatLabel><b className="num-mono">{gap.target}</b></span>}
            </div>
          </div>
        : <EmptyState title="Not enough attempts to chart a trend"
            body={`Once you have ${MIN_FOR_TREND} scored attempts, your trajectory appears here.`}/>}
    </section>

    {/* --- Which skill is weak ------------------------------------------------------------ */}
    <div className="intel-split">
      <section className="panel">
        <SectionHeader label="Skill profile" title="Section comparison"
          description={balance
            ? `${titleCase(balance.strongest.section)} leads ${titleCase(balance.weakest.section)} by ${balance.spread} points.`
            : "Attempt questions in more than one section to compare them."}/>
        <SkillSpectrum sections={sections} target={user?.targetScore}/>
      </section>

      <section className="panel">
        <SectionHeader label="Focus areas" title="What to practise next"
          description="Task types scoring below your average, with enough attempts to be meaningful."/>
        <FocusAreas areas={areas} onPractice={(area) => navigate(`/${area.section}`)}/>
      </section>
    </div>

    {/* --- Task-type detail ---------------------------------------------------------------- */}
    <section className="panel">
      <SectionHeader label="Task type analysis" title="Performance by task"
        description="Weakest first. A task type needs several attempts before its average is treated as reliable."/>
      <PerformanceTable
        columns={[
          { key: "type", label: "Task type", render: r => taskLabel(r.type) },
          { key: "section", label: "Section", render: r => titleCase(r.section) },
          { key: "attempts", label: "Attempts", align: "right" },
          { key: "average", label: "Average", align: "right", render: r => <b className="num-mono">{r.average}</b> },
          { key: "best", label: "Best", align: "right", render: r => <span className="num-mono">{r.best}</span> },
          {
            key: "reliable", label: "Confidence",
            render: r => r.reliable
              ? <span className="muted">Reliable</span>
              : <span className="muted" title="Too few attempts to rank on">Low sample</span>
          }
        ]}
        rows={tasks.map(t => ({ ...t, id: t.type }))}
        empty={<EmptyState title="No task data yet" body="Your task-type breakdown appears once you have scored attempts."/>}
      />
    </section>

    {/* --- What did I do recently ---------------------------------------------------------- */}
    <section className="panel">
      <SectionHeader label="Recent performance" title="Latest attempts"/>
      <PerformanceTable
        columns={[
          { key: "when", label: "Date", render: r => new Date(r.createdAt).toLocaleDateString() },
          { key: "section", label: "Section", render: r => titleCase(r.section) },
          { key: "task", label: "Task", render: r => r.question?.title || taskLabel(r.type) },
          { key: "score", label: "Score", align: "right", render: r => <b className="num-mono">{pct(r)}</b> },
          { key: "raw", label: "Raw", align: "right", render: r => <span className="num-mono muted">{r.score}/{r.maxScore}</span> },
          { key: "duration", label: "Duration", align: "right", render: r => formatDuration(r.durationSeconds) || <span className="muted">—</span> }
        ]}
        rows={scored(visible).slice(0, 12).map(r => ({ ...r, id: r._id }))}
        onRowClick={() => navigate("/history")}
        empty={<EmptyState title="No attempts in this filter"/>}
      />
    </section>
  </Page>;
}
