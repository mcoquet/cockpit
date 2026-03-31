import os from 'os';
import path from 'path';
import type { IPty } from 'node-pty';
import log from 'electron-log';
import { getClaudeSpawnEnv } from './env';
import type { PermissionMode } from '../shared/types';

// node-pty is a native module that needs require()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty');

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
  options?: { continueSession?: boolean; resumeSessionId?: string; permissionMode?: PermissionMode }
): { id: string; process: IPty } {
  const id = generateSessionId();
  const fullPath = path.join(os.homedir(), projectPath);

  // Use --resume for specific session, --continue for most recent, or nothing for new
  let args: string[] = [];
  if (options?.resumeSessionId) {
    args = ['--resume', options.resumeSessionId];
  } else if (options?.continueSession !== false) {
    args = ['--continue'];
  }

  // Add permission mode flag
  if (options?.permissionMode && options.permissionMode !== 'default') {
    args.push('--permission-mode', options.permissionMode);
    if (options.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    }
  }

  // Spawn claude directly so PTY exits when claude exits
  const ptyProcess: IPty = pty.spawn(claudePath, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: fullPath,
    env: {
      ...getClaudeSpawnEnv(claudePath),
      TERM: 'xterm-256color',
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
    // Don't delete listeners here - let the onExit handler clean them up
    // so exit callbacks can still fire
  }
}

export function sessionExists(id: string): boolean {
  return sessions.has(id);
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}
