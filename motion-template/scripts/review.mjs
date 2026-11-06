import { validateAssessment } from "./assessment.mjs";

const tokens = (text) => text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);

export const validateWords = (words, durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Invalid source duration");
  if (!Array.isArray(words) || !words.length || words.length > 2000) throw new Error("Provide a nonempty word-timestamp array");
  for (const [i, word] of words.entries()) {
    if (typeof word.text !== "string" || !tokens(word.text).length || !Number.isFinite(word.startMs) || !Number.isFinite(word.endMs) || word.startMs < 0 || word.endMs <= word.startMs || word.endMs > durationMs || (i && word.startMs < words[i - 1].startMs)) throw new Error(`Invalid real word timestamp at index ${i}`);
  }
  return words;
};

export const knownFingerprints = (history, episode) => {
  const counts = {};
  for (const [prior, list] of Object.entries(history)) {
    if (!Array.isArray(list) || list.some((name) => typeof name !== "string")) throw new Error("Invalid recipient error history");
    if (Number(prior) < episode) for (const name of list) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
};

// The host AI supplies prose decisions; all timing is mapped from measured words.
export const compileReview = ({ review, words, durationMs, episode, video, history = {}, creator = "Learner" }) => {
  validateWords(words, durationMs);
  if (!Number.isInteger(episode) || episode < 1 || !Array.isArray(review?.captions) || !review.captions.length || !Array.isArray(review.corrections)) throw new Error("Review requires captions, corrections and valid episode metadata");
  const assessment = validateAssessment(review.assessment);
  const flat = words.flatMap((word, i) => tokens(word.text).map((text) => ({ text, word: i })));
  let cursor = 0;
  const captions = review.captions.map((text) => {
    if (typeof text !== "string" || !tokens(text).length) throw new Error("Review captions must be nonempty strings");
    const sentence = tokens(text);
    if (sentence.some((token, i) => token !== flat[cursor + i]?.text)) throw new Error(`Host AI changed or reordered the source words: ${text}`);
    const first = cursor;
    cursor += sentence.length;
    const word = words[flat[first].word];
    const startMs = word.endMs - word.startMs > 1200 && sentence.length > 1 ? words[flat[first + 1].word].startMs : word.startMs;
    return { text, startMs, endMs: 0, first };
  });
  if (cursor !== flat.length) throw new Error("Host AI omitted source words");
  captions.forEach((caption, i) => { caption.endMs = captions[i + 1]?.startMs ?? durationMs; });
  const locations = new Map();
  const pending = review.corrections.map((fix) => {
    const caption = Number.isInteger(fix.caption) ? captions[fix.caption] : null;
    if (!caption || ![1, 2].includes(fix.level) || typeof fix.original !== "string" || !fix.original || typeof fix.corrected !== "string" || !fix.corrected || typeof fix.fingerprint !== "string" || !/^[a-z][a-z0-9_-]*:[a-z0-9_-]+$/.test(fix.fingerprint) || typeof fix.label !== "string" || !fix.label.trim()) throw new Error("Invalid host correction: use a real caption, level 1/2, exact original, corrected text, label and fingerprint");
    const at = caption.text.indexOf(fix.original);
    if (at < 0 || caption.text.indexOf(fix.original, at + 1) >= 0) throw new Error(`Use an exact, unambiguous original phrase: ${fix.original}`);
    const ranges = locations.get(fix.caption) ?? [];
    if (ranges.some(([start, end]) => at < end && at + fix.original.length > start)) throw new Error("Overlapping corrections are not supported; combine the phrase");
    ranges.push([at, at + fix.original.length]);
    locations.set(fix.caption, ranges);
    const tokenIndex = caption.first + tokens(caption.text.slice(0, at + fix.original.length)).length - 1;
    const spokenMs = words[flat[tokenIndex]?.word]?.endMs;
    if (!Number.isFinite(spokenMs) || spokenMs > caption.endMs) throw new Error("Correction words extend beyond their source caption");
    if (fix.narrationContext !== undefined && !["previous", "next", "both"].includes(fix.narrationContext)) throw new Error("Invalid narration context");
    return { level: fix.level, original: fix.original, corrected: fix.corrected, label: fix.label, fingerprint: fix.fingerprint, spokenMs,
      ...(fix.narrationContext === undefined ? {} : { narrationContext: fix.narrationContext }) };
  }).sort((a, b) => a.spokenMs - b.spokenMs);
  const counts = knownFingerprints(history, episode);
  let hits = 0;
  const corrections = pending.map(({ spokenMs, ...fix }) => {
    if (fix.level === 1) return { ...fix, startMs: spokenMs, endMs: spokenMs };
    counts[fix.fingerprint] = (counts[fix.fingerprint] ?? 0) + 1;
    if (counts[fix.fingerprint] < 3 || hits >= 2) return { ...fix, startMs: spokenMs, endMs: spokenMs };
    hits++;
    return { ...fix, level: 3, startMs: spokenMs, endMs: Math.min(durationMs, spokenMs + 560), repeatCount: counts[fix.fingerprint] };
  });
  return {
    meta: { creator, episode, title: "English speaking journal" },
    video: { src: video, durationMs },
    captions: captions.map(({ first, ...caption }) => caption),
    corrections,
    summary: { durationMs: 6000, coachNote: "Host-AI text review; pronunciation is not assessed.", assessment },
  };
};
