# Cockpit

A macOS menubar app for managing Claude Code projects with embedded terminal windows.

![macOS](https://img.shields.io/badge/macOS-000000?style=flat&logo=apple&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)

## Features

- **Menubar Quick Access** - Click the tray icon (λ) to see all your projects
- **Embedded Terminals** - Each project opens in its own terminal window with xterm.js
- **Dark Native UI** - Terminal windows blend seamlessly with dark title bars
- **Session Management** - Track active sessions, focus existing windows, or force new sessions (Cmd+click)
- **Smart Dock Behavior** - App hides from Dock when no sessions are running
- **Bell Notifications** - macOS notifications when Claude needs attention (with 10s debounce)
- **Project Indicators** - Visual indicators in project list and terminal titles:
  - `🐙` GitHub repository
  - `⎇` Git repository without GitHub (orange)
  - `◆` Has beads issue tracker (purple)
- **Keyboard-First Workflow** - Arrow keys to navigate, Enter to open, Escape to close, search to filter
- **Window Cycling** - **Cmd+`** cycles through terminal windows from anywhere
- **Safe Quit** - Confirmation dialog when quitting with active sessions
- **Auto-detect Claude** - Finds claude CLI at common paths (`~/.claude/bin/claude`, `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`)

## Installation

### Homebrew (Recommended)

```bash
brew tap mcoquet/cockpit
brew install --cask cockpit
```

> **Note:** The app is unsigned. On first launch, right-click the app and select "Open" to bypass Gatekeeper.

### From Releases

Download the latest DMG from [GitHub Releases](https://github.com/mcoquet/cockpit/releases):
- `Cockpit-{version}-arm64.dmg` - Apple Silicon (M1/M2/M3)
- `Cockpit-{version}-x64.dmg` - Intel

### From Source

```bash
# Clone the repo
git clone https://github.com/mcoquet/cockpit.git
cd cockpit

# Install dependencies (rebuilds node-pty for Electron)
npm install

# Run in development
npm run dev

# Build and package
npm run package
```

The packaged app will be in `out/mac-arm64/Cockpit.app`.

## Usage

1. Click the menubar icon (λ) to open the project list (or **Cmd+N** when Cockpit is active)
2. Use **arrow keys** to navigate, **Enter** to open, or type to search/filter
3. Click **+ Add Project** to add a project folder (auto-opens a session)
4. **Cmd+click** to force a new session even if one exists
5. **Right-click** a project to edit its name/description or remove it

### Keyboard Shortcuts

| Shortcut | Action | Scope |
|----------|--------|-------|
| Cmd+N | Open/toggle project list | When Cockpit is active |
| Cmd+` | Cycle through terminal windows | Global |
| Escape | Unfocus search / close popup | In popup |
| ↑/↓ | Navigate projects | In popup |
| Enter | Open selected project | In popup |
| Type | Filter projects by name/description | In popup |

### Terminal Input

| Shortcut | Action |
|----------|--------|
| Enter | Submit prompt to Claude |
| Alt+Enter | Insert newline (multiline input) |

> **Note:** Shift+Enter does not work for newlines due to [xterm.js lacking kitty keyboard protocol support](https://github.com/xtermjs/xterm.js/issues/4198). Use Alt+Enter instead.

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── index.ts    # App entry, tray, IPC handlers
│   ├── claude.ts   # Claude CLI detection
│   ├── pty.ts      # PTY session management
│   ├── terminal-window.ts  # Terminal window factory
│   └── store.ts    # Project persistence
├── renderer/       # React UI (Vite)
│   ├── App.tsx     # Tray popup UI
│   └── Terminal.tsx # xterm.js terminal
├── preload.ts      # IPC bridge
└── shared/types.ts # Shared TypeScript types
```

## Development

```bash
npm run dev          # Watch mode + Electron
npm run build        # Production build
npm run package      # Create .app bundle
```

## Requirements

- macOS
- Node.js 18+
- [Claude Code CLI](https://claude.ai/code) installed

## License

ISC
