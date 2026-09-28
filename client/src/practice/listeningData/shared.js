// Base for every listening clip. Empty by default, so the files are served straight from
// client/public/audio/listening/ the same way the speaking clips already are. Point
// VITE_AUDIO_BASE at a CDN/object-store origin to serve them from there instead, without
// touching a call site.
const AUDIO_BASE = import.meta.env.VITE_AUDIO_BASE || "";

// A plain runtime string, deliberately NOT `new URL(..., import.meta.url)`. Vite cannot resolve
// that form statically when the path contains a variable, so it rewrites it into an
// import.meta.glob that eagerly pulls in every file matching the pattern — that was 129
// `?import&url` module requests on the listening page before a student had played anything.
// A bare string keeps the bundler out of the audio path entirely: the browser fetches a clip
// only when an <audio> element actually plays it, and the filenames stay stable across builds
// so far-future cache headers keep working after a deploy.
export function audioUrl(folder, src) {
  return `${AUDIO_BASE}/audio/listening/${folder}/${src}`;
}

export function normalizeOptions(options) {
  return (options || []).map(option => typeof option === "string" ? option : option.text);
}

export function normalizeChoiceAnswer(options, answer) {
  const index = (options || []).findIndex(option => option.id === answer);
  return index >= 0 ? index : answer;
}

export function normalizeSubtype(subtype) {
  return String(subtype || "").toLowerCase().replace(/_/g, " ");
}

export function localListeningQuestion(item, folder, type) {
  const options = normalizeOptions(item.options);
  const question = {
    _id: String(item.id),
    section: "listening",
    type,
    title: item.title,
    prompt: item.question || item.prompt || "Listen to the recording and answer the question.",
    audioUrl: audioUrl(folder, item.audio?.src),
    transcript: item.audio?.transcript || "",
    options,
    answer: normalizeChoiceAnswer(item.options, item.answer),
    subtype: normalizeSubtype(item.subtype),
    difficulty: item.subtype === "core" ? "medium" : "easy",
    evaluationType: type === "summarize-spoken-text" ? "subjective" : "objective",
  };

  if (type === "fill-blanks") {
    const blanks = (item.content || []).filter(part => part.type === "blank");
    question.passage = (item.content || []).map(part => part.type === "blank" ? "____" : (part.value || part.text || "")).join("");
    question.options = blanks.map(blank => blank.answer);
    question.localBlankAnswers = blanks.map(blank => blank.answer);
  }

  if (type === "highlight-incorrect-words") {
    // Preserves the full passage — plain text interleaved with each candidate word, in reading
    // order — instead of only the bare candidate words with no sentence context. Every word in
    // the passage is made clickable (not only the ones the content data marks as candidates), so
    // hover/click feedback is uniform across the whole paragraph; only the content data's own
    // `isIncorrect` words ever count as a correct answer to catch — every other word is just an
    // ordinary, always-wrong-if-picked word, exactly like a real decoy. A word segment's `index`
    // is assigned in one running sequence across the whole passage, and only the indexes that
    // were already real candidates feed options/localIncorrectIndexes/answer below, so scoring
    // and the selection state (toggle/multi) the scoring logic already uses are unchanged.
    let wordIndex = 0;
    const passageSegments = [];
    for (const part of item.content || []) {
      if (part.type === "word") {
        passageSegments.push({ type: "word", index: wordIndex, text: part.text, isIncorrect: !!part.isIncorrect, correction: part.answer || null });
        wordIndex += 1;
        continue;
      }
      // Split plain prose into whitespace-separated tokens so every word becomes an equally
      // clickable target; whitespace itself is kept as plain (non-interactive) text so the
      // passage still wraps and reads exactly like normal prose.
      const raw = part.value || part.text || "";
      for (const token of raw.split(/(\s+)/)) {
        if (token === "") continue;
        if (/^\s+$/.test(token)) {
          passageSegments.push({ type: "text", value: token });
        } else {
          passageSegments.push({ type: "word", index: wordIndex, text: token, isIncorrect: false, correction: null });
          wordIndex += 1;
        }
      }
    }
    question.passageSegments = passageSegments;
    question.options = passageSegments.filter(part => part.type === "word").map(part => part.text);
    question.localIncorrectIndexes = passageSegments.filter(part => part.type === "word" && part.isIncorrect).map(part => part.index);
    // The actual word the audio said in place of each incorrect one — used only to reveal what
    // was missed after submission (or via the Answer toggle), never sent anywhere or scored.
    question.localWordCorrections = passageSegments
      .filter(part => part.type === "word" && part.isIncorrect)
      .reduce((map, part) => { map[part.index] = part.correction; return map; }, {});
    question.answer = question.localIncorrectIndexes;
  }

  return question;
}
