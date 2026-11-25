import os from 'os';
import path from 'path';

/**
 * Turns a stored project path into an absolute folder path.
 *
 * Project paths are stored relative to home (ADR 0002), or absolute for folders
 * outside it; `~/…` is accepted too. A relative path is always resolved against
 * `home`, never against the process's working directory.
 */
export function expandProjectPath(projectPath: string, home: string = os.homedir()): string {
  if (path.isAbsolute(projectPath)) return projectPath;
  if (projectPath === '~') return home;
  if (projectPath.startsWith('~/')) return path.join(home, projectPath.slice(2));
  return path.join(home, projectPath);
}

/**
 * False for folders that must never be deleted as a project folder: the root,
 * home itself, or any folder that contains home.
 */
export function isDeletableProjectFolder(absolutePath: string, home: string = os.homedir()): boolean {
  const target = path.resolve(absolutePath);
  const resolvedHome = path.resolve(home);
  if (target === path.parse(target).root) return false;
  const fromTarget = path.relative(target, resolvedHome);
  // target is home or an ancestor of home
  if (fromTarget === '' || (!fromTarget.startsWith('..') && !path.isAbsolute(fromTarget))) return false;
  return true;
}
