# External Terminal Shortcut Design

**Issue:** cockpit-aby
**Date:** 2026-02-11

## Overview

Add `Cmd+T` shortcut in terminal windows to open the user's preferred terminal app in the project's working directory.

## Requirements

- Shortcut: `Cmd+T`
- Configurable terminal app in Settings
- Default: Terminal.app
- Supported terminals: Terminal.app, iTerm2, Warp, Kitty, custom

## Settings UI

New dropdown in Settings window:
- Label: "External Terminal"
- Options: Terminal (default), iTerm, Warp, Kitty, Other...
- "Other..." opens Finder at `/Applications` to select a `.app` bundle
- Custom app name shown in dropdown after selection

**Storage format:** `externalTerminal` in electron-store
- Values: `"terminal"` | `"iterm"` | `"warp"` | `"kitty"` | `"custom:AppName"`

## Terminal Opening Logic

| Terminal | Method |
|----------|--------|
| Terminal.app | AppleScript: `tell application "Terminal" to do script "cd /path"` |
| iTerm2 | AppleScript: `tell application "iTerm" to create window with default profile command "cd /path && exec $SHELL"` |
| Warp | `open -a Warp /path` |
| Kitty | `open -a kitty /path` |
| Custom | `open -a "AppName" /path` |

**Error handling:** If app not found, show dialog offering to open Settings.

## Code Changes

1. **`src/shared/types.ts`** - Add `externalTerminal` to `AppSettings`
2. **`src/main/settings.ts`** - Add default value
3. **`src/renderer/Settings.tsx`** - Add dropdown + file picker for "Other"
4. **`src/main/terminal-window.ts`** - Change shortcut to `Cmd+T`, support multiple terminals
5. **`src/main/index.ts`** - Update menu item, add IPC handler for file picker
