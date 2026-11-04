import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEpisodePaths } from "./project-paths.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
for (const [source, target] of [["creator.config.example.json", "creator.config.json"], ["episode.config.example.json", "episode.config.json"]]) {
  try {
    copyFileSync(resolve(root, source), resolve(root, target), constants.COPYFILE_EXCL);
    console.log(`Created ${target}`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log(`Kept existing ${target}`);
  }
}
const paths = getEpisodePaths();
mkdirSync(paths.assets, { recursive: true });
const example = JSON.parse(readFileSync(resolve(root, "examples/motion.json"), "utf8"));
example.meta.episode = paths.episode;
example.video.src = paths.videoSrc;
try {
  writeFileSync(paths.motion, JSON.stringify(example, null, 2) + "\n", { flag: "wx" });
  console.log(`Created ${paths.motion}`);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(`Kept existing ${paths.motion}`);
}
const motion = JSON.parse(readFileSync(paths.motion, "utf8"));
const isDemo = motion.meta.title === example.meta.title && motion.video.durationMs === example.video.durationMs && motion.video.src === paths.videoSrc;
if (isDemo && !existsSync(paths.video)) {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); }
  catch { throw new Error("Install FFmpeg and add it to PATH, then re-run npm run setup. Existing files have been preserved."); }
  execFileSync(process.execPath, [resolve(root, "scripts/make-demo.mjs"), paths.assets], { cwd: root, stdio: "inherit" });
}
console.log("Ready. Run npm run dev to preview; export only after reviewing it.");
