# Per-Project Cron Scheduling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-project cron scheduling with interactive/headless execution, queue management, and a clean API for future MCP exposure.

**Architecture:** Scheduler service in main process with node-cron for timing, electron-store for persistence, and executor module for running tasks. UI in project editor modal.

**Tech Stack:** Electron, node-cron, electron-store, React

---

### Task 1: Install node-cron and add types

**Files:**
- Modify: `package.json`

**Step 1: Install node-cron**

```bash
npm install node-cron
npm install -D @types/node-cron
```

**Step 2: Verify installation**

```bash
npm ls node-cron
```
Expected: `node-cron@3.x.x`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-cron dependency"
```

---

### Task 2: Add Schedule types to shared types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add types at end of file**

```typescript
// Scheduler types
export interface Schedule {
  id: string;
  projectPath: string;
  name: string;
  cron: string;
  enabled: boolean;
  mode: 'interactive' | 'headless';
  prompt: string;
  catchUp: boolean;
  queueBehavior: 'skip' | 'queue' | 'parallel';
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  startedAt: number;
  completedAt?: number;
  status: 'queued' | 'running' | 'success' | 'failed';
  error?: string;
}
```

**Step 2: Build to verify**

```bash
npm run build:main
```
Expected: No errors

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add Schedule and ScheduleRun types"
```

---

### Task 3: Add schedule storage functions to store.ts

**Files:**
- Modify: `src/main/store.ts`

**Step 1: Read current store.ts structure**

Check how projects are stored to follow the same pattern.

**Step 2: Add schedule storage functions**

```typescript
import type { Schedule, ScheduleRun } from '../shared/types';

// Add to store schema
// schedules: Schedule[]
// scheduleRuns: ScheduleRun[]

export function getSchedules(): Schedule[] {
  return store.get('schedules', []) as Schedule[];
}

export function getSchedulesByProject(projectPath: string): Schedule[] {
  return getSchedules().filter(s => s.projectPath === projectPath);
}

export function getSchedule(id: string): Schedule | null {
  return getSchedules().find(s => s.id === id) || null;
}

export function saveSchedule(schedule: Schedule): Schedule {
  const schedules = getSchedules();
  const index = schedules.findIndex(s => s.id === schedule.id);
  if (index >= 0) {
    schedules[index] = schedule;
  } else {
    schedules.push(schedule);
  }
  store.set('schedules', schedules);
  return schedule;
}

export function deleteSchedule(id: string): boolean {
  const schedules = getSchedules();
  const filtered = schedules.filter(s => s.id !== id);
  if (filtered.length === schedules.length) return false;
  store.set('schedules', filtered);
  // Also delete associated runs
  const runs = getScheduleRuns();
  store.set('scheduleRuns', runs.filter(r => r.scheduleId !== id));
  return true;
}

export function getScheduleRuns(scheduleId?: string, limit = 100): ScheduleRun[] {
  const runs = store.get('scheduleRuns', []) as ScheduleRun[];
  const filtered = scheduleId ? runs.filter(r => r.scheduleId === scheduleId) : runs;
  return filtered.slice(-limit);
}

export function saveScheduleRun(run: ScheduleRun): ScheduleRun {
  const runs = store.get('scheduleRuns', []) as ScheduleRun[];
  const index = runs.findIndex(r => r.id === run.id);
  if (index >= 0) {
    runs[index] = run;
  } else {
    runs.push(run);
  }
  // Cap at 1000 runs total
  const capped = runs.slice(-1000);
  store.set('scheduleRuns', capped);
  return run;
}
```

**Step 3: Build to verify**

```bash
npm run build:main
```

**Step 4: Commit**

```bash
git add src/main/store.ts
git commit -m "feat: add schedule storage functions"
```

---

### Task 4: Create scheduler service

**Files:**
- Create: `src/main/scheduler.ts`

**Step 1: Create scheduler.ts with core functionality**

```typescript
import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import * as store from './store';
import type { Schedule, ScheduleRun } from '../shared/types';

// Active cron jobs keyed by schedule ID
const activeJobs = new Map<string, cron.ScheduledTask>();

// Queue of pending runs per schedule
const runQueues = new Map<string, ScheduleRun[]>();

// Currently running task per schedule
const runningTasks = new Map<string, ScheduleRun>();

// Executor function - will be set by index.ts
let executor: ((schedule: Schedule) => Promise<void>) | null = null;

export function setExecutor(fn: (schedule: Schedule) => Promise<void>): void {
  executor = fn;
}

export function createSchedule(
  data: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>
): Schedule {
  const now = Date.now();
  const schedule: Schedule = {
    ...data,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  store.saveSchedule(schedule);
  if (schedule.enabled) {
    registerJob(schedule);
  }
  return schedule;
}

export function getSchedule(id: string): Schedule | null {
  return store.getSchedule(id);
}

export function updateSchedule(id: string, updates: Partial<Schedule>): Schedule | null {
  const existing = store.getSchedule(id);
  if (!existing) return null;

  const updated: Schedule = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  store.saveSchedule(updated);

  // Re-register job if cron or enabled changed
  unregisterJob(id);
  if (updated.enabled) {
    registerJob(updated);
  }

  return updated;
}

export function deleteSchedule(id: string): boolean {
  unregisterJob(id);
  return store.deleteSchedule(id);
}

export function listSchedules(projectPath?: string): Schedule[] {
  if (projectPath) {
    return store.getSchedulesByProject(projectPath);
  }
  return store.getSchedules();
}

export function pauseSchedule(id: string): void {
  updateSchedule(id, { enabled: false });
}

export function resumeSchedule(id: string): void {
  updateSchedule(id, { enabled: true });
}

export function getNextRun(id: string): Date | null {
  const job = activeJobs.get(id);
  if (!job) return null;
  // node-cron doesn't expose next run, calculate from cron expression
  const schedule = store.getSchedule(id);
  if (!schedule) return null;
  try {
    const interval = cron.schedule(schedule.cron, () => {}, { scheduled: false });
    // This is a limitation - node-cron doesn't expose next run time
    // For now, return null and consider using cron-parser for this
    return null;
  } catch {
    return null;
  }
}

export function getRunHistory(id: string, limit = 20): ScheduleRun[] {
  return store.getScheduleRuns(id, limit);
}

export function getQueuedRuns(id: string): ScheduleRun[] {
  return runQueues.get(id) || [];
}

export async function triggerNow(id: string): Promise<ScheduleRun | null> {
  const schedule = store.getSchedule(id);
  if (!schedule) return null;
  return executeSchedule(schedule);
}

function registerJob(schedule: Schedule): void {
  if (!cron.validate(schedule.cron)) {
    console.error(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cron}`);
    return;
  }

  const job = cron.schedule(schedule.cron, () => {
    executeSchedule(schedule);
  });

  activeJobs.set(schedule.id, job);
}

function unregisterJob(id: string): void {
  const job = activeJobs.get(id);
  if (job) {
    job.stop();
    activeJobs.delete(id);
  }
}

async function executeSchedule(schedule: Schedule): Promise<ScheduleRun> {
  const run: ScheduleRun = {
    id: uuidv4(),
    scheduleId: schedule.id,
    startedAt: Date.now(),
    status: 'queued',
  };

  // Check queue behavior
  const isRunning = runningTasks.has(schedule.id);

  if (isRunning) {
    if (schedule.queueBehavior === 'skip') {
      run.status = 'failed';
      run.completedAt = Date.now();
      run.error = 'Skipped: previous run still active';
      store.saveScheduleRun(run);
      return run;
    } else if (schedule.queueBehavior === 'queue') {
      run.status = 'queued';
      store.saveScheduleRun(run);
      const queue = runQueues.get(schedule.id) || [];
      queue.push(run);
      runQueues.set(schedule.id, queue);
      return run;
    }
    // parallel: continue execution
  }

  return runTask(schedule, run);
}

async function runTask(schedule: Schedule, run: ScheduleRun): Promise<ScheduleRun> {
  run.status = 'running';
  run.startedAt = Date.now();
  store.saveScheduleRun(run);
  runningTasks.set(schedule.id, run);

  try {
    if (!executor) {
      throw new Error('Executor not set');
    }
    await executor(schedule);
    run.status = 'success';
  } catch (err) {
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
  }

  run.completedAt = Date.now();
  store.saveScheduleRun(run);
  runningTasks.delete(schedule.id);

  // Process queue
  const queue = runQueues.get(schedule.id) || [];
  if (queue.length > 0) {
    const nextRun = queue.shift()!;
    runQueues.set(schedule.id, queue);
    // Refresh schedule in case it changed
    const freshSchedule = store.getSchedule(schedule.id);
    if (freshSchedule && freshSchedule.enabled) {
      runTask(freshSchedule, nextRun);
    }
  }

  return run;
}

export function initializeScheduler(): void {
  // Register all enabled schedules on startup
  const schedules = store.getSchedules();
  for (const schedule of schedules) {
    if (schedule.enabled) {
      registerJob(schedule);
    }
  }

  // Handle catch-up for missed schedules
  // TODO: Implement catch-up logic based on last run time
}

export function shutdownScheduler(): void {
  for (const [id] of activeJobs) {
    unregisterJob(id);
  }
}
```

**Step 2: Build to verify**

```bash
npm run build:main
```

**Step 3: Commit**

```bash
git add src/main/scheduler.ts
git commit -m "feat: add scheduler service with cron support"
```

---

### Task 5: Create scheduler executor

**Files:**
- Create: `src/main/scheduler-executor.ts`

**Step 1: Create executor module**

```typescript
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import type { Schedule } from '../shared/types';
import { findClaudeBinary } from './claude';

// These will be injected from index.ts
let openSessionFn: ((projectPath: string, prompt: string) => Promise<void>) | null = null;

export function setOpenSessionFn(fn: (projectPath: string, prompt: string) => Promise<void>): void {
  openSessionFn = fn;
}

export async function executeSchedule(schedule: Schedule): Promise<void> {
  const expandedPath = schedule.projectPath.startsWith('~')
    ? path.join(os.homedir(), schedule.projectPath.slice(1))
    : schedule.projectPath;

  if (schedule.mode === 'interactive') {
    if (!openSessionFn) {
      throw new Error('openSessionFn not set');
    }
    await openSessionFn(schedule.projectPath, schedule.prompt);
  } else {
    // Headless execution
    const claudePath = findClaudeBinary();
    if (!claudePath) {
      throw new Error('Claude binary not found');
    }

    return new Promise((resolve, reject) => {
      const child = spawn(claudePath, ['-p', schedule.prompt], {
        cwd: expandedPath,
        stdio: 'ignore',
        detached: true,
      });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Claude exited with code ${code}`));
        }
      });

      // Don't wait for detached process
      child.unref();
      resolve();
    });
  }
}
```

**Step 2: Build to verify**

```bash
npm run build:main
```

**Step 3: Commit**

```bash
git add src/main/scheduler-executor.ts
git commit -m "feat: add scheduler executor for interactive and headless modes"
```

---

### Task 6: Integrate scheduler into main process

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Import scheduler modules**

Add near top of file:

```typescript
import * as scheduler from './scheduler';
import * as schedulerExecutor from './scheduler-executor';
```

**Step 2: Add scheduler IPC handlers in registerIpcHandlers()**

```typescript
// Scheduler IPC handlers
ipcMain.handle('scheduler:list', (_event, projectPath?: string) =>
  scheduler.listSchedules(projectPath)
);

ipcMain.handle('scheduler:get', (_event, id: string) =>
  scheduler.getSchedule(id)
);

ipcMain.handle('scheduler:create', (_event, data: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>) =>
  scheduler.createSchedule(data)
);

ipcMain.handle('scheduler:update', (_event, id: string, updates: Partial<Schedule>) =>
  scheduler.updateSchedule(id, updates)
);

ipcMain.handle('scheduler:delete', (_event, id: string) =>
  scheduler.deleteSchedule(id)
);

ipcMain.handle('scheduler:pause', (_event, id: string) => {
  scheduler.pauseSchedule(id);
});

ipcMain.handle('scheduler:resume', (_event, id: string) => {
  scheduler.resumeSchedule(id);
});

ipcMain.handle('scheduler:trigger', (_event, id: string) =>
  scheduler.triggerNow(id)
);

ipcMain.handle('scheduler:history', (_event, id: string, limit?: number) =>
  scheduler.getRunHistory(id, limit)
);

ipcMain.handle('scheduler:queued', (_event, id: string) =>
  scheduler.getQueuedRuns(id)
);
```

**Step 3: Initialize scheduler in app.whenReady()**

Add after other initialization:

```typescript
// Initialize scheduler
schedulerExecutor.setOpenSessionFn(async (projectPath: string, prompt: string) => {
  await openSessionForProject(projectPath, true);
  // Wait a moment for session to be ready, then send prompt
  setTimeout(() => {
    const session = activeSessions[projectPath];
    if (session) {
      pty.writeToSession(session.sessionId, prompt + '\n');
    }
  }, 2000);
});

scheduler.setExecutor(schedulerExecutor.executeSchedule);
scheduler.initializeScheduler();
```

**Step 4: Shutdown scheduler on quit**

Add in app.on('will-quit'):

```typescript
scheduler.shutdownScheduler();
```

**Step 5: Build to verify**

```bash
npm run build:main
```

**Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: integrate scheduler into main process with IPC handlers"
```

---

### Task 7: Add scheduler API to preload

**Files:**
- Modify: `src/preload.ts`
- Modify: `src/shared/types.ts`

**Step 1: Add scheduler methods to CockpitAPI interface in types.ts**

```typescript
// Add to CockpitAPI interface
listSchedules: (projectPath?: string) => Promise<Schedule[]>;
getSchedule: (id: string) => Promise<Schedule | null>;
createSchedule: (data: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Schedule>;
updateSchedule: (id: string, updates: Partial<Schedule>) => Promise<Schedule | null>;
deleteSchedule: (id: string) => Promise<boolean>;
pauseSchedule: (id: string) => Promise<void>;
resumeSchedule: (id: string) => Promise<void>;
triggerSchedule: (id: string) => Promise<ScheduleRun | null>;
getScheduleHistory: (id: string, limit?: number) => Promise<ScheduleRun[]>;
```

**Step 2: Implement in preload.ts**

```typescript
listSchedules: (projectPath?: string) =>
  ipcRenderer.invoke('scheduler:list', projectPath),
getSchedule: (id: string) =>
  ipcRenderer.invoke('scheduler:get', id),
createSchedule: (data) =>
  ipcRenderer.invoke('scheduler:create', data),
updateSchedule: (id: string, updates) =>
  ipcRenderer.invoke('scheduler:update', id, updates),
deleteSchedule: (id: string) =>
  ipcRenderer.invoke('scheduler:delete', id),
pauseSchedule: (id: string) =>
  ipcRenderer.invoke('scheduler:pause', id),
resumeSchedule: (id: string) =>
  ipcRenderer.invoke('scheduler:resume', id),
triggerSchedule: (id: string) =>
  ipcRenderer.invoke('scheduler:trigger', id),
getScheduleHistory: (id: string, limit?: number) =>
  ipcRenderer.invoke('scheduler:history', id, limit),
```

**Step 3: Build to verify**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/preload.ts src/shared/types.ts
git commit -m "feat: expose scheduler API to renderer"
```

---

### Task 8: Add Schedules tab to ProjectEditor

**Files:**
- Modify: `src/renderer/ProjectEditor.tsx`
- Modify: `src/renderer/index.css`

**Step 1: Read current ProjectEditor structure**

Understand existing tabs/layout before adding Schedules tab.

**Step 2: Add Schedules tab with list and CRUD UI**

This will include:
- Tab button for "Schedules"
- List of schedules for the project
- Add schedule form (name, cron, mode, prompt, queueBehavior, catchUp)
- Edit/delete buttons per schedule
- Enable/disable toggle
- "Run Now" button

**Step 3: Add CSS for schedule list items**

**Step 4: Build and test**

```bash
npm run build:renderer
npm run dev
```

**Step 5: Commit**

```bash
git add src/renderer/ProjectEditor.tsx src/renderer/index.css
git commit -m "feat: add Schedules tab to project editor"
```

---

### Task 9: Add uuid dependency

**Files:**
- Modify: `package.json`

**Step 1: Install uuid**

```bash
npm install uuid
npm install -D @types/uuid
```

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add uuid dependency"
```

---

### Task 10: Manual testing

**Test scenarios:**

1. Create a schedule with interactive mode
2. Create a schedule with headless mode
3. Trigger schedule manually ("Run Now")
4. Verify cron triggers at scheduled time (use `* * * * *` for every minute)
5. Test pause/resume
6. Test queue behaviors (skip, queue, parallel)
7. Verify schedules persist across app restart
8. Test delete schedule

---

### Task 11: Final integration commit

```bash
git add -A
git commit -m "feat: per-project cron scheduling

- Scheduler service with node-cron
- Interactive and headless execution modes
- Queue management (skip/queue/parallel)
- Full CRUD API for future MCP exposure
- Schedules tab in project editor

Closes cockpit-tnp"
```
