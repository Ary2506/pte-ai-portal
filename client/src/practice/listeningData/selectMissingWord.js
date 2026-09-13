import selectMissingWordContent from "../../../content/listening/select-missing-words/select_missing_words.json";
import { localListeningQuestion } from "./shared.js";

export const selectMissingWordQuestions = Array.isArray(selectMissingWordContent)
  ? selectMissingWordContent.map(item => localListeningQuestion(item, "select-missing-words", "select-missing-word"))
  : [localListeningQuestion(selectMissingWordContent, "select-missing-words", "select-missing-word")];
