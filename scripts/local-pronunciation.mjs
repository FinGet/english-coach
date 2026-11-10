import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getPronunciationSegments } from "./pronunciation.mjs";

export const LOCAL_PHONE_MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft";
const tokens = (text) => text.toLowerCase().replaceAll("’", "'").match(/[a-z0-9]+(?:'[a-z]+)*/g) ?? [];

export const getLocalPronunciationTools = () => {
  const python = resolve(".cache/asr-venv/bin/python");
  const cache = resolve(".cache/local-pronunciation");
  for (const path of [python, `${cache}/manifest.json`, `${cache}/model/pytorch_model.bin`, `${cache}/vendor/openpronounce/phones.py`]) {
    if (!existsSync(path)) throw new Error("本地 Wav2Vec2 环境不完整；请先准备 .cache/asr-venv 和 .cache/local-pronunciation，不能跳过发音检测继续制作。");
  }
  return { python, cache };
};

export const getLocalPronunciationPlan = (motion) => getPronunciationSegments(motion).map((segment) => {
  const words = [];
  let occurrence = 0;
  for (const caption of segment.captions) {
    for (const match of motion.captions[caption].text.matchAll(/[a-z]+(?:['’-][a-z]+)*|\d+/gi)) {
      const spelling = match[0];
      for (const word of tokens(spelling)) words.push({ word, spelling, caption, occurrence });
      occurrence++;
    }
  }
  return { ...segment, referenceText: segment.referenceText.replaceAll("’", "'"), words };
});

export const buildLocalPronunciationNotes = (motion, plan, results) => {
  if (!Array.isArray(results) || results.length !== plan.length) throw new Error("Wav2Vec2 没有完成全部音频分段");
  const notes = [];
  const unmapped = [];
  for (const [index, segment] of plan.entries()) {
    const result = results[index];
    if (result.referenceText !== segment.referenceText || result.startMs !== segment.startMs || result.endMs !== segment.endMs ||
      !Array.isArray(result.words) || result.words.length !== segment.words.length || !Array.isArray(result.comparison?.errors)) throw new Error("Wav2Vec2 结果与当前原话或时间轴不匹配");
    for (const [position, word] of result.words.entries()) {
      if (word.word !== segment.words[position].word || word.position !== position || !Array.isArray(word.expected) || !word.expected.length ||
        !word.expected.every((phone) => typeof phone === "string" && phone.length) || typeof word.ipa !== "string" || !word.ipa.trim()) throw new Error("Wav2Vec2 未返回有效的逐词目标音素");
    }
    const groups = new Set();
    for (const error of result.comparison.errors) {
      const entry = segment.words[error.position];
      if (!entry || error.word !== entry.word) throw new Error("Wav2Vec2 候选词位置无效");
      if (!/^[a-z]+(?:['’-][a-z]+)*$/i.test(entry.spelling)) {
        unmapped.push({ ...error, reason: "数字读法需核对", segment: index });
        continue;
      }
      if (groups.has(entry.occurrence)) continue;
      groups.add(entry.occurrence);
      const words = result.words.filter((_, i) => segment.words[i].occurrence === entry.occurrence);
      const caption = motion.captions[entry.caption];
      const start = words[0].audioStartMs;
      const end = words.at(-1).audioEndMs;
      const timed = Number.isFinite(start) && Number.isFinite(end) && start >= caption.startMs && end > start && end <= caption.endMs;
      // Missing/ambiguous phone timing marks the clause end instead of inventing a word timestamp.
      notes.push({ word: entry.spelling, ipa: `/${words.map((w) => w.ipa).join(" ")}/`,
        tip: "Listen to the standard pronunciation, then repeat.",
        startMs: timed ? start : caption.endMs, endMs: timed ? end : caption.endMs,
        source: "assessment", model: LOCAL_PHONE_MODEL });
    }
  }
  const preserved = (motion.pronunciationNotes ?? []).filter((note) => note.source !== "assessment" || note.model !== LOCAL_PHONE_MODEL);
  const sameOccurrence = (a, b) => a.word.toLowerCase() === b.word.toLowerCase() &&
    motion.captions.some((caption) => a.startMs >= caption.startMs && a.endMs <= caption.endMs && b.startMs >= caption.startMs && b.endMs <= caption.endMs);
  const merged = notes.filter((note) => !preserved.some((old) => sameOccurrence(old, note))).map((note) => {
    const previous = (motion.pronunciationNotes ?? []).find((old) => old.word === note.word && old.startMs === note.startMs && old.endMs === note.endMs && old.ipa === note.ipa);
    return { ...note, ...(previous?.dictionaryAudioId ? { dictionaryAudioId: previous.dictionaryAudioId } : {}), ...(previous?.audio ? { audio: previous.audio } : {}) };
  });
  return { notes: [...preserved, ...merged].sort((a, b) => a.startMs - b.startMs), unmapped };
};
