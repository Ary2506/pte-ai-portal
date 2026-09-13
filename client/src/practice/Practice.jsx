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
import summarizeSpokenTextContent from "../../content/listening/summarize-spoken-text/summarize_spoken_text.json";

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

const LOCAL_SUMMARIZE_SPOKEN_TEXT_QUESTIONS = Array.isArray(
  summarizeSpokenTextContent,
)
  ? summarizeSpokenTextContent.map((item) => ({
      _id: String(item.id),
      section: "listening",
      type: "summarize-spoken-text",
      title: item.title,
      prompt:
        "Listen to the short practice audio and summarize the main idea in your own words.",
      audioUrl: new URL(
        `../../content/listening/summarize-spoken-text/${item.audio.src}`,
        import.meta.url,
      ).href,
      transcript: item.transcript,
      difficulty: item.subtype === "core" ? "medium" : "easy",
      evaluationType: "subjective",
    }))
  : [];

const PROGRESS_FILTERS = [
  { key: "all", label: "All" },
  { key: "undone", label: "Undone" },
  { key: "done", label: "Done" },
];

function Empty({ text }) {
  return <div className="empty">{text}</div>;
}
function SkeletonRows({ count = 5 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton skeleton-row" key={i} />
      ))}
    </div>
  );
}
function Badge({ tone, children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
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
  const rows = questions
    .map((question, index) => ({ question, index }))
    .filter(
      ({ question }) =>
        filter === "all" || (filter === "done") === progress.has(question._id),
    )
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
        const localQuestions =
          section === "listening" && slug === "summarize-spoken-text"
            ? LOCAL_SUMMARIZE_SPOKEN_TEXT_QUESTIONS
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
        <PracticeTask
          section={section}
          label={type.label}
          slug={type.slug}
          taskComponents={taskComponents}
        />
      ) : (
        <Empty text="No practice questions available yet." />
      )}
    </>
  );
}
