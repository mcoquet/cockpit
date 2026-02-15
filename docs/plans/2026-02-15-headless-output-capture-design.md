# Headless Schedule Output Capture

## Problem

Headless scheduled tasks run Claude CLI with `stdio: 'ignore'`, discarding all output. Users cannot see what Claude did, debug failures, or review completed work.

## Solution

Capture stdout/stderr from headless runs, store in the schedule run record, and stream live to the UI.

## Design

### Data Model

Extend `ScheduleRun` with output field:

```typescript
export interface ScheduleRun {
  id: string;
  scheduleId: string;
  startedAt: number;
  completedAt?: number;
  status: 'queued' | 'running' | 'success' | 'failed';
  error?: string;
  output?: string;  // NEW: Full stdout/stderr from headless run
}
```

Output stored in electron-store (`scheduleRuns` array in projects.json). Kept forever until manually deleted.

### Capture Mechanism

In `scheduler-executor.ts`, change spawn to pipe stdout/stderr:

```typescript
const child = spawn(claudePath, ['-p', schedule.prompt], {
  cwd: expandedPath,
  stdio: ['ignore', 'pipe', 'pipe'],  // stdin ignored, stdout/stderr piped
  env: getClaudeSpawnEnv(claudePath),
});

let output = '';
child.stdout.on('data', (data) => {
  output += data.toString();
  // Emit IPC event for live streaming
});
child.stderr.on('data', (data) => {
  output += data.toString();
});
```

The executor returns captured output to `scheduler.ts` which stores it in the run record.

### Live Streaming

Real-time output to UI via IPC:

1. **Main process emits** `schedule-run-output` events with `{ runId, chunk }` as output arrives
2. **Preload exposes** `onScheduleRunOutput(callback)` listener
3. **UI subscribes** when viewing a running schedule, appends chunks to display

### UI Changes

In the run history panel (ProjectEditor.tsx):

1. **Run items clickable** - expand to show output panel
2. **Output panel** - scrollable monospace text area
   - Auto-scrolls while streaming live
   - Dark background, terminal-like styling
3. **Visual states**:
   - Running: pulsing indicator, live streaming output
   - Completed: static full transcript
   - Failed: output + highlighted error message
4. **Clear button** - delete individual run output

### Delete Functionality

- **Per-run delete**: Click "✕" to remove run and its output
- **Clear all**: Button to clear all runs for a schedule
- **API**: `deleteScheduleRun(runId)`, `clearScheduleHistory(scheduleId)`

## Files to Modify

- `src/shared/types.ts` - Add `output` field to `ScheduleRun`
- `src/main/scheduler-executor.ts` - Pipe and capture stdout/stderr
- `src/main/scheduler.ts` - Store output in run record, emit IPC events
- `src/main/store.ts` - Add delete functions for runs
- `src/main/index.ts` - Add IPC handlers for delete operations
- `src/preload.ts` - Expose output streaming listener and delete APIs
- `src/renderer/ProjectEditor.tsx` - Output viewer UI component
- `src/renderer/index.css` - Output panel styling

## Out of Scope

- Structured JSON parsing of Claude output (future enhancement)
- Output search/filtering
- Output export to file
