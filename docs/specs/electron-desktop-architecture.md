# VoxWeaver Electron 桌面应用架构规格

状态：`draft`

版本：`0.2.0`

日期：2026-08-08

适用范围：桌面端 MVP

对应阶段：[阶段 00：项目基线与工程工作区](../../plan/00.项目基线与工程工作区.md)

## 1. 文档定位

本规格细化 VoxWeaver 桌面端的运行时、语言、进程、通信、目录、任务恢复和安全边界。

本规格当前为设计草案，不表示已经完成以下动作：

- 创建 Electron、Vue、Node.js 或 Python 工程；
- 确认最终依赖版本、包管理器、构建器或 SQLite 驱动；
- 确认 Python 运行时和语音模型权重的分发方案；
- 修改 `项目计划.md` 或阶段 00 的正式范围；
- 生成对应 ADR。

进入实现前必须创建 ADR，确认本规格的核心选型、回退条件和验证证据，并同步阶段 00 的待决策事项。

## 2. 目标

- 使用 Electron 提供单一桌面入口、原生目录选择、应用生命周期和安装分发；
- 使用 Vue 3 和 TypeScript 实现可维护的桌面界面；
- 将窗口生命周期、领域工作流、文件/数据库写入和模型计算隔离到不同进程；
- 所有小说、项目状态、音频和导出产物默认保存在用户本地；
- TTS、ASR 和 FFmpeg 通过可替换 worker 接入，不污染领域模型；
- 所有大语言模型能力通过可替换 Provider API 接入，应用不运行、下载、加载或托管 LLM；
- 同一内部 LLM 应用端口（port abstraction，不是 TCP 端口）可以连接用户已启动的 LM Studio、Ollama 或云厂商官方服务；
- worker 崩溃、任务取消或应用重启后可以恢复，不要求重跑整章；
- 第一版不启动 VoxWeaver 自身的 localhost HTTP 服务，不开放入站网络 API；
- 保留未来增加浏览器、CLI、远程 worker 或 HTTP 适配器的边界。

## 3. 非目标

- 不把所有逻辑放进 Electron main 或 renderer；
- 不在 renderer 中启用 Node.js integration；
- 不让 Python worker 直接修改项目 SQLite 或正式 revision；
- 不在进程消息中传输完整音频二进制、模型权重或大段文件内容；
- 不在 VoxWeaver 进程内运行 LLM 推理、管理 LLM 权重或控制 LM Studio/Ollama 的模型下载、加载和卸载；
- 不让 renderer 直接调用任何本地或云端 LLM API；
- 不在 MVP 提供多人协作、远程项目或常驻系统服务；
- 不在本规格固定具体 TTS、ASR、LLM 模型；
- 不假定目标机器已经安装兼容的系统 Python、FFmpeg 或 CUDA；
- 不把未确认的 `docs/ideas/` 内容纳入实现范围。

## 4. 技术结论

Electron 应用不要求所有后端能力都使用 JavaScript 或 TypeScript。推荐语言边界如下：

| 区域 | 推荐语言/运行时 | 结论 | 原因 |
|---|---|---|---|
| Renderer | Vue 3 + TypeScript | 确定方向 | 用户界面、状态展示和交互 |
| Preload | TypeScript，构建为 JavaScript | 确定方向 | 受限 `contextBridge` API |
| Electron Main | TypeScript，构建为 JavaScript | 确定方向 | 窗口、对话框、协议和进程管理 |
| Application Core | TypeScript + Electron `utilityProcess` | 推荐方向 | 直接使用 Node.js/Electron 进程与消息能力，集中业务和状态写入 |
| 纯规则/文本 worker | TypeScript 或 Application Core 内模块 | 按性能验证 | 优先减少不必要的跨进程边界 |
| TTS/ASR/本地语音模型 worker | Python | 推荐方向 | 隔离语音模型 SDK、CUDA/Metal 和 Python 依赖 |
| LLM Provider Client | TypeScript，运行在 Application Core | 确定方向 | 统一连接本地 API 端点和云厂商官方 API，不运行 LLM |
| 音频处理 | FFmpeg 外部进程；必要时增加 Python/TS 包装 | 推荐方向 | 复用成熟命令行处理器，保持处理链可记录 |
| SQLite | 由 Application Core 的 Node.js 进程独占写入 | 推荐方向 | 维持单逻辑写入者和统一事务边界 |
| 跨进程契约 | TypeScript 类型 + JSON Schema Draft 2020-12 | 已有计划约束 | 同时校验 TS、Python 和持久化数据 |

原则：TypeScript 是桌面壳、应用核心和 LLM Provider 适配器语言；Python 是本地语音/音频模型适配器语言，不是第二套领域后端。LLM 始终是外部 API 依赖。

## 5. 总体进程架构

```mermaid
flowchart LR
    Renderer["Renderer<br/>Vue 3 + TypeScript"]
    Preload["Preload<br/>受限 Context Bridge"]
    Main["Electron Main<br/>窗口、协议、进程生命周期"]
    Core["Application Core<br/>TypeScript Utility Process"]
    TextWorker["Text Worker<br/>TypeScript，可选"]
    SpeechWorker["Speech Worker<br/>Python TTS / ASR"]
    AudioWorker["Audio Worker<br/>FFmpeg"]
    LlmAdapter["LLM Provider Adapters<br/>TypeScript"]
    LocalLlm["用户管理的本地 API<br/>LM Studio / Ollama"]
    CloudLlm["云厂商官方 API<br/>HTTPS"]
    State["项目 SQLite"]
    Files["项目文件与正式产物"]

    Renderer -->|"类型化调用"| Preload
    Preload -->|"Electron IPC"| Main
    Main -->|"MessagePort"| Core
    Core --> State
    Core --> Files
    Core --> TextWorker
    Core --> SpeechWorker
    Core --> AudioWorker
    Core --> LlmAdapter
    LlmAdapter --> LocalLlm
    LlmAdapter --> CloudLlm
    TextWorker -->|"临时产物/结果清单"| Core
    SpeechWorker -->|"临时音频/结果清单"| Core
    AudioWorker -->|"临时音频/结果清单"| Core
```

强制依赖方向：

```text
renderer
  → preload contract
  → main transport
  → application use cases
  → domain / workflow / ports
  → storage and engine adapters
```

领域和 workflow 包不得依赖 Vue、Electron、SQLite 驱动、Python SDK、厂商 LLM SDK 或具体模型 SDK。

## 6. 代码目录建议

```text
voxweaver/
├── apps/
│   ├── desktop/
│   │   ├── main/                  # Electron main
│   │   └── preload/               # contextBridge 实现
│   └── web/                       # Vue renderer；名称沿用现有计划
├── services/
│   ├── app-core/                  # Electron utilityProcess 入口
│   └── api/                       # MVP 不实现；保留未来 HTTP/CLI 适配器位置
├── workers/
│   ├── text/                      # 可选 TypeScript worker
│   ├── speech/                    # Python TTS/ASR worker 与适配器
│   └── audio/                     # FFmpeg 调度与结果校验
├── packages/
│   ├── contracts/                 # IPC、worker、manifest、事件 schema
│   ├── application/               # 应用用例和查询
│   ├── novel-domain/
│   ├── project-workspace/
│   ├── workflow-core/
│   ├── text-pipeline/
│   ├── speaker-analysis/
│   ├── pronunciation/
│   ├── llm-engine/                # Provider 端口、能力和厂商适配器
│   ├── tts-engine/
│   ├── asr-engine/
│   └── audio-processing/
├── configs/
│   └── providers/                 # 无密钥 Provider 模板和策略
├── docs/
├── plan/
└── tests/
```

阶段 00 当前假定 `services/api`。本规格被 ADR 接受时，应将阶段 00 更新为：MVP 使用 `services/app-core`，`services/api` 仅作为未来传输适配器保留。

## 7. 进程职责

### 7.1 Renderer

Renderer 只负责：

- Vue 路由、组件和页面状态；
- 项目、章节、剧本、角色、音色、任务、QA 和导出界面；
- LLM Provider 配置、连通性测试、模型选择和远程数据提示界面；
- 发起明确的命令和查询；
- 订阅领域事件与任务进度；
- 通过受控资源 URL 播放音频；
- 展示错误，不决定任务重试和事务结果。

Renderer 不得：

- 导入 `electron`、`node:*`、SQLite 驱动或 Python SDK；
- 直接读取或写入绝对路径；
- 直接创建子进程；
- 保存数据库连接、项目锁或正式任务状态；
- 根据具体模型 ID 编写业务分支；
- 保存或读取 Provider API 密钥；
- 直接向 Provider endpoint 发出网络请求；
- 加载并执行远程 JavaScript。

Vue 代码统一使用 Composition API 和 `<script setup lang="ts">`。跨页面业务状态必须来自 Application Core 的查询或事件；组件局部交互状态才保存在 renderer。

### 7.2 Preload

Preload 通过 `contextBridge.exposeInMainWorld()` 暴露单一命名空间：

```ts
interface VoxWeaverDesktopApi {
  app: AppDesktopApi;
  project: ProjectDesktopApi;
  task: TaskDesktopApi;
  llmProvider: LlmProviderDesktopApi;
  artifact: ArtifactDesktopApi;
  events: EventDesktopApi;
}
```

Preload 必须：

- 为每个操作提供独立方法；
- 只接受和返回可结构化克隆的数据；
- 在发送前执行轻量 schema 校验；
- 过滤 Electron event 对象，只把业务数据传给 renderer；
- 在取消订阅时解除底层监听器。

Preload 不得暴露完整 `ipcRenderer`、任意 channel、任意文件 API、shell 或进程 API。

### 7.3 Electron Main

Main 只负责：

- 单实例和应用生命周期；
- `BrowserWindow` 创建、恢复和销毁；
- 原生文件/目录选择对话框；
- Provider 凭据的系统安全存储，以及向 Core 按请求提供的内存凭据代理；
- 启动、监控、重启和停止 Application Core；
- renderer 与 Core 之间的消息路由；
- 注册受控的本地资源协议；
- 限制导航、新窗口、权限请求和外部链接；
- 更新、签名和崩溃报告入口。

Main 不得：

- 运行 TTS、ASR、LLM 推理或 FFmpeg；
- 直接实现领域用例；
- 直接写项目 SQLite 或正式 artifact；
- 执行同步文件遍历或同步子进程调用；
- 接收 renderer 提供的任意可执行命令或绝对输出路径；
- 向 renderer 返回 Provider 明文凭据。

### 7.4 Application Core

Application Core 是本地业务后端，但不是 HTTP 服务器。它运行在独立 Electron `utilityProcess` 中，负责：

- 应用用例和查询；
- 活动项目上下文；
- 项目锁、路径解析和目录迁移；
- SQLite 连接、事务和 schema 迁移；
- Artifact、revision、依赖和 stale cause；
- Task、StageRun、审核和幂等键；
- worker 选择、资源限制、取消、超时和恢复；
- LLM Provider profile、能力探测、调用、超时、重试和输出校验；
- 临时产物校验和正式提交；
- 生成 renderer 可消费的领域事件；
- 适配未来 HTTP、CLI 或远程传输端口。

Core 崩溃时 Main 保持运行，显示恢复页，并在确认项目写锁和数据库状态后重新启动 Core。

### 7.5 Worker

Worker 只执行一个明确处理器职责：

- 读取 Core 已解析和授权的输入；
- 把结果写入任务专属 `tmp/`；
- 输出结构化结果、指标、日志和错误；
- 响应取消或在超时后被终止；
- 不切换活动 revision；
- 不更新 SQLite；
- 不删除历史 artifact；
- 不自行决定自动重试。

LLM 不属于本节 worker。所有 LLM 推理都由外部 Provider API 完成。

## 8. LLM Provider API

### 8.1 强制边界

VoxWeaver 只作为 LLM API 客户端：

- 不内嵌 LLM 推理运行时；
- 不随安装包分发 LLM 权重；
- 不启动或停止 LM Studio、Ollama 或其他 LLM 服务；
- 不调用模型下载、加载、卸载或运行时管理接口；
- 不直接访问 GPU、Metal、CUDA 或 LLM 推理进程；
- 不要求 Provider 与 VoxWeaver 使用相同语言；
- 本地 Provider 和云 Provider 使用同一应用端口和任务状态模型。

本地 Provider 指用户独立安装、启动和管理的 API 服务。VoxWeaver 可以连接其 loopback endpoint，但该服务不属于 VoxWeaver 子进程。

“MVP 不提供 HTTP 服务”仅表示 VoxWeaver 不监听入站 HTTP 端口，不限制 Core 主动访问用户配置的 LLM Provider HTTP/HTTPS endpoint。

### 8.2 Provider 端口

```ts
interface LlmProviderAdapter {
  readonly providerKind: string;
  readonly apiDialect: string;
  probe(
    context: LlmProviderRuntimeContext,
    signal: AbortSignal,
  ): Promise<LlmProviderCapabilities>;
  listModels?(
    context: LlmProviderRuntimeContext,
    signal: AbortSignal,
  ): Promise<LlmModelDescriptor[]>;
  generate(
    context: LlmProviderRuntimeContext,
    request: CanonicalLlmRequest,
    signal: AbortSignal,
  ): Promise<CanonicalLlmResult>;
}

interface LlmProviderRuntimeContext {
  profile: LlmProviderProfile;
  credential?: Readonly<{
    type: "api-key" | "bearer" | "basic";
    secret: string;
  }>;
}
```

`LlmProviderRuntimeContext` 仅存在于受信任进程的单次调用内存中，不是 renderer IPC 公共 DTO、日志结构或持久化 schema。

内部请求不得直接复制任一厂商 DTO：

```ts
interface CanonicalLlmRequest {
  operationId: string;
  taskId: string;
  providerProfileId: string;
  modelId: string;
  promptRevisionId: string;
  inputArtifactIds: string[];
  messages: CanonicalMessage[];
  responseSchemaId?: string;
  parameters: CanonicalLlmParameters;
}

interface CanonicalLlmResult {
  providerRequestId?: string;
  modelId: string;
  output: unknown;
  finishReason?: string;
  usage?: CanonicalTokenUsage;
  rawResponseArtifactId?: string;
}
```

厂商特有字段只能存在于对应 adapter、Provider profile 的扩展配置或原始响应 artifact 中，不得进入领域实体。

### 8.3 Provider Profile

```ts
interface LlmProviderProfile {
  providerProfileId: string;
  displayName: string;
  providerKind:
    | "lmstudio"
    | "ollama"
    | "openai-compatible"
    | "anthropic-compatible"
    | "vendor-native";
  apiDialect: string;
  endpointClass: "loopback" | "remote";
  baseUrl: string;
  credentialRef?: string;
  defaultModelId?: string;
  enabled: boolean;
}
```

约束：

- 项目只引用 `providerProfileId`，不复制密钥；
- Provider profile 是应用级配置，不属于可公开导出的项目内容；
- `credentialRef` 只引用应用安全存储中的凭据；
- 本地和云端 profile 必须明确区分，不能只依赖 URL 文本推断；
- profile 变化不修改历史请求记录；
- 历史产物保留实际 provider、dialect、endpoint class 和 model ID。

### 8.4 能力声明

```ts
interface LlmProviderCapabilities {
  streaming: boolean;
  structuredOutput: "native-schema" | "json-mode" | "prompt-only" | "none";
  toolCalling: boolean;
  vision: boolean;
  modelListing: boolean;
  usageReporting: boolean;
  maxContextTokens?: number;
}
```

不得因为 Provider 声明“OpenAI-compatible”就假定所有字段、Responses API、工具调用、结构化输出、usage、流式事件或错误格式完全一致。每个 adapter 必须显式声明并测试实际能力。

应用用例只请求所需能力。例如要求 JSON Schema 输出的任务必须：

1. 优先使用 Provider 的原生 schema 能力；
2. 其次使用 JSON mode；
3. 仅在策略允许时回退到 prompt-only；
4. 始终在 Core 侧重新执行 JSON Schema 校验；
5. 不支持最低能力时在请求前失败，不发送降级后语义不等价的请求。

### 8.5 调用和审计

LLM 调用流程：

```text
应用用例创建 Task
→ 固定输入 artifact、Prompt 和 schema revision
→ 解析 Provider profile 和凭据引用
→ 检查本地/远程数据策略
→ adapter 构造厂商请求
→ 调用外部 Provider API
→ 保存原始响应或诊断摘要
→ 转换 CanonicalLlmResult
→ Core 执行 schema 和业务校验
→ 创建候选 artifact 和人工审核任务
```

每次调用至少记录：

```text
provider_profile_id
provider_kind
api_dialect
endpoint_class
model_id
provider_request_id（若有）
prompt_revision_id
response_schema_id
输入指纹
生成参数
开始/结束时间
usage（若 Provider 提供）
重试次数和错误分类
```

不得依赖模型别名推断固定行为。同一 model ID 的后端实现、量化或服务端版本可能不同；可复现性记录必须以 Provider 实际可提供的信息为限，并明确其不确定性。

### 8.6 本地与远程数据策略

- `loopback` profile 默认允许访问 `http://127.0.0.1`、`http://[::1]` 或经过规范化验证的 `localhost`；
- `remote` profile 默认只允许 HTTPS；
- 每个项目必须有 `allowRemoteLlm` 策略；
- 首次向 remote profile 发送项目内容前必须明确提示数据将离开本机；
- 禁止把未授权原文、声音、密钥或不在任务范围内的上下文发送给 Provider；
- adapter 只发送当前任务所需的最小文本和结构化上下文；
- renderer 不直接接收远程 API 密钥或厂商原始网络事件；
- 日志默认不记录 Prompt、原文、完整响应或 Authorization header；
- Provider profile 的测试请求不得自动发送真实项目内容。

### 8.7 凭据和 endpoint 安全

- API 密钥通过 Main 的安全凭据服务写入 Electron `safeStorage` 或后续 ADR 选定的系统凭据存储；
- project manifest、SQLite 业务表、日志、错误详情和导出包只保存 `credentialRef`；
- Main 从安全存储解密凭据，经受限的按请求代理交给 Core；Core 和 adapter 只在单次调用内存中使用，不写临时文件；
- Linux 环境若安全存储退化为不安全后端，必须阻止保存云端密钥或要求用户明确选择替代凭据方案；
- endpoint 仅允许 `http` 和 `https`，拒绝 `file`、`data`、`ftp`、`gopher` 等协议；
- 默认禁止自动跟随跨主机重定向；
- 解析 URL、DNS 和最终连接地址时应用一致的 allowlist 策略；
- 除显式 `loopback` profile 外，拒绝访问 loopback、链路本地和云元数据地址；
- 请求必须配置连接、首字节、总时长和最大响应体限制。

### 8.8 首批 adapter

| Adapter | 端点类型 | MVP 边界 |
|---|---|---|
| LM Studio | 用户管理的本地 REST API | 只调用推理和可选模型查询，不调用下载/加载/卸载 |
| Ollama | 用户管理的本地原生或 OpenAI-compatible API | 只调用推理和可选模型查询，不执行 pull/create/delete |
| OpenAI-compatible | 本地或远程 | 仅使用已验证的兼容子集，不能代替厂商能力探测 |
| Anthropic-compatible | 本地或远程 | 独立 adapter，不与 OpenAI DTO 混用 |
| Vendor Native | 云厂商官方 API | 每个厂商独立认证、错误、流式和能力映射 |

首批 adapter 列表不等于承诺支持所有厂商。每个 adapter 必须通过契约测试和至少一个显式启用的实时连通性测试后才可标记为可用。

### 8.9 错误、重试和流式输出

统一错误至少区分：

```text
PROVIDER_UNREACHABLE
PROVIDER_AUTH_FAILED
PROVIDER_RATE_LIMITED
PROVIDER_MODEL_NOT_FOUND
PROVIDER_CAPABILITY_UNSUPPORTED
PROVIDER_TIMEOUT
PROVIDER_RESPONSE_INVALID
PROVIDER_CONTENT_REJECTED
PROVIDER_INTERNAL_ERROR
```

- 网络失败、限流和明确的服务端临时错误可以按策略重试；
- 认证、模型不存在、能力不足和 schema 不匹配不得无限重试；
- 重试必须绑定同一输入、Prompt、schema、Provider profile 和 model ID；
- Provider 流式事件先由 adapter 规范化，renderer 不依赖厂商事件名；
- 用户取消通过 AbortSignal 传播，取消后到达的响应不得提交为活动 artifact；
- 远程计费请求在不确定是否已被 Provider 接收时，不得静默重复提交。

## 9. Renderer 与 Core 通信

### 9.1 传输

MVP 采用：

```text
Renderer
→ contextBridge
→ ipcRenderer.invoke / ipcMain.handle
→ Main 路由
→ MessagePort
→ Application Core
```

不采用 localhost HTTP、随机 TCP 端口或 renderer 直接连接 Core。

Main 只执行身份、窗口和 schema 校验，不复制领域规则。

### 9.2 消息信封

请求：

```ts
interface DesktopRequest<TPayload> {
  protocolVersion: "1";
  requestId: string;
  method: string;
  projectContext?: {
    projectId: string;
    projectSessionId: string;
  };
  payload: TPayload;
}
```

响应：

```ts
type DesktopResponse<TResult> =
  | {
      protocolVersion: "1";
      requestId: string;
      ok: true;
      result: TResult;
    }
  | {
      protocolVersion: "1";
      requestId: string;
      ok: false;
      error: DesktopError;
    };

interface DesktopError {
  code: string;
  message: string;
  retryable: boolean;
  operationId?: string;
  details?: unknown;
}
```

事件：

```ts
interface DesktopEvent<TPayload> {
  protocolVersion: "1";
  eventId: string;
  eventType: string;
  occurredAt: string;
  projectId?: string;
  projectSessionId?: string;
  payload: TPayload;
}
```

所有消息必须通过 JSON Schema 校验。未知协议主版本必须拒绝；未知可选字段在兼容读取时保留。

JSON Schema 是跨语言 wire contract 的机器可校验真值。TypeScript 类型和 Python 数据模型必须由 schema 生成，或通过双向契约测试证明与 schema 一致；不得手工维护三套互不校验的定义。

### 9.3 首批方法

```text
app.getRuntimeInfo
app.getHealth
dialog.selectWorkspaceRoot
dialog.selectImportFiles
project.listRecent
project.create
project.open
project.openReadOnly
project.close
project.getSummary
project.previewChangeImpact
task.create
task.cancel
task.retry
task.list
task.get
llmProvider.listProfiles
llmProvider.saveProfile
llmProvider.deleteProfile
llmProvider.testConnection
llmProvider.getCapabilities
llmProvider.listModels
artifact.get
artifact.listRevisions
artifact.activateRevision
artifact.getPlaybackUrl
export.create
export.revealInFileManager
```

方法名只是协议草案。实现前必须生成对应 schema、合法/非法夹具和权限矩阵。

### 9.4 资源访问

Renderer 不接收正式 artifact 的绝对路径。音频、封面和只读文本资源通过受控自定义协议访问，例如：

```text
voxweaver-artifact://<project-session-id>/<artifact-id>/<revision-id>
```

协议处理器必须：

- 把 ID 交给 Core 解析；
- 校验当前窗口、项目 session 和 artifact 权限；
- 支持音频播放需要的范围读取；
- 设置明确 MIME 类型；
- 禁止目录枚举和任意相对路径；
- 项目切换后使旧 session URL 失效。

## 10. 项目目录与 SQLite

项目目录沿用阶段 00：

```text
<workspace-root>/projects/<safe-slug>--<project-id>/
├── project.json
├── state/
│   ├── project.sqlite
│   ├── backups/
│   └── locks/
├── inputs/
├── artifacts/
├── exports/
├── cache/
├── logs/
└── tmp/
```

目录职责：

- SQLite 是项目索引和工作流真值；
- `inputs/` 与正式 revision 文件是内容真值；
- `tmp/` 只保存未提交任务产物；
- `cache/` 可以重建；
- `exports/` 保存不可变导出快照；
- renderer 只持有 ID 和展示信息；
- 只有 Core 可以解析 ID 到真实路径；
- worker 仅收到 Core 验证后的任务目录和输入路径。

SQLite 约束：

- 每个活动项目只允许 Core 持有写连接；
- worker 不打开写连接；
- 正式文件提交、依赖更新、活动版本切换和 stale cause 登记必须位于明确事务边界；
- 先完成临时文件写入和校验，再执行数据库提交和正式文件切换；
- 失败必须能区分数据库未提交、正式文件缺失和孤立临时文件；
- 数据库驱动、journal mode、busy timeout 和备份方式由单独 ADR/验证任务确认。

## 11. Python Worker 协议

### 11.1 使用边界

Python 只用于需要 Python 模型生态或原生加速依赖的语音/音频处理器，例如 TTS、ASR、VAD 和说话人分析。LLM Provider adapter 不使用 Python worker。

Python worker 不包含 Project、Artifact、Revision、Task 或 StaleCause 的领域状态机。

### 11.2 进程启动

Core 使用 Node.js `child_process.spawn()` 启动已登记的可执行文件：

- `shell: false`；
- 命令和参数分别传递；
- 不拼接来自用户或 renderer 的命令字符串；
- `cwd` 指向受控 worker 目录或任务目录；
- 环境变量使用允许列表；
- stdout 只输出协议消息；
- stderr 输出结构化日志或诊断文本；
- 使用 AbortSignal、超时和终止升级策略；
- 记录实际可执行文件、版本、模型和依赖指纹。

### 11.3 NDJSON 消息

MVP 默认采用每行一个 JSON 对象的 NDJSON 协议。首条消息必须为握手：

```json
{"type":"hello","protocolVersion":"1","workerId":"speech","workerVersion":"0.1.0","capabilities":["tts","asr"]}
```

任务请求：

```json
{"type":"run","requestId":"req-1","taskId":"task-1","processorId":"tts.example","inputManifest":"/validated/task/input.json","outputDir":"/validated/project/tmp/task-1"}
```

进度：

```json
{"type":"progress","requestId":"req-1","taskId":"task-1","phase":"synthesize","completed":3,"total":10}
```

结果：

```json
{"type":"result","requestId":"req-1","taskId":"task-1","resultManifest":"/validated/project/tmp/task-1/result.json"}
```

错误：

```json
{"type":"error","requestId":"req-1","taskId":"task-1","code":"ENGINE_OUT_OF_MEMORY","message":"insufficient device memory","retryable":false}
```

取消：

```json
{"type":"cancel","requestId":"req-1","taskId":"task-1"}
```

路径字段只允许由 Core 生成。worker 返回的文件必须重新规范化并验证位于任务 `outputDir` 内。

### 11.4 二进制数据

- 音频、embedding、模型和大型文本不通过 NDJSON 传输；
- 消息只传递 manifest、ID、受控路径、哈希和指标；
- worker 先写任务 `tmp/`，Core 校验后提交正式 revision；
- stdout 出现非法 JSON、未知主版本或超大消息时终止 worker 并标记基础设施错误。

### 11.5 生命周期

- 频繁加载大型模型的 worker 可以长驻，但必须按模型和设备设置资源上限；
- FFmpeg 默认按任务启动独立进程；
- worker 启动后必须完成握手和健康检查；
- 崩溃时当前任务进入可判定的失败/恢复状态；
- 自动重启不能自动重放未确认幂等的任务；
- 连续崩溃达到上限后停止自动重启并要求人工处理；
- 应用退出时先停止接收新任务，再请求 worker 正常退出，超时后终止。

## 12. 任务与恢复

任务状态沿用阶段 00：

```text
execution_status: pending | running | succeeded | failed | canceled
validity_status:  current | stale | superseded | missing
review_status:    not_required | pending | approved | rejected
```

运行规则：

1. Core 在事务中创建任务和输入指纹；
2. Core 创建任务专属 `tmp/<task-id>/` 和输入 manifest；
3. worker 写入临时文件和结果 manifest；
4. Core 校验 schema、文件存在性、哈希、音频规格和路径边界；
5. Core 提交正式 revision、依赖和活动状态；
6. Core 发布任务完成事件；
7. 临时目录进入可恢复清理队列。

应用启动恢复必须扫描：

- 数据库中处于 `running` 的任务；
- 未提交结果 manifest；
- 孤立 `tmp/` 目录；
- 记录存在但正式文件缺失的 artifact；
- 写锁持有进程是否仍存活；
- schema 或目录布局是否需要迁移。

恢复操作不得根据“文件存在”直接推断任务成功。

## 13. 安全基线

Electron BrowserWindow 必须：

```ts
const window = new BrowserWindow({
  webPreferences: {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
});
```

同时必须：

- renderer 只加载随应用打包的本地 UI；
- 设置限制性 Content Security Policy；
- 禁止任意页面导航和新窗口；
- 所有 IPC handler 校验 sender；
- 不暴露完整 Electron 或 Node API；
- 不使用 renderer 提供的绝对路径、可执行文件或 shell 命令；
- 导入 EPUB/HTML 时按不可信数据处理，不在高权限上下文直接执行其中脚本；
- 外部 URL 只允许经过 allowlist 校验后交给系统浏览器；
- 正式项目路径执行规范化、根目录包含检查和符号链接边界检查；
- LLM Provider 凭据不得写入项目 manifest、业务日志或导出包；
- 用户配置的 Provider endpoint 必须通过协议、主机、重定向和最终连接地址校验；
- 依赖版本和 Electron 版本必须通过维护策略持续更新。

## 14. 开发、构建与分发

### 14.1 开发模式

开发命令应同时启动：

```text
Vue renderer dev server
Electron main/preload watch build
Application Core utility process build
按需启动的 worker 开发环境
显式启用的 LLM Provider mock 或外部测试端点
```

开发 renderer 可以由 Electron 加载 loopback dev server，但生产构建只能加载打包后的本地静态资源。

VoxWeaver 开发命令不得自动启动、下载或配置 LM Studio、Ollama 或任何云端 LLM 服务。默认测试使用 Provider mock；实时 Provider 测试必须显式启用。

### 14.2 生产包

生产包至少包含：

- Electron main、preload、renderer 和 Core 构建产物；
- 应用图标、协议和默认配置；
- FFmpeg 或其受支持的发现机制；
- Python worker 可执行文件或受管理运行时；
- worker 和资源 manifest；
- LLM Provider adapter、无密钥 profile 模板和 schema；
- schema、迁移和许可证清单。

JavaScript 构建产物可以进入 ASAR；需要作为独立可执行文件启动的 Python/FFmpeg 资源必须作为外部 packaged resources 处理。生产包不得包含 LLM 权重或 LLM 推理运行时。

### 14.3 Python 分发待验证项

实现前必须比较：

1. 每个平台打包独立 Python worker 可执行文件；
2. 随应用分发受管理 Python 运行时和锁定环境；
3. 首次运行时安装受管理环境；
4. 仅支持用户配置的外部 worker；
5. 本地 Electron 只提供 UI/Core，语音模型通过远程适配器运行。

比较维度：安装包大小、首次启动、离线能力、模型兼容、CUDA/Metal、代码签名、升级、许可证、故障诊断和回滚。

在完成至少一个目标平台的“安装包 → 启动 → 加载模型 → 生成 → 重启恢复”验证前，不得宣称 Python worker 已可分发。

### 14.4 版本策略

- Electron、Node.js、Chromium 版本以选定 Electron 版本内置组合为准；
- 不单独假定系统 Node.js 版本；
- TypeScript 编译目标与 Electron 内置 Node/Chromium 能力对齐；
- Python、语音模型、FFmpeg、worker 协议、LLM adapter 和 schema 分别版本化；
- 破坏性协议变化升级主版本并提供兼容或迁移策略；
- 最终版本和包管理器由工程初始化 ADR 固定。

## 15. 未来适配

领域和应用用例不得依赖 Electron IPC。未来可以增加：

```text
Electron IPC adapter ─┐
CLI adapter          ├─→ application use cases → domain/workflow
HTTP adapter         ┤
remote worker adapter┘
```

这里的 HTTP adapter 指未来供浏览器/CLI 访问 VoxWeaver 的入站 API，不是本规格已允许的 LLM Provider 出站 HTTP/HTTPS 调用。

增加入站 HTTP 或远程项目模式时：

- 不改变 Project、Artifact、Task 和 revision 语义；
- 不让 renderer 直接调用模型厂商 SDK；
- 保持同一 JSON Schema 契约或提供明确版本映射；
- 重新评估认证、授权、并发写入、对象存储和分布式队列；
- 通过新 ADR 批准，不由本规格自动进入 MVP。

## 16. 测试要求

### 16.1 单元测试

- 领域实体、状态和输入指纹；
- IPC/worker schema；
- 路径解析、包含检查和符号链接边界；
- 错误映射和重试分类；
- Provider URL、endpoint class、能力和数据策略；
- Vue composable 和组件局部状态。

### 16.2 契约测试

- renderer/preload/main/Core 请求响应；
- Core/Python worker 的合法、非法和未知版本消息；
- TTS、ASR 和 FFmpeg adapter manifest；
- LM Studio、Ollama、兼容协议和 vendor-native adapter 的规范化映射；
- Provider 能力不足、结构化输出降级和错误分类；
- TypeScript 与 Python 对同一 JSON Schema 的兼容性。

### 16.3 集成测试

- 创建、关闭和重新打开项目；
- SQLite 事务与正式文件提交；
- worker 启动、握手、进度、取消、超时和崩溃；
- 应用强制退出后的恢复；
- 项目切换后旧 session 请求被拒绝；
- 自定义资源协议和音频范围读取；
- Provider mock 的成功、流式、取消、限流、超时和非法响应；
- 实时 Provider 测试默认关闭且不读取真实项目内容。

### 16.4 安全测试

- renderer 无 Node.js 和 Electron 直接访问；
- 任意 IPC channel 不可调用；
- XSS 不能获得文件、shell 或进程权限；
- `../`、绝对路径和符号链接不能越界；
- 导入 HTML/EPUB 不执行内嵌脚本；
- worker 命令参数不经过 shell 拼接；
- renderer 不能读取 Provider 凭据或直接调用 endpoint；
- endpoint 拒绝不允许的协议、重定向、链路本地和云元数据地址；
- remote profile 未授权时不能发送项目内容；
- 旧项目 session URL 失效。

### 16.5 打包测试

- 目标平台安装、首次启动和卸载；
- 签名/公证后的应用可以启动；
- packaged resources 路径正确；
- Python/FFmpeg worker 在安装目录可启动；
- 路径包含空格和非 ASCII 字符；
- 升级不覆盖用户项目；
- 应用更新后旧项目迁移和回滚行为明确。

## 17. MVP 架构验收标准

- 一个安装入口可以启动 Main、Renderer 和 Core；
- 用户可以选择本地工作区并创建、关闭、重新打开项目；
- renderer 未启用 Node.js integration；
- renderer 不持有项目绝对路径；
- Application Core 是项目 SQLite 的唯一写入者；
- TTS/ASR/FFmpeg 不运行在 Main 或 Renderer；
- VoxWeaver 不启动、下载、加载或托管 LLM；
- 同一 LLM 端口至少可通过 adapter 连接一个用户管理的本地 Provider 和一个云 Provider；
- renderer 不直接访问 Provider endpoint 或持有 API 密钥；
- remote Provider 调用受项目数据策略约束；
- Python worker 崩溃不会直接关闭窗口或破坏已提交 revision；
- 单个 ScriptUnit 任务可以取消、失败、重试和恢复；
- 任务结果先写 `tmp/`，校验后才提交正式 revision；
- 项目切换后旧请求不能写入新项目；
- 所有跨进程消息有版本和 schema 校验；
- 打包版本通过至少一个目标平台的完整纵向测试；
- 未实现 HTTP 服务时不存在对外监听端口。

## 18. 实施顺序

1. 创建 ADR，确认 Electron、Vue、TypeScript Core、Python worker、LLM 外部 Provider API 和无入站 HTTP MVP；
2. 建立 monorepo 工程、版本策略和包管理器；
3. 建立 contracts、JSON Schema 和 IPC 测试夹具；
4. 实现 Main、Preload 和最小 Renderer；
5. 实现 Core 启动、健康检查和 MessagePort；
6. 实现项目目录、SQLite、锁和恢复；
7. 实现 LLM Provider port、mock、凭据引用和数据策略；
8. 接入一个本地 Provider adapter 和一个云 Provider adapter；
9. 实现一个不依赖语音模型的假 worker 纵向切片；
10. 实现 Python worker 握手、取消和崩溃恢复；
11. 接入一个 TTS 候选和 FFmpeg；
12. 完成打包、签名和目标平台验证；
13. 根据证据将规格更新为 `accepted` 或调整方案。

## 19. 待决策事项

- 首个正式支持的操作系统和 CPU 架构；
- 包管理器、构建器和 Electron 打包工具；
- SQLite Node.js 驱动及 native module 重建策略；
- journal mode、busy timeout、备份和迁移方案；
- Python worker 的打包方式；
- FFmpeg 的分发、许可和升级方式；
- 本地/远程语音模型或混合模式的 MVP 边界；
- 首批 LLM Provider adapter 和各自采用的 native/compatible API dialect；
- LLM 结构化输出的最低能力和允许降级策略；
- remote LLM 的项目级授权、数据最小化和成本提示方式；
- GPU 设备发现、并发和显存回收策略；
- worker NDJSON 的最大消息大小和终止升级时限；
- 自定义资源协议的媒体范围请求实现；
- 应用更新渠道、签名证书和回滚策略；
- 是否在 MVP 后增加 CLI 或 HTTP adapter。

## 20. 权威依据

- Electron 进程模型和 `utilityProcess`：
  <https://www.electronjs.org/docs/latest/tutorial/process-model>
- Electron `utilityProcess` API：
  <https://www.electronjs.org/docs/latest/api/utility-process>
- Electron `contextBridge`：
  <https://www.electronjs.org/docs/latest/api/context-bridge>
- Electron 安全清单：
  <https://www.electronjs.org/docs/latest/tutorial/security>
- Node.js 子进程：
  <https://nodejs.org/api/child_process.html>
- Vue 3 Composition API 与 TypeScript：
  <https://vuejs.org/guide/typescript/composition-api>
- SQLite 事务和单写事务约束：
  <https://www.sqlite.org/lang_transaction.html>
- JSON Schema：
  <https://json-schema.org/specification>
- Electron 代码签名：
  <https://www.electronjs.org/docs/latest/tutorial/code-signing>
- Electron 本地安全存储：
  <https://www.electronjs.org/docs/latest/api/safe-storage>
- LM Studio REST API：
  <https://lmstudio.ai/docs/developer/rest>
- Ollama 原生 API：
  <https://docs.ollama.com/api/introduction>
- Ollama OpenAI-compatible API：
  <https://docs.ollama.com/api/openai-compatibility>
- 可配置 endpoint 的 SSRF 防护：
  <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>

## 21. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| 0.2.0 | 2026-08-08 | 明确所有 LLM 能力只通过外部 Provider API 接入，支持用户管理的本地服务和云厂商官方服务 |
| 0.1.0 | 2026-08-08 | 首版草案：Electron 全桌面交付、Vue/TS Core、Python worker、IPC 和本地目录边界 |
