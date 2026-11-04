// 用法：npm run episode -- <原始视频路径> <期数>，例如 npm run episode -- ~/Movies/raw.mov 2
import { execFileSync } from "node:child_process";
import { copyFileSync, constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { getEpisodePaths } from "./project-paths.mjs";

const [input, episode] = process.argv.slice(2);
if (!input || !episode) {
  console.error("用法：npm run episode -- <原始视频路径> <期数>");
  process.exit(1);
}

const paths = getEpisodePaths(episode);
if (existsSync(paths.video) || existsSync(paths.motion)) throw new Error(`${paths.assets} 已有本期数据，请保留它并单独重试需要的步骤`);
mkdirSync(paths.assets, { recursive: true });
const source = `${paths.assets}/source${extname(input).toLowerCase() || ".mp4"}`;
if (resolve(source) !== resolve(input)) copyFileSync(input, source, constants.COPYFILE_EXCL);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

console.log(`① 转码 → ${paths.video}`);
run("ffmpeg", ["-v", "error", "-n", "-i", source, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", paths.video]);
console.log("② 语音转写");
run("node", ["scripts/transcribe.mjs", paths.video, paths.captions]);
console.log("③ 大模型审计");
run("node", ["scripts/audit.mjs", "--episode", episode, "--video", paths.videoSrc]);
console.log("④ 剪句间长停顿");
run("node", ["scripts/trim-pauses.mjs", "--episode", episode]);
writeFileSync("episode.config.json", JSON.stringify({ episode: paths.episode }, null, 2) + "\n");
console.log("已准备无复习配音的预览。运行 npm run dev，先人工审核字幕、纠错和评分。");
console.log("人工确认后才运行 npm run tts 生成并添加朗读；再次检查音画同步，确认后再导出。");
