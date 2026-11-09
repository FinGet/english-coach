# 英语口播制作规则

每期制作先读 `README.md` 和 `scripts/audit-prompt.md`，以用户校准的字幕为准。

## 纠错配音范围

- 默认只朗读有纠错或发音标注的最短必要分句。分句可以作为短语或从句独立复习，不要求补成完整句子。
- 不得为了语法完整、补主句/谓语、叙事连贯或朗读顺畅，加入没有问题的相邻分句。
- `narrationContext` 仅在用户明确要求朗读相邻语境时使用；AI 不得自行添加。用户说“review 后生成音频”不等于要求扩读。
- 反例：`when we complete with AI, / we should lean more into our unique experience.` 只纠正 `complete → compete`，默认只读问题所在分句，不加入后面的 `we should lean ...`。
- 生成前核对 `tts:check` 的每段文本、字符数和缓存；无问题的内容必须排除，除非用户明确要求包含。
- 规则只约束后续制作。不要为落实新规则重生成、裁剪或修改已完成期数的配音和时间轴，除非用户要求。
