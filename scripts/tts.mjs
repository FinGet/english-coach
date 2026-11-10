// 检查：npm run tts:check；人工审核预览后生成：npm run tts
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getNarrationSentences, getSentenceTimings, getTtsRequest } from "./narration.mjs";
import { getEpisodePaths } from "./project-paths.mjs";
import { getCachedDictionaryAudio, getDictionaryCacheKey, prepareDictionaryAudio } from "./dictionary-audio.mjs";

const { values } = parseArgs({ options: {
  check: { type: "boolean", default: false },
  approved: { type: "boolean", default: false },
  episode: { type: "string" },
} });
if (values.check && values.approved) throw new Error("检查和生成请分开运行");
try { process.loadEnvFile(); } catch {}
// Desktop agents may omit exports from .zshrc; recover only the two TTS variables without logging them.
if (!process.env.ELEVENLABS_API_KEY && process.platform !== "win32") {
  const shell = spawnSync(process.env.SHELL || "/bin/zsh", ["-lic",
    'printf \'\\0COACH_TTS_ENV\\0%s\\0%s\\0\' "$ELEVENLABS_API_KEY" "$ELEVENLABS_VOICE_ID"',
  ], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
  const marker = "\0COACH_TTS_ENV\0";
  const offset = shell.stdout?.lastIndexOf(marker) ?? -1;
  if (shell.status === 0 && offset >= 0) {
    const [key, voice, tail] = shell.stdout.slice(offset + marker.length).split("\0");
    if (tail !== undefined && key) {
      process.env.ELEVENLABS_API_KEY = key;
      if (!process.env.ELEVENLABS_VOICE_ID && voice) process.env.ELEVENLABS_VOICE_ID = voice;
    }
  }
}

const paths = getEpisodePaths(values.episode);
const MOTION = paths.motion;
const CACHE = paths.cache;
const START_MS = 2000;
const GAP_MS = 350;
const motion = JSON.parse(readFileSync(MOTION, "utf8"));
if (motion.meta.episode !== paths.episode) throw new Error(`期数不一致，请核对 ${MOTION} 的 meta.episode`);
const sentences = getNarrationSentences(motion);
const voiceId = process.env.ELEVENLABS_VOICE_ID || "hpp4J3VqNfWAUOO0d1Us";
const entries = sentences.map((sentence) => ({ sentence, kind: "sentence" }));
const words = (motion.pronunciationNotes ?? []).map((note) => ({ note, cached: getCachedDictionaryAudio(note), key: getDictionaryCacheKey(note) }));
const missingWords = [...new Map(words.filter((item) => !item.cached).map((item) => [item.key, item])).values()];
const plan = entries.map((entry) => {
  const { sentence } = entry;
  const { request, generationKey } = getTtsRequest(sentence.text, voiceId);
  const src = `${paths.cacheSrc}/${generationKey}.mp3`;
  const metadata = `${CACHE}/${generationKey}.json`;
  let cached = null;
  if (existsSync(metadata) && existsSync(`public/${src}`)) {
    try {
      const data = JSON.parse(readFileSync(metadata, "utf8"));
      const timings = getSentenceTimings(sentence, data.alignment);
      if (data.generationKey === generationKey && data.text === sentence.text && Number.isFinite(data.durationMs) && data.durationMs >= timings.at(-1).endMs) cached = data;
    } catch { /* 缓存不完整时只重新生成这一句。 */ }
  }
  return { ...entry, request, generationKey, src, metadata, cached };
});
const missing = [...new Map(plan.filter((item) => !item.cached).map((item) => [item.generationKey, item])).values()];
if (!values.approved) {
  console.log(JSON.stringify({
    status: !plan.length && !words.length ? "none" : missing.length || missingWords.length ? "missing" : "cached",
    sentences: sentences.length,
    pronunciationWords: words.length,
    dictionaryDownloads: missingWords.length,
    dictionaryConfigured: Boolean(process.env.MERRIAM_WEBSTER_DICTIONARY_KEY || process.env.MERRIAM_WEBSTER_LEARNERS_KEY),
    dictionaryWords: words.map((item) => ({ word: item.note.word, provider: "merriam-webster", cached: Boolean(item.cached) })),
    reuse: plan.length - missing.length,
    generate: missing.length,
    charactersToGenerate: missing.reduce((sum, item) => sum + Array.from(item.sentence.text).length, 0),
    lines: plan.map((item) => ({ kind: item.kind, text: item.sentence.text, captions: item.sentence.parts.map((part) => part.caption), cached: Boolean(item.cached) })),
  }, null, 2));
  console.log("只检查，不修改文件、不调用词典或 ElevenLabs。人工审核预览通过后，再运行 npm run tts。");
  process.exit(0);
}
if (missing.length && !process.env.ELEVENLABS_API_KEY) throw new Error("缺少 ELEVENLABS_API_KEY，请使用已有环境变量或本地 .env");
// 先确认本地工具可用，避免生成后才发现无法测量音频。
if (missing.length || missingWords.length) execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
// Resolve exact dictionary recordings before spending any narration credits.
for (const item of words) item.audio = item.cached ?? await prepareDictionaryAudio(item.note);
mkdirSync(CACHE, { recursive: true });
for (const item of missing) {
  console.log(`生成句子：${item.sentence.text}`);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify(item.request),
  });
  if (!res.ok) throw new Error(`ElevenLabs 请求失败：${res.status}。已成功的句子保留在缓存中，重跑只补缺失句子。`);
  const { audio_base64, alignment } = await res.json();
  if (typeof audio_base64 !== "string" || !audio_base64) throw new Error("ElevenLabs 返回的音频无效");
  const timings = getSentenceTimings(item.sentence, alignment);
  const path = `public/${item.src}`;
  const temporary = `${path}.tmp.mp3`;
  writeFileSync(temporary, Buffer.from(audio_base64, "base64"));
  const durationMs = Math.ceil(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", temporary], { encoding: "utf8" }).trim()) * 1000);
  if (!Number.isFinite(durationMs) || durationMs < timings.at(-1).endMs) throw new Error("音频时长与时间戳不匹配，保留已有文件");
  renameSync(temporary, path);
  item.cached = { generationKey: item.generationKey, text: item.sentence.text, durationMs, alignment };
  writeFileSync(item.metadata, JSON.stringify(item.cached, null, 2) + "\n");
  for (const other of plan) {
    if (other.generationKey === item.generationKey) other.cached = item.cached;
  }
}

let cursor = START_MS;
const clips = [];
const lines = [];
for (const item of plan) {
  clips.push({ src: item.src, startMs: cursor });
  lines.push(...getSentenceTimings(item.sentence, item.cached.alignment).map((line) => ({ ...line, startMs: line.startMs + cursor, endMs: line.endMs + cursor })));
  cursor += item.cached.durationMs + GAP_MS;
}
const { voice: _, ...summary } = motion.summary;
motion.summary = {
  ...summary,
  durationMs: Math.max(6000, cursor - GAP_MS + 1500),
  ...(sentences.length ? { voice: { text: sentences.map((sentence) => sentence.text).join(" "), startMs: START_MS, clips, lines } } : {}),
};
for (const item of words) {
  const { src, durationMs, sourceUrl, dictionary, audioId, ipa } = item.audio;
  item.note.audio = { src, word: item.note.word, durationMs, provider: "merriam-webster", sourceUrl, dictionary, audioId, ipa };
}
writeFileSync(MOTION, JSON.stringify(motion, null, 2) + "\n");
console.log(`已添加 ${sentences.length} 句朗读：复用 ${plan.length - missing.length} 项，新生成 ${missing.length} 项；${words.length} 个韦氏单词示范。请预览音频和高亮后再导出。`);
