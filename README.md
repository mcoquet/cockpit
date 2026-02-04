# Cockpit

A macOS menubar app for managing Claude Code projects with embedded terminal windows.

![macOS](https://img.shields.io/badge/macOS-000000?style=flat&logo=apple&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)

## Features

- **Menubar Quick Access** - Click the tray icon (λ) or press **Cmd+N** to see all your projects
- **Embedded Terminals** - Each project opens in its own terminal window with xterm.js
- **Session Management** - Track active sessions, focus existing windows, or force new sessions (Cmd+click)
- **Project Indicators** - Visual indicators in project list and terminal titles:
  - `🐙` GitHub repository
  - `⎇` Git repository without GitHub (orange)
  - `◆` Has beads issue tracker (purple)
- **Keyboard-First Workflow** - Arrow keys to navigate, Enter to open, search to filter
- **Safe Quit** - Confirmation dialog when quitting with active sessions
- **Auto-detect Claude** - Finds claude CLI at common paths (`~/.claude/bin/claude`, `/usr/local/bin/claude`, `/opt/homebrew/bin/claude`)

## Installation

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

1. Click the menubar icon (λ) or press **Cmd+N** to open the project list
2. Use **arrow keys** to navigate, **Enter** to open, or type to search/filter
3. Click **+ Add Project** to add a project folder (auto-opens a session)
4. **Cmd+click** to force a new session even if one exists
5. **Right-click** a project to edit its name/description or remove it

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+N | Open/toggle project list |
| ↑/↓ | Navigate projects |
| Enter | Open selected project |
| Type | Filter projects by name/description |

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
