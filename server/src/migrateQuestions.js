import Question from "./models/Question.js";

const OBJECTIVE_TYPES = new Set(["mcq-single", "mcq-multiple", "fill-blanks", "reorder", "write-dictation"]);

// Backfills evaluationType/maxScore on questions seeded before Phase 3 introduced those fields.
// Idempotent — only touches documents missing evaluationType.
export async function migrateQuestions() {
  const legacy = await Question.find({ evaluationType: { $exists: false } });
  for (const q of legacy) {
    q.evaluationType = OBJECTIVE_TYPES.has(q.type) ? "objective" : "subjective";
    if (q.type === "reorder" && Array.isArray(q.answer)) q.maxScore = Math.max(1, q.answer.length - 1);
    await q.save();
  }
  if (legacy.length) console.log(`Migrated ${legacy.length} question(s) to the objective/subjective scoring model.`);
}

// Phase 18 added a media-required check to validateAndNormalizeQuestion() (describe-image needs
// an image, repeat-sentence/listening mcq/dictation/summarize-spoken-text need audio), but that
// only guards *new* creates and reactivations — it can't retroactively fix documents that were
// already active before the check existed. This is exactly how a describe-image question with no
// image, and a repeat-sentence question with no audio, stayed live in production. Idempotent —
// only touches documents that are both active and missing their required media; never deletes,
// never touches anything else, and once deactivated a document won't match this query again.
export async function deactivateLegacyBrokenMedia() {
  const brokenImage = await Question.find({ type: "describe-image", active: true, $or: [{ imageUrl: { $exists: false } }, { imageUrl: "" }] });
  const brokenAudio = await Question.find({
    type: { $in: ["repeat-sentence", "summarize-spoken-text", "write-dictation"] },
    active: true, $or: [{ audioUrl: { $exists: false } }, { audioUrl: "" }]
  });
  const brokenListeningMcq = await Question.find({
    section: "listening", type: { $in: ["mcq-single", "mcq-multiple"] },
    active: true, $or: [{ audioUrl: { $exists: false } }, { audioUrl: "" }]
  });
  const broken = [...brokenImage, ...brokenAudio, ...brokenListeningMcq];
  for (const q of broken) { q.active = false; await q.save(); }
  if (broken.length) console.log(`Deactivated ${broken.length} legacy active question(s) missing required media.`);
}
