# VoxWeaver 项目开发要求

文档状态：开工前基线规范  
版本：0.1.0  
日期：2026-08-08  
适用范围：VoxWeaver 的页面、API、后台任务、领域包、项目工作区和所有小说处理阶段。

## 1. 文档定位

本文件定义开始实现前必须统一的工程约束。除明确标为“待决策”的内容外，本文中的要求均视为当前实施基线。

需求优先级如下：

1. 本文件定义跨模块、跨阶段的强制开发要求。
2. `PLAN.md` 定义实施阶段和验收顺序，不得覆盖本文件的工程约束。
3. `docs/adr/` 记录具体技术选型及对本文件的受控修订。
4. `docs/ideas/` 仅记录尚未纳入实施范围的想法，不构成开发承诺。
5. `plan/` 下的模块说明必须遵守本文件，不得自行建立第二套项目状态或文件布局。

本文使用“必须”“不得”“应该”“可以”表达要求等级，其含义分别对应 RFC 2119 的 MUST、MUST NOT、SHOULD、MAY：

https://www.rfc-editor.org/info/rfc2119/

## 2. 已确认的核心决策

以下内容是 VoxWeaver 的内部架构决策，不宣称是所有同类项目的唯一方案。

### 2.1 小说格式解析必须使用端口与适配器

必须将 TXT、Markdown、EPUB 以及后续 DOCX、PDF、HTML 等格式的读取逻辑实现为独立适配器，并统一输出领域模型。后续章节识别、文本校正和剧本生成不得感知输入文件格式。

采用该边界的原因是外部文件格式会变化，而内部处理流程需要稳定输入。端口与适配器架构的原始说明明确由适配器把外部技术相关输入转换为应用可使用的调用或消息：

https://alistair.cockburn.us/hexagonal-architecture

EPUB 本身包含容器、包文档、manifest、spine、导航和内容文档，不能按普通纯文本文件读取；其格式要求以 W3C EPUB 3.3 为准：

https://www.w3.org/TR/epub-33/

### 2.2 一个用户项目必须对应一个独立工作目录

页面进入系统时必须先打开或创建项目。创建项目时必须创建独立目录，项目的源文件、阶段产物、状态库、日志和导出文件均保存在该目录内。

项目显示名称不得直接作为唯一目录标识。物理目录名必须由经过清理的短名称和不可变 `project_id` 共同组成，重命名项目时不得改变 `project_id`。

### 2.3 阶段产物必须分目录，但目录不得充当流程状态

不同处理阶段必须使用不同的产物目录，以便检查、备份、清理和导出。不得通过“文件当前在哪个文件夹”判断处理是否完成，也不得把同一文件从前一阶段移动到后一阶段。

每次处理必须生成不可变的版本化产物；当前版本、依赖关系、审核结果和过期原因由项目状态库管理。文件目录只负责承载内容。

### 2.4 回到前序阶段必须采用增量失效，不得级联删除

用户可以重新打开任意前序阶段并产生新版本。系统必须只将实际依赖旧输入的后续产物标记为 `stale`，不得自动删除、覆盖或强制重新生成旧产物。

系统必须保留产物的来源、处理活动和派生关系。该模型与 W3C PROV 对 entity、activity 和 derivation 的划分一致：

https://www.w3.org/TR/prov-dm/Overview.html

## 3. 总体架构边界

第一阶段假定采用本地优先的单仓库结构；Web 页面通过 API 或本地应用服务操作项目目录，页面代码不得直接读写文件系统。数据库、Web 框架和任务队列的具体产品仍通过 ADR 确定。

假定的开发目录如下：

```text
voxweaver/
├── apps/
│   └── web/                         # 项目选择、编辑、审核和任务页面
├── services/
│   └── api/                         # 用例编排、项目工作区和查询 API
├── workers/
│   ├── text/                        # 导入、标准化、校正、结构分析
│   ├── speech/                      # TTS、ASR、说话人相关任务
│   └── audio/                       # 音频检测、章节合成和导出
├── packages/
│   ├── contracts/                   # DTO、事件和 JSON Schema
│   ├── novel-domain/                # 项目、章节、块、剧本单元等领域模型
│   ├── novel-import/                # 导入端口、适配器注册表和格式适配器
│   │   └── adapters/
│   │       ├── txt/
│   │       ├── markdown/
│   │       └── epub/
│   ├── project-workspace/           # 项目目录创建、打开、锁和迁移
│   ├── workflow-core/               # 产物、依赖图、过期传播和任务状态
│   ├── text-pipeline/                # 标准化、章节、场景和片段处理
│   ├── speaker-analysis/             # 角色和台词归属
│   ├── pronunciation/                # 朗读文本、词典、G2P/TN
│   ├── tts-engine/                   # TTS 端口与适配器
│   ├── asr-engine/                   # ASR 端口与适配器
│   └── audio-processing/             # QA、拼接、响度和导出
├── configs/
│   ├── engines/                      # 引擎配置模板
│   └── policies/                     # 失效、审核、重试和导出策略
├── docs/
│   ├── adr/                          # 经过确认的架构决策
│   ├── ideas/                        # 未确认实施的产品想法
│   └── schemas/                      # 稳定数据格式说明
├── infra/
│   └── docker/
├── tests/
│   ├── fixtures/                     # 可再分发的小型格式夹具
│   ├── contract/                     # 适配器和跨包契约测试
│   ├── integration/
│   └── e2e/
├── DEVELOPMENT_REQUIREMENTS.md
├── README.md
└── PLAN.md
```

依赖方向必须保持为：

```text
apps / services / workers
            ↓
      application use cases
            ↓
novel-domain / workflow-core / ports
            ↑
 format, storage, model and engine adapters
```

领域包不得反向依赖页面、数据库驱动、文件格式库或具体模型 SDK。适配器不得直接修改页面状态。

## 4. 小说导入适配器规范

### 4.1 统一端口

第一版端口至少表达以下能力；实际语言语法由技术栈 ADR 决定：

```ts
interface NovelSourceAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;

  probe(source: SourceAsset): Promise<ProbeResult>;
  validate(source: SourceAsset): Promise<ValidationResult>;
  extract(source: SourceAsset, context: ImportContext): Promise<ImportedNovel>;
}
```

`probe` 必须综合文件签名、容器结构、媒体类型和扩展名，不得只依赖扩展名。`validate` 必须在创建正式导入产物前返回阻断错误和非阻断警告。

### 4.2 适配器职责

格式适配器必须负责：

- 读取对应格式并提取其原生元数据；
- 按源格式定义的阅读顺序提取内容；
- 保留标题、段落、列表、强调、分页等可用结构；
- 为每个块保存可反查源文件的 `source_locator`；
- 返回格式警告、丢失资源和不支持特性；
- 输出统一的 `ImportedNovel`，且不修改源文件。

格式适配器不得负责：

- 错别字校正、文学改写或噪声内容的最终删除；
- 基于小说语义推断角色、场景、情绪或对白归属；
- 生成朗读文本、音素、音频或审核结论；
- 将格式私有字段泄漏到后续通用处理接口。

EPUB 适配器可以把 spine 顺序、导航项和 XHTML 标题作为结构证据，但通用章节识别仍由 `text-pipeline` 完成。

### 4.3 统一导入模型

`ImportedNovel` 至少包含：

```ts
interface ImportedNovel {
  sourceAssetId: string;
  sourceHash: string;
  adapterId: string;
  adapterVersion: string;
  metadata: NovelMetadata;
  orderedBlocks: DocumentBlock[];
  structuralHints: StructuralHint[];
  warnings: ImportWarning[];
}

interface DocumentBlock {
  blockId: string;
  kind: "heading" | "paragraph" | "quote" | "list" | "separator" | "unknown";
  rawText: string;
  sourceLocator: SourceLocator;
  contentHash: string;
}
```

`block_id` 必须在内容未变化时尽可能稳定，不得只使用全文字符偏移作为身份。字符偏移和行号只作为定位信息；段落插入导致偏移变化时，未变化块仍应能够对齐和复用。

### 4.4 适配器注册

第一版必须使用显式内置注册表，避免在核心导入流程中出现格式判断分支。运行时第三方插件发现属于后续能力，不作为第一版要求。

```text
NovelImporter
  └── AdapterRegistry
      ├── TxtAdapter
      ├── MarkdownAdapter
      └── EpubAdapter
```

同一输入若有多个适配器声称支持，注册表必须根据 `probe` 置信度和固定优先级选择，并记录选择原因；无法可靠判断时必须要求人工选择，不得静默猜测。

### 4.5 契约测试

每个适配器必须通过同一套契约测试：

- 不修改源资产；
- 相同输入和适配器版本产生相同结构结果；
- 块顺序稳定且每个块都有来源定位；
- 错误输入返回结构化错误，不产生半成品正式版本；
- 元数据缺失、空章节、非法编码和破损容器有明确行为；
- 导入结果可通过统一 JSON Schema 校验。

跨模块 JSON 数据必须锁定 JSON Schema 方言并在 schema 中声明 `$schema`。第一版采用 Draft 2020-12：

https://json-schema.org/specification

## 5. 项目选择与创建规范

### 5.1 页面入口

页面必须提供以下入口状态：

```text
启动
  ├── 有可恢复且可访问的最近项目 → 询问或按用户设置恢复
  └── 无有效当前项目           → 项目选择页

项目选择页
  ├── 新建项目
  ├── 打开已有项目目录
  └── 最近项目
```

没有有效项目上下文时，任何小说处理页面都不得开始任务。页面头部必须显示当前项目，必须提供显式切换和关闭项目的入口。

### 5.2 新建项目

新建项目至少收集：

- 项目显示名称；
- 工作区父目录；
- 可选描述和语言；
- 可选首个小说文件，未提供时允许创建空项目。

创建流程必须由 `project-workspace` 用例完成：

1. 规范化并校验父目录；
2. 生成不可变 `project_id` 和安全目录名；
3. 在同一父目录下创建临时目录；
4. 写入项目 manifest、状态库和完整目录骨架；
5. 校验项目可重新打开；
6. 原子切换为正式目录名；
7. 写入最近项目列表并进入项目首页。

创建失败时只能清理本次创建的临时目录，不得删除用户预先存在的目录或文件。目标目录已存在时必须停止并要求用户选择，不得合并或覆盖。

### 5.3 打开项目

打开目录时必须校验：

- manifest 存在且 schema 版本受支持；
- `project_id` 合法且与状态库一致；
- 目录具有所需读取权限；需要编辑时还必须具有写权限；
- 存储布局迁移可执行或项目以只读方式打开；
- 不存在未处理的损坏状态或不兼容锁。

项目路径只能由工作区服务解析。所有阶段相对路径必须在解析符号链接和规范化后仍位于项目根目录内，以阻止通过 `..` 或绝对路径越界。路径遍历风险和常见形式参见 OWASP：

https://owasp.org/www-community/attacks/Path_Traversal

### 5.4 并发写入

同一项目必须只有一个逻辑写入者。多窗口或多进程打开时，后打开者必须只读或明确接管锁；接管前必须确认旧写入者已失效。任何一次“新版本落盘 + 依赖更新 + 过期标记”必须处于同一事务边界。

第一版本地状态库可以使用 SQLite，但需要单独 ADR 确认。SQLite 允许多个读取事务但同一时刻只允许一个写事务，其事务行为以官方说明为准：

https://sqlite.org/lang_transaction.html

## 6. 单项目小说处理目录

假定用户选择的工作区为 `<workspace-root>`，项目目录结构如下：

```text
<workspace-root>/
└── projects/
    └── <safe-slug>--<project-id>/
        ├── project.json                       # 小型、可读的项目 manifest
        ├── state/
        │   ├── project.sqlite                 # 索引、依赖、任务、审核和迁移
        │   ├── backups/                       # 状态库受控备份
        │   └── locks/                         # 项目写锁信息
        ├── inputs/
        │   ├── novels/
        │   │   └── <source-asset-id>/
        │   │       ├── original.<ext>         # 导入的不可变源文件
        │   │       └── asset.json             # 来源、授权、哈希和导入信息
        │   ├── voice-sources/                 # 已登记的候选音色源
        │   └── artwork/                       # 封面等项目素材
        ├── artifacts/
        │   ├── imported/
        │   │   └── <revision-id>/             # 适配器统一输出
        │   ├── canonical/
        │   │   └── <revision-id>/             # 确定性基础标准化
        │   ├── corrected/
        │   │   └── <revision-id>/             # 校正文和修改记录
        │   ├── structure/
        │   │   └── <revision-id>/             # 卷/章/场景/片段结构
        │   ├── knowledge/
        │   │   └── <revision-id>/             # 人物、实体、别名和时间线
        │   ├── scripts/
        │   │   └── <revision-id>/             # 结构化剧本单元
        │   ├── spoken/
        │   │   └── <revision-id>/             # 朗读文本和发音结果
        │   ├── voice-profiles/
        │   │   └── <revision-id>/             # 音色档案与配置快照
        │   ├── renders/
        │   │   └── <render-set-id>/
        │   │       └── segments/              # 按 script unit 生成的音频
        │   ├── qa/
        │   │   └── <revision-id>/             # ASR、音频指标和人工审核
        │   └── assemblies/
        │       └── <revision-id>/             # 章节音频和时间轴
        ├── exports/
        │   └── <export-id>/                    # M4B/MP3/工程导出快照
        ├── cache/                              # 可重建缓存，不是真值
        ├── logs/                               # 结构化运行日志
        └── tmp/                                # 可恢复任务的临时文件
```

目录规则：

- `inputs/` 中的已登记源资产必须不可变；替换小说内容必须创建新的源资产版本。
- `artifacts/<stage>/<revision-id>/` 必须不可变；编辑操作产生新 revision。
- 每个 revision 目录必须有 manifest，记录输入、输出、处理器版本、参数和哈希。
- `cache/` 和 `tmp/` 可以清理，但清理不得破坏已提交的产物和状态库。
- `exports/` 是发布快照，不得作为后续处理输入的唯一来源。
- 不得把用户项目数据写入仓库根目录的 `data/`；仓库 `data/` 只保留开发夹具或迁移前兼容用途，正式实现后应通过 ADR 清理其职责。

`project.json` 最少包含：

```json
{
  "schemaVersion": "1.0.0",
  "layoutVersion": "1",
  "projectId": "immutable-project-id",
  "displayName": "项目显示名称",
  "createdAt": "2026-08-08T00:00:00Z",
  "updatedAt": "2026-08-08T00:00:00Z"
}
```

时间字段必须使用带时区的 RFC 3339 格式，持久化默认使用 UTC，页面再转换为本地显示时间：

https://www.rfc-editor.org/info/rfc3339/

## 7. 产物、依赖与状态模型

### 7.1 三类状态必须分离

不得用单一 `status` 同时表达执行、有效性和审核结果。每个产物至少具有三个相互独立的状态轴：

```text
execution_status: pending | running | succeeded | failed | canceled
validity_status:  current | stale | superseded | missing
review_status:    not_required | pending | approved | rejected
```

- `succeeded + stale + approved` 是合法组合，表示产物曾成功并获审核，但其当前依赖已经变化。
- `superseded` 表示同一产物谱系已有新的活动版本，不等于文件应删除。
- `missing` 表示状态库记录存在但物理文件丢失，需要恢复或重建。

### 7.2 不可变产物记录

每个正式产物必须记录：

```ts
interface ArtifactRecord {
  artifactId: string;
  artifactType: string;
  lineageId: string;
  revisionId: string;
  scope: ArtifactScope;
  contentHash: string;
  inputFingerprint: string;
  processorId: string;
  processorVersion: string;
  parametersHash: string;
  executionStatus: string;
  validityStatus: string;
  reviewStatus: string;
  createdAt: string;
  createdBy: string;
}
```

内容哈希第一版统一采用 SHA-256；NIST FIPS 180-4 定义了 SHA-2 系列，并说明摘要可用于检测消息是否发生变化：

https://csrc.nist.gov/pubs/fips/180-4/upd1/final

哈希只能证明内容是否一致，不能替代 `artifact_id`、来源信息、授权记录或人工审核。

### 7.3 依赖边

所有衍生产物必须显式记录依赖边：

```ts
interface ArtifactDependency {
  consumerArtifactId: string;
  producerArtifactId: string;
  dependencyType: "content" | "structure" | "voice" | "pronunciation" | "config";
  selector?: {
    chapterIds?: string[];
    blockIds?: string[];
    scriptUnitIds?: string[];
    voiceProfileIds?: string[];
    dictionaryEntryIds?: string[];
  };
}
```

依赖不得只记录到“整本书”或“整个章节”，能够定位到块、剧本单元、词条或音色档案时必须使用最小稳定范围。粒度过粗会导致不必要的失效，粒度过细但身份不稳定会造成错误复用，两者都必须通过测试约束。

### 7.4 输入指纹

`input_fingerprint` 必须由以下内容的规范化表示计算：

- 所有直接依赖的 `artifact_id`、`content_hash` 和必要 selector；
- 处理参数；
- 影响输出兼容性的处理器版本；
- 使用的模型、词典、音色和规则版本。

只有历史产物的输入指纹与当前解析出的输入指纹完全一致时，系统才可以将它复用为 `current`。用户把内容改动后又恢复到完全相同的版本时，允许直接复用匹配的历史产物，不要求重新生成。

## 8. 增量过期传播

### 8.1 处理流程

用户在前序阶段确认新版本时，系统必须执行：

1. 保存新版本，不覆盖旧版本；
2. 比较稳定单元的内容和语义字段，计算真实变更集合；
3. 根据依赖边查找直接和间接消费者；
4. 在提交前向用户显示预计影响范围；
5. 在同一事务中切换活动版本并写入 `stale` 原因；
6. 保留旧文件和审核记录；
7. 按用户选择排队重处理，默认不得强制立即执行；
8. 新产物成功后重新计算依赖指纹并刷新有效性。

每条过期记录至少包含：

```ts
interface StaleCause {
  artifactId: string;
  causeArtifactId: string;
  causeRevisionId: string;
  reasonCode: string;
  detectedAt: string;
  affectedSelector?: object;
  resolution: "pending" | "regenerated" | "reused" | "waived";
}
```

一个产物可能同时存在多个未解决的过期原因。解决其中一个原因不得错误清除其他原因。

### 8.2 影响规则

| 变更 | 必须标记过期 | 不应标记过期 |
|---|---|---|
| 音色档案或微调版本被设为活动版本 | 引用该音色版本的片段音频、对应 QA、章节合成、相关导出 | 小说原文、校正文、剧本内容、未引用该音色的片段 |
| 某章节内容被修改 | 与变化块相交的结构、剧本、朗读文本、片段音频、QA；包含这些片段的章节合成和导出 | 其他可稳定对齐且依赖未变化的章节或片段 |
| 某剧本单元的说话人、情绪或声音状态变化 | 该单元片段音频、QA、章节合成、相关导出 | 原文、校正文、其他剧本单元 |
| 某剧本单元仅修改审核备注 | 仅备注索引或审核视图 | 音频和导出产物 |
| 发音词典条目变化 | 实际命中该词条的朗读/发音产物、片段音频、QA、章节合成、相关导出 | 未命中词条的片段、剧本角色信息 |
| TTS 引擎或参数配置的新版本被激活 | 使用该配置的片段音频及其消费者 | 其他引擎或未使用该配置的片段 |
| 章节顺序变化 | 全书装配、目录、时间轴和最终导出 | 未发生内容变化的章节音频 |
| 封面或作品元数据变化 | 依赖该字段的最终导出 | 剧本、片段音频、章节音频 |

“改了配置文件”本身不得触发全项目失效。只有配置的新版本被激活并且某产物确实依赖相关字段时，才传播过期状态。

### 8.3 旧产物的使用规则

- `stale` 产物必须继续可试听、比较、下载和查看来源，但页面必须显著显示过期原因。
- 普通预览允许混用当前和过期产物，但必须展示状态汇总。
- 创建“当前正式导出”时不得静默包含过期产物。
- 如业务允许带过期项导出，必须由用户显式确认，生成独立快照并记录 `waived` 原因；不得把原产物直接改回 `current`。
- 删除旧产物只能通过独立清理流程执行，且必须先确认没有项目版本、审核记录或导出快照引用它。

## 9. 前序阶段重开交互

系统不得提供含糊的“回滚整个工程”操作。统一使用“打开前序阶段并创建新版本”：

```text
查看前序版本
  ↓
基于当前或历史版本创建草稿
  ↓
编辑并校验
  ↓
预览后续影响
  ↓
确认设为活动版本
  ↓
相关后续产物变为 stale
  ↓
用户选择立即重处理、稍后处理或保留比较
```

确认前必须显示：

- 变化的章节、块、剧本单元、词条或音色档案数量；
- 将被标记过期的片段音频、章节合成和导出数量；
- 预计需要重新执行的任务；
- 不受影响且可直接复用的产物数量。

若影响分析失败，系统不得提交活动版本切换；不得用“全量过期”静默掩盖分析错误。用户明确选择全量重处理时除外。

## 10. 任务、事务与恢复

### 10.1 幂等任务

任务唯一键必须包含：

```text
project_id + processor_id + input_fingerprint + output_scope
```

重复投递相同任务时必须复用正在运行或已经成功的相同结果，不得产生互相覆盖的正式产物。

### 10.2 两阶段落盘

后台任务必须先写入 `tmp/`，完成内容哈希和格式校验后再提交到正式 revision 目录。状态库只有在正式目录可读后才能把任务标记为 `succeeded`。

状态变更必须使用事务。若选择 SQLite，其原子提交能力和故障条件以官方文档为准：

https://www2.sqlite.org/atomiccommit.html

### 10.3 中断恢复

应用重启后必须能够区分：

- 可继续的任务；
- 需要安全重试的任务；
- 已落盘但状态未提交的孤立临时产物；
- 状态记录存在但文件缺失的产物。

恢复流程不得自动把未知完整性的临时文件登记为正式产物。

## 11. 页面开发要求

### 11.1 路由和上下文

- `/projects`：选择、创建、打开和移除最近项目记录；
- `/projects/:projectId`：项目概览；
- 所有处理页面必须位于项目上下文下；
- URL 中的 `projectId` 只用于查找已打开项目，不得转换为磁盘路径；
- 切换项目时必须取消或隔离前一个项目的页面请求，防止旧响应写入新项目状态。

### 11.2 通用状态展示

每个阶段页面必须分别展示：

- 执行进度；
- 当前/过期/缺失的有效性统计；
- 待审/通过/拒绝的审核统计；
- 活动版本和可比较的历史版本；
- 过期原因和影响范围；
- 可执行的最小重处理动作。

不得用单个“已完成”标签掩盖部分片段已经过期的情况。

### 11.3 写操作

所有页面写操作必须通过用例 API，至少携带：

- `project_id`；
- 当前基线 revision 或乐观锁版本；
- 用户编辑内容；
- 预期影响范围或影响预览 token。

基线版本已经变化时必须拒绝盲写并要求重新加载差异，不得最后写入者静默覆盖。

## 12. 数据契约与迁移

- 跨进程 DTO、revision manifest 和工程导出清单必须有版本化 JSON Schema。
- 项目 manifest、目录布局和状态库 schema 必须分别拥有版本号，不得共用一个模糊版本。
- 破坏性变更必须提供向前迁移和迁移前备份；不支持降级时必须明确阻止旧版本应用写入。
- 未知字段在兼容读取时应该保留；未知枚举值不得被静默替换为默认值。
- 状态库是索引和工作流真值，文件是内容真值；两者不一致时必须进入恢复流程，不能任选一方静默覆盖另一方。

## 13. 日志、隐私与授权

- 日志必须包含 `project_id`、`task_id`、`artifact_id`、`processor_id` 和错误码。
- 默认日志不得记录完整小说段落、声音样本、密钥或模型服务凭据。
- 项目目录、导出包和备份必须保留素材来源及授权状态。
- 未通过授权校验的小说、音色或模型不得进入生产生成和正式导出。
- 最近项目列表只保存项目标识、显示名称和用户授权访问的路径，不得复制项目内容。

## 14. 最低测试要求

开始功能开发后，以下测试属于必需项：

### 14.1 单元与契约测试

- TXT、Markdown、EPUB 适配器统一契约；
- 内容哈希和输入指纹稳定性；
- 块对齐、最小差异和依赖 selector；
- 多个过期原因的添加、部分解决和完全解决；
- 历史产物在输入恢复一致后的安全复用；
- 路径规范化、越界路径和符号链接边界。

### 14.2 集成测试

- 新建项目成功、失败清理、同名目录冲突和重新打开；
- 项目状态事务与正式文件提交的一致性；
- worker 中断、重复投递和应用重启恢复；
- schema 和目录布局迁移；
- 只读打开及写锁冲突。

### 14.3 增量失效测试

至少覆盖：

1. 微调一个角色音色，只使引用它的音频及后续消费者过期；
2. 修改一章中的一个块，只使相交剧本单元和后续消费者过期；
3. 只改审核备注，不使音频过期；
4. 修改一个发音词条，只影响实际命中的片段；
5. 调整章节顺序，只使装配和最终导出过期；
6. 内容修改后恢复原值，命中相同输入指纹并复用历史产物；
7. 同一产物存在两个过期原因时，解决一个原因不会错误恢复为 `current`。

### 14.4 端到端测试

- 首次进入显示项目选择页；
- 新建项目后生成完整目录并进入项目概览；
- 打开已有项目并恢复活动版本；
- 切换项目不会串用请求、任务或页面状态；
- 前序编辑显示影响预览，确认后旧产物保留且正确标记过期；
- 正式导出阻止静默包含过期产物。

## 15. 开工前完成条件

开始业务功能实现前必须完成：

- [ ] 确认本文件并分配维护责任人；
- [ ] 创建项目 manifest、artifact、dependency、stale cause 的 JSON Schema；
- [ ] 通过 ADR 确定语言版本、包管理器、Web/API 边界和本地状态库；
- [ ] 通过 ADR 确定 `project_id`、`revision_id`、`block_id` 和 `script_unit_id` 生成规则；
- [ ] 创建 TXT、Markdown、EPUB 的最小合法与损坏测试夹具；
- [ ] 固化适配器契约测试；
- [ ] 固化增量失效矩阵测试；
- [ ] 确认项目目录迁移、备份、锁和恢复策略；
- [ ] 确认过期产物的正式导出策略；
- [ ] 确认哪些字段变化属于内容、结构、声音、发音或配置依赖。

## 16. 待决策事项

以下事项尚未由本文件直接选定，实施前必须形成 ADR：

- Web 页面运行在浏览器、本地桌面壳还是两者兼容；
- API 与 worker 的语言和版本；
- SQLite 是否作为第一版本地状态库，以及未来服务端存储的替换边界；
- 项目目录由应用统一管理，还是允许用户直接选择任意已有目录；
- 源小说默认复制进项目，还是支持受控外部链接；
- 是否允许带过期产物的人工豁免导出；
- 历史产物保留周期、配额和可恢复清理机制；
- EPUB 2、EPUB 3 固定版式和受 DRM 保护输入的支持边界；
- PDF/OCR 导入是正式适配器还是外部预处理流程。

