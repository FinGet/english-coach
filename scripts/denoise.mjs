import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileHash = (path) => hash(readFileSync(path));
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
const duration = (video) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]));
const videoHash = (video) => run("ffmpeg", ["-v", "error", "-i", video, "-map", "0:v:0", "-c:v", "copy", "-f", "hash", "-hash", "sha256", "-"]).trim();
const beforeDenoise = (video) => join(dirname(video), `${basename(video, extname(video))}.before-denoise${extname(video)}`);

export const getDenoiseOriginal = (video) => {
  const backup = beforeDenoise(video);
  const receipt = `${video}.denoise.json`;
  if (!existsSync(receipt) && !existsSync(backup)) return video;
  const saved = existsSync(receipt) ? JSON.parse(readFileSync(receipt, "utf8")) : null;
  if (!saved || !existsSync(backup) || saved.outputHash !== fileHash(video) || saved.inputHash !== fileHash(backup)) throw new Error("降噪备份、处理记录或当前视频不匹配，停止处理；请保留原文件并核对版本");
  return backup;
};

export const getDenoiseTool = () => {
  const local = ".cache/asr-tools/deep-filter-0.5.6-aarch64-apple-darwin";
  const tool = process.env.DEEP_FILTER_BIN || (process.platform === "darwin" && process.arch === "arm64" && existsSync(local) ? resolve(local) : "deep-filter");
  try { run(tool, ["--version"]); }
  catch { throw new Error("找不到可运行的 DeepFilterNet；请安装 deep-filter 并加入 PATH，或用 DEEP_FILTER_BIN 指定可执行文件。降噪失败时不会退回原声继续处理。"); }
  return tool;
};

// FFmpeg and the native denoiser may include extra RIFF chunks before PCM data.
const pcm = (path) => {
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("降噪音频不是有效 WAV");
  let format = false;
  let data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > bytes.length) throw new Error("降噪 WAV 数据不完整");
    const type = bytes.toString("ascii", offset, offset + 4);
    if (type === "fmt ") format = size >= 16 && bytes.readUInt16LE(offset + 8) === 1 && bytes.readUInt16LE(offset + 10) === 1 && bytes.readUInt32LE(offset + 12) === 48000 && bytes.readUInt16LE(offset + 22) === 16;
    if (type === "data") data = bytes.subarray(offset + 8, end);
    offset = end + (size % 2);
  }
  if (!format || !data?.length || data.length % 2) throw new Error("降噪 WAV 必须为 48kHz 单声道 PCM16");
  return data;
};

const savePcm = (path, data) => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(data.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24); header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
};

export const denoiseVideo = ({ video, work, db = 6, apply = false }) => {
  if (![6, 12].includes(Number(db))) throw new Error("降噪档位仅支持 6（默认）或 12（户外）dB");
  db = Number(db);
  const backup = beforeDenoise(video);
  const receipt = `${video}.denoise.json`;
  const currentHash = fileHash(video);
  if (getDenoiseOriginal(video) !== video) {
    const saved = JSON.parse(readFileSync(receipt, "utf8"));
    if (saved.db !== db) throw new Error("本视频已降噪；如需换档，请用保留的原声另做副本，避免重复降噪");
    return { video, ...saved, reused: true, applied: true };
  }
  const tool = getDenoiseTool();
  const toolVersion = run(tool, ["--version"]).trim();
  const seconds = duration(video);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("降噪输入视频时长无效");
  const key = hash(JSON.stringify({ version: 1, inputHash: currentHash, db, toolVersion }));
  mkdirSync(work, { recursive: true });
  const output = join(work, `video-${key}.mp4`);
  const metadata = `${output}.json`;
  let result;
  if (existsSync(output) && existsSync(metadata)) {
    const cached = JSON.parse(readFileSync(metadata, "utf8"));
    if (cached.inputHash === currentHash && cached.db === db && cached.outputHash === fileHash(output)) result = cached;
  }
  const reused = Boolean(result);
  if (!result) {
    const temp = mkdtempSync(join(work, ".denoise-"));
    try {
      const inputWav = join(temp, "original.wav");
      const enhancedDir = join(temp, "enhanced");
      mkdirSync(enhancedDir);
      // Keep the video's full clock, including a possible initial audio gap and AAC tail.
      run("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", video, "-map", "0:a:0", "-vn", "-af", "aresample=48000:async=1:first_pts=0,apad", "-t", String(seconds), "-ac", "1", "-c:a", "pcm_s16le", inputWav]);
      run(tool, ["-D", "--atten-lim-db", String(db), "-o", enhancedDir, inputWav]);
      const original = pcm(inputWav);
      const enhanced = pcm(join(enhancedDir, "original.wav"));
      const missing = original.length - enhanced.length;
      if (missing < 0 || missing > 4800) throw new Error("降噪音频长度异常，保留当前视频");
      const aligned = join(temp, "aligned.wav");
      // Native delay compensation omits ~30ms; restore that original tail rather than stretch audio.
      savePcm(aligned, Buffer.concat([enhanced, original.subarray(enhanced.length)]));
      const candidate = join(temp, "video.mp4");
      run("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", video, "-i", aligned, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(seconds), "-movflags", "+faststart", candidate]);
      const actual = duration(candidate);
      if (!Number.isFinite(actual) || Math.abs(actual - seconds) > 0.05 || videoHash(candidate) !== videoHash(video)) throw new Error("降噪后时长或画面校验失败，保留当前视频");
      result = { inputHash: currentHash, outputHash: fileHash(candidate), db, toolVersion, inputDurationMs: Math.round(seconds * 1000), outputDurationMs: Math.round(actual * 1000), samples: original.length / 2, restoredTailSamples: missing / 2 };
      renameSync(candidate, output);
      writeFileSync(metadata, JSON.stringify(result, null, 2) + "\n");
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
  if (apply) {
    // Prepare both files before changing the working video; retain an immutable original-audio backup.
    copyFileSync(video, backup, constants.COPYFILE_EXCL);
    const staged = `${video}.denoise-tmp.mp4`;
    let replaced = false;
    try {
      copyFileSync(output, staged, constants.COPYFILE_EXCL);
      writeFileSync(`${receipt}.tmp`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
      renameSync(staged, video);
      replaced = true;
      renameSync(`${receipt}.tmp`, receipt);
    } catch (error) {
      if (replaced) copyFileSync(backup, video);
      rmSync(staged, { force: true });
      rmSync(`${receipt}.tmp`, { force: true });
      throw error;
    }
  }
  return { video: apply ? video : output, ...result, reused, applied: apply };
};
