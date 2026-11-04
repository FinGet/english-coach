import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { compileReview } from "./review.mjs";
import { ROOT, validateMotion } from "./template.mjs";

const words = ["Yesterday", "I", "go", "home", "I", "am", "agree"].map((text, i) => ({ text, startMs: i * 100, endMs: (i + 1) * 100 }));
const review = {
  captions: ["Yesterday I go home.", "I am agree."],
  corrections: [
    { caption: 0, original: "go", corrected: "went", level: 2, fingerprint: "grammar:past_tense", label: "Past tense" },
    { caption: 1, original: "am agree", corrected: "agree", level: 2, fingerprint: "grammar:agree_verb", label: "Verb form" },
  ],
  assessment: { grammar: 32, vocabulary: 25, naturalness: 24, note: "Improve tense and verb forms." },
};
const compile = (changes = {}) => compileReview({ review, words, durationMs: 700, episode: 3, video: "test.mp4", ...changes });

test("host prose becomes real word timestamps, including the last word and repeat holds", () => {
  const motion = compile({ history: { 1: ["grammar:agree_verb"], 2: ["grammar:agree_verb"] } });
  validateMotion(motion);
  assert.equal(motion.corrections[0].startMs, 300);
  assert.equal(motion.corrections[1].startMs, 700);
  assert.equal(motion.corrections[1].endMs, 700);
  assert.equal(motion.corrections[1].level, 3);
  assert.equal(motion.corrections[1].repeatCount, 3);
  assert.equal(motion.summary.assessment.grammar, 32);
});

test("host reviews cannot silently change words, omit words, invent fixes or scores", () => {
  assert.throws(() => compile({ review: { ...review, captions: ["Yesterday I went home.", "I am agree."] } }), /changed or reordered/);
  assert.throws(() => compile({ review: { ...review, captions: [review.captions[0]] } }), /omitted/);
  assert.throws(() => compile({ review: { ...review, corrections: [{ ...review.corrections[0], original: "not spoken" }] } }), /exact, unambiguous/);
  assert.throws(() => compile({ review: { ...review, corrections: [{ ...review.corrections[0], level: 3 }] } }), /level 1\/2/);
  assert.throws(() => compile({ review: { ...review, assessment: { ...review.assessment, grammar: 41 } } }));
});

test("local review handoff runs without an LLM key or fetch and validates before writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "coach-host-review-"));
  mkdirSync(join(dir, "public"));
  copyFileSync(join(ROOT, "public/demo.mp4"), join(dir, "public/test.mp4"));
  writeFileSync(join(dir, "public/captions.json"), JSON.stringify(words));
  writeFileSync(join(dir, "public/motion.json"), '{"sentinel":true}');
  writeFileSync(join(dir, "block-network.mjs"), 'globalThis.fetch = () => { throw new Error("Unexpected network call"); };');
  const run = (...args) => execFileSync(process.execPath, ["--import", join(dir, "block-network.mjs"), join(ROOT, "scripts/audit.mjs"), ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LLM_API_KEY: "", ELEVENLABS_API_KEY: "" } });
  assert.match(run("--create-task", "--episode", "1", "--video", "test.mp4"), /Current AI/);
  const task = JSON.parse(readFileSync(join(dir, "audit-task.json"), "utf8"));
  assert.deepEqual(task.words, words.map((word) => word.text));
  assert.equal(task.durationMs, 12000);
  writeFileSync(join(dir, "audit.json"), JSON.stringify({ ...review, captions: ["Invented sentence."] }));
  assert.throws(() => run("--review", "audit.json"));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "public/motion.json"), "utf8")), { sentinel: true });
  assert(!existsSync(join(dir, "error_history.json")));
  writeFileSync(join(dir, "audit.json"), JSON.stringify(review));
  assert.match(run("--review", "audit.json"), /No model API was called/);
  const motion = JSON.parse(readFileSync(join(dir, "public/motion.json"), "utf8"));
  assert.equal(motion.corrections[0].startMs, 300);
  assert.equal(motion.summary.assessment.grammar, 32);
  assert.throws(() => run("--review", "audit.json"));
});

test("the actual episode commands finish from supplied words and host review without any model request", () => {
  const dir = mkdtempSync(join(tmpdir(), "coach-host-episode-"));
  const excluded = new Set(["node_modules", "build", "out", ".env", "error_history.json", "audit-task.json", "audit.json", "applied-audit.json"]);
  cpSync(ROOT, dir, { recursive: true, filter: (path) => !excluded.has(relative(ROOT, path).split(sep)[0]) });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "words.json"), JSON.stringify(words));
  writeFileSync(join(dir, "block-network.mjs"), 'globalThis.fetch = () => { throw new Error("Unexpected model/voice request"); };');
  const run = (...args) => execFileSync(process.execPath, [join(dir, "scripts/episode.mjs"), ...args], {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LLM_API_KEY: "", ELEVENLABS_API_KEY: "must-not-be-used", NODE_OPTIONS: `--import=${join(dir, "block-network.mjs")}` },
  });
  assert.match(run(join(ROOT, "public/demo.mp4"), "1", "--captions", "words.json"), /current AI/);
  assert(existsSync(join(dir, "audit-task.json")));
  writeFileSync(join(dir, "audit.json"), JSON.stringify(review));
  assert.match(run("--review", "audit.json"), /No additional LLM key was used/);
  const motion = JSON.parse(readFileSync(join(dir, "public/motion.json"), "utf8"));
  assert.equal(motion.video.src, "ep01.mp4");
  assert.equal(motion.corrections[0].corrected, "went");
  assert.equal(motion.summary.voice, undefined);
});
