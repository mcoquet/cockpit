# Headless Output Capture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture and display output from headless scheduled Claude runs with live streaming.

**Architecture:** Pipe stdout/stderr from spawned Claude process, emit IPC events for live streaming to renderer, store complete output in ScheduleRun record.

**Tech Stack:** Electron IPC, child_process spawn with piped stdio, React state for live updates

---

## Task 1: Add output field to ScheduleRun type

**Files:**
- Modify: `src/shared/types.ts:123-130`

**Step 1: Add output field to ScheduleRun interface**

```typescript
export interface ScheduleRun {
  id: string;
  scheduleId: string;
  startedAt: number;
  completedAt?: number;
  status: 'queued' | 'running' | 'success' | 'failed';
  error?: string;
  output?: string;
}
```

**Step 2: Verify build passes**

Run: `npm run build:main`
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add output field to ScheduleRun"
```

---

## Task 2: Update executor to capture output

**Files:**
- Modify: `src/main/scheduler-executor.ts:60-75`

**Step 1: Change executeSchedule to return output**

Update the function signature and capture stdout/stderr:

```typescript
export async function executeSchedule(schedule: Schedule): Promise<string> {
  // ... existing path expansion code ...

  if (schedule.mode === 'interactive') {
    if (!openSessionFn) {
      throw new Error('openSessionFn not set');
    }
    await openSessionFn(schedule.projectPath, schedule.prompt);
    return ''; // Interactive mode has no captured output
  } else {
    // Headless execution
    const claudePath = findClaudeBinary();
    if (!claudePath) {
      throw new Error('Claude binary not found');
    }

    return new Promise((resolve, reject) => {
      let output = '';

      const child = spawn(claudePath, ['-p', schedule.prompt], {
        cwd: expandedPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: getClaudeSpawnEnv(claudePath),
      });

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        output += data.toString();
      });

      child.on('error', (err) => {
        reject(err);
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Claude exited with code ${code}\n${output}`));
        }
      });
    });
  }
}
```

**Step 2: Verify build passes**

Run: `npm run build:main`
Expected: No errors (scheduler.ts will have type error, fixed in next task)

**Step 3: Commit**

```bash
git add src/main/scheduler-executor.ts
git commit -m "feat(executor): capture stdout/stderr from headless runs"
```

---

## Task 3: Update scheduler to store output

**Files:**
- Modify: `src/main/scheduler.ts:161-180`

**Step 1: Update runTask to store output**

```typescript
async function runTask(schedule: Schedule, run: ScheduleRun): Promise<ScheduleRun> {
  run.status = 'running';
  run.startedAt = Date.now();
  store.saveScheduleRun(run);
  runningTasks.set(schedule.id, run);

  try {
    if (!executor) {
      throw new Error('Executor not set');
    }
    const output = await executor(schedule);
    run.status = 'success';
    run.output = output;
  } catch (err) {
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
  }

  run.completedAt = Date.now();
  store.saveScheduleRun(run);
  runningTasks.delete(schedule.id);

  // ... existing queue processing code ...

  return run;
}
```

**Step 2: Verify build passes**

Run: `npm run build:main`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/scheduler.ts
git commit -m "feat(scheduler): store captured output in run record"
```

---

## Task 4: Add live streaming IPC

**Files:**
- Modify: `src/main/scheduler-executor.ts`
- Modify: `src/main/scheduler.ts`

**Step 1: Add output streaming callback to executor**

Update scheduler-executor.ts to accept an onOutput callback:

```typescript
let outputCallback: ((runId: string, chunk: string) => void) | null = null;

export function setOutputCallback(fn: (runId: string, chunk: string) => void): void {
  outputCallback = fn;
}

// In executeSchedule, update the stdout/stderr handlers:
child.stdout.on('data', (data) => {
  const chunk = data.toString();
  output += chunk;
  if (outputCallback && runId) {
    outputCallback(runId, chunk);
  }
});
```

**Step 2: Pass runId to executor**

Update executeSchedule signature to accept runId:

```typescript
export async function executeSchedule(schedule: Schedule, runId: string): Promise<string>
```

**Step 3: Update scheduler.ts to pass runId and emit IPC**

In index.ts, set up the output callback to emit IPC events:

```typescript
import { BrowserWindow } from 'electron';

schedulerExecutor.setOutputCallback((runId, chunk) => {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('schedule-run-output', { runId, chunk });
  });
});
```

**Step 4: Verify build passes**

Run: `npm run build:main`
Expected: No errors

**Step 5: Commit**

```bash
git add src/main/scheduler-executor.ts src/main/scheduler.ts src/main/index.ts
git commit -m "feat(scheduler): add live output streaming via IPC"
```

---

## Task 5: Expose streaming listener in preload

**Files:**
- Modify: `src/preload.ts`
- Modify: `src/shared/types.ts`

**Step 1: Add onScheduleRunOutput to CockpitAPI type**

```typescript
// In CockpitAPI interface:
onScheduleRunOutput: (callback: (data: { runId: string; chunk: string }) => void) => void;
```

**Step 2: Implement in preload.ts**

```typescript
onScheduleRunOutput: (callback) => {
  ipcRenderer.on('schedule-run-output', (_event, data) => callback(data));
},
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/preload.ts src/shared/types.ts
git commit -m "feat(preload): expose schedule output streaming listener"
```

---

## Task 6: Add delete run functions to store

**Files:**
- Modify: `src/main/store.ts`

**Step 1: Add deleteScheduleRun function**

```typescript
export function deleteScheduleRun(runId: string): boolean {
  const runs = storeInstance.get('scheduleRuns', []) as ScheduleRun[];
  const index = runs.findIndex(r => r.id === runId);
  if (index === -1) return false;
  runs.splice(index, 1);
  storeInstance.set('scheduleRuns', runs);
  return true;
}
```

**Step 2: Add clearScheduleHistory function**

```typescript
export function clearScheduleHistory(scheduleId: string): number {
  const runs = storeInstance.get('scheduleRuns', []) as ScheduleRun[];
  const filtered = runs.filter(r => r.scheduleId !== scheduleId);
  const deleted = runs.length - filtered.length;
  storeInstance.set('scheduleRuns', filtered);
  return deleted;
}
```

**Step 3: Verify build passes**

Run: `npm run build:main`
Expected: No errors

**Step 4: Commit**

```bash
git add src/main/store.ts
git commit -m "feat(store): add delete functions for schedule runs"
```

---

## Task 7: Add IPC handlers for delete operations

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload.ts`
- Modify: `src/shared/types.ts`

**Step 1: Add IPC handlers in index.ts**

```typescript
ipcMain.handle('scheduler:delete-run', (_event, runId: string) =>
  store.deleteScheduleRun(runId)
);

ipcMain.handle('scheduler:clear-history', (_event, scheduleId: string) =>
  store.clearScheduleHistory(scheduleId)
);
```

**Step 2: Add to CockpitAPI type**

```typescript
deleteScheduleRun: (runId: string) => Promise<boolean>;
clearScheduleHistory: (scheduleId: string) => Promise<number>;
```

**Step 3: Add to preload.ts**

```typescript
deleteScheduleRun: (runId: string) =>
  ipcRenderer.invoke('scheduler:delete-run', runId),
clearScheduleHistory: (scheduleId: string) =>
  ipcRenderer.invoke('scheduler:clear-history', scheduleId),
```

**Step 4: Verify build passes**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add src/main/index.ts src/preload.ts src/shared/types.ts
git commit -m "feat(ipc): add handlers for deleting schedule runs"
```

---

## Task 8: Add output viewer UI

**Files:**
- Modify: `src/renderer/ProjectEditor.tsx`
- Modify: `src/renderer/index.css`

**Step 1: Add state for selected run output**

```typescript
const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
const [liveOutput, setLiveOutput] = useState<Record<string, string>>({});
```

**Step 2: Subscribe to live output streaming**

```typescript
useEffect(() => {
  window.cockpit.onScheduleRunOutput(({ runId, chunk }) => {
    setLiveOutput(prev => ({
      ...prev,
      [runId]: (prev[runId] || '') + chunk,
    }));
  });
}, []);
```

**Step 3: Update run item to be clickable and show output**

```typescript
<div
  className={`run-item run-${run.status} ${selectedRunId === run.id ? 'selected' : ''}`}
  onClick={() => setSelectedRunId(selectedRunId === run.id ? null : run.id)}
>
  <span className="run-status">{getStatusIcon(run.status)}</span>
  <span className="run-time">{formatRunTime(run.startedAt)}</span>
  {run.completedAt && (
    <span className="run-duration">
      {Math.round((run.completedAt - run.startedAt) / 1000)}s
    </span>
  )}
  {run.error && <span className="run-error" title={run.error}>error</span>}
  <button
    className="run-delete"
    onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.id); }}
  >✕</button>
</div>
{selectedRunId === run.id && (
  <div className="run-output">
    <pre>{liveOutput[run.id] || run.output || 'No output'}</pre>
  </div>
)}
```

**Step 4: Add delete handler**

```typescript
async function handleDeleteRun(runId: string) {
  await window.cockpit.deleteScheduleRun(runId);
  await loadRunHistory(expandedSchedule!);
  setSelectedRunId(null);
}
```

**Step 5: Verify build passes**

Run: `npm run build:renderer`
Expected: No errors

**Step 6: Commit**

```bash
git add src/renderer/ProjectEditor.tsx
git commit -m "feat(ui): add output viewer for schedule runs"
```

---

## Task 9: Add output panel styling

**Files:**
- Modify: `src/renderer/index.css`

**Step 1: Add output panel styles**

```css
.run-item {
  cursor: pointer;
}

.run-item.selected {
  background: rgba(10, 132, 255, 0.2);
}

.run-delete {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 2px 6px;
  opacity: 0;
  transition: opacity 0.15s;
}

.run-item:hover .run-delete {
  opacity: 1;
}

.run-delete:hover {
  color: #ff453a;
}

.run-output {
  background: #1a1a1a;
  border-radius: 4px;
  padding: 8px;
  margin-top: 4px;
  max-height: 300px;
  overflow-y: auto;
}

.run-output pre {
  margin: 0;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 11px;
  color: #ccc;
  white-space: pre-wrap;
  word-break: break-word;
}
```

**Step 2: Verify build passes**

Run: `npm run build:renderer`
Expected: No errors

**Step 3: Commit**

```bash
git add src/renderer/index.css
git commit -m "feat(ui): add output panel styling"
```

---

## Task 10: Manual testing

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test headless schedule**

1. Open project editor, go to Schedules tab
2. Trigger a headless schedule with ⚡
3. Verify spinner shows while running
4. Click run in history to expand output
5. Verify output shows Claude's response

**Step 3: Test live streaming**

1. Create a headless schedule with a longer prompt
2. Trigger it and immediately click to expand
3. Verify output streams in live

**Step 4: Test delete**

1. Click ✕ on a run
2. Verify run is removed from history

**Step 5: Clean up debug logging**

Remove the debug log.info call from scheduler-executor.ts

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: clean up debug logging"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add output field to ScheduleRun type |
| 2 | Update executor to capture stdout/stderr |
| 3 | Update scheduler to store output |
| 4 | Add live streaming IPC |
| 5 | Expose streaming listener in preload |
| 6 | Add delete run functions to store |
| 7 | Add IPC handlers for delete operations |
| 8 | Add output viewer UI |
| 9 | Add output panel styling |
| 10 | Manual testing and cleanup |
