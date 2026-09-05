import { scoreSingleChoice, scoreMultipleChoice, scoreReorder, scoreDictation, scoreFillDrag } from "./objective.js";
import { evaluateSubjective } from "../services/ai/index.js";

const OBJECTIVE_SCORERS = {
  "mcq-single": scoreSingleChoice,
  "fill-blanks": scoreSingleChoice,
  "mcq-multiple": scoreMultipleChoice,
  reorder: scoreReorder,
  "write-dictation": scoreDictation,
  // Phase 20: select-missing-word is mechanically identical to mcq-single (audio + one correct
  // option); highlight-incorrect-words is mechanically identical to mcq-multiple (the displayed
  // words are the options, the wrong ones are the "correct" selections) — both reuse the
  // existing, already-tested scorers rather than duplicating the same logic under a new name.
  "select-missing-word": scoreSingleChoice,
  "highlight-incorrect-words": scoreMultipleChoice,
  "fill-blanks-dragdrop": scoreFillDrag
};

function subjectiveFeedback(result) {
  return {
    strengths: result.strengths,
    improvements: result.improvements,
    overall: result.overall,
    note: result.note,
    scoringMethod: result.scoringMethod,
    // Diagnostic detail only (Phase 16, B2) — never present for the heuristic fallback or a
    // FAILED evaluation, since neither has a real basis for either (see evaluator.js).
    criteria: result.criteria ?? null,
    mistakes: result.mistakes ?? []
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
        correctAnswerText: result.correctAnswerText ?? null
      }
    };
  }

  const result = await evaluateSubjective({ type: question.type, prompt: question.prompt, passage: question.passage, text, durationSeconds });
  return {
    score: result.score,
    maxScore: result.maxScore,
    evaluationType: "subjective",
    evaluationStatus: result.evaluationStatus,
    scoringMethod: result.scoringMethod,
    feedback: subjectiveFeedback(result)
  };
}
