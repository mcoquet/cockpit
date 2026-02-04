import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLAUDE_PATHS = [
  path.join(os.homedir(), '.claude', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
];

export function findClaudeBinary(): string | null {
  // Check known paths first
  for (const claudePath of CLAUDE_PATHS) {
    if (fs.existsSync(claudePath)) {
      return claudePath;
    }
  }

  // Fall back to which command
  try {
    const result = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch {
    // which command failed, claude not in PATH
  }

  return null;
}
