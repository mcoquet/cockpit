# Per-Project Cron Scheduling

**Ticket:** cockpit-tnp
**Date:** 2026-02-13

## Overview

Add ability to schedule Claude Code sessions per project using cron syntax. Designed with a clean API layer for future MCP exposure, allowing agents to create their own schedules.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Task action | Interactive session with prompt OR headless |
| Missed tasks | Configurable per schedule (catch-up or skip) |
| Config storage | electron-store with project data |
| Schedule format | Cron syntax |
| UI location | Project editor (right-click) |
| Runtime | Only while Cockpit is running |
| Queue behavior | Per-schedule: skip, queue, or parallel |
| API scope | Full CRUD + status (run history, next run, pause/resume) |

## Architecture

```
┌─────────────┐     ┌─────────────┐
│   UI        │     │  MCP Server │  (future)
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 │
         ┌───────▼───────┐
         │ Scheduler API │  (src/main/scheduler.ts)
         └───────┬───────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐  ┌─────▼─────┐  ┌───▼───┐
│ Store │  │ node-cron │  │Executor│
└───────┘  └───────────┘  └───────┘
```

## Data Model

```typescript
interface Schedule {
  id: string;                              // UUID
  projectPath: string;                     // Which project
  name: string;                            // User-friendly name
  cron: string;                            // Cron expression (e.g., "0 9 * * 1-5")
  enabled: boolean;                        // Pause/resume
  mode: 'interactive' | 'headless';        // Terminal window or background
  prompt: string;                          // Instruction to send to Claude
  catchUp: boolean;                        // Run missed tasks on startup
  queueBehavior: 'skip' | 'queue' | 'parallel';
  createdAt: number;
  updatedAt: number;
}

interface ScheduleRun {
  scheduleId: string;
  startedAt: number;
  completedAt?: number;
  status: 'queued' | 'running' | 'success' | 'failed';
  error?: string;
}
```

### Queue Behaviors

- **skip**: Don't run if previous execution still active
- **queue**: Queue and run sequentially after current completes
- **parallel**: Run regardless of previous state

## API Layer

```typescript
// src/main/scheduler.ts

// CRUD
createSchedule(schedule: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>): Schedule
getSchedule(id: string): Schedule | null
updateSchedule(id: string, updates: Partial<Schedule>): Schedule
deleteSchedule(id: string): boolean
listSchedules(projectPath?: string): Schedule[]

// Status
getNextRun(id: string): Date | null
getRunHistory(id: string, limit?: number): ScheduleRun[]
getQueuedRuns(id: string): ScheduleRun[]

// Control
pauseSchedule(id: string): void
resumeSchedule(id: string): void
triggerNow(id: string): ScheduleRun  // Manual trigger
```

## Storage

Stored in electron-store alongside projects:

```typescript
{
  projects: [...],
  schedules: Schedule[],
  scheduleRuns: ScheduleRun[]  // Capped at ~100 per schedule
}
```

## Executor

```typescript
// src/main/scheduler-executor.ts

async function executeSchedule(schedule: Schedule): Promise<void> {
  if (schedule.mode === 'interactive') {
    // Open terminal window, send prompt after ready
    const session = openSessionForProject(schedule.projectPath, true);
    pty.writeToSession(session.id, schedule.prompt + '\n');
  } else {
    // Headless: spawn claude CLI without terminal
    spawn('claude', ['-p', schedule.prompt], { cwd: projectPath });
  }
}
```

## UI

Add "Schedules" tab to project editor modal:

- List of schedules for this project
- Add/edit/delete buttons
- Each schedule shows: name, cron (human-readable), next run, status
- Toggle for enabled/disabled
- "Run Now" button for manual trigger

## IPC Handlers

```typescript
ipcMain.handle('scheduler:list', (_, projectPath?) => listSchedules(projectPath));
ipcMain.handle('scheduler:create', (_, schedule) => createSchedule(schedule));
ipcMain.handle('scheduler:update', (_, id, updates) => updateSchedule(id, updates));
ipcMain.handle('scheduler:delete', (_, id) => deleteSchedule(id));
ipcMain.handle('scheduler:trigger', (_, id) => triggerNow(id));
ipcMain.handle('scheduler:pause', (_, id) => pauseSchedule(id));
ipcMain.handle('scheduler:resume', (_, id) => resumeSchedule(id));
ipcMain.handle('scheduler:history', (_, id, limit) => getRunHistory(id, limit));
ipcMain.handle('scheduler:nextRun', (_, id) => getNextRun(id));
```

## Implementation Order

1. Data model + store functions
2. Scheduler engine (node-cron integration)
3. Executor (interactive + headless)
4. Queue management
5. Catch-up logic on startup
6. IPC handlers
7. UI in project editor

## Future: MCP Exposure

The clean API layer enables future MCP server that exposes:
- `scheduler_create` - Agent creates its own schedules
- `scheduler_list` - Agent views existing schedules
- `scheduler_delete` - Agent removes schedules
- etc.

This allows agents to schedule follow-up tasks, daily checks, or recurring maintenance.
