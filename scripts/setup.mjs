import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(resolve(root, "public"), { recursive: true });
for (const [source, target] of [["creator.config.example.json", "creator.config.json"], ["examples/motion.json", "public/motion.json"]]) {
  try {
    copyFileSync(resolve(root, source), resolve(root, target), constants.COPYFILE_EXCL);
    console.log(`Created ${target}`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log(`Kept existing ${target}`);
  }
}
const motion = JSON.parse(readFileSync(resolve(root, "public/motion.json"), "utf8"));
if (motion.video.src === "demo.mp4" && !existsSync(resolve(root, "public/demo.mp4"))) {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); }
  catch { throw new Error("Install FFmpeg and add it to PATH, then re-run npm run setup. Existing files have been preserved."); }
  execFileSync(process.execPath, [resolve(root, "scripts/make-demo.mjs")], { cwd: root, stdio: "inherit" });
}
console.log("Ready. Run npm run dev to preview; export only after reviewing it.");
