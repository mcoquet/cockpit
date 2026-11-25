// What removing a project does to its schedules (#53). Kept free of Electron
// and electron-store so it can be unit-tested; store.ts and index.ts call it.

interface ScheduleLike {
  id: string;
  projectPath: string;
  name: string;
  cron: string;
}

interface RunLike {
  scheduleId: string;
}

export interface SchedulePartitionResult<S, R> {
  keptSchedules: S[];
  keptRuns: R[];
  removedIds: string[];
}

/**
 * Split stored schedules and schedule runs into those that stay and those that
 * go with the project at `projectPath` (the stored, home-relative path). A
 * schedule belongs to a project when its `projectPath` is exactly equal.
 */
export function partitionProjectSchedules<S extends ScheduleLike, R extends RunLike>(
  schedules: S[],
  runs: R[],
  projectPath: string
): SchedulePartitionResult<S, R> {
  const removed = new Set(
    schedules.filter((s) => s.projectPath === projectPath).map((s) => s.id)
  );
  return {
    keptSchedules: schedules.filter((s) => !removed.has(s.id)),
    keptRuns: runs.filter((r) => !removed.has(r.scheduleId)),
    removedIds: [...removed],
  };
}

export interface RemoveDialogText {
  checkboxLabel: string;
  detail: string;
}

/**
 * The checkbox label and schedule list for the remove-project dialog, or null
 * when the project has no schedules (the dialog then shows no checkbox).
 */
export function buildRemoveDialogText(schedules: ScheduleLike[]): RemoveDialogText | null {
  if (schedules.length === 0) return null;
  const n = schedules.length;
  const noun = n === 1 ? 'schedule' : 'schedules';
  const list = schedules.map((s) => `• ${s.name} (${s.cron})`).join('\n');
  return {
    checkboxLabel: `Also delete ${n} ${noun} and ${n === 1 ? 'its' : 'their'} run history`,
    detail: `This project has ${n} ${noun}:\n${list}`,
  };
}
