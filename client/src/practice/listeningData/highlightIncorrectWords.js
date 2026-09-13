import highlightIncorrectWordsContent from "../../../content/listening/highlight-incorrect-words/highlight_incorrect_words.json";
import { localListeningQuestion } from "./shared.js";

export const highlightIncorrectWordsQuestions = Array.isArray(highlightIncorrectWordsContent)
  ? highlightIncorrectWordsContent.map(item => localListeningQuestion(item, "highlight-incorrect-words", "highlight-incorrect-words"))
  : [];
