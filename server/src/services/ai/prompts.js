// Per-type task descriptions used to build the AI evaluation prompt. Adding a new subjective
// question type only requires a new entry here — evaluator.js and validate.js stay unchanged.
// criteriaKeys is deliberately task-specific, not the same fixed set for every task (Phase 16,
// B2): it is exactly the natural-language `criteria` string above, broken into short keys — never
// a criterion the task can't actually support. In particular, the speaking tasks omit grammar and
// vocabulary is included only where the free-composition content justifies it, and NONE of them
// include pronunciation/fluency-from-audio, because only a transcript (never audio) is ever
// analyzed — see evaluator.js's heuristic/AI note text and B6.
const TASK_INFO = {
  swt: {
    label: "Summarize Written Text",
    instructions: "The student must summarize a passage in exactly one sentence, 5-75 words.",
    criteria: "content accuracy relative to the passage, single-sentence form, grammar, vocabulary",
    criteriaKeys: ["content", "form", "grammar", "vocabulary"]
  },
  essay: {
    label: "Essay",
    instructions: "The student must discuss the essay prompt in a structured, well-developed written response.",
    criteria: "content relevance and development, organization/structure, grammar, vocabulary, written coherence",
    criteriaKeys: ["content", "form", "grammar", "vocabulary", "coherence"]
  },
  "summarize-spoken-text": {
    label: "Summarize Spoken Text",
    instructions: "The student summarizes the main idea of a short spoken passage, in their own words, based on a transcript of what they heard.",
    criteria: "content accuracy, form, grammar, vocabulary",
    criteriaKeys: ["content", "form", "grammar", "vocabulary"]
  },
  "read-aloud": {
    label: "Read Aloud",
    instructions: "The student read a given passage aloud. Only a transcript of their speech (not the audio) is available.",
    criteria: "content accuracy against the intended passage, and fluency signals inferable from the transcript and timing (never pronunciation — no audio is analyzed)",
    criteriaKeys: ["content", "fluency"]
  },
  "repeat-sentence": {
    label: "Repeat Sentence",
    instructions: "The student repeated a sentence they heard. Only a transcript of their speech (not the audio) is available.",
    criteria: "content accuracy against the intended sentence, and fluency signals inferable from the transcript and timing (never pronunciation — no audio is analyzed)",
    criteriaKeys: ["content", "fluency"]
  },
  "describe-image": {
    label: "Describe Image",
    instructions: "The student described an image scenario. Only a transcript of their speech (not the audio) is available.",
    criteria: "content relevance to the described scenario, fluency signals inferable from the transcript, vocabulary",
    criteriaKeys: ["content", "fluency", "vocabulary"]
  },
  "answer-short-question": {
    label: "Answer Short Question",
    instructions: "The student answered a short factual question. Only a transcript of their speech (not the audio) is available.",
    criteria: "correctness and relevance of the answer content",
    criteriaKeys: ["content"]
  },
  "respond-to-situation": {
    label: "Respond to a Situation",
    instructions: "The student heard a spoken situation and gave an appropriate verbal response. Only a transcript of their speech (not the audio) is available.",
    criteria: "appropriateness of the response to the situation, content relevance, fluency signals inferable from the transcript (never pronunciation — no audio is analyzed)",
    criteriaKeys: ["content", "fluency"]
  },
  "write-email": {
    label: "Write Email",
    instructions: "The student wrote an email responding to a given prompt/scenario, including appropriate tone and structure for email correspondence.",
    criteria: "content relevance and completeness, appropriate tone and register, organization/structure, grammar, vocabulary",
    criteriaKeys: ["content", "form", "grammar", "vocabulary"]
  }
};

export function taskInfoFor(type) {
  return TASK_INFO[type] || { label: type, instructions: "Evaluate the student's response to the task.", criteria: "content quality", criteriaKeys: ["content"] };
}

export function buildPrompt({ type, prompt, passage, response }) {
  const info = taskInfoFor(type);
  const criteriaShape = info.criteriaKeys.map(k => `"${k}": <integer 0-100>`).join(", ");
  const system = "You are a PTE Academic practice evaluator. You give constructive, consistent, honest feedback for self-study. You never claim to produce an official Pearson score, and you never invent metrics (such as pronunciation) that cannot be derived from the text you were given. Respond with JSON only.";
  const user = [
    `Task: ${info.label}`,
    `Task instructions: ${info.instructions}`,
    `Evaluation criteria to consider: ${info.criteria}`,
    prompt ? `Question prompt: ${prompt}` : null,
    passage ? `Source passage: ${passage}` : null,
    `Student response (transcript/text): ${response?.trim() ? response : "(no response text was captured)"}`,
    "",
    "Score the response from 0 to 90, the standard PTE communicative-skill scale, as a PRACTICE estimate only.",
    "Return JSON only, in exactly this shape:",
    '{"score": <integer 0-90>,',
    ` "criteria": {${criteriaShape}},`,
    '  "mistakes": [{"type": <one of "grammar"|"vocabulary"|"content"|"structure"|"form"|"coherence">, "studentText": "<short quote from the response>", "problem": "<what is wrong>", "correction": "<a corrected version>", "explanation": "<why, one short sentence>"}, ... up to 3],',
    '  "strengths": [<1-3 short strings>], "improvements": [<1-3 short strings>], "overall": "<one or two short sentences of actionable feedback>"}',
    `Only score the criteria listed above (${info.criteriaKeys.join(", ")}) — do not add any other criterion, and do not include a pronunciation score or any numeric sub-score you were not given the means to measure (you only have text, not audio).`,
    "If there are no clear mistakes to point out, return an empty mistakes array rather than inventing one."
  ].filter(Boolean).join("\n");
  return { system, user };
}
