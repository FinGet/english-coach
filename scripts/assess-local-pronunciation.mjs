import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getDenoiseOriginal } from "./denoise.mjs";
import { getEpisodePaths } from "./project-paths.mjs";
import { getNarrationSentences } from "./narration.mjs";
import { buildLocalPronunciationNotes, getLocalPronunciationPlan, getLocalPronunciationTools, LOCAL_PHONE_MODEL } from "./local-pronunciation.mjs";

const { values } = parseArgs({ options: { episode: { type: "string" }, check: { type: "boolean" }, assess: { type: "boolean" }, apply: { type: "boolean" } } });
if (values.check && (values.assess || values.apply)) throw new Error("检查和测评请分开运行");
const paths = getEpisodePaths(values.episode);
const before = readFileSync(paths.motion, "utf8");
const motion = JSON.parse(before);
if (motion.meta?.episode !== paths.episode) throw new Error("发音测评期数不一致");
if (values.apply && ["video.mp4", "video-1080p.mp4"].some((name) => existsSync(`${paths.output}/${name}`))) throw new Error("本期已有成片，不自动修改；后续新期数会默认执行发音标注。");
const publicDir = resolve("public");
if (typeof motion.video?.src !== "string") throw new Error("缺少本地原声视频");
const workingVideo = resolve(publicDir, motion.video.src);
if (!workingVideo.startsWith(publicDir + sep)) throw new Error("发音测评只支持 public 内的本地素材");
const video = getDenoiseOriginal(workingVideo);
const segments = getLocalPronunciationPlan(motion);
const tools = getLocalPronunciationTools();
if (!values.assess && !values.apply) {
  console.log(JSON.stringify({ mode: "check", model: LOCAL_PHONE_MODEL, input: video, segments: segments.length, offline: true }, null, 2));
  console.log("只检查；不生成音频、不修改配置、不下载模型。");
  process.exit(0);
}
// Regenerate stale model notes after caption edits; still reject stale user-authored notes.
getNarrationSentences({ ...motion, pronunciationNotes: (motion.pronunciationNotes ?? []).filter((note) => note.source !== "assessment" || note.model !== LOCAL_PHONE_MODEL) });
const measured = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video])) * 1000;
if (!Number.isFinite(measured) || Math.abs(measured - motion.video.durationMs) > 100) throw new Error("发音原声与当前字幕时间轴不一致");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const worker = fileURLToPath(new URL("./local-pronunciation.py", import.meta.url));
const audioHash = hash(readFileSync(video));
const requestKey = hash(JSON.stringify({ audioHash, segments, worker: hash(readFileSync(worker)), manifest: hash(readFileSync(`${tools.cache}/manifest.json`)) }));
const dir = `${paths.work}/local-pronunciation`;
mkdirSync(dir, { recursive: true });
const wav = resolve(`${dir}/input-16k.wav`);
execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", video, "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
const requestPath = resolve(`${dir}/request.json`);
const resultPath = resolve(`${dir}/result.json`);
writeFileSync(requestPath, JSON.stringify({ ...tools, requestKey, wav, segments }));
execFileSync(tools.python, [worker, requestPath, resultPath], { stdio: "inherit" });
const result = JSON.parse(readFileSync(resultPath, "utf8"));
if (result.requestKey !== requestKey) throw new Error("Wav2Vec2 返回了过期结果");
const { notes, unmapped } = buildLocalPronunciationNotes(motion, segments, result.segments);
const next = { ...motion, pronunciationNotes: notes };
getNarrationSentences(next);
const report = { provider: "Local Wav2Vec2 + OpenPronounce", model: LOCAL_PHONE_MODEL, requestKey, audioHash,
  input: video, generatedAt: new Date().toISOString(), thresholds: result.thresholds,
  segments: result.segments, pronunciationNotes: notes, unmapped };
writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2) + "\n");
writeFileSync(`${dir}/report.txt`, ["Wav2Vec2 模型发音分析（非人工确认）", ...notes.map((note) => `${(note.endMs / 1000).toFixed(2)}s ${note.word} ${note.ipa}`), ...unmapped.map((item) => `未标注 ${item.word}：${item.reason}`)].join("\n") + "\n");
if (values.apply) {
  if (readFileSync(paths.motion, "utf8") !== before) throw new Error("测评期间字幕配置已改变，请重跑；未覆盖新内容");
  if (motion.summary.voice && JSON.stringify(notes) !== JSON.stringify(motion.pronunciationNotes ?? [])) throw new Error("已有复习配音，请先保留旧版并移除 summary.voice 做新预览，再应用发音标注。");
  writeFileSync(`${paths.motion}.tmp`, JSON.stringify(next, null, 2) + "\n");
  renameSync(`${paths.motion}.tmp`, paths.motion);
}
console.log(`发音分析完成：${notes.length} 个标注，${unmapped.length} 项无法映射；${values.apply ? "已写入本期预览" : "仅生成报告"}。${dir}/report.txt`);
