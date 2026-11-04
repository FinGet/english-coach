// These are transcript scores; the audit never receives the audio.
export const validateAssessment = (value) => {
  if (!value || typeof value !== "object")
    throw new Error("缺少原文文本评分 assessment");
  for (const [key, max] of [
    ["grammar", 40],
    ["vocabulary", 30],
    ["naturalness", 30],
  ]) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > max) {
      throw new Error(`评分 ${key} 必须是 0–${max} 的整数`);
    }
  }
  if (
    typeof value.note !== "string" ||
    !value.note.trim() ||
    value.note.length > 180
  ) {
    throw new Error("评分说明 note 必须是 1–180 字符的文本");
  }
  return {
    grammar: value.grammar,
    vocabulary: value.vocabulary,
    naturalness: value.naturalness,
    note: value.note.trim(),
  };
};
