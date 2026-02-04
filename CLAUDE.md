# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cockpit is a macOS menubar application for managing Claude Code projects. It provides a tray icon that opens a popup window for quickly launching Claude Code sessions in iTerm2.

## Development Commands

```bash
# Development (watches main + renderer + starts Electron)
npm run dev

# Build
npm run build            # Build both main and renderer
npm run build:main       # TypeScript main process only
npm run build:renderer   # Vite renderer only

# Production
npm start               # Run built app
npm run package         # Build + create .app bundle (output: out/)
```

## Architecture

### Process Model

This is an Electron app with the standard three-process architecture:

- **Main process** (`src/main/`) - Node.js backend, manages tray/window, handles IPC
- **Preload** (`src/preload.ts`) - Bridge exposing `window.cockpit` API to renderer
- **Renderer** (`src/renderer/`) - React UI built with Vite

### Key Files

| File | Purpose |
|------|---------|
| `src/main/index.ts` | App entry, tray creation, IPC handlers, window management |
| `src/main/store.ts` | Project persistence via electron-store |
| `src/main/iterm.ts` | iTerm2 AppleScript automation (open/focus sessions) |
| `src/shared/types.ts` | Shared TypeScript types and `CockpitAPI` interface |
| `src/preload.ts` | IPC bridge, defines `window.cockpit` API |
| `src/renderer/App.tsx` | Main UI component |

### Data Flow

1. User clicks tray icon → window shows at tray position
2. Click project → IPC to main → `iterm.openSession()` runs AppleScript
3. Projects stored via electron-store at `~/Library/Application Support/cockpit/projects.json`
4. Active sessions tracked in-memory, synced to renderer via `sessions-changed` event

### Build Output

- `dist/main/` - Compiled TypeScript (main + preload)
- `dist/renderer/` - Vite-built React app
- `out/` - Packaged .app (after `npm run package`)

## Technical Notes

- App hides from Dock (`app.dock?.hide()`)
- Window is frameless, transparent, always-on-top, hides on blur
- Project paths stored relative to home directory
- Uses `require()` for electron-store due to ESM/CJS compatibility
- Cmd+click on project forces new session even if one exists

## Workflow Rules

1. **Ticket first** - Never start work without an existing issue in beads (`bd show <id>`)
2. **No premature commits** - Make changes, then wait for user to validate
3. **User confirms before done** - Always ask user to test before committing/pushing

### Correct Flow
```
bd show <id>                    # Review the issue
bd update <id> --status=in_progress  # Claim it
# Make code changes
# Ask user to test (npm run dev)
# Wait for user confirmation
# Only then: commit, push, close issue
```
