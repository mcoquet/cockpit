import fs from 'fs';
import path from 'path';
import os from 'os';
import log from 'electron-log';
import type { SessionInfo } from '../shared/types';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Encode a project path to Claude's folder naming convention.
 * Example: /Users/miguel/projects/cockpit -> -Users-miguel-projects-cockpit
 */
export function encodeProjectPath(absolutePath: string): string {
  // Expand ~ to home directory first
  const expanded = absolutePath.startsWith('~')
    ? path.join(os.homedir(), absolutePath.slice(1))
    : absolutePath;
  return '-' + expanded.slice(1).replace(/[\/\.]/g, '-');
}

/**
 * Get the Claude projects folder path for a given project.
 */
export function getClaudeProjectFolder(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath);
  return path.join(CLAUDE_PROJECTS_DIR, encoded);
}

/**
 * Extract the last user message from a session file.
 * Reads from end of file to find the last "type":"user" entry efficiently.
 */
function extractLastUserMessage(filePath: string): string | null {
  try {
    // Read last 50KB of file (should contain last few messages)
    const stats = fs.statSync(filePath);
    const readSize = Math.min(stats.size, 50 * 1024);
    const buffer = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);

    const content = buffer.toString('utf8');
    const lines = content.split('\n').reverse();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' && entry.message?.content) {
          // Extract text content, truncate to 100 chars
          let text = entry.message.content;
          if (typeof text !== 'string') {
            // Handle array content (multimodal)
            text = Array.isArray(text)
              ? text.find((c: { type: string; text?: string }) => c.type === 'text')?.text || ''
              : '';
          }
          // Skip meta messages (commands, caveats)
          if (text.startsWith('<') || entry.isMeta) continue;
          return text.slice(0, 100).trim();
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    log.warn('[sessions] Failed to extract user message from', filePath, err);
  }
  return null;
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

    // Now extract user messages for the sliced set
    for (const session of sliced) {
      const filePath = path.join(folder, `${session.sessionId}.jsonl`);
      session.lastUserMessage = extractLastUserMessage(filePath);
    }

    return sliced;
  } catch (err) {
    log.error('[sessions] Failed to get sessions for', projectPath, err);
    return [];
  }
}

/**
 * Delete a session file.
 */
export function deleteSession(projectPath: string, sessionId: string): boolean {
  const folder = getClaudeProjectFolder(projectPath);
  const filePath = path.join(folder, `${sessionId}.jsonl`);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log.info('[sessions] Deleted session:', sessionId);
      return true;
    }
  } catch (err) {
    log.error('[sessions] Failed to delete session:', sessionId, err);
  }
  return false;
}
