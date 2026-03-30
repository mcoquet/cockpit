# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cockpit is a macOS menubar application for managing Claude Code projects. It provides a tray icon (λ) that opens a popup window for quickly launching Claude Code sessions in built-in terminal windows.

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
| `src/main/index.ts` | App entry, tray creation, IPC handlers, global shortcuts |
| `src/main/store.ts` | Project persistence via electron-store |
| `src/main/pty.ts` | PTY session management (spawns claude CLI) |
| `src/main/terminal-window.ts` | Terminal window creation and management |
| `src/main/claude.ts` | Finds claude CLI binary |
| `src/shared/types.ts` | Shared TypeScript types and `CockpitAPI` interface |
| `src/preload.ts` | IPC bridge, defines `window.cockpit` and `window.terminal` APIs |
| `src/renderer/App.tsx` | Popup window UI (project list, search) |
| `src/renderer/Terminal.tsx` | Terminal window UI (xterm.js) |

### Data Flow

1. User clicks tray icon (or Cmd+N) → popup window shows at tray position
2. Click project → IPC to main → spawns PTY with claude CLI → opens terminal window
3. Projects stored via electron-store at `~/Library/Application Support/cockpit/projects.json`
4. Active sessions tracked in-memory, synced to renderer via `sessions-changed` event
5. Terminal windows communicate with PTY via IPC (`pty-input`, `pty-output`, `pty-resize`)

### Build Output

- `dist/main/` - Compiled TypeScript (main + preload)
- `dist/renderer/` - Vite-built React app
- `out/` - Packaged .app (after `npm run package`)

## Technical Notes

- Tray icon uses `setTitle('λ')` with empty image for macOS menubar
- Popup window is frameless, transparent, always-on-top, hides on blur
- Terminal windows use xterm.js with node-pty backend, `titleBarStyle: 'hiddenInset'` for dark title bar
- Project paths stored relative to home directory
- Uses `require()` for electron-store due to ESM/CJS compatibility
- Cmd+click on project forces new session even if one exists
- Cmd+N is a **local** shortcut (app menu accelerator, only works when Cockpit is active)
- Cmd+` is a **global** shortcut (cycles terminal windows from any app)
- Cmd+Q shows confirmation if active sessions exist
- Dock visibility toggles based on active sessions (`app.dock.show()`/`app.dock.hide()`)
- Bell notifications detect `\x07` in PTY output, debounced to 10s per session

## Releases

### Creating a Release

```bash
git tag v0.7.0 && git push origin main v0.7.0
```

The pre-push hook (`.githooks/pre-push`) automatically syncs `package.json` version when pushing a version tag. If the version doesn't match, it updates package.json, commits, and moves the tag.

### What Happens on Tag Push

GitHub Actions workflow (`.github/workflows/release.yml`) builds on tag push:
- Triggers on `v*` tags
- Builds DMG for arm64 and x64
- Uploads to GitHub Releases (unsigned - users right-click → Open)
- **Automatically updates Homebrew cask** in `mcoquet/homebrew-cockpit` repo:
  - Computes SHA256 checksums for both DMGs
  - Updates `Casks/cockpit.rb` with new version and hashes
  - Requires `HOMEBREW_TAP_TOKEN` secret with repo access
  - Skips prereleases (tags containing `-`, e.g., `v1.0.0-beta`)

### Verifying a Release

After pushing a tag, verify both the build AND cask update before telling the user to upgrade:

```bash
# 1. Check build completed
gh run list --repo mcoquet/cockpit --limit 1

# 2. Check cask was updated (force refresh)
brew update && brew info cockpit | head -1
```

## Workflow Rules

1. **Ticket first** - Never start work without an existing GitHub issue (`gh issue view <number>`)
2. **Claim and plan** - Before coding: self-assign the issue and invoke appropriate superpowers skills
3. **No premature commits** - Make changes, then wait for user to validate
4. **User confirms before done** - Always ask user to test before committing/pushing

### User Intent: "Feature" or "Bug" = Create Ticket

When the user says things like:
- "new feature: ..."
- "bug: ..."
- "idea: ..."
- "we should add ..."

**This means: Create a GitHub issue, NOT start implementation.**

```bash
gh issue create --repo mcoquet/cockpit --title "<description>" --label "enhancement"
```

Wait for explicit instruction to work on an issue (e.g., "work on #123").

### Correct Flow
```
gh issue view <number>               # Review the issue
# Invoke relevant superpowers skills (see below)
# Make code changes
# Ask user to test (npm run dev)
# Wait for user confirmation
# Only then: commit, push, close issue with gh issue close <number>
```

## Superpowers Skills

The `obra/superpowers` skills are installed directly in `.claude/skills/` (committed to the repo). Project-specific outputs:

- **Design docs**: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- **Implementation plans**: `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- **Worktrees**: `.worktrees/` (already in .gitignore)
