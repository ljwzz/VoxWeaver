# VoxWeaver 人工决策待办

状态：`policy_choices_confirmed`
用途：集中保存所有会阻塞无人值守实施的人工决策与执行输入
规格入口：[docs/README.md](./docs/README.md)

批量确认记录：`decision-baseline-2026-08-08`

- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08
- 确认范围：本文件中当前唯一勾选的候选方案；未勾选候选不再是当前实施分支。`TODO-M1-06` 的方案 A 由项目负责人于 2026-08-09 追加确认；EPUB 的 `not_applicable` 仍由已关闭的 TODO-M1-05/M1-D04 派生，不是 TODO-M1-06 的候选。
- 边界：批量确认只冻结产品策略。`需填写`、accepted ADR、Provider/runtime profile、版本、阈值、授权夹具和 live 命令仍是 Gate 的执行就绪证据，不得由执行模型猜测。

## 使用规则

每项决策按以下方式填写：

1. 每项只勾选一个候选；已有唯一勾选候选由 `decision-baseline-2026-08-08` 或 TODO 内明确记录的追加确认冻结；
2. 每项父级“已确认”表示该 TODO 的全部 Gate 关闭材料已齐，不只表示候选已选；
3. 勾选父级“已确认”前必须填写“决定、决定人、日期”和全部 `需填写` 字段；
4. 标记“需要 ADR”的项目必须补充 accepted ADR 路径；
5. 若没有合适候选，在“决定”中写自定义方案和约束，不要同时勾选现有候选；
6. 候选已确认但执行输入未齐时，对应规格必须写明“已确认策略”和剩余关闭证据，Gate 保持 `open`。

`decision-baseline-2026-08-08` 之前的“推荐”只是计划建议；该批次中实际勾选的唯一候选现已成为批准策略。零个或多个候选被勾选时，对应 Gate 仍保持 open。

## A. 跨里程碑架构

<a id="todo-arch-01"></a>

### TODO-ARCH-01：首个正式支持的 OS 与 CPU

- [ ] 已确认
  - [x] A（推荐）：只选当前可完成完整打包、签名和交互回归的一组 OS/CPU
  - [ ] B：同时支持 macOS arm64 与 Windows x64
  - [ ] C：仅生成开发构建，暂不声明正式支持平台
- 决定：
- 决定人：
- 日期：
- 需填写：目标 OS、最低版本、CPU、安装包格式

<a id="todo-arch-02"></a>

### TODO-ARCH-02：Electron 打包、签名与更新工具链

- [ ] 已确认
  - [x] A（推荐）：先冻结单一打包工具；签名和自动更新分别在取得证书/发布主体后启用
  - [ ] B：首版同时完成打包、签名、自动更新和回滚
  - [ ] C：只保留开发运行，不生成安装包
- 决定：
- 决定人：
- 日期：
- ADR：必填
- 需填写：打包工具、Electron/Chromium/内置 Node 精确版本、签名主体、证书来源、更新渠道、回滚策略；明确 ADR 0002 的 Node.js `24.19.x` 是唯一支持范围还是验证基线，并据此收窄根 `engines` 或先接受修订/取代 ADR；打包后 Core 的 `process.versions.node` 证据，以及 `node:sqlite` `DatabaseSync`/`backup()`/已用连接选项与生效 ADR 兼容的可复制验证命令和判定

<a id="todo-arch-03"></a>

### TODO-ARCH-03：历史产物配额与可恢复清理

- [ ] 已确认
  - [x] A（推荐）：按项目设置软配额和全局磁盘保护线；只清理无引用缓存/临时文件，正式 revision 需显式归档或删除确认
  - [ ] B：固定保留最近 N 个 revision，自动删除更早版本
  - [ ] C：不设配额且永不清理
- 决定：
- 决定人：
- 日期：
- 需填写：软配额、全局保护线、可清理类别、保留期和恢复窗口

## B. M1 小说导入

<a id="todo-m1-01"></a>

### TODO-M1-01：Scene 与 ProcessingSegment 归属

- [x] 已确认
  - [ ] A：Scene/ProcessingSegment 纳入 M1 验收
  - [x] B（推荐）：M1 只交付 Chapter；Scene/ProcessingSegment 由 M2 首个桥接切片完成
- 决定：采用方案 B；M1 只交付 Chapter，Scene/ProcessingSegment 由 M2 桥接切片交付。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

<a id="todo-m1-02"></a>

### TODO-M1-02：TXT 编码识别策略

- [ ] 已确认
  - [x] A（推荐）：BOM/严格 UTF-8 自动确认，其他编码必须人工选择
  - [ ] B：编码检测器达到版本化阈值后自动确认
  - [ ] C：MVP 只支持 UTF-8
- 决定：
- 决定人：
- 日期：
- 需填写：允许的编码标签、非法字节行为、检测依赖和版本

<a id="todo-m1-03"></a>

### TODO-M1-03：文本 offset 单位与 SourceLocator

- [ ] 已确认
  - [ ] A（推荐）：文本范围使用 UTF-16 code unit；SourceLocator 另存 byte/line/EPUB locator，字段显式带 offsetUnit
  - [ ] B：文本范围使用 Unicode code point
  - [x] C：所有文本范围使用 UTF-8 byte
- 决定：
- 决定人：
- 日期：

<a id="todo-m1-04"></a>

### TODO-M1-04：Block、Chapter 和 Scene 稳定 ID

- [ ] 已确认
  - [x] A（推荐）：首次生成持久化 opaque ID；重导入按 locator、内容 hash 与邻接锚点对齐，歧义进入 review
  - [ ] B：ID 直接由内容 hash 派生
  - [ ] C：ID 直接由 offset/order 派生
- 决定：
- 决定人：
- 日期：

<a id="todo-m1-05"></a>

### TODO-M1-05：EPUB 支持边界与解析依赖

- [x] 已确认
  - [ ] A（推荐）：支持 EPUB 2/3 reflow；fixed-layout 明确 unsupported；使用有预算限制的 ZIP 与禁用外部实体/DTD 的 XML/XHTML 解析器
  - [ ] B：同时完整支持 reflow 与 fixed-layout
  - [x] C：MVP 暂缓 EPUB
- 决定：采用方案 C；EPUB 不纳入 MVP M1，保留为阶段 01 后续能力。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08
- ADR：`not_applicable`（本轮不新增 EPUB 依赖）
- 需填写：`not_applicable`（重新启用 EPUB 时另开决策批次填写）

<a id="todo-m1-06"></a>

### TODO-M1-06：TXT 资源预算

- [ ] 已确认
  - [x] A（推荐）：项目可配置阈值，同时设置不可绕过的全局 ceiling
  - [ ] B：使用固定硬上限
  - [ ] C：不设上限
- 派生说明：EPUB 已由 TODO-M1-05/M1-D04 排除，预算为 `not_applicable`；该结论不参与本 TODO 的 A/B/C 候选计数。
- 决定：采用方案 A；TXT 使用项目可配置阈值，并为每项资源设置不可绕过的全局 ceiling。具体数值仍须由目标样本和批准运行环境的基准补齐。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-09
- 需填写：项目默认值/允许配置范围及对应全局 ceiling，覆盖输入大小、内存、临时磁盘、块数、单块长度、任务时限、取消检查点和恢复边界；同时填写越限错误、配置校验和基准证据路径

<a id="todo-m1-07"></a>

### TODO-M1-07：Markdown 与内嵌 HTML 范围

- [x] 已确认
  - [x] A（推荐）：不阻塞 M1，作为阶段 01 后续补充
  - [ ] B：纳入 M1 验收
  - [ ] C：从阶段 01 正式范围移除
- 决定：采用方案 A；不阻塞 M1，作为阶段 01 后续补充。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

<a id="todo-m1-08"></a>

### TODO-M1-08：章节/噪声 Golden Dataset

- [ ] 已确认
  - [x] A（推荐）：可再分发固定夹具入库，私有真实样章只保存 hash/评估结果
  - [ ] B：只使用可再分发合成夹具
  - [ ] C：只使用私有真实书样本
- 决定：
- 决定人：
- 日期：
- 需填写：私有样章位置、授权证明和基准负责人

<a id="todo-m1-09"></a>

### TODO-M1-09：源文件复制与外部链接

- [x] 已确认
  - [x] A（推荐）：MVP 默认复制到项目 inputs，禁止外部链接
  - [ ] B：默认复制，允许显式只读外部链接并记录可用性
  - [ ] C：默认引用原路径
- 决定：采用方案 A；默认复制到项目 `inputs/`，MVP 禁止外部链接。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

## C. M2 文本 AI 处理

<a id="todo-m2-01"></a>

### TODO-M2-01：EvidenceRef 与 StoryRange

- [ ] 已确认
  - [x] A（推荐）：EvidenceRef 使用 revision+block+半开 range；StoryRange 使用稳定 chapter/scene/script 端点
  - [ ] B：只保存字符范围
  - [ ] C：允许自由 JSON 引用
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-02"></a>

### TODO-M2-02：ScriptUnit 可逆拼接

- [ ] 已确认
  - [x] A（推荐）：保存覆盖 corrected 的连续 source slices，间隔也是显式切片
  - [ ] B：每个 ScriptUnit 保存显式 separator
  - [ ] C：由 UI 临时推断间隔
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-03"></a>

### TODO-M2-03：ScriptUnit 稳定 ID

- [ ] 已确认
  - [x] A（推荐）：opaque ID + source slice/context anchor 重对齐；split/merge 新建 ID 并保留历史映射
  - [ ] B：order/text 派生 ID
  - [ ] C：每次重建全部生成新 ID
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-04"></a>

### TODO-M2-04：情绪、状态与控制字段

- [ ] 已确认
  - [x] A（推荐）：核心枚举加扩展标签；pause/rate/gain 使用显式单位，缺省表示继承
  - [ ] B：全部固定枚举
  - [ ] C：全部自由标签
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-05"></a>

### TODO-M2-05：首个 LLM Provider、dialect 与数据策略

- [ ] 已确认
  - [x] A（推荐）：选择一个具有官方 native 结构化输出 API 的 Provider
  - [ ] B：选择一个 compatible dialect Provider
  - [ ] C：仅 Mock；不关闭 live 门禁
- 决定：
- 决定人：
- 日期：
- ADR：必填
- 需填写：Provider、endpoint、dialect/version、model、approved runtime profile ID、区域、凭据注入边界、数据保留、成本提示、授权 live 夹具 ID/hash、可复制 smoke 命令、成功/失败判定、证据路径、执行环境和负责人
- 未批准候选池：[语音模型与 Provider API 候选备忘](./docs/ideas/speech-model-and-provider-candidates.md)

<a id="todo-m2-06"></a>

### TODO-M2-06：LLM 请求模式

- [ ] 已确认
  - [x] A（推荐）：文本切片首版使用同步请求；流式只提供进度；Provider 强制时才使用异步 job
  - [ ] B：所有操作使用流式
  - [ ] C：所有操作使用异步 job
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-07"></a>

### TODO-M2-07：结构化输出降级

- [ ] 已确认
  - [x] A（推荐）：native schema 优先，JSON mode + 本地 schema 为唯一降级
  - [ ] B：只允许 native schema，不降级
  - [ ] C：允许 prompt-only JSON 进入正式产物
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-08"></a>

### TODO-M2-08：AI 校对应用策略

- [ ] 已确认
  - [ ] A（推荐）：SAFE 只允许人工批量；REVIEW/DANGEROUS 单条处理；默认不自动应用 AI proposal
  - [x] B：SAFE 自动应用
  - [ ] C：所有 proposal 都必须单条处理
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-09"></a>

### TODO-M2-09：校对冲突与人工编辑

- [ ] 已确认
  - [x] A（推荐）：baseline hash 乐观冲突 + 显式 edit record
  - [ ] B：last-write-wins
  - [ ] C：MVP 实现多人 CRDT
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-10"></a>

### TODO-M2-10：实体知识库写权限

- [ ] 已确认
  - [x] A（推荐）：阶段 02 只产候选，阶段 04 写正式 Registry
  - [ ] B：阶段 02 直接写正式实体
  - [ ] C：阶段 02、04 双向写正式数据
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-11"></a>

### TODO-M2-11：Character ID 与历史模型

- [ ] 已确认
  - [x] A（推荐）：opaque stable ID + append-only merge/split/rename/lock events
  - [ ] B：名称或顺序派生 ID
  - [ ] C：合并时重写全部旧引用
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-12"></a>

### TODO-M2-12：Alias 范围

- [ ] 已确认
  - [x] A（推荐）：支持全书、Chapter、Scene StoryRange；常见称谓全书范围必须人工确认
  - [ ] B：只支持全书和 Chapter
  - [ ] C：只支持全书
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-13"></a>

### TODO-M2-13：CharacterStage 冲突

- [ ] 已确认
  - [x] A（推荐）：同角色正式 Stage 不得重叠，冲突进入 review，人工锁定优先
  - [ ] B：允许重叠并按显式优先级解析
  - [ ] C：last-write-wins
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-14"></a>

### TODO-M2-14：角色重要度写权限

- [ ] 已确认
  - [x] A（推荐）：人工写正式值，规则/模型只产生候选
  - [ ] B：规则/模型直接写正式值
  - [ ] C：纯人工且不产生候选
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-15"></a>

### TODO-M2-15：角色变化 stale selector

- [ ] 已确认
  - [x] A（推荐）：提交前展开为明确 scriptUnitIds
  - [ ] B：扩展共享 ArtifactSelector 的 character/alias/stage 字段
- 决定：
- 决定人：
- 日期：

<a id="todo-m2-16"></a>

### TODO-M2-16：说话人低置信度

- [ ] 已确认
  - [x] A（推荐）：版本化阈值，低于阈值保持 unknown 并进入 review；数值由样章校准
  - [ ] B：固定阈值后自动指派
  - [ ] C：全部人工指派
- 决定：
- 决定人：
- 日期：
- 需填写：校准样章、阈值 profile 和抽检比例

<a id="todo-m2-17"></a>

### TODO-M2-17：两遍剧本处理器

- [x] 已确认
  - [x] A（推荐）：独立 operation/prompt，可配置使用同一或不同模型
  - [ ] B：固定使用同一 prompt 和模型
  - [ ] C：固定使用不同模型
- 决定：采用方案 A；使用独立 operation/prompt，并允许配置同一或不同模型。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

<a id="todo-m2-18"></a>

### TODO-M2-18：复杂引号与转述类型

- [x] 已确认
  - [x] A（推荐）：MVP 保持 quotation/unknown，细节进入 evidence/tag
  - [ ] B：扩大 ScriptUnit type 枚举
- 决定：采用方案 A；MVP 保持 `quotation/unknown`，细节进入 evidence/tag。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

<a id="todo-m2-19"></a>

### TODO-M2-19：Scene 调整与剧本编辑权限

- [x] 已确认
  - [x] A（推荐）：Scene 调整生成上游结构 revision；剧本页只提交变更请求
  - [ ] B：剧本页直接修改 Scene
  - [ ] C：Scene 生成后禁止调整
- 决定：采用方案 A；Scene 调整生成上游结构 revision，剧本页只提交变更请求。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

<a id="todo-m2-20"></a>

### TODO-M2-20：docs/ideas 能力是否纳入

- [x] 已确认
  - [x] A（推荐）：当前全部不纳入；逐项批准并先修改上位计划后再实施
  - [ ] B：把选定想法直接并入 M2
- 决定：采用方案 A；当前 `docs/ideas/` 全部不纳入正式范围。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08
- 需填写：`not_applicable`（方案 B 未选）

## D. M3 角色系统

<a id="todo-m3-01"></a>

### TODO-M3-01：CharacterStage 与 VoiceProfile 解析语义

- [ ] 已确认
  - [x] A（推荐）：默认复用同一 Profile 并叠加 Stage 参数；身份音色本体变化时创建新 Profile revision
  - [ ] B：每个 CharacterStage 必须绑定不同 Profile
  - [ ] C：所有 Stage 始终使用完全相同参数
- 决定：
- 决定人：
- 日期：

<a id="todo-m3-02"></a>

### TODO-M3-02：VoicePool 标签与 Scene 分配冲突

- [ ] 已确认
  - [x] A（推荐）：固定核心维度 + 自由扩展标签；硬约束先过滤，冲突保持 unassigned/review
  - [ ] B：全部固定标签
  - [ ] C：完全自由标签并由模型直接选择；当前 M3 没有模型选择 Provider/port/审核链，选择后必须先修订上位规格和 M3 Plan，不能直接关闭 M3-D02
- 决定：
- 决定人：
- 日期：

<a id="todo-m3-03"></a>

### TODO-M3-03：声音资产授权与最低质量

- [ ] 已确认
  - [x] A（推荐）：权利记录 + 自动格式/重叠人声/音乐/削波等检查 + 人工试听
  - [ ] B：只检查文件格式
  - [ ] C：只做人工试听
- 决定：
- 决定人：
- 日期：
- 需填写：授权证明字段、撤销/删除要求、质量 profile

<a id="todo-m3-04"></a>

### TODO-M3-04：试听区分度评分与自动指标边界

- [ ] 已确认
  - [x] A（推荐）：可解释标签/声学筛选 + 人工评分；embedding 只作提示
  - [ ] B：只使用机器相似度自动决定；该项与当前“自动指标只产候选、正式分配需人工审核”上位约束冲突，选择后必须先修订上位规格和 M3 Plan，不能直接关闭 M3-D04
  - [ ] C：只使用人工评分
- 决定：
- 决定人：
- 日期：

<a id="todo-m3-05"></a>

### TODO-M3-05：Voice 变化 stale selector

- [x] 已确认
  - [x] A（推荐）：提交前展开为受影响的 scriptUnitIds/audio clip IDs
  - [ ] B：扩展共享 selector 的 voice profile/stage 组合字段
  - [ ] C：任一 Voice 变化使全书音频 stale；该项与当前精确影响上位约束冲突，选择后必须先修订上位规格和 M3 Plan，不能直接关闭 M3-D05
- 决定：采用方案 A；提交前展开为受影响的 `scriptUnitIds` 和 `audioClipIds`，不扩展共享 selector。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

## E. M4 语音生成

<a id="todo-m4-01"></a>

### TODO-M4-01：通用发音表示

- [ ] 已确认
  - [x] A（推荐）：spokenText + pinyin 为通用层；phoneme/engineHint 只在 adapter 边界使用
  - [ ] B：通用层只保存 pinyin
  - [ ] C：通用层直接保存 Provider phoneme
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-02"></a>

### TODO-M4-02：TN/G2P 实现与依赖

- [ ] 已确认
  - [x] A（推荐）：确定性 TN/词典优先，模型只产生上下文候选
  - [ ] B：全部使用规则和词典
  - [ ] C：全部交给 Provider/模型
- 决定：
- 决定人：
- 日期：
- ADR：新增依赖时必填

<a id="todo-m4-03"></a>

### TODO-M4-03：词典上下文规则

- [ ] 已确认
  - [x] A（推荐）：版本化 JSON 条件 DSL，禁止执行任意代码
  - [ ] B：允许任意正则和脚本；该项与当前禁止执行任意代码的安全边界冲突，选择后必须先完成沙箱/预算 ADR 并修订 M4 Plan，不能直接关闭 M4-D02
  - [ ] C：只支持全局词条
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-04"></a>

### TODO-M4-04：后端不支持发音提示时的降级

- [ ] 已确认
  - [x] A（推荐）：安全时转换 spokenText 并进入试听/审核；无法安全转换时阻断
  - [ ] B：静默忽略 pronunciation hint；该项与当前禁止静默丢弃不支持字段的边界冲突，选择后必须先修订上位规格和 M4 Plan，不能直接关闭 M4-D03
  - [ ] C：所有不支持项直接阻断
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-05"></a>

### TODO-M4-05：词典导入导出

- [ ] 已确认
  - [ ] A（推荐）：版本化 JSON 为真值，CSV 只作交换格式
  - [x] B：只支持 JSON
  - [ ] C：只支持 CSV
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-06"></a>

### TODO-M4-06：发音人工审核与自动通过

- [ ] 已确认
  - [x] A（推荐）：确定性 TN/人工锁定可按策略通过；模型和新专名按命中或 ScriptUnit 审核
  - [ ] B：全部自动通过；该项与当前“不可靠读法必须进入 review”上位约束冲突，选择后必须先修订上位规格和 M4 Plan，不能直接关闭 M4-D03
  - [ ] C：全部人工审核
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-07"></a>

### TODO-M4-07：首个 TTS Provider 与 dialect

- [ ] 已确认
  - [x] A（推荐）：只选一个具有正式 API、明确音色权利和数据策略的 Provider
  - [ ] B：同时接入一个云端和一个用户管理的 loopback/LAN Provider；当前 Plan 只实现一个 approved adapter，选择后必须先新增第二套 adapter/配置/live 验收任务，不能直接关闭 M4-D04
  - [ ] C：只实现 Mock，不关闭 live 门禁；该项不能关闭 M4-D04
- 决定：
- 决定人：
- 日期：
- ADR：必填
- 需填写：Provider、endpoint、dialect/version、model/voice IDs、区域、数据保留、凭据注入边界、approved runtime profile ID、授权 live 夹具 ID/hash、可复制 smoke 命令、成功/失败判定、执行环境和负责人
- 未批准候选池：[语音模型与 Provider API 候选备忘](./docs/ideas/speech-model-and-provider-candidates.md)

<a id="todo-m4-08"></a>

### TODO-M4-08：AudioOutputSpec

- [ ] 已确认
  - [x] A（推荐）：adapter 输出后立即统一为冻结的 WAV/PCM mono 规格；具体采样率/位深与 M6 共用
  - [ ] B：永久保留 Provider native 作为正式中间格式
  - [ ] C：只在章节装配时转换
- 决定：
- 决定人：
- 日期：
- 需填写：codec/container、sample rate、bit depth、channels

<a id="todo-m4-09"></a>

### TODO-M4-09：TTS 请求模式

- [ ] 已确认
  - [x] A（推荐）：capability-driven；普通 ScriptUnit 优先同步，stream 只用于预览，Provider 强制时使用 async job
  - [ ] B：全部同步
  - [ ] C：全部流式
  - [ ] D：全部异步 job
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-10"></a>

### TODO-M4-10：并发、限流、费用和队列

- [ ] 已确认
  - [x] A（推荐）：Provider profile 保存版本化预算并响应服务端限流；精确值来自批准账户和基准
  - [ ] B：代码硬编码固定并发和费用上限；该项与当前版本化执行策略约束冲突，选择后必须先修订上位规格和 M4 Plan，不能直接关闭 M4-D05
  - [ ] C：不设置限制；该项与当前并发/限流/预算/队列门禁冲突，选择后必须先修订上位规格和 M4 Plan，不能直接关闭 M4-D05
- 决定：
- 决定人：
- 日期：
- 需填写：并发、QPS、每日/项目预算、超时、排队上限

<a id="todo-m4-11"></a>

### TODO-M4-11：Provider 参考音频资产生命周期

- [ ] 已确认
  - [x] A（推荐）：按 capability 选择上传或 Provider asset 引用，并记录创建、引用、撤销和删除状态
  - [ ] B：每次请求重新上传参考音频
  - [ ] C：只允许预置音色，不上传任何参考资产
- 决定：
- 决定人：
- 日期：
- 需填写：选 A/B 时的 approved runtime profile ID、授权测试资产 ID/hash、可复制创建/查询/撤销/清理命令、数据保留/删除策略和清理负责人

<a id="todo-m4-12"></a>

### TODO-M4-12：Seed 与可复现性声明

- [ ] 已确认
  - [x] A（推荐）：Provider 支持时保存并回放 Seed，但只声明 best-effort 可复现
  - [ ] B：把 Seed 视为完全可复现保证；该项与当前 best-effort 复现上位约束冲突，选择后必须先修订上位规格和 M4 Plan，不能直接关闭 M4-D05
  - [ ] C：不保存 Seed
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-13"></a>

### TODO-M4-13：幂等、unknown submission 与重试

- [ ] 已确认
  - [x] A（推荐）：只有幂等键或可查询 request/job 时自动恢复；否则进入人工确认，禁止盲目重提
  - [ ] B：unknown submission 自动重新提交；该项与当前“无幂等/查询证据时禁止盲目重提”上位约束冲突，选择后必须先修订上位规格和 M4 Plan，不能直接关闭 M4-D05
  - [ ] C：任何失败都不自动重试
- 决定：
- 决定人：
- 日期：

<a id="todo-m4-14"></a>

### TODO-M4-14：音频结果校验组件与资源预算

- [ ] 已确认
  - [x] A（推荐）：使用受控本地校验器读取 header/duration/format/hash；预算由 AudioOutputSpec 与样章基准冻结
  - [ ] B：完全信任 Provider metadata；该项与当前“正式产物必须校验真实二进制”上位约束冲突，选择后必须先修订上位规格和 M4 Plan，不能直接关闭 M4-D05
  - [ ] C：将每个结果发送外部服务校验
- 决定：
- 决定人：
- 日期：
- ADR：新增二进制或外部服务时必填
- 需填写：校验器版本/许可、资源预算；选 C 时还需 approved runtime profile ID、授权夹具 ID/hash、可复制 live 校验命令、成功/失败判定、执行环境和负责人

## F. M5 音频 QA

<a id="todo-m5-01"></a>

### TODO-M5-01：首个 ASR/VAD/说话人分析 Provider

- [ ] 已确认
  - [x] A（推荐）：按能力独立选择一个有正式 API、明确授权和数据策略的 Provider，不因 TTS 同厂而默认采用
  - [ ] B：强制与 TTS 使用同一 Provider
  - [ ] C：只使用用户管理的 loopback/LAN Provider
- 决定：
- 决定人：
- 日期：
- ADR：必填
- 需填写：ASR、VAD、diarization 是否分别启用，以及每个启用能力的 Provider/dialect/model、approved runtime profile ID、凭据注入边界、授权音频夹具 ID/hash、独立可复制 live smoke 命令、成功/失败判定、执行环境和负责人；speaker verification 复用 TODO-M5-06，不在本项重复决定
- 未批准候选池：[语音模型与 Provider API 候选备忘](./docs/ideas/speech-model-and-provider-candidates.md)

<a id="todo-m5-02"></a>

### TODO-M5-02：非模型音频检测执行边界

- [ ] 已确认
  - [ ] A（推荐）：受控本地音频处理器；必须先完成分发、许可和沙箱 ADR
  - [x] B：外部音频处理 API
  - [ ] C：本地与外部同时支持
- 决定：
- 决定人：
- 日期：
- ADR：必填
- 需填写：本地库/外部 API 精确版本、许可、预算和边界；选 B/C 时还需 approved runtime profile ID、授权夹具 ID/hash、可复制 live smoke 命令、成功/失败判定、执行环境和负责人

<a id="todo-m5-03"></a>

### TODO-M5-03：中文文本差异与同音策略

- [ ] 已确认
  - [x] A（推荐）：版本化保守规范化 + 字符 diff；标点和可能同音只分层提示，不自动判正确
  - [ ] B：直接比较原始字符编辑距离
  - [ ] C：由 LLM 直接给最终一致/不一致结论；当前 M5 没有 LLM QA Provider/审核链且禁止单一模型直接给最终结论，选择后必须先修订上位规格和 M5 Plan，不能直接关闭 M5-D03
- 决定：
- 决定人：
- 日期：

<a id="todo-m5-04"></a>

### TODO-M5-04：自动通过、复核与重试

- [ ] 已确认
  - [x] A（推荐）：版本化 policy；确定性损坏阻断，语义/同音项进入 review，阈值由基准决定
  - [ ] B：使用固定阈值自动通过和自动重试
  - [ ] C：全部人工处理
- 决定：
- 决定人：
- 日期：
- 需填写：policy version、阈值 profile、重试上限和阻断类别

<a id="todo-m5-05"></a>

### TODO-M5-05：音频指标、响度与峰值目标

- [ ] 已确认
  - [x] A（推荐）：按发布目标选择版本化 profile；未选发布目标前不填生产数值
  - [ ] B：全项目使用单一固定值
  - [ ] C：MVP 不检测响度/峰值
- 决定：
- 决定人：
- 日期：
- 需填写：发布目标、响度、true peak、静音/削波/截断阈值

<a id="todo-m5-06"></a>

### TODO-M5-06：说话人 embedding 相似度

- [ ] 已确认
  - [x] A（推荐）：可选、非阻断提示；没有合法参考资产时关闭
  - [ ] B：MVP 必须启用并参与自动拒绝；该项与当前“说话人相似度仅作非阻断提示”上位约束冲突，选择后必须先修订上位规格和 M5 Plan，不能直接关闭 M5-D06
  - [ ] C：MVP 不接入
- 决定：
- 决定人：
- 日期：
- 需填写：选 A 时的 Provider/算法版本与许可、approved runtime profile ID、授权参考资产/夹具 ID/hash、可复制 live smoke 命令、成功/失败判定、执行环境和负责人

<a id="todo-m5-07"></a>

### TODO-M5-07：QA 回归集与人工评分

- [ ] 已确认
  - [x] A（推荐）：可再分发固定夹具入库，私有合法样章保存 hash 和人工评分结果
  - [ ] B：只使用合成夹具
  - [ ] C：只使用私有样章；该项不能形成仓库内可复现基线，选择后必须先修订上位验收和 M5 Plan，不能直接关闭 M5-D07
- 决定：
- 决定人：
- 日期：

## G. M6 章节合成

<a id="todo-m6-01"></a>

### TODO-M6-01：音频处理执行方式与 FFmpeg 分发

- [ ] 已确认
  - [x] A（推荐）：随应用分发受控本地处理器；是否使用 FFmpeg 及其许可/升级由 ADR 固定
  - [ ] B：使用外部音频处理 API
  - [ ] C：要求用户自行安装本地工具
- 决定：
- 决定人：
- 日期：
- ADR：必填
- 需填写：选中处理器的来源/版本/许可/哈希或 approved runtime profile ID、授权夹具 ID/hash、可复制真实 smoke 命令、成功/失败判定、执行环境、清理步骤和负责人

<a id="todo-m6-02"></a>

### TODO-M6-02：统一中间音频规格

- [ ] 已确认
  - [x] A（推荐）：与 TODO-M4-08 共用一次冻结的 WAV/PCM mono 规格
  - [ ] B：24 kHz / 16-bit / mono
  - [ ] C：48 kHz / 24-bit / mono
  - [ ] D：保持 Provider native，装配时再统一
- 决定：
- 决定人：
- 日期：
- 需填写：codec/container、sample rate、bit depth、channels

<a id="todo-m6-03"></a>

### TODO-M6-03：响度、峰值、停顿与淡化优先级

- [ ] 已确认
  - [x] A（推荐）：复用 TODO-M5-05 profile；停顿优先级为人工 assembly override > ScriptUnit 显式值 > 类型策略默认
  - [ ] B：所有章节只使用全局规则
  - [ ] C：只使用 ScriptUnit 值，不允许装配覆盖
- 决定：
- 决定人：
- 日期：

<a id="todo-m6-04"></a>

### TODO-M6-04：多轨与复杂后期插件边界

- [x] 已确认
  - [x] A（推荐）：MVP 单轨顺序装配，只保留版本化 AudioProcessor port
  - [ ] B：MVP 支持多轨时间线并定义完整插件 SDK
  - [ ] C：不保留任何扩展边界
- 决定：采用方案 A；MVP 单轨顺序装配，只保留版本化 `AudioProcessor` port。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

## H. M7 同步阅读

<a id="todo-m7-01"></a>

### TODO-M7-01：显示文本与字幕角色前缀

- [ ] 已确认
  - [x] A（推荐）：阅读器主显示 corrected，允许查看 spoken；JSON 保留 speaker 字段，WebVTT/SRT 前缀由导出 profile 控制
  - [ ] B：所有界面和字幕只使用 corrected，无角色前缀
  - [ ] C：所有界面和字幕只使用 spoken，并强制角色前缀
- 决定：
- 决定人：
- 日期：
- 需填写：版本化字幕导出 profile 的 `subtitle_text_layer`（`corrected` 或 `spoken`）、所选 revision 缺失/不一致时的阻断行为、profile ID/version、角色前缀模板与转义规则

<a id="todo-m7-02"></a>

### TODO-M7-02：对齐粒度与时间轴编辑权限

- [x] 已确认
  - [x] A（推荐）：MVP 只保证 ScriptUnit 级且时间轴只读；任何时间修改请求都返回 M6，不创建 timeline override
  - [ ] B：MVP 支持词级对齐和直接修改 assembly
  - [ ] C：MVP 支持字级对齐，时间轴只读
- 决定：采用方案 A；MVP 只保证 ScriptUnit 级，时间轴只读，修改请求返回 M6。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

## I. M8 工程导入导出

<a id="todo-m8-01"></a>

### TODO-M8-01：工程包容器、压缩与加密

- [ ] 已确认
  - [x] A（推荐）：ZIP + versioned JSON + checksums，扩展名 `.audiobook-project`，MVP 不加密
  - [ ] B：目录包，不压缩不加密
  - [ ] C：首版使用加密容器
- 决定：
- 决定人：
- 日期：
- ADR：选择加密或新增依赖时必填

<a id="todo-m8-02"></a>

### TODO-M8-02：VoiceProfile 与 rights 数据导出

- [ ] 已确认
  - [x] A（推荐）：默认只导出 metadata 和无密钥配置；reference audio/embedding 必须 rights policy 明确 opt-in
  - [ ] B：导出全部声音资产和 embedding
  - [ ] C：完全不导出 VoiceProfile
- 决定：
- 决定人：
- 日期：
- 需填写：允许字段、禁止字段、授权证明、撤销和删除行为

<a id="todo-m8-03"></a>

### TODO-M8-03：导入合并范围

- [x] 已确认
  - [x] A（推荐）：MVP 只导入为新项目；源小说重新绑定使用独立流程
  - [ ] B：MVP 支持合并到既有项目
  - [ ] C：只允许打开原目录，不支持工程包导入
- 决定：采用方案 A；MVP 只导入为新项目，源小说重新绑定使用独立流程。
- 决定人：项目负责人（本轮用户确认）
- 日期：2026-08-08

<a id="todo-m8-04"></a>

### TODO-M8-04：发布格式、元数据与兼容基准

- [ ] 已确认
  - [x] A（推荐）：明确 MP3/M4B 目标播放器矩阵并保存 golden files
  - [ ] B：只发布 WAV
  - [ ] C：自行定义单一 MP3/M4B 元数据，不做播放器矩阵
- 决定：
- 决定人：
- 日期：
- 需填写：方案 A 必须在 MP3、M4B 中选择至少一项（可两项都选），并明确 WAV 是否附加；若只发布 WAV，必须先重新确认方案 B；再填写所选格式的 codec/profile、章节/封面/作者字段、批准 encoder/container/probe 版本/许可/分发、授权 golden fixture ID/hash、可复制编码/探测命令、目标播放器和最低版本、兼容验证步骤与判定、执行环境和负责人

<a id="todo-m8-05"></a>

### TODO-M8-05：stale 豁免、签名和大型文件恢复

- [ ] 已确认
  - [x] A（推荐）：默认禁止 stale；仅在不可变 ExportSnapshot 对逐项 reason/approver 豁免；MVP checksums + 原子 tmp 发布，签名/分块断点后续 ADR
  - [ ] B（与当前规格冲突，不能直接确认）：默认允许 stale 导出；工程包必须应用签名并支持分块断点；需先修改上位 stale 安全边界和验收
  - [ ] C（与当前规格冲突，不能直接确认）：永不允许豁免；覆盖写发布文件；需先修改不可变快照、原子发布和恢复边界
  - [ ] D：默认禁止 stale，仅允许不可变 ExportSnapshot 的逐项审计豁免；本阶段启用工程包/发布 manifest 签名和分块 checkpoint/恢复，并完整填写下述批准资料
- 决定：
- 决定人：
- 日期：
- ADR：启用签名或分块断点时必填
- 需填写：豁免规则、大文件恢复和临时空间预检；启用签名时还需批准算法/实现/版本、密钥端口、非生产测试密钥 ID、签名夹具 ID/hash、可复制签名/验证 smoke 命令、判定标准、执行环境和负责人

## 已有决定，不需要重复确认

- [x] 模型能力通过外部 Provider API 接入：`docs/adr/0001-model-capabilities-via-provider-apis.md`。
- [x] 项目状态使用 Node.js SQLite：`docs/adr/0002-project-state-with-node-sqlite.md`。
- [x] pnpm 版本由根 `package.json` 固定，`.nvmrc` 固定开发/测试验证版本；根 `engines` 支持范围、ADR 0002 的 `24.19.x` 文义和生产 Electron 内置 Node 兼容性仍由 ARCH-D02 对齐。
- [x] CLI/HTTP adapter 不属于当前 MVP，不阻塞 M1～M8。
