import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import {
  PRACTICE_SECTIONS,
  SECTION_LABELS,
  supportedTasksFor,
} from "../practiceTaskRegistry.js";
import { Empty, SkeletonRows } from "../components/common.jsx";
import { QuestionListView } from "./QuestionListView.jsx";
import WriteEmailPdf from "./WriteEmailPdf.jsx";
import { applyStructuredContent } from "./listeningData/shared.js";

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

function PracticeTask({ section, label, slug, taskComponents }) {
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState(new Map());
  const [finished, setFinished] = useState(false);

  function load() {
    setLoading(true);
    setError(false);
    Promise.all([
      api.questions(section, slug),
      // Scoped to this one task: the map below is only ever read for questions in this task, so
      // pulling the 50 most recent submissions across every section both shipped rows that were
      // discarded and could push this task's own older attempts out of the limit entirely.
      // Full rows (not summary) — these become `existingResult`, which restores a previous
      // answer and its feedback.
      Promise.resolve(api.history({ section, type: slug })).catch(() => ({ submissions: [] })),
    ])
      .then(([questionData, historyData]) => {
        // Every section now comes from the question bank. Listening used to be served from
        // bundled JSON that shadowed the database entirely — questions in the bank for those
        // types were unreachable in practice, and the bundled ones could never appear in a mock
        // test. The only thing left from that path is the derivation below.
        const loadedQuestions = (questionData?.questions || []).map((question) =>
          // Fill in the Blanks and Highlight Incorrect Words store their passage as the authored
          // `content` array; everything the renderer needs (segments, blank answers, incorrect
          // word indices) is derived from it here, exactly as it was for bundled content.
          question.content
            ? applyStructuredContent({ ...question }, question.type, question.content)
            : question
        );
        const map = new Map();
        for (const submission of historyData?.submissions || []) {
          // localQuestionId matches bundled local content (e.g. Listening) that has no real
          // Question document — see models/Submission.js.
          const questionId = submission.question?._id || submission.localQuestionId;
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

  if (finished) {
    // Counted from `progress`, which is this student's real submission history for this task —
    // so the summary reflects everything they have ever answered here, not only what they did
    // in the current sitting. A question with no submission simply isn't counted.
    const attempts = questions.map((q) => progress.get(q._id)).filter(Boolean);
    const scored = attempts.filter((a) => a.evaluationStatus === "COMPLETED" && a.maxScore);
    const average = scored.length
      ? Math.round(scored.reduce((sum, a) => sum + (a.score / a.maxScore) * 90, 0) / scored.length)
      : null;
    return (
      <div className="panel task-main narrow">
        <div className="task-meta">
          <span className="chip">{SECTION_LABELS[section]}</span>
        </div>
        <h2>Practice Completed 🎉</h2>
        <p className="instruction">
          You've gone through all {questions.length} {label} question
          {questions.length === 1 ? "" : "s"}.
        </p>
        <p className="muted">
          {attempts.length} of {questions.length} answered
          {average !== null && ` · average score ${average}/90`}
        </p>
        <div className="task-actions">
          <button className="secondary" onClick={() => { setFinished(false); setIdx(null); }}>
            Back to list
          </button>
          <button className="primary" onClick={() => { setFinished(false); setIdx(0); }}>
            Start again
          </button>
        </div>
      </div>
    );
  }

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
              {/* On the last question Next becomes Finish, which shows the summary below
                  instead of dead-ending on a disabled button. Speaking only, where a student
                  works through a task end to end; the other sections' Next simply disables. */}
              {section === "speaking" && idx === questions.length - 1 ? (
                <button className="primary" onClick={() => setFinished(true)}>
                  Finish
                </button>
              ) : (
                <button
                  className="secondary"
                  onClick={() =>
                    setIdx((i) => Math.min(questions.length - 1, i + 1))
                  }
                  disabled={idx === questions.length - 1}
                >
                  Next <ChevronRight size={15} />
                </button>
              )}
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
        section === "writing" && type.slug === "write-email" ? (
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
