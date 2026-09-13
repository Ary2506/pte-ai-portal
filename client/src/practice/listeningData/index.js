import { summarizeSpokenTextQuestions } from "./summarizeSpokenText.js";
import { fillBlanksQuestions } from "./fillBlanks.js";
import { mcqSingleQuestions } from "./mcqSingle.js";
import { selectMissingWordQuestions } from "./selectMissingWord.js";
import { highlightIncorrectWordsQuestions } from "./highlightIncorrectWords.js";
import { writeDictationQuestions } from "./writeDictation.js";

// One array per listening question type (see the sibling files) concatenated in the same
// order Practice.jsx originally built LOCAL_LISTENING_QUESTIONS in — adding a new type means
// adding one file here plus one line in this list, without touching any existing type's file.
export const LOCAL_LISTENING_QUESTIONS = [
  ...summarizeSpokenTextQuestions,
  ...fillBlanksQuestions,
  ...mcqSingleQuestions,
  ...selectMissingWordQuestions,
  ...highlightIncorrectWordsQuestions,
  ...writeDictationQuestions,
];
