import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CLAUDE_PATHS = [
  path.join(os.homedir(), '.claude', 'bin', 'claude'),
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
];

/**
 * Find claude in fnm or nvm node version directories
 */
function findClaudeInNodeVersionManagers(): string | null {
  const home = os.homedir();

  // fnm paths: ~/.fnm/node-versions/*/installation/bin/claude
  const fnmBase = path.join(home, '.fnm', 'node-versions');
  if (fs.existsSync(fnmBase)) {
    try {
      const versions = fs.readdirSync(fnmBase);
      // Sort versions descending to prefer newer versions
      versions.sort().reverse();
      for (const version of versions) {
        const claudePath = path.join(fnmBase, version, 'installation', 'bin', 'claude');
        if (fs.existsSync(claudePath)) {
          return claudePath;
        }
      }
    } catch {
      // Ignore errors reading fnm directory
    }
  }

  // nvm paths: ~/.nvm/versions/node/*/bin/claude
  const nvmBase = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmBase)) {
    try {
      const versions = fs.readdirSync(nvmBase);
      versions.sort().reverse();
      for (const version of versions) {
        const claudePath = path.join(nvmBase, version, 'bin', 'claude');
        if (fs.existsSync(claudePath)) {
          return claudePath;
        }
      }
    } catch {
      // Ignore errors reading nvm directory
    }
  }

  return null;
}

export function findClaudeBinary(): string | null {
  // Check known paths first
  for (const claudePath of CLAUDE_PATHS) {
    if (fs.existsSync(claudePath)) {
      return claudePath;
    }
  }

  // Check fnm/nvm node version directories
  const nodeManagerPath = findClaudeInNodeVersionManagers();
  if (nodeManagerPath) {
    return nodeManagerPath;
  }

  // Fall back to which command in a login shell
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const result = execFileSync(shell, ['-l', '-c', 'which claude'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch {
    // which command failed, claude not in PATH
  }

  return null;
}
