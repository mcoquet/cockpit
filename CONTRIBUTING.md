# Contributing to Cockpit

## Development setup

```bash
# Clone the repo
git clone https://github.com/mcoquet/cockpit.git
cd cockpit

# Install dependencies
npm install

# Run in development (watches main + renderer + starts Electron)
npm run dev
```

## Build commands

```bash
npm run dev          # Watch mode + Electron
npm run build        # Production build
npm run package      # Create .app bundle
```

The packaged app will be in `out/mac-arm64/Cockpit.app`.

## Project structure

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

## Architecture

This is an Electron app with the standard three-process model:

- **Main process** (`src/main/`) - Node.js backend, manages tray/window, handles IPC
- **Preload** (`src/preload.ts`) - Bridge exposing `window.cockpit` API to renderer
- **Renderer** (`src/renderer/`) - React UI built with Vite

## Debugging

Production logs: `~/Library/Logs/Cockpit/main.log`

## Requirements

- Node.js 18+
- macOS (Electron targets macOS only)
