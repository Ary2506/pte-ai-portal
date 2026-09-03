import OpenAI from "openai";
import { config } from "../../config.js";
import { buildPrompt, taskInfoFor } from "./prompts.js";
import { validateAiResult } from "./validate.js";

const MAX_SCORE = 90;
const HEURISTIC_NOTE = "Heuristic practice estimate based only on response length and structure — it does not analyze grammar, vocabulary, or (for speaking) pronunciation.";
const AI_NOTE = "AI practice evaluation based on your transcript/text — pronunciation and audio quality are not analyzed, since only text is available to the model.";

// No externally-verifiable signal exists here beyond word/sentence counts and response
// duration. Deliberately does NOT invent a pronunciation, fluency, or grammar sub-score —
// only one overall practice score plus qualitative, hedged feedback.
function heuristicEvaluate({ text = "" }) {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const sentences = Math.max(1, (text.match(/[.!?]/g) || []).length);
  const lengthScore = Math.min(25, Math.round(Math.min(words / 2, 25)));
  const structureScore = Math.min(25, Math.round(Math.min(sentences * 3, 25)));
  const score = Math.max(10, Math.min(MAX_SCORE, 45 + lengthScore + structureScore));

  const strengths = [];
  const improvements = [];
  if (words >= 30) strengths.push("Good response length with enough detail.");
  else improvements.push("Try to provide a fuller response with more relevant detail.");
  if (sentences >= 2) strengths.push("Response has more than one sentence, showing some structure.");
  else improvements.push("Try structuring your response into more than one sentence or idea.");
  if (!strengths.length) strengths.push("Response was submitted successfully.");

  return {
    evaluationStatus: "COMPLETED",
    scoringMethod: "heuristic",
    score,
    maxScore: MAX_SCORE,
    strengths,
    improvements,
    overall: "This is a heuristic practice estimate, not a language-quality analysis.",
    note: HEURISTIC_NOTE,
    // The heuristic path has no real language understanding (length/structure counts only) — it
    // must never fabricate a criteria breakdown or a mistake list it has no basis for.
    criteria: null,
    mistakes: []
  };
}

async function callOpenAi({ type, prompt, passage, text }) {
  const client = new OpenAI({ apiKey: config.openaiKey });
  const { system, user } = buildPrompt({ type, prompt, passage, response: text });
  const response = await client.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
  return JSON.parse(response.choices[0].message.content);
}

function failedResult(reason) {
  console.error("AI evaluation failed:", reason);
  return {
    evaluationStatus: "FAILED",
    scoringMethod: null,
    score: 0,
    maxScore: MAX_SCORE,
    strengths: [],
    improvements: [],
    overall: "AI feedback is temporarily unavailable. Your objective score (if any) is still valid.",
    note: null,
    criteria: null,
    mistakes: []
  };
}

// The single entry point for subjective (AI/heuristic) scoring. Missing OPENAI_API_KEY is a
// disclosed, intentional product default (heuristic) — not a failure. A configured key that
// then fails (timeout, rate limit, invalid response) is a real FAILED state: it is never
// silently masked as a heuristic result, so a genuine outage is visible instead of hidden.
export async function evaluateSubjective({ type, prompt, passage, text, durationSeconds }) {
  if (!config.openaiKey) {
    return heuristicEvaluate({ text, durationSeconds });
  }
  try {
    const raw = await callOpenAi({ type, prompt, passage, text });
    const criteriaKeys = taskInfoFor(type).criteriaKeys;
    const validated = validateAiResult(raw, MAX_SCORE, criteriaKeys);
    if (!validated.valid) return failedResult(`invalid structured response — ${validated.reason}`);
    return {
      evaluationStatus: "COMPLETED",
      scoringMethod: "ai",
      score: validated.score,
      maxScore: validated.maxScore,
      strengths: validated.strengths,
      improvements: validated.improvements,
      overall: validated.overall,
      note: AI_NOTE,
      criteria: validated.criteria,
      mistakes: validated.mistakes
    };
  } catch (error) {
    return failedResult(error.message);
  }
}
