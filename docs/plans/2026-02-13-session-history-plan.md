# Session History Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ability to browse and resume past Claude Code sessions from project history.

**Architecture:** New `sessions.ts` module reads `.jsonl` files from Claude's project folders. UI expands project rows to show session list. IPC handlers connect UI to sessions module.

**Tech Stack:** Electron, TypeScript, React, node-pty

---

## Task 1: Add SessionInfo Type

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add the SessionInfo interface**

Add after the `ActiveSession` interface (around line 14):

```typescript
export interface SessionInfo {
  sessionId: string;
  lastModified: number; // Unix timestamp for easy serialization
  lastUserMessage: string | null;
}
```

**Step 2: Add new methods to CockpitAPI interface**

Add to the `CockpitAPI` interface (around line 68, before the closing brace):

```typescript
  getProjectSessions: (path: string, limit?: number) => Promise<SessionInfo[]>;
  deleteSession: (path: string, sessionId: string) => Promise<boolean>;
  openSessionById: (path: string, sessionId: string) => Promise<void>;
  hasSessionHistory: (path: string) => Promise<boolean>;
```

**Step 3: Verify TypeScript compiles**

Run: `npm run build:main`
Expected: Build succeeds (preload/main will have type errors until we implement them - that's OK)

**Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add SessionInfo type and session history API methods"
```

---

## Task 2: Create Sessions Module

**Files:**
- Create: `src/main/sessions.ts`

**Step 1: Create the sessions module**

```typescript
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
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build:main`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/main/sessions.ts
git commit -m "feat(sessions): add sessions module for reading Claude session history"
```

---

## Task 3: Modify PTY to Support Resume by Session ID

**Files:**
- Modify: `src/main/pty.ts`

**Step 1: Update spawnClaude options type**

Find the `spawnClaude` function (around line 87) and update the options parameter:

```typescript
export function spawnClaude(
  projectPath: string,
  claudePath: string,
  options?: { continueSession?: boolean; resumeSessionId?: string }
): { id: string; process: IPty } {
```

**Step 2: Update args logic to handle resumeSessionId**

Replace the args line (around line 96):

```typescript
  // Use --resume for specific session, --continue for most recent, or nothing for new
  let args: string[] = [];
  if (options?.resumeSessionId) {
    args = ['--resume', options.resumeSessionId];
  } else if (options?.continueSession !== false) {
    args = ['--continue'];
  }
```

**Step 3: Verify TypeScript compiles**

Run: `npm run build:main`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/main/pty.ts
git commit -m "feat(pty): support resuming specific session by ID"
```

---

## Task 4: Add IPC Handlers for Sessions

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Import sessions module**

Add to imports at top of file (around line 10):

```typescript
import * as sessions from './sessions';
```

**Step 2: Add IPC handlers**

Add these handlers inside `registerIpcHandlers()` function (after `get-service-status` handler, around line 399):

```typescript
  // Session history handlers
  ipcMain.handle('get-project-sessions', (_event, projectPath: string, limit?: number, offset?: number) => {
    return sessions.getProjectSessions(projectPath, limit, offset);
  });

  ipcMain.handle('has-session-history', (_event, projectPath: string) => {
    return sessions.hasSessionHistory(projectPath);
  });

  ipcMain.handle('delete-session', async (_event, projectPath: string, sessionId: string) => {
    // Show confirmation dialog
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Session?',
      message: 'Delete this session?',
      detail: 'This will permanently delete the session history. This cannot be undone.',
    });

    if (response === 1) {
      return sessions.deleteSession(projectPath, sessionId);
    }
    return false;
  });

  ipcMain.handle('open-session-by-id', async (_event, projectPath: string, sessionId: string) => {
    // Hide popup window immediately
    if (popupWindow) {
      popupWindow.hide();
    }
    await openSessionForProjectWithId(projectPath, sessionId);
  });
```

**Step 3: Add openSessionForProjectWithId function**

Add this function after `openSessionForProject` (around line 646):

```typescript
async function openSessionForProjectWithId(projectPath: string, sessionId: string): Promise<void> {
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    dialog.showErrorBox(
      'Claude not found',
      'Could not find the claude CLI. Please ensure claude is installed and accessible.'
    );
    return;
  }

  const projects = store.getProjects();
  const project = projects.find((p) => p.path === projectPath);
  const projectName = project?.name || projectPath.split('/').pop() || 'Terminal';

  log.info('[open-session-by-id] resuming session:', sessionId, 'in project:', projectPath);
  const { id: newSessionId } = pty.spawnClaude(projectPath, claudePath, { resumeSessionId: sessionId });
  log.info('[open-session-by-id] spawned with internal sessionId:', newSessionId);

  const win = terminalWindow.createTerminalWindow({
    sessionId: newSessionId,
    projectName,
    projectPath,
    hasBeads: project?.hasBeads,
    hasGit: project?.hasGit,
    hasGithub: project?.hasGithub,
    onClose: () => {
      log.info('[terminal-window] closed, cleaning up session:', newSessionId);
      pty.killSession(newSessionId);
      if (activeSessions[projectPath]?.sessionId === newSessionId) {
        delete activeSessions[projectPath];
      }
      windowToSession.delete(win.id);
      delete lastBellTime[newSessionId];
      notifySessionsChanged();
    },
  });

  activeSessions[projectPath] = { sessionId: newSessionId, windowId: win.id };
  windowToSession.set(win.id, newSessionId);
  notifySessionsChanged();

  pty.onSessionOutput(newSessionId, (data) => {
    const termWin = terminalWindow.getTerminalWindow(newSessionId);
    if (termWin && !termWin.isDestroyed()) {
      termWin.webContents.send('pty-output', data);

      if (data.includes('\x07') && !termWin.isFocused()) {
        const now = Date.now();
        const lastTime = lastBellTime[newSessionId] || 0;
        if (now - lastTime > BELL_DEBOUNCE_MS) {
          lastBellTime[newSessionId] = now;
          const iconPath = path.join(app.getAppPath(), 'assets/icon.png');
          const notification = new Notification({
            title: 'Cockpit',
            body: `${projectName} needs attention`,
            icon: iconPath,
          });
          notification.on('click', () => {
            terminalWindow.focusTerminalWindow(newSessionId);
          });
          notification.show();
        }
      }
    }
  });

  pty.onSessionExit(newSessionId, () => {
    log.info('[pty-exit] session exited:', newSessionId);
    terminalWindow.closeTerminalWindow(newSessionId);
  });
}
```

**Step 4: Verify TypeScript compiles**

Run: `npm run build:main`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(ipc): add session history IPC handlers"
```

---

## Task 5: Update Preload with Session APIs

**Files:**
- Modify: `src/preload.ts`

**Step 1: Import SessionInfo type**

Update the import line (line 2):

```typescript
import type { Project, ActiveSession, AppSettings, ClaudeStats, ServiceStatus, CockpitAPI, TerminalAPI, ContextMenuOptions, SessionInfo } from './shared/types';
```

**Step 2: Add session methods to cockpitApi**

Add these methods to `cockpitApi` object (after `onFocusSearch`, around line 30):

```typescript
  getProjectSessions: (path: string, limit?: number, offset?: number): Promise<SessionInfo[]> =>
    ipcRenderer.invoke('get-project-sessions', path, limit, offset),
  hasSessionHistory: (path: string): Promise<boolean> =>
    ipcRenderer.invoke('has-session-history', path),
  deleteSession: (path: string, sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('delete-session', path, sessionId),
  openSessionById: (path: string, sessionId: string): Promise<void> =>
    ipcRenderer.invoke('open-session-by-id', path, sessionId),
```

**Step 3: Verify TypeScript compiles**

Run: `npm run build:main`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/preload.ts
git commit -m "feat(preload): expose session history APIs to renderer"
```

---

## Task 6: Add Session History UI to App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Import SessionInfo type**

Update the import (line 2):

```typescript
import type { Project, ActiveSession, SessionInfo } from '../shared/types';
```

**Step 2: Add state for expanded projects and sessions**

Add after the existing state declarations (around line 22):

```typescript
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [projectSessions, setProjectSessions] = useState<Record<string, SessionInfo[]>>({});
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  const [hasHistory, setHasHistory] = useState<Record<string, boolean>>({});
```

**Step 3: Add function to check which projects have history**

Add after `loadCreateLocation` function (around line 83):

```typescript
  async function checkSessionHistory(projectList: Project[]) {
    const historyMap: Record<string, boolean> = {};
    await Promise.all(
      projectList.map(async (p) => {
        historyMap[p.path] = await window.cockpit.hasSessionHistory(p.path);
      })
    );
    setHasHistory(historyMap);
  }
```

**Step 4: Call checkSessionHistory in loadData**

Update `loadData` function:

```typescript
  async function loadData() {
    const [projectList, activeSessions] = await Promise.all([
      window.cockpit.getProjects(),
      window.cockpit.getActiveSessions(),
    ]);
    setProjects(projectList);
    setSessions(activeSessions);
    checkSessionHistory(projectList);
  }
```

**Step 5: Add toggle expand function**

Add after `handleContextMenu` function (around line 124):

```typescript
  async function handleToggleExpand(project: Project, e: React.MouseEvent) {
    e.stopPropagation();
    const path = project.path;
    const newExpanded = new Set(expandedProjects);

    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      // Load sessions if not already loaded
      if (!projectSessions[path]) {
        const sessions = await window.cockpit.getProjectSessions(path, 5);
        setProjectSessions((prev) => ({ ...prev, [path]: sessions }));
        // Get total count for "Show more"
        const allSessions = await window.cockpit.getProjectSessions(path);
        setSessionCounts((prev) => ({ ...prev, [path]: allSessions.length }));
      }
    }
    setExpandedProjects(newExpanded);
  }

  async function handleLoadMoreSessions(project: Project) {
    const path = project.path;
    const currentCount = projectSessions[path]?.length || 0;
    const moreSessions = await window.cockpit.getProjectSessions(path, 5, currentCount);
    setProjectSessions((prev) => ({
      ...prev,
      [path]: [...(prev[path] || []), ...moreSessions],
    }));
  }

  async function handleSessionClick(project: Project, sessionId: string) {
    await window.cockpit.openSessionById(project.path, sessionId);
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }

  async function handleDeleteSession(project: Project, sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const deleted = await window.cockpit.deleteSession(project.path, sessionId);
    if (deleted) {
      // Refresh sessions for this project
      const sessions = await window.cockpit.getProjectSessions(project.path, projectSessions[project.path]?.length || 5);
      setProjectSessions((prev) => ({ ...prev, [project.path]: sessions }));
      // Update count
      const allSessions = await window.cockpit.getProjectSessions(project.path);
      setSessionCounts((prev) => ({ ...prev, [project.path]: allSessions.length }));
      // If no more sessions, collapse and update hasHistory
      if (sessions.length === 0) {
        setExpandedProjects((prev) => {
          const newSet = new Set(prev);
          newSet.delete(project.path);
          return newSet;
        });
        setHasHistory((prev) => ({ ...prev, [project.path]: false }));
      }
    }
  }

  function formatRelativeDate(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;

    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
```

**Step 6: Update the project item JSX**

Replace the project item rendering (inside the `filtered.map()`, around lines 237-266) with:

```typescript
              filtered.map((project, index) => {
                const name = project.name || project.path.split('/').pop();
                const isActive = !!sessions[project.path];
                const isSelected = index === selectedIndex;
                const isExpanded = expandedProjects.has(project.path);
                const projectHasHistory = hasHistory[project.path];
                const sessionList = projectSessions[project.path] || [];
                const totalSessions = sessionCounts[project.path] || 0;
                const hasMore = sessionList.length < totalSessions;

                return (
                  <div key={project.path} className="project-wrapper">
                    <div
                      className={`project-item ${isSelected ? 'selected' : ''}`}
                      onClick={(e) => handleProjectClick(project, e)}
                      onContextMenu={(e) => handleContextMenu(project, e)}
                    >
                      <div className="project-header">
                        {projectHasHistory && (
                          <span
                            className={`expand-triangle ${isExpanded ? 'expanded' : ''}`}
                            onClick={(e) => handleToggleExpand(project, e)}
                          >
                            ▶
                          </span>
                        )}
                        {isActive && <span className="active-indicator">●</span>}
                        <span className="project-name">{name}</span>
                        {(project.hasGit || project.hasBeads) && (
                          <span className="project-indicators">
                            {project.hasGithub ? (
                              <span className="github-indicator" title="GitHub repository">🐙</span>
                            ) : project.hasGit ? (
                              <span className="git-indicator" title="Git repository">⎇</span>
                            ) : null}
                            {project.hasBeads && <span className="beads-indicator" title="Has beads">◆</span>}
                          </span>
                        )}
                      </div>
                      {project.description && (
                        <div className="project-description">{project.description}</div>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="session-list">
                        {sessionList.map((session) => (
                          <div
                            key={session.sessionId}
                            className="session-item"
                            onClick={() => handleSessionClick(project, session.sessionId)}
                            onContextMenu={(e) => handleDeleteSession(project, session.sessionId, e)}
                          >
                            <span className="session-date">{formatRelativeDate(session.lastModified)}</span>
                            <span className="session-message">
                              {session.lastUserMessage || 'No message'}
                            </span>
                          </div>
                        ))}
                        {hasMore && (
                          <button
                            className="show-more-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadMoreSessions(project);
                            }}
                          >
                            Show more
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
```

**Step 7: Verify app compiles**

Run: `npm run build:renderer`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(ui): add session history expansion to project list"
```

---

## Task 7: Add CSS Styles for Session History

**Files:**
- Modify: `src/renderer/index.css`

**Step 1: Add session history styles**

Add at the end of the file:

```css
/* Session History Styles */
.project-wrapper {
  display: flex;
  flex-direction: column;
}

.expand-triangle {
  display: inline-block;
  width: 16px;
  font-size: 10px;
  color: #888;
  cursor: pointer;
  transition: transform 0.15s ease;
  user-select: none;
  flex-shrink: 0;
}

.expand-triangle:hover {
  color: #fff;
}

.expand-triangle.expanded {
  transform: rotate(90deg);
}

.session-list {
  margin-left: 24px;
  border-left: 1px solid #333;
  padding-left: 8px;
  margin-bottom: 4px;
}

.session-item {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.session-date {
  color: #888;
  font-size: 11px;
  margin-bottom: 2px;
}

.session-message {
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.show-more-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  text-align: left;
}

.show-more-btn:hover {
  color: #fff;
}
```

**Step 2: Update project-header to accommodate triangle**

Find `.project-header` and add gap:

```css
.project-header {
  display: flex;
  align-items: center;
  gap: 4px;
}
```

**Step 3: Verify styles render correctly**

Run: `npm run dev`
Expected: Expansion triangle visible on projects with history, session list renders on expand

**Step 4: Commit**

```bash
git add src/renderer/index.css
git commit -m "style: add session history UI styles"
```

---

## Task 8: Manual Testing & Bug Fixes

**Step 1: Test session expansion**

Run: `npm run dev`

Test cases:
- [ ] Projects with history show ▶ triangle
- [ ] Projects without history have no triangle
- [ ] Clicking triangle expands/collapses session list
- [ ] Sessions show relative date and last message
- [ ] Clicking session opens terminal with that session
- [ ] Right-click session shows delete confirmation
- [ ] "Show more" loads additional sessions

**Step 2: Fix any issues found**

Apply fixes as needed.

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: address session history bugs from manual testing"
```

---

## Task 9: Close Issue

**Step 1: Sync beads and close issue**

```bash
bd sync
bd close cockpit-ni0 --reason="Session history browser implemented"
git push
```
