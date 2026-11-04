import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { getEpisodePaths } from "./project-paths.mjs";

const [command, ...args] = process.argv.slice(2);
const { values } = parseArgs({ args, options: {
  episode: { type: "string" },
  scale: { type: "string", default: "2" },
  frame: { type: "string", default: "180" },
} });
if (!["studio", "render", "still"].includes(command)) throw new Error("用法：node scripts/remotion.mjs <studio|render|still> [--episode 2] [--scale 2] [--frame 180]");
const paths = getEpisodePaths(values.episode);
if (!existsSync(paths.motion)) throw new Error(`找不到 ${paths.motion}，请先准备这一期的数据，或运行 npm run setup 创建示例`);
if (!/^[12]$/.test(values.scale)) throw new Error("scale 仅支持 1（1080p）或 2（4K）");
if (!/^\d+$/.test(values.frame)) throw new Error("frame 必须为非负整数");
const props = `--props=${JSON.stringify({ motionSrc: paths.motionSrc })}`;
let cliArgs;
if (command === "studio") cliArgs = ["studio", props];
else if (command === "render") {
  mkdirSync(paths.output, { recursive: true });
  const output = `${paths.output}/video${values.scale === "1" ? "-1080p" : ""}.mp4`;
  console.log(`导出 ${paths.id} → ${output}`);
  cliArgs = ["render", "AiEnglishCoachPortrait", output, props, `--scale=${values.scale}`];
} else {
  mkdirSync(`${paths.work}/previews`, { recursive: true });
  const output = `${paths.work}/previews/frame-${values.frame}.png`;
  console.log(`验证截图 ${paths.id} → ${output}`);
  cliArgs = ["still", "AiEnglishCoachPortrait", output, props, `--frame=${values.frame}`];
}
execFileSync(process.execPath, [resolve("node_modules/@remotion/cli/remotion-cli.js"), ...cliArgs], { stdio: "inherit" });
