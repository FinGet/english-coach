// 用法：node scripts/trim-pauses.mjs [--episode 2] [--video public/ep02/video.mp4]
// 只删除音频确认的长静音；保留所有词及至少各 0.5s 余量，剪辑前备份并同步两份时间轴。
import { execFileSync, spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { basename, dirname, extname, join, resolve } from "node:path";
import { getEpisodePaths } from "./project-paths.mjs";

const { values } = parseArgs({
  options: {
    video: { type: "string" },
    episode: { type: "string" },
    motion: { type: "string" },
    words: { type: "string" },
    tail: { type: "string", default: "500" },
    head: { type: "string", default: "500" },
    minGap: { type: "string", default: "1000" },
  },
});

const MOTION = values.motion ?? getEpisodePaths(values.episode).motion;
const WORDS = values.words ?? join(dirname(MOTION), "captions.json");
const TAIL_MS = Number(values.tail);
const HEAD_MS = Number(values.head);
const MIN_GAP_MS = Number(values.minGap);
const NOISE_DB = -60;
if (![TAIL_MS, HEAD_MS, MIN_GAP_MS].every(Number.isFinite) || TAIL_MS < 500 || HEAD_MS < 500 || MIN_GAP_MS < 1000) {
  throw new Error("剪辑保护：tail/head 至少各 500ms，minGap 至少 1000ms，且必须是有效数字");
}
const motion = JSON.parse(readFileSync(MOTION, "utf8"));
const words = JSON.parse(readFileSync(WORDS, "utf8"));
const videoPath = values.video ?? `public/${motion.video.src}`;
if (!existsSync(videoPath)) throw new Error(`找不到视频：${videoPath}`);
if (motion.edit?.trimmedPauses > 0 || motion.edit?.cuts?.length > 0) throw new Error("视频已剪辑，请从剪辑前备份开始，不能重复裁剪旧时间轴");
if (existsSync(`${videoPath}.denoise.json`) || existsSync(join(dirname(videoPath), `${basename(videoPath, extname(videoPath))}.before-denoise${extname(videoPath)}`))) throw new Error("请先依据原声剪静音，再应用降噪；转写可使用独立降噪副本");

const durationOf = (path) => Math.round(
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" })) * 1000,
);
const durationMs = durationOf(videoPath);
if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(motion.video.durationMs) || Math.abs(motion.video.durationMs - durationMs) > 100) {
  throw new Error("视频时长与 motion.json 不一致，请先确认同一版本的视频和字幕");
}
for (const [label, list] of [["逐词字幕", words], ["句级字幕", motion.captions], ["纠错", motion.corrections], ["发音标注", motion.pronunciationNotes ?? []]]) {
  if (!Array.isArray(list) || (["逐词字幕", "句级字幕"].includes(label) && !list.length)) throw new Error(`${label}数据无效`);
  for (const item of list) {
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < 0 || item.endMs < item.startMs || item.endMs > durationMs + 100 ||
      (label === "逐词字幕" && (typeof item.text !== "string" || !item.text.trim() || (item.timestampMs != null && (!Number.isFinite(item.timestampMs) || item.timestampMs < item.startMs || item.timestampMs > item.endMs))))) {
      throw new Error(`${label}时间戳与视频不匹配，请在同一视频上重新转写/审核，不能使用剪辑前的旧时间轴`);
    }
  }
}

// ASR 没有词不等于静音；即使漏识别一句话，也必须由实际音频否决裁剪。
const detection = spawnSync("ffmpeg", [
  "-hide_banner", "-nostats", "-i", videoPath, "-map", "0:a:0", "-vn",
  "-af", `silencedetect=noise=${NOISE_DB}dB:d=${MIN_GAP_MS / 1000}`, "-f", "null", "-",
], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
if (detection.error || detection.status !== 0) throw new Error(`无法检测静音，停止剪辑：${detection.error?.message ?? detection.stderr}`);

const trims = [];
let silenceStart = null;
for (const match of detection.stderr.matchAll(/silence_(start|end):\s*([-+\d.eE]+)/g)) {
  const ms = Math.round(Number(match[2]) * 1000);
  if (!Number.isFinite(ms)) throw new Error("静音检测时间无效，停止剪辑");
  if (match[1] === "start") {
    silenceStart = ms;
    continue;
  }
  if (silenceStart === null) continue;
  const cutStart = silenceStart + TAIL_MS;
  const cutEnd = ms - HEAD_MS;
  if (silenceStart > 0 && ms < durationMs - 100 && cutEnd > cutStart &&
    ![...words, ...(motion.pronunciationNotes ?? [])].some((w) => w.startMs <= cutEnd && w.endMs >= cutStart)) {
    if (trims.length && cutStart <= trims.at(-1).cutEnd) throw new Error("静音区间重叠，停止剪辑");
    trims.push({ cutStart, cutEnd, removed: cutEnd - cutStart });
  }
  silenceStart = null;
}

const remap = (ms) => {
  let out = ms;
  for (const t of trims) {
    if (ms > t.cutEnd) out -= t.removed;
    else if (ms > t.cutStart) out -= ms - t.cutStart;
  }
  return out;
};

const segments = [];
let fromMs = 0;
for (const t of trims) {
  segments.push({ startMs: fromMs, endMs: t.cutStart });
  fromMs = t.cutEnd;
}
segments.push({ startMs: fromMs, endMs: durationMs });

if (!trims.length) {
  console.log("没有可安全删除的长静音，保留视频和字幕");
  process.exit(0);
}

if (motion.summary?.voice) throw new Error("请在复习配音之前剪静音，避免已有配音与时间轴错位");
const originals = [videoPath, WORDS, MOTION];
if (new Set(originals.map((p) => resolve(p))).size !== originals.length) throw new Error("视频、逐词字幕、motion 路径必须各不相同");
const backups = originals.map((path) => join(dirname(path), `${basename(path, extname(path))}.before-trim${extname(path)}`));
if (backups.some(existsSync)) throw new Error("剪辑前备份已存在，请保留并检查，不覆盖备份或重复裁剪");
for (let i = 0; i < originals.length; i++) copyFileSync(originals[i], backups[i], constants.COPYFILE_EXCL);

const tempDir = mkdtempSync(join(dirname(videoPath), ".trim-"));
const tmpOut = join(tempDir, "video.mp4");
const vParts = [];
const aParts = [];
segments.forEach((s, i) => {
  const a = s.startMs / 1000;
  const b = s.endMs / 1000;
  vParts.push(`[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
  aParts.push(`[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS[a${i}]`);
});
const concatIn = segments.map((_, i) => `[v${i}][a${i}]`).join("");
const filter = `${vParts.join(";")};${aParts.join(";")};${concatIn}concat=n=${segments.length}:v=1:a=1[v][a]`;

try {
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-y", "-i", videoPath, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmpOut],
    { stdio: "inherit" },
  );
  const saved = trims.reduce((s, t) => s + t.removed, 0);
  const actualDurationMs = durationOf(tmpOut);
  if (!Number.isFinite(actualDurationMs) || Math.abs(actualDurationMs - (durationMs - saved)) > 100) throw new Error("剪辑输出时长异常，保留原文件");

  motion.captions = motion.captions.map((c) => ({
    ...c,
    startMs: remap(c.startMs),
    endMs: remap(c.endMs),
  }));
  motion.corrections = motion.corrections.map((c) => ({ ...c, startMs: remap(c.startMs), endMs: remap(c.endMs) }));
  if (motion.pronunciationNotes) motion.pronunciationNotes = motion.pronunciationNotes.map((note) => ({ ...note, startMs: remap(note.startMs), endMs: remap(note.endMs) }));
  motion.video.durationMs = actualDurationMs;
  motion.edit = { method: "acoustic-silence", noiseDb: NOISE_DB, tailMs: TAIL_MS, headMs: HEAD_MS, minTrimGapMs: MIN_GAP_MS, trimmedPauses: trims.length, cuts: trims };

  const remappedWords = words.map((w) => ({
    ...w, startMs: remap(w.startMs), endMs: remap(w.endMs),
    ...(w.timestampMs == null ? {} : { timestampMs: remap(w.timestampMs) }),
  }));
  writeFileSync(join(tempDir, "captions.json"), JSON.stringify(remappedWords, null, 2));
  writeFileSync(join(tempDir, "motion.json"), JSON.stringify(motion, null, 2));
  try {
    renameSync(tmpOut, videoPath);
    renameSync(join(tempDir, "captions.json"), WORDS);
    renameSync(join(tempDir, "motion.json"), MOTION);
  } catch (error) {
    for (let i = 0; i < originals.length; i++) copyFileSync(backups[i], originals[i]);
    throw error;
  }

  console.log(`已剪 ${trims.length} 处音频确认的长静音，共省 ${(saved / 1000).toFixed(1)}s，两端保留 ${TAIL_MS}+${HEAD_MS}ms；逐词和句级时间轴已同步`);
  console.log(`剪辑前备份：${backups.join("、")}`);
  trims.forEach((t, i) =>
    console.log(`  ${i + 1}. 删除 ${(t.cutStart / 1000).toFixed(3)}–${(t.cutEnd / 1000).toFixed(3)}s 的静音`),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
