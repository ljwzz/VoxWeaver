# ADR 0001：模型能力统一通过 Provider API 接入

状态：`accepted`

日期：2026-08-08

## 背景

VoxWeaver 需要 LLM、TTS、ASR、VAD 和说话人分析等模型能力。早期架构草案同时包含外部 LLM Provider API 和 Python 语音 Worker，导致桌面包需要承担 Python 运行时、模型权重、本地加速、进程恢复和跨语言契约。

## 决策

- VoxWeaver 不内置、下载、加载、运行或托管任何模型。
- LLM、TTS、ASR、VAD 和说话人分析统一通过外部 HTTP/HTTPS Provider API 接入。
- Provider 可以是用户独立管理的 loopback/LAN 服务或云端服务，但均不是 VoxWeaver 子进程。
- Provider adapter 使用 TypeScript 实现并运行在 Application Core；Renderer 不直接访问 Provider endpoint 或持有凭据。
- 认证、endpoint、能力探测、超时、取消、限流、错误分类、请求 ID 和数据策略使用共享 Provider 基础设施。
- LLM、TTS、ASR 等保持各自的规范化请求、结果和能力契约，不使用单个通用业务 DTO 替代能力边界。
- TTS 音频、ASR 上传和其他大型输入输出由 Core 管理；结果先进入任务 `tmp/`，经 schema、路径、大小、格式和哈希校验后再提交正式 revision。
- 默认测试使用 Mock Provider API；实时 Provider 测试显式启用且不默认读取真实项目内容。
- 安装包不包含 Python 运行时、模型 SDK、模型权重、CUDA/Metal 管理或语音 Worker。

## 非模型音频处理边界

FFmpeg、响度、静音、削波和文件完整性等非模型音频处理是否本地执行，或通过外部音频处理 API 执行，不由本 ADR 决定。对应实现必须由后续 ADR 确认。

## 被否决方案

### 随应用分发 Python 语音 Worker

否决。该方案会引入第二运行时、跨语言契约、模型与加速依赖、进程管理和分发升级边界，与已确认的 API-only 模型能力边界冲突。

### 在 Electron Main 或 Renderer 直接调用 Provider

否决。Main 仅管理窗口、生命周期、凭据代理和传输；Renderer 只发起受限的类型化命令。Provider 编排、业务校验和产物提交由 Core 负责。

## 影响

- 删除 Python Worker 协议、NDJSON 握手、本地模型进程、GPU 资源管理和 Python 打包任务。
- 阶段 05、07、08 的候选后端改为 Provider API 契约、数据策略和基准，不直接选择模型仓库或本地权重。
- 任务恢复围绕 Provider 请求 ID、幂等键、异步任务查询、取消和未知提交结果展开。
- 模型运行和容量由 Provider 管理；VoxWeaver 仍负责并发、限流、成本提示、错误分类和可追溯性。

## 验证依据

- Electron 进程模型与 `utilityProcess`：
  https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron 本地凭据安全存储：
  https://www.electronjs.org/docs/latest/api/safe-storage
- Electron 安全清单：
  https://www.electronjs.org/docs/latest/tutorial/security
- HTTP 语义：
  https://www.rfc-editor.org/rfc/rfc9110

## 回退条件

只有在外部 Provider API 无法满足已批准的离线性、数据边界、质量或成本目标，且取得可复现验证证据时，才可通过新 ADR 重新评估本地模型运行时。
