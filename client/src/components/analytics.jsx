import React from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "./Button.jsx";
import { formatDuration, titleCase } from "../analytics/derive.js";
import { PRACTICE_SECTIONS, PRACTICE_TASKS } from "../practiceTaskRegistry.js";

// slug -> display name, built once from the registry that already owns every task's real name.
// Without it a raw type like "mcq-single" title-cases to "Mcq Single", which reads worse than
// the slug it replaced.
const TASK_LABELS = new Map(
  PRACTICE_SECTIONS.flatMap(section => PRACTICE_TASKS[section].map(task => [task.slug, task.label])));

/** The human name for a task type, falling back to title case for anything not in the registry. */
export function taskLabel(type) {
  return TASK_LABELS.get(type) || titleCase(type);
}

// The analytics vocabulary shared by every page in the product. These exist so that a score, a
// trend or a gap is rendered the same way wherever it appears — the thing that makes a set of
// pages read as one product rather than several.
//
// House rule, enforced by every component below: a value of `null` or `undefined` means "not
// enough data to say" and renders a dash or an empty state. None of these ever substitutes a
// zero for a number it does not have.

/** Uppercase mono annotation — the product's single labelling system. */
export function StatLabel({ children, as: Tag = "span" }) {
  return <Tag className="stat-label">{children}</Tag>;
}

export function SectionHeader({ label, title, description, actions }) {
  return <header className="section-header">
    <div>
      {label && <StatLabel>{label}</StatLabel>}
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
    </div>
    {actions && <div className="section-header-actions">{actions}</div>}
  </header>;
}

/** A metric with no value yet. Rendered as an em dash so the row keeps its shape. */
function NoValue({ hint }) {
  return <span className="metric-empty" title={hint || "Not enough data yet"}>—</span>;
}

/**
 * A single figure with its label. `value` of null renders a dash, never 0 — the difference
 * between "you scored nothing" and "you have not been measured" matters to a student.
 */
export function Metric({ label, value, unit, hint, tone }) {
  return <div className={tone ? `metric metric--${tone}` : "metric"}>
    <StatLabel>{label}</StatLabel>
    <div className="metric-value">
      {value === null || value === undefined
        ? <NoValue hint={hint}/>
        : <><strong className="num-mono">{value}</strong>{unit && <span className="metric-unit">{unit}</span>}</>}
    </div>
    {hint && value !== null && value !== undefined && <p className="metric-hint">{hint}</p>}
  </div>;
}

/** A row of metrics on one rule — used instead of a row of cards. */
export function MetricStrip({ children }) {
  return <div className="metric-strip">{children}</div>;
}

/**
 * A signed change. Direction is carried by the arrow and the sign as well as by colour, so it
 * survives a colour-blind reader and a greyscale print.
 */
export function Delta({ value, suffix = "", label }) {
  if (value === null || value === undefined) return <NoValue hint="No comparison available yet"/>;
  const rounded = Math.round(value);
  const dir = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight;
  return <span className={`delta delta--${dir}`}>
    <Icon size={14}/>
    <span className="num-mono">{rounded > 0 ? "+" : ""}{rounded}{suffix}</span>
    {label && <span className="delta-label">{label}</span>}
  </span>;
}

/**
 * A radial score readout. The arc is drawn with stroke-dasharray on a circle, so there is no
 * chart dependency and it scales to any size.
 */
export function ScoreRing({ value, max = 100, size = 168, label, caption }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const has = value !== null && value !== undefined && Number.isFinite(Number(value));
  // The arc was already clamped; the PRINTED number was not, so a value above its maximum drew a
  // full ring beside the text "100 / 90". Both now read from the same clamped figure.
  const shown = has ? Math.max(0, Math.min(Number(max), Number(value))) : null;
  const ratio = has ? shown / max : 0;

  return <figure className="score-ring" style={{ width: size, height: size }}>
    <svg viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={has ? `${label || "Score"}: ${shown} out of ${max}` : `${label || "Score"}: not enough data yet`}>
      <circle className="score-ring__track" cx={size / 2} cy={size / 2} r={radius} fill="none"/>
      {has && <circle className="score-ring__arc" cx={size / 2} cy={size / 2} r={radius} fill="none"
        strokeDasharray={`${circumference * ratio} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}/>}
    </svg>
    <figcaption className="score-ring__body">
      {has
        ? <><strong className="num-mono">{Math.round(shown)}</strong><span className="score-ring__max num-mono">/{max}</span></>
        : <span className="score-ring__empty">—</span>}
      {(label || caption) && <span className="score-ring__label">{caption || label}</span>}
    </figcaption>
  </figure>;
}

/**
 * Horizontal skill spectrum — the alternative to a radar chart, and easier to read precisely.
 * Each row is a section with its average, plotted on a shared scale with the target marked.
 */
export function SkillSpectrum({ sections, target }) {
  const withData = (sections || []).filter(s => s.average !== null);
  if (!withData.length) {
    return <EmptyState title="No section data yet"
      body="Complete a few questions in any section and your skill profile appears here."/>;
  }
  const best = Math.max(...withData.map(s => s.average));
  const worst = Math.min(...withData.map(s => s.average));

  return <div className="skill-spectrum">
    {(sections || []).map(row => {
      const has = row.average !== null;
      const flag = has && withData.length > 1
        ? (row.average === best ? "strongest" : row.average === worst ? "weakest" : null)
        : null;
      return <div className="skill-row" key={row.section} data-section={row.section}>
        <span className="skill-row__name">{titleCase(row.section)}</span>
        <span className="skill-row__track">
          {has && <span className="skill-row__fill" style={{ width: `${Math.min(100, row.average)}%` }}/>}
          {Number.isFinite(Number(target)) &&
            <span className="skill-row__goal" style={{ left: `${Math.min(100, Number(target))}%` }} aria-hidden="true"/>}
        </span>
        <span className="skill-row__value num-mono">{has ? Math.min(100, Math.max(0, row.average)) : "—"}</span>
        <span className="skill-row__meta">
          {has ? `${row.attempts} attempt${row.attempts === 1 ? "" : "s"}` : "Not started"}
          {flag && <em className={`skill-flag skill-flag--${flag}`}>{flag}</em>}
        </span>
      </div>;
    })}
  </div>;
}

/**
 * Ranked focus areas. The caller passes rows already derived from real attempts; this only
 * renders them, including the gap that justifies each one — so the student can check the
 * reasoning rather than being told to trust it.
 */
export function FocusAreas({ areas, onPractice }) {
  if (!areas?.length) {
    return <EmptyState title="Not enough data to pick a focus yet"
      body="Once you have a few attempts across several task types, the weakest ones are listed here with the gap that identifies them."/>;
  }
  return <ol className="focus-list">
    {areas.map((area, i) => <li className="focus-item" key={area.type}>
      <span className="focus-item__index num-mono">{String(i + 1).padStart(2, "0")}</span>
      <div className="focus-item__body">
        <h4>{taskLabel(area.type)}</h4>
        <p className="muted">
          Averaging <b className="num-mono">{area.average}</b> over {area.attempts} attempts —{" "}
          <b className="num-mono">{Math.round(area.gap)}</b> below your {titleCase(area.section)} average
          of <b className="num-mono">{Math.round(area.comparedWith)}</b>.
        </p>
      </div>
      {onPractice && <Button variant="secondary" size="sm" className="focus-item__cta"
        icon={<ArrowRight/>} iconPosition="right" onClick={() => onPractice(area)}>Practice</Button>}
    </li>)}
  </ol>;
}

/**
 * A performance table. Rows, not cards: a student comparing attempts needs columns that line up.
 * Becomes horizontally scrollable rather than reflowing into unreadable stacks on narrow screens.
 */
export function PerformanceTable({ columns, rows, empty, onRowClick }) {
  if (!rows?.length) return empty || <EmptyState title="Nothing here yet"/>;
  return <div className="perf-table-wrap">
    <table className="perf-table">
      <thead>
        <tr>{columns.map(c => <th key={c.key} className={c.align === "right" ? "is-right" : undefined}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, i) => <tr key={row.id || i}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={onRowClick ? "is-clickable" : undefined}>
          {columns.map(c => <td key={c.key} className={c.align === "right" ? "is-right" : undefined}>
            {c.render ? c.render(row) : (row[c.key] ?? <NoValue/>)}
          </td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

/** The product's empty state. Always says what would fill it, never just "no data". */
export function EmptyState({ title, body, action }) {
  return <div className="empty-state">
    <h4>{title}</h4>
    {body && <p>{body}</p>}
    {action}
  </div>;
}

/** Skeleton rows for a loading panel — shaped like the content, not a spinner. */
export function AnalyticsSkeleton({ rows = 3 }) {
  return <div className="analytics-skeleton" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => <span key={i} className="analytics-skeleton__row"/>)}
  </div>;
}

/** A professional error state: what happened, and a way forward. */
export function ErrorState({ title = "Something went wrong", body, onRetry, retryLabel = "Retry" }) {
  return <div className="error-state" role="alert">
    <h4>{title}</h4>
    {body && <p>{body}</p>}
    {onRetry && <Button variant="secondary" icon={<RefreshCw/>} onClick={onRetry}>{retryLabel}</Button>}
  </div>;
}

export { formatDuration, titleCase };
