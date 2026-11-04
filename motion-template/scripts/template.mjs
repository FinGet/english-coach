import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { validateAssessment } from "./assessment.mjs";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const validator = new Ajv2020({ allErrors: true }).compile(readJson(resolve(ROOT, "params.schema.json")));
const fail = (message) => { throw new Error(message); };
const bounded = (n, low, high, name) => {
  if (!Number.isFinite(n) || n < low || n > high) fail(`Invalid ${name}: expected ${low}..${high}`);
};

export const localFile = (base, name) => {
  if (typeof name !== "string" || !name || isAbsolute(name) || name.includes("\\") || name.split("/").includes("..") || name.includes(":")) {
    fail("Media/data paths must be local relative paths, without parent traversal or URLs");
  }
  const path = resolve(base, name);
  const rel = relative(realpathSync(base), realpathSync(path));
  if (rel.startsWith("..") || isAbsolute(rel)) fail("File resolves outside the selected workspace");
  return path;
};

export const validateInputs = (inputs) => {
  if (!validator(inputs)) fail(`Invalid template inputs: ${JSON.stringify(validator.errors)}`);
  return inputs;
};

export const validateMotion = (motion) => {
  if (!motion || !Number.isInteger(motion.meta?.episode) || motion.meta.episode < 1) fail("Missing valid episode metadata");
  bounded(motion.video?.durationMs, 1, 90000, "source durationMs");
  const captions = motion.captions;
  if (!Array.isArray(captions) || captions.length < 1 || captions.length > 12) fail("This first layout supports 1–12 short captions; split a longer episode");
  let previousEnd = 0;
  let recapChars = 0;
  for (const [index, caption] of captions.entries()) {
    if (typeof caption.text !== "string" || !caption.text.trim()) fail(`Missing caption text: ${index}`);
    bounded(caption.startMs, previousEnd, motion.video.durationMs, "caption startMs");
    bounded(caption.endMs, caption.startMs + 1, motion.video.durationMs, "caption endMs");
    if (caption.text.trim().split(/\s+/).length > 15) fail(`Caption ${index} exceeds 15 words; split at real word timestamps`);
    recapChars += caption.text.length;
    previousEnd = caption.endMs;
  }
  if (!Array.isArray(motion.corrections) || motion.corrections.filter((c) => c.level === 3).length > 2) fail("Invalid corrections or more than two repeat-mistake holds");
  for (const c of motion.corrections) {
    if (![1, 2, 3].includes(c.level) || typeof c.original !== "string" || !c.original || typeof c.corrected !== "string" || !c.corrected) fail("Invalid correction text/level");
    bounded(c.startMs, 0, motion.video.durationMs, "correction startMs");
    bounded(c.endMs, c.startMs, motion.video.durationMs, "correction endMs");
    const index = captions.findIndex((caption) => c.startMs >= caption.startMs && c.startMs <= caption.endMs && caption.text.includes(c.original));
    if (index < 0) fail(`Correction is outside its exact source caption: ${c.original}`);
    if (typeof c.label !== "string" || typeof c.fingerprint !== "string") fail("Correction label and fingerprint are required");
    if (c.level === 3 && (!Number.isInteger(c.repeatCount) || c.repeatCount < 3)) fail("Repeat count must reflect at least three occurrences");
    recapChars += c.corrected.length;
  }
  for (const caption of captions) {
    const correctedChars = motion.corrections.filter((c) => c.startMs >= caption.startMs && c.startMs < caption.endMs).reduce((sum, c) => sum + c.corrected.length, caption.text.length);
    if (correctedChars > 150) fail("Caption plus inline corrections is too long for this layout; split it before rendering");
  }
  if (recapChars > 650) fail("Full transcript is too long for this first recap layout; split into episodes");
  bounded(motion.summary?.durationMs, 1000, 90000, "summary durationMs");
  if (motion.summary.assessment) validateAssessment(motion.summary.assessment);
  const voice = motion.summary.voice;
  if (voice) {
    bounded(voice.startMs, 0, motion.summary.durationMs, "voice startMs");
    if (!Array.isArray(voice.lines) || !voice.lines.length) fail("Narration requires sentence timestamps");
    let end = voice.startMs;
    for (const line of voice.lines) {
      if (!Number.isInteger(line.caption) || !captions[line.caption]) fail("Invalid narrated caption index");
      bounded(line.startMs, end, motion.summary.durationMs, "voice line startMs");
      bounded(line.endMs, line.startMs + 1, motion.summary.durationMs, "voice line endMs");
      end = line.endMs;
    }
  }
  return motion;
};

export const timeline = async () => {
  const { transpileModule, ModuleKind } = await import("typescript");
  const code = transpileModule(readFileSync(resolve(ROOT, "src/timeline.ts"), "utf8"), { compilerOptions: { module: ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
};

export const prepare = async (inputPath) => {
  const inputs = validateInputs(readJson(inputPath));
  const motion = validateMotion(readJson(localFile(resolve(ROOT, "public"), inputs.motionSrc)));
  const sourcePath = localFile(resolve(ROOT, "public"), motion.video.src);
  if (motion.summary.voice) localFile(resolve(ROOT, "public"), motion.summary.voice.src);
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", sourcePath], { encoding: "utf8" }).trim()) * 1000;
  if (!Number.isFinite(duration) || Math.abs(duration - motion.video.durationMs) > 250) fail("Source duration differs from the episode JSON; regenerate real timestamps");
  const { getMainMs } = await timeline();
  const durationInFrames = Math.ceil((getMainMs(motion) + motion.summary.durationMs) / 1000 * 30);
  if (durationInFrames / 30 > inputs.durationLimitSeconds) fail("Total output exceeds durationLimitSeconds; split the episode rather than truncate it");
  writeFileSync(resolve(ROOT, "creator.config.json"), JSON.stringify(inputs.creator, null, 2) + "\n");
  writeFileSync(resolve(ROOT, "render-props.json"), JSON.stringify({ motionSrc: inputs.motionSrc }, null, 2) + "\n");
  console.log(`Prepared ${inputs.motionSrc}: ${durationInFrames} frames, ${(durationInFrames / 30).toFixed(2)}s, ${1080 * inputs.scale}×${1920 * inputs.scale}`);
  return inputs;
};

const cli = (args) => execFileSync(process.execPath, [resolve(ROOT, "node_modules/@remotion/cli/remotion-cli.js"), ...args], { cwd: ROOT, stdio: "inherit" });

const main = async () => {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    inputs: { type: "string", default: "presets/demo.json" },
    output: { type: "string" },
    frame: { type: "string", default: "180" },
    force: { type: "boolean", default: false },
  } });
  const command = positionals[0] ?? "check";
  if (!["check", "prepare", "preview", "render", "still"].includes(command)) fail("Use check | prepare | preview | render | still");
  process.chdir(ROOT);
  if (command === "check") {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (!((major === 20 && minor >= 19) || (major === 22 && minor >= 13) || major >= 24)) fail("Use Node 20.19+, 22.13+, or 24+");
    for (const tool of ["ffmpeg", "ffprobe"]) {
      try { execFileSync(tool, ["-version"], { stdio: "ignore" }); } catch { fail(`Install ${tool} and add it to PATH`); }
    }
    console.log(`Node ${process.versions.node}; FFmpeg and ffprobe available. Browser and WebGPU capability are separate checks.`);
  }
  const inputs = await prepare(resolve(ROOT, values.inputs));
  if (["check", "prepare"].includes(command)) return;
  const common = ["--props=render-props.json"];
  if (command === "preview") return cli(["studio", ...common]);
  const output = resolve(ROOT, values.output ?? (command === "still" ? "out/preview.png" : "out/english-coach.mp4"));
  const rel = relative(ROOT, output);
  if (!rel.startsWith("out/") && !rel.startsWith("out\\")) fail("Export files must be under out/");
  if (existsSync(output) && !values.force) fail("Output exists; select a new path or explicitly pass --force");
  mkdirSync(dirname(output), { recursive: true });
  if (command === "still") {
    if (!/^\d+$/.test(values.frame)) fail("--frame must be a nonnegative integer");
    cli(["still", "AiEnglishCoachPortrait", output, ...common, `--frame=${values.frame}`, `--scale=${inputs.scale}`, `--overwrite=${values.force}`]);
  } else {
    cli(["render", "AiEnglishCoachPortrait", output, ...common, `--scale=${inputs.scale}`, `--crf=${inputs.crf}`, "--image-format=png", `--overwrite=${values.force}`]);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
