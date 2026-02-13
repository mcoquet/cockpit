import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { app } from 'electron';
import log from 'electron-log';
import type { SessionInfo } from '../shared/types';
import { findClaudeBinary } from './claude';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Get the Cockpit summaries directory for a project.
 * Summaries are stored in Cockpit's app data so they're removed with the app.
 */
function getSummariesDir(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath);
  return path.join(app.getPath('userData'), 'summaries', encoded);
}

/**
 * Encode a project path to Claude's folder naming convention.
 * Example: /Users/miguel/projects/cockpit -> -Users-miguel-projects-cockpit
 * Handles: absolute paths (/...), tilde paths (~...), and relative paths (Documents/...)
 */
export function encodeProjectPath(projectPath: string): string {
  let fullPath: string;
  if (projectPath.startsWith('/')) {
    // Absolute path
    fullPath = projectPath;
  } else if (projectPath.startsWith('~')) {
    // Tilde path - expand ~
    fullPath = path.join(os.homedir(), projectPath.slice(1));
  } else {
    // Relative path (e.g., Documents/projects/cockpit) - prepend home dir
    fullPath = path.join(os.homedir(), projectPath);
  }
  return '-' + fullPath.slice(1).replace(/[\/\.]/g, '-');
}

/**
 * Get the Claude projects folder path for a given project.
 */
export function getClaudeProjectFolder(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath);
  return path.join(CLAUDE_PROJECTS_DIR, encoded);
}

/**
 * Get the path to a session's summary file in Cockpit's app data.
 */
function getSummaryPath(projectPath: string, sessionId: string): string {
  const summariesDir = getSummariesDir(projectPath);
  return path.join(summariesDir, `${sessionId}.summary`);
}

/**
 * Read cached summary for a session, if it exists.
 */
function readCachedSummary(projectPath: string, sessionId: string): string | null {
  const summaryPath = getSummaryPath(projectPath, sessionId);
  try {
    if (fs.existsSync(summaryPath)) {
      return fs.readFileSync(summaryPath, 'utf8').trim();
    }
  } catch (err) {
    log.warn('[sessions] Failed to read summary:', summaryPath, err);
  }
  return null;
}

/**
 * Extract the first user message from a session file.
 * Used as fallback when no summary exists yet.
 */
function extractFirstUserMessage(filePath: string): string | null {
  try {
    // Read first 50KB of file
    const stats = fs.statSync(filePath);
    const readSize = Math.min(stats.size, 50 * 1024);
    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, readSize, 0);
    fs.closeSync(fd);

    const content = buffer.toString('utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' && entry.message?.content) {
          let text = entry.message.content;
          if (typeof text !== 'string') {
            // Handle array content - skip tool results
            text = Array.isArray(text)
              ? text.find((c: { type: string; text?: string }) => c.type === 'text')?.text || ''
              : '';
          }
          // Skip empty, meta messages, and commands
          if (!text || text.startsWith('<') || entry.isMeta) continue;
          return text.slice(0, 100).trim();
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    log.warn('[sessions] Failed to extract first message from', filePath, err);
  }
  return null;
}

/**
 * Generate a summary for a session using claude CLI with haiku model.
 * Called when a session closes.
 */
export function generateSessionSummary(projectPath: string, claudeSessionId: string): void {
  const folder = getClaudeProjectFolder(projectPath);
  const jsonlPath = path.join(folder, `${claudeSessionId}.jsonl`);
  const summaryPath = getSummaryPath(projectPath, claudeSessionId);

  // Skip if session file doesn't exist or summary already exists
  if (!fs.existsSync(jsonlPath)) {
    log.info('[sessions] No session file found for summary:', claudeSessionId);
    return;
  }
  if (fs.existsSync(summaryPath)) {
    log.info('[sessions] Summary already exists:', claudeSessionId);
    return;
  }

  // Ensure summaries directory exists
  const summariesDir = getSummariesDir(projectPath);
  if (!fs.existsSync(summariesDir)) {
    fs.mkdirSync(summariesDir, { recursive: true });
  }

  const claudePath = findClaudeBinary();
  if (!claudePath) {
    log.warn('[sessions] Claude binary not found, skipping summary generation');
    return;
  }

  log.info('[sessions] Generating summary for session:', claudeSessionId);

  // Read first 20KB and last 20KB to get context without overwhelming the model
  const stats = fs.statSync(jsonlPath);
  let content = '';
  const fd = fs.openSync(jsonlPath, 'r');

  // Read first 20KB
  const firstChunkSize = Math.min(stats.size, 20 * 1024);
  const firstBuffer = Buffer.alloc(firstChunkSize);
  fs.readSync(fd, firstBuffer, 0, firstChunkSize, 0);
  content += firstBuffer.toString('utf8');

  // Read last 20KB if file is larger
  if (stats.size > 40 * 1024) {
    content += '\n...[middle of conversation omitted]...\n';
    const lastChunkSize = 20 * 1024;
    const lastBuffer = Buffer.alloc(lastChunkSize);
    fs.readSync(fd, lastBuffer, 0, lastChunkSize, stats.size - lastChunkSize);
    content += lastBuffer.toString('utf8');
  }
  fs.closeSync(fd);

  // Spawn claude with haiku model to generate summary
  const prompt = `Summarize this Claude Code session in 10 words or less. Focus on what was accomplished. Just output the summary, nothing else.\n\nSession transcript:\n${content}`;

  const child = spawn(claudePath, ['--model', 'haiku', '--print'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // Write prompt to stdin and close it
  child.stdin.write(prompt);
  child.stdin.end();

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    if (code === 0 && stdout.trim()) {
      const summary = stdout.trim().slice(0, 100); // Cap at 100 chars
      try {
        fs.writeFileSync(summaryPath, summary, 'utf8');
        log.info('[sessions] Summary saved for:', claudeSessionId, '-', summary);
      } catch (err) {
        log.error('[sessions] Failed to write summary:', err);
      }
    } else {
      log.warn('[sessions] Summary generation failed:', code, stderr);
    }
  });

  child.on('error', (err) => {
    log.error('[sessions] Failed to spawn claude for summary:', err);
  });
}

/**
 * Check if a project has any session history.
 */
export function hasSessionHistory(projectPath: string): boolean {
  const folder = getClaudeProjectFolder(projectPath);
  if (!fs.existsSync(folder)) return false;

  try {
    const entries = fs.readdirSync(folder);
    return entries.some((e) => e.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

/**
 * Get sessions for a project, sorted by last modified (newest first).
 */
export function getProjectSessions(
  projectPath: string,
  limit?: number,
  offset?: number
): SessionInfo[] {
  const folder = getClaudeProjectFolder(projectPath);
  if (!fs.existsSync(folder)) return [];

  try {
    const entries = fs.readdirSync(folder);
    const sessions: SessionInfo[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;

      const sessionId = entry.replace('.jsonl', '');
      const filePath = path.join(folder, entry);

      try {
        const stats = fs.statSync(filePath);
        sessions.push({
          sessionId,
          lastModified: stats.mtimeMs,
          lastUserMessage: null, // Lazy load for performance
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by lastModified descending
    sessions.sort((a, b) => b.lastModified - a.lastModified);

    // Apply offset and limit
    const start = offset ?? 0;
    const sliced = limit ? sessions.slice(start, start + limit) : sessions.slice(start);

    // Load summaries (or first message as fallback) for the sliced set
    for (const session of sliced) {
      const filePath = path.join(folder, `${session.sessionId}.jsonl`);
      session.lastUserMessage = readCachedSummary(projectPath, session.sessionId) || extractFirstUserMessage(filePath);
    }

    return sliced;
  } catch (err) {
    log.error('[sessions] Failed to get sessions for', projectPath, err);
    return [];
  }
}

/**
 * Find the most recently modified session file for a project.
 * Optionally filter to sessions modified after a given timestamp.
 */
export function getMostRecentSessionId(projectPath: string, afterTimestamp?: number): string | null {
  const folder = getClaudeProjectFolder(projectPath);
  if (!fs.existsSync(folder)) return null;

  try {
    const entries = fs.readdirSync(folder);
    let mostRecent: { sessionId: string; mtime: number } | null = null;

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = path.join(folder, entry);
      const stats = fs.statSync(filePath);

      if (afterTimestamp && stats.mtimeMs < afterTimestamp) continue;

      if (!mostRecent || stats.mtimeMs > mostRecent.mtime) {
        mostRecent = {
          sessionId: entry.replace('.jsonl', ''),
          mtime: stats.mtimeMs,
        };
      }
    }

    return mostRecent?.sessionId || null;
  } catch {
    return null;
  }
}

/**
 * Delete a session file and its summary.
 */
export function deleteSession(projectPath: string, sessionId: string): boolean {
  const folder = getClaudeProjectFolder(projectPath);
  const filePath = path.join(folder, `${sessionId}.jsonl`);
  const summaryPath = getSummaryPath(projectPath, sessionId);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      // Also delete summary if it exists
      if (fs.existsSync(summaryPath)) {
        fs.unlinkSync(summaryPath);
      }
      log.info('[sessions] Deleted session:', sessionId);
      return true;
    }
  } catch (err) {
    log.error('[sessions] Failed to delete session:', sessionId, err);
  }
  return false;
}
