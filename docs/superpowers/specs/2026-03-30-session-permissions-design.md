# Session Permissions UI - Design Spec

**Issue:** [#37](https://github.com/mcoquet/cockpit/issues/37) - Add a way to set permissions in a given session from the tray icon and from the terminal header

**Date:** 2026-03-30

## Problem

Cockpit currently spawns Claude Code sessions with no permission flags. There's no way to:
- Choose a permission mode when launching a session
- See what permission mode a running session is in
- Change permissions for a running session from Cockpit's UI

## Permission Modes

Claude Code supports 6 permission modes via `--permission-mode`:

| Mode | Behavior | Badge color |
|------|----------|-------------|
| `default` | Asks for permission on each action | *(no badge shown)* |
| `acceptEdits` | Auto-accepts file edits, still asks for commands | Yellow |
| `plan` | Read-only, no edits or commands | Blue |
| `auto` | Auto-accepts most actions | Orange |
| `dontAsk` | Accepts all actions without prompting | Red |
| `bypassPermissions` | Skips all permission checks | Dark red |

All 6 modes are exposed in the UI. Cockpit doesn't gatekeep what the CLI already offers.

Note: `bypassPermissions` also requires passing `--dangerously-skip-permissions` to the CLI.

## Data Model

### New type (`src/shared/types.ts`)

```typescript
type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';
```

### Project (updated)

```typescript
interface Project {
  path: string;
  name?: string;
  description?: string;
  hasGit?: boolean;
  githubUrl?: string;
  permissionMode?: PermissionMode; // NEW - per-project default, undefined = 'default'
}
```

### ActiveSession (updated)

```typescript
interface ActiveSession {
  sessionId: string;
  windowId: number;
  permissionMode: PermissionMode; // NEW - mode this session launched with
}
```

No global default mode setting. Permission mode is always per-project.

## UI Surfaces

### 1. Project Editor — Set Per-Project Default

The existing ProjectEditor Details tab (right-click a project) gets a new "Permission Mode" field below Description. A `<select>` dropdown with all 6 modes:

- Default (no flag)
- Accept Edits
- Plan (read-only)
- Auto
- Don't Ask
- Bypass Permissions

Saved via the existing `onSave` -> `updateProject` flow. The `permissionMode` field is stored in electron-store alongside other project data.

### 2. Popup Window — Launch with Mode

**Normal click:** Launches with the project's stored `permissionMode` (or `'default'` if unset). No UI interruption — same behavior as today, just now respects the stored mode.

**Option+click (modifier key override):** Instead of launching immediately, the main process builds a native macOS context menu (`Menu.buildFromTemplate`) with all 6 modes. The project's current default has a checkmark. User picks a mode, and the session launches with that mode. This is a one-shot override — it does not change the project's stored default.

**Implementation:**
- The renderer detects `altKey` on the click event and sends it along with the `openSession` IPC call
- Main process either launches directly (normal) or shows the native context menu (Option held), then launches with the selected mode

### 3. Terminal Header — Badge Display

A color-coded text pill appears in the drag-region of the terminal window, right-aligned relative to the project title:

```
[traffic lights]  🐙 my-project                    [auto]
```

**Display rules:**
- Hidden when mode is `default` (reduces noise — most sessions won't show a badge)
- Badge text uses short labels: `plan`, `edits`, `auto`, `dontAsk`, `bypass`
- Color-coded per the table above (blue, yellow, orange, red, red)

**Data flow:**
- Permission mode is passed to the terminal window via URL params (like `title` and `githubUrl` already are)
- Terminal reads it on load and renders the badge

### 4. Terminal Badge — Click to Change Mode

Clicking the badge opens a styled dropdown popover anchored to the badge. The dropdown lists all 6 modes with the current one highlighted.

Selecting a different mode:
1. Updates the badge text and color immediately
2. Sends an IPC message to main process
3. Main process injects `/permissions <mode>\n` into the PTY (writes to the pty process stdin)
4. Main process updates the `ActiveSession` record

This is best-effort — it works when Claude is idle at the prompt. If Claude is mid-response, the injected text will appear in the terminal but may not take effect until the next prompt. This is an accepted limitation.

**When no badge is shown (default mode):** There needs to be a way to open the dropdown even when in default mode. Options:
- Always show a subtle badge area (e.g., a small gear or shield icon) that becomes the colored pill for non-default modes
- Or: right-click the drag-region to access permission mode

We'll use a small shield icon (🛡) that's always present in the drag-region. For non-default modes, it renders as the colored pill with mode text. For default mode, it shows as a muted/dim shield icon. Clicking it always opens the dropdown regardless of current mode.

## Spawn Changes

### `src/main/pty.ts`

`spawnClaude` options gains `permissionMode?: PermissionMode`:

```typescript
export function spawnClaude(
  projectPath: string,
  claudePath: string,
  options?: {
    continueSession?: boolean;
    resumeSessionId?: string;
    permissionMode?: PermissionMode;
  }
): { id: string; process: IPty }
```

Arg building:
- If `permissionMode` is set and not `'default'`, add `--permission-mode <mode>`
- If `permissionMode` is `'bypassPermissions'`, also add `--dangerously-skip-permissions`

### `src/main/index.ts`

- `openSession` IPC handler accepts optional `permissionMode` and `altKey` parameters
- When `altKey` is true, show native context menu for mode selection before launching
- `openSessionForProject` passes mode through to `spawnClaude` and `createTerminalWindow`
- `activeSessions` record includes `permissionMode`
- New IPC handler `change-permission-mode` accepts `sessionId` and `newMode`, writes `/permissions <mode>\n` to the PTY, and updates the session record

### `src/main/terminal-window.ts`

`TerminalWindowOptions` gains `permissionMode?: PermissionMode`. Passed to the renderer via URL query params.

### `src/preload.ts`

- `openSession` signature extended: `(path: string, forceNew?: boolean, options?: { permissionMode?: PermissionMode; altKey?: boolean })` — or the IPC call passes these as additional args
- New `changePermissionMode(sessionId: string, mode: PermissionMode)` on the terminal API

### `src/renderer/App.tsx`

- Click handler checks `event.altKey` and passes it through the IPC call
- No other visual changes to the project list for MVP

### `src/renderer/Terminal.tsx`

- Reads `permissionMode` from URL params on load
- Renders the badge pill in the drag-region (right side)
- Badge click opens a dropdown popover component with mode list
- On selection, calls `window.terminal.changePermissionMode(mode)`
- Local state tracks current mode (initialized from URL param, updated on change)

### `src/renderer/ProjectEditor.tsx`

- Details tab gets a `<select>` for Permission Mode between Description and the path display
- Options: Default, Accept Edits, Plan, Auto, Don't Ask, Bypass Permissions
- Value bound to project's `permissionMode` (default selected when undefined)
- Included in the `onSave` payload

## Files Changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `PermissionMode` type, update `Project` and `ActiveSession` |
| `src/main/pty.ts` | Accept `permissionMode` in options, build CLI args |
| `src/main/index.ts` | Update IPC handlers, add Option+click menu, add `change-permission-mode` handler |
| `src/main/terminal-window.ts` | Extend options with `permissionMode`, pass via URL params |
| `src/preload.ts` | Extend `openSession` args, add `changePermissionMode` to terminal API |
| `src/renderer/App.tsx` | Detect `altKey` on click, pass through IPC |
| `src/renderer/Terminal.tsx` | Render badge, dropdown popover, handle mode changes |
| `src/renderer/ProjectEditor.tsx` | Add permission mode `<select>` to Details tab |

## Accepted Limitations

- **Mode desync:** If the user types `/permissions` directly in the terminal, Cockpit's badge won't update. We display "launched as X" and update on dropdown changes only. Detecting PTY output for `/permissions` responses is fragile and not worth the complexity.
- **Mid-response injection:** Injecting `/permissions` while Claude is generating output is best-effort. The text will queue in the PTY input buffer and take effect when Claude returns to the prompt.
- **No global default:** Per-project only. A global default adds settings complexity without clear value — most users either use `default` everywhere or set specific projects differently.
