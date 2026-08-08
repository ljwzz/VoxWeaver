# 数据契约

本目录保存机器可校验的 JSON Schema 和对应说明。首批必须覆盖：

- project manifest；
- SourceAsset；
- Artifact、ArtifactRevision 和 ArtifactDependency；
- StaleCause；
- ImportedNovel、ChapterIndex 和 ProcessingSegment；
- CorrectionProposal；
- ScriptUnit、Character、VoiceProfile 和 PronunciationEntry；
- Provider profile、通用错误和异步任务引用；
- LLM/TTS/ASR 规范化请求响应；
- QAResult、ChapterAssembly 和 ChapterTimeline；
- 工程包 manifest 和发布清单。

每个 schema 必须声明 `$schema`、`$id` 和业务版本，并有合法、非法和兼容性测试夹具。

采用的规范版本见 [plan/README.md](../../plan/README.md)。

## 已定义契约

- `project-manifest.schema.json`：阶段 00 项目根目录 `project.json` 的首版契约。
- `project-record.schema.json`：项目状态库元数据记录。
- `project-write-lock.schema.json`：阶段 00 项目写锁文件的首版契约。
- `source-asset-record.schema.json`：源资产登记记录。
- `artifact-record.schema.json`：正式产物 revision 的状态与溯源记录。
- `artifact-revision.schema.json`：revision 目录内的不可变清单。
- `artifact-dependency.schema.json`：正式产物之间的直接依赖边。
- `stage-run-record.schema.json`：阶段执行记录。
- `task-record.schema.json`：可恢复、可幂等投递的任务记录。
- `review-decision-record.schema.json`：不可变人工审核决定。
- `stale-cause.schema.json`：可独立解决的产物过期原因。
- `export-snapshot-record.schema.json`：固定 revision 集合和过期豁免的导出快照。
