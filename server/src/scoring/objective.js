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
    correctAnswerText: [...correctSet].map(i => optionText(question.options, i)).filter(Boolean).join(", ") || null,
    // The positions behind correctAnswerText, in the same order. Highlight Incorrect Words marks
    // the right words inline in the passage, which needs indices rather than a joined string, and
    // the question itself cannot supply them: its answer key is withheld from the browser until
    // the attempt has been scored.
    correctIndexes: [...correctSet]
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

// fill-blanks-dragdrop: `question.answer` is one option-index per blank, in passage order.
// `answer` (the submission) must be the same shape — one option-index per blank. Unlike
// scoreReorder, there is no "every item used exactly once" constraint (the same word can
// legitimately fill two blanks, and decoy words are expected to go unused), so this scores each
// blank position independently rather than checking a permutation.
export function scoreFillDrag(question, answer) {
  const correct = Array.isArray(question.answer) ? question.answer : [];
  const submitted = Array.isArray(answer) ? answer.map(Number) : null;
  const maxScore = Math.max(1, correct.length);

  const validShape = submitted && submitted.length === correct.length;
  if (!validShape) {
    return {
      score: 0,
      maxScore,
      correct: false,
      invalid: true,
      feedback: ["Submitted answer was invalid — every blank must have a word assigned."]
    };
  }

  let matches = 0;
  for (let i = 0; i < correct.length; i++) if (submitted[i] === correct[i]) matches++;
  const exact = matches === correct.length;
  const wordsText = arr => arr.map(i => optionText(question.options, i)).filter(Boolean).join(", ") || null;
  return {
    score: matches,
    maxScore,
    correct: exact,
    feedback: [exact ? "All blanks filled correctly!" : `${matches} of ${correct.length} blanks were filled correctly.`, question.explanation].filter(Boolean),
    studentAnswerText: wordsText(submitted),
    correctAnswerText: wordsText(correct)
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

// Listening's Fill in the Blanks: the student types a word into each blank, rather than picking
// from options the way Reading's same-named task does. That difference is why it needs its own
// scorer — routed through scoreSingleChoice it would compare an array of typed words against a
// single option index and mark every attempt wrong.
//
// `question.answer` is the correct word per blank, in passage order. Partial credit per blank,
// matching how every other multi-part objective task here scores.
export function scoreTypedBlanks(question, answer) {
  const correct = Array.isArray(question.answer) ? question.answer : [];
  if (!correct.length) {
    return {
      score: 0,
      maxScore: 1,
      correct: false,
      invalid: true,
      feedback: ["This question has no answer key configured and cannot be scored."]
    };
  }
  const submitted = Array.isArray(answer) ? answer : [];
  const maxScore = Math.max(1, correct.length);
  // Compared through the same normalizer scoreDictation uses, so capitalisation and trailing
  // punctuation never cost a student a blank they actually got right.
  let score = 0;
  for (let i = 0; i < correct.length; i += 1) {
    if (normalizeText(submitted[i]) && normalizeText(submitted[i]) === normalizeText(correct[i])) score += 1;
  }
  return {
    score,
    maxScore,
    correct: score === maxScore,
    feedback: [
      score === maxScore
        ? "All blanks are correct."
        : `${score} of ${maxScore} blanks are correct.`
    ],
    correctAnswerText: correct.join(", ")
  };
}

// Highlight Incorrect Words scores exactly like a multi-select — the displayed words are the
// options, the wrong ones are the correct selections — so it delegates rather than duplicating
// that. What it adds is the correction for each wrong word: the passage shows "came" where the
// recording said "returned", and showing the student only "came" back tells them nothing they
// could not already see. That pairing lives in the authored `content` array, which is why this
// needs the question rather than just the option list.
export function scoreHighlightIncorrectWords(question, answer) {
  const result = scoreMultipleChoice(question, answer);
  const corrections = {};
  let wordIndex = 0;
  for (const part of question.content || []) {
    if (part?.type === "word") {
      if (part.isIncorrect && part.answer) corrections[wordIndex] = part.answer;
      wordIndex += 1;
      continue;
    }
    // Plain prose is tokenised the same way the client splits it, so the running index stays in
    // step with the word positions the student actually clicked.
    const raw = part?.value || part?.text || "";
    for (const token of raw.split(/(\s+)/)) {
      if (token === "" || /^\s+$/.test(token)) continue;
      wordIndex += 1;
    }
  }
  return { ...result, corrections };
}
