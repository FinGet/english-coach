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
