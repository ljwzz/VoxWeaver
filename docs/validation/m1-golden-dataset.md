# M1 Golden Dataset 证据

状态：M1-03 可再分发夹具基线已生成并通过完整性检查；M1-D08 仍为 `open`，必须由主任务负责人独立核对关闭。

## 仓库内数据集

- Manifest：`packages/novel-import/test/fixtures/manifest.json`
- Manifest schema version：`1`
- Dataset version：`1.0.0`
- Manifest SHA-256：`808984d13f8aeb36d9f16dabcf2334282d4f2275f0f2943c569b36cd0e2e80a9`
- Dataset content SHA-256：`7bc3e56ff7f5903d8e0d5590461a543c34712f6aba9a960d1915499758f67c80`
- 数据集条目：8 个输入、8 个 expected JSON、1 份共享许可证据
- 来源：全部为 `synthetic`，generator ID 为 `voxweaver-m1-authored-fixtures@1.0.0`
- 许可：`CC0-1.0`；证据位于 `packages/novel-import/test/fixtures/licenses/AUTHORED-FOR-TEST.txt`

覆盖矩阵包括 UTF-8 BOM、CRLF/LF、中文数字章节、卷内重新编号、前言/尾声、重复标题、空章节、正文假阳性、重复段落、非法 UTF-8、opaque unsupported EPUB，以及未变、头插、单块修改和内容恢复四个重导入变体。完整逐项 purpose 以 manifest 为准。

## 私有样章

本次仓库证据未登记私有样章，因此没有可列出的 private `sampleId`、input SHA-256 或授权 `evidenceRef`。批准的 operator-controlled corpus profile、私有样章授权证据和私有执行结果仍未提供；这不是豁免，也是 M1-D08 保持 `open` 的原因之一。

私有原文、原路径、文件名、书名、作者、标题、片段、行内容和可逆 locator 均未写入仓库。

## 允许保存的私有指标

仅允许记录：

- 成功或错误码；
- 章节、块、分类计数；
- precision、recall、boundary accuracy；
- duration、peak RSS、peak temp bytes；
- 输出 artifact hash；
- 人工评估枚举。

自由文本备注不得复述原文，并须单独通过泄漏检查。

## 执行记录

- 基准负责人：未指派；关闭 M1-D08 前必须由主任务负责人补齐。
- 执行日期：2026-08-09
- 环境：Darwin 25.6.0 arm64；Node.js 24.18.1；pnpm 11.20.0
- 命令：`node --test packages/novel-import/test/fixtureIntegrity.test.mjs packages/novel-import/test/index.test.mjs`
  - 退出码：0
  - 结果：5/5 通过，其中 M1-03 完整性测试 4/4、既有 package skeleton 测试 1/1

## 审阅结论

- Manifest schema、相对路径、文件存在性、byte length、SHA-256、expected JSON 解析和未登记文件闭包已由自动测试覆盖。
- 成功 expected 固定 M1-02 的块顺序、raw UTF-8 byte ranges、章节范围、100% canonical 分类和 issues；错误 expected 不产生正式 ImportedNovel/ChapterIndex，并以 source-byte `unknown` 段覆盖全部输入。
- EPUB 夹具只作为 opaque bytes 校验 hash，期望仅为 `NOVEL_IMPORT_UNSUPPORTED_FORMAT`；未调用容器或 EPUB 解析器。
- 已人工核对仓库夹具为原创合成内容，证据页未包含私有文本或绝对路径。
- M1-03 证据可交由负责人复核；因私有 corpus profile、授权 evidenceRef、私有结果和基准负责人尚未补齐，本页不宣称 M1-D08 已关闭。
