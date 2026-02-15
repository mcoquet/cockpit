import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import log from 'electron-log';

// Standard macOS paths that should always be included
const STANDARD_PATHS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

// Cache the user's shell PATH (fetched once at startup)
let cachedUserPath: string | null = null;

/**
 * Get the user's full PATH by spawning a login shell.
 * This captures paths added in .zshrc, .bash_profile, etc.
 * including fnm, nvm, and other node version managers.
 */
export function getUserShellPath(): string {
  if (cachedUserPath !== null) {
    return cachedUserPath;
  }

  const shell = process.env.SHELL || '/bin/zsh';

  try {
    // Spawn a login shell to get the full PATH
    // Using execFileSync with -l (login) and -c (command) flags
    const result = execFileSync(shell, ['-l', '-c', 'echo $PATH'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { HOME: os.homedir(), USER: os.userInfo().username },
    }).trim();

    if (result) {
      log.info('[env] Got user shell PATH from login shell');
      cachedUserPath = result;
      return result;
    }
  } catch (err) {
    log.warn('[env] Failed to get user shell PATH:', err);
  }

  // Fallback to standard paths
  cachedUserPath = STANDARD_PATHS.join(':');
  log.info('[env] Using fallback PATH:', cachedUserPath);
  return cachedUserPath;
}

/**
 * Get spawn options with proper environment for running Claude CLI.
 * This ensures the PATH includes the user's shell PATH (for fnm/nvm)
 * and the directory containing the claude binary.
 */
export function getClaudeSpawnEnv(claudePath: string): NodeJS.ProcessEnv {
  const claudeDir = path.dirname(claudePath);
  const userPath = getUserShellPath();
  const extendedPath = `${claudeDir}:${userPath}`;

  return {
    ...process.env,
    PATH: extendedPath,
  };
}
