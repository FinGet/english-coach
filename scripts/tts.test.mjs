import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { getNarrationSentences, getTtsRequest } from "./narration.mjs";

const script = fileURLToPath(new URL("./tts.mjs", import.meta.url));
const fixture = (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "coach-tts-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "public/ep01"), { recursive: true });
  const path = join(cwd, "public/ep01/motion.json");
  const motion = {
    meta: { episode: 1 }, video: { durationMs: 2000 },
    captions: [{ text: "I go.", startMs: 0, endMs: 1000 }, { text: "Next.", startMs: 1000, endMs: 2000 }],
    corrections: [{ original: "go", corrected: "went", startMs: 1000, endMs: 1000 }],
    summary: { durationMs: 6000 },
  };
  const save = () => writeFileSync(path, JSON.stringify(motion));
  save();
  // Every subprocess replaces fetch: tests cannot contact ElevenLabs.
  const run = (args = [], fetchCode = 'globalThis.fetch = () => { throw new Error("Unexpected paid request"); };') => spawnSync(process.execPath, [
    "--import", `data:text/javascript,${encodeURIComponent(fetchCode)}`, script, ...args,
  ], { cwd, encoding: "utf8", env: { ...process.env, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_VOICE_ID: "test-voice" } });
  const mock = (failAt = 0) => {
    const audio = join(cwd, "speech.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audio]);
    return `import { readFileSync } from 'node:fs'; let calls = 0;
      globalThis.fetch = async (_, init) => {
        if (++calls === ${failAt}) return { ok: false, status: 429 };
        const { text } = JSON.parse(init.body);
        return { ok: true, json: async () => ({
          audio_base64: readFileSync(${JSON.stringify(audio)}).toString('base64'),
          alignment: {
            character_start_times_seconds: Array.from(text, (_, i) => i * 0.04),
            character_end_times_seconds: Array.from(text, (_, i) => (i + 1) * 0.04),
          },
        }) };
      };`;
  };
  return { cwd, path, motion, save, run, mock };
};

test("one complete sentence includes all corrections and uncorrected context across subtitle rows", () => {
  const motion = {
    video: { durationMs: 3000 },
    captions: [
      { text: "If she go,", startMs: 0, endMs: 1000 },
      { text: "we is ready.", startMs: 1000, endMs: 2000 },
      { text: "Okay.", startMs: 2000, endMs: 3000 },
    ],
    corrections: [
      { original: "go", corrected: "goes", startMs: 1000 },
      { original: "is", corrected: "are", startMs: 1700 },
    ],
  };
  const sentences = getNarrationSentences(motion);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, "If she goes, we are ready.");
  assert.deepEqual(sentences[0].parts.map((part) => part.caption), [0, 1]);
  assert.equal(sentences[0].parts[1].offset, "If she goes, ".length);
  assert.notEqual(getTtsRequest(sentences[0].text, "a").generationKey, getTtsRequest(sentences[0].text, "b").generationKey);
});

test("default and check mode are read-only, with no network or cache directory", (t) => {
  const f = fixture(t);
  const before = readFileSync(f.path, "utf8");
  for (const args of [[], ["--check"]]) {
    const result = f.run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"generate": 1/);
    assert.match(result.stdout, /I went\./);
    assert.equal(readFileSync(f.path, "utf8"), before);
    assert.equal(existsSync(join(f.cwd, "public/_cache/tts")), false);
  }
});

test("removed original phrases stop generation before a paid request or file change", (t) => {
  const f = fixture(t);
  f.motion.captions[0].text = "I went.";
  f.save();
  const before = readFileSync(f.path, "utf8");
  const result = f.run(["--approved"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /纠错已不匹配当前字幕/);
  assert.equal(readFileSync(f.path, "utf8"), before);
});

test("independent cached audio is reused after caption indices or episode change; only changed text needs generation", (t) => {
  const f = fixture(t);
  const result = f.run(["--approved"], f.mock());
  assert.equal(result.status, 0, result.stderr);
  let generated = JSON.parse(readFileSync(f.path, "utf8"));
  assert.equal(generated.summary.voice.clips.length, 1);
  assert.ok(existsSync(join(f.cwd, "public", generated.summary.voice.clips[0].src)));
  assert.deepEqual(generated.summary.voice.lines, [{ caption: 0, startMs: 2000, endMs: 2280 }]);
  generated.meta.episode = 2;
  generated.captions.unshift({ text: "Hi.", startMs: 0, endMs: 1 });
  generated.captions[1].startMs = 1;
  delete generated.summary.voice;
  mkdirSync(join(f.cwd, "public/ep02"), { recursive: true });
  f.path = join(f.cwd, "public/ep02/motion.json");
  writeFileSync(join(f.cwd, "episode.config.json"), JSON.stringify({ episode: 2 }));
  writeFileSync(f.path, JSON.stringify(generated));
  const reused = f.run(["--approved"]);
  assert.equal(reused.status, 0, reused.stderr);
  assert.match(reused.stdout, /复用 1 句，新生成 0 句/);
  generated = JSON.parse(readFileSync(f.path, "utf8"));
  assert.equal(generated.summary.voice.lines[0].caption, 1);
  generated.corrections[0].corrected = "will go";
  writeFileSync(f.path, JSON.stringify(generated));
  assert.match(f.run(["--check"]).stdout, /"generate": 1/);
});

test("a later failed request preserves earlier sentence caches and rerun generates only the missing sentence", (t) => {
  const f = fixture(t);
  f.motion.captions[1].text = "We is ready.";
  f.motion.corrections.push({ original: "is", corrected: "are", startMs: 1700 });
  f.save();
  const before = readFileSync(f.path, "utf8");
  assert.notEqual(f.run(["--approved"], f.mock(2)).status, 0);
  assert.equal(readFileSync(f.path, "utf8"), before);
  assert.equal(readdirSync(join(f.cwd, "public/_cache/tts")).filter((name) => name.endsWith(".mp3")).length, 1);
  const result = f.run(["--approved"], f.mock());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /复用 1 句，新生成 1 句/);
  const generated = JSON.parse(readFileSync(f.path, "utf8"));
  assert.equal(generated.summary.voice.clips.length, 2);
  assert.ok(generated.summary.voice.lines[1].startMs > generated.summary.voice.lines[0].endMs);
});

test("invalid provider alignment preserves the previous JSON", (t) => {
  const f = fixture(t);
  const before = readFileSync(f.path, "utf8");
  const result = f.run(["--approved"], `globalThis.fetch = async () => ({ ok: true, json: async () => ({
    audio_base64: Buffer.from("invalid").toString("base64"),
    alignment: { character_start_times_seconds: [], character_end_times_seconds: [] },
  }) });`);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.path, "utf8"), before);
});
