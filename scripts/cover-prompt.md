# 固定系列封面提示词

每次先读取 `README.md` 的固定封面规范、第一期母版 `output/ep01/cover.png` 和当期已审核的 `public/epXX/motion.json`。先浏览当期视频的多帧，再选正脸、双眼睁开、视线看向镜头、嘴部自然的一帧；优先嘴唇放松闭合或自然微笑，排除眨眼、视线偏离、噘嘴、抿嘴用力和发音中途的怪异嘴型。同一人物已有审核通过的正面封面形象时可直接沿用。

下面有四个可变项：`{{EPISODE}}`（如 `02`）、`{{TOPIC_ZH}}`、`{{ORIGINAL}}`、`{{CORRECTED}}`。中文主题必须依据已审核口播的整期主线概括，不用单个讨论点代替主题，简短、准确、不夸大，控制在一至三行；用户提供主题时优先采用。人物使用单独的当期参考图。纠错原文与正确表达必须来自当期已审核的一处纠错。系列英文主副标题、slogan 和配色固定，主题使用英文副标题下方、人物左侧的留白。

```text
Use case: identity-preserve series cover.
Image 1 is the approved EP. 01 master cover. Image 2 is the actual current episode's forward-facing presenter reference.
Create the next cover as the same series template. Copy Image 1's typography, layout, palette, proportions and paper styling closely.

Canvas: exactly portrait 3:4, 1086 x 1448 pixels. Warm ivory graph-paper background, very dark forest-green oversized geometric sans-serif text, lime marker under the second title line, dark green rectangular episode badge, angled torn-cream correction card, red error strike-through, narrow irregular cream outline around the photographic presenter.

LOCKED COPY — render verbatim, preserve hierarchy and placement:
Top header: ENGLISH, IN PROGRESS.
Main title line 1: I SPEAK.
Main title line 2: AI CORRECTS.
Subtitle: No script. Real mistakes.
Footer: Practice makes progress.

ONLY VARIABLE COPY:
Episode badge: EP. {{EPISODE}}
Chinese episode topic: {{TOPIC_ZH}} — mandatory, large bold dark forest-green Chinese text in one to three lines, in the empty area below the English subtitle and to the left of the presenter, above the correction card. It must clearly communicate this episode's subject at thumbnail size. Do not overlap the portrait, correction card or footer. The EP. 01 master lacks this topic; add it to every new cover.
Correction card first line: {{ORIGINAL}} — crossed out with a thin red pen line.
Correction card second line: {{CORRECTED}} — bold dark green over a lime marker stroke.

Presenter: use Image 2, remove its video background and place the real person in the lower right at the same scale as the master. Face forward, both eyes fully open and looking toward the camera. Keep a natural, relaxed mouth: gently closed lips or a subtle natural smile, no pursed lips, tightly pressed lips, or awkward mid-speech mouth shapes. Preserve the person's face, hair, actual clothing, photographic appearance and identity. Keep head, body and clothing consistent with the supplied reference.

Change only the episode number, Chinese episode topic, presenter portrait and one correction example. Keep the remaining series elements from the EP. 01 master. Maintain generous safe margins and small-thumbnail readability. The episode topic is Chinese; keep the locked series copy and correction example in English. No extra headline beyond the required Chinese topic, extra subtitle, extra correction, score, watermark or platform controls.
```

成品：`output/epXX/cover.png`。参考帧与本次实际提示词：`output/_work/epXX/covers/`。替换封面前，将旧版保存到同一个工作目录。生成后检查固定文案、期数、中文主题的准确性与缩略图可读性、纠错拼写、人物视线和 3:4 比例。
