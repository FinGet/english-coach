import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./trim-pauses.mjs", import.meta.url));
const fixture = (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "coach-trim-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const assets = join(cwd, "public/ep01");
  mkdirSync(assets, { recursive: true });
  const video = join(assets, "video.mp4");
  // The middle tone represents speech that ASR failed to transcribe.
  execFileSync("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", "color=black:s=32x32:r=25:d=7",
    "-f", "lavfi", "-i", "aevalsrc='if(between(t,0,0.8)+between(t,2,2.8)+between(t,6,6.8),0.05*sin(2*PI*440*t),0)':s=16000:d=7",
    "-c:v", "libx264", "-c:a", "aac", "-shortest", video,
  ]);
  const words = [
    { text: "Hello.", startMs: 0, endMs: 800, timestampMs: 400, confidence: null },
    { text: " End.", startMs: 6000, endMs: 6800, timestampMs: 6400, confidence: null },
  ];
  const motion = {
    video: { src: "ep01/video.mp4", durationMs: 7000 },
    captions: [{ text: "Hello.", startMs: 0, endMs: 6000 }, { text: "End.", startMs: 6000, endMs: 7000 }],
    corrections: [{ original: "End", corrected: "Finish", startMs: 6400, endMs: 6400 }],
    summary: { durationMs: 6000 },
  };
  const wordPath = join(assets, "captions.json");
  const motionPath = join(assets, "motion.json");
  const save = () => {
    writeFileSync(wordPath, JSON.stringify(words));
    writeFileSync(motionPath, JSON.stringify(motion));
  };
  save();
  const snapshot = () => [video, wordPath, motionPath].map((p) => readFileSync(p));
  const run = (...args) => spawnSync(process.execPath, [script, "--episode", "1", ...args], { cwd, encoding: "utf8" });
  return { cwd, assets, video, wordPath, motionPath, words, motion, save, snapshot, run };
};

test("untranscribed audio survives; only acoustic silence is cut and both timelines and backups stay consistent", (t) => {
  const f = fixture(t);
  f.motion.pronunciationNotes = [{ word: "End", ipa: "/end/", tip: "Practice.", startMs: 6200, endMs: 6600, source: "self-report" }];
  f.save();
  const before = f.snapshot();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const motion = JSON.parse(readFileSync(f.motionPath));
  const words = JSON.parse(readFileSync(f.wordPath));
  assert.equal(motion.edit.trimmedPauses, 2);
  assert.equal(motion.edit.noiseDb, -60);
  for (const cut of motion.edit.cuts) {
    assert.ok(cut.cutEnd <= 2000 || cut.cutStart >= 2800, "missing ASR words must not cause the middle tone to be cut");
  }
  const removed = motion.edit.cuts.reduce((sum, c) => sum + c.removed, 0);
  assert.ok(removed > 2000 && removed < 2600);
  assert.ok(Math.abs(motion.video.durationMs - (7000 - removed)) < 100);
  assert.deepEqual(words.map((w) => w.text), f.words.map((w) => w.text));
  assert.equal(words[1].startMs, 6000 - removed);
  assert.equal(words[1].endMs, 6800 - removed);
  assert.equal(words[1].timestampMs, 6400 - removed);
  assert.equal(motion.captions[1].startMs, words[1].startMs);
  assert.equal(motion.corrections[0].startMs, words[1].timestampMs);
  assert.equal(motion.pronunciationNotes[0].startMs, 6200 - removed);
  assert.equal(motion.pronunciationNotes[0].endMs, 6600 - removed);
  assert.equal(motion.pronunciationNotes[0].word, "End");
  for (const [i, name] of ["video.before-trim.mp4", "captions.before-trim.json", "motion.before-trim.json"].entries()) {
    assert.deepEqual(readFileSync(join(f.assets, name)), before[i]);
  }
  const firstCut = motion.edit.cuts[0].removed;
  const audio = execFileSync("ffmpeg", ["-v", "error", "-i", f.video, "-ss", String((2200 - firstCut) / 1000), "-t", "0.2", "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  let energy = 0;
  for (let i = 0; i < audio.length; i += 4) energy += audio.readFloatLE(i) ** 2;
  assert.ok(audio.length > 0 && Math.sqrt(energy / (audio.length / 4)) > 0.02, "audio missing from the transcript must remain audible");
  assert.ok(!readdirSync(f.assets).some((p) => p.startsWith(".trim-")));
  const completed = f.snapshot();
  assert.match(f.run().stderr, /视频已剪辑/);
  assert.deepEqual(f.snapshot(), completed);
});

test("long word timestamps are protected rather than discarded as phantom words", (t) => {
  const f = fixture(t);
  f.words.splice(0, f.words.length, { text: "Long word", startMs: 0, endMs: 7000, timestampMs: 3500 });
  f.save();
  const before = f.snapshot();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /没有可安全删除/);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(existsSync(join(f.assets, "video.before-trim.mp4")), false);
});

test("a failure after replacing the video restores the video and both subtitle files", (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  const hook = `import fs from "node:fs"; import {syncBuiltinESMExports} from "node:module";
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === "public/ep01/captions.json") throw new Error("simulated subtitle write failure");
      return rename(from, to);
    };
    syncBuiltinESMExports();`;
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(hook)}`, script, "--episode", "1"], { cwd: f.cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated subtitle write failure/);
  assert.deepEqual(f.snapshot(), before);
  assert.ok(existsSync(join(f.assets, "video.before-trim.mp4")));
  assert.ok(!readdirSync(f.assets).some((p) => p.startsWith(".trim-")));
  assert.match(f.run().stderr, /剪辑前备份已存在/);
  assert.deepEqual(f.snapshot(), before);
});

test("stale source timestamps, reduced padding and existing narration cannot modify the video", (t) => {
  const f = fixture(t);
  f.words[1].endMs = 10000;
  f.save();
  let before = f.snapshot();
  const stale = f.run();
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /时间戳与视频不匹配/);
  assert.deepEqual(f.snapshot(), before);
  f.words[1].endMs = 6800;
  f.motion.pronunciationNotes = [{ word: "End", startMs: 6200, endMs: 10000 }];
  f.save();
  before = f.snapshot();
  assert.match(f.run().stderr, /发音标注时间戳与视频不匹配/);
  assert.deepEqual(f.snapshot(), before);
  delete f.motion.pronunciationNotes;
  f.save();
  before = f.snapshot();
  for (const args of [["--tail", "0"], ["--head", "NaN"], ["--minGap", "-1"]]) {
    assert.notEqual(f.run(...args).status, 0);
    assert.deepEqual(f.snapshot(), before);
  }
  f.motion.summary.voice = { src: "voice.mp3" };
  f.save();
  before = f.snapshot();
  const narrated = f.run();
  assert.notEqual(narrated.status, 0);
  assert.match(narrated.stderr, /复习配音之前/);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(existsSync(join(f.assets, "video.before-trim.mp4")), false);
});
