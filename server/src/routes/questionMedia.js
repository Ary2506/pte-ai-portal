import express from "express";
import fs from "fs";
import { isRemoteStorage, signedObjectUrl, localObjectPath } from "../storage.js";
import { asyncRoute } from "../utils/asyncRoute.js";

// Serves admin-authored question media (routes/adminMedia.js writes it).
//
// This replaces an express.static mount on server/public/question-media. It keeps the same URL
// shape -- /media/questions/<kind>/<file> -- so every question row that already stores such a path
// keeps working without a data migration.
//
// Deliberately NOT behind requireAuth, for a mechanical reason as much as a policy one: the client
// renders these as <img src> and <audio src>, and a browser cannot attach an Authorization header
// to either. Auth here would not be a stricter version of the static mount it replaces, it would
// simply break every question image. The content is the question bank itself, which every signed-in
// student sees anyway, and filenames are server-generated UUIDs rather than anything guessable.
//
// Student recordings are the opposite case and are handled the opposite way: private, owner-gated,
// and fetched through the API with a bearer token (routes/submissions.js).
const router = express.Router();

const KINDS = new Set(["images", "audio"]);
// Filenames are UUID + extension. Anything else is not something this route ever wrote, so there
// is no reason to look for it -- and it keeps "..", separators and encoded traversal out of the key.
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// An hour. Long enough that a student working through a section does not re-sign the same object
// repeatedly, short enough that a leaked link is not permanent.
const SIGNED_URL_SECONDS = 60 * 60;

router.get("/:kind/:file", asyncRoute(async (req, res) => {
  const { kind, file } = req.params;
  if (!KINDS.has(kind) || !SAFE_FILENAME.test(file) || file.includes("..")) {
    return res.status(404).json({ message: "Not found.", code: "MEDIA_NOT_FOUND" });
  }

  const key = `question-media/${kind}/${file}`;

  if (!isRemoteStorage) {
    let full;
    try {
      full = localObjectPath(key);
    } catch {
      return res.status(404).json({ message: "Not found.", code: "MEDIA_NOT_FOUND" });
    }
    if (!fs.existsSync(full)) {
      return res.status(404).json({ message: "Not found.", code: "MEDIA_NOT_FOUND" });
    }
    res.set("Cache-Control", `public, max-age=${SIGNED_URL_SECONDS}`);
    return res.sendFile(full);
  }

  try {
    const url = await signedObjectUrl(key, SIGNED_URL_SECONDS);
    // Cached for the life of the signature, not longer: a browser that held the redirect past
    // expiry would follow it to a URL R2 refuses.
    res.set("Cache-Control", `public, max-age=${SIGNED_URL_SECONDS}`);
    return res.redirect(302, url);
  } catch (err) {
    console.error("[questionMedia] could not sign a URL:", err?.message || err);
    return res.status(503).json({ message: "Media is temporarily unavailable.", code: "MEDIA_UNAVAILABLE" });
  }
}));

export default router;
