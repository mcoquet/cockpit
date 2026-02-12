# Right-Click Context Menu for Terminal Links

**Issue:** cockpit-rdq
**Date:** 2026-02-12

## Overview

Add a right-click context menu when clicking on detected links (URLs, file paths) or selected text in the terminal window.

## Menu Options

**For links (URLs and file paths):**
- Open (browser for URLs, Finder/default app for files)
- Copy

**For selected text:**
- Copy

**Both (link + selection):**
- Open, Copy Link, separator, Copy Selection

**No link + no selection:** Don't show menu

## Architecture

1. **Renderer (Terminal.tsx)**: Captures `contextmenu` event, detects link at click position and selected text, sends IPC request.

2. **Preload (preload.ts)**: Exposes `window.terminal.showContextMenu()` API.

3. **Main (index.ts)**: Receives IPC, builds native `Menu`, handles actions.

## Detection Strategy

On right-click:
1. Get click position in buffer coordinates
2. Get line text at that position
3. Run link detection regex (URL + file path patterns) on the line
4. Check if click X position falls within any match range
5. Combine with `terminal.getSelection()` for selected text

No hover tracking - detection happens at click time. Existing cursor style on hover stays as-is.

## IPC Contract

```typescript
showContextMenu: (options: {
  hasSelection: boolean;
  selectedText?: string;
  link?: { type: 'url' | 'path'; text: string };
}) => void;
```

## Code Changes

| File | Changes |
|------|---------|
| `src/renderer/Terminal.tsx` | Add `contextmenu` listener, link detection at click position |
| `src/preload.ts` | Add `showContextMenu` to terminal API |
| `src/main/index.ts` | Add IPC handler, build Menu, execute actions |
| `src/shared/types.ts` | Add `ContextMenuOptions` type |

## Actions

- Open URL: `shell.openExternal(url)`
- Open path: `shell.openPath(expandedPath)`
- Copy: `clipboard.writeText(text)`

## Edge Cases

- No link + no selection: Don't show menu
- Selection spanning multiple lines: Handled by `terminal.getSelection()`
- Menu dismissed without action: No-op (Electron handles)
