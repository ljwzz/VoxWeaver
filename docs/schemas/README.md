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
