import { parseArgs } from "node:util";
import { getEpisodePaths } from "./project-paths.mjs";
import { denoiseVideo } from "./denoise.mjs";

try { process.loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
const { values } = parseArgs({ options: { episode: { type: "string" }, db: { type: "string", default: "6" }, apply: { type: "boolean", default: false } } });
const paths = getEpisodePaths(values.episode);
const result = denoiseVideo({ video: paths.video, work: `${paths.work}/denoise`, db: values.db, apply: values.apply });
console.log(`${result.reused ? "复用已有降噪" : "已完成本地降噪"}（${result.db} dB）：${result.video}`);
console.log(result.applied ? "当前工作视频已降噪，降噪前原声保存在 video.before-denoise.mp4；字幕与成片未改动。" : "仅生成独立试听副本；加 --apply 可应用到当前工作视频。");
