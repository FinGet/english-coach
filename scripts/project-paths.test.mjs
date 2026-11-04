import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { episodeId, getEpisodePaths } from "./project-paths.mjs";

test("episode paths separate assets, deliverables, verification files and shared TTS cache", () => {
  const paths = getEpisodePaths(2);
  assert.equal(paths.motion, "public/ep02/motion.json");
  assert.equal(paths.videoSrc, "ep02/video.mp4");
  assert.equal(paths.output, "output/ep02");
  assert.equal(paths.work, "output/_work/ep02");
  assert.equal(paths.cache, getEpisodePaths(3).cache);
  for (const input of [0, -1, 1.5, "../ep02", "2/../1", "bad", 10000, ""]) assert.throws(() => episodeId(input));
});

test("CLI uses the selected episode and routes final renders and validation stills to separate directories", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "coach-paths-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, "episode.config.json"), JSON.stringify({ episode: 2 }));
  for (const id of ["ep01", "ep02"]) {
    mkdirSync(join(cwd, "public", id), { recursive: true });
    writeFileSync(join(cwd, "public", id, "motion.json"), "{}");
  }
  const bin = join(cwd, "node_modules/@remotion/cli");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "remotion-cli.js"), "console.log(JSON.stringify(process.argv.slice(2)))");
  const script = fileURLToPath(new URL("./remotion.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  const render = run("render");
  assert.equal(render.status, 0, render.stderr);
  assert.match(render.stdout, /output\/ep02\/video\.mp4/);
  assert.match(render.stdout, /ep02\/motion\.json/);
  const still = run("still", "--episode", "1", "--frame", "90");
  assert.equal(still.status, 0, still.stderr);
  assert.match(still.stdout, /output\/_work\/ep01\/previews\/frame-90\.png/);
  assert.match(still.stdout, /ep01\/motion\.json/);
  assert.equal(existsSync(join(cwd, "out")), false);
  const studio = run("studio");
  assert.equal(studio.status, 0, studio.stderr);
  assert.match(studio.stdout, /ep02\/motion\.json/);
  assert.notEqual(run("render", "--episode", "../bad").status, 0);
});
