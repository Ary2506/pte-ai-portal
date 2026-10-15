// Resolves a stored media value to something a browser can load.
//
// Three kinds of value reach an <img src> or <audio src> in this app, and they resolve to three
// different origins:
//
//   https://...                        an external CDN — a handful of seeded listening questions
//   /audio/..., /question-images/...    the static question bank, served by the client's own host
//   /media/questions/<kind>/<file>      admin-uploaded media, served by the API
//
// The last one is why this helper exists. The client and the API are different origins in
// production (the client on Vercel, the API on a Node host), so a root-relative path would resolve
// against the client and 404. Prefixing it here keeps the database free of hostnames: question
// rows store the path, and the deployment decides where it points.
//
// Values are NOT rewritten beyond that. An absolute URL is returned untouched — rewriting one
// would turn "https://cdn.example/clip.mp3" into a path under the API and break it.
// Resolved in apiBase.js, which also fails a production build when VITE_API_URL is unset.
import { API_ORIGIN } from "./apiBase.js";

export const ADMIN_MEDIA_PREFIX = "/media/questions/";

export function mediaUrl(value) {
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  if (value.startsWith(ADMIN_MEDIA_PREFIX)) return API_ORIGIN + value;
  return value;
}
