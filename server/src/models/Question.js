import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  section: { type: String, enum: ["speaking", "writing", "reading", "listening"], required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  prompt: { type: String, required: true },
  passage: String,
  imageUrl: String,
  audioUrl: String,
  options: [String],
  answer: mongoose.Schema.Types.Mixed,
  explanation: String,
  difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
  // "objective" = deterministically graded server-side (right/wrong or partial credit).
  // "subjective" = needs AI or human judgement (speaking, essay, free-text summary).
  evaluationType: { type: String, enum: ["objective", "subjective"], required: true },
  maxScore: { type: Number, default: 1 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model("Question", questionSchema);
