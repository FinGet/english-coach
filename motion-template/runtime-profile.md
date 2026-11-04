# english-coach-remotion/1 — custom adapter contract

This is a template-specific runtime profile, not a standard MotionGit-host profile.
A reader may inspect the package without supporting execution. A command-capable
assistant may explicitly select this documented adapter after inspecting its code.
Do not treat a recognized `.motion` extension as proof of engine compatibility.

## Engine and frame semantics

- Engine: Remotion 4.0.539 / React 19.2.3, source `src/index.ts`.
- Composition: `AiEnglishCoachPortrait`, 1080×1920, 30/1 fps.
- Entry adapter: `node scripts/template.mjs <operation>` from the extracted root.
- Inputs: JSON conforming to params.schema.json; default presets/demo.json.
- Per-instance state: creator.config.json and generated render-props.json.
- Episode data: public/<motionSrc>; media paths resolve relative to public/.
- Metadata duration: ceil((getMainMs(episode) + summary.durationMs) / 1000 * 30).
- Every visual reads Remotion's integer frame clock. Seeking does not depend on
  prior playback; there is no random or wall-clock animation state.
- Two bundled FontFace assets must load before frame output; failure cancels rendering.
- Presenter crop is `object-fit: cover`, `object-position: 60% 50%`; inspect each
  recording and edit `fill` in src/Coach.tsx if the face is not retained.
- Output scale 1/2 gives 1080×1920 / 2160×3840, PNG intermediate frames, H.264 MP4,
  selected CRF. Scale does not change the composition geometry.

## Operations

1. Inspect files, permissions, licenses and hashes before installing or executing.
2. Install locked JS dependencies using `npm ci`.
3. `npm run verify`: frozen archive membership and SHA-256 (before instance edits).
4. `npm run check -- --inputs presets/demo.json`: Node/FFmpeg checks, validated
   inputs, local media, real source duration, layout-capacity limits and frame count.
   It prepares local creator/props files, but makes no paid API requests.
5. `npm run dev -- --inputs inputs.json`: prepare, then start Remotion Studio.
6. `npm run still -- --inputs inputs.json --frame 180 --output out/preview.png`.
7. `npm run render -- --inputs inputs.json --output out/english-coach.mp4`.
8. Existing exports are refused unless the recipient explicitly passes `--force`.

New recording handoff:

1. `npm run episode -- recording.mp4 1 [--captions words.json]` transcodes and
   obtains real word timestamps, then writes audit-task.json and stops normally.
2. The current host AI reads that task and scripts/audit-prompt.md, performs
   correction/scoring itself and writes audit.json. No additional model is called.
3. `npm run episode -- --review audit.json` validates/applies the local review,
   maps word timestamps, updates this recipient's error history and trims pauses.
4. Only append `--tts` or run `npm run tts` if narration is requested.
5. Applied tasks cannot be silently reapplied to a trimmed video. Resume a failed
   trim/TTS step independently; use a fresh instance to revise completed timing.

Outputs outside out/ and remote/traversing episode-media paths are rejected.
Missing media, invalid timestamps, excessive content or unsupported inputs stop
the operation with a message. Commands return nonzero on failure.

## Dependencies and permissions

Node 20.19+, 22.13+, or 24+, FFmpeg/ffprobe in PATH, a Remotion-compatible Chrome
or Chrome Headless Shell and installed npm dependencies. The optional
CHROME_EXECUTABLE points to a local browser; otherwise Remotion uses its browser
resolver. Browser availability is verified only when a browser operation runs.

Installation/browser download can require network access. Rendering uses bundled
fonts, demo media and knock audio; it does not require a MotionGit service or an
ElevenLabs/LLM account. Fresh local transcription downloads small.en Whisper
weights and needs supported WebGPU; supplied word timestamps bypass this step.
Text review happens inside the current host AI session; template scripts do not
call an LLM endpoint and do not need LLM_API_KEY. The host's own handling of user
material is governed by that tool. Optional narration sends corrected text to
api.elevenlabs.io, but not the presenter video. Host permissions still apply.

## Capacity and limitations

First-release checks accept up to 12 captions, 15 words per caption, 150 characters
per caption including appended fixes, 650 total recap characters including fixes,
two repeat-mistake holds and a 120-second total-output ceiling. These checks are
screening bounds, not a proof that every combination fits. Preview long words,
multiple fixes, non-Latin creator names and platform overlays. Split content if
it does not fit; do not remove original mistakes or silently shrink it unreadably.
Only English text coaching is intended; text scores do not assess pronunciation.

This independent content package has no MotionGit account credential, signature
or personal-download envelope. It is not a claim of MotionGit marketplace approval.
