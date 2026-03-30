# Session Permissions UI - Design Doc

**Issue:** [#37](https://github.com/mcoquet/cockpit/issues/37) - Add a way to set permissions in a given session from the tray icon and from the terminal header

**Date:** 2026-03-30

## Problem

Cockpit currently spawns Claude Code sessions with no permission flags - users get the default interactive permission mode. There's no way to:
- Choose a permission mode when launching a session
- See what permission mode a running session is in
- Change permissions for a running session

Claude Code supports these permission modes via `--permission-mode`:
| Mode | Behavior |
|------|----------|
| `default` | Asks for permission on each action |
| `acceptEdits` | Auto-accepts file edits, still asks for commands |
| `plan` | Read-only, no edits or commands |
| `auto` | Auto-accepts most actions |
| `bypassPermissions` | Skips all checks (requires `--allow-dangerously-skip-permissions`) |

Additionally, `--allowedTools` and `--disallowedTools` provide granular tool-level control.

## Constraints

- **Permission mode is set at spawn time** via CLI flags - it cannot be changed mid-session through the CLI
- Inside a running session, users can type `/permissions` to change the mode interactively
- Cockpit spawns Claude via `node-pty` in `src/main/pty.ts`

## Design Options

### Option A: Permission Mode Selector at Launch Time

Add a permission mode picker that's used when launching new sessions.

**Tray/Popup UI:**
- Add a small permission mode indicator next to each project in the popup (e.g., a shield icon or text badge)
- Default mode configurable in Settings
- Right-click on a project to pick a different mode before launching
- Or: add a "mode" dropdown/toggle in the popup header that applies to the next session launched

**Terminal header:**
- Show current permission mode as a badge in the terminal window title bar area
- Clicking it is informational only (can't change mid-session via CLI flag)

**Pros:** Simple, clean, matches how Claude Code actually works
**Cons:** Can't change permissions after session starts (but `/permissions` command exists for that)

### Option B: Full Permission Control with Mid-Session Changes

Support changing permissions in running sessions by injecting the `/permissions` command into the PTY.

**Tray icon:**
- Right-click a running session in the tray menu -> submenu with permission modes
- Selecting one sends `/permissions` + mode selection keystrokes to the PTY

**Terminal header:**
- Add a clickable permission mode badge to the terminal chrome (above the xterm area)
- Clicking opens a dropdown of modes; selecting one injects `/permissions` into the terminal

**Pros:** Full control from any surface
**Cons:** Fragile - depends on `/permissions` command format staying stable, needs to handle timing (what if Claude is mid-response?), injecting input feels hacky

### Option C: Project-Level Permission Presets

Store a default permission mode per project, applied automatically at launch.

**Settings/Project config:**
- In project settings (right-click project -> Settings), add a "Default permission mode" picker
- Stored in `electron-store` alongside project data

**Tray icon:**
- Shows current default mode per project as a subtle indicator
- Quick-switch via right-click submenu

**Terminal header:**
- Badge shows the mode the session was launched with

**Pros:** Set-and-forget for trusted projects, good for "this project always runs in auto mode"
**Cons:** Doesn't help with one-off permission changes

### Option D: Hybrid (Recommended)

Combine Options A + C: project-level defaults + per-launch override.

**Data model changes:**
```typescript
interface Project {
  path: string;
  name?: string;
  // ... existing fields
  permissionMode?: PermissionMode; // default for this project
}

type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto';
// Note: bypassPermissions excluded from UI - too dangerous for a quick-click
```

**Surface 1 - Popup window (project list):**
- Each project row shows a small permission mode icon/badge (e.g., shield variants)
- Modifier key behavior: hold Option+click to launch with a different mode (shows mode picker)
- Global default mode in Settings

**Surface 2 - Tray context menu:**
- When right-clicking the tray, active sessions show their permission mode
- Submenu per session: "Permission Mode" -> shows current (checked) + options
- Selecting a different mode for a running session: show tooltip "Use /permissions inside the terminal to change mode"

**Surface 3 - Terminal window header:**
- Add a permission mode badge to the terminal title bar area (the `hiddenInset` region or a custom toolbar)
- Badge color-coded: green (default), yellow (acceptEdits), blue (plan), orange (auto)
- Clicking the badge: for now, informational tooltip saying "Launched in X mode. Type /permissions to change."
- Future: could inject `/permissions` command if we want

**Spawn changes (`pty.ts`):**
```typescript
function spawnClaude(options: {
  projectPath: string;
  continueSession?: boolean;
  forceNew?: boolean;
  resumeSessionId?: string;
  permissionMode?: PermissionMode; // NEW
}): string {
  const args: string[] = [];

  if (options.permissionMode && options.permissionMode !== 'default') {
    args.push('--permission-mode', options.permissionMode);
  }

  // ... existing arg logic
}
```

**Track active session mode:**
```typescript
interface PtySession {
  // ... existing fields
  permissionMode: PermissionMode;
}
```

## Recommended Approach: Option D (Hybrid)

### Phase 1 - MVP
1. Add `permissionMode` to Project type (stored default)
2. Pass `--permission-mode` flag when spawning Claude
3. Show mode badge in terminal window title (e.g., append to title: "project (Auto)")
4. Add "Default Permission Mode" to project right-click menu in popup
5. Track mode in `PtySession` and expose via IPC

### Phase 2 - Polish
1. Permission mode indicator in popup project list
2. Option+click to override mode at launch time
3. Color-coded badge in terminal header area
4. Global default mode in Settings

### Phase 3 - Advanced (Optional)
1. Mid-session mode change by injecting `/permissions` (only when Claude is idle at prompt)
2. `--allowedTools` / `--disallowedTools` presets per project
3. Permission templates (named presets like "Review Mode" = plan, "Trusted Dev" = auto)

## Open Questions

1. **Should `bypassPermissions` be exposed in the UI?** It's dangerous and requires `--allow-dangerously-skip-permissions`. Suggest: hide behind a Settings toggle or don't expose at all.
2. **How to detect current permission mode of a running session?** We only know what we launched with. If the user changes it via `/permissions`, we're out of sync. Accept this limitation or try to detect mode changes in PTY output?
3. **Icon/badge design for each mode?** Could use shield icons with different fills, or simple text labels.
4. **Should the popup show mode before or after clicking?** Showing it always adds visual noise; showing on hover is more subtle but less discoverable.
