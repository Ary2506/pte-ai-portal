import writeFromDictationContent from "../../../content/listening/write-from-dictation/write_from_dictation.json";
import { normalizeSubtype, audioUrl } from "./shared.js";

export const writeDictationQuestions = Array.isArray(writeFromDictationContent)
  ? writeFromDictationContent.map(item => ({
      _id: String(item.id), section: "listening", type: "write-dictation", title: item.title,
      prompt: "Listen to the recording and write the sentence you hear.", audioUrl: audioUrl("write-from-dictation", item.audio?.src),
      transcript: item.audio?.transcript || "", answer: item.answer, subtype: normalizeSubtype(item.subtype), evaluationType: "objective", difficulty: "medium"
    }))
  : [];
