// Which listening tasks must never ship their transcript to the browser.
//
// For most audio tasks the transcript IS the answer key:
//   repeat-sentence           the sentence to say back
//   write-dictation           the sentence to type
//   fill-blanks-typed         contains every blanked word
//   highlight-incorrect-words shows exactly which words differ from the audio
//   select-missing-word       ends on the missing word
//   mcq-single (listening)    answers the comprehension question outright
//
// Sent with the question, any of these turns a listening task into a reading task, and is
// readable straight out of the network tab whatever the interface chooses to render. Each is
// compared server-side and revealed in the result instead.
//
// summarize-spoken-text is deliberately absent: you summarise that audio rather than transcribe
// it, so its transcript is a study aid and gives nothing away.
//
// Lives in its own module rather than in a route because two routes enforce it -- GET /questions
// and the mock test's question picker -- and a route importing another route is a circular import
// waiting to happen. The client mirrors this list in
// client/src/practice/listeningData/localTranscripts.js, which also has to stop its bundled
// content fallback from putting a stripped transcript straight back.
export const TRANSCRIPT_IS_ANSWER = new Set([
  "repeat-sentence",
  "write-dictation",
  "fill-blanks-typed",
  "highlight-incorrect-words",
  "select-missing-word",
  "mcq-single"
]);
