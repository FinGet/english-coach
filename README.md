# English Coach

用 Remotion 制作英语口播练习视频：两句字幕滚动、保留原文的划线纠错、原文评分，以及可选的 ElevenLabs 复习朗读。

画面为 9:16 竖屏，基础尺寸 1080×1920，30fps。日常制作直接使用本项目；`motion-template/` 仅用于对外分发模板。

## 文件放在哪里

```text
episode.config.json           # 当前期数，例如 { "episode": 2 }
public/
  ep01/                       # 每期素材与可编辑配置
    video.mp4
    captions.json
    motion.json
    voice.mp3                 # 旧版整段朗读（如有）
  ep02/
    video.mp4
    captions.json
    motion.json
  _cache/tts/                 # 跨期复用的逐句音频与时间戳，不要清空
output/
  ep01/                       # 可直接发布的成片和 3:4 封面
    video.mp4
    cover.png
  ep02/
    video.mp4
    cover.png
  _work/
    ep01/                     # 验证截图、参考帧、备份和旧版封面
    ep02/
    legacy/                   # 无法准确归属期数的旧测试产物
    templates/                # 模板打包工作目录
  templates/                  # 对外发布的 .motion / .zip 包
```

**成品只放 `output/epXX/`。** AI 生成的验证截图放 `output/_work/epXX/previews/`，封面参考帧、提示词和旧版放 `output/_work/epXX/covers/`，数据备份放 `output/_work/epXX/backups/`。不要再创建 `out/` 或把封面、测试截图散放进 `public/`。

修改本地 `episode.config.json` 即可切换当前期数，预览、配音与导出使用同一期数据；也可用 `--episode 1` 临时指定，不修改当前设置。`public/` 只供 Remotion 读取素材，里面的媒体路径相对该目录，例如 `motion.json` 中的视频路径为 `ep02/video.mp4`，配音路径为 `_cache/tts/<hash>.mp3`。

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
| `public/epXX/video.mp4` | 当前口播视频的工作副本；原片另存为同目录的 `source.<扩展名>` |
| `public/epXX/captions.json` | 真实词级字幕和毫秒时间戳 |
| `public/epXX/motion.json` | 期数、视频路径、字幕、纠错、评分和复习时间轴 |
| `public/_cache/tts/*.mp3`、`*.json` | 按完整句子缓存的复习朗读和真实字符时间戳 |
| `error_history.json` | 当前作者的历史错误记录 |
| `creator.config.json` | 作者名字、简介与装饰 slogan |

数据结构见 `src/types.ts`，匿名内容示例见 `examples/motion.json`。评分只评转写原文的语法（40）、用词（30）和自然度（30），不评发音或流利度。

片尾始终保留一份带划线纠错的全文，默认 44 字号。正文超出卡片时自动滚动，不再通过缩小字号挤进一页；短文能放下时保持静止。顶部标题与底部分数固定。有配音时根据真实句级时间戳跟随朗读滚动并高亮，单句过长也会在朗读期间逐步移动；结束前滚至全文底部。无配音时按 `summary.durationMs` 从头滚到尾，并在首尾停留，长篇静音复习可增大该时长。`summary.fontSize` 仅用于主动调整字号，不做自动缩小。

原始视频、字幕、纠错结果、朗读、个人配置、错误历史和导出文件均不会提交到 Git。不要把 API Key 写进 JSON、代码或对话。

## 每期制作顺序（AI 工具也须遵循）

1. **先做无复习配音的预览。** 在 `public/epXX/` 准备视频和字幕，生成纠错与评分，更新同目录的 `motion.json`，并在 `episode.config.json` 选择这一期。先不调用 ElevenLabs。保留原视频声音；新的复习部分不设置 `summary.voice`。用户手工校正的字幕优先，不要再被旧识别结果覆盖。
2. **人工审核。** 运行 `npm run dev`，让用户核对原文、纠错、换行、最终全文与评分。在用户明确确认这版预览之前停止，不生成复习音频，也不导出最终视频。想要最终带配音，不代表已审核当前文本。
3. **审核通过后，再生成并添加音频。** 先运行 `npm run tts:check` 检查待朗读文本和现有音频，再运行 `npm run tts`。生成成功会自动写入 MP3、`summary.voice`、句级高亮时间戳和复习时长，无需手动添加音轨。
4. **再次预览，再决定导出。** 检查配音文本、音量、句级高亮和结尾时长；用户确认后才运行导出命令。

修改字幕后，要同时复核 `corrections`：删掉已不匹配原文的纠错，再检查新增问题。配音以**完整句子**为单位：字幕若按逗号拆成意群，会合并到句末；同一句有多个错误也只生成一段，保留整句上下文。

每句按纠正后的完整文本、音色、模型和语音设置独立缓存，不依赖期数或字幕序号。下次只请求新增或改动的句子，删除、排序或字幕序号变化不影响已有缓存；改回之前生成过的文本也能复用。只有改音色或语音设置时才会生成另一组音频。中途失败会保留已成功的句子，重跑只补缺失的句子。

`npm run tts:check` 会列出本次复用/生成的句数和待生成字符数。成功后，脚本将独立音频排入 `summary.voice.clips`，同时重算字幕高亮与复习时长；页面直接按顺序播放这些音频。保留 `public/_cache/tts/`，不要在每期结束后清空；文件和私人内容一样已被 Git 忽略。旧的单文件 `summary.voice.src` 仍能播放。

若现有配音已经过期，先在本地备份当前 JSON，再移除 `summary.voice` 做预览；保留旧 MP3，不要在等待审核时重生成。`tts:check` 仅检查，不修改文件、不请求外部服务；直接运行 `node scripts/tts.mjs` 也是只读检查。`npm run tts` 包含 `--approved`，只应在人工确认预览后运行。

## 辅助脚本

```sh
# 本地 Whisper / WebGPU 转写；首次使用会下载语音模型
node scripts/transcribe.mjs public/ep02/video.mp4

# 验证截图自动放 output/_work/ep02/previews/，不混入成品
npm run still -- --episode 2 --frame 180

# 临时查看其他期数，不更改当前设置
npm run dev -- --episode 1

# 只检查待朗读内容和音频状态，无 API 调用
npm run tts:check

# 可选：人工审核预览通过后，生成并自动添加纠正后的复习朗读
npm run tts
```

ElevenLabs 读取环境变量中的 `ELEVENLABS_API_KEY`，可用 `ELEVENLABS_VOICE_ID` 指定账号可访问的音色。也可参考 `.env.example` 创建本地 `.env`，该文件已被忽略。

`scripts/audit-prompt.md` 提供文本审核规则。`scripts/audit.mjs` 和旧的 `npm run episode` 是可选的独立 API 自动化流程，会使用 `LLM_API_KEY`；使用当前 AI 工具直接审核时，不必运行这个旧流程。`episode` 现在只准备字幕预览，不会自动生成复习配音。不要把转写错误当作口语错误。

## 固定封面规范

封面沿用第一期母版 `output/ep01/cover.png`，比例固定 **3:4**（当前 1086×1448）。每期只更新 **期数、当期口播人物、一处纠错示例**。

- 顶部固定 `ENGLISH, IN PROGRESS.`。
- 两行主标题固定 `I SPEAK.` / `AI CORRECTS.`，保留第二行的荧光绿标记。
- 副标题固定 `No script. Real mistakes.`，底部固定 `Practice makes progress.`。
- 保持米白网格、深绿字、字体层级、撕纸卡片、人物位置与整体排版一致。
- 人物取自当期视频：双眼睁开、看向镜头，保留真实外貌、服装和自然表情；裁成右下角带浅色纸边的半身像。
- 纠错卡片仅展示当期已审核的一处：原文红线划掉，正确表达用荧光绿突出；不新增其他文案。

生成时使用[固定提示词](scripts/cover-prompt.md)，仅替换期数、人物参考图与纠错内容。成品保存为 `output/epXX/cover.png`，参考帧、提示词和历史封面放 `output/_work/epXX/covers/`。

## 确认效果后导出

```sh
# 默认 4K：2160×3840
npm run render

# 1080p：1080×1920
npm run render:1080p

# 指定期数；成品自动放 output/ep01/video.mp4
npm run render -- --episode 1
```

默认成品为 `output/epXX/video.mp4`，1080p 版为同目录的 `video-1080p.mp4`。使用 PNG 中间帧、CRF 16；提高分辨率可以改善文字细节，但不会恢复低清原片丢失的细节。先检查长句换行、人物取景、最终全文与评分，再决定导出。

## 检查与模板打包

```sh
npm test
npm run lint
npm run build
```

测试使用匿名示例，不依赖作者的私人素材。

`motion-template/` 和 `scripts/package-motion.mjs` 用于制作对外的 `.motion` 内容包。工作目录在 `output/_work/templates/`，可分发包在 `output/templates/`，不提交 Git；日常制作不需要创建 `instances/`。

项目沿用仓库已有的 [Apache-2.0 许可](LICENSE)。Remotion、字体和其他依赖按各自许可使用；参见 [Remotion 授权说明](https://www.remotion.dev/docs/license/pricing)。
