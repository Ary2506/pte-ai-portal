import Question from "./models/Question.js";
import { validateAndNormalizeQuestion } from "./validation/questionValidation.js";

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
// image, and a repeat-sentence question with no audio, stayed live in production.
//
// Originally this checked only 3 hard-coded type groups, so it silently missed every question
// type added since (respond-to-situation, select-missing-word, highlight-incorrect-words all
// require audioUrl; any type can in principle go structurally invalid, not just "missing media").
// Generalized to reuse validateAndNormalizeQuestion() — the exact same rules the real create/PUT/
// activate routes already enforce — against every active question, rather than maintaining a
// second, drifting list of "which types need what". A question is "broken" here precisely when
// the admin API would refuse to (re)activate it today; nothing new is invented.
//
// Idempotent — only ever touches documents that are currently active and fail that shared
// validation; never deletes, never touches anything else, and once deactivated a document won't
// match this query again. Kept as a full active-question scan (not scoped by type) is intentional
// so any future type/shape is covered automatically; deactivation is the same safe, reversible
// action a legacy no-media question always got here.
//
// The respond-to-situation exception that used to live here is gone: those 20 audio-less
// documents were the "real audio will be added later" content gap it was disclosing, and
// seedPhase18Content.js's CLIENT_RESPOND_TO_SITUATION_CANDIDATES batch is that audio. With no
// exception left, this sweep now covers respond-to-situation like every other type — the 20
// legacy documents fail ordinary "prompt-audio" shape validation (no audioUrl) and get
// deactivated (not deleted) the next time this runs, same as any other legacy broken-media
// question always has.
export async function deactivateLegacyBrokenMedia() {
  const activeQuestions = await Question.find({ active: true });
  const broken = activeQuestions.filter(q => validateAndNormalizeQuestion(q.toObject()).errors.length > 0);
  for (const q of broken) { q.active = false; await q.save(); }
  if (broken.length) console.log(`Deactivated ${broken.length} active question(s) that fail current validation rules.`);
}
