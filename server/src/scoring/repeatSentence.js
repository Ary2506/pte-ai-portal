// Repeat Sentence: the student heard an audio clip and repeated it. The expected sentence is the
// verified transcript OF THAT AUDIO (question.transcript) — nothing else, and in particular never a
// reference answer from a source PDF. The student's speech arrives as text, so what is compared is
// words, not sound: pronunciation and fluency cannot be measured here, and the feedback says so.
//
// This is deterministic on purpose. A word-level alignment states exactly which words were
// missing, extra or substituted — facts a language model can paraphrase or get wrong — and it
// costs nothing per submission.

const MAX_SCORE = 90;

// US/UK spelling pairs. Browser speech recognition emits US spelling regardless of how the
// reference was written, and a student must not lose marks for a spelling nobody spoke.
const SPELLING = {
  centre: "center", licence: "license", travelling: "traveling", organised: "organized",
  colour: "color", favour: "favor", programme: "program", metre: "meter", grey: "gray"
};

// Words that sound identical, so a transcript cannot distinguish them and the student cannot be
// faulted for either. Each group maps to its first member.
const HOMOPHONES = [["brice", "bryce"]];
const HOMOPHONE_CANON = new Map(HOMOPHONES.flatMap(group => group.map(word => [word, group[0]])));

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function numberWords(n) {
  if (n < 20) return [ONES[n]];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 ? [tens, ONES[n % 10]] : [tens];
}

/**
 * Lower-cases, drops punctuation, collapses whitespace, and maps equivalent spellings onto one
 * form: "10" and "ten" both become "ten". Applied identically to the expected and the spoken
 * text, so equivalence is symmetric. Numbers above 99 are left alone rather than half-converted.
 */
export function normalizeForRepeatSentence(text) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map(token => token.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
  const out = [];
  for (const token of tokens) {
    if (/^\d{1,2}$/.test(token)) out.push(...numberWords(Number(token)));
    else out.push(HOMOPHONE_CANON.get(SPELLING[token] ?? token) ?? SPELLING[token] ?? token);
  }
  return out;
}

/** Classic LCS table; sentences are a dozen words, so O(n*m) is nothing. */
function lcsTable(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table;
}

/** Walks the LCS table back into ordered edits: match / missing (expected only) / extra (spoken only). */
function align(expected, spoken) {
  const table = lcsTable(expected, spoken);
  const ops = [];
  let i = expected.length, j = spoken.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === spoken[j - 1]) { ops.push({ op: "match", word: expected[i - 1] }); i--; j--; }
    else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) { ops.push({ op: "extra", word: spoken[j - 1] }); j--; }
    else { ops.push({ op: "missing", word: expected[i - 1] }); i--; }
  }
  return ops.reverse();
}

/** Adjacent missing+extra runs are a substitution, which reads far better than two separate errors. */
function groupEdits(ops) {
  const edits = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === "match") { k++; continue; }
    const missing = [], extra = [];
    while (k < ops.length && ops[k].op !== "match") { (ops[k].op === "missing" ? missing : extra).push(ops[k].word); k++; }
    edits.push({ missing, extra });
  }
  return edits;
}

const quote = words => `"${words.join(" ")}"`;

export function scoreRepeatSentence(expectedText, spokenText) {
  const expected = normalizeForRepeatSentence(expectedText);
  const spoken = normalizeForRepeatSentence(spokenText);
  const ops = align(expected, spoken);
  const matched = ops.filter(o => o.op === "match").length;
  const edits = groupEdits(ops);

  // Penalises both directions: dropping words and padding with extras each lower the ratio.
  const denominator = Math.max(expected.length, spoken.length, 1);
  const accuracy = matched / denominator;
  const score = Math.round(accuracy * MAX_SCORE);

  const mistakes = edits.slice(0, 3).map(({ missing, extra }) => {
    if (missing.length && extra.length) {
      return { type: "content", studentText: extra.join(" "), problem: `You said ${quote(extra)} instead of ${quote(missing)}.`,
        correction: missing.join(" "), explanation: "A different word was repeated from the one in the recording." };
    }
    if (missing.length) {
      return { type: "content", studentText: "", problem: `You left out ${quote(missing)}.`,
        correction: missing.join(" "), explanation: "Every word in the sentence counts, so omissions lower the score." };
    }
    return { type: "content", studentText: extra.join(" "), problem: `You added ${quote(extra)}, which was not in the sentence.`,
      correction: "", explanation: "Extra words that were not in the recording lower the score." };
  });

  const missingCount = ops.filter(o => o.op === "missing").length;
  const extraCount = ops.filter(o => o.op === "extra").length;
  const strengths = [], improvements = [];
  if (!spoken.length) improvements.push("No speech was captured. Check your microphone and try again.");
  else if (!edits.length) strengths.push("Every word was repeated correctly and in the right order.");
  else {
    if (matched) strengths.push(`${matched} of ${expected.length} words were repeated correctly.`);
    if (missingCount) improvements.push(`${missingCount} word${missingCount > 1 ? "s were" : " was"} missing — listen again and try to hold the whole sentence in mind before speaking.`);
    if (extraCount) improvements.push(`${extraCount} extra or different word${extraCount > 1 ? "s were" : " was"} added — repeat only what you hear.`);
  }

  return {
    score,
    maxScore: MAX_SCORE,
    accuracy,
    matched,
    expectedWords: expected.length,
    missingCount,
    extraCount,
    overall: !spoken.length
      ? "Nothing was recognised from your recording."
      : !edits.length
        ? "Perfect repetition — the sentence matches the recording word for word."
        : `You repeated ${matched} of ${expected.length} words correctly (${Math.round(accuracy * 100)}% accuracy).`,
    criteria: { content: Math.round(accuracy * 100) },
    strengths,
    improvements,
    mistakes
  };
}
