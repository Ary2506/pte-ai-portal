import React, { useEffect, useState } from "react";
import { Clock3, Eye, EyeOff, List, RotateCcw, Save, Sparkles } from "lucide-react";
import { api } from "../api.js";
import { Result } from "../PracticeObjective.jsx";
import { useToast } from "../components/toast.jsx";
import { Button, NavButton } from "../components/Button.jsx";
import TaskTips, { AI_SCORING_NOTE, useTaskRail } from "./TaskTips.jsx";
import { ANSWER_MAX_LENGTH, TASK_CHAR_LIMITS, countCharacters, lengthState } from "./answerLimits.js";

const WRITING_WORD_RANGES = { swt: [40, 100], essay: [200, 300], "write-email": [80, 120] };
const WRITING_TASK_NAMES = { swt: "Summarize Written Text", essay: "Write Essay", "write-email": "Write Email" };
// Practice countdown per task, in seconds. It starts when the question appears; PracticeTask
// remounts this component per question (key={question._id}), so Next/Previous start it afresh.
// Mock Tests run their own section timer and are left alone.
const WRITING_TIME_LIMITS = { swt: 600, "write-email": 540 };
// Hard word caps: once reached, no further words can be typed.
const WRITING_WORD_LIMITS = { "write-email": 200 };

// A Write Email prompt is the scenario followed by its points, one per line, each starting "• "
// (as in the source PDF). Each point is shown on its own line as "- point", the exam's own style.
function EmailPrompt({ prompt }) {
  const lines = prompt.split("\n").map((line) => line.trim()).filter(Boolean);
  const intro = lines.filter((line) => !line.startsWith("• "));
  const points = lines.filter((line) => line.startsWith("• ")).map((line) => line.slice(2));
  return (
    <div className="instruction email-prompt">
      {intro.map((line, i) => <p key={i}>{line}</p>)}
      {points.map((point, i) => <p key={`point-${i}`} className="email-prompt__point">- {point}</p>)}
    </div>
  );
}

function formatMMSS(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function WordCountBadge({ count, range }) {
  if (!range) return <span className="word-count">{count} words</span>;
  const [min, max] = range;
  const tone = count < min ? "low" : count > max ? "high" : "good";
  return (
    <span className={`word-count ${tone}`}>
      {count} / {min}–{max} words
    </span>
  );
}

export default function Writing({
  type,
  question,
  testSessionId,
  onAnswered,
  existingResult,
  savedDraft,
  onSaveDraft,
  // Practice-only, used by the Write Email layout, which carries its own Previous/Next row.
  position,
  onPrevious,
  onNext,
  onBackToList,
}) {
  const [text, setText] = useState(
    () =>
      // A submitted answer wins; a saved draft is the fallback. Only a submission sets `result`,
      // so a draft leaves the question open and editable, which is the whole point of saving.
      existingResult?.transcript ||
      (typeof existingResult?.answer === "string" ? existingResult.answer : "") ||
      (typeof savedDraft?.answer === "string" ? savedDraft.answer : ""),
  );
  const [result, setResult] = useState(() => existingResult || null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Reset per question by the key={question._id} remount PracticeTask already does.
  const [showAnswer, setShowAnswer] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const timeLimit = testSessionId ? null : WRITING_TIME_LIMITS[question?.type] ?? null;
  // Counted against a deadline rather than by decrementing, so a throttled background tab
  // cannot make the clock run slow.
  const [deadline, setDeadline] = useState(() => Date.now() + (timeLimit ?? 0) * 1000);
  const [now, setNow] = useState(() => Date.now());
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const timerRunning = timeLimit !== null && !result && remaining > 0;
  useEffect(() => {
    if (!timerRunning) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  function saveDraft() {
    onSaveDraft?.({ answer: text });
    toast.success("Answer saved. You can change it until you submit.");
  }

  async function submit() {
    if (!text.trim()) {
      toast.error("Write a response before submitting.");
      return;
    }
    if (overLimit) {
      toast.error(`Your response is ${charCount - charLimit} character${charCount - charLimit === 1 ? "" : "s"} over the ${charLimit}-character limit.`);
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append("section", "writing");
    // Practice passes no `type` prop (and Mock passes the title), so an Email answer is filed under
    // its question's own type. Other Writing tasks still send `type` as before.
    form.append("type", question?.type === "write-email" ? question.type : type);
    form.append("answer", JSON.stringify(text));
    form.append("transcript", text);
    if (question?._id) form.append("questionId", question._id);
    if (testSessionId) form.append("testSessionId", testSessionId);
    try {
      const data = await api.submit(form);
      setResult(data.submission);
      onAnswered?.(data.submission);
      // A mock shows nothing else on submit — no score, no verdict — so without this the only
      // signal is the button quietly disappearing.
      if (testSessionId) toast.success("Question submitted.");
    } catch (submitError) {
      toast.error(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setRetrying(true);
    try {
      setResult((await api.retryEvaluation(result._id)).submission);
    } catch (retryError) {
      toast.error(retryError.message);
    } finally {
      setRetrying(false);
    }
  }

  function resetQuestion() {
    setText("");
    setResult(null);
    setBusy(false);
    setRetrying(false);
    // A fresh attempt gets the full time again.
    const restart = Date.now();
    setDeadline(restart + (timeLimit ?? 0) * 1000);
    setNow(restart);
  }

  const countWords = (value) => (value.trim() ? value.trim().split(/\s+/).length : 0);
  const wordCount = countWords(text);
  // A hard word cap, separate from the target range: typing past it is refused, like the
  // character cap below.
  const wordLimit = WRITING_WORD_LIMITS[question?.type] ?? null;
  // Counted the same way the badge is, so the panel and the badge can never disagree.
  const sentenceCount = text.trim() ? text.trim().split(/[.!?]+(?:\s|$)/).filter(Boolean).length : 0;
  // Characters excluding whitespace, against this task's own cap.
  const charCount = countCharacters(text);
  const charLimit = TASK_CHAR_LIMITS[question?.type] ?? null;
  const overLimit = charLimit !== null && charCount > charLimit;

  // maxLength cannot express this: it counts every character, and the limit here ignores
  // whitespace. So the cap is enforced on the way in — typing or pasting past it is refused,
  // while anything that SHORTENS the text is always allowed, otherwise a response restored over
  // the limit could never be edited back down.
  function changeText(next) {
    const shorter = next.length < text.length;
    const withinChars = charLimit === null || countCharacters(next) <= charLimit;
    const withinWords = wordLimit === null || countWords(next) <= wordLimit;
    if (shorter || (withinChars && withinWords)) {
      setText(next);
    }
  }
  const rail = useTaskRail();
  const showComposePanel = rail?.taskPanels !== false;
  const range = WRITING_WORD_RANGES[question?.type];
  const tone = range ? (wordCount < range[0] ? "low" : wordCount > range[1] ? "high" : "good") : "good";
  // The scale runs a little past the maximum so going over is visible rather than pinned at full.
  const overMax = range ? range[1] * 1.25 : 1;

  // The rail beside the editor: the Composition panel (word target, words, characters, sentences)
  // and the task's tips. Shared by the standard layout and the Write Email one.
  const taskRail = (
    // Both panels share the one rail column — .task-layout is a two-column grid, so a third
    // child would otherwise drop onto its own row under the editor.
    <div className="task-rail">
      {showComposePanel && <aside className="panel compose-panel">
        <span className="stat-label">Composition</span>
        <h3>{WRITING_TASK_NAMES[question?.type] || "Your response"}</h3>

        {range ? (
          <div className="compose-target">
            <div className="compose-target__head">
              <span className="muted">Word target</span>
              <b className="num-mono">{range[0]}–{range[1]}</b>
            </div>
            {/* The range drawn as a band, so being under, inside or over it is something the
                student sees rather than has to work out from two numbers. */}
            <div className="compose-target__track" role="img"
              aria-label={`${wordCount} words written, target ${range[0]} to ${range[1]}`}>
              <span className="compose-target__band"
                style={{ left: `${(range[0] / overMax) * 100}%`, width: `${((range[1] - range[0]) / overMax) * 100}%` }}/>
              <span className={`compose-target__fill is-${tone}`}
                style={{ width: `${Math.min(100, (wordCount / overMax) * 100)}%` }}/>
            </div>
            <p className={`compose-target__verdict is-${tone}`}>
              {tone === "low" ? `${range[0] - wordCount} more word${range[0] - wordCount === 1 ? "" : "s"} to reach the minimum.`
                : tone === "high" ? `${wordCount - range[1]} word${wordCount - range[1] === 1 ? "" : "s"} over the maximum.`
                : "Within the target range."}
            </p>
          </div>
        ) : (
          <p className="muted">This task has no fixed word target — answer it fully and concisely.</p>
        )}

        <dl className="compose-stats">
          <div>
            <dt>Words</dt>
            <dd className={wordLimit !== null ? `num-mono is-${lengthState(wordCount, wordLimit)}` : "num-mono"} id={wordLimit !== null ? "writing-words" : undefined}>
              {wordCount}
              {wordLimit !== null && <span className="compose-stats__limit">/{wordLimit}</span>}
            </dd>
          </div>
          <div>
            <dt>Characters</dt>
            <dd className={`num-mono is-${lengthState(charCount, charLimit ?? ANSWER_MAX_LENGTH)}`} id="writing-length">
              {charCount}
              <span className="compose-stats__limit">/{charLimit ?? ANSWER_MAX_LENGTH}</span>
            </dd>
          </div>
          <div><dt>Sentences</dt><dd className="num-mono">{sentenceCount}</dd></div>
        </dl>
        {charLimit !== null && charCount >= charLimit && (
          <p className={overLimit ? "compose-limit" : "compose-limit is-reached"} role="status">
            {overLimit
              ? `${charCount - charLimit} over the ${charLimit}-character limit — shorten your response to submit.`
              : `You have reached the ${charLimit}-character limit. Spaces are not counted.`}
          </p>
        )}
        {wordLimit !== null && wordCount >= wordLimit && (
          <p className="compose-limit is-reached" role="status">
            You have reached the {wordLimit}-word limit.
          </p>
        )}

      </aside>}
      {/* Write Email gets its own tips; every other task keeps the tips it showed before. */}
      <TaskTips type={question?.type === "write-email" ? question.type : type} section="writing" note={AI_SCORING_NOTE}/>
    </div>
  );

  // Write Email practice: one question at a time in the exam's own reading order: the task
  // instructions, "#n Title", the time remaining, the scenario and its points, a large answer box,
  // then Submit / Re-do / Answer with Previous / Next on the same row. Counting lives in the
  // Composition panel beside it. Mock Tests keep the standard layout below.
  if (question?.type === "write-email" && !testSessionId) {
    const sample = typeof question.answer === "string" && question.answer.trim() ? question.answer : null;
    return (
      <div className="task-layout">
      <section className="panel email-practice">
        <header className="email-practice__intro">
          <h2>Write Email</h2>
          <p>
            Read a description of a situation. Then write an email about the situation. You will have
            9 minutes. You should aim to write 80 - 120 words. Write using complete sentences.
          </p>
        </header>

        <div className="email-practice__title">
          <h3>{position ? `#${position.number} ` : ""}{question.title}</h3>
          {onBackToList && (
            <Button variant="ghost" size="sm" icon={<List/>} onClick={onBackToList}>Back to list</Button>
          )}
        </div>

        {!result && (
          <p className="email-practice__remain" role="timer"
            aria-label={remaining ? `${formatMMSS(remaining)} remaining` : "Time's up"}>
            Remain: {formatMMSS(remaining)}{remaining ? "" : " — Time's up"}
          </p>
        )}

        <EmailPrompt prompt={question.prompt || ""} />

        <textarea
          className="answer-area email-practice__answer"
          value={text}
          onChange={(event) => changeText(event.target.value)}
          placeholder="Type your answer here..."
          disabled={!!result}
          maxLength={ANSWER_MAX_LENGTH}
          aria-label="Your email"
        />

        <div className="email-practice__actions">
          <div className="email-practice__actions-main">
            {!result && (
              <Button variant="primary" disabled={!text.trim() || overLimit} loading={busy}
                loadingLabel="Evaluating..." onClick={submit}>
                Submit
              </Button>
            )}
            <Button variant="secondary" icon={<RotateCcw/>} onClick={resetQuestion} disabled={busy || retrying}>
              Re-do
            </Button>
            {sample && (
              <label className="email-practice__toggle">
                <input type="checkbox" role="switch" checked={showAnswer}
                  onChange={(event) => setShowAnswer(event.target.checked)} />
                <span aria-hidden="true" className="email-practice__switch" />
                Answer
              </label>
            )}
          </div>
          {(onPrevious !== undefined || onNext !== undefined) && (
            <div className="email-practice__actions-nav">
              <NavButton direction="previous" onClick={onPrevious || undefined} disabled={!onPrevious}>Previous</NavButton>
              <NavButton direction="next" onClick={onNext || undefined} disabled={!onNext}>Next</NavButton>
            </div>
          )}
        </div>

        {result && <Result result={result} onRetry={retry} retrying={retrying} />}
        {sample && showAnswer && (
          <div className="answer-reveal">
            <b>Sample answer</b>
            {/* A sample email keeps its paragraph and sign-off line breaks. */}
            <p className="email-sample">{sample}</p>
          </div>
        )}
      </section>
      {taskRail}
      </div>
    );
  }

  return (
    <div className="task-layout">
      <section className="panel task-main">
        <div className="task-meta">
          {/* The section, matching the other three task components — not `type`, which rendered
              the raw slug ("swt", "essay") that the breadcrumb and task tabs already show. */}
          <span className="chip">Writing</span>
          {timeLimit !== null && !result && (
            <span className={remaining <= 60 ? "writing-timer low" : "writing-timer"} role="timer"
              aria-label={remaining ? `${formatMMSS(remaining)} remaining` : "Time's up"}>
              <Clock3 size={15} /> {remaining ? formatMMSS(remaining) : "Time's up"}
            </span>
          )}
          <WordCountBadge
            count={wordCount}
            range={WRITING_WORD_RANGES[question?.type]}
          />
        </div>
        <h2>{question?.title || type}</h2>
        {question?.type === "write-email" && question?.prompt ? (
          <EmailPrompt prompt={question.prompt} />
        ) : (
          <p className="instruction">
            {question?.prompt || "Write your answer below."}
          </p>
        )}
        {question?.passage && <div className="passage">{question.passage}</div>}
        <textarea
          className="answer-area"
          value={text}
          onChange={(event) => changeText(event.target.value)}
          placeholder="Type your answer here..."
          disabled={!!result}
          maxLength={ANSWER_MAX_LENGTH}
          aria-describedby="writing-length"
        />
        {!showComposePanel && (
          <p className="compose-inline" id="writing-length" role="status">
            <span className="num-mono">{wordCount}</span> words
            {range && <> · target <span className="num-mono">{range[0]}–{range[1]}</span></>}
            {" · "}
            <span className={`num-mono is-${lengthState(charCount, charLimit ?? ANSWER_MAX_LENGTH)}`}>
              {charCount}
            </span>
            /{charLimit ?? ANSWER_MAX_LENGTH} characters
            {charLimit !== null && charCount >= charLimit && (
              <span className="compose-inline__limit">
                {" — "}limit reached. Spaces are not counted.
              </span>
            )}
          </p>
        )}
        {/* Withheld during a mock: the verdict belongs on the results screen once the whole
            test is finished. Standalone practice marks each answer immediately. */}
        {result && !testSessionId && <Result result={result} onRetry={retry} retrying={retrying} />}
        {/* One row, both buttons. Submit used to float right while Re-do sat in a separate block
            below it, so the two landed on different baselines with the float's margin between
            them. Re-do is standalone-practice only — Mock Test's timed, one-attempt-per-question
            flow is untouched (gated on testSessionId, exactly as Mock always passes it and
            standalone practice never does). */}
        <div className="task-actions">
          {!result && onSaveDraft && (
            <Button variant="secondary" icon={<Save/>} onClick={saveDraft} disabled={!text.trim() || busy}>
              Save
            </Button>
          )}
          {!testSessionId && (
            <Button
              variant="secondary"
              icon={<RotateCcw/>}
              onClick={resetQuestion}
              disabled={busy || retrying}
            >
              Re-do
            </Button>
          )}
          {!result && (
            <Button
              variant="primary"
              icon={<Sparkles/>}
              disabled={!text.trim() || overLimit}
              loading={busy}
              loadingLabel="Evaluating..."
              onClick={submit}
            >
              Submit for AI Feedback
            </Button>
          )}
        </div>
        {/* Gated on a reference answer actually existing, not on the task type: Summarize Written
            Text has one for some questions and Essay has none at all, so keying this on type
            would either hide a real model answer or offer a button that reveals nothing.
            Writing is AI-scored, so this is a reference to compare against — never a key the
            student is marked on, which is why it can be shown before submitting. */}
        {typeof question?.answer === "string" && question.answer.trim() && (
          <>
            <Button
              variant="tertiary"
              size="sm"
              className="answer-toggle"
              icon={showAnswer ? <EyeOff/> : <Eye/>}
              onClick={() => setShowAnswer((value) => !value)}
            >
              {showAnswer ? "Hide Answer" : "Show Answer"}
            </Button>
            {showAnswer && (
              <div className="answer-reveal">
                <b>Sample answer</b>
                {/* A sample email keeps its paragraph and sign-off line breaks. */}
                <p className={question.type === "write-email" ? "email-sample" : undefined}>{question.answer}</p>
              </div>
            )}
          </>
        )}
      </section>
      {taskRail}
    </div>
  );
}

export { Writing };
