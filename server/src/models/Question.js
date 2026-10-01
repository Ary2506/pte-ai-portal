import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  section: { type: String, enum: ["speaking", "writing", "reading", "listening"], required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  prompt: { type: String, required: true },
  passage: String,
  // What the audio says, word for word. Summarize Spoken Text reveals it on demand after
  // answering; Write From Dictation and the blank-filling types use it as the reference text.
  // Any question with audio may carry one, so it is not gated to a type.
  transcript: String,
  // The authored structure for types whose passage is more than a string — Fill in the Blanks
  // (prose interleaved with blanks) and Highlight Incorrect Words (per-word isIncorrect flags).
  // Deliberately stored as authored rather than as the render-ready shape: the client already
  // derives segments, blank answers and incorrect-word indices from exactly this array (see
  // practice/listeningData/shared.js), and freezing that derived shape into the database would
  // mean a rendering change could only be made by rewriting every stored question.
  content: mongoose.Schema.Types.Mixed,
  imageUrl: String,
  audioUrl: String,
  options: [String],
  answer: mongoose.Schema.Types.Mixed,
  explanation: String,
  difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
  // Optional, currently populated only by Speaking > Describe Image (Bar/Flow/Line/Map/Pic/Pie/
  // Table) to drive its own "My Type" filter dropdown. Deliberately separate from the existing
  // `subtype`/Core-Core-P filter mechanism in client/src/practice/Practice.jsx (that one is
  // reserved for Listening's bundled content) — left undefined for every other question.
  category: { type: String },
  // Optional, non-functional metadata — nothing filters or queries on this. Purely so a
  // deliberately uncategorized batch (e.g. Describe Image's "Core P" set, visible in "All" but
  // excluded from every category tab by having no `category`) stays identifiable as intentional,
  // instead of looking like more stray leftover content the way past uncategorized records have.
  sourceGroup: { type: String },
  // "objective" = deterministically graded server-side (right/wrong or partial credit).
  // "subjective" = needs AI or human judgement (speaking, essay, free-text summary).
  evaluationType: { type: String, enum: ["objective", "subjective"], required: true },
  maxScore: { type: Number, default: 1 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

// Every question list query (student practice fetch, admin list/filter, mock-test selection)
// filters on this exact combination — section+type to pick a task, active to exclude drafts.
questionSchema.index({ section: 1, type: 1, active: 1 });

export default mongoose.model("Question", questionSchema);
