import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localFile, ROOT, timeline, validateInputs, validateMotion } from "./template.mjs";

const demo = JSON.parse(readFileSync(join(ROOT, "public/motion.json"), "utf8"));
const preset = JSON.parse(readFileSync(join(ROOT, "presets/demo.json"), "utf8"));

test("demo validates and preserves the final correction reading window", async () => {
  validateInputs(preset);
  validateMotion(demo);
  const { getMainMs, getHits, getClock } = await timeline();
  assert.equal(getHits(demo).length, 1);
  assert.equal(getMainMs(demo), 15050);
  assert.equal(getClock(12000, getHits(demo)).ms, 11360);
  assert.equal(Math.ceil((getMainMs(demo) + demo.summary.durationMs) / 1000 * 30), 632);
});

test("inputs reject unsupported scaling, unknown fields and oversized identity", () => {
  for (const invalid of [{ ...preset, scale: 4 }, { ...preset, crf: 0 }, { ...preset, surprise: true }, { ...preset, creator: { ...preset.creator, name: "x".repeat(17) } }]) {
    assert.throws(() => validateInputs(invalid));
  }
});

test("invalid timing, invented originals and excess recap content stop before rendering", () => {
  const invalid = structuredClone(demo);
  invalid.corrections[0].original = "words not spoken";
  assert.throws(() => validateMotion(invalid));
  const overlap = structuredClone(demo);
  overlap.captions[1].startMs = 1;
  assert.throws(() => validateMotion(overlap));
  const badScore = structuredClone(demo);
  badScore.summary.assessment.grammar = 41;
  assert.throws(() => validateMotion(badScore));
  const badVoice = structuredClone(demo);
  badVoice.summary.voice = { startMs: 0, lines: [{ caption: 0, startMs: 0, endMs: 7000 }] };
  assert.throws(() => validateMotion(badVoice));
  const longRecap = structuredClone(demo);
  longRecap.corrections = [];
  longRecap.captions = Array.from({ length: 12 }, (_, index) => ({ text: "Practicing English every morning helps me explain complicated ideas more clearly.", startMs: index * 1000, endMs: (index + 1) * 1000 }));
  assert.throws(() => validateMotion(longRecap), /Full transcript is too long/);
});

test("missing ElevenLabs credentials skip narration without changing episode data", () => {
  const before = readFileSync(join(ROOT, "public/motion.json"), "utf8");
  const output = execFileSync(process.execPath, [join(ROOT, "scripts/tts.mjs")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ELEVENLABS_API_KEY: "" } });
  assert.match(output, /skipping generated narration/);
  assert.equal(readFileSync(join(ROOT, "public/motion.json"), "utf8"), before);
});

test("media paths reject traversal, URLs and symlink escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "coach-path-test-"));
  const outside = mkdtempSync(join(tmpdir(), "coach-outside-test-"));
  writeFileSync(join(dir, "allowed.json"), "{}");
  writeFileSync(join(outside, "private.json"), "{}");
  symlinkSync(join(outside, "private.json"), join(dir, "escape.json"));
  assert.equal(localFile(dir, "allowed.json"), join(dir, "allowed.json"));
  for (const path of ["../private.json", "https://example.com/a.mp4", "/tmp/a.mp4", "escape.json", "..\\private.json"]) assert.throws(() => localFile(dir, path));
});
