import fillInTheBlanksContent from "../../../content/listening/fill-in-the-blanks/fill_in_the_blanks.json";
import { localListeningQuestion } from "./shared.js";

export const fillBlanksQuestions = Array.isArray(fillInTheBlanksContent)
  ? fillInTheBlanksContent.map(item => localListeningQuestion(item, "fill-in-the-blanks", "fill-blanks"))
  : [];
