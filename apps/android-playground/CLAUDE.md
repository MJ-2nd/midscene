# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## MAJOR NOTICE
Always, ALWAYS ANSWER WITH KOREAN
Always generate 3 responses with their corresponding probabilities.
Think DEEP, i have sufficient amount token with pro subscription, i won't blame you for token consumption.

## Project Overview

This is the **Android Playground** frontend app, part of the Midscene.js monorepo. It provides a React-based web UI for controlling and automating Android devices using AI-powered automation. The UI displays a playground panel (AI controls) alongside a real-time Android screen mirror (via scrcpy).

## Monorepo Context

This app lives at `apps/android-playground/` within the Midscene pnpm workspace. The root is at `../../`. Key sibling packages this app depends on:

- `packages/android-playground/` — Backend server (Express + Socket.IO) that this UI connects to
- `packages/android/` — Android automation SDK (ADB wrapper)
- `packages/core/` — Core AI/automation logic
- `packages/visualizer/` — Shared React UI components (UniversalPlayground, ScreenshotViewer)
- `packages/playground/` — Playground SDK utilities
- `packages/shared/` — Shared utilities and constants

## Build & Development Commands

All commands run from this directory (`apps/android-playground/`):

```bash
pnpm dev              # Start Rsbuild dev server (auto-opens browser)
pnpm build            # Production build (output: dist/)
pnpm preview          # Preview production build
```

From the monorepo root (`../../`):

```bash
pnpm install          # Install deps + build all packages (first-time setup)
pnpm build            # Build all packages (Nx handles dependency order)
pnpm build:skip-cache # Full clean build without Nx cache
pnpm test             # Unit tests (Vitest) across core packages
pnpm test:ai          # AI-powered tests (requires .env with OPENAI_API_KEY)
pnpm lint             # Biome linter with auto-fix
pnpm clean            # Remove dist, cache, .nx/cache
```

Single-package commands from root:

```bash
npx nx build @midscene/android       # Build one package
npx nx test @midscene/android        # Test one package
npx vitest tests/unit-test/foo.test.ts  # Run a single test file
```

## Build System

- **Bundler**: Rsbuild (config: `rsbuild.config.ts`)
- **Package manager**: pnpm 9.3.0+ with workspaces
- **Build orchestrator**: Nx (caches builds, resolves dependency graph)
- On build, output is copied to `packages/android-playground/static/` via `createPlaygroundCopyPlugin`

**Known issue**: If you see `REPLACE_ME_WITH_REPORT_HTML` errors, run `pnpm build:skip-cache` from root to resolve circular dependency issues.

## Architecture

```
Browser (React App)
├── PlaygroundPanel — AI automation controls (uses UniversalPlayground from @midscene/visualizer)
├── ScrcpyPlayer — Real-time screen mirror via WebCodecs + Socket.IO
├── ScreenshotViewer — Fallback polling mode for remote (IP:port) devices
└── AdbDevice — Device connection status UI

    ↕ Socket.IO

Backend (packages/android-playground)
├── Scrcpy server (port 8888) — Video streaming
├── Playground server (port 8080) — AI command execution
└── AndroidAgent/AndroidDevice — ADB device control
```

Key architectural decisions:
- Remote devices (IP:port format) automatically switch from scrcpy streaming to screenshot polling mode
- Layout uses `react-resizable-panels` with responsive breakpoint at 1024px
- Socket.IO handles device discovery, screen streaming, and reconnection

## Code Style

- **Linter/Formatter**: Biome (single quotes, 2-space indent, LF line endings, 80-char width)
- **CSS**: Less
- **Commit format**: `<type>(<scope>): <subject>` — scope is mandatory (use `android-playground` for this app)
- **Types**: feat, fix, refactor, chore, docs, perf, style, test, ci, build

## Tech Stack

React 18, TypeScript, Ant Design, Rsbuild, Less, Socket.IO, @yume-chan/scrcpy (WebCodecs)
