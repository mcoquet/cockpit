import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import type { Schedule } from '../shared/types';
import { findClaudeBinary } from './claude';

export interface ParsedSchedule {
  cron: string;
  cronHuman: string;
  prompt: string;
  mode: 'interactive' | 'headless';
  queueBehavior: 'skip' | 'queue' | 'parallel';
  catchUp: boolean;
  name: string;
}

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

export async function interpretSchedule(input: string): Promise<ParsedSchedule> {
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    throw new Error('Claude binary not found');
  }

  const prompt = `You are a schedule parser. Parse this natural language schedule request into JSON.

Output ONLY valid JSON with these fields:
{
  "cron": "cron expression (e.g., '0 9 * * 1-5' for weekdays at 9am)",
  "cronHuman": "human readable description (e.g., 'Weekdays at 9:00 AM')",
  "prompt": "the task/instruction to execute",
  "mode": "interactive" or "headless" (use headless for background tasks, interactive if user needs to see output),
  "queueBehavior": "skip" (default), "queue", or "parallel",
  "catchUp": false (default, set true if user says to run missed tasks),
  "name": "short name for this schedule"
}

Examples:
- "every weekday at 9am check for security issues" → cron: "0 9 * * 1-5", mode: "headless"
- "every Monday at 10am review PRs with me" → cron: "0 10 * * 1", mode: "interactive"
- "daily at midnight run tests" → cron: "0 0 * * *", mode: "headless"

Parse this request: "${input}"`;

  return new Promise((resolve, reject) => {
    const child = spawn(claudePath, ['--print', '--model', 'haiku', '-p', '-'], {
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Claude failed to start: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('Claude interpret error:', { code, stderr, stdout });
        reject(new Error(`Claude failed: ${stderr || stdout || `exit code ${code}`}`));
        return;
      }

      try {
        // Extract JSON from response (claude might add some text around it)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          reject(new Error('No JSON found in response'));
          return;
        }
        const parsed = JSON.parse(jsonMatch[0]) as ParsedSchedule;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse response: ${stdout}`));
      }
    });

    // Pass prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
