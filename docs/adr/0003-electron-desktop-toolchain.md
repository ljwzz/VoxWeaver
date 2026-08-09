# ADR 0003：Electron 桌面开发工具链

状态：`accepted`

日期：2026-08-09

## 背景

阶段 00 需要把现有 monorepo 和 Application Core 后端接入可启动的 Electron Main、Preload 与 Vue Renderer。此决策只冻结非发布开发工具链；正式平台、签名、更新渠道和打包后 Core 的 SQLite 兼容证据仍由 ARCH-D01、ARCH-D02 管理。

## 决策

- `apps/desktop` 是单一 pnpm workspace package，保留 `main/`、`preload/`、`renderer/` 三个源码入口，不创建独立 Web 应用。
- 桌面运行时固定为 Electron `43.2.0`；开发打包工具固定为 Electron Forge `7.11.2` 和官方 Webpack TypeScript 插件，不使用 Forge Vite 插件。
- Renderer 固定为 Vue `3.5.41`、`@vue/compiler-sfc` `3.5.41` 和 `vue-loader` `17.4.2`；Vue SFC 统一使用 Composition API 与 `<script setup lang="ts">`。
- Electron 自动化依赖固定为 Playwright `1.62.1`。阶段 00 已使用该接口完成未签名开发 `.app` 的纵向 E2E；该结果不替代正式发布验收。
- 开发与测试 Node.js 固定为 `24.18.1`，根支持范围为 `>=24.18.0 <24.19.0`，`@types/node` 固定为 `24.13.3`。Electron 43.2.0 内置 Node.js `24.18.0`，两者处于同一受控 minor 范围。
- pnpm 使用 hoisted `node_modules` 布局。Forge 7 的依赖链仍包含 git 形式的 `@electron/node-gyp`；在迁移到后续已批准版本并完成验证前，工作区显式关闭 `blockExoticSubdeps`，依赖完整版本与 lockfile 必须纳入评审。
- Forge 配置不声明 maker、发布签名身份、notarization、发布或更新；阶段 00 的 `package` 只生成 macOS arm64 开发 `.app`，不得作为正式发布证据。Electron 二进制保留的 ad-hoc/linker 签名不等于开发者身份签名或发布验收。
- BrowserWindow 固定 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，拒绝新窗口、任意导航和权限请求。Preload 只通过版本化 contracts 暴露逐方法 bridge，不暴露通用 IPC、Node、路径或 shell API。

## 被否决方案

### Forge Vite 插件

首版否决。当前目标是优先建立稳定、可验证的桌面基线；使用 Forge 官方 Webpack TypeScript 模板可避免同时承担另一套实验性插件边界。

### 独立 Renderer Web 应用

否决。产品只交付 Electron 桌面端，拆分独立 Web 包会扩大当前范围并引入不需要的部署入口。

### 同时启用 maker、签名与自动更新

否决。发布主体、证书、正式平台和更新渠道未齐；开发 `.app` 不能替代发布验收。

## 数据、兼容性和迁移影响

- 根 `engines`、`.nvmrc`、类型定义与锁文件改为 24.18.x 验证基线；ADR 0002 同步把原 24.19.x 文义修订为 24.18.x。
- Electron、Forge、Vue、Webpack loader 和 Playwright 依赖全部精确锁定；升级必须更新本 ADR 或由后续 ADR 取代，并重跑桌面构建与安全回归。
- 当前桌面公开面只增加阶段 00 已注册的 `app`、目录选择与项目生命周期逐方法接口；不公开项目路径、通用 IPC 或 Provider 能力，后续接口仍只能通过版本化 contracts 接入。
- ARCH-D02 继续保持 `open`。关闭它仍需打包后 Core 的 Node/SQLite 能力证据，以及签名、更新、回退和负责人材料。

## 验证依据

- Electron 43.2.0 及其 Chromium、Node.js、V8 版本：
  https://releases.electronjs.org/release/v43.2.0
- Electron Forge Webpack TypeScript 模板：
  https://www.electronforge.io/templates/typescript-%2B-webpack-template
- Electron Forge 的 pnpm hoisted 配置要求：
  https://www.electronforge.io/
- Forge 7 与 pnpm `blockExoticSubdeps` 的已知依赖问题：
  https://github.com/electron/forge/issues/4267
- pnpm 11 工作区设置位置：
  https://pnpm.io/settings
- Vue 3.5.41 发布记录：
  https://github.com/vuejs/core/blob/main/CHANGELOG.md
- Vue `<script setup>`：
  https://vuejs.org/api/sfc-script-setup.html
- Electron 安全清单：
  https://www.electronjs.org/docs/latest/tutorial/security
- Playwright Electron 自动化接口：
  https://playwright.dev/docs/api/class-electron

## 回退条件

出现以下任一情况时，以新 ADR 取代本决策：

- Forge 7 无法在 Node.js 24.18.x 和当前 pnpm workspace 中稳定安装、启动或生成开发 `.app`；
- Webpack 无法在不破坏 Core 运行边界的前提下打包 Main、Preload、Renderer 或后续 utility process；
- Electron 内置 Node.js 无法通过本项目使用的 `node:sqlite` 能力验证；
- 后续已批准的 Forge 版本消除当前依赖安全例外，并通过现有桌面回归。
