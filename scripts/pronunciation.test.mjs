import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildPronunciationReport, getPronunciationConfig, getPronunciationEndpoint, getPronunciationSegments, parsePronunciationResponse } from "./pronunciation.mjs";

const segment = { startMs: 1000, endMs: 3000, referenceText: "I scrolled.", captions: [0] };
const response = (word = "scrolled", accuracy = 55) => ({
  RecognitionStatus: "Success", Offset: 1000000,
  NBest: [{ AccuracyScore: 80, Words: [{ Word: word, Offset: 3000000, Duration: 5000000, AccuracyScore: accuracy, ErrorType: accuracy < 60 ? "Mispronunciation" : "None",
    Phonemes: [{ Phoneme: "s", AccuracyScore: 90 }, { Phoneme: "oʊ", AccuracyScore: 40, NBestPhonemes: [{ Phoneme: "uː", Score: 70 }, { Phoneme: "oʊ", Score: 30 }] }],
  }] }],
});

test("pronunciation requests use original phrases and split before the 30-second limit", () => {
  const m = { video: { durationMs: 40000 }, captions: [
    { text: "I go,", startMs: 0, endMs: 15000 }, { text: "and he go.", startMs: 15000, endMs: 30000 }, { text: "Bye.", startMs: 30000, endMs: 40000 },
  ], corrections: [{ original: "go", corrected: "went" }] };
  assert.deepEqual(getPronunciationSegments(m).map((s) => s.referenceText), ["I go,", "and he go.", "Bye."]);
  m.captions[1].endMs = 28000;
  assert.equal(getPronunciationSegments(m)[0].referenceText, "I go, and he go.");
  m.captions[0].endMs = 29000;
  assert.throws(() => getPronunciationSegments(m), /超过 28 秒/);
  m.captions[0].endMs = -1;
  assert.throws(() => getPronunciationSegments(m), /字幕或时间轴无效/);
});

test("Azure endpoint validation prevents sending keys to arbitrary hosts or redirects", () => {
  assert.match(getPronunciationEndpoint({ AZURE_SPEECH_REGION: "southeastasia" }), /^https:\/\/southeastasia\.stt\.speech\.microsoft\.com\/speech\//);
  assert.match(getPronunciationEndpoint({ AZURE_SPEECH_ENDPOINT: "https://my-speech.cognitiveservices.azure.com/" }), /azure\.com\/stt\/speech\//);
  for (const endpoint of ["http://eastus.stt.speech.microsoft.com/", "https://evil.test/", "https://eastus.stt.speech.microsoft.com.evil.test/", "https://key@eastus.stt.speech.microsoft.com/", "https://eastus.stt.speech.microsoft.com/?key=secret", "https://my-speech.cognitiveservices.azure.com:8443/"]) {
    assert.throws(() => getPronunciationEndpoint({ AZURE_SPEECH_ENDPOINT: endpoint }));
  }
  assert.throws(() => getPronunciationEndpoint({ AZURE_SPEECH_REGION: "eastus/evil" }));
  const config = getPronunciationConfig("There is a other line.");
  assert.equal(config.ReferenceText, "There is a other line.");
  assert.equal(config.EnableProsodyAssessment, false);
  assert.equal(config.PhonemeAlphabet, "IPA");
});

test("flat REST and nested SDK responses retain real scores, candidate phonemes and clip-relative offsets", () => {
  const raw = response();
  const expected = parsePronunciationResponse(raw, segment);
  assert.equal(expected.words[0].startMs, 1300);
  assert.equal(expected.words[0].endMs, 1800);
  assert.equal(expected.words[0].suspectedMispronunciation, true);
  assert.equal(expected.words[0].phonemes[1].alternatives[0].phoneme, "uː");
  const best = raw.NBest[0];
  best.PronunciationAssessment = { AccuracyScore: best.AccuracyScore }; delete best.AccuracyScore;
  const word = best.Words[0];
  word.PronunciationAssessment = { AccuracyScore: word.AccuracyScore, ErrorType: word.ErrorType };
  delete word.AccuracyScore; delete word.ErrorType;
  for (const p of word.Phonemes) { p.PronunciationAssessment = { AccuracyScore: p.AccuracyScore, ...(p.NBestPhonemes ? { NBestPhonemes: p.NBestPhonemes } : {}) }; delete p.AccuracyScore; delete p.NBestPhonemes; }
  assert.deepEqual(parsePronunciationResponse(raw, segment), expected);
});

test("transcription-only, missing phonemes, malformed scores and invalid timings never become assessments", () => {
  for (const value of [null, { RecognitionStatus: "NoMatch" }, { RecognitionStatus: "Success", NBest: [{ Words: [] }] }]) assert.throws(() => parsePronunciationResponse(value, segment));
  for (const mutate of [
    (r) => { r.NBest[0].AccuracyScore = "80"; },
    (r) => { r.NBest[0].Words[0].Phonemes = []; },
    (r) => { r.NBest[0].Words[0].Phonemes[0].AccuracyScore = -1; },
    (r) => { r.NBest[0].Words[0].Offset = 50000000; },
    (r) => { r.NBest[0].Words[0].Duration = -1; },
  ]) { const raw = response(); mutate(raw); assert.throws(() => parsePronunciationResponse(raw, segment)); }
});

test("omissions are distinct from pronunciation errors, and unmatched times require review", () => {
  const raw = response();
  raw.NBest[0].Words.push({ Word: "missing", ErrorType: "Omission" });
  const result = parsePronunciationResponse(raw, segment);
  assert.equal(result.words[1].startMs, null);
  assert.equal(result.words[1].suspectedMispronunciation, false);
  const m = { captions: [{ text: "I scrolled.", startMs: 1000, endMs: 3000 }], pronunciationNotes: [{ word: "scrolled", startMs: 1300, endMs: 1800, source: "user-confirmed" }] };
  const before = structuredClone(m);
  const report = buildPronunciationReport(m, [{ ...segment, assessment: result }]);
  assert.equal(report.candidates.length, 1);
  assert.equal(report.candidates[0].candidateNote.source, "assessment");
  assert.equal(report.userConfirmedComparison[0].status, "flagged");
  assert.deepEqual(m, before);
  m.captions[0].endMs = 1500;
  assert.equal(buildPronunciationReport(m, [{ ...segment, assessment: result }]).candidates[0].candidateNote, null);
});

const fixture = (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "coach-pronunciation-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const assets = join(cwd, "public/ep01"); mkdirSync(assets, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=black:s=32x32:r=25:d=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest", join(assets, "video.mp4")]);
  const motion = { meta: { episode: 1 }, video: { src: "ep01/video.mp4", durationMs: 3000 }, captions: [{ text: "I scrolled.", startMs: 0, endMs: 1500 }, { text: "She scolds.", startMs: 1500, endMs: 3000 }], corrections: [{ original: "scrolled", corrected: "was scrolling" }], pronunciationNotes: [{ word: "scrolled", startMs: 300, endMs: 800, source: "user-confirmed" }, { word: "scolds", startMs: 1800, endMs: 2300, source: "user-confirmed" }], summary: { assessment: { grammar: 31, vocabulary: 28, naturalness: 26 } } };
  const path = join(assets, "motion.json"); writeFileSync(path, JSON.stringify(motion));
  writeFileSync(join(cwd, "episode.config.json"), '{"episode":1}');
  const script = fileURLToPath(new URL("./assess-pronunciation.mjs", import.meta.url));
  const run = (args = [], fetchCode = 'globalThis.fetch = () => { throw new Error("Unexpected paid request"); };', configured = true) => spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(fetchCode)}`, script, ...args], { cwd, encoding: "utf8", env: { ...process.env, AZURE_SPEECH_KEY: configured ? "test-secret" : "", AZURE_SPEECH_REGION: configured ? "eastus" : "", AZURE_SPEECH_ENDPOINT: "" } });
  const mock = (failSecond = false) => `import assert from 'node:assert/strict';
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(url).hostname,'eastus.stt.speech.microsoft.com');
      assert.equal(init.redirect,'error');
      assert.equal(init.headers['Ocp-Apim-Subscription-Key'],'test-secret');
      assert.equal(init.body.subarray(0,4).toString(),'RIFF');
      const config=JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'],'base64'));
      assert.equal(config.EnableProsodyAssessment,false);
      assert.equal(config.Granularity,'Phoneme');
      assert(!config.ReferenceText.includes('was scrolling'));
      const second=config.ReferenceText.includes('scolds');
      if(second && ${failSecond}) return {ok:false,status:429};
      const raw=${JSON.stringify(response())};
      if(second){raw.NBest[0].Words[0].Word='scolds';raw.NBest[0].Words[0].AccuracyScore=80;raw.NBest[0].Words[0].ErrorType='None';}
      return {ok:true,json:async()=>raw};
    };`;
  return { cwd, path, motion, run, mock, work: join(cwd, "output/_work/ep01/pronunciation") };
};

test("default check is read-only and missing credentials stop before audio generation or requests", (t) => {
  const f = fixture(t); const before = readFileSync(f.path, "utf8");
  const checked = f.run();
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /"requests": 2/);
  assert(!checked.stdout.includes("test-secret"));
  const missing = f.run(["--assess"], undefined, false);
  assert.match(missing.stderr, /实测缺少配置/);
  assert.equal(existsSync(f.work), false);
  assert.equal(readFileSync(f.path, "utf8"), before);
});

test("real audio preparation and mocked Azure scores produce review reports, preserve source data and reuse caches", (t) => {
  const f = fixture(t); const before = readFileSync(f.path, "utf8");
  const result = f.run(["--assess"], f.mock());
  assert.equal(result.status, 0, result.stderr);
  assert(!result.stdout.includes("test-secret") && !result.stderr.includes("test-secret"));
  const report = JSON.parse(readFileSync(join(f.work, "report.json")));
  assert.deepEqual(report.userConfirmedComparison.map((c) => c.status), ["flagged", "not-flagged"]);
  assert.equal(report.prosodyEnabled, false);
  assert.equal(report.candidates.length, 1);
  assert.equal(readFileSync(f.path, "utf8"), before);
  assert.equal(readdirSync(join(f.work, "cache")).length, 2);
  const audio = readdirSync(f.work).find((p) => p.endsWith(".wav"));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", join(f.work, audio)]));
  assert.equal(probe.streams[0].sample_rate, "16000");
  assert.equal(probe.streams[0].channels, 1);
  assert.equal(probe.streams[0].codec_name, "pcm_s16le");
  const reused = f.run(["--assess"]);
  assert.equal(reused.status, 0, reused.stderr);
  assert.match(reused.stdout, /复用发音测评 2\/2/);
  assert.equal(readFileSync(f.path, "utf8"), before);
});

test("a later failed request keeps earlier caches and reruns only the missing segment", (t) => {
  const f = fixture(t); const before = readFileSync(f.path, "utf8");
  const failed = f.run(["--assess"], f.mock(true));
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /HTTP 429/);
  assert(!failed.stderr.includes("test-secret"));
  assert.equal(existsSync(join(f.work, "report.json")), false);
  assert.equal(readdirSync(join(f.work, "cache")).length, 1);
  assert.equal(readFileSync(f.path, "utf8"), before);
  const resumed = f.run(["--assess"], f.mock());
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /复用发音测评 1\/2/);
});

test("pronunciation assesses the verified original audio after denoising, and refuses a mismatched backup", (t) => {
  const f = fixture(t);
  const video = join(f.cwd, "public/ep01/video.mp4");
  const backup = join(f.cwd, "public/ep01/video.before-denoise.mp4");
  const original = readFileSync(video);
  writeFileSync(backup, original);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", backup, "-c:v", "copy", "-af", "volume=0", "-c:a", "aac", video]);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  writeFileSync(`${video}.denoise.json`, JSON.stringify({ db: 6, inputHash: hash(original), outputHash: hash(readFileSync(video)) }));
  const result = f.run(["--assess"], f.mock());
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(join(f.work, "report.json")));
  assert.equal(report.videoHash, hash(original));
  const audio = readdirSync(f.work).find((p) => p.endsWith(".wav"));
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-i", join(f.work, audio), "-f", "f32le", "-"]);
  let power = 0;
  for (let i = 0; i < bytes.length; i += 4) power += bytes.readFloatLE(i) ** 2;
  assert.ok(Math.sqrt(power / (bytes.length / 4)) > 0.02, "the unprocessed voice must be assessed, not the modified silent working audio");
  writeFileSync(backup, "stale source");
  const stale = f.run();
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /处理记录或当前视频不匹配/);
});

test("a transcription-only success cannot create a pronunciation report or successful cache", (t) => {
  const f = fixture(t);
  const result = f.run(["--assess"], `globalThis.fetch=async()=>({ok:true,json:async()=>({RecognitionStatus:'Success',NBest:[{Words:[{Word:'scrolled'}]}]})});`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /普通转写成功不代表发音测评成功/);
  assert.equal(existsSync(join(f.work, "report.json")), false);
  assert.equal(readdirSync(join(f.work, "cache")).length, 0);
});
