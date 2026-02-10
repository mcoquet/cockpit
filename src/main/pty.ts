import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import type { IPty } from 'node-pty';
import log from 'electron-log';

// node-pty is a native module that needs require()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty');

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
 */
function getUserShellPath(): string {
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
      log.info('[pty] Got user shell PATH from login shell');
      log.info('[pty] PATH includes /usr/local/bin:', result.includes('/usr/local/bin'));
      log.info('[pty] PATH includes /opt/homebrew/bin:', result.includes('/opt/homebrew/bin'));
      cachedUserPath = result;
      return result;
    }
  } catch (err) {
    log.warn('[pty] Failed to get user shell PATH:', err);
  }

  // Fallback to standard paths
  cachedUserPath = STANDARD_PATHS.join(':');
  log.info('[pty] Using fallback PATH:', cachedUserPath);
  return cachedUserPath;
}

interface PtySession {
  id: string;
  process: IPty;
  projectPath: string;
}

const sessions = new Map<string, PtySession>();
const outputListeners = new Map<string, ((data: string) => void)[]>();

let sessionCounter = 0;

function generateSessionId(): string {
  return `session-${Date.now()}-${++sessionCounter}`;
}

interface ExitInfo {
  exitCode: number;
  signal: number | undefined;
  startTime: number;
}

const exitListeners = new Map<string, ((info: ExitInfo) => void)[]>();
const sessionStartTimes = new Map<string, number>();

export function spawnClaude(
  projectPath: string,
  claudePath: string,
  options?: { continueSession?: boolean }
): { id: string; process: IPty } {
  const id = generateSessionId();
  const fullPath = path.join(os.homedir(), projectPath);

  // Use --continue flag by default to resume previous session
  const args = options?.continueSession !== false ? ['--continue'] : [];

  // Get user's full PATH (from login shell) and prepend claude's directory
  const claudeDir = path.dirname(claudePath);
  const userPath = getUserShellPath();
  const extendedPath = `${claudeDir}:${userPath}`;

  // Spawn claude directly so PTY exits when claude exits
  const ptyProcess: IPty = pty.spawn(claudePath, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: fullPath,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      PATH: extendedPath,
    },
  });

  sessions.set(id, { id, process: ptyProcess, projectPath });
  sessionStartTimes.set(id, Date.now());

  // Set up data listener to relay output
  ptyProcess.onData((data: string) => {
    const listeners = outputListeners.get(id) || [];
    for (const listener of listeners) {
      listener(data);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    const startTime = sessionStartTimes.get(id) || Date.now();
    log.info(`[pty-exit] session ${id} exited with code ${exitCode}, signal ${signal}`);
    const exitCbs = exitListeners.get(id) || [];
    for (const cb of exitCbs) {
      cb({ exitCode, signal, startTime });
    }
    sessions.delete(id);
    outputListeners.delete(id);
    exitListeners.delete(id);
    sessionStartTimes.delete(id);
  });

  return { id, process: ptyProcess };
}

export function onSessionOutput(
  id: string,
  callback: (data: string) => void
): void {
  const listeners = outputListeners.get(id) || [];
  listeners.push(callback);
  outputListeners.set(id, listeners);
}

export function onSessionExit(id: string, callback: (info: ExitInfo) => void): void {
  const listeners = exitListeners.get(id) || [];
  listeners.push(callback);
  exitListeners.set(id, listeners);
}

export type { ExitInfo };

export function writeToSession(id: string, data: string): void {
  const session = sessions.get(id);
  if (session) {
    session.process.write(data);
  }
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session) {
    session.process.resize(cols, rows);
  }
}

export function killSession(id: string): void {
  const session = sessions.get(id);
  if (session) {
    session.process.kill();
    sessions.delete(id);
    outputListeners.delete(id);
    exitListeners.delete(id);
  }
}

export function sessionExists(id: string): boolean {
  return sessions.has(id);
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}
