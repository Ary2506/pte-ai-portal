import express from "express";
import multer from "multer";
import crypto from "crypto";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { asyncRoute } from "../utils/asyncRoute.js";
import { hasValidAudioSignature, isAllowedAudioMime, baseMime } from "./submissions.js";
import { putObject } from "../storage.js";

// Admin-authored question media (images for describe-image, audio for the audio-prompt types)
// needs to be viewable by every student, unlike student submission audio (routes/submissions.js),
// which is private and ownership-gated.
//
// These files used to be written to server/public/question-media/ with multer.diskStorage and
// served by an express.static mount. That is the same ephemeral-filesystem bug that lost four
// student recordings: a container's disk does not survive a deploy, so admin uploads vanished at
// the next release while the question rows went on pointing at them. They now go to object
// storage, and routes/questionMedia.js serves them back.
const router = express.Router();
router.use(requireAuth, requireAdmin);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};
const ALLOWED_AUDIO_MIME_EXT = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac"
};

// Compared on the base media type, since a browser-supplied Content-Type may carry parameters
// (e.g. "audio/webm;codecs=opus"). Matching the raw string would reject a legitimate upload.
function mediaKindFor(mimetype) {
  if (ALLOWED_IMAGE_MIME_EXT[baseMime(mimetype)]) return "image";
  if (isAllowedAudioMime(mimetype)) return "audio";
  return null;
}

// The object key never derives from the client-supplied filename — a random, server-generated name
// with an extension chosen from the verified mimetype sidesteps path traversal and collisions
// entirely rather than trying to sanitize an attacker-controlled string.
const upload = multer({
  storage: multer.memoryStorage(),
  // Single global cap at the larger (audio) limit; the tighter per-kind image limit is enforced
  // below, once the actual size is known.
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!mediaKindFor(file.mimetype)) return cb(new Error("UNSUPPORTED_MEDIA_TYPE"));
    cb(null, true);
  }
});

// Browser-supplied Content-Type is a first filter only — verified against the file's actual binary
// header, same approach as submissions.js's audio check, and on the buffer rather than a written
// file so a rejected upload never becomes an object.
export function hasValidImageSignature(head) {
  if (!head || head.length < 3) return false;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true; // JPEG
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  if (head.length >= 12 && head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP") return true; // WebP
  return false;
}

function uploadMedia(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "File is too large.", code: "FILE_TOO_LARGE" });
    }
    if (err.message === "UNSUPPORTED_MEDIA_TYPE") {
      return res.status(400).json({
        message: "Unsupported file type. Only JPEG/PNG/WebP images or WebM/OGG/WAV/MP3/M4A/AAC audio are accepted.",
        code: "UNSUPPORTED_MEDIA_TYPE"
      });
    }
    return res.status(400).json({ message: "Upload failed.", code: "UPLOAD_ERROR" });
  });
}

router.post("/upload", uploadMedia, asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file was uploaded.", code: "FILE_REQUIRED" });

  const kind = mediaKindFor(req.file.mimetype);
  const maxForKind = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (req.file.size > maxForKind) {
    return res.status(400).json({
      message: kind === "image" ? "Image is too large (max 8MB)." : "Audio file is too large (max 15MB).",
      code: "FILE_TOO_LARGE"
    });
  }

  const isValid = kind === "image"
    ? hasValidImageSignature(req.file.buffer.subarray(0, 16))
    : hasValidAudioSignature(req.file.buffer.subarray(0, 12));
  if (!isValid) {
    return res.status(400).json({
      message: "The uploaded file does not look like a valid file of its declared type.",
      code: "INVALID_FILE_SIGNATURE"
    });
  }

  const type = baseMime(req.file.mimetype);
  const ext = ALLOWED_IMAGE_MIME_EXT[type] || ALLOWED_AUDIO_MIME_EXT[type] || "";
  const folder = kind === "image" ? "images" : "audio";
  const filename = `${crypto.randomUUID()}${ext}`;
  const key = `question-media/${folder}/${filename}`;

  try {
    await putObject(key, req.file.buffer, req.file.mimetype);
  } catch (err) {
    console.error("[adminMedia] upload to object storage failed:", err?.message || err);
    return res.status(503).json({
      message: "The file could not be saved. Please try again.",
      code: "MEDIA_UPLOAD_FAILED"
    });
  }

  // A root-relative path, never an absolute URL built from req.get("host"). The previous version
  // returned "http://<request host>/media/questions/..." and that value was written into question
  // rows, so anything uploaded in development baked "localhost:5000" into the database. The client
  // resolves this path against its configured API origin (client/src/mediaUrl.js).
  res.status(201).json({
    url: `/media/questions/${folder}/${filename}`,
    kind,
    filename,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
}));

export default router;
