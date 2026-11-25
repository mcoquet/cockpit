// Pure, Electron-free helpers for the permission mode a terminal session or a
// headless schedule run starts in (#56). Unit-tested in
// test/permission-mode.test.js.

import type { PermissionMode } from '../shared/types';

/**
 * The mode to start in: an explicit choice for this launch (Option+click)
 * wins; otherwise the project's default; otherwise Claude Code's default.
 */
export function resolvePermissionMode(
  explicit: PermissionMode | undefined,
  projectMode: PermissionMode | undefined
): PermissionMode {
  return explicit || projectMode || 'default';
}

/**
 * CLI flags for a permission mode. 'default' adds none; bypassPermissions also
 * needs --dangerously-skip-permissions. spawnClaude in pty.ts uses it through
 * terminalSessionArgs (#63).
 */
export function permissionModeArgs(mode: PermissionMode | undefined): string[] {
  if (!mode || mode === 'default') return [];
  const args = ['--permission-mode', mode];
  if (mode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
  return args;
}

/** Arguments for a headless schedule run: `claude [mode flags] -p <prompt>`. */
export function headlessScheduleArgs(prompt: string, mode: PermissionMode | undefined): string[] {
  return [...permissionModeArgs(mode), '-p', prompt];
}

/**
 * Arguments for a terminal session's `claude` process: `--resume <id>` for a
 * chosen conversation, else `--continue` unless continueSession is false (a
 * new conversation), then the permission mode flags.
 */
export function terminalSessionArgs(options: {
  continueSession?: boolean;
  resumeSessionId?: string;
  permissionMode?: PermissionMode;
}): string[] {
  let args: string[] = [];
  if (options.resumeSessionId) {
    args = ['--resume', options.resumeSessionId];
  } else if (options.continueSession !== false) {
    args = ['--continue'];
  }
  return [...args, ...permissionModeArgs(options.permissionMode)];
}
