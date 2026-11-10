import type { Correction, Motion, PronunciationNote } from "./types";

export const FREEZE_MS = 1600;
export const PUSH_MS = 480;
export const FIX_MS = 450;
export const READ_MS = 2200;
export const PRONUNCIATION_GAP = 18;
const PRONUNCIATION_WORD_MS = 4000;
export const getPronunciationWordMs = (note: PronunciationNote) =>
  Math.max(PRONUNCIATION_WORD_MS, note.audio ? 600 + note.audio.durationMs + 2000 : 0);

export type PronunciationPage = {
  columns: 1 | 2;
  notes: PronunciationNote[];
  height: number;
  startMs: number;
  durationMs: number;
};

export const getPronunciationPracticeMs = (motion: Motion) => {
  const count = motion.pronunciationNotes?.length ?? 0;
  return count ? Math.max(8000, (motion.pronunciationNotes ?? []).reduce((sum, note) => sum + getPronunciationWordMs(note), 0)) : 0;
};

// Heights come from the rendered cards, including wrapped words, IPA and tips.
export const getPronunciationPages = (
  motion: Motion,
  layouts: { columns: 1 | 2; heights: number[] }[],
  viewportHeight: number,
) => {
  const notes = motion.pronunciationNotes ?? [];
  if (!notes.length) return [];
  const candidates = layouts.map(({ columns, heights }) => {
    const pages: PronunciationPage[] = [];
    for (let i = 0; i < notes.length; i += columns) {
      const height = Math.max(...heights.slice(i, i + columns));
      let page = pages[pages.length - 1];
      if (!page || page.height + PRONUNCIATION_GAP + height > viewportHeight) {
        page = { columns, notes: [], height: 0, startMs: 0, durationMs: 0 };
        pages.push(page);
      }
      page.height += (page.notes.length ? PRONUNCIATION_GAP : 0) + height;
      page.notes.push(...notes.slice(i, i + columns));
    }
    return {
      pages,
      columns,
      overflow: pages.reduce((sum, page) => sum + Math.max(0, page.height - viewportHeight), 0),
    };
  });
  candidates.sort((a, b) => a.overflow - b.overflow || a.pages.length - b.pages.length || a.columns - b.columns);
  const pages = candidates[0]?.pages ?? [];
  let startMs = 0;
  for (const [index, page] of pages.entries()) {
    page.startMs = startMs;
    page.durationMs = page.notes.reduce((sum, note) => sum + getPronunciationWordMs(note), 0) +
      (index === 0 ? Math.max(0, 8000 - notes.reduce((sum, note) => sum + getPronunciationWordMs(note), 0)) : 0);
    startMs += page.durationMs;
  }
  return pages;
};

export const getPronunciationCues = (page: PronunciationPage) => {
  let cursor = page.startMs;
  return page.notes.map((note) => {
    const cue = { note, startMs: cursor + 600, endMs: cursor + 600 + (note.audio?.durationMs ?? 0), untilMs: cursor + getPronunciationWordMs(note) };
    cursor = cue.untilMs;
    return cue;
  });
};

export const splitPronunciation = (text: string, notes: PronunciationNote[]) =>
  text.split(/([a-z]+(?:['’-][a-z]+)*)/gi).map((text) => ({
    text,
    note: notes.find((note) => note.word.toLowerCase() === text.toLowerCase()),
  }));

export const getHits = (motion: Motion) =>
  motion.corrections
    .filter((c) => c.level === 3)
    .sort((a, b) => a.endMs - b.endMs);

export const correctionsForCaption = (motion: Motion, index: number) => {
  const caption = motion.captions[index];
  if (!caption) return [];
  const until = motion.captions[index + 1]?.startMs ?? motion.video.durationMs;
  return motion.corrections.filter(
    (c) =>
      c.startMs >= caption.startMs &&
      c.startMs <= until &&
      caption.text.includes(c.original),
  );
};

export const pronunciationForCaption = (motion: Motion, index: number) => {
  const caption = motion.captions[index];
  if (!caption) return [];
  const words: string[] = caption.text.toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) ?? [];
  return (motion.pronunciationNotes ?? []).filter(
    (note) => note.startMs >= caption.startMs && note.endMs <= caption.endMs &&
      words.includes(note.word.toLowerCase()),
  );
};

export const validatePronunciationNotes = (motion: Motion) => {
  if (motion.pronunciationNotes === undefined) return;
  if (!Array.isArray(motion.pronunciationNotes)) throw new Error("发音标注必须是数组");
  for (const note of motion.pronunciationNotes) {
    if (note?.audio && (typeof note.audio.src !== "string" || !note.audio.src || /^(?:[a-z]+:|\/)|(?:^|\/)\.\.(?:\/|$)|[\\?#]/i.test(note.audio.src) ||
      note.audio.word !== note.word || !Number.isFinite(note.audio.durationMs) || note.audio.durationMs <= 0)) throw new Error("发音示范音频或单词不匹配");
    if (!note || typeof note.word !== "string" || !/^[a-z]+(?:['’-][a-z]+)*$/i.test(note.word) ||
      typeof note.ipa !== "string" || !note.ipa.trim() || typeof note.tip !== "string" || !note.tip.trim() ||
      !["self-report", "user-confirmed", "assessment"].includes(note.source) ||
      !Number.isFinite(note.startMs) || !Number.isFinite(note.endMs) || note.startMs < 0 ||
      note.endMs < note.startMs || note.endMs > motion.video.durationMs) {
      throw new Error("发音标注的单词、读音、来源或时间戳无效");
    }
    if (!motion.captions.some((_, index) => pronunciationForCaption(motion, index).includes(note))) {
      throw new Error(`发音标注已不匹配当前字幕或时间轴：${note.word}`);
    }
  }
};

export const captionIndexAt = (motion: Motion, ms: number) =>
  motion.captions.reduce(
    (index, caption, i) => (caption.startMs <= ms ? i : index),
    -1,
  );

const clamp = (n: number) => Math.max(0, Math.min(1, n));

// Each sentence moves bottom → top → out; all positions derive from time, including when seeking backwards.
export const getCaptionRows = (motion: Motion, ms: number) => {
  const current = captionIndexAt(motion, ms);
  return motion.captions.flatMap((caption, index) => {
    if (index > current || index < current - 2) return [];
    const next = motion.captions[index + 1]?.startMs;
    const after = motion.captions[index + 2]?.startMs;
    if (after !== undefined && ms >= after + PUSH_MS) return [];
    const enter = clamp((ms - caption.startMs) / PUSH_MS);
    const move = next === undefined ? 0 : clamp((ms - next) / PUSH_MS);
    const exit = after === undefined ? 0 : clamp((ms - after) / PUSH_MS);
    const eased = (p: number) => 1 - Math.pow(1 - p, 3);
    return [
      {
        index,
        position:
          index === 0
            ? (1 - eased(enter)) * 0.15 - eased(exit)
            : 2 - eased(enter) - eased(move) - eased(exit),
        opacity: enter * (1 - exit),
        current: index === current,
      },
    ];
  });
};

// The final correction needs the same reading time as a sentence followed by another sentence.
export const getReadingTailMs = (motion: Motion) =>
  Math.max(
    600,
    ...motion.corrections.map(
      (c) => c.startMs + FIX_MS + READ_MS - motion.video.durationMs,
    ),
    ...(motion.pronunciationNotes ?? []).map(
      (note) => note.endMs + READ_MS - motion.video.durationMs,
    ),
  );

export const getMainMs = (motion: Motion) =>
  motion.video.durationMs +
  getHits(motion).length * FREEZE_MS +
  getReadingTailMs(motion);

export const getClock = (outMs: number, hits: Correction[]) => {
  let offset = 0;
  for (const hit of hits) {
    const start = hit.endMs + offset;
    if (outMs < start) break;
    if (outMs < start + FREEZE_MS)
      return { ms: hit.endMs, hit, hitMs: outMs - start };
    offset += FREEZE_MS;
  }
  return { ms: outMs - offset, hit: null, hitMs: 0 };
};

export const splitCaption = (motion: Motion, index: number) => {
  const caption = motion.captions[index];
  const parts: (string | Correction)[] = [];
  let cursor = 0;
  for (const correction of correctionsForCaption(motion, index).sort(
    (a, b) => a.startMs - b.startMs,
  )) {
    const at = caption.text.indexOf(correction.original, cursor);
    if (at < 0) continue;
    parts.push(caption.text.slice(cursor, at), correction);
    cursor = at + correction.original.length;
  }
  parts.push(caption.text.slice(cursor));
  return parts;
};

export type RecapLayout = {
  viewportHeight: number;
  contentHeight: number;
  captions: { top: number; bottom: number }[];
};

// Derive scroll from time and measured layout, so seeking and rendering any frame agree.
export const getRecapScroll = (motion: Motion, ms: number, layout: RecapLayout) => {
  const max = Math.max(0, layout.contentHeight - layout.viewportHeight);
  if (!max || layout.viewportHeight <= 0) return 0;
  const lines = motion.summary.voice?.lines ?? [];
  const duration = motion.summary.durationMs;
  if (!lines.length) {
    const hold = Math.min(1000, duration / 4);
    return max * clamp((ms - hold) / Math.max(1, duration - hold * 2));
  }

  const bound = (y: number) => Math.max(0, Math.min(max, y));
  const anchors = [{ ms: 0, y: 0 }];
  for (const line of lines) {
    const row = layout.captions[line.caption];
    if (!row) continue;
    const previous = anchors[anchors.length - 1];
    const start = Math.max(previous.y, bound(row.top - layout.viewportHeight * 0.35));
    const end = Math.max(start, bound(row.bottom - layout.viewportHeight * 0.65));
    anchors.push({ ms: Math.max(previous.ms, line.startMs), y: start });
    anchors.push({ ms: Math.max(line.startMs, line.endMs), y: end });
  }
  anchors.push({ ms: Math.max(anchors[anchors.length - 1].ms, duration - 500), y: max });
  for (let i = 1; i < anchors.length; i++) {
    const before = anchors[i - 1];
    const after = anchors[i];
    if (ms < after.ms) {
      const p = clamp((ms - before.ms) / Math.max(1, after.ms - before.ms));
      const eased = p * p * (3 - 2 * p);
      return before.y + (after.y - before.y) * eased;
    }
  }
  return max;
};
