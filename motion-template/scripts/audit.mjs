// Local host-AI handoff. This script does not call an LLM service or require a key.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { compileReview, knownFingerprints, validateWords } from "./review.mjs";
import { localFile, validateMotion } from "./template.mjs";

const { values } = parseArgs({ options: {
  "create-task": { type: "boolean", default: false },
  review: { type: "string" },
  task: { type: "string", default: "audit-task.json" },
  episode: { type: "string" },
  video: { type: "string" },
  captions: { type: "string", default: "captions.json" },
  force: { type: "boolean", default: false },
} });
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const publicDir = resolve("public");
const history = existsSync("error_history.json") ? read("error_history.json") : {};
const probe = (video) => Math.round(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", localFile(publicDir, video)], { encoding: "utf8" }).trim()) * 1000);

if (values["create-task"]) {
  const episode = Number(values.episode);
  if (!Number.isInteger(episode) || episode < 1 || !values.video) throw new Error("Use --create-task --episode 1 --video ep01.mp4 [--captions captions.json]");
  const durationMs = probe(values.video);
  const bytes = readFileSync(localFile(publicDir, values.captions));
  const words = validateWords(JSON.parse(bytes), durationMs);
  if (existsSync(values.task) && !values.force) throw new Error("An audit task already exists; preserve it or explicitly pass --force");
  save(values.task, {
    taskVersion: 1, episode, video: values.video, durationMs, captions: values.captions,
    captionsSha256: digest(bytes), promptFile: "scripts/audit-prompt.md", reviewOutput: "audit.json",
    words: words.map((word) => word.text.trim()), knownFingerprints: knownFingerprints(history, episode),
    nextStep: "The current host AI reads this task and audit-prompt.md, reviews the verbatim words, and writes captions/corrections/assessment to audit.json. Then run npm run episode -- --review audit.json. No LLM_API_KEY or additional model endpoint is used.",
  });
  console.log(`Prepared ${values.task}. Current AI: read it and scripts/audit-prompt.md, write audit.json, then run npm run episode -- --review audit.json. No extra LLM account needed.`);
} else {
  if (!values.review) throw new Error("Use --review audit.json, or --create-task to prepare the host-AI handoff");
  const task = read(values.task);
  if (task.taskVersion !== 1) throw new Error("Unsupported audit task version");
  const taskHash = digest(readFileSync(values.task));
  if (existsSync("applied-audit.json") && read("applied-audit.json").taskSha256 === taskHash && !values.force) throw new Error("This task was already applied; do not reapply it over a trimmed time axis. Use a fresh workspace to revise source timing.");
  const bytes = readFileSync(localFile(publicDir, task.captions));
  if (digest(bytes) !== task.captionsSha256 || probe(task.video) !== task.durationMs) throw new Error("The recording or timestamps changed since this task; create a fresh task before applying a review");
  const creator = existsSync("creator.config.json") ? read("creator.config.json").name : "Learner";
  const motion = validateMotion(compileReview({ review: read(values.review), words: JSON.parse(bytes), durationMs: task.durationMs, episode: task.episode, video: task.video, history, creator }));
  // All review/timeline/capacity validation completes before episode data is written.
  save("public/motion.json", motion);
  history[task.episode] = motion.corrections.filter((fix) => fix.level > 1).map((fix) => fix.fingerprint);
  save("error_history.json", history);
  save("applied-audit.json", { taskSha256: taskHash, reviewSha256: digest(readFileSync(values.review)) });
  console.log(`Applied host-AI review locally: ${motion.captions.length} captions, ${motion.corrections.length} corrections. No model API was called.`);
}
