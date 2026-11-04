import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
try { process.loadEnvFile(); } catch {}
const path = "public/motion.json";
const motion = JSON.parse(readFileSync(path, "utf8"));
const save = () => writeFileSync(path, JSON.stringify(motion, null, 2) + "\n");
if (!process.env.ELEVENLABS_API_KEY) {
  console.log("No ELEVENLABS_API_KEY: skipping generated narration; keeping the transcript recap and any existing supplied narration.");
  process.exit(0);
}
const lines = motion.captions.flatMap((caption, index) => {
  const fixes = motion.corrections.filter((c) => c.startMs >= caption.startMs && c.startMs < caption.endMs);
  return fixes.length ? [{ caption: index, text: fixes.reduce((text, c) => text.replace(c.original, c.corrected), caption.text) }] : [];
});
if (!lines.length) {
  delete motion.summary.voice;
  motion.summary.durationMs = 6000;
  save();
  console.log("No corrections: no narration needed.");
  process.exit(0);
}
const text = lines.map((line) => line.text).join(" ");
const voiceId = process.env.ELEVENLABS_VOICE_ID || "hpp4J3VqNfWAUOO0d1Us";
const request = { text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.9 } };
const generationKey = createHash("sha256").update(JSON.stringify({ voiceId, ...request })).digest("hex");
const src = `ep${String(motion.meta.episode).padStart(2, "0")}-voice.mp3`;
if (motion.summary.voice?.generationKey === generationKey && existsSync(`public/${src}`)) {
  console.log("Text, voice and settings unchanged: reusing narration.");
  process.exit(0);
}
const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY },
  body: JSON.stringify(request),
});
if (!res.ok) throw new Error(`ElevenLabs failed (${res.status}); check your account, voice access and quota. Re-run this step only.`);
const { audio_base64, alignment } = await res.json();
if (typeof audio_base64 !== "string" || !audio_base64 || !Array.isArray(alignment?.character_start_times_seconds) || !Array.isArray(alignment?.character_end_times_seconds)) throw new Error("ElevenLabs returned no valid audio/alignment");
const at = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid ElevenLabs character timestamp");
  return 2000 + Math.round(seconds * 1000);
};
let offset = 0;
const timed = lines.map((line) => {
  const startMs = at(alignment.character_start_times_seconds[offset]);
  const endMs = at(alignment.character_end_times_seconds[offset + line.text.length - 1]);
  if (endMs <= startMs) throw new Error("Invalid ElevenLabs line duration");
  offset += line.text.length + 1;
  return { caption: line.caption, startMs, endMs };
});
writeFileSync(`public/${src}`, Buffer.from(audio_base64, "base64"));
motion.summary = { ...motion.summary, durationMs: Math.max(6000, timed.at(-1).endMs + 1500), voice: { src, text, startMs: 2000, lines: timed, generationKey } };
save();
console.log(`Generated ${src}; ${timed.length} corrected sentences. Re-run npm run check before exporting.`);
