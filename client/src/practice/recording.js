// Shared MediaRecorder settings for every task that records the student's voice (Read Aloud and
// the Speaking tasks). Kept in one place deliberately: if the two call sites drifted apart, the
// same spoken answer would upload at different sizes depending on which task produced it.

// The browser default is roughly 128 kbps, which is tuned for music rather than a single voice
// close to a microphone. Speech stays fully intelligible at 24 kbps — both for the AI scorer and
// for a student replaying their own answer — at about a fifth of the bytes. That ratio is what
// keeps a full cohort's recordings inside a free object-storage tier rather than well past it.
//
// Deliberately NOT applied to listening question audio (public/audio/listening/**), which is a
// comprehension exercise: degrading that audio would make the task harder than the real exam,
// which is a content-validity problem, not just a smaller file.
export const RECORDER_OPTIONS = { audioBitsPerSecond: 24000 };
