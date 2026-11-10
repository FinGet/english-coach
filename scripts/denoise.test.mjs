import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("./denoise-video.mjs", import.meta.url));
const episode = fileURLToPath(new URL("./episode.mjs", import.meta.url));
const trim = fileURLToPath(new URL("./trim-pauses.mjs", import.meta.url));
const fixture = (t, delay = 0) => {
  const cwd = mkdtempSync(join(tmpdir(), "coach-denoise-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const assets = join(cwd, "public/ep01");
  mkdirSync(assets, { recursive: true });
  const video = join(assets, "video.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=black:s=32x32:r=25:d=2", "-itsoffset", String(delay), "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=24000:duration=${2 - delay}`, "-c:v", "libx264", "-ac", "2", "-c:a", "aac", "-shortest", video]);
  writeFileSync(join(assets, "captions.json"), '[{"text":"Hello.","startMs":0,"endMs":2000}]');
  writeFileSync(join(assets, "motion.json"), JSON.stringify({ video: { src: "ep01/video.mp4", durationMs: 2000 }, captions: [{ text: "Hello.", startMs: 0, endMs: 2000 }], corrections: [], summary: {} }));
  const tool = join(cwd, "deep-filter");
  writeFileSync(tool, `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('--version')){console.log('fixture 1');process.exit(0);}
fs.appendFileSync(process.env.COACH_TEST_EVENTS,'denoise\\n');
if(process.env.COACH_TEST_FAIL)throw new Error('simulated model failure');
if(!args.includes('-D'))throw new Error('missing delay compensation');
const input=fs.readFileSync(args.at(-1));let data;
for(let o=12;o+8<=input.length;){const n=input.readUInt32LE(o+4);if(input.toString('ascii',o,o+4)==='data')data=input.subarray(o+8,o+8+n);o+=8+n+n%2;}
const output=path.join(args[args.indexOf('-o')+1],path.basename(args.at(-1)));
if(process.env.COACH_TEST_INVALID){fs.writeFileSync(output,'broken WAV');process.exit(0);}
const pcm=data.subarray(0,data.length-2880);const header=Buffer.alloc(44);
header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(48000,24);header.writeUInt32LE(96000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
fs.writeFileSync(output,Buffer.concat([header,pcm]));
`);
  chmodSync(tool, 0o755);
  const events = join(cwd, "events.txt");
  const env = { ...process.env, DEEP_FILTER_BIN: tool, COACH_TEST_EVENTS: events };
  const snapshot = () => [video, join(assets, "motion.json"), join(assets, "captions.json")].map((p) => readFileSync(p));
  const run = (args = [], overrides = {}, hook) => spawnSync(process.execPath, [...(hook ? ["--import", `data:text/javascript,${encodeURIComponent(hook)}`] : []), cli, "--episode", "1", ...args], { cwd, env: { ...env, ...overrides }, encoding: "utf8" });
  return { cwd, assets, video, tool, events, env, snapshot, run };
};

test("preview preserves inputs; apply keeps original audio, duration and picture; repeats reuse without stacking", (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  const preview = f.run();
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(f.snapshot(), before);
  const work = join(f.cwd, "output/_work/ep01/denoise");
  const metadata = readdirSync(work).find((p) => p.endsWith(".mp4.json"));
  const report = JSON.parse(readFileSync(join(work, metadata)));
  assert.equal(report.db, 6);
  assert.equal(report.restoredTailSamples, 1440);
  assert.ok(Math.abs(report.outputDurationMs - report.inputDurationMs) <= 2);
  assert.ok(Math.abs(report.samples / 48 - report.inputDurationMs) <= 1);
  assert.equal(f.run().status, 0);
  assert.equal(readFileSync(f.events, "utf8"), "denoise\n");
  const applied = f.run(["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(readFileSync(join(f.assets, "video.before-denoise.mp4")), before[0]);
  assert.deepEqual(f.snapshot().slice(1), before.slice(1));
  const once = f.snapshot();
  assert.equal(f.run(["--apply"]).status, 0);
  assert.deepEqual(f.snapshot(), once);
  assert.equal(readFileSync(f.events, "utf8"), "denoise\n");
  assert.match(f.run(["--apply", "--db", "12"]).stderr, /避免重复降噪/);
  const trimmed = spawnSync(process.execPath, [trim, "--episode", "1"], { cwd: f.cwd, encoding: "utf8" });
  assert.match(trimmed.stderr, /先依据原声剪静音/);
  assert.deepEqual(f.snapshot(), once);
});

test("an initial audio timestamp gap stays in place instead of moving speech before its picture", (t) => {
  const f = fixture(t, 0.3);
  const applied = f.run(["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  const rms = (start) => {
    const bytes = execFileSync("ffmpeg", ["-v", "error", "-i", f.video, "-ss", String(start), "-t", "0.1", "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
    let power = 0;
    for (let i = 0; i < bytes.length; i += 4) power += bytes.readFloatLE(i) ** 2;
    return Math.sqrt(power / (bytes.length / 4));
  };
  assert.ok(rms(0.02) < 0.001);
  assert.ok(rms(0.6) > 0.02);
});

test("invalid strength, unavailable tool, failed inference and malformed WAV cannot alter the source", (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  for (const [args, overrides] of [[["--db", "0"], {}], [[], { DEEP_FILTER_BIN: join(f.cwd, "missing") }], [["--apply"], { COACH_TEST_FAIL: "1" }], [["--apply"], { COACH_TEST_INVALID: "1" }]]) {
    const result = f.run(args, overrides);
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(existsSync(`${f.video}.denoise.json`), false);
    assert.equal(existsSync(join(f.assets, "video.before-denoise.mp4")), false);
  }
  assert.ok(!readdirSync(join(f.cwd, "output/_work/ep01/denoise")).some((p) => p.startsWith(".denoise-")));
});

test("commit failure restores the working video and leaves a recoverable original rather than a false success receipt", (t) => {
  const f = fixture(t);
  const before = f.snapshot();
  const hook = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to.endsWith('.denoise.json'))throw new Error('simulated receipt failure');return rename(from,to)};syncBuiltinESMExports();`;
  const result = f.run(["--apply"], {}, hook);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated receipt failure/);
  assert.deepEqual(f.snapshot(), before);
  assert.deepEqual(readFileSync(join(f.assets, "video.before-denoise.mp4")), before[0]);
  assert.equal(existsSync(`${f.video}.denoise.json`), false);
  assert.match(f.run(["--apply"]).stderr, /处理记录或当前视频不匹配/);
});

test("episode transcribes a denoised copy, trims and assesses original audio, then applies denoising before preview", (t) => {
  const f = fixture(t);
  for (const file of ["asr-venv/bin/python", "local-pronunciation/manifest.json", "local-pronunciation/model/pytorch_model.bin", "local-pronunciation/vendor/openpronounce/phones.py"]) {
    const path = join(f.cwd, ".cache", file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "fixture");
  }
  const hook = `import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import assert from 'node:assert/strict';
const exec=cp.execFileSync;const log=s=>fs.appendFileSync(process.env.COACH_TEST_EVENTS,s+'\\n');
cp.execFileSync=(command,args,options)=>{
if(command==='node'&&args[0]==='scripts/transcribe.mjs'){log('transcribe');assert.ok(args[1].startsWith('output/_work/ep02/denoise/'));fs.writeFileSync(args[2],'[{"text":"Hello.","startMs":0,"endMs":2000}]');return;}
if(command==='node'&&args[0]==='scripts/audit.mjs'){log('audit');fs.writeFileSync('public/ep02/motion.json',JSON.stringify({video:{src:'ep02/video.mp4',durationMs:2000},captions:[{text:'Hello.',startMs:0,endMs:2000}],corrections:[],summary:{}}));return;}
if(command==='node'&&args[0]==='scripts/trim-pauses.mjs'){log('trim');assert.ok(!fs.existsSync('public/ep02/video.mp4.denoise.json'));return exec(process.execPath,[${JSON.stringify(trim)},...args.slice(1)],options);}
if(command==='node'&&args[0]==='scripts/assess-local-pronunciation.mjs'){log('pronunciation');assert.ok(args.includes('--apply'));assert.ok(!fs.existsSync('public/ep02/video.mp4.denoise.json'));assert.ok(fs.existsSync('public/ep02/motion.json'));return;}
return exec(command,args,options);};syncBuiltinESMExports();`;
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(hook)}`, episode, f.video, "2", "--denoise-db", "12"], { cwd: f.cwd, env: f.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.events, "utf8"), "denoise\ntranscribe\naudit\ntrim\npronunciation\n");
  assert.ok(existsSync(join(f.cwd, "public/ep02/source.mp4")));
  const receipt = JSON.parse(readFileSync(join(f.cwd, "public/ep02/video.mp4.denoise.json")));
  assert.equal(receipt.db, 12);
  assert.equal(JSON.parse(readFileSync(join(f.cwd, "episode.config.json"))).episode, 2);
});
