# Session History Browser Design

**Issue:** cockpit-ni0
**Date:** 2026-02-13

## Overview

Add the ability to browse and open previous Claude Code sessions from a project's history. Users can expand a project row to see past sessions, click to resume them, or delete unwanted sessions.

## Requirements

- Expand project row via disclosure triangle to reveal past sessions
- Show date/time + last user message for each session
- Display 5 most recent sessions with "Show more" button
- Click session to resume it (in-place, not forked)
- Right-click session to delete (with confirmation)
- Hide disclosure triangle if project has no session history

## Data Layer

### Session Storage Location

Claude Code stores sessions as `.jsonl` files in:
```
~/.claude/projects/<encoded-path>/<session-id>.jsonl
```

Path encoding (Claude's algorithm):
```typescript
function encodeProjectPath(absolutePath: string): string {
  return '-' + absolutePath.slice(1).replace(/[\/\.]/g, '-');
}
```

Example: `/Users/miguel/projects/cockpit` → `-Users-miguel-projects-cockpit`

### Session Metadata Extraction

Parse each `.jsonl` file to extract:
- `sessionId`: from filename (UUID)
- `lastModified`: file mtime
- `lastUserMessage`: scan for last `type: "user"` entry, extract first ~100 chars

### New Types

```typescript
// In shared/types.ts
interface SessionInfo {
  sessionId: string;
  lastModified: Date;
  lastUserMessage: string | null;
}
```

### New Module: `src/main/sessions.ts`

```typescript
// Get sessions for a project
getProjectSessions(projectPath: string, limit?: number): Promise<SessionInfo[]>

// Delete a session file
deleteSession(projectPath: string, sessionId: string): Promise<void>
```

## UI Components

### Project Row Changes

- Add disclosure triangle (▶/▼) to left of project name
- Only show triangle if project has session history
- Triangle click toggles expansion (doesn't open session)
- Row click still opens most recent session (current behavior)
- Track expanded state: `expandedProjects: Set<string>`

### Session List

Inline list under expanded project:
- Indented rows showing relative date + truncated last message
- Click → opens session via `--resume <id>`
- Right-click → context menu with "Delete Session"
- "Show more" button loads next 5 sessions

Visual structure:
```
▼ cockpit                           ●
    2 hours ago · "lets work on cockpit-ni0..."
    Yesterday · "fix the terminal resize bug..."
    Feb 10 · "add bell notification support..."
    [Show more]
▶ aurora
```

## IPC & API Layer

### New IPC Handlers

```typescript
// main/index.ts
ipcMain.handle('get-project-sessions', async (_, projectPath: string, limit?: number) => {
  return getProjectSessions(projectPath, limit ?? 5);
});

ipcMain.handle('delete-session', async (_, projectPath: string, sessionId: string) => {
  // Show confirmation dialog first
  return deleteSession(projectPath, sessionId);
});

ipcMain.handle('open-session-by-id', async (_, projectPath: string, sessionId: string) => {
  // Spawns: claude --resume <sessionId>
});
```

### Preload API Additions

```typescript
// Add to CockpitAPI interface
getProjectSessions: (path: string, limit?: number) => Promise<SessionInfo[]>;
deleteSession: (path: string, sessionId: string) => Promise<void>;
openSessionById: (path: string, sessionId: string) => Promise<void>;
```

### PTY Changes

Modify `spawnClaude()` to accept optional `sessionId` parameter:
- When provided: use `--resume <sessionId>`
- When absent: use `--continue` (current behavior)

## Edge Cases & Error Handling

### No Sessions Found
- Hide disclosure triangle entirely
- Project row looks the same as today

### Corrupted Session Files
- Skip files that fail to parse
- Log warning, don't crash
- Show sessions that did parse successfully

### Session Deleted Externally
- Claude CLI handles gracefully
- Show error notification: "Session not found"

### Delete Confirmation
- Show dialog: "Delete this session? This cannot be undone."
- Use Electron's `dialog.showMessageBox`

### Large Session Files
- Read from end of file to find last user message
- Use `fs.read()` with position offset (last ~50KB)
- Scan backwards for last `"type":"user"` entry

### Performance
- Load sessions on-demand when expanding
- Cache in memory during popup lifetime
- Clear cache when popup closes
