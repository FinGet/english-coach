// 用法：npm run episode -- <原始视频路径> <期数>，例如 npm run episode -- ~/Movies/raw.mov 2
import { execFileSync } from "node:child_process";
import { copyFileSync, constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { getEpisodePaths } from "./project-paths.mjs";
import { parseArgs } from "node:util";
import { denoiseVideo, getDenoiseTool } from "./denoise.mjs";
import { getLocalPronunciationTools } from "./local-pronunciation.mjs";

try { process.loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
const { values, positionals } = parseArgs({ allowPositionals: true, options: { "denoise-db": { type: "string", default: "6" } } });
const [input, episode] = positionals;
if (!input || !episode) {
  console.error("用法：npm run episode -- <原始视频路径> <期数>");
  process.exit(1);
}

const paths = getEpisodePaths(episode);
const db = Number(values["denoise-db"]);
if (![6, 12].includes(db)) throw new Error("--denoise-db 仅支持 6（默认）或 12（户外）");
getDenoiseTool();
getLocalPronunciationTools();
if (existsSync(paths.video) || existsSync(paths.motion)) throw new Error(`${paths.assets} 已有本期数据，请保留它并单独重试需要的步骤`);
mkdirSync(paths.assets, { recursive: true });
const source = `${paths.assets}/source${extname(input).toLowerCase() || ".mp4"}`;
if (resolve(source) !== resolve(input)) copyFileSync(input, source, constants.COPYFILE_EXCL);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

console.log(`① 转码 → ${paths.video}`);
run("ffmpeg", ["-v", "error", "-n", "-i", source, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", paths.video]);
console.log(`② 本地降噪（${db} dB）→ 独立识别副本`);
const recognized = denoiseVideo({ video: paths.video, work: `${paths.work}/denoise`, db });
console.log("③ 对降噪副本做语音转写");
run("node", ["scripts/transcribe.mjs", recognized.video, paths.captions]);
console.log("④ 大模型审计");
run("node", ["scripts/audit.mjs", "--episode", episode, "--video", paths.videoSrc]);
console.log("⑤ 依据原声剪长静音（备份原文件并同步字幕时间轴）");
run("node", ["scripts/trim-pauses.mjs", "--episode", episode]);
console.log("⑥ Wav2Vec2 分析原声并写入发音标注");
run("node", ["scripts/assess-local-pronunciation.mjs", "--episode", episode, "--apply"]);
console.log("⑦ 将降噪用于剪辑后的预览视频");
denoiseVideo({ video: paths.video, work: `${paths.work}/denoise`, db, apply: true });
writeFileSync("episode.config.json", JSON.stringify({ episode: paths.episode }, null, 2) + "\n");
console.log("已准备无复习配音的预览。运行 npm run dev，先人工审核字幕、纠错和评分。");
console.log("人工确认后才运行 npm run tts 生成并添加朗读；再次检查音画同步，确认后再导出。");
