# @voxweaver/common

VoxWeaver 内部、运行时无关的共享 TypeScript 包。

允许放置：

- Electron Main、Preload、Renderer、Application Core 都需要的基础类型；
- 不依赖 Vue、Electron、Node.js API 或具体 Provider SDK 的小型工具；
- 可独立测试且语义稳定的错误、断言和结果类型。

不放置：

- 领域实体、工作流状态和跨进程 DTO；
- 只被单个模块使用的函数；
- UI 组件、文件系统实现、数据库实现或 Provider adapter。

公共入口仅由 `src/index.ts` 导出。模块先在其所属业务包内实现，确认跨包复用后再迁入本包。
