# Third-party dependencies and resources

- Remotion packages 4.0.539: Remotion License, not relicensed by this template.
  Check https://www.remotion.dev/docs/license/pricing and the license files installed with the dependencies.
- React, TypeScript, AJV, FFmpeg, Whisper model weights, Transformers.js and Mediabunny:
  separate upstream licenses apply. `package-lock.json` identifies JS versions;
  installed dependencies retain their upstream notices. FFmpeg is an external tool,
  not bundled. ASR model weights are downloaded only when local transcription is requested.
- Outfit Latin variable WOFF2: Google Fonts / Outfit project, unmodified;
  https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtq.woff2
  SIL Open Font License 1.1, reproduced in Outfit-OFL.txt.
- JetBrains Mono Latin variable WOFF2: Google Fonts / JetBrains Mono project, unmodified;
  https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbX2o-flEEny0FZhsfKu5WU4xD-CwOnSA.woff2
  SIL Open Font License 1.1, reproduced in JetBrainsMono-OFL.txt.
- The demo MP4 and knock WAV are generated locally from mathematical FFmpeg
  sources by scripts/make-demo.mjs; no original creator portrait, recording,
  synthesized ElevenLabs voice or stock soundtrack is included.
- The upstream JSON Schema is used as an external conformance reference and is
  not redistributed as template code. Its original $id and repository provenance:
  https://github.com/motiontemplates/motion-spec/blob/main/schema/content-0.1.json

Paid generation is optional. Users supply their own credentials privately;
provider terms, supported voices, pricing and commercial rights remain separate.
