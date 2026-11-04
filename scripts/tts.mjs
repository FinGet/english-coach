// 用法：node scripts/tts.mjs
// 把有纠错的句子改成教官版，用 ElevenLabs 美式女声朗读，写入 public/motion.json 的 summary.voice
// 环境变量或 .env：ELEVENLABS_API_KEY（必填）、ELEVENLABS_VOICE_ID（有默认音色）
import { existsSync, readFileSync, writeFileSync } from "node:fs";

try {
  process.loadEnvFile();
} catch {}

const MOTION = "public/motion.json";
const START_MS = 2000;
const TAIL_MS = 1500;
const SUMMARY_MS = 6000;

const motion = JSON.parse(readFileSync(MOTION, "utf8"));
const save = (summary) => writeFileSync(MOTION, JSON.stringify({ ...motion, summary }, null, 2));
const { voice: _, ...summary } = motion.summary;

const lines = motion.captions.flatMap((caption, i) => {
  const fixes = motion.corrections.filter((c) => c.startMs > caption.startMs && c.startMs <= caption.endMs);
  return fixes.length ? [{ caption: i, text: fixes.reduce((text, c) => text.replace(c.original, c.corrected), caption.text) }] : [];
});
if (!lines.length) {
  save({ ...summary, durationMs: SUMMARY_MS });
  console.log("本期没有纠错，跳过朗读");
  process.exit(0);
}

const text = lines.map((l) => l.text).join(" ");
const src = `ep${String(motion.meta.episode).padStart(2, "0")}-voice.mp3`;
if (motion.summary.voice?.text === text && existsSync(`public/${src}`)) {
  console.log("朗读内容没变，跳过");
  process.exit(0);
}
if (!process.env.ELEVENLABS_API_KEY) throw new Error("缺少 ELEVENLABS_API_KEY，请在 .env 中配置");

const res = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID ?? "hpp4J3VqNfWAUOO0d1Us"}/with-timestamps?output_format=mp3_44100_128`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.9 } }),
  },
);
if (!res.ok) throw new Error(`ElevenLabs 请求失败：${res.status} ${await res.text()}`);
const { audio_base64, alignment } = await res.json();
writeFileSync(`public/${src}`, Buffer.from(audio_base64, "base64"));

// 按字符时间戳切出每句的起止
const at = (seconds) => START_MS + Math.round(seconds * 1000);
let offset = 0;
const timed = lines.map((l) => {
  const line = {
    caption: l.caption,
    startMs: at(alignment.character_start_times_seconds[offset]),
    endMs: at(alignment.character_end_times_seconds[offset + l.text.length - 1]),
  };
  offset += l.text.length + 1;
  return line;
});

save({ ...summary, durationMs: Math.max(SUMMARY_MS, timed[timed.length - 1].endMs + TAIL_MS), voice: { src, text, startMs: START_MS, lines: timed } });
console.log(`已生成 public/${src}：朗读 ${lines.length} 句`);
