import os from 'os';
import path from 'path';
import type { IPty } from 'node-pty';

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

const exitListeners = new Map<string, (() => void)[]>();

export function spawnClaude(
  projectPath: string,
  claudePath: string,
  options?: { continueSession?: boolean }
): { id: string; process: IPty } {
  const id = generateSessionId();
  const fullPath = path.join(os.homedir(), projectPath);

  // Use --continue flag by default to resume previous session
  const args = options?.continueSession !== false ? ['--continue'] : [];

  // Spawn claude directly so PTY exits when claude exits
  const ptyProcess: IPty = pty.spawn(claudePath, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: fullPath,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
    },
  });

  sessions.set(id, { id, process: ptyProcess, projectPath });

  // Set up data listener to relay output
  ptyProcess.onData((data: string) => {
    const listeners = outputListeners.get(id) || [];
    for (const listener of listeners) {
      listener(data);
    }
  });

  ptyProcess.onExit(() => {
    const exitCbs = exitListeners.get(id) || [];
    for (const cb of exitCbs) {
      cb();
    }
    sessions.delete(id);
    outputListeners.delete(id);
    exitListeners.delete(id);
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

export function onSessionExit(id: string, callback: () => void): void {
  const listeners = exitListeners.get(id) || [];
  listeners.push(callback);
  exitListeners.set(id, listeners);
}

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
