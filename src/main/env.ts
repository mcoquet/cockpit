import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import log from 'electron-log';
import type { EnvVars } from '../shared/types';

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

export const ENV_START = '__COCKPIT_ENV_START__';
export const ENV_END = '__COCKPIT_ENV_END__';

const CAPTURE_TIMEOUT_MS = 5000;

// Vars that describe the capture shell itself, not the user's environment.
const DROPPED_EXACT = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'TERM']);
const DROPPED_PREFIX = ['TERM_PROGRAM'];

export interface ShellOptions {
  shell?: string;
  timeoutMs?: number;
}

/** Parse `env -0` output found between the markers. Null if the markers are missing. */
export function parseEnvOutput(output: string): Record<string, string> | null {
  const start = output.indexOf(ENV_START);
  const end = output.indexOf(ENV_END, start + ENV_START.length);
  if (start === -1 || end === -1) return null;

  const env: Record<string, string> = {};
  for (const entry of output.slice(start + ENV_START.length, end).split('\0')) {
    const eq = entry.indexOf('=');
    if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

export function filterShellEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (DROPPED_EXACT.has(key) || DROPPED_PREFIX.some((p) => key.startsWith(p))) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Minimal env for the capture shell, like a fresh Terminal tab gets from launchd.
 * Starting clean stops Cockpit's own env (e.g. when run from a terminal in dev)
 * from leaking into the user's rc files.
 */
function captureShellBaseEnv(): NodeJS.ProcessEnv {
  const user = os.userInfo().username;
  return {
    HOME: os.homedir(),
    USER: user,
    LOGNAME: user,
    SHELL: process.env.SHELL || '/bin/zsh',
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TERM: 'dumb',
  };
}

/** Run `shell <args>` and resolve with stdout once `doneMarker` appears or the process ends. Null on failure/timeout. */
function runShell(
  shell: string,
  args: string[],
  cwd: string | undefined,
  timeoutMs: number,
  doneMarker?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;

    const child = spawn(shell, args, {
      cwd,
      env: captureShellBaseEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Interactive shells ignore SIGTERM; a background job from an rc file may hold the pipe open.
      child.stdout?.destroy();
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve(result);
    };

    const timer = setTimeout(() => {
      log.warn(`[env] ${shell} ${args.join(' ')} timed out after ${timeoutMs}ms`);
      finish(null);
    }, timeoutMs);

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      stdout += chunk;
      if (doneMarker && stdout.includes(doneMarker)) finish(stdout);
    });
    child.on('error', (err) => {
      log.warn(`[env] Failed to start ${shell}:`, err.message);
      finish(null);
    });
    child.on('close', (code) => finish(code === 0 || doneMarker ? stdout : null));
  });
}

/**
 * Capture the env of a login + interactive shell started in `cwd`, as a new
 * terminal tab would see it (.zprofile and .zshrc, fnm --use-on-cd, etc.).
 */
export async function captureShellEnv(cwd: string | undefined, opts: ShellOptions = {}): Promise<Record<string, string> | null> {
  const shell = opts.shell || process.env.SHELL || '/bin/zsh';
  const command = `printf '${ENV_START}'; command env -0; printf '${ENV_END}'`;
  const output = await runShell(shell, ['-ilc', command], cwd, opts.timeoutMs ?? CAPTURE_TIMEOUT_MS, ENV_END);
  const parsed = output === null ? null : parseEnvOutput(output);
  return parsed ? filterShellEnv(parsed) : null;
}

/** Previous behaviour: PATH from a login (non-interactive) shell, else standard paths. */
async function getFallbackPath(opts: ShellOptions): Promise<string> {
  const shell = opts.shell || process.env.SHELL || '/bin/zsh';
  const output = await runShell(shell, ['-l', '-c', 'echo $PATH'], undefined, opts.timeoutMs ?? CAPTURE_TIMEOUT_MS);
  const result = output?.trim();
  if (result) return result;
  log.info('[env] Using standard PATH');
  return STANDARD_PATHS.join(':');
}

/** Merge order, later wins: base → shell env → claude dir prepended to PATH → extra (project custom vars). */
export function buildClaudeSpawnEnv(
  base: NodeJS.ProcessEnv,
  shellEnv: Record<string, string>,
  claudePath: string,
  extraEnv?: EnvVars,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base, ...shellEnv };
  const claudeDir = path.dirname(claudePath);
  merged.PATH = merged.PATH ? `${claudeDir}:${merged.PATH}` : claudeDir;
  return { ...merged, ...extraEnv };
}

/**
 * Env for spawning the claude CLI in `cwd`. Captured fresh per call so .zshrc
 * edits and per-project Node versions apply without restarting Cockpit.
 */
export async function getClaudeSpawnEnv(
  claudePath: string,
  cwd?: string,
  extraEnv?: EnvVars,
  opts: ShellOptions = {},
): Promise<NodeJS.ProcessEnv> {
  let shellEnv = await captureShellEnv(cwd, opts);
  if (!shellEnv) {
    log.warn('[env] Could not capture interactive shell env; falling back to login shell PATH');
    shellEnv = { PATH: await getFallbackPath(opts) };
  }
  return buildClaudeSpawnEnv(process.env, shellEnv, claudePath, extraEnv);
}
