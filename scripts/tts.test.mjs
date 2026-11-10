import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  // Every subprocess replaces fetch: tests cannot contact external services.
  const run = (args = [], fetchCode = 'globalThis.fetch = () => { throw new Error("Unexpected paid request"); };', env = {}) => spawnSync(process.execPath, [
    "--import", `data:text/javascript,${encodeURIComponent(fetchCode)}`, script, ...args,
  ], { cwd, encoding: "utf8", env: { ...process.env, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_VOICE_ID: "test-voice", MERRIAM_WEBSTER_DICTIONARY_KEY: "test-dictionary", MERRIAM_WEBSTER_LEARNERS_KEY: "test-learners", ...env } });
  const mock = (failAt = 0) => {
    const audio = join(cwd, "speech.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audio]);
    return `import { readFileSync } from 'node:fs'; let calls = 0;
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('dictionaryapi.com/')) {
          const word=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
          return new Response(JSON.stringify([{meta:{id:word},hwi:{hw:word,prs:[{ipa:'ɡoʊ',sound:{audio:'test_'+word}}]}}]));
        }
        if (String(url).includes('media.merriam-webster.com/')) return new Response(readFileSync(${JSON.stringify(audio)}));
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

test("global shell credentials work without a local env file and are never logged", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  const shell = join(f.cwd, "mock-shell");
  writeFileSync(shell, "#!/bin/sh\nprintf 'startup message\\n\\000COACH_TTS_ENV\\000global-test-key\\000global-test-voice\\000exit message\\n'\n", { mode: 0o700 });
  const mock = f.mock() + `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (init.headers['xi-api-key'] !== 'global-test-key' || !url.includes('/global-test-voice/')) throw new Error('Global credentials not loaded');
      return originalFetch(url, init);
    };`;
  const result = f.run(["--approved"], mock, { ELEVENLABS_API_KEY: "", ELEVENLABS_VOICE_ID: "", SHELL: shell });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(readFileSync(f.path)).summary.voice);
  assert.doesNotMatch(result.stdout + result.stderr, /global-test-key|startup message|exit message/);
  // An inherited/local key must win; this shell must not replace it.
  const existing = f.run(["--check"], undefined, { SHELL: shell });
  assert.equal(existing.status, 0, existing.stderr);
  assert.match(existing.stdout, /"generate": 1/);
});

test("failed shell credential loading leaves check mode read-only and generation fails safely", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  const before = readFileSync(f.path, "utf8");
  const env = { ELEVENLABS_API_KEY: "", ELEVENLABS_VOICE_ID: "", SHELL: join(f.cwd, "missing-shell") };
  assert.equal(f.run(["--check"], undefined, env).status, 0);
  const result = f.run(["--approved"], undefined, env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /缺少 ELEVENLABS_API_KEY/);
  assert.equal(readFileSync(f.path, "utf8"), before);
  assert.equal(existsSync(join(f.cwd, "public/_cache/tts")), false);
});

test("adjacent problem clauses share one clip and retain character offsets for highlighting", () => {
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

test("adjacent pronunciation clauses share one clip without reading IPA or instructions aloud", () => {
  const motion = {
    video: { durationMs: 3000 },
    captions: [{ text: "I scrolled,", startMs: 0, endMs: 1000 }, { text: "then she scolds me.", startMs: 1000, endMs: 2500 }, { text: "Bye.", startMs: 2500, endMs: 3000 }],
    corrections: [],
    pronunciationNotes: [
      { word: "scrolled", ipa: "/skroʊld/", tip: "Practice the vowel.", startMs: 200, endMs: 600, source: "user-confirmed" },
      { word: "scolds", ipa: "/skoʊldz/", tip: "Practice the ending.", startMs: 1500, endMs: 2000, source: "assessment" },
    ],
  };
  const sentences = getNarrationSentences(motion);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, "I scrolled, then she scolds me.");
  assert.deepEqual(sentences[0].parts.map((p) => p.caption), [0, 1]);
  motion.pronunciationNotes[1].word = "scold";
  assert.throws(() => getNarrationSentences(motion), /发音标注已不匹配/);
});

test("GPS narration excludes the unaffected introduction and following clause", () => {
  const motion = {
    video: { durationMs: 6000 },
    captions: [
      { text: "He said, when your car takes a wrong turn,", startMs: 0, endMs: 2000 },
      { text: "the navigation never scolds you,", startMs: 2000, endMs: 4000 },
      { text: "and it just says softly, rerouting.", startMs: 4000, endMs: 6000 },
    ],
    corrections: [{ original: "the navigation", corrected: "your GPS", startMs: 2500 }],
    pronunciationNotes: [{ word: "scolds", ipa: "/skoʊldz/", tip: "Keep the final consonants.", startMs: 3000, endMs: 3500, source: "user-confirmed" }],
  };
  const before = structuredClone(motion);
  const sentences = getNarrationSentences(motion);
  assert.deepEqual(sentences.map((sentence) => sentence.text), ["Your GPS never scolds you."]);
  assert.deepEqual(sentences[0].parts, [{ caption: 1, text: "Your GPS never scolds you.", offset: 0 }]);
  assert.deepEqual(motion, before);
});

test("necessary context is explicit and unrelated clauses between mistakes are excluded", () => {
  const motion = {
    video: { durationMs: 4000 },
    captions: [
      { text: "What destiny keep you from achieving", startMs: 0, endMs: 1000 },
      { text: "has something else in store for you,", startMs: 1000, endMs: 2000 },
      { text: "and I think about that,", startMs: 2000, endMs: 3000 },
      { text: "and we is ready.", startMs: 3000, endMs: 4000 },
    ],
    corrections: [
      { original: "What destiny keep you from achieving", corrected: "Whatever destiny keeps you from achieving, it", startMs: 500, narrationContext: "next" },
      { original: "is", corrected: "are", startMs: 3500 },
    ],
  };
  const sentences = getNarrationSentences(motion);
  assert.deepEqual(sentences.map((sentence) => sentence.text), [
    "Whatever destiny keeps you from achieving, it has something else in store for you.",
    "And we are ready.",
  ]);
  assert.deepEqual(sentences.map((sentence) => sentence.parts.map((part) => part.caption)), [[0, 1], [3]]);
  assert.equal(sentences[0].parts[1].offset, "Whatever destiny keeps you from achieving, it ".length);
  motion.corrections[0].narrationContext = "entire-sentence";
  assert.throws(() => getNarrationSentences(motion), /朗读语境只能/);
  motion.corrections[0].narrationContext = "previous";
  assert.throws(() => getNarrationSentences(motion), /朗读语境超出/);
});

test("the template review handoff preserves audited context for the shared narration selector", async (t) => {
  const f = fixture(t);
  copyFileSync(new URL("../motion-template/scripts/review.mjs", import.meta.url), join(f.cwd, "review.mjs"));
  copyFileSync(new URL("./assessment.mjs", import.meta.url), join(f.cwd, "assessment.mjs"));
  const { compileReview } = await import(pathToFileURL(join(f.cwd, "review.mjs")).href);
  const review = {
    captions: ["If she go,", "we are ready."],
    corrections: [{ caption: 0, original: "go", corrected: "goes", level: 2, label: "主谓一致", fingerprint: "grammar:agreement", narrationContext: "next" }],
    assessment: { grammar: 30, vocabulary: 25, naturalness: 25, note: "Synthetic test assessment." },
  };
  const compile = () => compileReview({
    review, words: ["If", "she", "go", "we", "are", "ready"].map((text, i) => ({ text, startMs: i * 100, endMs: (i + 1) * 100 })),
    durationMs: 600, episode: 1, video: "test.mp4",
  });
  const motion = compile();
  assert.equal(motion.corrections[0].narrationContext, "next");
  assert.equal(getNarrationSentences(motion)[0].text, "If she goes, we are ready.");
  review.corrections[0].narrationContext = "entire-sentence";
  assert.throws(compile, /Invalid narration context/);
});

test("invalid or stale pronunciation notes stop before paid narration or file changes", (t) => {
  const f = fixture(t);
  f.motion.pronunciationNotes = [{ word: "gone", ipa: "/ɡɑn/", tip: "Practice.", startMs: 200, endMs: 600, source: "self-report" }];
  f.save();
  const before = readFileSync(f.path, "utf8");
  assert.match(f.run(["--approved"]).stderr, /发音标注已不匹配/);
  assert.equal(readFileSync(f.path, "utf8"), before);
  f.motion.pronunciationNotes[0].source = "asr-guess";
  f.save();
  assert.match(f.run(["--approved"]).stderr, /来源或时间戳无效/);
  f.motion.pronunciationNotes[0] = { word: "go", ipa: "/ɡoʊ/", tip: "Practice.", startMs: 200, endMs: 600, source: "assessment" };
  for (const audio of [
    { src: "word.mp3", word: "wrong", durationMs: 500 },
    { src: "../word.mp3", word: "go", durationMs: 500 },
    { src: "https://example.com/word.mp3", word: "go", durationMs: 500 },
  ]) {
    f.motion.pronunciationNotes[0].audio = audio;
    f.save();
    assert.match(f.run(["--approved"]).stderr, /发音示范音频或单词不匹配/);
  }
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
  assert.match(reused.stdout, /复用 1 项，新生成 0 项/);
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
  assert.match(result.stdout, /复用 1 项，新生成 1 项/);
  const generated = JSON.parse(readFileSync(f.path, "utf8"));
  assert.equal(generated.summary.voice.clips.length, 2);
  assert.ok(generated.summary.voice.lines[1].startMs > generated.summary.voice.lines[0].endMs);
});

test("identical text within one run makes only one provider request and reuses its alignment", (t) => {
  const f = fixture(t);
  f.motion.captions[1].text = "I go.";
  f.motion.corrections.push({ original: "go", corrected: "went", startMs: 1700 });
  f.save();
  const check = f.run(["--check"]);
  assert.equal(check.status, 0, check.stderr);
  const plan = JSON.parse(check.stdout.slice(0, check.stdout.lastIndexOf("}") + 1));
  assert.equal(plan.sentences, 2);
  assert.equal(plan.generate, 1);
  assert.equal(plan.charactersToGenerate, "I went.".length);
  // A second request would fail; all fetches are mocked and cannot reach a provider.
  const generated = f.run(["--approved"], f.mock(2));
  assert.equal(generated.status, 0, generated.stderr);
  const motion = JSON.parse(readFileSync(f.path, "utf8"));
  assert.equal(motion.summary.voice.clips.length, 2);
  assert.equal(motion.summary.voice.clips[0].src, motion.summary.voice.clips[1].src);
  assert.deepEqual(motion.summary.voice.lines.map((line) => line.caption), [0, 1]);
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

test("pronunciation demos use dictionary recordings, reuse duplicates, and never send isolated words to ElevenLabs", (t) => {
  const f = fixture(t);
  f.motion.captions[1].text = "I go.";
  f.motion.pronunciationNotes = [200, 1200].map((startMs) => ({ word: "go", ipa: "/ɡoʊ/", tip: "Do not read this instruction.", startMs, endMs: startMs + 200, source: "assessment" }));
  f.save();
  const checked = f.run(["--check"]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /"pronunciationWords": 2/);
  assert.match(checked.stdout, /"generate": 2/);
  assert.match(checked.stdout, /"dictionaryDownloads": 1/);
  assert.doesNotMatch(checked.stdout, /ɡoʊ|Do not read/);
  const generated = f.run(["--approved"], f.mock() + `
    const fetchDemo = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (String(url).includes('api.elevenlabs.io') && !['I went.', 'I go.'].includes(JSON.parse(init.body).text)) throw new Error('Unrelated narration');
      return fetchDemo(url, init);
    };`);
  assert.equal(generated.status, 0, generated.stderr);
  const next = JSON.parse(readFileSync(f.path));
  assert.equal(next.summary.voice.clips.length, 2);
  assert.equal(next.pronunciationNotes[0].audio.src, next.pronunciationNotes[1].audio.src);
  assert.equal(next.pronunciationNotes[0].audio.durationMs > 0, true);
  assert.equal(next.pronunciationNotes[0].audio.provider, "merriam-webster");
  assert.equal(f.run(["--approved"]).status, 0, "all words and sentences must reuse cache without network");
  assert.match(f.run(["--check"]).stdout, /"generate": 0/);
});

test("failed dictionary audio prevents paid narration and preserves the previous motion", (t) => {
  const f = fixture(t);
  f.motion.pronunciationNotes = [{ word: "go", ipa: "/ɡoʊ/", tip: "Practice.", startMs: 200, endMs: 600, source: "assessment" }];
  f.save();
  const before = readFileSync(f.path, "utf8");
  const result = f.run(["--approved"], f.mock() + `
    const fetchOriginal=globalThis.fetch;
    globalThis.fetch=(url,init)=>{
      if(String(url).includes('media.merriam-webster.com')) return new Response('failed',{status:503});
      if(String(url).includes('api.elevenlabs.io')) throw new Error('Paid narration before dictionary failure');
      return fetchOriginal(url,init);
    };`);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.path, "utf8"), before);
  assert.match(result.stderr, /HTTP 503/);
  assert.equal(existsSync(join(f.cwd, "public/_cache/tts")), false);
  assert.equal(f.run(["--approved"], f.mock()).status, 0);
});

test("dictionary plans preserve acronym capitals and do not request synthetic word narration", (t) => {
  const f = fixture(t);
  f.motion.captions[0].text = "I use AI.";
  f.motion.corrections = [];
  f.motion.pronunciationNotes = [{ word: "AI", ipa: "/eɪ aɪ/", tip: "Letters.", startMs: 0, endMs: 700, source: "assessment" }];
  f.save();
  const result = f.run(["--check"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"word": "AI"/);
  assert.doesNotMatch(result.stdout, /"text": "ai\."|"text": "AI\."/);
});
