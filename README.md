# English Coach

用 Remotion 制作英语口播练习视频：两句字幕滚动、保留原文的划线纠错、原文评分，以及可选的 ElevenLabs 复习朗读。

画面为 9:16 竖屏，基础尺寸 1080×1920，30fps。日常制作直接使用本项目；`motion-template/` 仅用于对外分发模板。

## 本地预览

需要 Node.js 20.19+、22.13+ 或 24+，以及加入 PATH 的 FFmpeg / ffprobe。预览使用 Chrome；首次运行可能需要下载浏览器和字体。

```sh
npm ci
npm run setup
npm run dev
```

`setup` 只创建缺失的本地文件，不覆盖已有个人配置或当前一期的数据。首次运行会从 `examples/motion.json` 创建匿名示例，并用 FFmpeg 生成静音的几何人物占位视频；不会调用付费服务。示例纠错和分数仅用于展示。

## 制作自己的视频

将原片保留在本地，由转写工具生成真实词级时间戳，再让当前使用的 AI 工具审核原文、断句、纠错和评分。AI 工具可以直接完成文本审核，不要求另配大模型 API Key。

每期主要生成或更新这些本地内容，无需重复改动页面代码：

| 文件 | 用途 |
| --- | --- |
| `public/<episode>.mp4` | 当前口播视频的工作副本 |
| `public/captions.json` | 真实词级字幕和毫秒时间戳 |
| `public/motion.json` | 期数、视频路径、字幕、纠错、评分和复习时间轴 |
| `public/<episode>-voice.mp3` | 可选的复习朗读 |
| `error_history.json` | 当前作者的历史错误记录 |
| `creator.config.json` | 作者名字、简介与装饰 slogan |

数据结构见 `src/types.ts`，匿名内容示例见 `examples/motion.json`。评分只评转写原文的语法（40）、用词（30）和自然度（30），不评发音或流利度。`summary.fontSize` 可调整长篇复习正文的字号。

原始视频、字幕、纠错结果、朗读、个人配置、错误历史和导出文件均不会提交到 Git。不要把 API Key 写进 JSON、代码或对话。

## 辅助脚本

```sh
# 本地 Whisper / WebGPU 转写；首次使用会下载语音模型
node scripts/transcribe.mjs public/recording.mp4 public/captions.json

# 可选：生成纠正后的复习朗读
node scripts/tts.mjs
```

ElevenLabs 读取环境变量中的 `ELEVENLABS_API_KEY`，可用 `ELEVENLABS_VOICE_ID` 指定账号可访问的音色。也可参考 `.env.example` 创建本地 `.env`，该文件已被忽略。

`scripts/audit-prompt.md` 提供文本审核规则。`scripts/audit.mjs` 和旧的 `npm run episode` 是可选的独立 API 自动化流程，会使用 `LLM_API_KEY`，并在后续步骤调用 TTS；使用当前 AI 工具直接审核时，不必运行这个旧流程。请先审阅生成数据再预览，不要把转写错误当作口语错误。

## 确认效果后导出

```sh
# 默认 4K：2160×3840
npm run render -- out/episode.mp4

# 1080p：1080×1920
npm run render:1080p -- out/episode-1080p.mp4
```

使用 PNG 中间帧、CRF 16；提高分辨率可以改善文字细节，但不会恢复低清原片丢失的细节。先检查长句换行、人物取景、最终全文与评分，再决定导出。

## 检查与模板打包

```sh
npm test
npm run lint
npm run build
```

测试使用匿名示例，不依赖作者的私人素材。

`motion-template/` 和 `scripts/package-motion.mjs` 用于制作对外的 `.motion` 内容包。打包工作目录和产物均在 `output/`，不提交 Git；日常制作不需要创建 `instances/`。

项目沿用仓库已有的 [Apache-2.0 许可](LICENSE)。Remotion、字体和其他依赖按各自许可使用；参见 [Remotion 授权说明](https://www.remotion.dev/docs/license/pricing)。
