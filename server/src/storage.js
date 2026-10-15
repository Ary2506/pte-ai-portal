// server/src/storage.js
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Where uploaded files live.
//
// In production that is Cloudflare R2: a container filesystem does not survive a deploy, so every
// file written to local disk was lost at the next release while the database row went on pointing
// at it.
//
// Two kinds of object share this module, separated by key prefix rather than by bucket. They have
// the same durability problem and the same access pattern, so one bucket with two prefixes is
// simpler than two buckets with duplicated configuration:
//
//   recordings/<userId>/...         private  - student voice data, owner-gated, short signed URLs
//   question-media/<kind>/...       public   - admin-authored question images and audio
//
// "Public" here means the same thing it meant when question media sat behind express.static: the
// app will hand the bytes to anyone who asks for that key. The bucket itself stays private either
// way -- only this server can mint a signature.
//
// With no R2 credentials configured the module falls back to the local filesystem, so the server
// still runs for development and tests without cloud credentials. That fallback must never be what
// production uses, which is what assertStorageConfigured() at the bottom is for.
const BUCKET = process.env.R2_BUCKET || process.env.R2_RECORDINGS_BUCKET;
const REQUIRED_CREDENTIALS = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];

/** True when objects go to R2, false when they go to the local disk fallback. */
export const isRemoteStorage =
  REQUIRED_CREDENTIALS.every(name => Boolean(process.env[name])) && Boolean(BUCKET);

// Question media keeps its own local root because it used to be served by a static mount from
// server/public/question-media -- the same files, the same paths, so the local fallback keeps
// working on a checkout that has them.
const QUESTION_MEDIA_PREFIX = "question-media/";
const RECORDINGS_ROOT = path.resolve("uploads");
const PUBLIC_ROOT = path.resolve("public");

const r2 = isRemoteStorage
  ? new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    })
  : null;

/**
 * Where a key sits on the local disk.
 *
 * Handles the three key shapes in play: a question-media key ("question-media/images/<file>",
 * rooted at server/public), a full recording key ("recordings/<userId>/<file>"), and the bare
 * filename that recordings written before the move to object storage still carry.
 */
export function localObjectPath(key) {
  const isQuestionMedia = key.startsWith(QUESTION_MEDIA_PREFIX);
  const root = isQuestionMedia ? PUBLIC_ROOT : RECORDINGS_ROOT;
  const relative = isQuestionMedia || key.includes("/") ? key : path.basename(key);
  const full = path.resolve(root, relative);
  // Keys are server-generated, but resolve anyway: nothing outside the intended root is reachable.
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new Error("Refusing an object path outside its storage root");
  }
  return full;
}

// Objects here are immutable: a new recording or a replacement image gets a new UUID key, so a
// given key's bytes never change. That makes them safe to cache for a long time, which matters
// because the browser fetches them straight from R2 and every re-fetch is a billed Class B read.
// Set at upload time because the header travels with the object, not with the signed URL.
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export async function putObject(key, body, contentType) {
  if (!isRemoteStorage) {
    const full = localObjectPath(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    return key;
  }
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: IMMUTABLE_CACHE
  }));
  return key;
}

/**
 * A signed URL for one read.
 *
 * The default is deliberately short: a recording link is for a single playback, not a shareable
 * asset. Question media passes a longer window because every student loads the same objects and a
 * fresh signature per question would be pure overhead.
 */
export function signedObjectUrl(key, seconds = 300) {
  if (!isRemoteStorage) throw new Error("signedObjectUrl requires R2; local storage serves the file directly");
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: seconds });
}

// Confirms an object is really there. Used by the migration scripts before they repoint a row:
// without it a silent upload failure would leave a row pointing at a key that does not exist, and
// the file on disk would look safe to delete.
export async function objectExists(key) {
  if (!isRemoteStorage) return fs.existsSync(localObjectPath(key));
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

// The recording-specific names this module started with. Recordings are the majority of its
// traffic and the call sites read better for keeping them, but they are now the generic functions.
export const localRecordingPath = localObjectPath;
export const putRecording = putObject;
export const signedRecordingUrl = signedObjectUrl;
export const recordingExists = objectExists;

/**
 * Called at boot. Production must never run on the local fallback: it would accept uploads, report
 * success, and lose them at the next deploy -- the exact failure this module exists to prevent,
 * except silent.
 */
export function assertStorageConfigured() {
  if (isRemoteStorage) return;
  const missing = REQUIRED_CREDENTIALS.filter(name => !process.env[name]);
  if (!BUCKET) missing.push("R2_BUCKET");
  const message = `Object storage is not configured. Missing: ${missing.join(", ")}`;
  if (process.env.NODE_ENV === "production") throw new Error(message);
  console.warn(`[storage] ${message}. Falling back to local disk -- development only.`);
}
