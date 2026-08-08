# ADR 0002：项目状态库使用 Node.js 内置 SQLite

状态：`accepted`

日期：2026-08-08

## 背景

M0 需要在每个项目目录内持久化 Artifact revision、依赖边、Task、审核、导出快照和多原因过期状态，并支持事务、只读打开、迁移前备份及崩溃恢复。状态库是工作流索引和状态真值，正式文件仍是内容真值。

## 决策

- 每个项目使用独立的 `state/project.sqlite`，首版状态 schema 为 `1`，项目目录 layout 为 `2`；两者独立版本化。
- SQLite 适配器使用 Node.js `node:sqlite` 的 `DatabaseSync`、预编译语句和 `backup()`，运行基线固定为 Node.js `24.19.x`。
- 连接禁用扩展加载和双引号字符串字面量，显式启用 defensive 模式与外键；写连接设置 `journal_mode=WAL`、`synchronous=FULL`、`busy_timeout=5000` 和 `trusted_schema=OFF`，只读连接额外启用 `query_only`。
- 所有状态变更通过 `BEGIN IMMEDIATE` 显式事务提交；不允许嵌套事务。
- 正式产物先在 `tmp/` 生成并校验，再移动到不可变 revision 目录，最后在单个数据库事务中登记 revision、依赖、活动版本、过期原因和 Task 成功状态。文件已移动但事务失败时保留为孤立 revision，由恢复扫描报告，不自动删除。
- schema 或 layout 迁移前必须创建备份；只读会话遇到旧版本时返回迁移必需错误，不隐式写入。
- `artifact_revisions`、`artifact_dependencies` 和 `review_decisions` 使用数据库触发器禁止更新和删除；可变执行、有效性和审核状态单独保存。
- `DatabaseSync` 只在 Application Core 的项目状态适配器中使用，不进入 Renderer。文件哈希和目录扫描继续使用异步文件 API；单次 SQLite 事务保持短小。
- WAL 项目只支持本机物理文件系统。网络文件系统和跨主机共享项目目录不属于 M0 支持范围。

## 被否决方案

### JSON 文件作为状态库

否决。跨 Artifact、依赖、Task 和过期原因的原子更新需要自行实现日志、并发控制、索引和恢复协议，增加数据损坏边界。

### 第三方原生 SQLite 绑定

首版否决。当前 Node.js 基线已提供所需的同步连接、预编译语句和在线备份接口；额外原生依赖会增加桌面分发和 ABI 兼容成本。

### 远程数据库

否决。M0 是单机、本地优先、每项目自包含的工作区；远程多人协作和分布式调度不在当前范围。

## 数据、兼容性和迁移影响

- 新项目直接创建 layout `2` 和 state schema `1`。
- layout `1` 项目在写会话中备份旧 manifest，再创建或迁移状态库，最后原子替换 manifest。
- 已识别的 state schema `0` 在迁移前使用 SQLite backup API 创建独立备份；未知旧 schema、过新 schema、项目 ID 不匹配或完整性检查失败时阻止打开。
- Node.js 官方文档当前把 `node:sqlite` 标为 release candidate，因此该运行时版本必须由根包 `engines` 和 `.nvmrc` 固定，并由完整集成测试覆盖。

## 验证依据

- Node.js `node:sqlite`、`DatabaseSync` 和 `backup()`：
  https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- SQLite 显式事务和 `BEGIN IMMEDIATE`：
  https://www.sqlite.org/lang_transaction.html
- SQLite WAL、同步级别和连接 PRAGMA：
  https://www.sqlite.org/pragma.html
- SQLite WAL 的本机文件系统限制：
  https://www.sqlite.org/wal.html
- SQLite 在线备份 API：
  https://www.sqlite.org/backup.html

## 回退条件

出现以下任一情况时，通过新 ADR 评估异步或第三方适配器：

- Node.js LTS 中 `node:sqlite` 的兼容性或稳定性无法满足桌面分发；
- 同步数据库调用在真实 30 分钟样章基准中造成不可接受的 Core 响应阻塞；
- 项目需要受支持的网络文件系统、跨主机并发写入或分布式任务调度。
