import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/timeline.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const {
  getCaptionRows,
  getClock,
  getHits,
  getMainMs,
  getReadingTailMs,
  splitCaption,
  correctionsForCaption,
  getRecapScroll,
  pronunciationForCaption,
  validatePronunciationNotes,
  splitPronunciation,
  getPronunciationPages,
  getPronunciationPracticeMs,
  PRONUNCIATION_GAP,
  FIX_MS,
  READ_MS,
  FREEZE_MS,
  PUSH_MS,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const motion = JSON.parse(
  readFileSync(new URL("../examples/motion.json", import.meta.url), "utf8"),
);

test("a new sentence pushes the current sentence upwards without exposing future text", () => {
  const first = getCaptionRows(motion, motion.captions[0].startMs + PUSH_MS);
  assert.deepEqual(
    first.map((r) => [r.index, r.position]),
    [[0, 0]],
  );
  const start = motion.captions[2].startMs;
  assert.deepEqual(
    getCaptionRows(motion, start - 1).map((r) => r.index),
    [0, 1],
  );
  const during = getCaptionRows(motion, start + PUSH_MS / 2);
  assert.deepEqual(
    during.map((r) => r.index),
    [0, 1, 2],
  );
  assert.ok(during.find((r) => r.index === 1).position > 0);
  assert.ok(during.find((r) => r.index === 1).position < 1);
  assert.deepEqual(
    getCaptionRows(motion, start + PUSH_MS).map((r) => r.index),
    [1, 2],
  );
  assert.deepEqual(getCaptionRows(motion, 0), []);
});

test("a sentence-end correction remains visible through the following sentence", () => {
  const i = motion.captions.findIndex((c) => c.text.includes("no failure"));
  const correction = correctionsForCaption(motion, i)[0];
  assert.ok(correction);
  assert.ok(
    getCaptionRows(motion, correction.startMs + FIX_MS + READ_MS).some(
      (r) => r.index === i,
    ),
  );
  assert.ok(
    splitCaption(motion, i).some(
      (part) =>
        typeof part !== "string" && part.corrected.includes("only feedback"),
    ),
  );
});

test("the last correction gets a full reading window before the recap", () => {
  const last = motion.corrections.at(-1);
  const main = getMainMs(motion);
  const sourceClock = getClock(main - 1, getHits(motion));
  assert.ok(sourceClock.ms - last.startMs >= FIX_MS + READ_MS - 1);
  assert.deepEqual(
    getCaptionRows(motion, sourceClock.ms).map((r) => r.index),
    [motion.captions.length - 2, motion.captions.length - 1],
  );
  assert.equal(
    main,
    motion.video.durationMs +
      getReadingTailMs(motion) +
      getHits(motion).length * FREEZE_MS,
  );
});

test("repeat-offender freezes preserve the source clock, including multiple hits", () => {
  const hits = [{ endMs: 2000 }, { endMs: 6000 }];
  assert.equal(getClock(1999, hits).ms, 1999);
  assert.equal(getClock(2000, hits).hit, hits[0]);
  assert.equal(getClock(2000 + FREEZE_MS - 1, hits).ms, 2000);
  assert.equal(getClock(2000 + FREEZE_MS, hits).ms, 2000);
  assert.equal(getClock(6000 + FREEZE_MS, hits).hit, hits[1]);
  assert.equal(getClock(7000 + FREEZE_MS * 2, hits).ms, 7000);
});

test("a correction exactly on a caption boundary belongs to matching text", () => {
  const m = {
    ...motion,
    captions: [
      { text: "wrong", startMs: 0, endMs: 1000 },
      { text: "next", startMs: 1000, endMs: 2000 },
    ],
    corrections: [
      { startMs: 1000, endMs: 1000, original: "wrong", corrected: "right" },
    ],
  };
  assert.equal(splitCaption(m, 0)[1].corrected, "right");
  assert.deepEqual(correctionsForCaption(m, 1), []);
});

test("zero corrections still produce two-sentence playback and a finite tail", () => {
  const m = { ...motion, corrections: [] };
  assert.equal(getReadingTailMs(m), 600);
  assert.ok(Number.isFinite(getMainMs(m)));
  assert.equal(
    getCaptionRows(m, motion.captions[1].startMs + PUSH_MS).length,
    2,
  );
});

test("pronunciation notes match whole words and their spoken interval without changing captions or scores", () => {
  const m = {
    ...motion,
    captions: [{ text: "She scolds him.", startMs: 0, endMs: 2000 }],
    pronunciationNotes: [{ word: "scolds", ipa: "/skoʊldz/", tip: "Keep the final consonants clear.", startMs: 400, endMs: 900, source: "self-report" }],
  };
  const before = structuredClone(m);
  validatePronunciationNotes(m);
  assert.deepEqual(pronunciationForCaption(m, 0), m.pronunciationNotes);
  assert.deepEqual(pronunciationForCaption(m, 1), []);
  assert.deepEqual(m, before);
  m.pronunciationNotes[0].source = "user-confirmed";
  validatePronunciationNotes(m);
  m.pronunciationNotes[0].word = "scold";
  assert.deepEqual(pronunciationForCaption(m, 0), []);
  assert.throws(() => validatePronunciationNotes(m), /不匹配/);
  m.pronunciationNotes[0].word = "SCOLDS";
  validatePronunciationNotes(m);
  m.pronunciationNotes[0].endMs = 3000;
  assert.throws(() => validatePronunciationNotes(m), /不匹配/);
  m.pronunciationNotes[0].endMs = 900;
  m.pronunciationNotes[0].source = "asr-guess";
  assert.throws(() => validatePronunciationNotes(m), /来源或时间戳无效/);
});

test("a pronunciation note on the last word gets reading time without creating a freeze", () => {
  const m = { ...motion, corrections: [], pronunciationNotes: [{ endMs: motion.video.durationMs }] };
  assert.equal(getReadingTailMs(m), READ_MS);
  assert.equal(getMainMs(m), motion.video.durationMs + READ_MS);
  assert.deepEqual(getHits(m), []);
});

test("multiple pronunciation marks preserve sentence text, case and punctuation without matching word fragments", () => {
  const notes = [
    { word: "scrolled", endMs: 400 },
    { word: "scolds", endMs: 900 },
    { word: "don't", endMs: 1200 },
  ];
  const text = "SCROLLED, scolds! Scold? I don't know.";
  const parts = splitPronunciation(text, notes);
  assert.equal(parts.map((part) => part.text).join(""), text);
  assert.deepEqual(parts.filter((part) => part.note).map((part) => part.text), ["SCROLLED", "scolds", "don't"]);
  assert.deepEqual(splitPronunciation(text, notes.filter((note) => note.endMs <= 500)).filter((part) => part.note).map((part) => part.text), ["SCROLLED"]);
  assert.ok(splitPronunciation(text, []).every((part) => !part.note));
});

test("pronunciation practice uses measured card heights to fit more words on one screen", () => {
  assert.deepEqual(getPronunciationPages({ ...motion, pronunciationNotes: undefined }, [], 1200), []);
  assert.equal(getPronunciationPracticeMs({ ...motion, pronunciationNotes: [] }), 0);
  for (const count of [1, 2, 3, 6, 9, 17]) {
    const notes = Array.from({ length: count }, (_, i) => ({ word: `word${i}` }));
    const m = { ...motion, pronunciationNotes: notes };
    const before = structuredClone(m);
    const pages = getPronunciationPages(m, [
      { columns: 1, heights: notes.map(() => 210) },
      { columns: 2, heights: notes.map(() => 270) },
    ], 1200);
    assert.deepEqual(pages.flatMap((page) => page.notes), notes);
    assert.ok(pages.every((page) => page.height <= 1200));
    assert.equal(pages.reduce((sum, page) => sum + page.durationMs, 0), getPronunciationPracticeMs(m));
    assert.equal(pages[0].startMs, 0);
    for (let i = 1; i < pages.length; i++) {
      assert.equal(pages[i].startMs, pages[i - 1].startMs + pages[i - 1].durationMs);
    }
    if (count <= 3) assert.equal(pages[0].columns, 1);
    if (count === 6) {
      assert.equal(pages.length, 1);
      assert.equal(pages[0].columns, 2);
      assert.equal(pages[0].notes.length, 6);
    }
    assert.deepEqual(m, before);
  }
});

test("long wrapped tips and words change pagination instead of being clipped to a fixed card height", () => {
  const notes = Array.from({ length: 8 }, (_, i) => ({ word: `word${i}` }));
  const m = { ...motion, pronunciationNotes: notes };
  const short = getPronunciationPages(m, [
    { columns: 1, heights: notes.map(() => 210) },
    { columns: 2, heights: notes.map(() => 270) },
  ], 1200);
  assert.equal(short.length, 1);
  assert.equal(short[0].height, 4 * 270 + 3 * PRONUNCIATION_GAP);
  const long = getPronunciationPages(m, [
    { columns: 1, heights: notes.map(() => 380) },
    { columns: 2, heights: notes.map(() => 620) },
  ], 1200);
  assert.equal(long.length, 3);
  assert.ok(long.every((page) => page.columns === 1 && page.height <= 1200));
  assert.equal(long.reduce((sum, page) => sum + page.durationMs, 0), getPronunciationPracticeMs(m));
  const oversized = getPronunciationPages({ ...motion, pronunciationNotes: notes.slice(0, 1) }, [
    { columns: 1, heights: [1600] },
    { columns: 2, heights: [2400] },
  ], 1200);
  assert.equal(oversized[0].columns, 1);
  assert.equal(oversized[0].height, 1600);
});

const recapLayout = {
  viewportHeight: 600,
  contentHeight: 2200,
  captions: [
    { top: 0, bottom: 200 },
    { top: 700, bottom: 1000 },
    { top: 1100, bottom: 2000 },
    { top: 2000, bottom: 2200 },
  ],
};

test("short recaps stay still and silent long recaps scroll with holds at both ends", () => {
  const m = { ...motion, summary: { ...motion.summary, durationMs: 10000 } };
  assert.equal(getRecapScroll(m, 5000, { ...recapLayout, contentHeight: 400 }), 0);
  assert.equal(getRecapScroll(m, 0, recapLayout), 0);
  assert.equal(getRecapScroll(m, 1000, recapLayout), 0);
  assert.equal(getRecapScroll(m, 5000, recapLayout), 800);
  assert.equal(getRecapScroll(m, 9000, recapLayout), 1600);
  assert.equal(getRecapScroll(m, 10000, recapLayout), 1600);
});

test("narrated recaps keep the spoken caption visible and finish at the bottom", () => {
  const m = { ...motion, summary: {
    ...motion.summary, durationMs: 12000,
    voice: { lines: [
      { caption: 0, startMs: 2000, endMs: 4000 },
      { caption: 1, startMs: 4500, endMs: 6500 },
      { caption: 2, startMs: 7000, endMs: 10500 },
    ] },
  } };
  const positions = Array.from({ length: 121 }, (_, i) => getRecapScroll(m, i * 100, recapLayout));
  assert.equal(positions[0], 0);
  assert.equal(positions.at(-1), 1600);
  assert.ok(positions.every((y, i) => y >= 0 && y <= 1600 && (!i || y >= positions[i - 1])));
  const start = getRecapScroll(m, 7000, recapLayout);
  const end = getRecapScroll(m, 10500, recapLayout);
  assert.ok(start <= recapLayout.captions[2].top);
  assert.ok(end > start, "a caption taller than the viewport must move while it is spoken");
  assert.ok(recapLayout.captions[2].bottom - end <= recapLayout.viewportHeight);
  // Seeking backwards must not depend on earlier playback or accumulated scrollTop.
  assert.equal(getRecapScroll(m, 7000, recapLayout), start);
  assert.equal(getRecapScroll(m, 0, recapLayout), 0);
});
