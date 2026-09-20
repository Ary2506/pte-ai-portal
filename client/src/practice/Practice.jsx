import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Headphones,
  Mic,
  PenLine,
} from "lucide-react";
import { api } from "../api.js";
import {
  PRACTICE_SECTIONS,
  SECTION_LABELS,
  supportedTasksFor,
} from "../practiceTaskRegistry.js";
import { Badge, Empty, SkeletonRows } from "../components/common.jsx";
import ReadAloudPractice from "./ReadAloudPractice.jsx";
import WriteEmailPdf from "./WriteEmailPdf.jsx";
import { LOCAL_LISTENING_QUESTIONS } from "./listeningData/index.js";
import { normalizeSubtype } from "./listeningData/shared.js";

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

const PROGRESS_FILTERS = [
  { key: "all", label: "All" },
  { key: "undone", label: "Undone" },
  { key: "done", label: "Done" },
];

function difficultyTone(difficulty) {
  return difficulty === "easy"
    ? "good"
    : difficulty === "hard"
      ? "bad"
      : "warn";
}

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

function QuestionListView({ questions, progress, onSelect, section, label }) {
  const [filter, setFilter] = useState("all");
  const [subtypeFilter, setSubtypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
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
  const subtypeOptions = [
    { key: "all", label: "All" },
    { key: "core", label: "Core" },
    { key: "corep", label: "Core P" },
  ].filter(option => option.key === "all" || questions.some(question => {
    const subtype = normalizeSubtype(question.subtype);
    return subtype.includes(option.key);
  }));
  // A separate, independently-gated "My Type" dropdown driven by `question.category` — currently
  // only Speaking > Describe Image populates this field (Bar/Flow/Line/Map/Pic/Pie/Table). Kept
  // deliberately distinct from the Core/Core P subtype filter above (which Listening's bundled
  // content uses) rather than reusing or altering it, so every other section is unaffected.
  const categoryValues = Array.from(new Set(questions.map(q => q.category).filter(Boolean))).sort();
  const hasCategoryFilter = categoryValues.length > 0;
  const rows = questions
    .map((question, index) => ({ question, index }))
    .filter(
      ({ question }) =>
        filter === "all" || (filter === "done") === progress.has(question._id),
    )
    .filter(({ question }) => {
      if (subtypeFilter === "all") return true;
      return normalizeSubtype(question.subtype).includes(subtypeFilter);
    })
    .filter(({ question }) => categoryFilter === "all" || question.category === categoryFilter)
    .filter(({ question, index }) => matchesSearch(question, index, search));

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
        {subtypeOptions.length > 1 && <div className="question-list-filters" role="tablist" aria-label="Filter by question type">
          {subtypeOptions.map(option => <button key={option.key} type="button" role="tab" aria-selected={subtypeFilter === option.key}
            className={subtypeFilter === option.key ? "question-list-filter active" : "question-list-filter"}
            onClick={() => setSubtypeFilter(option.key)}>{option.label}</button>)}
        </div>}
        {hasCategoryFilter && <div className="question-list-filters" role="group" aria-label="Filter by image type">
          <button type="button" className={categoryFilter === "all" ? "question-list-filter active" : "question-list-filter"}
            onClick={() => setCategoryFilter("all")}>All</button>
          <label className="question-list-category-select">
            My Type
            <select
              value={categoryFilter === "all" ? "" : categoryFilter}
              onChange={e => setCategoryFilter(e.target.value || "all")}
              aria-label="My Type"
            >
              <option value="" disabled>Choose a type</option>
              {categoryValues.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>}
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
        {rows.map(({ question, index }) => {
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
              {question.difficulty && (
                <Badge tone={difficultyTone(question.difficulty)}>
                  {question.difficulty}
                </Badge>
              )}
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
    </div>
  );
}

function PracticeTask({ section, label, slug, taskComponents }) {
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState(new Map());

  function load() {
    setLoading(true);
    setError(false);
    Promise.all([
      api.questions(section, slug),
      Promise.resolve(api.history()).catch(() => ({ submissions: [] })),
    ])
      .then(([questionData, historyData]) => {
        const localQuestions = section === "listening"
          ? LOCAL_LISTENING_QUESTIONS.filter(question => question.type === slug)
          : [];
        const loadedQuestions = localQuestions.length
          ? localQuestions
          : questionData?.questions || [];
        const map = new Map();
        for (const submission of historyData?.submissions || []) {
          const questionId = submission.question?._id || submission.questionId;
          if (questionId && !map.has(questionId))
            map.set(questionId, submission);
        }
        setQuestions(loadedQuestions);
        setProgress(map);
        setIdx(loadedQuestions.length === 1 ? 0 : null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(load, [section, slug]);

  if (loading)
    return (
      <div className="panel question-list-panel">
        <SkeletonRows count={6} />
      </div>
    );
  if (error)
    return (
      <div className="panel error-state">
        <AlertCircle size={30} />
        <h4>Unable to load your questions</h4>
        <p>Please check your connection and try again.</p>
        <button className="secondary" onClick={load}>
          Retry
        </button>
      </div>
    );
  if (!questions.length)
    return <Empty text="No practice questions available yet." />;
  if (idx === null)
    return (
      <QuestionListView
        questions={questions}
        progress={progress}
        onSelect={setIdx}
        section={section}
        label={label}
      />
    );

  const question = questions[idx];
  const existingResult = question ? progress.get(question._id) : null;
  const TaskComponent = taskComponents[section];
  if (!TaskComponent)
    return <Empty text="This practice section is not configured yet." />;

  return (
    <div>
      {questions.length > 1 && (
        <>
          <div
            className="mock-progress-bar"
            role="group"
            aria-label="Question navigation"
          >
            <button
              className="text-button"
              style={{ marginTop: 0 }}
              onClick={() => setIdx(null)}
            >
              <ChevronLeft size={15} /> Back to list
            </button>
            <span>
              Question {idx + 1} / {questions.length}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="secondary"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
                disabled={idx === 0}
              >
                <ChevronLeft size={15} /> Previous
              </button>
              <button
                className="secondary"
                onClick={() =>
                  setIdx((i) => Math.min(questions.length - 1, i + 1))
                }
                disabled={idx === questions.length - 1}
              >
                Next <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <div
            className="mock-progress-track"
            role="progressbar"
            aria-valuenow={idx + 1}
            aria-valuemin={1}
            aria-valuemax={questions.length}
            aria-valuetext={`Question ${idx + 1} of ${questions.length}`}
          >
            <div
              className="mock-progress-fill"
              style={{ width: `${((idx + 1) / questions.length) * 100}%` }}
            />
          </div>
        </>
      )}
      <TaskComponent
        key={question?._id}
        question={question}
        existingResult={existingResult}
      />
    </div>
  );
}

export default function Practice({ section, taskComponents }) {
  const tasks = supportedTasksFor(section);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSlug = searchParams.get("type");
  const [type, setType] = useState(
    () => tasks.find((task) => task.slug === requestedSlug) || tasks[0],
  );

  useEffect(() => {
    const match = tasks.find((task) => task.slug === requestedSlug);
    if (match) setType(match);
  }, [requestedSlug, section]);

  function selectType(task) {
    setType(task);
    setSearchParams(task.slug === tasks[0].slug ? {} : { type: task.slug });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{SECTION_LABELS[section]}</h1>
          <p>Practice {section} tasks with timing, scoring and feedback.</p>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -14, marginBottom: 16 }}>
        PTE Practice &gt; {SECTION_LABELS[section]}
        {type ? ` > ${type.label}` : ""}
      </p>
      <div className="practice-tabs">
        {tasks.map((task) => (
          <button
            key={task.slug}
            className={type?.slug === task.slug ? "tab active" : "tab"}
            onClick={() => selectType(task)}
          >
            {task.label}
          </button>
        ))}
      </div>
      {type ? (
        section === "speaking" && type.slug === "read-aloud" ? (
          // A fixed, client-curated 15-question set (see client/content/speaking/read-aloud) with
          // its own counter/navigation/completion screen — bypasses the generic DB-backed
          // PracticeTask flow used by every other task type, which is unaffected by this branch.
          <ReadAloudPractice />
        ) : section === "writing" && type.slug === "write-email" ? (
          // Write Email's content is the client's own PDF of 12 sample emails, shown and
          // downloadable as-is — same bypass pattern as Read Aloud above, and equally isolated
          // from every other task type's DB-backed PracticeTask flow.
          <WriteEmailPdf />
        ) : (
          <PracticeTask
            section={section}
            label={type.label}
            slug={type.slug}
            taskComponents={taskComponents}
          />
        )
      ) : (
        <Empty text="No practice questions available yet." />
      )}
    </>
  );
}
