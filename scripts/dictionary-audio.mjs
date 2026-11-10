import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalizeWord = (word) => word.replaceAll("*", "").replaceAll("’", "'").trim().toLowerCase();
const normalizeIpa = (ipa) => ipa.replace(/[\/ˈˌ.\sː]/g, "").replaceAll("ɹ", "r").replaceAll("ər", "ɚ").replaceAll("ɛ", "e");
const CACHE = "public/_cache/dictionary";

export const getDictionaryCacheKey = (note) => hash(JSON.stringify({ version: 1, word: normalizeWord(note.word), acronym: /^[A-Z]{2,}$/.test(note.word), ipa: note.ipa, audioId: note.dictionaryAudioId }));

export const getMerriamAudioUrl = (audioId) => {
  if (typeof audioId !== "string" || !/^[a-z0-9_-]+$/i.test(audioId)) throw new Error("韦氏音频标识无效");
  const subdirectory = audioId.startsWith("bix") ? "bix" : audioId.startsWith("gg") ? "gg" : /^[0-9_]/.test(audioId) ? "number" : audioId[0];
  return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdirectory}/${audioId}.mp3`;
};

// Match the actual spoken form, never a stem merely listed in meta.stems.
export const getMerriamCandidates = (word, entries, dictionary) => {
  if (!Array.isArray(entries)) throw new Error(`韦氏 ${dictionary} 凭据无效或未返回词条`);
  const candidates = [];
  const target = normalizeWord(word);
  const add = (spelling, pronunciations, entry) => {
    if (typeof spelling !== "string" || normalizeWord(spelling) !== target) return;
    if (/^[A-Z]{2,}$/.test(word) && spelling.replaceAll("*", "") !== word) return;
    for (const pronunciation of pronunciations ?? []) {
      if (!pronunciation.sound?.audio || /\b(?:British|UK|chiefly British)\b/i.test(`${pronunciation.l ?? ""} ${pronunciation.l2 ?? ""}`)) continue;
      const audioId = pronunciation.sound.audio;
      const url = getMerriamAudioUrl(audioId);
      candidates.push({ audioId, url, dictionary, entryId: entry.meta?.id, ipa: pronunciation.ipa, pronunciation: pronunciation.ipa ?? pronunciation.mw });
    }
  };
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || /:[bg]\d+$/i.test(entry.meta?.id ?? "")) continue;
    add(entry.hwi?.hw, entry.hwi?.prs, entry);
    for (const inflection of entry.ins ?? []) add(inflection.if, inflection.prs, entry);
    for (const runOn of entry.uros ?? []) add(runOn.ure, runOn.prs, entry);
    for (const variant of entry.vrs ?? []) add(variant.va, variant.prs, entry);
    for (const alternate of entry.ahws ?? []) add(alternate.hw, alternate.prs, entry);
  }
  return candidates;
};

export const selectMerriamCandidate = (note, candidates) => {
  const withIpa = (selected) => ({ ...selected, ipa: candidates.find((candidate) => candidate.audioId === selected.audioId && candidate.ipa && !candidate.ipa.startsWith("-"))?.ipa ?? selected.ipa });
  if (note.dictionaryAudioId) {
    const selected = candidates.find((candidate) => candidate.audioId === note.dictionaryAudioId);
    if (!selected) throw new Error(`${note.word} 指定的韦氏录音不匹配该词形`);
    return withIpa(selected);
  }
  const matching = candidates.filter((candidate) => candidate.ipa && normalizeIpa(candidate.ipa) === normalizeIpa(note.ipa));
  const ids = new Set(matching.map((candidate) => candidate.audioId));
  if (ids.size) return withIpa(candidates.find((candidate) => ids.has(candidate.audioId)));
  const distinct = [...new Set(candidates.map((candidate) => candidate.audioId))];
  if (distinct.length === 1) return withIpa(candidates[0]);
  if (!distinct.length) throw new Error(`${note.word} 没有匹配当前词形的韦氏美音录音；未替换为原形或合成音`);
  throw new Error(`${note.word} 有多个韦氏读音，目标 IPA 未能唯一匹配；请核对原句并设置 dictionaryAudioId：${distinct.join(", ")}`);
};

const readCachedDictionaryAudio = (key, word) => {
  const metadata = `${CACHE}/${key}.json`;
  if (!existsSync(metadata)) return null;
  try {
    const data = JSON.parse(readFileSync(metadata, "utf8"));
    if (data.lookupKey !== key || data.provider !== "merriam-webster" || data.sourceUrl !== `https://www.merriam-webster.com/dictionary/${encodeURIComponent(normalizeWord(word))}` ||
      data.src !== `_cache/dictionary/${key}.mp3` || !Number.isFinite(data.durationMs) || data.durationMs <= 0 || data.durationMs > 30000 ||
      data.url !== getMerriamAudioUrl(data.audioId) || data.audioHash !== hash(readFileSync(`public/${data.src}`))) return null;
    return { ...data, word };
  } catch { return null; }
};

export const getCachedDictionaryAudio = (note) => readCachedDictionaryAudio(getDictionaryCacheKey(note), note.word);

export const rebuildDictionaryLibrary = () => {
  const words = Object.create(null);
  for (const name of existsSync(CACHE) ? readdirSync(CACHE) : []) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    let saved;
    try { saved = JSON.parse(readFileSync(`${CACHE}/${name}`, "utf8")); } catch { continue; }
    if (typeof saved?.word !== "string" || !/^[a-z]+(?:['’-][a-z]+)*$/i.test(saved.word)) continue;
    const audio = readCachedDictionaryAudio(name.slice(0, -5), saved.word);
    if (!audio) continue;
    const word = /^[A-Z]{2,}$/.test(audio.word) ? audio.word : normalizeWord(audio.word);
    const { audioId, ipa, pronunciation, provider, dictionary, sourceUrl, src, durationMs } = audio;
    (words[word] ??= []).push({ audioId, ipa, pronunciation, provider, dictionary, sourceUrl, src, durationMs });
  }
  const library = { version: 1, words: Object.fromEntries(Object.entries(words).sort(([a], [b]) => a.localeCompare(b))) };
  mkdirSync(CACHE, { recursive: true });
  const temporary = `${CACHE}/library.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(library, null, 2) + "\n");
  renameSync(temporary, `${CACHE}/library.json`);
  return library;
};

const request = async (url) => {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    // Fetch errors can contain the API URL and key; never propagate their details.
    throw new Error(`韦氏请求失败：${/^HTTP \d+$/.test(error.message) ? error.message : "网络错误"}；已完成缓存保留`);
  }
};

export const prepareDictionaryAudio = async (note) => {
  const cached = getCachedDictionaryAudio(note);
  if (cached) {
    rebuildDictionaryLibrary();
    return cached;
  }
  if (!/^[a-z]+(?:['’-][a-z]+)*$/i.test(note.word)) throw new Error("词典示范只接受原文中的单词");
  const candidates = [];
  const word = normalizeWord(note.word);
  let configured = false;
  for (const [dictionary, keyName] of [["collegiate", "MERRIAM_WEBSTER_DICTIONARY_KEY"], ["learners", "MERRIAM_WEBSTER_LEARNERS_KEY"]]) {
    const key = process.env[keyName]?.trim();
    if (!key) continue;
    configured = true;
    const lookup = `.cache/merriam-webster/${dictionary}-${hash(word)}.json`;
    let entries;
    if (existsSync(lookup)) {
      try { entries = JSON.parse(readFileSync(lookup, "utf8")); } catch { /* Re-query incomplete metadata. */ }
    }
    if (!Array.isArray(entries)) {
      const url = new URL(`https://www.dictionaryapi.com/api/v3/references/${dictionary}/json/${encodeURIComponent(word)}`);
      url.searchParams.set("key", key);
      try { entries = await (await request(url)).json(); }
      catch { throw new Error(`韦氏 ${dictionary} 查询失败，请检查凭据、网络和额度；密钥未写入报告`); }
      if (!Array.isArray(entries)) throw new Error(`韦氏 ${dictionary} 凭据无效或未返回词条`);
      mkdirSync(".cache/merriam-webster", { recursive: true });
      writeFileSync(lookup, JSON.stringify(entries) + "\n");
    }
    candidates.push(...getMerriamCandidates(note.word, entries, dictionary));
  }
  if (!configured) throw new Error("缺少 MERRIAM_WEBSTER_DICTIONARY_KEY 或 MERRIAM_WEBSTER_LEARNERS_KEY，请配置本地 .env");
  const selected = selectMerriamCandidate(note, candidates);
  mkdirSync(CACHE, { recursive: true });
  const key = getDictionaryCacheKey(note);
  const path = `${CACHE}/${key}.mp3`;
  const temporary = `${path}.tmp.mp3`;
  const response = await request(selected.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error(`${note.word} 的韦氏录音数据无效`);
  writeFileSync(temporary, bytes);
  let durationMs;
  try {
    durationMs = Math.ceil(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", temporary], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) * 1000);
  } catch { throw new Error(`${note.word} 的韦氏响应不是可播放音频，未覆盖已有录音`); }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 30000) throw new Error(`${note.word} 的韦氏单词录音时长无效`);
  renameSync(temporary, path);
  const audio = { lookupKey: key, provider: "merriam-webster", word: note.word, src: `_cache/dictionary/${key}.mp3`, durationMs,
    ...selected, sourceUrl: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`, audioHash: hash(bytes) };
  writeFileSync(`${CACHE}/${key}.json`, JSON.stringify(audio, null, 2) + "\n");
  rebuildDictionaryLibrary();
  return audio;
};
