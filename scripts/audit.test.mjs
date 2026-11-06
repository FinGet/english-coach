import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("text-only audits preserve pronunciation notes or stop without overwriting stale notes", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "coach-audit-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "public/ep01"), { recursive: true });
  mkdirSync(join(cwd, "scripts"));
  writeFileSync(join(cwd, "scripts/audit-prompt.md"), "Synthetic test prompt.");
  writeFileSync(join(cwd, "public/ep01/captions.json"), JSON.stringify([
    { text: "Say", startMs: 0, endMs: 200 },
    { text: " hello.", startMs: 200, endMs: 700 },
  ]));
  const path = join(cwd, "public/ep01/motion.json");
  const motion = {
    meta: { episode: 1 },
    pronunciationNotes: [{ word: "hello", ipa: "/həˈloʊ/", tip: "Practice.", startMs: 200, endMs: 700, source: "self-report" }],
  };
  writeFileSync(path, JSON.stringify(motion));
  const hook = `import child from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
    child.execFileSync = () => Buffer.from('2'); syncBuiltinESMExports();
    globalThis.fetch = async () => ({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
      captions:['Say hello.'],corrections:[],assessment:{grammar:40,vocabulary:30,naturalness:30,note:'Synthetic assessment.'}
    })}}]})});`;
  const run = () => spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(hook)}`,
    fileURLToPath(new URL("./audit.mjs", import.meta.url)), "--episode", "1", "--video", "ep01/video.mp4"],
  { cwd, encoding: "utf8", env: { ...process.env, LLM_API_KEY: "test-key" } });
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path)).pronunciationNotes, motion.pronunciationNotes);
  motion.pronunciationNotes[0].word = "goodbye";
  writeFileSync(path, JSON.stringify(motion));
  const before = readFileSync(path, "utf8");
  const history = readFileSync(join(cwd, "error_history.json"), "utf8");
  assert.match(run().stderr, /发音标注已不匹配/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(readFileSync(join(cwd, "error_history.json"), "utf8"), history);
});
