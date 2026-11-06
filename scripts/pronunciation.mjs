const tokens = (text) => text.toLowerCase().replaceAll("’", "'").match(/[a-z]+(?:['-][a-z]+)*/g) ?? [];
const isScore = (value) => Number.isFinite(value) && value >= 0 && value <= 100;

export const getPronunciationSegments = (motion) => {
  if (!Number.isFinite(motion.video?.durationMs) || motion.video.durationMs <= 0 || !Array.isArray(motion.captions) || !motion.captions.length) throw new Error("缺少有效视频时长或原文字幕");
  const segments = [];
  let parts = [];
  const flush = () => {
    if (!parts.length) return;
    segments.push({ startMs: parts[0].startMs, endMs: parts.at(-1).endMs, referenceText: parts.map((p) => p.text).join(" "), captions: parts.map((p) => p.caption) });
    parts = [];
  };
  for (const [caption, row] of motion.captions.entries()) {
    if (!row || typeof row.text !== "string" || !tokens(row.text).length || !Number.isFinite(row.startMs) || !Number.isFinite(row.endMs) || row.startMs < 0 || row.endMs <= row.startMs || row.endMs > motion.video.durationMs || (caption > 0 && row.startMs < motion.captions[caption - 1].endMs)) throw new Error(`第 ${caption + 1} 段字幕或时间轴无效`);
    if (row.endMs - row.startMs > 28000) throw new Error(`第 ${caption + 1} 段超过 28 秒，请先按原话拆分字幕`);
    if (parts.length && row.endMs - parts[0].startMs > 28000) flush();
    parts.push({ ...row, caption });
    if (/[.!?]["'”’)]*$/.test(row.text.trim())) flush();
  }
  flush();
  return segments;
};

export const getPronunciationEndpoint = (env) => {
  let url;
  if (env.AZURE_SPEECH_ENDPOINT?.trim()) {
    try { url = new URL(env.AZURE_SPEECH_ENDPOINT.trim()); } catch { throw new Error("AZURE_SPEECH_ENDPOINT 不是有效 URL"); }
    const custom = /^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(url.hostname);
    const regional = /^[a-z0-9-]+\.stt\.speech\.microsoft\.com$/.test(url.hostname);
    if (url.protocol !== "https:" || (!custom && !regional) || url.username || url.password || url.port || url.search || url.hash) throw new Error("仅支持不含凭据或查询参数的官方 Azure Speech HTTPS endpoint");
    const path = `${custom ? "/stt" : ""}/speech/recognition/conversation/cognitiveservices/v1`;
    if (!["/", "/stt", "/stt/", path].includes(url.pathname)) throw new Error("请填写 Azure Speech 资源根 endpoint，或配置 AZURE_SPEECH_REGION");
    url.pathname = path;
  } else {
    const region = env.AZURE_SPEECH_REGION?.trim();
    if (!region || !/^[a-z][a-z0-9-]{1,40}$/.test(region)) throw new Error("请配置 AZURE_SPEECH_REGION（如 southeastasia），或 AZURE_SPEECH_ENDPOINT");
    url = new URL(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`);
  }
  url.searchParams.set("language", "en-US");
  url.searchParams.set("format", "detailed");
  url.searchParams.set("profanity", "raw");
  return url.toString();
};

export const getPronunciationConfig = (referenceText) => ({
  ReferenceText: referenceText,
  GradingSystem: "HundredMark",
  Granularity: "Phoneme",
  Dimension: "Comprehensive",
  EnableMiscue: true,
  EnableProsodyAssessment: false,
  PhonemeAlphabet: "IPA",
  NBestPhonemeCount: 3,
});

export const parsePronunciationResponse = (response, segment) => {
  const best = response?.NBest?.[0];
  const scores = best?.PronunciationAssessment ?? best;
  if (response?.RecognitionStatus !== "Success" || !isScore(scores?.AccuracyScore) || !Array.isArray(best?.Words) || !best.Words.length) throw new Error("Azure 未返回有效发音评分；普通转写成功不代表发音测评成功");
  const timing = (item, required = true) => {
    if (!required && (item.Offset == null || item.Duration == null)) return { startMs: null, endMs: null };
    if (!Number.isSafeInteger(item.Offset) || !Number.isSafeInteger(item.Duration) || item.Offset < 0 || item.Duration < 0 || (item.Offset + item.Duration) / 10000 > segment.endMs - segment.startMs + 100) throw new Error("Azure 发音测评时间戳无效");
    return { startMs: segment.startMs + Math.round(item.Offset / 10000), endMs: segment.startMs + Math.round((item.Offset + item.Duration) / 10000) };
  };
  const words = best.Words.map((word) => {
    const assessment = word.PronunciationAssessment ?? word;
    const miscue = ["Omission", "Insertion"].includes(assessment.ErrorType);
    if (typeof word.Word !== "string" || !tokens(word.Word).length || !["None", "Omission", "Insertion", "Mispronunciation"].includes(assessment.ErrorType) || (!miscue && !isScore(assessment.AccuracyScore))) throw new Error("Azure 单词发音评分无效");
    if (!miscue && (!Array.isArray(word.Phonemes) || !word.Phonemes.length)) throw new Error("Azure 未返回音素评分，请检查资源、区域和 Phoneme 配置");
    const phonemes = (word.Phonemes ?? []).map((phoneme) => {
      const score = phoneme.PronunciationAssessment ?? phoneme;
      if (typeof phoneme.Phoneme !== "string" || !phoneme.Phoneme.trim() || !isScore(score.AccuracyScore)) throw new Error("Azure 音素评分无效");
      const alternatives = score.NBestPhonemes ?? [];
      if (!Array.isArray(alternatives) || alternatives.some((p) => typeof p.Phoneme !== "string" || !p.Phoneme.trim() || !isScore(p.Score))) throw new Error("Azure 候选音素数据无效");
      return { phoneme: phoneme.Phoneme, accuracy: score.AccuracyScore, alternatives: alternatives.map((p) => ({ phoneme: p.Phoneme, score: p.Score })) };
    });
    return { word: word.Word, ...timing(word, !miscue), accuracy: isScore(assessment.AccuracyScore) ? assessment.AccuracyScore : null, errorType: assessment.ErrorType, phonemes, suspectedMispronunciation: !miscue && (assessment.ErrorType === "Mispronunciation" || assessment.AccuracyScore < 60) };
  });
  return { accuracy: scores.AccuracyScore, words };
};

export const buildPronunciationReport = (motion, results) => {
  const words = results.flatMap((r) => r.assessment.words);
  const candidates = words.filter((w) => w.suspectedMispronunciation).map((word) => {
    const normalized = tokens(word.word);
    const caption = normalized.length !== 1 ? -1 : motion.captions.findIndex((c) => word.startMs >= c.startMs && word.endMs <= c.endMs && tokens(c.text).includes(normalized[0]));
    const lowPhonemes = word.phonemes.filter((p) => p.accuracy < 60).map((p) => p.phoneme);
    return { ...word, caption: caption < 0 ? null : caption, reviewRequired: true, candidateNote: caption < 0 ? null : { word: normalized[0], ipa: `/${word.phonemes.map((p) => p.phoneme).join("")}/`, tip: lowPhonemes.length ? `Review ${lowPhonemes.map((p) => `/${p}/`).join(", ")}; replay the original word.` : "Replay this word and compare it with the target pronunciation.", startMs: word.startMs, endMs: word.endMs, source: "assessment" } };
  });
  const userConfirmedComparison = (motion.pronunciationNotes ?? []).filter((n) => n.source === "user-confirmed").map((note) => {
    const segment = results.find((r) => note.startMs >= r.startMs && note.endMs <= r.endMs);
    const matches = (segment?.assessment.words ?? []).filter((w) => tokens(w.word).join(" ") === tokens(note.word).join(" ") && !["Omission", "Insertion"].includes(w.errorType));
    return { word: note.word, assessedWord: matches.length === 1 ? matches[0] : null, status: matches.length !== 1 ? "not-matched" : matches[0].suspectedMispronunciation ? "flagged" : "not-flagged" };
  });
  return { provider: "Azure Speech Pronunciation Assessment", locale: "en-US", prosodyEnabled: false, threshold: 60, reviewRequired: true, segments: results, candidates, userConfirmedComparison };
};
