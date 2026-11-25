# Contributing to Cockpit

## Development setup

Requires macOS and Node.js 22 (what CI uses).

```bash
git clone https://github.com/mcoquet/cockpit.git
cd cockpit
npm ci          # also sets core.hooksPath to .githooks and rebuilds node-pty for Electron
npm run dev     # watch main + renderer and start Electron
```

## Commands

```bash
npm run dev          # Watch mode + Electron
npm test             # Build the main process and run the unit tests in test/
npm run build        # Production build
npm run package      # Create the .app and DMG in out/
```

## How the code is organised

- [`ARCHITECTURE.md`](ARCHITECTURE.md): code map, invariants and cross-cutting concerns.
- [`GLOSSARY.md`](GLOSSARY.md) and [`docs/domain-model.md`](docs/domain-model.md): the vocabulary and how the concepts relate.
- [`docs/architecture/`](docs/architecture/README.md): system context and container diagrams.
- [`docs/adr/`](docs/adr/): decisions and why they were made.

## Debugging

Production logs: `~/Library/Logs/Cockpit/main.log`. In `npm run dev`, terminal windows open DevTools.
