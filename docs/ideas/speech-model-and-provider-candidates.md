# 语音模型与 Provider API 候选备忘

状态：想法记录，尚未纳入正式实施计划。

记录日期：2026-08-08。

外部来源最近核对日期：2026-08-08。平台模型、接口、区域、价格和许可可能变化，开始执行时必须重新核对官方文档。

## 目标与价值

集中记录 VoxWeaver 后续可能需要寻找和评估的 TTS、ASR、VAD、说话人分离、声纹验证和说话人识别候选，避免进入实施阶段后重新从零检索。

本备忘用于：

- 保存开放权重模型、云平台 API 和专业语音服务的官方入口；
- 区分本地可部署模型与平台托管 API；
- 提前记录许可、音色授权、数据上传、区域和能力契约等筛选条件；
- 为后续样章基准、Provider adapter 选型和依赖规格技术决策提供候选池；
- 避免把匿名说话人标签误当成真实角色身份。

记录候选不代表确认采用，也不改变当前 API-only 模型能力边界。

## 所处流程步骤

该备忘位于模型能力正式选型之前：

```text
确认实际业务场景和合法样章
→ 刷新候选模型与平台官方资料
→ 核对许可、区域、数据策略和音色授权
→ 探测 API 契约与账号可用性
→ 使用同一批样章执行质量、延迟和成本基准
→ 用户确认首批 Provider
→ 必要时补充直接依赖规格中的技术决策、能力契约和 Schema
→ 实现并验证 Provider adapter
```

开放权重模型如需使用，应由用户独立部署成 loopback/LAN HTTP Provider。VoxWeaver 不负责下载、加载、托管、升级模型或管理模型运行时。

## 能力边界

- **TTS**：把 `spoken` 文本合成为语音，可进一步包含预置音色、音色克隆、声音设计、情绪控制和流式输出。
- **ASR**：把音频转写为文本，可进一步包含句级/词级时间戳、热词、语言提示、异步长音频和流式输出。
- **VAD**：判断语音开始、结束以及语音/静音区间，不负责识别文本或确认说话人身份。
- **Speaker diarization**：回答“谁在什么时间说话”，通常只产生 `SPEAKER_00` 等匿名标签。
- **Speaker verification**：判断两段音频是否可能属于同一说话人。
- **Speaker identification**：使用预先登记的声纹或其他已知信息，把候选说话人与已知身份匹配。

diarization、verification 和 identification 必须作为不同能力声明，不能用单个 `speakerAnalysis: true` 代替。

## 开放权重候选

### TTS

| 候选 | 当前可确认用途 | 官方入口 | 执行前重点复核 |
|---|---|---|---|
| Qwen3-TTS | 流式 TTS、声音设计、音色克隆 | <https://github.com/QwenLM/Qwen3-TTS> | 具体权重、版本、显存、参考音频要求、模型与生成内容许可 |
| CosyVoice | 多语言 TTS、零样本和跨语言音色克隆，并提供服务部署示例 | <https://github.com/QwenAudio/CosyVoice> | 具体权重许可、服务协议、中文长文本稳定性和音色一致性 |
| GPT-SoVITS | 零样本和少样本音色克隆、可训练角色音色 | <https://github.com/RVC-Boss/GPT-SoVITS> | 仓库、依赖、预训练权重和训练数据的许可必须分别核对 |

### ASR、VAD 与组合流水线

| 候选 | 当前可确认用途 | 官方入口 | 执行前重点复核 |
|---|---|---|---|
| FunASR | ASR、VAD、标点和说话人相关流水线，可自托管并提供服务化接口 | <https://github.com/modelscope/FunASR> | 源码许可与具体预训练权重许可分开核对；固定 API dialect 和模型版本 |
| Whisper | 多语言 ASR、语音翻译和语言识别候选 | <https://github.com/openai/whisper> | 固定 release/commit，并重新核对代码、权重、运行环境和中文长音频表现 |
| Silero VAD | 轻量 VAD，可通过 PyTorch 或 ONNX 运行 | <https://github.com/snakers4/silero-vad> | 固定模型 revision、采样率、阈值、端点策略和 loopback 服务契约 |

### 说话人分析

| 候选 | 当前可确认用途 | 官方入口 | 执行前重点复核 |
|---|---|---|---|
| pyannote Community-1 | 离线 speaker diarization，输出匿名说话人时间段 | <https://huggingface.co/pyannote/speaker-diarization-community-1> | CC-BY-4.0、访问条件、归属要求、重叠语音表现和模型 revision |
| WeSpeaker | speaker embedding、相似度、验证和 diarization | <https://github.com/wenet-e2e/wespeaker> | 工具链许可与每个预训练模型所依赖数据集的许可分开核对 |

## 平台 Provider API 候选

以下仅记录本轮从官方资料确认到的能力入口，不构成完整能力保证。未列出的能力表示本轮没有足够官方信息确认，不代表平台一定不提供。

### 国内平台

| Provider | 当前可确认候选能力 | 官方入口 | 后续关注点 |
|---|---|---|---|
| 阿里云 Model Studio | Qwen/CosyVoice TTS 和音色克隆；Qwen、Fun-ASR、Paraformer ASR；部分异步 ASR 支持 diarization | [音色克隆](https://help.aliyun.com/en/model-studio/voice-clone-design-http-api)、[非实时 ASR 与 diarization](https://help.aliyun.com/en/model-studio/non-realtime-speech-recognition-user-guide)、[实时 ASR](https://help.aliyun.com/en/model-studio/real-time-speech-recognition-user-guide) | 区域 endpoint、公开 URL 上传、异步轮询/回调、模型快照、数据保留 |
| 腾讯云 | TTS、声音复刻、录音文件和实时 ASR、实时说话人分离 | [TTS API](https://cloud.tencent.com/document/product/1073/127845)、[声音复刻](https://cloud.tencent.com/document/product/1283/90066)、[ASR API](https://cloud.tencent.com/document/product/1093/101674)、[实时说话人分离](https://cloud.tencent.com/document/product/1093/133356) | 国际/国内 endpoint、SDK 与原生 HTTP/WebSocket 契约、说话人标签格式 |
| 百度智能云 | 音色复刻后的 TTS、ASR、语音质检中的话者分离 | [音色 TTS](https://cloud.baidu.com/doc/SPEECH/s/qmjiax60m)、[ASR](https://cloud.baidu.com/doc/SPEECH/s/Jlbxdezuf)、[话者分离](https://cloud.baidu.com/doc/SPEECH/s/Jltpnuit6) | 长音频接口、时间戳粒度、话者分离是否能独立于质检使用、上传方式 |
| 讯飞开放平台 | 在线 TTS、流式 ASR、声纹 1:1 验证和 1:N 检索 | [在线 TTS](https://www.xfyun.cn/doc/tts/online_tts/API.html)、[流式 ASR](https://www.xfyun.cn/doc/asr/voicedictation/API.html)、[声纹 API](https://www.xfyun.cn/doc/voiceservice/isv/API.html) | 新旧 WebAPI 状态、账号开通范围、长音频、声纹数据和身份授权 |
| 火山引擎/豆包语音 | 在线 TTS、声音复刻、ASR；相关方案包含说话人分离 | [语音合成入口](https://www.volcengine.com/docs/6561/1354862)、[音色管理 API](https://www.volcengine.com/docs/6561/2235883)、[ASR 与说话人分离候选](https://www.volcengine.com/docs/6492/2192001?lang=en) | 必须进一步找到可直接接入的正式 ASR/diarization API 契约，不能只依赖解决方案页面 |
| MiniMax | TTS 和音色克隆 | [音色克隆](https://platform.minimaxi.com/docs/guides/speech-voice-clone)、[API 概览](https://platform.minimaxi.com/docs/api-reference/api-overview) | ASR、独立 VAD、说话人分析当前信息不足，执行时重新确认 |

### 国际平台

| Provider | 当前可确认候选能力 | 官方入口 | 后续关注点 |
|---|---|---|---|
| OpenAI | TTS、文件/实时 ASR、带 diarization 的转写、Realtime turn detection/VAD | [官方模型目录](https://developers.openai.com/api/docs/models/all)、[Transcribe Diarize](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)、[Realtime API](https://platform.openai.com/docs/api-reference/realtime?lang=javascript) | 可用模型和弃用状态、音色范围、文件/实时接口差异、区域和数据策略 |
| ElevenLabs | TTS、音色能力、STT、时间戳和 speaker diarization | [TTS 快速开始](https://elevenlabs.io/docs/eleven-api/quickstart)、[STT](https://elevenlabs.io/speech-to-text-api) | 中文长文本、实时 VAD 的正式返回契约、音色授权和数据保留 |
| Microsoft Azure Speech | TTS、自定义声音、实时/快速/批量 STT 和 diarization | [Speech 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/)、[TTS](https://learn.microsoft.com/en-us/azure/ai-services/Speech-Service/text-to-speech)、[diarization](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/configure-language-identification-diarization) | 自定义声音准入、区域、REST 与 SDK 差异、中文 locale 和 speaker 字段 |
| Google Cloud | TTS、STT、流式 voice activity events、speaker diarization | [TTS REST](https://docs.cloud.google.com/text-to-speech/docs/reference/rest)、[VAD events](https://docs.cloud.google.com/speech-to-text/docs/voice-activity-events)、[speaker diarization](https://docs.cloud.google.com/speech-to-text/docs/multiple-voices?authuser=0&hl=en) | VAD 仅流式接口的边界、语言支持、长音频和异步任务 |
| Deepgram | TTS、STT、基于 VAD 的 endpointing、speaker diarization | [TTS](https://developers.deepgram.com/docs/text-to-speech)、[endpointing/VAD](https://developers.deepgram.com/docs/endpointing)、[diarization](https://developers.deepgram.com/docs/diarization/) | 中文和有声书场景覆盖、batch/streaming 模型版本、speaker 字段兼容性 |
| AWS | Amazon Polly TTS；Amazon Transcribe ASR 和 speaker partitioning | [Polly](https://docs.aws.amazon.com/polly/latest/dg/how-text-to-speech-works.html)、[Transcribe diarization](https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html) | 中文音色、长文本任务、VAD 是否需要独立 Provider、区域和对象存储依赖 |
| AssemblyAI | ASR、时间戳、speaker diarization 和基于上下文的身份/角色标注 | [speaker diarization](https://www.assemblyai.com/docs/pre-recorded-audio/label-speakers)、[speaker identification](https://www.assemblyai.com/docs/speech-understanding/speaker-identification) | 上下文推断身份不能等同于声纹验证；确认中文、区域和数据保留 |
| pyannoteAI | 托管 diarization、voiceprint 和已知说话人 identification | [diarization API](https://docs.pyannote.ai/api-reference/diarize)、[identification API](https://docs.pyannote.ai/api-reference/identify) | voiceprint 生命周期、阈值校准、身份授权、回调和异步任务恢复 |

## 功能要求

### 候选登记

- 候选必须按 TTS、ASR、VAD、diarization、verification、identification 分别标注能力；
- 同一 Provider 可以提供多种能力，但每种能力必须有独立请求、结果和限制记录；
- 每个外部入口记录最后核对日期，执行前重新检查页面是否仍有效；
- 模型别名、稳定版本和固定快照分开记录，不能只保存一个会漂移的 `latest`；
- 对没有官方资料确认的能力标记 `unverified`，不得根据平台品牌或相邻产品推断；
- 自托管开放权重模型只记录其外部 Provider endpoint，不进入 VoxWeaver 的模型生命周期管理。

### 评估与准入

- 使用相同的合法授权中文样章比较候选；
- TTS 至少检查旁白、多人对白、专名、多音字、数字、长句、情绪和跨片段音色一致性；
- ASR 至少检查漏读、多读、重复、专名、数字、标点、句级/词级时间戳和长音频任务恢复；
- VAD 至少检查短停顿、长停顿、低音量、背景音乐、呼吸声和截断；
- diarization 至少检查说话人切换、短插话、重叠语音、说话人数未知和标签稳定性；
- verification/identification 必须单独校准阈值，并保留人工确认；
- 每个 adapter 通过 Mock 契约测试和显式启用的实时连通性测试后才能标记可用。

## 数据与状态要求

候选记录可先使用文档或临时评估数据，不代表正式 Schema。建议至少保留：

```ts
interface SpeechProviderCandidate {
  candidateId: string;
  providerName: string;
  capability: "tts" | "asr" | "vad" | "diarization" | "verification" | "identification";
  deliveryMode: "cloud" | "loopback" | "lan";
  apiDialect?: string;
  modelId?: string;
  modelVersion?: string;
  officialUrls: string[];
  sourceCheckedAt: string;
  verificationStatus: "memo" | "source_refreshed" | "contract_checked" | "benchmarked" | "approved" | "rejected";
  licenseStatus: "unverified" | "restricted" | "verified";
  voiceRightsStatus?: "not_applicable" | "unverified" | "verified";
  dataRetentionStatus: "unverified" | "verified";
  regionStatus: "unverified" | "verified";
  notes: string[];
}
```

后续基准结果还应记录样章版本、音频输入 hash、Provider 请求 ID、模型版本、参数、输出 hash、耗时、费用、自动指标和人工评价。

## 依赖和约束

- 受 `docs/spec/00.项目基线与工程工作区.md` 第 6 节约束，VoxWeaver 不内置或托管任何模型；
- 源码许可、模型权重许可、训练数据许可和生成内容使用权必须分别核对；
- 音色克隆和声纹登记必须有声音权利人授权、用途范围和撤销/删除机制；
- diarization 的匿名标签不能直接写入 Character Registry 作为真实角色；
- AssemblyAI 等基于对话内容推断姓名或角色的能力，不等同于声纹身份核验；
- 官方功能清单不能证明中文有声书质量，最终选型必须依赖同一批样章的可复现基准；
- 价格、配额、可用区域、模型别名、弃用状态和数据保留策略均属于易变信息，不能把本备忘当作实时真值；
- Provider 凭据只能由 Core/凭据代理管理，Renderer 不直接访问 Provider；
- 云端上传真实小说或参考音频前，必须确认数据处理、保留、训练使用和删除政策；
- 未确认的 Provider 不得进入默认生产配置。

## 待确认问题

- MVP 首批只接一个 TTS 和一个 ASR Provider，还是同时保留国内云与自托管 loopback 两条路线；
- 是否需要独立 VAD adapter，还是先使用 ASR Provider 返回的端点和时间戳；
- speaker diarization 是否进入 MVP，还是只在导入多人参考音频时启用；
- speaker verification/identification 是否有真实业务需求，是否允许保存声纹；
- 通用自托管 adapter 采用 OpenAI-compatible dialect、项目自定义协议还是逐模型协议；
- 第一批合法样章、角色音色参考和人工评价规则如何确定；
- 哪些数据可以发送到境外区域，哪些必须使用国内区域或用户自管服务；
- 音色克隆的授权证明、撤销、删除、水印和审计如何落盘；
- Provider 输出时间戳、speaker label 和异步回调如何规范化；
- 首批成本预算、并发目标、超时和失败恢复指标是什么。

## 建议的后续落地阶段

1. **来源刷新**：进入实施前重新打开全部官方入口，删除已下线候选，补充当前模型 ID、区域、价格、配额、许可和数据策略。
2. **能力契约筛选**：按 TTS、ASR、VAD 和说话人能力分别确认请求、响应、同步/异步、取消、回调、时间戳和错误契约。
3. **合法样章基准**：对通过基础筛选的候选执行同一批音频与文本测试，保存原始结果和人工评价，不依据宣传指标直接排名。
4. **用户确认选型**：确认首批 Provider、备选 Provider 和明确不采用项，再决定是否更新正式计划或依赖规格中的技术决策。
5. **adapter 实施**：实现最小 adapter、Mock 契约测试和显式实时测试；通过后才标记为可用。
6. **生产治理**：补充成本监控、限流、数据删除、音色授权、声纹生命周期、模型变更和回归基准。

记录此备忘不代表已经批准任何模型部署、云服务采购、Provider adapter 实现、正式计划修改或生产数据上传。
