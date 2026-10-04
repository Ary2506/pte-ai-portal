import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Eye, X } from "lucide-react";
import { Badge, Empty, Page, Pager } from "../components/common.jsx";
import { Button, IconButton } from "../components/Button.jsx";
import { ObjectiveResult, Result } from "../PracticeObjective.jsx";
import { api } from "../api.js";
import { PRACTICE_SECTIONS, SECTION_LABELS } from "../practiceTaskRegistry.js";
import { EmptyState, Metric, MetricStrip, PerformanceTable, Delta, titleCase, taskLabel, formatDuration } from "../components/analytics.jsx";
import { formatRaw, pct } from "../analytics/derive.js";

function describeAnswer(r) {
  const opts = r.question?.options;
  if (Array.isArray(opts) && opts.length) {
    if (typeof r.answer === "number") return opts[r.answer] ?? String(r.answer);
    if (Array.isArray(r.answer))
      return r.answer.map((i) => opts[i] ?? i).join(", ");
  }
  if (typeof r.answer === "string" && r.answer) return r.answer;
  if (r.transcript) return r.transcript;
  return "—";
}

export function MockResultRow({ r }) {
  return (
    <div className="mock-result-row panel">
      <div className="task-meta">
        <span className="chip">{r.section}</span>
        <span>{r.question?.title || r.type}</span>
      </div>
      {r.question?.prompt && <p className="instruction">{r.question.prompt}</p>}
      {r.question?.passage && (
        <div className="passage">{r.question.passage}</div>
      )}
      <p className="muted">Your answer: {describeAnswer(r)}</p>
      {r.evaluationType === "objective" ? (
        <ObjectiveResult result={r} />
      ) : (
        <Result result={r} />
      )}
    </div>
  );
}

function MockAttemptDetail({ id, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    setError("");
    api.testSessions
      .details(id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const s = data?.testSession;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-panel detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Mock Test Details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Mock Test Details</h3>
          <IconButton label="Close" icon={<X/>} onClick={onClose}/>
        </div>
        {loading ? (
          <Empty text="Loading attempt..." />
        ) : !s ? (
          <div className="alert error">{error}</div>
        ) : (
          <>
            <div className="mock-detail-summary">
              <span className="score-pill">
                {formatRaw(s.totalScore, s.totalMaxScore)}
              </span>
              <span className="muted">
                {s.submittedAt
                  ? new Date(s.submittedAt).toLocaleString()
                  : "In progress"}
              </span>
            </div>
            <div className="mock-detail-list">
              {data.results.length ? (
                data.results.map((r) => <MockResultRow key={r._id} r={r} />)
              ) : (
                <p className="muted">
                  No answers were submitted in this attempt.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function fmtRelativeDateTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  const startOfDay = (x) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86400000,
  );
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return date.toLocaleString();
}

const HISTORY_SECTION_FILTERS = ["all", ...PRACTICE_SECTIONS];
const PRACTICE_PAGE_SIZE = 10;
const MOCK_PAGE_SIZE = 10;

function historyScoreCell(r) {
  if (r.evaluationStatus === "PENDING" || r.evaluationStatus === "PROCESSING")
    return <span className="muted">Evaluating…</span>;
  if (r.evaluationStatus === "FAILED") return <Badge tone="bad">Failed</Badge>;
  return (
    <span className="score-pill">
      {r.score}
      {r.maxScore ? `/${r.maxScore}` : ""}
    </span>
  );
}

export default function History() {
  const [rows, setRows] = useState([]);
  const [mocks, setMocks] = useState([]);
  const [mockPage, setMockPage] = useState(1);
  const [detailId, setDetailId] = useState(null);
  const [sectionFilter, setSectionFilter] = useState("all");
  // The section filter is applied by the server, not by filtering `rows` in place as it once
  // was. With a page of attempts rather than all of them, a client-side filter could only ever
  // search the page currently loaded — picking "Speaking" would hide every speaking attempt that
  // happened to sit on another page. Changing the filter therefore refetches from page 1, the
  // same way the admin user/question tables already re-query on a filter change.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(true);

  useEffect(() => {
    setRowsLoading(true);
    api
      // summary: this table renders type/section/evaluationType/score/date and nothing else —
      // the mock-attempt detail below fetches its own full rows from testSessions.details().
      .history({ summary: 1, page, limit: PRACTICE_PAGE_SIZE, section: sectionFilter === "all" ? undefined : sectionFilter })
      .then((d) => {
        setRows(d.submissions);
        setTotal(d.total ?? d.submissions.length);
        setTotalPages(d.totalPages || 1);
      })
      .catch(() => {})
      .finally(() => setRowsLoading(false));
  }, [page, sectionFilter]);

  const location = useLocation();
  useEffect(() => {
    if (location.hash !== "#practice-attempts") return;
    // After the first paint, so the heading exists to scroll to.
    const id = requestAnimationFrame(() => {
      document.getElementById("practice-attempts")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [location.hash]);

  useEffect(() => {
    api.testSessions
      .list()
      .then((d) => setMocks(d.testSessions))
      .catch(() => {});
  }, []);

  function selectSection(s) {
    if (s === sectionFilter) return;
    // Back to page 1: staying on, say, page 4 while switching to a section that only has one
    // page would land the student on an empty table.
    setPage(1);
    setSectionFilter(s);
  }
  // Mock record. Percentages, so attempts of different lengths compare with one another, and
  // null rather than 0 wherever there is nothing completed yet to measure.
  const completedMocks = mocks.filter((m) => m.totalMaxScore);
  // Clamped like every other percentage in the product — see pct() in analytics/derive.js for
  // why a stored row can still be above its own maximum.
  const mockPercents = completedMocks.map((m) =>
    Math.min(100, Math.max(0, Math.round((m.totalScore / m.totalMaxScore) * 100))));
  const mockBest = mockPercents.length ? Math.max(...mockPercents) : null;
  // `mocks` arrives newest-first from the server, so the first entry is the latest attempt.
  const mockLatest = mockPercents.length ? mockPercents[0] : null;
  const mockAverage = mockPercents.length
    ? Math.round(mockPercents.reduce((a, n) => a + n, 0) / mockPercents.length)
    : null;

  // The mock table pages client side: its rows all arrive in one response, so Next is a slice
  // rather than a fetch. Guarded against landing past the end if the list shrinks.
  const mockTotalPages = Math.max(1, Math.ceil(mocks.length / MOCK_PAGE_SIZE));
  const safeMockPage = Math.min(mockPage, mockTotalPages);
  const visibleMocks = mocks.slice((safeMockPage - 1) * MOCK_PAGE_SIZE, safeMockPage * MOCK_PAGE_SIZE);

  // Change against the previous attempt at the SAME task type. The table is paginated server
  // side, so an attempt whose predecessor sits on another page has no comparison available here —
  // that is reported as a dash rather than silently compared against an unrelated task.
  const withChange = (() => {
    const oldestFirst = [...rows].reverse();
    const lastByType = new Map();
    const changes = new Map();
    for (const row of oldestFirst) {
      const value = pct(row);
      const previous = lastByType.get(row.type);
      changes.set(row._id, value !== null && previous !== undefined ? value - previous : null);
      if (value !== null) lastByType.set(row.type, value);
    }
    return rows.map((r) => ({ ...r, id: r._id, change: changes.get(r._id) ?? null }));
  })();

  return (
    <Page
      title="Practice History"
      subtitle="Review your recent attempts and scores."
    >
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Mock test attempts
      </h2>
      <MetricStrip>
        <Metric label="Completed" value={completedMocks.length || null} />
        <Metric label="Best" value={mockBest} unit={mockBest === null ? "" : "%"} />
        <Metric label="Latest" value={mockLatest} unit={mockLatest === null ? "" : "%"} />
        <Metric label="Average" value={mockAverage} unit={mockAverage === null ? "" : "%"}
          hint={mockPercents.length ? `Across ${mockPercents.length} attempts` : "No completed mocks yet"} />
      </MetricStrip>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Total</th>
              <th>Speaking</th>
              <th>Writing</th>
              <th>Reading</th>
              <th>Listening</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleMocks.map((m) => (
              <tr key={m._id}>
                <td>{fmtRelativeDateTime(m.submittedAt)}</td>
                <td>
                  <span className="score-pill">
                    {formatRaw(m.totalScore, m.totalMaxScore)}
                  </span>
                </td>
                {["speaking", "writing", "reading", "listening"].map((sec) => {
                  const s = (m.sectionScores || []).find(
                    (x) => x.section === sec,
                  );
                  return (
                    <td key={sec}>{s ? `${s.score}/${s.maxScore}` : "—"}</td>
                  );
                })}
                <td>
                  <Button variant="ghost" size="sm" icon={<Eye/>} onClick={() => setDetailId(m._id)}>
                    View Details
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!mocks.length && <Empty text="No completed mock tests yet." />}
      </div>
      <Pager
        page={safeMockPage}
        totalPages={mockTotalPages}
        total={mocks.length}
        itemLabel={mocks.length === 1 ? "attempt" : "attempts"}
        onPrevious={() => setMockPage(safeMockPage - 1)}
        onNext={() => setMockPage(safeMockPage + 1)}
      />
      <div className="panel-head" style={{ marginTop: 30, marginBottom: 0 }}>
        <h2 className="section-title" id="practice-attempts" style={{ margin: 0 }}>
          Practice attempts
        </h2>
        <div
          className="question-list-filters"
          role="tablist"
          aria-label="Filter by section"
        >
          {HISTORY_SECTION_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={sectionFilter === s}
              className={
                sectionFilter === s
                  ? "question-list-filter active"
                  : "question-list-filter"
              }
              onClick={() => selectSection(s)}
              style={{ textTransform: "capitalize" }}
            >
              {s === "all" ? "All" : SECTION_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <PerformanceTable
          columns={[
            { key: "date", label: "Date", render: (r) => fmtRelativeDateTime(r.createdAt) },
            { key: "section", label: "Section", render: (r) => titleCase(r.section) },
            { key: "task", label: "Task", render: (r) => <b>{r.question?.title || taskLabel(r.type)}</b> },
            {
              key: "evaluation", label: "Evaluation",
              render: (r) => r.evaluationType === "subjective"
                ? <Badge tone="info">AI Evaluation</Badge>
                : <Badge tone="neutral">Objective</Badge>
            },
            { key: "score", label: "Score", align: "right", render: (r) => historyScoreCell(r) },
            {
              key: "change", label: "Change", align: "right",
              render: (r) => r.change === null
                ? <span className="muted" title="No earlier attempt at this task on this page">—</span>
                : <Delta value={r.change} />
            },
            {
              key: "duration", label: "Duration", align: "right",
              render: (r) => formatDuration(r.durationSeconds) || <span className="muted">—</span>
            }
          ]}
          rows={withChange}
          empty={
            <EmptyState
              // The server filters now, so an empty page under a section filter means that
              // section genuinely has no attempts — not that a client-side filter hid them.
              title={sectionFilter !== "all" ? "No attempts in this section" : "No practice attempts yet"}
              body={sectionFilter !== "all"
                ? "Try another section, or clear the filter to see everything."
                : "Start a task from the sidebar and your attempts will be listed here."}
            />
          }
        />
      </div>
      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        itemLabel={total === 1 ? "attempt" : "attempts"}
        busy={rowsLoading}
        onPrevious={() => setPage(page - 1)}
        onNext={() => setPage(page + 1)}
      />
      {detailId && (
        <MockAttemptDetail id={detailId} onClose={() => setDetailId(null)} />
      )}
    </Page>
  );
}
