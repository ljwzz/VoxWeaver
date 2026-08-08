# 架构决策记录

只有已经确认的技术选型进入本目录。每个 ADR 至少记录：

- 状态和日期；
- 背景与问题；
- 已选方案；
- 被否决方案；
- 数据、兼容性和迁移影响；
- 验证证据和权威来源；
- 回退条件。

建议命名：`NNNN-short-title.md`。阶段文件不得用“待决策”内容代替 ADR。

当前已接受决策：

- [ADR 0001：模型能力统一通过 Provider API 接入](./0001-model-capabilities-via-provider-apis.md)
- [ADR 0002：项目状态库使用 Node.js 内置 SQLite](./0002-project-state-with-node-sqlite.md)
