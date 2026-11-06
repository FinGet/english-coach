// 可选独立 API 流程：node scripts/audit.mjs --episode 2 --video ep02/video.mp4
// 字幕与审核结果放入 public/epXX/，历史仍写入 error_history.json。
// .env：LLM_API_KEY（必填）、LLM_BASE_URL（默认 DeepSeek）、LLM_MODEL（默认 deepseek-chat），任意 OpenAI 兼容接口均可
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { validateAssessment } from "./assessment.mjs";
import { getEpisodePaths } from "./project-paths.mjs";
import { getNarrationSentences } from "./narration.mjs";

try {
  process.loadEnvFile();
} catch {}

const { values } = parseArgs({
  options: { episode: { type: "string" }, video: { type: "string" }, captions: { type: "string" } },
});
const episode = Number(values.episode);
if (!episode || !values.video) throw new Error("用法：node scripts/audit.mjs --episode <期数> --video <public 下的视频文件名>");
if (!process.env.LLM_API_KEY) throw new Error("缺少 LLM_API_KEY，请在 .env 中配置");

const HISTORY = "error_history.json";
const paths = getEpisodePaths(episode);
const MOTION = paths.motion;
const HIT_AT = 3;
const MAX_HITS = 2;
const FIX_MS = 560;

const words = JSON.parse(readFileSync(values.captions ?? paths.captions, "utf8"));
const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : {};
const previous = existsSync(MOTION) ? JSON.parse(readFileSync(MOTION, "utf8")) : null;
const durationMs = Math.round(
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `public/${values.video}`])) * 1000,
);

const counts = {};
Object.entries(history)
  .filter(([ep]) => Number(ep) < episode)
  .forEach(([, list]) => list.forEach((f) => (counts[f] = (counts[f] ?? 0) + 1)));

const res = await fetch(`${process.env.LLM_BASE_URL ?? "https://api.deepseek.com"}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
  body: JSON.stringify({
    model: process.env.LLM_MODEL ?? "deepseek-chat",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: readFileSync("scripts/audit-prompt.md", "utf8") },
      { role: "user", content: JSON.stringify({ words: words.map((w) => w.text.trim()), knownFingerprints: counts }) },
    ],
  }),
});
if (!res.ok) throw new Error(`大模型请求失败：${res.status} ${await res.text()}`);
const llm = JSON.parse((await res.json()).choices[0].message.content);
const assessment = validateAssessment(llm.assessment);

// 大模型只负责断句和加标点，时间一律取自转写的词级时间戳
const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
const flat = words.flatMap((w, i) => tokens(w.text).map((t) => ({ t, i })));
// 停顿有时会被 ASR 标成超长“词”，下一句字幕会提前出现
const PHANTOM_MS = 1200;
const sentenceStartMs = (first, last) => {
  const w = words[flat[first].i];
  if (w.endMs - w.startMs > PHANTOM_MS && last > first) return words[flat[first + 1].i].startMs;
  return w.startMs;
};

let cursor = 0;
const captions = llm.captions
  .filter((text) => tokens(text).length > 0)
  .map((text) => {
    const toks = tokens(text);
    if (toks.some((t, k) => t !== flat[cursor + k]?.t)) throw new Error(`大模型改动了原文，请重跑：「${text}」`);
    const first = cursor;
    cursor += toks.length;
    return { text, startMs: sentenceStartMs(first, cursor - 1), endMs: 0, first };
  });
if (cursor !== flat.length) throw new Error("大模型断句漏掉了部分原文，请重跑");
captions.forEach((c, k) => (c.endMs = captions[k + 1]?.startMs ?? durationMs));

let hits = 0;
const corrections = llm.corrections
  .flatMap((c) => {
    const caption = captions[c.caption];
    const index = caption ? caption.text.indexOf(c.original) : -1;
    if (index < 0) {
      console.warn(`跳过：第 ${c.caption} 句里找不到「${c.original}」`);
      return [];
    }
    const lastToken = caption.first + tokens(caption.text.slice(0, index + c.original.length)).length - 1;
    return [{ ...c, spokenMs: words[flat[lastToken].i].endMs }];
  })
  .sort((a, b) => a.spokenMs - b.spokenMs)
  // 纠错在错词说完时出现；3 级同时触发定格砸锤
  .map(({ caption, level, spokenMs, ...c }) => {
    if (level === 1) return { level: 1, ...c, startMs: spokenMs, endMs: spokenMs };
    counts[c.fingerprint] = (counts[c.fingerprint] ?? 0) + 1;
    if (counts[c.fingerprint] < HIT_AT || hits >= MAX_HITS) return { level: 2, ...c, startMs: spokenMs, endMs: spokenMs };
    hits++;
    return { level: 3, ...c, startMs: spokenMs, endMs: spokenMs + FIX_MS, repeatCount: counts[c.fingerprint] };
  })
  .sort((a, b) => a.startMs - b.startMs);

const mistakes = corrections.filter((c) => c.level > 1);
const worst = mistakes.filter((c) => c.level === 3).sort((a, b) => b.repeatCount - a.repeatCount)[0];
const coachNote = worst
  ? `老毛病：${worst.label}已经第 ${worst.repeatCount} 次了！`
  : mistakes.length
    ? `本期 ${mistakes.length} 处失误，下期继续盯着你！`
    : "本期零失误，教官暂时放过你！";

const nextMotion = {
  meta: { ...(previous?.meta ?? { creator: "Learner", title: "English speaking journal" }), episode },
  video: { src: values.video, durationMs },
  captions: captions.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
  corrections,
  ...(previous?.pronunciationNotes === undefined ? {} : { pronunciationNotes: previous.pronunciationNotes }),
  summary: { durationMs: 6000, coachNote, assessment },
};
// Text-only auditing cannot diagnose pronunciation; keep reviewed audio notes and reject stale matches before writing.
getNarrationSentences(nextMotion);
mkdirSync(paths.assets, { recursive: true });
writeFileSync(MOTION, JSON.stringify(nextMotion, null, 2));
history[episode] = mistakes.map((c) => c.fingerprint);
writeFileSync(HISTORY, JSON.stringify(history, null, 2));

console.log(`已写入 ${MOTION}：${captions.length} 句字幕，${corrections.length} 条纠错（老毛病 ${hits} 处）`);
corrections.forEach((c) => console.log(`  [${c.level}] ${c.original} → ${c.corrected}（${c.label}${c.repeatCount ? ` ×${c.repeatCount}` : ""}）`));
