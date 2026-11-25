# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cockpit is a macOS menubar app (λ in the menubar) for launching Claude Code in local projects. It lists the user's projects and their conversation history, opens each terminal session in its own built-in terminal window, and runs per-project schedules.

Where to read next:

- [`ARCHITECTURE.md`](ARCHITECTURE.md): code map, invariants, cross-cutting concerns. Start here before changing code.
- [`GLOSSARY.md`](GLOSSARY.md): what the words mean. "Session" on its own is ambiguous: use **terminal session**, **conversation** or **restore set**.
- [`docs/domain-model.md`](docs/domain-model.md): how projects, terminal sessions, conversations and schedules relate, and what must always hold.
- [`docs/architecture/`](docs/architecture/README.md): C4 context and container diagrams.
- [`docs/adr/`](docs/adr/): why the hard-to-reverse choices were made.

## Development Commands

```bash
npm run dev              # Watch main + renderer and start Electron (NODE_ENV=development)
npm run build            # Build main (tsc) and renderer (Vite)
npm run build:main       # TypeScript main process + preload only → dist/main/
npm run build:renderer   # Vite renderer only → dist/renderer/
npm start                # Run the built app
npm run package          # Build + electron-builder → out/
```

`npm run dev` shows Ω instead of λ in the menubar and can run next to the installed app. Production logs: `~/Library/Logs/Cockpit/main.log`.

## Releases

### Creating a Release

```bash
git tag v0.7.0 && git push origin main v0.7.0
```

The pre-push hook (`.githooks/pre-push`) automatically syncs `package.json` version when pushing a version tag. If the version doesn't match, it updates package.json and package-lock.json, commits, moves the tag, and **aborts the push**. Run the same `git push` again: the second push sends `main` and the tag together. (Git resolves refs before the hook runs, so letting the first push continue would leave the bump commit off `main`.)

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

## Methodology

This project uses the `doc-mastery` plugin (Superpowers plus living documentation; see `.claude/settings.json`). Its rules load at session start. This file records only what is specific to this project and wins over the plugin's rules.

## Setup and test commands

- Install / setup: `npm ci` (also sets `core.hooksPath` to `.githooks` and rebuilds `node-pty` for Electron)
- Run the full test suite: `npm test` (builds the main process, then runs `node --test` over `test/**/*.test.js`)
- Run a single test: `npm run build:main && node --test test/<file>.test.js` (add `--test-name-pattern="<name>"` for one case)
- Lint / format: none configured
- Render-check Mermaid diagrams (C4, domain model): none set up yet; check syntax against the `c4-architecture` skill's `references/c4-syntax.md`

## Living documentation

The doc-mastery rules decide when `GLOSSARY.md`, `docs/domain-model.md`, `docs/architecture/` and `docs/adr/` change. In addition, update **`ARCHITECTURE.md`** in the same change when:

- a file or folder is added, removed, renamed or changes responsibility in `src/`, `test/`, `.githooks/` or `.github/workflows/`;
- an invariant listed there is added, broken on purpose, or no longer holds;
- a cross-cutting concern changes (logging, persistence, dev/prod differences, upgrade restart, error handling).

Design docs and plans written before doc-mastery are in `docs/plans/`. They are history: never edit them, and don't add new ones there.
