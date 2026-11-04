// 用法：npm run episode -- <原始视频路径> <期数>，例如 npm run episode -- ~/Movies/raw.mov 2
import { execFileSync } from "node:child_process";

const [input, episode] = process.argv.slice(2);
if (!input || !episode) {
  console.error("用法：npm run episode -- <原始视频路径> <期数>");
  process.exit(1);
}

const video = `ep${episode.padStart(2, "0")}.mp4`;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

console.log(`① 转码 → public/${video}`);
run("ffmpeg", ["-v", "error", "-y", "-i", input, "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", `public/${video}`]);
console.log("② 语音转写");
run("node", ["scripts/transcribe.mjs", `public/${video}`]);
console.log("③ 大模型审计");
run("node", ["scripts/audit.mjs", "--episode", episode, "--video", video]);
console.log("④ 剪句间长停顿");
run("node", ["scripts/trim-pauses.mjs", "--video", `public/${video}`]);
console.log("⑤ 美音朗读");
run("node", ["scripts/tts.mjs"]);
console.log("完成！npm run dev 预览，确认无误后 npm run render 导出");
