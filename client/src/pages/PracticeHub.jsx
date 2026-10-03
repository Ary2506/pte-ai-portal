import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Headphones, Mic, PenLine, Search } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import {
  MORE_ITEMS,
  PRACTICE_SECTIONS,
  PRACTICE_TASKS,
  SECTION_LABELS,
} from "../practiceTaskRegistry.js";
import { Page } from "../components/common.jsx";
import { EmptyState, Metric, MetricStrip } from "../components/analytics.jsx";
import { pct, scored } from "../analytics/derive.js";

const SECTION_ICONS = {
  speaking: Mic,
  writing: PenLine,
  reading: BookOpen,
  listening: Headphones,
};
const SECTION_DESCRIPTIONS = {
  speaking:
    "Read aloud, describe images and answer spoken prompts with instant AI feedback.",
  writing:
    "Summarize text and write essays scored on structure, grammar and content.",
  reading:
    "Fill blanks, reorder paragraphs and answer questions with objective scoring.",
  listening:
    "Summarize, transcribe and answer questions from real audio passages.",
};

// Unchanged from the original: a startable task is a real <button>, an unavailable one is a
// <span> that cannot be clicked or focused, and the badge says which of the two reasons applies.
// The progress line below it is additive — the row's semantics and classes are what the practice
// hub's tests pin, and they were right the first time.
function PracticeTaskRow({ section, task, hasContent, onStart, progress }) {
  const startable = task.supported && hasContent;
  let badge = null;
  if (!task.supported)
    badge = <span className="practice-row-badge soon">Coming Soon</span>;
  else if (!hasContent)
    badge = <span className="practice-row-badge empty">No content yet</span>;
  else if (task.hasAI)
    badge = <span className="practice-row-badge ai">AI Score</span>;

  const content = (
    <>
      <span>{task.label}</span>
      {badge}
      {progress && (
        <span className="practice-row-stats">
          <span className={`practice-row-status is-${progress.status}`}>{progress.statusLabel}</span>
          {progress.attempts > 0 && (
            <>
              <span className="num-mono">{progress.attempts} attempt{progress.attempts === 1 ? "" : "s"}</span>
              {progress.average !== null && <span className="num-mono practice-row-avg">avg {progress.average}</span>}
            </>
          )}
        </span>
      )}
    </>
  );

  return startable ? (
    <button
      type="button"
      className="practice-row"
      onClick={() => onStart(section, task.slug)}
    >
      {content}
    </button>
  ) : (
    <span className="practice-row disabled" aria-disabled="true">
      {content}
    </span>
  );
}

/**
 * Per-task-type progress, built by matching attempts back to the questions that exist.
 *
 * "Completed" means every available question of that type has been attempted at least once —
 * computed from distinct question ids, not from attempt counts, so re-doing one question twenty
 * times never reads as finishing the type.
 */
function buildProgress(questionsBySection, history) {
  const map = new Map();
  const rows = scored(history);

  for (const [section, questions] of questionsBySection) {
    const byType = new Map();
    for (const q of questions) {
      if (!byType.has(q.type)) byType.set(q.type, new Set());
      byType.get(q.type).add(String(q._id));
    }
    for (const [type, ids] of byType) {
      const mine = rows.filter(r => r.section === section && r.type === type);
      const attemptedIds = new Set(
        mine.map(r => String(r.question?._id || r.question || r.localQuestionId || "")).filter(Boolean));
      const scores = mine.map(pct).filter(n => n !== null);
      const done = [...attemptedIds].filter(id => ids.has(id)).length;

      const status = mine.length === 0 ? "new" : done >= ids.size ? "done" : "progress";
      map.set(`${section}:${type}`, {
        available: ids.size,
        completed: done,
        attempts: mine.length,
        average: scores.length ? Math.round(scores.reduce((a, n) => a + n, 0) / scores.length) : null,
        best: scores.length ? Math.max(...scores) : null,
        status,
        statusLabel: status === "new" ? "Not started" : status === "done" ? "Completed" : "In progress",
      });
    }
  }
  return map;
}

export default function PracticeHub() {
  const navigate = useNavigate();
  const [available, setAvailable] = useState(null);
  const [questionsBySection, setQuestionsBySection] = useState([]);
  const [history, setHistory] = useState([]);
  const [term, setTerm] = useState("");
  const [sectionFilter, setSectionFilter] = useState("all");

  useEffect(() => {
    // Still exactly one request per section — the question bank is what decides availability.
    // History is fetched alongside it and only adds progress; if it fails, the hub still works.
    const safely = (run) => Promise.resolve().then(run).catch(() => null);
    Promise.all([
      Promise.all(
        PRACTICE_SECTIONS.map((section) =>
          api
            .questions(section)
            .then((data) => ({ section, questions: data.questions }))
            .catch(() => ({ section, questions: [] })),
        ),
      ),
      safely(() => api.history({ limit: 100, page: 1 })),
    ]).then(([results, hist]) => {
      const set = new Set();
      results.forEach(({ section, questions }) =>
        (questions || []).forEach((question) => set.add(`${section}:${question.type}`)),
      );
      setAvailable(set);
      setQuestionsBySection(results.map(r => [r.section, r.questions || []]));
      setHistory(hist?.submissions || []);
    });
  }, []);

  const progress = useMemo(
    () => buildProgress(questionsBySection, history), [questionsBySection, history]);

  // Library totals, all counted rather than asserted.
  const totals = useMemo(() => {
    const entries = [...progress.values()];
    const available = entries.reduce((a, e) => a + e.available, 0);
    const completed = entries.reduce((a, e) => a + e.completed, 0);
    const attempted = scored(history).length;
    const scores = scored(history).map(pct).filter(n => n !== null);
    return {
      available: available || null,
      completed,
      remaining: available ? available - completed : null,
      attempts: attempted || null,
      average: scores.length ? Math.round(scores.reduce((a, n) => a + n, 0) / scores.length) : null,
    };
  }, [progress, history]);

  function start(section, slug) {
    navigate(`/${section}?type=${slug}`);
  }

  const query = term.trim().toLowerCase();
  const visibleSections = PRACTICE_SECTIONS.filter(
    s => sectionFilter === "all" || s === sectionFilter);

  function tasksFor(section) {
    return PRACTICE_TASKS[section].filter(
      (task) => !query || task.label.toLowerCase().includes(query));
  }

  const anyVisible = visibleSections.some(s => tasksFor(s).length > 0);

  return (
    <Page
      title="PTE Practice"
      subtitle="Browse the library, pick a task type, and track what you have already covered."
    >
      <section className="library-summary">
        <MetricStrip>
          <Metric label="Questions available" value={totals.available} />
          <Metric label="Questions attempted" value={totals.completed || null}
            hint={totals.available ? `of ${totals.available} in the library` : undefined} />
          <Metric label="Remaining" value={totals.remaining} />
          <Metric label="Practice average" value={totals.average}
            hint={totals.attempts ? `Across ${totals.attempts} attempts` : "No scored attempts yet"} />
        </MetricStrip>
      </section>

      <div className="library-controls">
        <div className="library-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search task types..."
            aria-label="Search task types"
          />
        </div>
        <div className="filter-group" role="group" aria-label="Filter by section">
          {["all", ...PRACTICE_SECTIONS].map((value) => (
            <button key={value} type="button"
              className={sectionFilter === value ? "filter-chip is-active" : "filter-chip"}
              aria-pressed={sectionFilter === value}
              onClick={() => setSectionFilter(value)}>
              {value === "all" ? "All sections" : SECTION_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="panel practice-hub-panel">
        <div className="exam-variant-toggle" role="tablist">
          <span className="exam-variant-tab active" role="tab" aria-selected="true">
            PTE Core
          </span>
          <span
            className="exam-variant-tab"
            role="tab"
            aria-selected="false"
            title="This portal's practice library isn't split by exam variant yet — the same available questions are shown for both."
          >
            PTE Academic / UKVI
          </span>
        </div>

        {!anyVisible ? (
          <EmptyState
            title="No task types match these filters"
            body="Try a different section, or search for another task."
          />
        ) : (
          <div className="practice-columns">
            {visibleSections.map((section) => {
              const SectionIcon = SECTION_ICONS[section];
              const tasks = tasksFor(section);
              if (!tasks.length) return null;
              const allTasks = PRACTICE_TASKS[section];
              const readyCount = available
                ? allTasks.filter(
                    (task) => task.supported && available.has(`${section}:${task.slug}`),
                  ).length
                : null;

              return (
                <div className={`practice-column practice-${section}`} key={section}>
                  <div className="practice-column-header">
                    <div className="practice-column-icon">
                      <SectionIcon size={24} />
                    </div>
                    <div className="practice-column-heading">
                      <h3 className="practice-column-head">{SECTION_LABELS[section]}</h3>
                      <p className="practice-column-desc">{SECTION_DESCRIPTIONS[section]}</p>
                    </div>
                    <span className="practice-column-count">
                      {readyCount == null ? "…" : `${readyCount}/${allTasks.length} ready`}
                    </span>
                  </div>
                  <div className="practice-column-list">
                    {tasks.map((task) => (
                      <PracticeTaskRow
                        key={task.slug}
                        section={section}
                        task={task}
                        hasContent={available ? available.has(`${section}:${task.slug}`) : false}
                        onStart={start}
                        progress={progress.get(`${section}:${task.slug}`)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="practice-more-section">
          <h3 className="practice-column-head">More</h3>
          <div className="practice-more-row">
            {MORE_ITEMS.map((item) =>
              item.to ? (
                <NavLink key={item.key} to={item.to} className="practice-more-link">
                  {item.label}
                </NavLink>
              ) : (
                <span key={item.key} className="practice-more-link disabled" aria-disabled="true">
                  {item.label}
                </span>
              ),
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
