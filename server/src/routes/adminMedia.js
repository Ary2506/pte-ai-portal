import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { ALLOWED_AUDIO_MIME, hasValidAudioSignature } from "./submissions.js";

// Admin-authored question media (images for describe-image, audio for the audio-prompt types)
// needs to be publicly viewable by every student, unlike student submission audio
// (routes/submissions.js), which is private and ownership-gated with no static mount at all.
// This is therefore a genuinely new, separate directory/mount — not a reuse of the private
// uploads/ dir, and not a write into client/public/ (the server process shouldn't need
// filesystem access into a separately-deployable client package). It reuses the same multer
// dependency and the same disk-storage-then-verify-magic-bytes pattern already established by
// submissions.js, including its exact audio allow-list/signature check.
const router = express.Router();
router.use(requireAuth, requireAdmin);

const MEDIA_ROOT = path.resolve("public/question-media");
const IMAGE_DIR = path.join(MEDIA_ROOT, "images");
const AUDIO_DIR = path.join(MEDIA_ROOT, "audio");
fs.mkdirSync(IMAGE_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

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

function mediaKindFor(mimetype) {
  if (ALLOWED_IMAGE_MIME_EXT[mimetype]) return "image";
  if (ALLOWED_AUDIO_MIME.has(mimetype)) return "audio";
  return null;
}

// Destination and filename never derive from the client-supplied original filename — a random,
// server-generated name (extension chosen from the verified mimetype, not the client's claimed
// extension) sidesteps path traversal and filename-collision risk entirely rather than trying to
// sanitize an attacker-controlled string.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, mediaKindFor(file.mimetype) === "image" ? IMAGE_DIR : AUDIO_DIR);
  },
  filename: (req, file, cb) => {
    const ext = ALLOWED_IMAGE_MIME_EXT[file.mimetype] || ALLOWED_AUDIO_MIME_EXT[file.mimetype] || "";
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  // Single global cap at the larger (audio) limit; the tighter per-kind image limit is enforced
  // after upload below, once the actual written file size is known.
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (req, file, cb) => {
    if (!mediaKindFor(file.mimetype)) return cb(new Error("UNSUPPORTED_MEDIA_TYPE"));
    cb(null, true);
  }
});

// Browser-supplied Content-Type is a first filter only — verified against the file's actual
// binary header after upload, same approach as submissions.js's audio check.
function hasValidImageSignature(filePath) {
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  if (bytesRead >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (bytesRead >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  if (bytesRead >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return true; // WebP
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

router.post("/upload", uploadMedia, (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file was uploaded.", code: "FILE_REQUIRED" });

  const kind = mediaKindFor(req.file.mimetype);
  const maxForKind = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (req.file.size > maxForKind) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({
      message: kind === "image" ? "Image is too large (max 8MB)." : "Audio file is too large (max 15MB).",
      code: "FILE_TOO_LARGE"
    });
  }

  const isValid = kind === "image" ? hasValidImageSignature(req.file.path) : hasValidAudioSignature(req.file.path);
  if (!isValid) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({
      message: "The uploaded file does not look like a valid file of its declared type.",
      code: "INVALID_FILE_SIGNATURE"
    });
  }

  // A relative, predictable path under the one public mount — never the file's real filesystem
  // location — turned into an absolute URL so it resolves correctly for a browser loading the
  // admin page from the client's own origin (a different port/host than this API server).
  const relativePath = `/media/questions/${kind === "image" ? "images" : "audio"}/${req.file.filename}`;
  const url = `${req.protocol}://${req.get("host")}${relativePath}`;
  res.status(201).json({ url, kind, filename: req.file.filename, mimetype: req.file.mimetype, size: req.file.size });
});

export default router;
