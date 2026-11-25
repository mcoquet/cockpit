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

/** The parts of Electron's showMessageBox the remove-project flow uses. */
export interface RemoveDialogOptions {
  type: 'question' | 'warning';
  buttons: string[];
  defaultId: number;
  cancelId: number;
  title: string;
  message: string;
  detail: string;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
}

export interface RemoveProjectInput {
  expandedPath: string;
  /** The folder exists and is not home or above it. */
  canDeleteFolder: boolean;
  scheduleText: RemoveDialogText | null;
  showMessageBox: (options: RemoveDialogOptions) => Promise<{ response: number; checkboxChecked?: boolean }>;
}

export interface RemoveProjectPlan {
  deleteFolder: boolean;
  deleteSchedules: boolean;
}

/**
 * Ask the user how to remove a project. Returns what to do, or null when they
 * cancel any of the dialogs, including the "Delete Permanently" confirmation
 * (#73): then nothing is removed. Shows no dialog at all when there is neither
 * a folder to offer for deletion nor a schedule to ask about.
 */
export async function askRemoveProject(input: RemoveProjectInput): Promise<RemoveProjectPlan | null> {
  const { expandedPath, canDeleteFolder, scheduleText, showMessageBox } = input;
  const scheduleCheckbox = scheduleText
    ? { checkboxLabel: scheduleText.checkboxLabel, checkboxChecked: true }
    : {};
  const detail = `Project: ${expandedPath}${scheduleText ? `\n\n${scheduleText.detail}` : ''}`;

  if (canDeleteFolder) {
    const { response, checkboxChecked } = await showMessageBox({
      type: 'question',
      buttons: ['Remove from Cockpit', 'Delete Folder', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Remove Project',
      message: 'How would you like to remove this project?',
      detail,
      ...scheduleCheckbox,
    });
    if (response === 2) return null;
    const deleteSchedules = scheduleText !== null && checkboxChecked === true;
    if (response === 0) return { deleteFolder: false, deleteSchedules };

    const { response: confirmResponse } = await showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Delete Permanently'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Folder?',
      message: 'This action cannot be undone.',
      detail: `This will permanently delete:\n${expandedPath}\n\nand all its contents.`,
    });
    if (confirmResponse !== 1) return null;
    return { deleteFolder: true, deleteSchedules };
  }

  if (scheduleText) {
    // No folder to offer for deletion, but the schedules still need an answer
    const { response, checkboxChecked } = await showMessageBox({
      type: 'question',
      buttons: ['Remove from Cockpit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Remove Project',
      message: 'Remove this project from Cockpit?',
      detail,
      ...scheduleCheckbox,
    });
    if (response === 1) return null;
    return { deleteFolder: false, deleteSchedules: checkboxChecked === true };
  }

  return { deleteFolder: false, deleteSchedules: false };
}
