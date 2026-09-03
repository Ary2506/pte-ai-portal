// Deterministic, server-side scoring for objectively-gradable question types.
// Every function returns { score, maxScore, correct, feedback[], invalid? }.
// These are practice-scoring approximations of commonly documented PTE partial-credit
// methods — they are NOT verified against Pearson's official scoring algorithm.

// Resolves an option index to its display text — used only to build a human-readable mistake
// explanation from data the server already trusts (the question's own options/answer key), never
// to ask AI whether an answer is correct (Phase 16, B4: the server already knows).
function optionText(options, index) {
  return Array.isArray(options) && Number.isInteger(index) && options[index] !== undefined ? options[index] : null;
}

export function scoreSingleChoice(question, answer) {
  const selected = Number(answer);
  const correct = Number.isInteger(selected) && selected === question.answer;
  const maxScore = question.maxScore || 1;
  return {
    score: correct ? maxScore : 0,
    maxScore,
    correct,
    feedback: [correct ? "Correct." : "Not quite the right answer.", question.explanation].filter(Boolean),
    studentAnswerText: optionText(question.options, Number.isInteger(selected) ? selected : null),
    correctAnswerText: optionText(question.options, question.answer)
  };
}

export function scoreMultipleChoice(question, answer) {
  const selected = Array.isArray(answer) ? [...new Set(answer.map(Number))] : [];
  const correctSet = new Set(question.answer || []);
  let right = 0, wrong = 0;
  for (const s of selected) (correctSet.has(s) ? right++ : wrong++);
  const maxScore = correctSet.size || question.maxScore || 1;
  // Practice rule: +1 per correct selection, -1 per incorrect one, floored at 0 — a common
  // simplified approximation of PTE multi-select partial credit, not the official formula.
  const score = Math.max(0, right - wrong);
  return {
    score,
    maxScore,
    correct: right === correctSet.size && wrong === 0,
    feedback: [`You selected ${right} correct and ${wrong} incorrect option(s).`, question.explanation].filter(Boolean),
    studentAnswerText: selected.map(i => optionText(question.options, i)).filter(Boolean).join(", ") || null,
    correctAnswerText: [...correctSet].map(i => optionText(question.options, i)).filter(Boolean).join(", ") || null
  };
}

export function scoreReorder(question, answer) {
  const correctOrder = Array.isArray(question.answer) ? question.answer : [];
  const submitted = Array.isArray(answer) ? answer.map(Number) : null;
  // maxScore = (number of items - 1) adjacent pairs. Always derived from the answer key
  // itself, never from question.maxScore — that field defaults to 1 on every question, so
  // trusting it here would silently under-report maxScore for any 3+ item reorder question.
  const maxScore = Math.max(1, correctOrder.length - 1);

  const validShape =
    submitted && submitted.length === correctOrder.length && new Set(submitted).size === correctOrder.length;
  if (!validShape) {
    return {
      score: 0,
      maxScore,
      correct: false,
      invalid: true,
      feedback: ["Submitted order was invalid — every item must appear exactly once."]
    };
  }

  // Practice rule: one point per correctly-placed ADJACENT pair, matching the widely
  // documented approach for PTE re-order-paragraphs partial credit.
  let matches = 0;
  for (let i = 0; i < correctOrder.length - 1; i++) {
    const posA = submitted.indexOf(correctOrder[i]);
    const posB = submitted.indexOf(correctOrder[i + 1]);
    if (posB === posA + 1) matches++;
  }
  const exact = submitted.every((v, i) => v === correctOrder[i]);
  const orderText = order => order.map(i => optionText(question.options, i)).filter(Boolean).join(" → ") || null;
  return {
    score: matches,
    maxScore,
    correct: exact,
    feedback: [exact ? "Perfect order!" : `${matches} of ${maxScore} adjacent pairs were placed correctly.`, question.explanation].filter(Boolean),
    studentAnswerText: orderText(submitted),
    correctAnswerText: orderText(correctOrder)
  };
}

function normalizeText(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:"'`]/g, "")
    .replace(/\s+/g, " ");
}

export function scoreDictation(question, answer) {
  const correctWords = normalizeText(question.answer).split(" ").filter(Boolean);
  // A missing/empty/whitespace-only answer key leaves nothing legitimate to grade against —
  // without this, an empty correctWords array made a blank submission score as "exact" (0 of 0
  // words matched) while any real attempt scored 0, a backwards result. Same invalid-shape
  // pattern as scoreReorder's malformed-submission case, just triggered by bad question data
  // instead of a bad submission.
  if (!correctWords.length) {
    return {
      score: 0,
      maxScore: 1,
      correct: false,
      invalid: true,
      feedback: ["This question has no answer key configured and cannot be scored."]
    };
  }
  const submittedWords = normalizeText(typeof answer === "string" ? answer : "").split(" ").filter(Boolean);
  // Same reasoning as scoreReorder: derive maxScore from the answer key's word count, never
  // from question.maxScore (defaults to 1 and would silently under-report otherwise).
  const maxScore = Math.max(1, correctWords.length);
  let matches = 0;
  for (let i = 0; i < correctWords.length; i++) if (submittedWords[i] === correctWords[i]) matches++;
  const exact = matches === correctWords.length && submittedWords.length === correctWords.length;
  return {
    score: matches,
    maxScore,
    correct: exact,
    feedback: [`${matches} of ${correctWords.length} words matched exactly (case and punctuation are ignored).`],
    studentAnswerText: typeof answer === "string" && answer.trim() ? answer.trim() : null,
    correctAnswerText: question.answer
  };
}
