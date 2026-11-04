# 固定系列封面提示词

每次先读取 `README.md` 的固定封面规范、第一期母版 `output/ep01/cover.png` 和当期已审核的 `public/epXX/motion.json`。从当期视频提取双眼睁开、正视镜头的一帧；同一人物已有审核通过的正面封面形象时可直接沿用。

下面只有三个可变项：`{{EPISODE}}`（如 `02`）、`{{ORIGINAL}}`、`{{CORRECTED}}`。人物使用单独的当期参考图。纠错原文与正确表达必须来自当期已审核的一处纠错。主副标题、slogan、配色和布局均固定。

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
Correction card first line: {{ORIGINAL}} — crossed out with a thin red pen line.
Correction card second line: {{CORRECTED}} — bold dark green over a lime marker stroke.

Presenter: use Image 2, remove its video background and place the real person in the lower right at the same scale as the master. Both eyes open and looking forward toward the camera; natural expression. Preserve the person's face, hair, actual clothing, photographic appearance and identity. Keep head, body and clothing consistent with the supplied reference.

Change only the episode number, presenter portrait and one correction example. Keep every other element from the EP. 01 master. Maintain generous safe margins and small-thumbnail readability. All text English. No additional topic headline, subtitle, extra correction, score, Chinese text, watermark or platform controls.
```

成品：`output/epXX/cover.png`。参考帧与本次实际提示词：`output/_work/epXX/covers/`。替换封面前，将旧版保存到同一个工作目录。生成后检查固定文案、期数、纠错拼写、人物视线和 3:4 比例。
