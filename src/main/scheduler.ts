import cron, { ScheduledTask } from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import * as store from './store';
import type { Schedule, ScheduleRun } from '../shared/types';

// Active cron jobs keyed by schedule ID
const activeJobs = new Map<string, ScheduledTask>();

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
}

export function shutdownScheduler(): void {
  for (const [id] of activeJobs) {
    unregisterJob(id);
  }
}
