import React, { useEffect, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, Headphones, Mic, PenLine } from "lucide-react";
import { Badge, Pager } from "../components/common.jsx";

// Its own module rather than living in Practice.jsx, its main consumer: ReadAloudPractice shows
// this same list, and Practice.jsx imports ReadAloudPractice — so keeping it there made the two
// files import each other in a cycle that only happened to work because both are referenced
// inside render functions rather than at module scope.
const SECTION_ICONS = {
  speaking: Mic,
  writing: PenLine,
  reading: BookOpen,
  listening: Headphones,
};

const QUESTIONS_PER_PAGE = 10;

const PROGRESS_FILTERS = [
  { key: "all", label: "All" },
  { key: "undone", label: "Undone" },
  { key: "done", label: "Done" },
];

function matchesSearch(question, index, term) {
  if (!term) return true;
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return (
    question.title.toLowerCase().includes(needle) ||
    question._id.toLowerCase().includes(needle) ||
    String(index + 1) === needle
  );
}

// Takes only plain data — `questions` needing `_id` and `title`, and a `progress` Map keyed by
// those same ids — so it has no dependency on whether they came from the API or a bundled JSON.
export function QuestionListView({ questions, progress, onSelect, section, label }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const doneCount = questions.filter((question) =>
    progress.has(question._id),
  ).length;
  const undoneCount = questions.length - doneCount;
  const filterCounts = {
    all: questions.length,
    undone: undoneCount,
    done: doneCount,
  };
  const SectionIcon = SECTION_ICONS[section];
  // There is deliberately no per-type filter. Describe Image carries a `category` (Bar, Line,
  // Pie, Map, Flow, Picture, Table) and once had a "My Type" dropdown driven by it, but every
  // task type now presents one common list: the status tabs and the search box are the only ways
  // to narrow it, and they work the same way in every section. `category` is still stored, so a
  // filter can come back without re-authoring anything.
  const rows = questions
    .map((question, index) => ({ question, index }))
    .filter(
      ({ question }) =>
        filter === "all" || (filter === "done") === progress.has(question._id),
    )
    .filter(({ question, index }) => matchesSearch(question, index, search));

  // Paged over `rows` — the already-filtered list — rather than over the fetch. The status
  // tabs' counts and the search both read the complete question set; paging the fetch instead
  // would scope them to whichever ten
  // questions happened to be loaded, so searching would miss matches sitting on another page.
  // Each row keeps the `index` it had in the unfiltered list, so onSelect still opens the right
  // question regardless of which page it was clicked from.
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / QUESTIONS_PER_PAGE));
  // Any filter or search change re-forms the list under the current page number, which could
  // otherwise leave the student on a page that no longer exists.
  useEffect(() => { setPage(1); }, [filter, search]);
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * QUESTIONS_PER_PAGE, safePage * QUESTIONS_PER_PAGE);

  return (
    <div className="panel question-list-panel">
      {SectionIcon && (
        <div className="question-list-banner">
          <span className="question-list-banner-icon">
            <SectionIcon size={18} />
          </span>
          <h2>{label}</h2>
        </div>
      )}
      <div className="question-list-head">
        <div
          className="question-list-filters"
          role="tablist"
          aria-label="Filter by practice status"
        >
          {PROGRESS_FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              className={
                filter === item.key
                  ? "question-list-filter active"
                  : "question-list-filter"
              }
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span className="question-list-filter-count">
                {filterCounts[item.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="search question-list-search">
          <span aria-hidden="true">⌕</span>
          <input
            placeholder="Search by title or question number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search questions"
          />
        </div>
        <span className="muted">
          Done {doneCount}, Found {rows.length} question
          {rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="question-list">
        {pageRows.map(({ question, index }) => {
          const attempt = progress.get(question._id);
          return (
            <button
              key={question._id}
              type="button"
              className="question-list-row"
              onClick={() => onSelect(index)}
            >
              <span className="question-row-number">#{index + 1}</span>
              <span className="question-list-title">{question.title}</span>
              {attempt ? (
                <span className="question-row-status">
                  {attempt.evaluationStatus === "FAILED" ? (
                    <Badge tone="warn">Evaluation failed</Badge>
                  ) : (
                    <Badge tone="good">
                      <CheckCircle2 size={12} /> Done · {attempt.score}/
                      {attempt.maxScore}
                    </Badge>
                  )}
                </span>
              ) : (
                <Badge tone="neutral">Undone</Badge>
              )}
              <ChevronRight
                size={16}
                className="question-row-arrow"
                aria-hidden="true"
              />
            </button>
          );
        })}
        {!rows.length && (
          <p className="muted" style={{ padding: "14px 6px" }}>
            No questions match {search.trim() ? "your search" : "this filter"}.
          </p>
        )}
      </div>
      <Pager
        page={safePage}
        totalPages={totalPages}
        total={rows.length}
        itemLabel="questions"
        onPrevious={() => setPage(safePage - 1)}
        onNext={() => setPage(safePage + 1)}
      />
    </div>
  );
}
