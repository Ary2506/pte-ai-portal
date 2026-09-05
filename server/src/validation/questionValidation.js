import { QUESTION_TYPES } from "../questionTypes.js";

// Validates a full question shape (create, or an existing question merged with an update) and
// derives the fields that must never come from the client: evaluationType and maxScore.
// Returns { errors: string[], normalized: {...} }. If errors is non-empty, the caller must
// reject the request — never save a partially-invalid question.
export function validateAndNormalizeQuestion(input) {
  const errors = [];
  const type = input.type;
  const meta = type ? QUESTION_TYPES[type] : null;

  if (!type) errors.push("Question type is required.");
  else if (!meta) errors.push(`Unsupported question type "${type}".`);

  const section = input.section;
  if (!section) errors.push("Section is required.");
  else if (meta && !meta.sections.includes(section)) {
    errors.push(`Type "${type}" is not valid for section "${section}".`);
  }

  if (!input.title?.trim()) errors.push("Question title is required.");
  if (!input.prompt?.trim()) errors.push("Question prompt is required.");

  const normalized = {};
  if (!meta) return { errors, normalized };

  normalized.evaluationType = meta.evaluationType;

  if (meta.shape === "choice-single") {
    const options = input.options;
    if (!Array.isArray(options) || options.length < 2) errors.push("At least 2 options are required.");
    else if (options.some(o => typeof o !== "string" || !o.trim())) errors.push("Options cannot be empty.");
    if (!Number.isInteger(input.answer)) errors.push("A correct option must be selected.");
    else if (Array.isArray(options) && (input.answer < 0 || input.answer >= options.length)) {
      errors.push("The correct option is out of range.");
    }
    // mcq-single/fill-blanks serve both Reading (read the passage, no audio) and Listening (audio
    // is the passage) — same shape, but only the listening variant needs a clip to exist.
    if (section === "listening" && !input.audioUrl?.trim()) errors.push("An audio clip is required for a listening question.");
    normalized.maxScore = 1;
  } else if (meta.shape === "choice-multiple") {
    const options = input.options;
    if (!Array.isArray(options) || options.length < 3) errors.push("At least 3 options are required for a multiple-answer question.");
    const answer = input.answer;
    if (!Array.isArray(answer) || answer.length < 1) errors.push("At least one correct option is required.");
    else if (Array.isArray(options) && answer.some(a => !Number.isInteger(a) || a < 0 || a >= options.length)) {
      errors.push("Correct answers must be valid option positions.");
    }
    if (section === "listening" && !input.audioUrl?.trim()) errors.push("An audio clip is required for a listening question.");
    normalized.maxScore = Array.isArray(input.answer) ? new Set(input.answer).size : 1;
  } else if (meta.shape === "reorder") {
    const options = input.options;
    if (!Array.isArray(options) || options.length < 2) errors.push("At least 2 items are required to build a re-order question.");
    const answer = input.answer;
    if (!Array.isArray(options) || !Array.isArray(answer) || answer.length !== options.length) {
      errors.push("The correct order must include every item exactly once.");
    } else if (new Set(answer).size !== options.length) {
      errors.push("The correct order cannot repeat or omit an item.");
    } else if (answer.some(a => !Number.isInteger(a) || a < 0 || a >= options.length)) {
      errors.push("The correct order must reference valid item positions.");
    }
    normalized.maxScore = Array.isArray(options) ? Math.max(1, options.length - 1) : 1;
  } else if (meta.shape === "dictation") {
    if (typeof input.answer !== "string" || !input.answer.trim()) errors.push("The exact sentence is required as the answer for a dictation question.");
    if (!input.audioUrl?.trim()) errors.push("An audio URL is required for a dictation question.");
    normalized.maxScore = typeof input.answer === "string" && input.answer.trim() ? Math.max(1, input.answer.trim().split(/\s+/).length) : 1;
  } else if (meta.shape === "prompt-audio") {
    if (!input.audioUrl?.trim()) errors.push("An audio URL is required for this listening task.");
    normalized.maxScore = 90;
  } else if (meta.shape === "drag-fill") {
    // fill-blanks-dragdrop: `passage` carries the text with each blank marked "____"; `options`
    // is the draggable word pool (may include decoy words never used — real PTE drag-drop
    // questions commonly do); `answer` is one option-index per blank, in the order the blanks
    // appear in the passage (left to right). Deliberately NOT the reorder shape's semantics —
    // reorder requires every option used exactly once, but a decoy pool means options.length can
    // exceed the blank count, and the same word could legitimately be the answer for two blanks.
    const blankCount = (input.passage?.match(/____/g) || []).length;
    if (!input.passage?.trim()) errors.push("A passage with blanks is required.");
    else if (blankCount < 1) errors.push("The passage must contain at least one blank, marked with ____.");
    const options = input.options;
    if (!Array.isArray(options) || options.length < Math.max(2, blankCount)) {
      errors.push("There must be at least as many word options as blanks (at least 2 total).");
    }
    const answer = input.answer;
    if (!Array.isArray(answer) || answer.length !== blankCount) {
      errors.push("Exactly one correct word must be assigned to each blank.");
    } else if (Array.isArray(options) && answer.some(a => !Number.isInteger(a) || a < 0 || a >= options.length)) {
      errors.push("Each blank's answer must reference a valid word option.");
    }
    normalized.maxScore = Math.max(1, blankCount);
  } else if (meta.shape === "prompt-passage") {
    if (!input.passage?.trim()) errors.push("A source passage is required for this task.");
    normalized.maxScore = 90;
  } else if (meta.shape === "prompt-image") {
    // Describe Image has nothing to describe without a real image — this was previously
    // unenforced (Phase 18 audit), which is exactly how an active Describe Image question with
    // no image ever existed. Checked by type's own shape, not folded into the generic prompt-only
    // branch below, which other prompt-only types (Read Aloud, Essay, Answer Short Question)
    // must NOT be held to.
    if (!input.imageUrl?.trim()) errors.push("An image is required for a describe-image question.");
    normalized.maxScore = 90;
  } else if (type === "repeat-sentence") {
    // Same shape ("prompt-only") as Read Aloud/Essay/Answer Short Question, but this is the one
    // prompt-only type where the student listens to audio rather than reading the prompt
    // themselves — so, unlike its shape-mates, it genuinely needs a real audio clip before
    // activation.
    if (!input.audioUrl?.trim()) errors.push("An audio clip is required for a repeat-sentence question.");
    normalized.maxScore = 90;
  } else {
    normalized.maxScore = 90;
  }

  return { errors, normalized };
}
