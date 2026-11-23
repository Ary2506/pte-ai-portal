// How long a student's own recording stays playable.
//
// The files are deleted by an R2 lifecycle rule on the recordings/ prefix, not by this app. This
// only mirrors that rule (config.recordingRetentionDays) so a recording is no longer offered —
// listed, played or shared — once its file is due to be gone, instead of showing a player that
// fails. R2 deletes an object at some point after it reaches the age, never before, so treating it
// as gone at exactly that age is on the safe side.
import { config } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The days a recording is kept, or 0 when recordings are never deleted. */
export const recordingRetentionDays = () => config.recordingRetentionDays;

/** Recordings made before this moment are gone, or null when nothing expires. */
export function recordingCutoff(now = new Date()) {
  const days = recordingRetentionDays();
  return days > 0 ? new Date(now.getTime() - days * DAY_MS) : null;
}

/** When this recording stops being available, or null when it never does. */
export function recordingAvailableUntil(createdAt) {
  const days = recordingRetentionDays();
  return days > 0 && createdAt ? new Date(new Date(createdAt).getTime() + days * DAY_MS) : null;
}

/** Whether a recording made at `createdAt` is still kept. */
export function isRecordingRetained(createdAt, now = new Date()) {
  const until = recordingAvailableUntil(createdAt);
  return !until || until > now;
}
