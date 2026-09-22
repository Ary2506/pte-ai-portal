import React, { useEffect, useState } from "react";
import { BookOpen, Headphones, Mic, PenLine } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import {
  MORE_ITEMS,
  PRACTICE_SECTIONS,
  PRACTICE_TASKS,
  SECTION_LABELS,
} from "../practiceTaskRegistry.js";
import { Page } from "../components/common.jsx";
import { LOCAL_LISTENING_QUESTIONS } from "../practice/listeningData/index.js";

// Read Aloud (Speaking) and several Listening task types are served from locally bundled
// content (see Practice.jsx and listeningData/index.js) instead of the question database, so
// the database-only availability check below never sees them on its own — merge these in.
const LOCALLY_BACKED_KEYS = new Set([
  "speaking:read-aloud",
  ...new Set(LOCAL_LISTENING_QUESTIONS.map((q) => `listening:${q.type}`)),
]);

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

function PracticeTaskRow({ section, task, hasContent, onStart }) {
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

export default function PracticeHub() {
  const navigate = useNavigate();
  const [available, setAvailable] = useState(null);

  useEffect(() => {
    Promise.all(
      PRACTICE_SECTIONS.map((section) =>
        api
          .questions(section)
          .then((data) => ({ section, questions: data.questions }))
          .catch(() => ({ section, questions: [] })),
      ),
    ).then((results) => {
      const set = new Set(LOCALLY_BACKED_KEYS);
      results.forEach(({ section, questions }) =>
        questions.forEach((question) => set.add(`${section}:${question.type}`)),
      );
      setAvailable(set);
    });
  }, []);

  function start(section, slug) {
    navigate(`/${section}?type=${slug}`);
  }

  return (
    <Page
      title="PTE Practice"
      subtitle="Practice every section, improve your skills, and understand your mistakes."
    >
      <div className="panel practice-hub-panel">
        <div className="exam-variant-toggle" role="tablist">
          <span
            className="exam-variant-tab active"
            role="tab"
            aria-selected="true"
          >
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
        <div className="practice-columns">
          {PRACTICE_SECTIONS.map((section) => {
            const SectionIcon = SECTION_ICONS[section];
            const tasks = PRACTICE_TASKS[section];
            const readyCount = available
              ? tasks.filter(
                  (task) =>
                    task.supported && available.has(`${section}:${task.slug}`),
                ).length
              : null;
            return (
              <div
                className={`practice-column practice-${section}`}
                key={section}
              >
                <div className="practice-column-header">
                  <div className="practice-column-icon">
                    <SectionIcon size={24} />
                  </div>
                  <div className="practice-column-heading">
                    <h3 className="practice-column-head">
                      {SECTION_LABELS[section]}
                    </h3>
                    <p className="practice-column-desc">
                      {SECTION_DESCRIPTIONS[section]}
                    </p>
                  </div>
                  <span className="practice-column-count">
                    {readyCount == null
                      ? "…"
                      : `${readyCount}/${tasks.length} ready`}
                  </span>
                </div>
                <div className="practice-column-list">
                  {tasks.map((task) => (
                    <PracticeTaskRow
                      key={task.slug}
                      section={section}
                      task={task}
                      hasContent={
                        available
                          ? available.has(`${section}:${task.slug}`)
                          : false
                      }
                      onStart={start}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="practice-more-section">
          <h3 className="practice-column-head">More</h3>
          <div className="practice-more-row">
            {MORE_ITEMS.map((item) =>
              item.to ? (
                <NavLink
                  key={item.key}
                  to={item.to}
                  className="practice-more-link"
                >
                  {item.label}
                </NavLink>
              ) : (
                <span
                  key={item.key}
                  className="practice-more-link disabled"
                  aria-disabled="true"
                >
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
