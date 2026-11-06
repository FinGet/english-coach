import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { getEpisodePaths } from "./project-paths.mjs";
import { getDenoiseOriginal } from "./denoise.mjs";
import { buildPronunciationReport, getPronunciationConfig, getPronunciationEndpoint, getPronunciationSegments, parsePronunciationResponse } from "./pronunciation.mjs";

const { values } = parseArgs({ options: { episode: { type: "string" }, check: { type: "boolean", default: false }, assess: { type: "boolean", default: false } } });
if (values.check && values.assess) throw new Error("检查和测评请分开运行");
try { process.loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw new Error("无法读取本地 .env，请检查格式与权限"); }
const paths = getEpisodePaths(values.episode);
const motion = JSON.parse(readFileSync(paths.motion, "utf8"));
if (motion.meta?.episode !== paths.episode) throw new Error("测评期数与 motion.json 不一致");
const publicDir = resolve("public");
if (typeof motion.video?.src !== "string") throw new Error("缺少本地原声视频路径");
const workingVideo = resolve(publicDir, motion.video.src);
if (!workingVideo.startsWith(publicDir + sep)) throw new Error("发音测评仅支持 public 目录内的本地视频");
const video = getDenoiseOriginal(workingVideo);
const segments = getPronunciationSegments(motion);
const measuredDuration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { encoding: "utf8" })) * 1000;
if (!Number.isFinite(measuredDuration) || Math.abs(measuredDuration - motion.video.durationMs) > 100) throw new Error("视频与审核字幕时长不一致，请先核对时间轴");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const videoHash = hash(readFileSync(video));
let endpoint = null;
if (process.env.AZURE_SPEECH_ENDPOINT || process.env.AZURE_SPEECH_REGION) endpoint = getPronunciationEndpoint(process.env);
const configured = Boolean(endpoint && process.env.AZURE_SPEECH_KEY?.trim());
const dir = `${paths.work}/pronunciation`;
const cache = `${dir}/cache`;
const save = (path, data) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
};
const plan = segments.map((segment) => {
  const config = getPronunciationConfig(segment.referenceText);
  const requestKey = hash(JSON.stringify({ version: 1, endpoint, videoHash, segment, config }));
  const path = `${cache}/${requestKey}.json`;
  let cached = null;
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (data.requestKey === requestKey) cached = parsePronunciationResponse(data.response, segment);
    } catch { /* Invalid caches are not treated as completed assessments. */ }
  }
  return { segment, config, requestKey, path, cached };
});
if (!values.assess) {
  console.log(JSON.stringify({ mode: "check", configured, segments: plan.length, cached: plan.filter((p) => p.cached).length, requests: plan.filter((p) => !p.cached).length, audioSeconds: segments.reduce((s, p) => s + p.endMs - p.startMs, 0) / 1000, prosodyEnabled: false, reference: "Original reviewed captions; grammatical corrections are not applied.", output: `${dir}/report.json`, plan: plan.map((p) => ({ ...p.segment, cached: Boolean(p.cached) })) }, null, 2));
  console.log("只检查，不生成音频、不修改字幕、不调用 Azure。");
  process.exit(0);
}
if (!configured) throw new Error("实测缺少配置：请在本地 .env 填写 AZURE_SPEECH_KEY，以及 AZURE_SPEECH_REGION 或 AZURE_SPEECH_ENDPOINT；不要把 Key 发到聊天里。");
mkdirSync(cache, { recursive: true });
const results = [];
for (const [index, item] of plan.entries()) {
  let assessment = item.cached;
  if (!assessment) {
    const wav = `${dir}/${item.requestKey}.wav`;
    execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", video, "-ss", String(item.segment.startMs / 1000), "-t", String((item.segment.endMs - item.segment.startMs) / 1000), "-map", "0:a:0", "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    const audioMs = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], { encoding: "utf8" })) * 1000;
    if (!Number.isFinite(audioMs) || audioMs <= 0 || audioMs > 30000 || Math.abs(audioMs - (item.segment.endMs - item.segment.startMs)) > 100) throw new Error("测评音频时长与参考字幕不一致，停止上传");
    console.log(`Azure 发音测评 ${index + 1}/${plan.length}：${item.segment.referenceText}`);
    let response;
    try {
      const res = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(90000), headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY.trim(), "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000", Accept: "application/json", "Pronunciation-Assessment": Buffer.from(JSON.stringify(item.config)).toString("base64") }, body: readFileSync(wav) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      response = await res.json();
    } catch (error) {
      const status = /^HTTP \d+$/.test(error.message) ? error.message : "网络或响应错误";
      throw new Error(`Azure 请求失败（${status}）。请核对凭据、区域、网络或额度；已成功分段保留，重跑只补未完成项。`);
    }
    assessment = parsePronunciationResponse(response, item.segment);
    save(item.path, { requestKey: item.requestKey, response });
  } else console.log(`复用发音测评 ${index + 1}/${plan.length}`);
  results.push({ ...item.segment, requestKey: item.requestKey, assessment });
}
const report = { ...buildPronunciationReport(motion, results), videoHash, generatedAt: new Date().toISOString() };
save(`${dir}/report.json`, report);
const lines = ["Azure 发音评估试测", "参考：审核后的原话；未做语法改写。韵律评估关闭。", "以下为待回听复核的自动结果，未写入视频配置或文本评分。", "", "你已确认的两处错误："];
for (const item of report.userConfirmedComparison) lines.push(`${item.word}: ${item.status}; 单词准确度 ${item.assessedWord?.accuracy ?? "未匹配"}`);
lines.push("", "自动筛出的疑似发音问题：");
for (const item of report.candidates) lines.push(`${(item.startMs / 1000).toFixed(2)}s ${item.word}: ${item.accuracy}/100; ${item.candidateNote?.ipa ?? "时间轴需复核"}; ${item.candidateNote?.tip ?? "请回听并核对时间轴。"}`);
if (!report.candidates.length) lines.push("本次没有命中筛查条件；这不等于已经确认零发音错误。");
lines.push("", "逐词与音素明细：");
for (const result of results) for (const word of result.assessment.words) lines.push(`${word.startMs == null ? "无时间戳" : (word.startMs / 1000).toFixed(2) + "s"} ${word.word}: ${word.accuracy ?? "无评分"}/100 [${word.errorType}] ${word.phonemes.map((p) => `/${p.phoneme}/ ${p.accuracy}`).join("; ")}`);
writeFileSync(`${dir}/report.txt`, lines.join("\n") + "\n");
console.log(`已完成 ${results.length} 段，筛出 ${report.candidates.length} 个待复核项。报告：${dir}/report.txt`);
console.log("审核字幕、用户确认的发音标注、文本评分和成片均未改动。");
