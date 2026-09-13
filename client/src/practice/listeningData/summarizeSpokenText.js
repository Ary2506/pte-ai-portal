import summarizeSpokenTextContent from "../../../content/listening/summarize-spoken-text/summarize_spoken_text.json";
import { normalizeSubtype } from "./shared.js";

export const summarizeSpokenTextQuestions = Array.isArray(summarizeSpokenTextContent)
  ? summarizeSpokenTextContent.map((item) => ({
      _id: String(item.id),
      section: "listening",
      type: "summarize-spoken-text",
      title: item.title,
      prompt: "Listen to the short practice audio and summarize the main idea in your own words.",
      audioUrl: new URL(`../../../content/listening/summarize-spoken-text/${item.audio.src}`, import.meta.url).href,
      transcript: item.transcript,
      subtype: normalizeSubtype(item.subtype),
      difficulty: item.subtype === "core" ? "medium" : "easy",
      evaluationType: "subjective",
    }))
  : [];
