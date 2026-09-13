export function audioUrl(folder, src) {
  return new URL(`../../../content/listening/${folder}/${src}`, import.meta.url).href;
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
    question.options = (item.content || []).filter(part => part.type === "word").map(part => part.text);
    question.localIncorrectIndexes = (item.content || []).reduce((indexes, part) => {
      if (part.type === "word" && part.isIncorrect) indexes.push(indexes.wordCount || 0);
      if (part.type === "word") indexes.wordCount = (indexes.wordCount || 0) + 1;
      return indexes;
    }, []).filter(value => typeof value === "number");
    question.answer = question.localIncorrectIndexes;
  }

  return question;
}
