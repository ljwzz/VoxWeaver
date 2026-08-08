# VoxWeaver（声织）

VoxWeaver 是面向长篇小说和其他叙事文本的 Electron 桌面端多角色有声内容生产工程。系统围绕可追踪文本、结构化剧本、角色与音色、中文发音、片段生成、自动 QA、人工审核、章节装配、同步阅读和工程导出构建，不开发独立网页端。

## 当前状态

- 当前仓库已完成产品计划、阶段计划和 Monorepo 工具链基线；
- M0 项目基础设施已完成并验证：项目目录、读写会话、状态库、核心记录、Task/StageRun、产物版本、依赖、增量过期和恢复端口可运行；
- 阶段 00 仍需交付 Electron 项目页、最近项目入口和 Main/Preload/Renderer/Core 跨进程基础传输与接线；阶段 01～11 仍为 `unverified`；
- 文档、目录或静态检查通过不代表产品功能已经实现；
- 若早期实现位于其他目录或分支，必须先按阶段执行实现和数据迁移审计。

## 文档入口

| 文档 | 作用 |
|---|---|
| [项目计划.md](./项目计划.md) | 产品目标、范围、MVP、阶段顺序和长期方向的唯一主文档 |
| [docs/README.md](./docs/README.md) | 正式规格统一入口，包含架构、阶段、里程碑和机器契约 |
| [docs/spec/00.项目基线与工程工作区.md](./docs/spec/00.项目基线与工程工作区.md) | 开始业务实现前必须完成的项目、状态、产物和增量过期基线 |
| [docs/spec/90.MVP联调与验收.md](./docs/spec/90.MVP联调与验收.md) | M0～M8 的端到端样章验收 |
| [docs/ideas/](./docs/ideas/) | 尚未纳入正式实施范围的产品想法 |
| [docs/adr/](./docs/adr/) | 已确认的技术选型和架构决策 |
| [docs/schemas/](./docs/schemas/) | JSON Schema、工程包和跨模块契约 |

## 核心流程

```mermaid
flowchart LR
    A["项目创建"] --> B["小说导入与预处理"]
    B --> C["文本校对"]
    C --> D["小说剧本化"]
    D --> E["角色注册表"]
    E --> F["音色与发音"]
    F --> G["ScriptUnit 级 TTS"]
    G --> H["音频 QA"]
    H --> I["章节合成"]
    I --> J["同步阅读"]
    J --> K["工程与成品导出"]
```

## 核心原则

- 原始文件不可覆盖；
- source_asset、extracted/raw、canonical、normalized、corrected、script、spoken 分层管理；
- 格式、外部 LLM/TTS/ASR 等 Provider API 和音频后端通过端口与适配器接入；
- ScriptUnit 是最小剧本、审核和音频生成单元；
- 每个正式产物保存输入、处理器、参数、版本、哈希和审核信息；
- 前序变化只使实际依赖的后续产物过期，旧产物保留；
- AI 输出结构化候选，低置信度和高风险结论进入人工审核；
- 未确认授权的小说、声音、模型和素材不得进入正式生产和发布。

## 开发入口

先阅读 [docs/README.md](./docs/README.md)。安装依赖后运行完整校验：

```bash
pnpm install
pnpm run check
```

阶段 00 的桌面入口、最近项目切片及 Main/Preload/Renderer/Core 跨进程基础传输与接线完成前不开始阶段 01。
