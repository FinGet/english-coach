import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const originalCwd = process.cwd();
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  captions: { type: "string" },
  review: { type: "string" },
  force: { type: "boolean", default: false },
} });
const [input, episode = "1"] = positionals;
const source = input ? resolve(originalCwd, input) : null;
const suppliedCaptions = values.captions ? resolve(originalCwd, values.captions) : null;
const reviewPath = values.review ? resolve(originalCwd, values.review) : null;
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
if (reviewPath) {
  run(process.execPath, ["scripts/audit.mjs", "--review", reviewPath]);
  run(process.execPath, ["scripts/trim-pauses.mjs", "--motion", "public/motion.json", "--words", "public/captions.json"]);
  console.log("Ready: npm run check, then npm run dev. Wait for human approval of the preview before running npm run tts. Preview again before rendering. No additional LLM key was used.");
  process.exit(0);
}
if (!source || !/^[1-9]\d{0,3}$/.test(episode)) throw new Error("Usage: npm run episode -- <recording.mp4> <episode> [--captions words.json]; then let the current AI write audit.json and run npm run episode -- --review audit.json");
if (!existsSync(source)) throw new Error("Source recording does not exist");
const video = `ep${episode.padStart(2, "0")}.mp4`;
const previous = JSON.parse(readFileSync("public/motion.json", "utf8"));
if (!values.force && (existsSync(`public/${video}`) || previous.video.src !== "demo.mp4")) throw new Error("This workspace already contains an episode. Extract a fresh instance, or explicitly pass --force to replace it.");
if (suppliedCaptions) {
  const words = JSON.parse(readFileSync(suppliedCaptions, "utf8"));
  if (!Array.isArray(words) || !words.length || words.some((word, i) => typeof word.text !== "string" || !Number.isFinite(word.startMs) || !Number.isFinite(word.endMs) || word.startMs < 0 || word.endMs <= word.startMs || (i > 0 && word.startMs < words[i - 1].startMs))) throw new Error("--captions must be a nonempty array of {text,startMs,endMs} using real word timestamps");
}
console.log("1/3 Transcode a working copy (the original recording is unchanged)");
run("ffmpeg", ["-v", "error", values.force ? "-y" : "-n", "-i", source, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", `public/${video}`]);
console.log("2/3 Obtain word timestamps");
if (suppliedCaptions) copyFileSync(suppliedCaptions, "public/captions.json");
else {
  try { run(process.execPath, ["scripts/transcribe.mjs", `public/${video}`]); }
  catch { throw new Error("Local Whisper/WebGPU transcription failed. Keep the transcoded copy, obtain real word timestamps, save public/captions.json, then run node scripts/audit.mjs --create-task --episode " + episode + " --video " + video + ". See README; do not invent timestamps."); }
}
console.log("3/3 Prepare the review handoff for the current AI");
run(process.execPath, ["scripts/audit.mjs", "--create-task", "--episode", episode, "--video", video, ...(values.force ? ["--force"] : [])]);
console.log("The current AI should now read audit-task.json and scripts/audit-prompt.md, write audit.json, then continue with npm run episode -- --review audit.json. Preview first and wait for human approval before generating ElevenLabs narration separately.");
