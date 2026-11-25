// The scheduler's start-up sweep (#55). A schedule run's queue and its running
// task live only in memory, so a run stored as "queued" or "running" by a
// previous Cockpit process can never finish. Kept free of Electron and
// electron-store so it can be unit-tested; scheduler.ts calls it.

interface RunLike {
  id: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  completedAt?: number;
  error?: string;
}

export const INTERRUPTED_RUN_ERROR = 'Cockpit quit before this ran';

/**
 * Mark every "queued" or "running" run that this process does not know about
 * (`liveRunIds`) as failed with INTERRUPTED_RUN_ERROR. Returns the new list
 * (same order, input untouched) and the IDs it failed.
 */
export function failInterruptedRuns<R extends RunLike>(
  runs: R[],
  liveRunIds: ReadonlySet<string>,
  now: number
): { runs: R[]; failedIds: string[] } {
  const failedIds: string[] = [];
  const updated = runs.map((run) => {
    if ((run.status !== 'queued' && run.status !== 'running') || liveRunIds.has(run.id)) {
      return run;
    }
    failedIds.push(run.id);
    return { ...run, status: 'failed' as const, completedAt: now, error: INTERRUPTED_RUN_ERROR };
  });
  return { runs: updated, failedIds };
}
