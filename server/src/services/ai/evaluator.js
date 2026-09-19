import OpenAI from "openai";
import { config } from "../../config.js";
import { buildPrompt, taskInfoFor } from "./prompts.js";
import { validateAiResult } from "./validate.js";

const MAX_SCORE = 90;
const HEURISTIC_NOTE = "Heuristic practice estimate based only on response length and structure — it does not analyze grammar, vocabulary, or (for speaking) pronunciation.";
const AI_NOTE = "AI practice evaluation based on your transcript/text — pronunciation and audio quality are not analyzed, since only text is available to the model.";

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
    criteria: null,
    mistakes: []
  };
}

async function callGroq({ type, prompt, passage, text }) {
  const client = new OpenAI({ 
    apiKey: config.openaiKey,
    baseURL: "https://api.groq.com/openai/v1"
  });
  
  let lastError;
  for (const model of config.openaiModels) {
    try {
      const { system, user } = buildPrompt({ type, prompt, passage, response: text });
      const response = await client.chat.completions.create({
        model: model.trim(),
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      });
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.warn(`Model ${model} failed, trying next...`);
      lastError = error;
    }
  }
  throw lastError;
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

export async function evaluateSubjective({ type, prompt, passage, text, durationSeconds }) {
  if (!config.openaiKey) {
    return heuristicEvaluate({ text, durationSeconds });
  }
  try {
    const raw = await callGroq({ type, prompt, passage, text });
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
