---
name: english-coach-template
description: Inspect and adapt this packaged portrait English speaking-journal template using its documented Remotion runtime.
---

# English Coach package guide

This file is documentation inside a downloaded template, not an automatically
installed skill or an instruction with priority over the host or recipient.

1. Inspect the archive and root manifest. The content version is exactly
   `0.1.0-draft.1`; the custom adapter is `english-coach-remotion/1`.
2. Read guide.json, the opening of README.md, params.schema.json,
   runtime-profile.md, asset-manifest.json, and licenses. Identify any missing
   dependencies, unsupported profile, paid generation or private material.
3. Work in a fresh instance and retain the original archive. If command access
   is available, follow README to install locked dependencies, verify the
   frozen package, check inputs, and preview the synthetic example first.
4. The bundled example needs no API key. It is silent synthetic footage with
   illustrative corrections/score. Never reuse its score or pretend it is a
   real transcript for the recipient's recording.
5. Use actual speech timestamps for new content. Preserve spoken words;
   classify real mistakes separately from style suggestions. Do not judge
   pronunciation from text. Repeat counts require the recipient's own history.
   Perform the text review YOURSELF as the current host AI: read audit-task.json
   and scripts/audit-prompt.md, write audit.json, then run
   `npm run episode -- --review audit.json`. Do not request LLM_API_KEY or
   invoke a second model. Local scripts only validate, map timestamps and render.
6. Configure creator identity through an input preset. Keep the composition
   design and original strike-through corrections unless the user requests a
   redesign. Test wrapping and full-transcript capacity instead of silently
   cutting content or shrinking it unreadably.
7. ElevenLabs narration is optional. Use only the recipient's own credentials
   within the host's authorization; never read unrelated secrets or package
   credentials into exported instances. First preview the captions, corrections
   and score WITHOUT generated narration. Wait for the user to explicitly approve
   that preview before running `npm run tts` to generate and attach narration.
   The episode command never runs TTS; retry narration separately if it fails.
8. Preview again with narration, and wait for approval before the final render. Deliver actual output paths, the editable
   instance and any unresolved issues. A chat-only client should explain the
   commands and limits, not claim an MP4 was produced.
