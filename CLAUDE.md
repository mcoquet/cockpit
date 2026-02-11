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

1. **Ticket first** - Never start work without an existing issue in beads (`bd show <id>`)
2. **Claim and plan** - Before coding: claim the ticket (`bd update <id> --status=in_progress`) and invoke appropriate superpowers skills
3. **No premature commits** - Make changes, then wait for user to validate
4. **User confirms before done** - Always ask user to test before committing/pushing

### User Intent: "Feature" or "Bug" = Create Ticket

When the user says things like:
- "new feature: ..."
- "bug: ..."
- "idea: ..."
- "we should add ..."

**This means: Create a beads ticket, NOT start implementation.**

```bash
bd create --title="<description>" --type=feature|bug|task --priority=2
```

Wait for explicit instruction to work on a ticket (e.g., "work on cockpit-xxx").

### Correct Flow
```
bd show <id>                         # Review the issue
bd update <id> --status=in_progress  # Claim it
# Invoke relevant superpowers skills (see below)
# Make code changes
# Ask user to test (npm run dev)
# Wait for user confirmation
# Only then: commit, push, close issue
```

## Superpowers Skills

The superpowers plugin provides structured workflows for common development tasks. **Invoke relevant skills BEFORE taking action** - even a 1% chance a skill might apply means you should check.

### When to Use Each Skill

| Skill | When to Use |
|-------|-------------|
| `brainstorming` | **BEFORE any creative work** - new features, components, modifications. Explores intent and requirements first. |
| `systematic-debugging` | **Any bug, test failure, or unexpected behavior**. MUST complete root cause investigation before proposing fixes. |
| `test-driven-development` | **Any feature or bugfix**. Write failing test first, watch it fail, then implement. No exceptions. |
| `verification-before-completion` | **Before claiming work is done**. Run verification commands, show evidence, THEN claim success. |
| `writing-plans` | **Multi-step tasks with requirements**. Creates detailed implementation plans with bite-sized steps. |
| `executing-plans` | **Execute a written plan** in a separate session with review checkpoints. |
| `subagent-driven-development` | **Execute plan tasks** in current session with fresh subagent per task + two-stage review. |
| `dispatching-parallel-agents` | **2+ independent problems** (different test files, different subsystems). One agent per problem domain. |
| `using-git-worktrees` | **Feature work needing isolation**. Creates isolated workspace before implementation. |
| `finishing-a-development-branch` | **Implementation complete, tests pass**. Guides merge, PR creation, or cleanup. |
| `requesting-code-review` | **After completing tasks** or before merging. Catches issues early. |
| `receiving-code-review` | **When receiving review feedback**. Verify before implementing; push back if technically wrong. |

### Skill Priority Order

When multiple skills could apply:
1. **Process skills first** (brainstorming, debugging) - determine HOW to approach
2. **Implementation skills second** (TDD, plans) - guide execution

Example: "Build feature X" → brainstorming first, then TDD during implementation.

### Key Skill Rules

**Brainstorming (`/brainstorming`)**
- One question at a time, prefer multiple choice
- Propose 2-3 approaches with trade-offs
- Present design in 200-300 word sections, validate each
- Write validated design to `docs/plans/YYYY-MM-DD-<topic>-design.md`

**Systematic Debugging (`/systematic-debugging`)**
- **Iron Law**: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
- Four phases: Root Cause → Pattern Analysis → Hypothesis Testing → Implementation
- If 3+ fixes fail: question architecture, don't attempt fix #4 without discussion
- Red flags: "Quick fix for now", "Just try changing X", "Probably X"

**TDD (`/test-driven-development`)**
- **Iron Law**: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
- Red-Green-Refactor cycle: Write test → watch fail → minimal code → watch pass → clean up
- Wrote code before test? Delete it. Start over. No exceptions.
- Test passes immediately? Fix the test - it's testing existing behavior.

**Verification Before Completion (`/verification-before-completion`)**
- **Iron Law**: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
- Run the command in THIS message before claiming it passes
- Forbidden: "Should work now", "I'm confident", expressing satisfaction before verification
- Required: `[Run command] [See output] "Verified: [claim]"`

**Writing Plans (`/writing-plans`)**
- Bite-sized steps (2-5 minutes each): write test, run it, implement, run tests, commit
- Exact file paths, complete code, exact commands with expected output
- Save to `docs/plans/YYYY-MM-DD-<feature-name>.md`

### Red Flag Thoughts - STOP and Use Skill

| Thought | Reality | Skill Needed |
|---------|---------|--------------|
| "This is just a simple question" | Questions are tasks. Check for skills. | using-superpowers |
| "Let me explore first" | Skills tell you HOW to explore. | brainstorming |
| "Quick fix for now" | Symptom fixes mask root causes. | systematic-debugging |
| "I'll test after" | Tests passing immediately prove nothing. | test-driven-development |
| "Should work now" | Confidence ≠ evidence. | verification-before-completion |
| "Skip TDD just this once" | That's rationalization. | test-driven-development |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. | systematic-debugging |

### Worktree Configuration

Worktrees for isolated feature work go in `.worktrees/` (already in .gitignore).
