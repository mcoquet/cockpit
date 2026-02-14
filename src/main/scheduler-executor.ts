import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import type { Schedule } from '../shared/types';
import { findClaudeBinary } from './claude';

// These will be injected from index.ts
let openSessionFn: ((projectPath: string, prompt: string) => Promise<void>) | null = null;

export function setOpenSessionFn(fn: (projectPath: string, prompt: string) => Promise<void>): void {
  openSessionFn = fn;
}

export async function executeSchedule(schedule: Schedule): Promise<void> {
  const expandedPath = schedule.projectPath.startsWith('~')
    ? path.join(os.homedir(), schedule.projectPath.slice(1))
    : schedule.projectPath;

  if (schedule.mode === 'interactive') {
    if (!openSessionFn) {
      throw new Error('openSessionFn not set');
    }
    await openSessionFn(schedule.projectPath, schedule.prompt);
  } else {
    // Headless execution
    const claudePath = findClaudeBinary();
    if (!claudePath) {
      throw new Error('Claude binary not found');
    }

    return new Promise((resolve, reject) => {
      const child = spawn(claudePath, ['-p', schedule.prompt], {
        cwd: expandedPath,
        stdio: 'ignore',
        detached: true,
      });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Claude exited with code ${code}`));
        }
      });

      // Don't wait for detached process
      child.unref();
      resolve();
    });
  }
}
