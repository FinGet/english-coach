import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildLocalPronunciationNotes, getLocalPronunciationPlan, LOCAL_PHONE_MODEL } from "./local-pronunciation.mjs";

const motion = { meta: { episode: 1 }, video: { src: "ep01/video.mp4", durationMs: 3000 },
  captions: [{ text: "I like real-life experience in 2023.", startMs: 0, endMs: 3000 }], corrections: [], summary: { durationMs: 6000 } };
const resultsFor = (plan) => plan.map((segment) => ({ ...segment,
  words: segment.words.map((word, position) => ({ word: word.word, position, expected: ["a"], ipa: "ˈa", audioStartMs: 100 + position * 100, audioEndMs: 180 + position * 100 })),
  comparison: { errors: segment.words.map((word, position) => ({ word: word.word, position })) },
}));

test("model flags map to original compound words and occurrences, preserve confirmed notes, and exclude ambiguous numbers", () => {
  const m = structuredClone(motion);
  m.pronunciationNotes = [{ word: "like", ipa: "/laɪk/", tip: "Keep this note.", startMs: 200, endMs: 280, source: "user-confirmed" }];
  const plan = getLocalPronunciationPlan(m);
  const result = resultsFor(plan);
  const before = structuredClone(m);
  const { notes, unmapped } = buildLocalPronunciationNotes(m, plan, result);
  assert.deepEqual(notes.map((n) => n.word), ["I", "like", "real-life", "experience", "in"]);
  assert.equal(notes.find((n) => n.word === "like").tip, "Keep this note.");
  assert.equal(notes.find((n) => n.word === "real-life").ipa, "/ˈa ˈa/");
  assert.equal(unmapped[0].word, "2023");
  assert.deepEqual(m, before);
  result[0].words[0].audioStartMs = null;
  const fallback = buildLocalPronunciationNotes(m, plan, result).notes.find((n) => n.word === "I");
  assert.equal(fallback.startMs, 3000);
  assert.equal(fallback.endMs, 3000);
  m.pronunciationNotes.push({ ...notes.find((n) => n.word === "real-life"), dictionaryAudioId: "reviewed01", audio: { src: "word.mp3", word: "real-life", durationMs: 1000 } });
  assert.equal(buildLocalPronunciationNotes(m, plan, result).notes.find((n) => n.word === "real-life").audio.src, "word.mp3");
  assert.equal(buildLocalPronunciationNotes(m, plan, result).notes.find((n) => n.word === "real-life").dictionaryAudioId, "reviewed01");
});

test("incomplete, stale and malformed inference never produces notes; curly apostrophes keep their original spelling", () => {
  const m = { ...motion, captions: [{ text: "It's real-life. It’s fine.", startMs: 0, endMs: 3000 }] };
  const plan = getLocalPronunciationPlan(m);
  assert.deepEqual(plan[0].words.map((w) => w.word), ["it's", "real", "life", "it's", "fine"]);
  assert.equal(buildLocalPronunciationNotes(m, plan, resultsFor(plan)).notes[2].word, "It’s");
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => { rows[0].referenceText = "Different."; },
    (rows) => { rows[0].words[0].expected = []; },
    (rows) => { rows[0].comparison.errors[0].position = 99; },
  ]) {
    const result = resultsFor(plan); mutate(result);
    assert.throws(() => buildLocalPronunciationNotes(m, plan, result));
  }
});

const script = fileURLToPath(new URL("./assess-local-pronunciation.mjs", import.meta.url));
const fixture = (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "coach-local-phones-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const save = (path, data, options) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), data, options); };
  save("public/ep01/motion.json", JSON.stringify(motion));
  for (const file of ["manifest.json", "model/pytorch_model.bin", "vendor/openpronounce/phones.py"]) save(`.cache/local-pronunciation/${file}`, "{}");
  save(".cache/asr-venv/bin/python", `#!${process.execPath}
    const fs = require('node:fs');
    const request = JSON.parse(fs.readFileSync(process.argv[3]));
    fs.copyFileSync(request.wav, 'assessed.wav');
    const rows = request.segments.map(s => ({...s,
      words:s.words.map((w,i)=>({word:w.word,position:i,expected:['a'],ipa:'a',audioStartMs:100+i*100,audioEndMs:180+i*100})),
      comparison:{errors:s.words.map((w,i)=>({word:w.word,position:i}))}
    }));
    fs.writeFileSync(process.argv[4], JSON.stringify({requestKey:request.requestKey,segments:rows}));
  `, { mode: 0o700 });
  const video = join(cwd, "public/ep01/video.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "3", "-c:a", "aac", video]);
  const run = (args) => spawnSync(process.execPath, [script, "--episode", "1", ...args], { cwd, encoding: "utf8" });
  return { cwd, save, run, video, path: join(cwd, "public/ep01/motion.json") };
};

test("CLI checks are read-only; real original audio preparation applies model notes while preserving captions and score", (t) => {
  const f = fixture(t);
  const before = readFileSync(f.path, "utf8");
  assert.equal(f.run(["--check"]).status, 0);
  assert.equal(existsSync(join(f.cwd, "output")), false);
  const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const backup = join(f.cwd, "public/ep01/video.before-denoise.mp4");
  writeFileSync(backup, readFileSync(f.video));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "3", "-c:a", "aac", f.video]);
  f.save("public/ep01/video.mp4.denoise.json", JSON.stringify({ inputHash: hash(backup), outputHash: hash(f.video) }));
  const assessed = f.run(["--assess"]);
  assert.equal(assessed.status, 0, assessed.stderr);
  assert.equal(readFileSync(f.path, "utf8"), before);
  const samples = execFileSync("ffmpeg", ["-v", "error", "-i", join(f.cwd, "assessed.wav"), "-f", "f32le", "-"]);
  let power = 0;
  for (let i = 0; i < samples.length; i += 4) power += samples.readFloatLE(i) ** 2;
  assert.ok(Math.sqrt(power / (samples.length / 4)) > 0.02, "assessment must use the unmodified original voice");
  const applied = f.run(["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  const next = JSON.parse(readFileSync(f.path));
  assert.deepEqual(next.captions, motion.captions);
  assert.deepEqual(next.summary, motion.summary);
  assert.ok(next.pronunciationNotes.every((n) => n.model === LOCAL_PHONE_MODEL));
  assert.equal(f.run(["--apply"]).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.path)), next);
  next.captions[0].text = "I like real-world experience in 2023.";
  writeFileSync(f.path, JSON.stringify(next));
  const refreshed = f.run(["--apply"]);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  const updated = JSON.parse(readFileSync(f.path));
  assert.ok(updated.pronunciationNotes.some((n) => n.word === "real-world"));
  assert.ok(!updated.pronunciationNotes.some((n) => n.word === "real-life"));
});

test("completed episodes and missing models stop before mutation", (t) => {
  const f = fixture(t);
  const before = readFileSync(f.path, "utf8");
  f.save("output/ep01/video.mp4", "published");
  assert.match(f.run(["--apply"]).stderr, /已有成片/);
  rmSync(join(f.cwd, ".cache/local-pronunciation/model/pytorch_model.bin"));
  assert.match(f.run(["--assess"]).stderr, /环境不完整/);
  assert.equal(readFileSync(f.path, "utf8"), before);
});
