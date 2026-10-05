import { scoreSingleChoice, scoreMultipleChoice, scoreReorder, scoreDictation, scoreFillDrag, scoreTypedBlanks, scoreHighlightIncorrectWords, scoreDropdownBlanks } from "./objective.js";
import { evaluateSubjective } from "../services/ai/index.js";
import { scoreRepeatSentence } from "./repeatSentence.js";

const MAX_REPEAT_SENTENCE_SCORE = 90;
const REPEAT_SENTENCE_NOTE = "Scored by comparing the words of your transcript with the recording, in order. Pronunciation and fluency are not analyzed, since only text is available.";

const OBJECTIVE_SCORERS = {
  "mcq-single": scoreSingleChoice,
  "mcq-multiple": scoreMultipleChoice,
  reorder: scoreReorder,
  "write-dictation": scoreDictation,
  // Phase 20: select-missing-word is mechanically identical to mcq-single (audio + one correct
  // option); highlight-incorrect-words is mechanically identical to mcq-multiple (the displayed
  // words are the options, the wrong ones are the "correct" selections) — both reuse the
  // existing, already-tested scorers rather than duplicating the same logic under a new name.
  "select-missing-word": scoreSingleChoice,
  "highlight-incorrect-words": scoreHighlightIncorrectWords,
  "fill-blanks-dragdrop": scoreFillDrag,
  // Listening's many-blank, free-text variant. Reading's "fill-blanks" above stays on
  // scoreSingleChoice: same name, different exercise, which is exactly why this needed its own
  // type rather than sharing one.
  "fill-blanks-typed": scoreTypedBlanks,
  "fib-dropdown": scoreDropdownBlanks
};

function subjectiveFeedback(result, extra = {}) {
  return {
    strengths: result.strengths,
    improvements: result.improvements,
    overall: result.overall,
    note: result.note,
    scoringMethod: result.scoringMethod,
    // Diagnostic detail only (Phase 16, B2) — never present for the heuristic fallback or a
    // FAILED evaluation, since neither has a real basis for either (see evaluator.js).
    criteria: result.criteria ?? null,
    mistakes: result.mistakes ?? [],
    // status/correctedResponse come from the AI, only ever populated when expectedAnswerText was
    // actually sent (see evaluateAnswer below). expectedAnswerText/studentAnswerText are
    // deterministic pass-throughs of server data — never AI-invented — same pattern as the
    // objective scorers' correctAnswerText/studentAnswerText (Phase 16, B4).
    status: result.status ?? null,
    correctedResponse: result.correctedResponse ?? null,
    expectedAnswerText: extra.expectedAnswerText ?? null,
    studentAnswerText: extra.studentAnswerText ?? null
  };
}

// Single entry point the submissions route calls for every answer. Dispatches purely on the
// question's own evaluationType/type — the client never gets a say in how it's scored. The
// question's own prompt/passage (fetched server-side) are what reach the AI service — never
// anything the client sent — so a student cannot inject prompt content into the AI call.
export async function evaluateAnswer(question, { answer, text, durationSeconds }) {
  if (question.evaluationType === "objective") {
    const scorer = OBJECTIVE_SCORERS[question.type];
    if (!scorer) {
      return { score: 0, maxScore: question.maxScore || 1, evaluationType: "objective", evaluationStatus: "COMPLETED", feedback: { feedback: ["No objective scorer is configured for this question type."] } };
    }
    const result = scorer(question, answer);
    return {
      score: result.score,
      maxScore: result.maxScore,
      evaluationType: "objective",
      evaluationStatus: "COMPLETED",
      invalid: !!result.invalid,
      // studentAnswerText/correctAnswerText (Phase 16, B4) are resolved here, deterministically,
      // from the question's own answer key — never from AI, and never before this point (i.e.
      // never before the student has actually submitted this exact question).
      feedback: {
        correct: result.correct,
        feedback: result.feedback,
        invalid: !!result.invalid,
        studentAnswerText: result.studentAnswerText ?? null,
        correctAnswerText: result.correctAnswerText ?? null,
        // Positions rather than text, for the types that mark their answers inside a passage
        // instead of listing them: Highlight Incorrect Words needs to know *which* words were
        // wrong to colour them, and what the recording said in their place. Both are null for
        // every other type. This object is an allow-list — a field a scorer returns but that is
        // not named here never reaches the client, which is exactly how these two were lost on
        // their first outing: the score came back correct while the passage rendered as if every
        // pick had been wrong.
        correctIndexes: result.correctIndexes ?? null,
        corrections: result.corrections ?? null
      }
    };
  }

  // Repeat Sentence is graded against the verified transcript of its own audio (`transcript`),
  // by exact word alignment rather than by AI — see scoring/repeatSentence.js. Questions without
  // one (the five legacy clips) keep going through the AI path below, unchanged.
  if (question.type === "repeat-sentence") {
    const reference = typeof question.transcript === "string" ? question.transcript.trim() : "";
    if (reference) {
      const r = scoreRepeatSentence(reference, text);
      return {
        score: r.score,
        maxScore: r.maxScore,
        evaluationType: "subjective",
        evaluationStatus: "COMPLETED",
        scoringMethod: "word-alignment",
        feedback: subjectiveFeedback(
          { ...r, scoringMethod: "word-alignment", note: REPEAT_SENTENCE_NOTE },
          { expectedAnswerText: reference, studentAnswerText: text?.trim() || null }
        )
      };
    }
    // An imported clip whose transcript is still awaiting human verification has nothing to be
    // graded against. Scoring it by AI with no reference would produce a confident, meaningless
    // number, so it is refused instead.
    if (String(question.sourceGroup || "").startsWith("repeat-sentence/")) {
      return {
        score: 0,
        maxScore: MAX_REPEAT_SENTENCE_SCORE,
        evaluationType: "subjective",
        evaluationStatus: "FAILED",
        scoringMethod: null,
        feedback: subjectiveFeedback({
          strengths: [], improvements: [], scoringMethod: null,
          overall: "This question's reference transcript is still awaiting verification, so it cannot be scored yet.", note: null
        })
      };
    }
  }

  // The question's own stored answer (when it has one — currently only Describe Image, section 9
  // of the client's request) becomes the AI's comparison target. Untouched/empty for every other
  // question, so their evaluation is unaffected.
  const expectedAnswer = typeof question.answer === "string" && question.answer.trim() ? question.answer.trim() : null;
  const result = await evaluateSubjective({ type: question.type, prompt: question.prompt, passage: question.passage, text, durationSeconds, expectedAnswer });
  return {
    score: result.score,
    maxScore: result.maxScore,
    evaluationType: "subjective",
    evaluationStatus: result.evaluationStatus,
    scoringMethod: result.scoringMethod,
    feedback: subjectiveFeedback(result, { expectedAnswerText: expectedAnswer, studentAnswerText: text?.trim() || null })
  };
}
