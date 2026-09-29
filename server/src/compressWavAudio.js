import fs from "fs";
import path from "path";
// The maintained fork. The original `lamejs` npm package throws "MPEGMode is not defined" at
// encode time — its build drops internal globals the encoder depends on.
import lamejs from "@breezystack/lamejs";

// One-off: the 23 question clips under client/public/audio that shipped as uncompressed WAV.
// They are 24kHz 16-bit *stereo* PCM — stereo for a single speaking voice is pure waste — and at
// ~1.6MB each they are 63% of all the static media this app serves, against a 136KB average for
// the 144 clips that are already MP3.
//
// Target is 48 kbps mono at 24kHz: not a new, lower standard, but the exact encoding every other
// clip in the project already uses. The source is lossless, so this is a first-generation encode
// rather than a lossy-to-lossy transcode, and the result sits at the same quality bar as the
// content around it — which matters, because degrading a listening-comprehension item changes how
// hard the task is.
//
//   node src/compressWavAudio.js [--write]
//
// Without --write it only reports what it would do. The WAV originals are never deleted: verify
// the MP3s play, then remove them by hand.

const AUDIO_ROOT = path.resolve("../client/public/audio");
const BITRATE_KBPS = 48;
const SAMPLE_BLOCK = 1152; // One MPEG frame of samples; lamejs expects input in these blocks.

function listWavFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listWavFiles(full));
    else if (entry.name.toLowerCase().endsWith(".wav")) out.push(full);
  }
  return out;
}

// Minimal RIFF reader: walks the chunk list rather than assuming `data` sits at a fixed offset,
// because a WAV written by a recorder often carries LIST/fact chunks before it.
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bitsPerSample: body.readUInt16LE(14)
      };
    } else if (id === "data") {
      data = body;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  if (fmt.format !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`unsupported: format ${fmt.format}, ${fmt.bitsPerSample}-bit (want 16-bit PCM)`);
  }
  return { fmt, data };
}

// Averages the two channels rather than dropping one, so nothing panned to one side is lost.
function toMono({ fmt, data }) {
  const total = Math.floor(data.length / 2);
  if (fmt.channels === 1) {
    const mono = new Int16Array(total);
    for (let i = 0; i < total; i += 1) mono[i] = data.readInt16LE(i * 2);
    return mono;
  }
  const frames = Math.floor(total / fmt.channels);
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c += 1) sum += data.readInt16LE((i * fmt.channels + c) * 2);
    mono[i] = Math.max(-32768, Math.min(32767, Math.round(sum / fmt.channels)));
  }
  return mono;
}

function encodeMp3(samples, sampleRate) {
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, BITRATE_KBPS);
  const chunks = [];
  for (let i = 0; i < samples.length; i += SAMPLE_BLOCK) {
    const block = samples.subarray(i, i + SAMPLE_BLOCK);
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length) chunks.push(Buffer.from(encoded));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

const write = process.argv.includes("--write");
const files = listWavFiles(AUDIO_ROOT);
if (!files.length) {
  console.log("No WAV files found under", AUDIO_ROOT);
  process.exit(0);
}

let before = 0;
let after = 0;
let failed = 0;

for (const file of files) {
  const rel = path.relative(AUDIO_ROOT, file);
  const target = file.replace(/\.wav$/i, ".mp3");
  try {
    const wav = readWav(file);
    const mono = toMono(wav);
    const mp3 = encodeMp3(mono, wav.fmt.sampleRate);
    const originalSize = fs.statSync(file).size;
    before += originalSize;
    after += mp3.length;
    if (write) fs.writeFileSync(target, mp3);
    const seconds = mono.length / wav.fmt.sampleRate;
    console.log(
      `${rel.padEnd(52)} ${(originalSize / 1024).toFixed(0).padStart(6)}KB -> ${(mp3.length / 1024).toFixed(0).padStart(5)}KB` +
      `  (${(originalSize / mp3.length).toFixed(1)}x, ${seconds.toFixed(1)}s, ${wav.fmt.channels}ch @ ${wav.fmt.sampleRate}Hz)`
    );
  } catch (error) {
    failed += 1;
    console.error(`${rel.padEnd(52)} SKIPPED — ${error.message}`);
  }
}

console.log(`\n${files.length - failed} converted, ${failed} skipped`);
console.log(`${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024 / 1024).toFixed(2)} MB` +
  `  (saves ${((before - after) / 1024 / 1024).toFixed(2)} MB)`);
if (!write) console.log("\nDry run. Re-run with --write to create the .mp3 files.");
else console.log("\nWAV originals left in place — verify playback, then delete them.");
