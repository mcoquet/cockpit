// The scheduler's active node-cron jobs, keyed by schedule ID. Kept free of
// Electron so it can be unit-tested with real node-cron.

import cron, { ScheduledTask } from 'node-cron';

export interface JobRegistry {
  /** Start a job for `id`, replacing any existing one. False if the cron is invalid. */
  register(id: string, cronExpression: string, onTick: () => void): boolean;
  /** Stop and forget the job for `id`; a no-op when there is none. */
  unregister(id: string): void;
  has(id: string): boolean;
  ids(): string[];
  /** Stop every job. */
  clear(): void;
}

export function createJobRegistry(): JobRegistry {
  const jobs = new Map<string, ScheduledTask>();

  function unregister(id: string): void {
    const job = jobs.get(id);
    if (job) {
      job.stop();
      jobs.delete(id);
    }
  }

  return {
    register(id, cronExpression, onTick) {
      unregister(id);
      if (!cron.validate(cronExpression)) return false;
      jobs.set(id, cron.schedule(cronExpression, onTick));
      return true;
    },
    unregister,
    has: (id) => jobs.has(id),
    ids: () => [...jobs.keys()],
    clear() {
      for (const id of [...jobs.keys()]) unregister(id);
    },
  };
}
