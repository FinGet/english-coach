import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(resolve(root, "public"), { recursive: true });
const run = (args) => execFileSync("ffmpeg", ["-v", "error", "-n", ...args], { stdio: "inherit" });
if (!existsSync(resolve(root, "public/demo.mp4"))) {
  run([
    "-f", "lavfi", "-i", "color=c=0xE5ECE2:s=640x640:r=30:d=12",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
    "-vf", "drawgrid=width=64:height=64:color=0x187660@0.12:thickness=1,drawbox=x=160:y=340:w=320:h=210:color=0x187660:t=fill,drawbox=x=230:y=150:w=180:h=170:color=0x1C332C:t=fill,drawbox=x=260:y=210:w=30:h=20:color=white:t=fill,drawbox=x=350:y=210:w=30:h=20:color=white:t=fill,hue=h=3*sin(t)",
    "-t", "12", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", resolve(root, "public/demo.mp4"),
  ]);
}
if (!existsSync(resolve(root, "public/knock.wav"))) {
  run(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=0.12", "-af", "afade=t=out:st=0.015:d=0.105,volume=0.3", "-c:a", "pcm_s16le", resolve(root, "public/knock.wav")]);
}
console.log("Synthetic silent demo and generated knock sound are ready.");
