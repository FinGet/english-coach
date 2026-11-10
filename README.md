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

### 本地降噪

每期默认使用 DeepFilterNet 做保守降噪（6 dB 衰减上限），户外杂音较大时可选 12 dB。全程本地运行，无需账号或 API Key。需要安装 [DeepFilterNet 的 deep-filter 可执行文件](https://github.com/Rikorose/DeepFilterNet/releases/tag/v0.5.6) 并加入 PATH，或在本地 `.env` 设置 `DEEP_FILTER_BIN`；Apple Silicon 本机会优先复用 `.cache/asr-tools/` 中已有的 v0.5.6。工具不可用或处理失败时停止，不会把原声当作降噪成功继续。

```sh
# 为已有一期生成独立降噪试听副本，默认不覆盖工作视频
npm run denoise -- --episode 4
npm run denoise -- --episode 3 --db 12

# 完成原声剪静音后，将降噪应用到工作视频，供预览和后续导出使用
npm run denoise -- --episode 4 --apply

# 可选的完整 API 制作流程默认降噪；户外录音可在开始时选择 12 dB
npm run episode -- recording.mp4 5 --denoise-db 12
```

独立副本与处理记录放 `output/_work/epXX/denoise/`，相同输入、档位和工具版本复用有效结果。应用时保留 `public/epXX/video.before-denoise.mp4` 和 `video.mp4.denoise.json`；重复执行不会叠加降噪，原声备份、当前视频或记录不匹配时停止。输出直接复用视频画面，检查时长，并补回模型延迟补偿丢掉的短尾音，保持字幕时间轴。6/12 dB 是处理上限，不是实际信噪比改善的评分。

转写使用未剪辑的降噪副本；长静音始终依据原声判断，剪好并同步字幕后才将降噪应用到工作视频。没有发生裁剪时，直接复用转写前的降噪结果；发生裁剪时，从剪好的原声生成新结果。不要先应用降噪再检测静音，避免把模型压低的声音当作可删除片段。已有用户校正字幕只做降噪，无需重新转写。Azure 发音测评会校验并选用同时间轴的降噪前原声备份，备份失配时停止；其他发音试测也应使用原声，不能把降噪后的音素变化直接当作发音错误。

每期主要生成或更新这些本地内容，无需重复改动页面代码：

| 文件 | 用途 |
| --- | --- |
| `public/epXX/video.mp4` | 当前口播视频的工作副本；原片另存为同目录的 `source.<扩展名>` |
| `public/epXX/captions.json` | 真实词级字幕和毫秒时间戳 |
| `public/epXX/motion.json` | 期数、视频路径、字幕、纠错、评分和复习时间轴 |
| `public/_cache/tts/*.mp3`、`*.json` | 按实际朗读片段缓存的复习音频和真实字符时间戳 |
| `error_history.json` | 当前作者的历史错误记录 |
| `creator.config.json` | 作者名字、简介与装饰 slogan |

数据结构见 `src/types.ts`，匿名内容示例见 `examples/motion.json`。评分只评转写原文的语法（40）、用词（30）和自然度（30），不评发音或流利度。

### 口播响度标准（每期执行）

本系列统一采用以下制作目标，适用于手机录制的原声口播。手机系统音量 50% 只作为回听条件，不是音频文件的响度标准；不同设备和环境仍需实际回听。

| 项目 | 固定要求 |
| --- | --- |
| 整段综合响度 | 目标 **−18 LUFS**，通常接受 **−19～−17 LUFS**；按完整口播测量，不逐秒追到同一响度 |
| 真峰值 | 最终编码文件 **≤ −1 dBTP**；AAC 编码前宜留到约 **−2 dBTP**，编码后复测 |
| 语气与动态 | 保留轻声、重音、自然停顿和强弱变化；优先整段使用固定增益，不按字句自动拉平 |
| 峰值保护 | 仅在需要时轻处理短暂尖峰；不以持续压缩、明显削弱重音来强行达标。动态保真和避免失真优先，必要时允许整段低于目标并记录原因 |
| 处理范围 | 只调原声口播；纠错朗读单独保持已有设置，发音测评继续使用同时间轴的未处理原声 |

每期在降噪与原声剪静音完成后，先测整段综合响度、真峰值和响度范围，再确定增益；需要峰值保护时应轻处理并回听重音，处理完成及最终编码后均复测。禁止只看波形或峰值就宣布整体响度达标，也不要把某期的放大倍数机械套到其他期。上述 −18 LUFS 是本系列选定的制作目标，可参考 [EBU 流媒体响度建议](https://tech.ebu.ch/docs/r/r128s2.pdf)，不代表所有平台统一要求此值。

`motion.json` 的 `video.volume` 可单独设置整段口播的固定增益，默认 `1`，同时用于预览和导出；例如 `1.6` 约提高 4 dB。必须根据本期实测响度和峰值决定数值，单纯设置倍数不等于已完成响度标准化。音频文件已做增益处理时，恢复为 `1`，避免重复放大；原始媒体及备份始终保留。

发音反馈单独写入 `motion.json` 的可选 `pronunciationNotes`，不改字幕拼写，不计入文本分数或老毛病次数。口播中在对应词说完后标记问题词，片尾单列音标和练习提示；审核后生成朗读时，只加入这些词所在的必要分句，音标与练习提示不参与朗读。

```json
{
  "pronunciationNotes": [
    {
      "word": "hello",
      "ipa": "/həˈloʊ/",
      "tip": "Practice the second syllable.",
      "startMs": 800,
      "endMs": 1300,
      "source": "self-report"
    }
  ]
}
```

`word` 必须匹配该时间段字幕中的完整单词，时间戳相对当前原声视频。`source: "self-report"` 表示待确认的自查项，画面标为 `SELF-CHECK`；`"user-confirmed"` 表示用户已确认的发音问题，标为 `USER CONFIRMED`；`"assessment"` 仅用于已有真实音频测评依据的条目。不能凭转写错误生成发音诊断或分数。重新审稿会保留有效条目，失配时停止；剪静音会同时保护并同步这些时间段。

正片中，问题词读完后出现蓝色文字、浅蓝底色和实线下划线，同句多个问题词各自保留标记，不展开说明卡。全文纠错复盘沿用这些标记，并在标准跟读的当前句中加深问题词底色。全文结束后单独展示发音练习：按实际字体及换行后的卡片高度比较单列、双列布局，优先减少分页，页数相同时优先较宽的单列；不限制每页词数，不固定卡片高度。单条说明超过整屏时随时间滚动展示。后续新期数的练习页为每个标注词播放一次标准美音，同时高亮当前词并提示 LISTEN，播放后提示 YOUR TURN，留至少 2 秒跟读。每词至少 4 秒，音频较长时自动延长，全段最少 8 秒；分页、视频总时长和配音使用同一时序。没有发音标注的期数没有这一段；旧期数没有单词音频时保持原有静音展示，不自动回改。

### Wav2Vec2 发音检测（后续每期默认执行）

审核原话、依据原声剪静音并同步时间轴后，在预览前运行本地检测：

```sh
npm run pronunciation:check -- --episode 7  # 只读检查环境与分段
npm run pronunciation -- --episode 7        # 分析原声并自动写入蓝色发音标注
# 仅生成报告，不改标注：
node scripts/assess-local-pronunciation.mjs --episode 7 --assess
```

`npm run episode` 已自动包含检测；由当前 AI 手工制作时也必须执行。复用本机 `.cache/asr-venv/bin/python` 和 `.cache/local-pronunciation/` 中已安装的 Wav2Vec2 模型与 OpenPronounce 依赖，不下载模型、不上传音频、不调用 Azure。缺少环境或模型推理失败时停止，不得跳过检测继续制作。

模型为 `facebook/wav2vec2-lv-60-espeak-cv-ft`，先独立解码音素，再与审核后的原话比较；使用上游默认阈值（加权音素差异达到词长的 40% 或 2 个），不额外凭 AI 主观筛选单词、不要求逐词人工确认后才标记。结果自动写入 `source: "assessment"`、带 `model` 来源的 `pronunciationNotes`；已有用户确认、自查或其他来源的条目保留。字幕、文本评分、错误历史均不改变。数字读法存在歧义的项留在报告中；无法可靠定位词时间的项在对应分句结束标记。连字符词合并为原文中的完整单词。

报告和按原声哈希、原话、时间轴及模型/脚本版本缓存的分段保存在 `output/_work/epXX/local-pronunciation/`。目标 IPA 使用美音 G2P（含重音），模型结论仍可能误报、漏报，不等于人工确诊。检测读取经过哈希校验的降噪前原声；有现成成片时拒绝自动覆盖标注，已有复习配音且标注发生变化时要求先保留旧版并恢复无配音预览。已发布期数不回改。

文本预览审核通过后，照常先运行 `tts:check` 再运行 `tts`，同时为问题分句和片尾单词准备朗读。问题分句沿用 ElevenLabs 配音；片尾单词改用 Merriam-Webster 的词典美音录音，不再单独调用 TTS。配置本地 `.env` 的 `MERRIAM_WEBSTER_DICTIONARY_KEY` 与 `MERRIAM_WEBSTER_LEARNERS_KEY`；只配置一个也可使用，两个均配置时以 Collegiate 录音为主、Learners IPA 辅助匹配。词典查词缓存位于 `.cache/merriam-webster/`，录音及来源元数据位于 `public/_cache/dictionary/`，同词同读法跨期复用。密钥不写入缓存、报告或日志。

`public/_cache/dictionary/library.json` 是按单词整理的本地发音库总索引，记录各读音的音标（如有）、录音 ID、词典来源、音频路径和时长；新录音下载后自动更新。同一拼写的不同读音分别保存，例如 `read` 的 /riːd/ 和 /red/。复习配音先查本地有效录音，命中时无需 Key、不调用词典接口；文件缺失或哈希校验失败时才重新获取。保留整个 `public/_cache/dictionary/` 目录即可持续积累，勿随单期制作清空；总索引可从已保存的 MP3 和逐条 JSON 重建。

只使用准确匹配该词形的录音，不将 `scrolled` 换成 `scroll`。多个读音优先匹配原有目标 IPA；无法匹配时停止并列出可选录音 ID，由审核者在对应标注的 `dictionaryAudioId` 中选择。缺词、缺录音或下载失败时不静默换成原形或合成音；词典步骤先完成，再请求付费句子配音，失败保留已成功缓存且不覆盖本期配置。`tts:check` 完全离线，只显示缓存和待查词数；`charactersToGenerate` 仅统计 ElevenLabs 句子。生成的单词录音记录在对应标注的 `audio` 中（含来源、录音 ID 和可用的 Learners IPA），片尾显示词典来源，并自动安排播放、跟读空档和高亮。

### Azure 自动发音评估（可选）

需要自己的 Azure Speech 资源。在项目根目录的本地 `.env` 中填写 `AZURE_SPEECH_KEY` 和 `AZURE_SPEECH_REGION`（如资源实际所在的 `southeastasia`），也可用 `AZURE_SPEECH_ENDPOINT` 替代区域，格式见 `.env.example`。Key 只在本地保存，不写入报告、代码或对话。资源创建与凭据位置见 [Microsoft 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-speech-to-text)。

```sh
# 只读检查：显示配置状态、分段与请求数量，不上传音频
npm run pronunciation:azure:check -- --episode 4

# 上传本期原声音频，调用 Azure 并生成独立测评报告
npm run pronunciation:azure -- --episode 4
```

使用审核后的**原话**作为参考文本，不套用语法纠正。脚本将当前视频转成 16kHz、单声道 PCM WAV，按句或字幕边界拆为不超过 28 秒的片段，采用 `en-US` 单词及 IPA 音素测评，关闭额外的韵律评估。语法问题、漏词与发音问题分开记录；普通转写成功但缺少发音或音素分数时会报错，不生成假评分。

结果保存在 `output/_work/epXX/pronunciation/report.json` 和 `report.txt`，包含逐词/音素分数、低分候选项，以及与用户确认问题的对照。服务标为 `Mispronunciation` 或单词准确度低于 60 的条目进入待复核列表。`candidateNote` 只在单词和时间段均匹配原文字幕时提供；音素候选是模型估计，须结合回听判断。报告不会覆盖 `motion.json`、用户确认的标注或原文文本评分，复核后再选取条目加入 `pronunciationNotes`。

已成功的分段按原视频哈希、原话、时间段和请求设置缓存。重跑会复用有效缓存；中途失败保留已完成项。首次运行会上传音频，是否扣费取决于 Azure 资源档位和可用额度；脚本不创建云资源或改变计费档位。

片尾始终保留一份带划线纠错的全文，默认 44 字号。正文超出卡片时自动滚动，不再通过缩小字号挤进一页；短文能放下时保持静止。顶部标题与底部分数固定。有配音时根据真实句级时间戳跟随朗读滚动并高亮，单句过长也会在朗读期间逐步移动；结束前滚至全文底部。无配音时按 `summary.durationMs` 从头滚到尾，并在首尾停留，长篇静音复习可增大该时长。`summary.fontSize` 仅用于主动调整字号，不做自动缩小。

原始视频、字幕、纠错结果、朗读、个人配置、错误历史和导出文件均不会提交到 Git。不要把 API Key 写进 JSON、代码或对话。

## 每期制作顺序（AI 工具也须遵循）

固定顺序：保留原片 → 生成未剪辑的降噪识别副本 → 对降噪副本转写 → 核对原话并生成句级字幕/纠错 → 依据原声检测并剪除长静音 → 同步逐词及句级时间轴 → Wav2Vec2 分析原声并自动加入发音标注 → 将降噪应用到剪好的工作视频 → 按上述口播响度标准测量、调整并复测 → 预览回听。不能先根据字幕空档裁剪，再把剪辑后的音频与剪辑前的字幕混用。现有 `episode` 脚本自动执行到降噪；响度标准由制作时的 AI 工具继续测量与处理，不应误报为脚本已自动完成。

`trim-pauses.mjs` 只剪 FFmpeg 在实际音频中检测到的长静音（保守阈值 -60 dB），两端至少各保留 500ms，并避开所有已识别词的时间范围，包括超长词。ASR 漏词或没识别出整句，不能成为删除声音的依据；没有可确认的静音就不剪。剪辑前自动保存 `video.before-trim.mp4`、`captions.before-trim.json` 和 `motion.before-trim.json`，再同步更新当前 `captions.json`、`motion.json` 中的时间戳，不删除或改写字幕文字。旧时间戳超出视频时长、已剪辑、已有备份或已添加复习配音时会停止，避免重复剪辑或混用时间轴。要重新处理，请从同一组剪辑前备份恢复三个文件，在独立工作目录中重新运行，保留备份；不要只恢复其中一个文件。

1. **先做无复习配音的预览。** 按上述顺序准备降噪视频和字幕，生成纠错与评分，更新 `public/epXX/motion.json`，并在 `episode.config.json` 选择这一期。先不调用 ElevenLabs。口播使用本地降噪的人声，保留原片与降噪前原声备份；新的复习部分不设置 `summary.voice`。用户手工校正的字幕优先，不要再被旧识别结果覆盖。
2. **人工审核。** 运行 `npm run dev`，让用户核对原文、纠错、换行、最终全文与评分。在用户明确确认这版预览之前停止，不生成复习音频，也不导出最终视频。想要最终带配音，不代表已审核当前文本。
3. **审核通过后，再生成并添加音频。** 先运行 `npm run tts:check` 检查问题分句、片尾单词和现有音频，再运行 `npm run tts`。生成成功会自动写入 MP3、`summary.voice`、句级高亮时间戳、各发音标注的 `audio` 及复习时长，无需手动添加音轨。
4. **再次预览，再决定导出。** 检查配音文本、音量、句级高亮和结尾时长；用户确认后才运行导出命令。

修改字幕后，要同时复核 `corrections`：删掉已不匹配原文的纠错，再检查新增问题。配音以**最短必要分句**为单位：只选有文本纠错或发音标注的字幕，紧邻的问题分句可以合并，无关的前后文和中间分句不参与生成。例如只读 `Your GPS never scolds you.`，不带上 `He said ... wrong turn` 或 `and it just says softly ...`。独立片段只调整首字母和末尾标点，不改原字幕。

**分句可以作为短语或从句独立复习，不要求补成完整句子。** 不得为了语法完整、补主句/谓语、叙事连贯或朗读顺畅，加入没有问题的相邻分句。`narrationContext: "previous" | "next" | "both"` 仅在用户明确要求朗读相邻语境时使用，AI 审核不得自行添加；“review 后生成音频”不等于要求扩读。语境越界或标注失配会在请求前停止。

EP05 反例：`when we complete with AI, / we should lean more into our unique experience.` 只有 `complete → compete` 需要纠正，默认只读问题所在分句，不加入后面的 `we should lean ...`。即使 `when ...` 是从句，也不能据此扩读。

免费额度与付费额度都按同一节省规则处理。生成前核对 `tts:check` 的每段文本、待生成字符数和缓存：无纠错、无发音标注且非用户明确要求的内容必须排除。新规则只约束后续制作，不为布局调整或规则更新重生成、裁剪或修改已完成的 EP04、EP05 等期数的配音和时间轴。

每段按实际朗读文本、音色、模型和语音设置独立缓存，不依赖期数或字幕序号。下次只请求新增或改动的片段，删除、排序或字幕序号变化不影响已有缓存；改回之前生成过的文本也能复用。同一任务中的相同文本也只请求一次。只有改音色或语音设置时才会生成另一组音频。中途失败会保留已成功的片段，重跑只补缺失的片段。

`npm run tts:check` 会列出本次复用/生成的句数和待生成字符数。成功后，脚本将独立音频排入 `summary.voice.clips`，同时重算字幕高亮与复习时长；页面直接按顺序播放这些音频。保留 `public/_cache/tts/`，不要在每期结束后清空；文件和私人内容一样已被 Git 忽略。旧的单文件 `summary.voice.src` 仍能播放。

若现有配音已经过期，先在本地备份当前 JSON，再移除 `summary.voice` 做预览；保留旧 MP3，不要在等待审核时重生成。`tts:check` 仅检查，不修改文件、不请求外部服务；直接运行 `node scripts/tts.mjs` 也是只读检查。`npm run tts` 包含 `--approved`，只应在人工确认预览后运行。

## 辅助脚本

```sh
# 先生成独立降噪副本，再将打印的 MP4 路径传给转写脚本；输出仍写回本期
npm run denoise -- --episode 2
node scripts/transcribe.mjs <打印的降噪视频路径> public/ep02/captions.json

# 验证截图自动放 output/_work/ep02/previews/，不混入成品
npm run still -- --episode 2 --frame 180

# 临时查看其他期数，不更改当前设置
npm run dev -- --episode 1

# 只检查待朗读内容和音频状态，无 API 调用
npm run tts:check

# 可选：人工审核预览通过后，生成并自动添加纠正后的复习朗读
npm run tts
```

ElevenLabs 读取环境变量中的 `ELEVENLABS_API_KEY`，可用 `ELEVENLABS_VOICE_ID` 指定账号可访问的音色。也可参考 `.env.example` 创建本地 `.env`，该文件已被忽略。若桌面工具未继承密钥，`tts` 与 `tts:check` 会从登录交互式 shell（如 `.zshrc`）补读这两个变量，保留已有配置，不打印密钥，也不要求重复写入本地文件。

`scripts/audit-prompt.md` 提供文本审核规则。`scripts/audit.mjs` 和旧的 `npm run episode` 是可选的独立 API 自动化流程，会使用 `LLM_API_KEY`；使用当前 AI 工具直接审核时，不必运行这个旧流程。`episode` 现在只准备字幕预览，不会自动生成复习配音。不要把转写错误当作口语错误。

## 固定封面规范

封面沿用第一期母版 `output/ep01/cover.png`，比例固定 **3:4**（当前 1086×1448）。每期更新 **期数、中文主题、当期口播人物、一处纠错示例**；第一期母版没有主题，后续制作必须补上。

- 顶部固定 `ENGLISH, IN PROGRESS.`。
- 两行主标题固定 `I SPEAK.` / `AI CORRECTS.`，保留第二行的荧光绿标记。
- 副标题固定 `No script. Real mistakes.`，底部固定 `Practice makes progress.`。
- 每期必须增加一句简短中文主题，依据已审核口播的整期主线概括，不用单个讨论点代替主题，不夸大观点；用户提供主题时优先采用。用一至三行醒目大字放在英文副标题下方、人物左侧的留白中，缩略图也要能辨认，不遮挡人物、纠错卡片或底部文案。例如 EP06：`AI 在我工作中经历的三个阶段`。
- 保持米白网格、深绿字、字体层级、撕纸卡片、人物位置与整体排版一致。
- 人物取自当期视频：双眼睁开、看向镜头，保留真实外貌、服装和自然表情；裁成右下角带浅色纸边的半身像。
- 纠错卡片仅展示当期已审核的一处：原文红线划掉，正确表达用荧光绿突出；卡片内不新增其他文案。

生成时使用[固定提示词](scripts/cover-prompt.md)，替换期数、中文主题、人物参考图与纠错内容。成品保存为 `output/epXX/cover.png`，参考帧、提示词和历史封面放 `output/_work/epXX/covers/`；更新前保留旧版。

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
