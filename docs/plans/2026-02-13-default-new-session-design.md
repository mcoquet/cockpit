# Default to New Session When Selecting Project

**Ticket:** cockpit-35l
**Date:** 2026-02-13

## Problem

With explicit session history management now available, the default behavior when selecting a project should start a new session. Continuing existing sessions should be explicit via the history list.

## Current Behavior

- Click project → continues existing session if one exists
- Cmd+click → forces new session
- History list → continues selected session

## New Behavior

- Click project → always starts new session
- Cmd+click → same as regular click (no special behavior)
- History list → continues selected session (unchanged)

## Solution

Change `handleProjectClick` in `src/renderer/App.tsx`:

```typescript
async function handleProjectClick(project: Project, e: React.MouseEvent) {
  await window.cockpit.openSession(project.path, true);  // Always new session
  const updated = await window.cockpit.getActiveSessions();
  setSessions(updated);
}
```

Keyboard navigation (Enter key) already calls `handleProjectClick`, so it automatically gets the same behavior.
