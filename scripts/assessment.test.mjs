import assert from "node:assert/strict";
import test from "node:test";
import { validateAssessment } from "./assessment.mjs";

const assessment = {
  grammar: 36,
  vocabulary: 22,
  naturalness: 24,
  note: "Clear ideas; improve word choice.",
};

test("the original-text score has a 100-point maximum", () => {
  const score = validateAssessment(assessment);
  assert.equal(score.grammar + score.vocabulary + score.naturalness, 82);
  const perfect = validateAssessment({
    ...assessment,
    grammar: 40,
    vocabulary: 30,
    naturalness: 30,
  });
  assert.equal(perfect.grammar + perfect.vocabulary + perfect.naturalness, 100);
  assert.equal(validateAssessment({ ...assessment, grammar: 0 }).grammar, 0);
});

test("invalid or missing rubric values fail before an episode is saved", () => {
  for (const value of [
    null,
    {},
    { ...assessment, grammar: 41 },
    { ...assessment, vocabulary: -1 },
    { ...assessment, naturalness: 30.5 },
    { ...assessment, grammar: "36" },
    { ...assessment, note: " " },
  ]) {
    assert.throws(() => validateAssessment(value));
  }
});
