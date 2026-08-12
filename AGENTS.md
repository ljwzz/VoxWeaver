# Repository Guidelines

## Project Structure & Module Organization

VoxWeaver is a pnpm monorepo. `apps/desktop/` contains the Electron Forge application: `main/` for the main process, `preload/` for the bridge, and `renderer/src/` for Vue pages, styles, and local assets. Shared TypeScript modules live in `packages/`: `contracts` defines cross-layer data contracts, `application` holds use cases and ports, and `project-workspace` manages project files. `services/app-core/` coordinates application services and the SQLite project catalog. Keep tests beside their subjects as `*.test.ts`.

Documentation starts at `README.md`, then routes through `docs/README.md` to `docs/spec/` and `docs/ideas/`. Do not edit generated content under `apps/desktop/.vite/` or `apps/desktop/out/`.

## Build, Test, and Development Commands

Use Node `v24.13.0` (`.nvmrc`) and the pnpm version declared in `package.json`.

- `corepack pnpm install` installs the locked workspace dependencies.
- `corepack pnpm run dev` starts Electron Forge with the Vite renderer; use `dev:debug` to open DevTools.
- `corepack pnpm run check` runs ESLint, Stylelint, TypeScript checks, all tests, and page-manifest validation.
- `corepack pnpm run package` builds the local macOS arm64 application; `make` creates the distributable archive.
- `corepack pnpm --filter @voxweaver/desktop test` runs only desktop tests during iteration.

## Coding Style & Naming Conventions

Use two-space indentation, LF endings, a final newline, single quotes, semicolons, and 1TBS braces. ESLint and Stylelint are authoritative; run `corepack pnpm run lint:fix` before submitting broad formatting changes. Vue SFCs use `script`, `template`, then `style`; component names are PascalCase. Follow existing camelCase TypeScript module names and `*.test.ts` test names.

Keep product rules, defaults, thresholds, and timeouts in typed module configuration. Vite, Electron Forge, `define`, and `import.meta.env` are for build/runtime wiring, not business behavior.

## Testing Guidelines

Desktop and renderer tests use Vitest; packages and services use Node's test runner. Add focused regression tests for behavior changes and keep fixtures local to the owning module. No numeric coverage gate is configured, so review changed branches explicitly. Run the targeted package test while developing and the root `check` before opening a pull request.

## Commit & Pull Request Guidelines

Use lowercase Conventional Commit types such as `feat`, `fix`, `docs`, `refactor`, or `test`: `fix: 修复程序坞激活逻辑`. Keep headers at most 72 characters and omit a trailing period. Each commit and pull request should address one concern. Pull requests must summarize behavior and risk, list verification commands, link the relevant issue, and include screenshots or a short recording for renderer changes.
