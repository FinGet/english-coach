import { createHash } from "node:crypto";

// 字幕可按意群断开；配音合并到完整句子，保留各字幕的字符位置用于高亮。
export const getNarrationSentences = (motion) => {
  const matched = new Set();
  const sentences = [];
  let parts = [];
  let hasFix = false;
  let offset = 0;
  for (const [caption, row] of motion.captions.entries()) {
    const until = motion.captions[caption + 1]?.startMs ?? motion.video.durationMs;
    const fixes = motion.corrections.filter((c) => c.startMs >= row.startMs && c.startMs <= until && row.text.includes(c.original));
    fixes.forEach((c) => matched.add(c));
    const text = fixes.reduce((text, c) => text.replace(c.original, c.corrected), row.text);
    parts.push({ caption, text, offset });
    offset += Array.from(text).length + 1;
    hasFix ||= fixes.length > 0;
    if (/[.!?]["'”’)]*$/.test(row.text.trim()) || caption === motion.captions.length - 1) {
      if (hasFix) sentences.push({ text: parts.map((part) => part.text).join(" "), parts });
      parts = [];
      hasFix = false;
      offset = 0;
    }
  }
  const invalid = motion.corrections.filter((c) => !matched.has(c));
  if (invalid.length) throw new Error(`纠错已不匹配当前字幕，请先审核：${invalid.map((c) => c.original).join(", ")}`);
  return sentences;
};

export const getTtsRequest = (text, voiceId) => {
  const request = { text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.9 } };
  const generationKey = createHash("sha256").update(JSON.stringify({ voiceId, ...request })).digest("hex");
  return { request, generationKey };
};

export const getSentenceTimings = (sentence, alignment) => sentence.parts.map((part) => {
  const start = alignment?.character_start_times_seconds?.[part.offset];
  const end = alignment?.character_end_times_seconds?.[part.offset + Array.from(part.text).length - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error("ElevenLabs 字幕时间戳无效");
  return { caption: part.caption, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) };
});
