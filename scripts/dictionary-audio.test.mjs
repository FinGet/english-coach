import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getDictionaryCacheKey, getMerriamAudioUrl, getMerriamCandidates, prepareDictionaryAudio, rebuildDictionaryLibrary, selectMerriamCandidate } from "./dictionary-audio.mjs";

test("official audio-directory rules work without allowing arbitrary URLs or path traversal", () => {
  for (const [id, directory] of [["accura02", "a"], ["bixrea01", "bix"], ["ggtest01", "gg"], ["3d000001", "number"], ["_test", "number"]]) {
    assert.equal(getMerriamAudioUrl(id), `https://media.merriam-webster.com/audio/prons/en/us/mp3/${directory}/${id}.mp3`);
  }
  for (const id of ["../secret", "https://evil.test/file", "x?key=secret", ""]) assert.throws(() => getMerriamAudioUrl(id));
});

test("exact inflection recordings are used without substituting a stem, suggestion, related word or British audio", () => {
  const entries = [{ meta: { id: "analysis", stems: ["analysis", "analyses"] }, hwi: { hw: "anal*y*sis", prs: [{ sound: { audio: "analys02" } }] },
    ins: [{ if: "anal*y*ses", prs: [{ sound: { audio: "analys03" } }] }] },
  { meta: { id: "related" }, hwi: { hw: "related", prs: [{ sound: { audio: "related01" } }] } }];
  assert.deepEqual(getMerriamCandidates("analyses", entries, "collegiate").map((c) => c.audioId), ["analys03"]);
  assert.equal(getMerriamCandidates("scrolled", [{ meta: { stems: ["scrolled"] }, hwi: { hw: "scroll", prs: [{ sound: { audio: "scroll01" } }] }, ins: [{ if: "scrolled" }] }], "collegiate").length, 0);
  assert.equal(getMerriamCandidates("analyses", ["analysis"], "learners").length, 0);
  assert.equal(getMerriamCandidates("word", [{ hwi: { hw: "word", prs: [{ l: "British", sound: { audio: "word01" } }] } }], "learners").length, 0);
  assert.throws(() => getMerriamCandidates("word", "Invalid API key", "collegiate"), /凭据无效/);
});

test("learner IPA chooses the correct read recording and supplements the collegiate source without changing alphabets", () => {
  const data = [{ meta: { id: "read:1" }, hwi: { hw: "read", prs: [{ sound: { audio: "read0001" }, ipa: "ˈriːd" }] },
    ins: [{ if: "read", prs: [{ sound: { audio: "read0002" }, ipa: "ˈrɛd" }] }] },
  { meta: { id: "Read:b1" }, hwi: { hw: "Read", prs: [{ sound: { audio: "bixrea01" }, ipa: "ˈriːd" }] } }];
  const candidates = getMerriamCandidates("read", data, "learners");
  assert.equal(candidates.length, 2);
  assert.equal(selectMerriamCandidate({ word: "read", ipa: "/riːd/" }, candidates).audioId, "read0001");
  assert.equal(selectMerriamCandidate({ word: "read", ipa: "/red/" }, candidates).audioId, "read0002");
  assert.throws(() => selectMerriamCandidate({ word: "read", ipa: "/unknown/" }, candidates), /多个韦氏读音/);
  assert.equal(selectMerriamCandidate({ word: "read", ipa: "/unknown/", dictionaryAudioId: "read0002" }, candidates).audioId, "read0002");
  assert.throws(() => selectMerriamCandidate({ word: "read", ipa: "/riːd/", dictionaryAudioId: "wrong" }, candidates), /不匹配/);
  assert.throws(() => selectMerriamCandidate({ word: "scrolled", ipa: "/skroʊld/" }, []), /未替换为原形或合成音/);
});

test("acronyms cannot accidentally use a lowercase homograph; independent word audio does not depend on a TTS voice or key", () => {
  const entries = [{ hwi: { hw: "ai", prs: [{ sound: { audio: "animal01" } }] } }, { hwi: { hw: "AI", prs: [{ sound: { audio: "letters01" } }] } }];
  assert.deepEqual(getMerriamCandidates("AI", entries, "collegiate").map((c) => c.audioId), ["letters01"]);
  assert.notEqual(getDictionaryCacheKey({ word: "AI", ipa: "/eɪaɪ/" }), getDictionaryCacheKey({ word: "ai", ipa: "/eɪaɪ/" }));
  assert.equal(getDictionaryCacheKey({ word: "Accurate", ipa: "/a/" }), getDictionaryCacheKey({ word: "accurate", ipa: "/a/" }));
});

test("the persistent word library backfills recordings, separates read pronunciations and reuses them without network", async (t) => {
  const cwd = process.cwd();
  const work = mkdtempSync(join(tmpdir(), "coach-word-library-"));
  const originalFetch = globalThis.fetch;
  t.after(() => { process.chdir(cwd); globalThis.fetch = originalFetch; rmSync(work, { recursive: true, force: true }); });
  process.chdir(work);
  const cache = "public/_cache/dictionary";
  mkdirSync(cache, { recursive: true });
  const notes = [
    { word: "read", ipa: "/riːd/", audioId: "read0001" },
    { word: "read", ipa: "/red/", audioId: "read0002" },
    { word: "Accurate", ipa: "/ˈækjərət/", audioId: "accura02" },
  ];
  const protectedFiles = new Map();
  for (const note of notes) {
    const key = getDictionaryCacheKey(note);
    const bytes = Buffer.from(`existing recording ${note.audioId}`);
    const metadata = { lookupKey: key, provider: "merriam-webster", word: note.word, src: `_cache/dictionary/${key}.mp3`,
      durationMs: 700, audioId: note.audioId, ipa: note.ipa, dictionary: "collegiate", url: getMerriamAudioUrl(note.audioId),
      sourceUrl: `https://www.merriam-webster.com/dictionary/${note.word.toLowerCase()}`, audioHash: createHash("sha256").update(bytes).digest("hex") };
    writeFileSync(`${cache}/${key}.mp3`, bytes);
    writeFileSync(`${cache}/${key}.json`, JSON.stringify(metadata));
    for (const path of [`${cache}/${key}.mp3`, `${cache}/${key}.json`]) protectedFiles.set(path, readFileSync(path));
  }
  writeFileSync(`${cache}/${"0".repeat(64)}.json`, "{broken");
  const library = rebuildDictionaryLibrary();
  assert.deepEqual(Object.keys(library.words), ["accurate", "read"]);
  assert.deepEqual(library.words.read.map((entry) => entry.audioId).sort(), ["read0001", "read0002"]);
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error("Unexpected dictionary request"); };
  for (const note of notes) assert.equal((await prepareDictionaryAudio(note)).audioId, note.audioId);
  assert.equal(requests, 0);
  assert.equal(readFileSync(`${cache}/library.json`, "utf8"), JSON.stringify(library, null, 2) + "\n");
  for (const [path, before] of protectedFiles) assert.deepEqual(readFileSync(path), before);
});
