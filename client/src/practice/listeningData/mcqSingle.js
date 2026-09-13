import multipleChoiceSingleContent from "../../../content/listening/multiple-choice-single/multiple_choice_single.json";
import { localListeningQuestion } from "./shared.js";

export const mcqSingleQuestions = Array.isArray(multipleChoiceSingleContent)
  ? multipleChoiceSingleContent.map(item => localListeningQuestion(item, "multiple-choice-single", "mcq-single"))
  : [localListeningQuestion(multipleChoiceSingleContent, "multiple-choice-single", "mcq-single")];
