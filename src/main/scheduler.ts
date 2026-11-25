import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import * as store from './store';
import { createJobRegistry } from './job-registry';
import type { Schedule, ScheduleRun } from '../shared/types';

// Active cron jobs keyed by schedule ID
const jobs = createJobRegistry();

// Queue of pending runs per schedule
const runQueues = new Map<string, ScheduleRun[]>();

// Currently running task per schedule
const runningTasks = new Map<string, ScheduleRun>();

// Executor function - will be set by index.ts
let executor: ((schedule: Schedule, runId: string) => Promise<string>) | null = null;

export function setExecutor(fn: (schedule: Schedule, runId: string) => Promise<string>): void {
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

/**
 * Delete every schedule of a project being removed (#53): stop their cron jobs,
 * drop their queued runs, and delete the schedules and their schedule runs.
 * A run already in progress may finish, but its record is not saved (runTask).
 */
export function deleteSchedulesForProject(projectPath: string): string[] {
  const removedIds = store.deleteSchedulesForProject(projectPath);
  for (const id of removedIds) {
    unregisterJob(id);
    runQueues.delete(id);
  }
  return removedIds;
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
  const schedule = store.getSchedule(id);
  if (!schedule || !schedule.enabled) return null;
  // node-cron doesn't expose next run time directly
  // Return null for now - can add cron-parser later if needed
  return null;
}

export function getRunHistory(id: string, limit = 20): ScheduleRun[] {
  return store.getScheduleRuns(id, limit);
}

export async function triggerNow(id: string): Promise<ScheduleRun | null> {
  const schedule = store.getSchedule(id);
  if (!schedule) return null;
  return executeSchedule(schedule);
}

function registerJob(schedule: Schedule): void {
  const ok = jobs.register(schedule.id, schedule.cron, () => {
    executeSchedule(schedule);
  });
  if (!ok) {
    console.error(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cron}`);
  }
}

function unregisterJob(id: string): void {
  jobs.unregister(id);
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

  // Notify UI that a run has started
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('schedule-run-started', run);
  });

  try {
    if (!executor) {
      throw new Error('Executor not set');
    }
    const output = await executor(schedule, run.id);
    run.status = 'success';
    run.output = output;
  } catch (err) {
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : String(err);
  }

  run.completedAt = Date.now();
  runningTasks.delete(schedule.id);

  // The schedule was deleted while this run was going (e.g. its project was
  // removed): keep no orphan record and start nothing queued.
  if (!store.getSchedule(schedule.id)) {
    runQueues.delete(schedule.id);
    return run;
  }

  store.saveScheduleRun(run);

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
  // A previous Cockpit process's queued or running runs can never finish: their
  // queue and task were in memory (#55). Fail them, sparing any run this process
  // already started.
  const live = new Set<string>([...runningTasks.values()].map((r) => r.id));
  for (const queue of runQueues.values()) for (const r of queue) live.add(r.id);
  const failed = store.failInterruptedScheduleRuns(live);
  if (failed.length > 0) {
    console.log(`[scheduler] Marked ${failed.length} interrupted schedule run(s) as failed`);
  }

  // Register all enabled schedules on startup
  const schedules = store.getSchedules();
  for (const schedule of schedules) {
    if (schedule.enabled) {
      registerJob(schedule);
    }
  }
}

export function shutdownScheduler(): void {
  jobs.clear();
}
