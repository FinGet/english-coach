import { createHash } from "node:crypto";

// 只读问题分句；必要的相邻语境须在审核时显式标注，不自动扩展到整个长句。
export const getNarrationSentences = (motion) => {
  if (motion.pronunciationNotes !== undefined && !Array.isArray(motion.pronunciationNotes)) throw new Error("发音标注必须是数组");
  for (const note of motion.pronunciationNotes ?? []) {
    if (!note || typeof note.word !== "string" || !/^[a-z]+(?:['’-][a-z]+)*$/i.test(note.word) ||
      typeof note.ipa !== "string" || !note.ipa.trim() || typeof note.tip !== "string" || !note.tip.trim() ||
      !["self-report", "user-confirmed", "assessment"].includes(note.source) ||
      !Number.isFinite(note.startMs) || !Number.isFinite(note.endMs) || note.startMs < 0 ||
      note.endMs < note.startMs || note.endMs > motion.video.durationMs) {
      throw new Error("发音标注的单词、读音、来源或时间戳无效");
    }
  }
  const matched = new Set();
  const matchedPronunciation = new Set();
  const selected = new Set();
  const rows = motion.captions.map((row, caption) => {
    const until = motion.captions[caption + 1]?.startMs ?? motion.video.durationMs;
    const fixes = motion.corrections.filter((c) => !matched.has(c) && c.startMs >= row.startMs && c.startMs <= until && row.text.includes(c.original));
    fixes.forEach((c) => matched.add(c));
    const words = row.text.toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) ?? [];
    const pronunciation = (motion.pronunciationNotes ?? []).filter((note) =>
      note.startMs >= row.startMs && note.endMs <= row.endMs && words.includes(note.word.toLowerCase()));
    pronunciation.forEach((note) => matchedPronunciation.add(note));
    const text = fixes.reduce((text, c) => text.replace(c.original, c.corrected), row.text);
    for (const item of [...fixes, ...pronunciation]) {
      selected.add(caption);
      if (item.narrationContext === undefined) continue;
      if (!["previous", "next", "both"].includes(item.narrationContext)) throw new Error("朗读语境只能为 previous、next 或 both");
      for (const delta of item.narrationContext === "both" ? [-1, 1] : [item.narrationContext === "previous" ? -1 : 1]) {
        if (!motion.captions[caption + delta]) throw new Error("朗读语境超出字幕范围，请先审核");
        selected.add(caption + delta);
      }
    }
    return { caption, text };
  });
  const invalid = motion.corrections.filter((c) => !matched.has(c));
  if (invalid.length) throw new Error(`纠错已不匹配当前字幕，请先审核：${invalid.map((c) => c.original).join(", ")}`);
  const invalidPronunciation = (motion.pronunciationNotes ?? []).filter((note) => !matchedPronunciation.has(note));
  if (invalidPronunciation.length) throw new Error(`发音标注已不匹配当前字幕或时间轴，请先审核：${invalidPronunciation.map((note) => note.word).join(", ")}`);
  const sentences = [];
  let parts = [];
  const flush = () => {
    if (!parts.length) return;
    parts[0].text = parts[0].text.replace(/^(["'“‘(]*)([a-z])/, (_, prefix, letter) => prefix + letter.toUpperCase());
    const last = parts.at(-1);
    last.text = last.text.trim().replace(/[,;:]+$/, ".");
    if (!/[.!?]["'”’)]*$/.test(last.text)) last.text += ".";
    let offset = 0;
    for (const part of parts) {
      part.offset = offset;
      offset += Array.from(part.text).length + 1;
    }
    sentences.push({ text: parts.map((part) => part.text).join(" "), parts });
    parts = [];
  };
  for (const row of rows) {
    if (selected.has(row.caption)) parts.push(row);
    else flush();
    if (/[.!?]["'”’)]*$/.test(row.text.trim())) flush();
  }
  flush();
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
