// 用法：node scripts/transcribe.mjs public/ep02/video.mp4 [public/ep02/captions.json]
import { registerMediabunnyServer } from "@mediabunny/server";
import {
  WHISPER_WEBGPU_SAMPLE_RATE,
  canUseWhisperWebGpu,
  downloadWhisperModel,
  loadWhisperModel,
  toCaptions,
  transcribe,
} from "@remotion/whisper-webgpu";
import { ALL_FORMATS, Conversion, FilePathSource, Input, NullTarget, Output, WavOutputFormat } from "mediabunny";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const [videoPath, suppliedOutput] = process.argv.slice(2);
if (!videoPath) throw new Error("请提供本期视频路径，例如 public/ep02/video.mp4");
const outPath = suppliedOutput ?? join(dirname(videoPath), "captions.json");
const model = "small.en";

registerMediabunnyServer();

const support = await canUseWhisperWebGpu();
if (!support.supported) throw new Error(support.detailedReason);

const chunks = [];
const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(videoPath) });
const audioTrack = await input.getPrimaryAudioTrack();
if (audioTrack === null) throw new Error("视频里没有音轨");

const conversion = await Conversion.init({
  input,
  output: new Output({ format: new WavOutputFormat(), target: new NullTarget() }),
  video: { discard: true },
  audio: (track) =>
    track.id !== audioTrack.id
      ? { discard: true }
      : {
          codec: "pcm-f32",
          forceTranscode: true,
          numberOfChannels: 1,
          sampleFormat: "f32",
          sampleRate: WHISPER_WEBGPU_SAMPLE_RATE,
          process: (sample) => {
            const waveform = new Float32Array(sample.allocationSize({ format: "f32", planeIndex: 0 }) / Float32Array.BYTES_PER_ELEMENT);
            sample.copyTo(waveform, { format: "f32", planeIndex: 0 });
            chunks.push({ startFrame: Math.round(sample.timestamp * WHISPER_WEBGPU_SAMPLE_RATE), waveform });
            return sample;
          },
        },
});
if (!conversion.isValid) throw new Error("音轨无法解码");
await conversion.execute();

const length = chunks.reduce((max, c) => Math.max(max, c.startFrame + c.waveform.length), 0);
const channelWaveform = new Float32Array(length);
for (const c of chunks) channelWaveform.set(c.waveform.subarray(0, length - Math.max(0, c.startFrame)), Math.max(0, c.startFrame));

await downloadWhisperModel({ model });
await loadWhisperModel({ model });
const { captions } = toCaptions({ whisperWebGpuOutput: await transcribe({ channelWaveform, model }) });

await writeFile(outPath, JSON.stringify(captions, null, 2));
console.log(`已写入 ${outPath}，共 ${captions.length} 个词`);
