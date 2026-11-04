import type { Correction, Motion } from "./types";

export const FREEZE_MS = 1600;
export const PUSH_MS = 480;
export const FIX_MS = 450;
export const READ_MS = 2200;

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
