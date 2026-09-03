import Question from "./models/Question.js";

const questions = [
  {
    section: "speaking", type: "read-aloud", title: "Read Aloud",
    prompt: "The rapid advancement of technology has significantly transformed the way people communicate, work, and access information.",
    difficulty: "easy", evaluationType: "subjective"
  },
  {
    section: "speaking", type: "repeat-sentence", title: "Repeat Sentence",
    prompt: "The university library will remain open until midnight during the examination period.",
    difficulty: "medium", evaluationType: "subjective"
  },
  {
    section: "speaking", type: "describe-image", title: "Describe Image",
    prompt: "Describe a modern office meeting scene. Mention the people, workspace, technology, and overall atmosphere.",
    difficulty: "medium", evaluationType: "subjective"
  },
  {
    section: "speaking", type: "answer-short-question", title: "Answer Short Question",
    prompt: "What do we call the first meal of the day?",
    difficulty: "easy", evaluationType: "subjective"
  },
  {
    section: "writing", type: "swt", title: "Summarize Written Text",
    passage: "Online education has become increasingly popular because it offers flexibility and access to a wide range of courses. Students can learn at their own pace, but successful online learning also requires discipline, time management, and motivation.",
    prompt: "Write one sentence summarizing the passage in 5–75 words.",
    difficulty: "easy", evaluationType: "subjective"
  },
  {
    section: "writing", type: "essay", title: "Write Essay",
    prompt: "Some people believe technology makes life easier, while others believe it creates new problems. Discuss both views and give your opinion.",
    difficulty: "medium", evaluationType: "subjective"
  },
  {
    section: "reading", type: "mcq-single", title: "Multiple Choice",
    passage: "Renewable energy sources can reduce dependence on fossil fuels and help lower greenhouse gas emissions.",
    prompt: "What is one major benefit mentioned?",
    options: ["Higher fuel consumption", "Reduced dependence on fossil fuels", "More greenhouse gases", "Less access to energy"],
    answer: 1,
    explanation: "The passage directly states that renewable energy can reduce dependence on fossil fuels.",
    difficulty: "easy", evaluationType: "objective", maxScore: 1
  },
  {
    section: "reading", type: "fill-blanks", title: "Fill in the Blanks",
    passage: "Good study habits improve concentration and help learners manage their time more ____.",
    prompt: "Choose the best word.",
    options: ["effectively", "effect", "effective", "effects"],
    answer: 0,
    explanation: "The adverb 'effectively' correctly modifies the verb phrase 'manage their time'.",
    difficulty: "easy", evaluationType: "objective", maxScore: 1
  },
  {
    section: "reading", type: "reorder", title: "Re-order Paragraphs",
    prompt: "Arrange these ideas into a logical order.",
    options: [
      "Finally, the results were presented to the class.",
      "First, the students collected information from several sources.",
      "After that, they organized the information into categories.",
      "They then prepared a short presentation."
    ],
    answer: [1, 2, 3, 0],
    explanation: "The sequence follows first, after that, then, finally.",
    difficulty: "medium", evaluationType: "objective", maxScore: 3
  },
  {
    section: "listening", type: "summarize-spoken-text", title: "Summarize Spoken Text",
    prompt: "Listen to the short practice audio and summarize the main idea in your own words.",
    audioUrl: "https://cdn.pixabay.com/audio/2022/03/15/audio_1e8f1a1a4c.mp3",
    difficulty: "medium", evaluationType: "subjective"
  },
  {
    section: "listening", type: "write-dictation", title: "Write From Dictation",
    prompt: "Listen carefully and type the sentence you hear.",
    audioUrl: "https://cdn.pixabay.com/audio/2022/10/30/audio_946a8c9c4d.mp3",
    answer: "The meeting has been rescheduled to next Monday morning.",
    difficulty: "medium", evaluationType: "objective", maxScore: 8
  },
  {
    section: "listening", type: "mcq-single", title: "Multiple Choice",
    prompt: "Listen to the practice audio, then choose the statement that best matches what you heard.",
    audioUrl: "https://cdn.pixabay.com/audio/2022/03/15/audio_1e8f1a1a4c.mp3",
    options: ["The library is closing early today.", "The exam schedule has changed.", "The cafeteria is under renovation.", "Registration ends this Friday."],
    answer: 3,
    explanation: "Sample practice audio references a registration deadline this Friday.",
    difficulty: "medium", evaluationType: "objective", maxScore: 1
  }
];

export async function seedQuestions() {
  const count = await Question.countDocuments();
  if (!count) {
    await Question.insertMany(questions);
    console.log("Seeded practice questions");
  }
}
