# M1 可再分发 Golden Dataset

本目录只包含原创合成文本、机器期望数据和许可声明，不包含真实小说、私有样章、书名、作者或可逆定位信息。

## 目录

- `manifest.json`：M1-D08 数据集清单和内容哈希；
- `input/`：冻结的输入字节；
- `expected/`：版本 1 的 fixture expected envelope；
- `licenses/AUTHORED-FOR-TEST.txt`：合成数据的 CC0-1.0 授权证据。

## 夹具矩阵

| fixtureId | 覆盖点 |
| --- | --- |
| `synthetic-comprehensive-bom-crlf` | UTF-8 BOM、CRLF、中文数字章节、卷内重编号、前言/尾声、重复标题、空章、正文假阳性、重复段落 |
| `reimport-base-lf` | LF 与重导入基线 |
| `reimport-unchanged` | 同源内容未变 |
| `reimport-head-insert` | 同源头部插入且原块 ID 保持 |
| `reimport-single-block-modified` | 同源仅一个块发生替换 |
| `reimport-content-restored` | 修改后恢复到基线内容和块 ID |
| `invalid-utf8-byte-sequence` | 无 BOM 且严格 UTF-8 失败，要求人工选择编码 |
| `unsupported-epub-opaque` | 仅返回 `NOVEL_IMPORT_UNSUPPORTED_FORMAT` |

`unsupported-epub-opaque` 故意不是 ZIP 容器。完整性测试只把它作为 opaque bytes 计算长度和 SHA-256；产品路径必须在格式门禁处拒绝，不得打开容器或解析 EPUB。

## Expected envelope v1

每个 expected JSON 固定记录：

- 结果或错误码；
- 块顺序和 raw UTF-8 byte ranges；
- 章节 heading/content ranges；
- 100% 分类及 issue；
- 成功样本的 `ImportedNovelV1` 和 `ChapterIndexV1`；
- 重导入样本的基线关系、稳定块、插入块和单块替换映射。

错误样本不伪造正式 ImportedNovel/ChapterIndex。其块与章节数组为空，并以 source-byte `unknown` 段显式覆盖全部输入。

## 更新规则

1. 只允许加入原创合成、公共领域或已有明确再分发授权的内容；私有真实样章不得进入本目录。
2. input、expected 或许可证据任一字节变化时，提升 `datasetVersion`。
3. 重新计算清单中的 byte length、文件 SHA-256 和 `datasetContentHash`。
4. `datasetContentHash` 按 manifest 顺序对每项的 `fixtureId NUL input.sha256 NUL expected.sha256 NUL licenseEvidence.sha256 LF` 做增量 SHA-256。
5. 运行 `pnpm --filter @voxweaver/novel-import test`，不得通过修改 expected 掩盖后续实现回归。
