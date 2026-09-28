import React, { useEffect, useState } from "react";
import { Badge, Empty, Page } from "../components/common.jsx";
import { ObjectiveResult, Result } from "../PracticeObjective.jsx";
import { api } from "../api.js";
import { PRACTICE_SECTIONS, SECTION_LABELS } from "../practiceTaskRegistry.js";

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
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {loading ? (
          <Empty text="Loading attempt..." />
        ) : !s ? (
          <div className="alert error">{error}</div>
        ) : (
          <>
            <div className="mock-detail-summary">
              <span className="score-pill">
                {s.totalScore}/{s.totalMaxScore}
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
  return (
    <Page
      title="Practice History"
      subtitle="Review your recent attempts and scores."
    >
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Mock test attempts
      </h2>
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
            {mocks.map((m) => (
              <tr key={m._id}>
                <td>{fmtRelativeDateTime(m.submittedAt)}</td>
                <td>
                  <span className="score-pill">
                    {m.totalScore}/{m.totalMaxScore}
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
                  <button
                    className="text-button"
                    onClick={() => setDetailId(m._id)}
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!mocks.length && <Empty text="No completed mock tests yet." />}
      </div>
      <div className="panel-head" style={{ marginTop: 30, marginBottom: 0 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
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
      <div className="panel table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Section</th>
              <th>Evaluation</th>
              <th>Score</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id}>
                <td>
                  <b>{r.type}</b>
                </td>
                <td style={{ textTransform: "capitalize" }}>{r.section}</td>
                <td>
                  {r.evaluationType === "subjective" ? (
                    <Badge tone="info">AI Evaluation</Badge>
                  ) : (
                    <Badge tone="neutral">Objective</Badge>
                  )}
                </td>
                <td>{historyScoreCell(r)}</td>
                <td>{fmtRelativeDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !rowsLoading && (
          <Empty
            text={
              // The server filters now, so an empty page under a section filter means that
              // section genuinely has no attempts — not that a client-side filter hid them.
              sectionFilter !== "all"
                ? "No practice attempts match this filter."
                : "No practice submissions yet. Start a task from the sidebar."
            }
          />
        )}
      </div>
      {totalPages > 1 && (
        <div className="pager">
          <button
            className="secondary"
            disabled={page <= 1 || rowsLoading}
            onClick={() => setPage(page - 1)}
          >
            ‹ Previous
          </button>
          <span className="muted">
            Page {page} of {totalPages} · {total} attempt{total === 1 ? "" : "s"}
          </span>
          <button
            className="secondary"
            disabled={page >= totalPages || rowsLoading}
            onClick={() => setPage(page + 1)}
          >
            Next ›
          </button>
        </div>
      )}
      {detailId && (
        <MockAttemptDetail id={detailId} onClose={() => setDetailId(null)} />
      )}
    </Page>
  );
}
