// 用法：node scripts/trim-pauses.mjs [--episode 2] [--video public/ep02/video.mp4]
// 句间 > minGap 时：上一句尾留 tail、下一句首留 head，中间死区删掉（默认各 0.5s，合计 1s）
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { dirname, join } from "node:path";
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
const TAIL_MS = Number(values.tail);
const HEAD_MS = Number(values.head);
const MIN_GAP_MS = Number(values.minGap);
const motion = JSON.parse(readFileSync(MOTION, "utf8"));
const words = JSON.parse(readFileSync(values.words ?? join(dirname(MOTION), "captions.json"), "utf8"));
const videoPath = values.video ?? `public/${motion.video.src}`;
if (!existsSync(videoPath)) throw new Error(`找不到视频：${videoPath}`);

const durationMs = Math.round(
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath])) * 1000,
);

const PHANTOM_MS = 1200;
const speechEndMs = (i) => {
  const lo = motion.captions[i].startMs;
  const hi = motion.captions[i + 1]?.startMs ?? durationMs;
  let end = lo;
  for (const w of words) {
    if (w.startMs < lo - 80 || w.startMs >= hi) continue;
    if (w.endMs - w.startMs > PHANTOM_MS) continue;
    end = Math.max(end, w.endMs);
  }
  return end;
};

const trims = [];
for (let i = 0; i < motion.captions.length - 1; i++) {
  const end = speechEndMs(i);
  const next = motion.captions[i + 1].startMs;
  const gap = next - end;
  const cutStart = end + TAIL_MS;
  const cutEnd = next - HEAD_MS;
  if (gap > MIN_GAP_MS && cutEnd > cutStart) trims.push({ end, next, gap, cutStart, cutEnd, removed: cutEnd - cutStart });
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
  console.log("没有需要剪的长停顿，跳过");
  process.exit(0);
}

const tmpOut = `${videoPath}.trim.mp4`;
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

execFileSync(
  "ffmpeg",
  ["-v", "error", "-y", "-i", videoPath, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmpOut],
  { stdio: "inherit" },
);
execFileSync("mv", ["-f", tmpOut, videoPath]);

motion.captions = motion.captions.map((c, i) => ({
  ...c,
  startMs: remap(c.startMs),
  endMs: i < motion.captions.length - 1 ? remap(motion.captions[i + 1].startMs) : remap(durationMs),
}));
motion.corrections = motion.corrections.map((c) => ({ ...c, startMs: remap(c.startMs), endMs: remap(c.endMs) }));
motion.video.durationMs = remap(durationMs);
motion.edit = { tailMs: TAIL_MS, headMs: HEAD_MS, minTrimGapMs: MIN_GAP_MS, trimmedPauses: trims.length };

writeFileSync(MOTION, JSON.stringify(motion, null, 2));

const saved = trims.reduce((s, t) => s + t.removed, 0);
console.log(`已剪 ${trims.length} 处长停顿，共省 ${(saved / 1000).toFixed(1)}s，句间保留 ${TAIL_MS}+${HEAD_MS}ms`);
trims.forEach((t, i) =>
  console.log(`  ${i + 1}. 句尾+${TAIL_MS}ms … 句首-${HEAD_MS}ms（原间隔 ${(t.gap / 1000).toFixed(1)}s，删掉中间 ${(t.removed / 1000).toFixed(1)}s）`),
);
