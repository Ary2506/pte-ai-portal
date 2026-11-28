// m:ss for a recording's stored length, so a Play button can show how long a clip is before any of
// its audio has been loaded. Empty when the length is unknown.
export function fmtDuration(seconds) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return "";
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
