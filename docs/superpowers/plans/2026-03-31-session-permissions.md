# Session Permissions UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permission mode controls to Cockpit — per-project defaults, launch-time override, terminal badge with mid-session mode switching.

**Architecture:** Thread a `PermissionMode` type through the full stack: types → store → PTY spawn → terminal window → preload → renderer. The popup sends mode + altKey via IPC; the terminal header shows a clickable badge that injects `/permissions` into the PTY.

**Tech Stack:** TypeScript, Electron IPC, React, node-pty, xterm.js, electron-store

---

### Task 1: Add PermissionMode type and update data model

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add PermissionMode type and update Project interface**

In `src/shared/types.ts`, add the `PermissionMode` type after the `Project` interface, and add `permissionMode?` to `Project`:

```typescript
// Add after the Project interface closing brace (line 7):
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';
```

Update the `Project` interface to include:
```typescript
export interface Project {
  path: string;
  name?: string;
  description?: string;
  hasGit?: boolean;
  githubUrl?: string;
  permissionMode?: PermissionMode;
}
```

Update `ActiveSession` to include:
```typescript
export interface ActiveSession {
  sessionId: string;
  windowId: number;
  permissionMode: PermissionMode;
}
```

Update `CockpitAPI.openSession` signature:
```typescript
openSession: (path: string, forceNew?: boolean, permissionMode?: PermissionMode, altKey?: boolean) => Promise<void>;
```

Add `changePermissionMode` to `TerminalAPI`:
```typescript
export interface TerminalAPI {
  getSessionId: () => string | null;
  sendInput: (data: string) => void;
  onOutput: (callback: (data: string) => void) => void;
  resize: (cols: number, rows: number) => void;
  openPath: (path: string) => void;
  showContextMenu: (options: ContextMenuOptions) => void;
  openExternal: (url: string) => void;
  changePermissionMode: (mode: PermissionMode) => void;
}
```

- [ ] **Step 2: Verify the project builds**

Run: `cd /home/user/cockpit && npm run build:main 2>&1 | tail -20`

Expected: Build errors in files that reference `ActiveSession` or `openSession` with wrong signatures. This is expected — we'll fix them in subsequent tasks. If the types file itself has syntax errors, fix those first.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add PermissionMode type and update Project/ActiveSession/API interfaces"
```

---

### Task 2: Pass permission mode through PTY spawn

**Files:**
- Modify: `src/main/pty.ts`

- [ ] **Step 1: Import PermissionMode and update spawnClaude options**

In `src/main/pty.ts`, add the import and update the function signature:

```typescript
import type { PermissionMode } from '../shared/types';
```

Update the `spawnClaude` function signature (line 35-38):

```typescript
export function spawnClaude(
  projectPath: string,
  claudePath: string,
  options?: { continueSession?: boolean; resumeSessionId?: string; permissionMode?: PermissionMode }
): { id: string; process: IPty } {
```

- [ ] **Step 2: Build permission mode CLI args**

After the existing args building logic (after line 49), add permission mode arg building. Replace the args block:

```typescript
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
```

- [ ] **Step 3: Verify build**

Run: `cd /home/user/cockpit && npm run build:main 2>&1 | tail -20`

Expected: `pty.ts` compiles cleanly. Other files may still have errors from Task 1 type changes.

- [ ] **Step 4: Commit**

```bash
git add src/main/pty.ts
git commit -m "feat(pty): pass --permission-mode flag when spawning claude"
```

---

### Task 3: Pass permission mode through terminal window creation

**Files:**
- Modify: `src/main/terminal-window.ts`

- [ ] **Step 1: Import PermissionMode and update TerminalWindowOptions**

Add the import and extend the options interface:

```typescript
import type { PermissionMode } from '../shared/types';
```

Update the interface:
```typescript
export interface TerminalWindowOptions {
  sessionId: string;
  projectName: string;
  projectPath: string;
  hasGit?: boolean;
  githubUrl?: string;
  permissionMode?: PermissionMode;
  onClose?: () => void;
}
```

- [ ] **Step 2: Pass permissionMode via URL query params**

In `createTerminalWindow`, destructure the new option:

```typescript
const { sessionId, projectName, projectPath, hasGit, githubUrl, permissionMode, onClose } = options;
```

Update the dev URL (line 49) to include permissionMode:

```typescript
  if (process.env.NODE_ENV === 'development') {
    const params = new URLSearchParams({
      sessionId,
      title,
      ...(githubUrl ? { githubUrl } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      dev: '1',
    });
    win.loadURL(`http://localhost:5173/terminal.html?${params.toString()}`);
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/terminal.html'), {
      query: {
        sessionId,
        title,
        ...(githubUrl ? { githubUrl } : {}),
        ...(permissionMode ? { permissionMode } : {}),
      },
    });
  }
```

- [ ] **Step 3: Verify build**

Run: `cd /home/user/cockpit && npm run build:main 2>&1 | tail -20`

Expected: `terminal-window.ts` compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/main/terminal-window.ts
git commit -m "feat(terminal-window): pass permissionMode to renderer via URL params"
```

---

### Task 4: Update preload bridge

**Files:**
- Modify: `src/preload.ts`

- [ ] **Step 1: Update openSession in cockpitApi**

Update the `openSession` method in the `cockpitApi` object:

```typescript
  openSession: (path: string, forceNew?: boolean, permissionMode?: string, altKey?: boolean) =>
    ipcRenderer.invoke('open-session', path, forceNew, permissionMode, altKey),
```

- [ ] **Step 2: Add changePermissionMode to terminalApi**

Add the new method to the `terminalApi` object, before the closing brace:

```typescript
  changePermissionMode: (mode: string) => {
    ipcRenderer.send('change-permission-mode', mode);
  },
```

- [ ] **Step 3: Verify build**

Run: `cd /home/user/cockpit && npm run build:main 2>&1 | tail -20`

Expected: `preload.ts` compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/preload.ts
git commit -m "feat(preload): extend openSession with permissionMode, add changePermissionMode"
```

---

### Task 5: Update main process IPC handlers

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import PermissionMode and Menu**

`Menu` is already imported. Add `PermissionMode` to the type imports:

```typescript
import type { Project, ActiveSession, ServiceStatus, ContextMenuOptions, Schedule, PermissionMode } from '../shared/types';
```

- [ ] **Step 2: Update open-session IPC handler**

Replace the existing `open-session` handler (around line 373):

```typescript
  ipcMain.handle('open-session', async (_event, projectPath: string, forceNew?: boolean, permissionMode?: PermissionMode, altKey?: boolean) => {
    if (popupWindow) {
      popupWindow.hide();
    }

    if (altKey) {
      // Show native context menu for permission mode selection
      const project = store.getProjects().find(p => p.path === projectPath);
      const currentMode = permissionMode || project?.permissionMode || 'default';

      const modes: { label: string; value: PermissionMode }[] = [
        { label: 'Default', value: 'default' },
        { label: 'Accept Edits', value: 'acceptEdits' },
        { label: 'Plan (read-only)', value: 'plan' },
        { label: 'Auto', value: 'auto' },
        { label: "Don't Ask", value: 'dontAsk' },
        { label: 'Bypass Permissions', value: 'bypassPermissions' },
      ];

      const menu = Menu.buildFromTemplate(
        modes.map(({ label, value }) => ({
          label,
          type: 'checkbox' as const,
          checked: value === currentMode,
          click: () => {
            openSessionForProject(projectPath, true, value);
          },
        }))
      );
      menu.popup();
      return;
    }

    const resolvedMode = permissionMode || store.getProjects().find(p => p.path === projectPath)?.permissionMode || 'default';
    await openSessionForProject(projectPath, forceNew ?? false, resolvedMode);
  });
```

- [ ] **Step 3: Update openSessionForProject to accept and pass permissionMode**

Update the function signature and body (around line 639):

```typescript
async function openSessionForProject(projectPath: string, forceNew: boolean, permissionMode: PermissionMode = 'default'): Promise<void> {
```

Update the `spawnClaude` call to pass `permissionMode`:

```typescript
  const { id: sessionId } = pty.spawnClaude(projectPath, claudePath, {
    continueSession: !forceNew,
    permissionMode,
  });
```

Update the `createTerminalWindow` call to pass `permissionMode`:

```typescript
  const win = terminalWindow.createTerminalWindow({
    sessionId,
    projectName,
    projectPath,
    hasGit: project?.hasGit,
    githubUrl: project?.githubUrl,
    permissionMode,
    onClose: () => {
      // ... existing onClose logic unchanged
    },
  });
```

Update the `activeSessions` assignment to include `permissionMode`:

```typescript
  activeSessions[projectPath] = { sessionId, windowId: win.id, permissionMode };
```

- [ ] **Step 4: Update openSessionForProjectWithId similarly**

In `openSessionForProjectWithId` (around line 749), pass the project's permission mode:

```typescript
async function openSessionForProjectWithId(projectPath: string, sessionId: string): Promise<void> {
```

After finding the project, resolve its permission mode:

```typescript
  const permissionMode = project?.permissionMode || 'default';
```

Update the `spawnClaude` call:

```typescript
  const { id: newSessionId } = pty.spawnClaude(projectPath, claudePath, {
    resumeSessionId: sessionId,
    permissionMode,
  });
```

Update the `createTerminalWindow` call to include `permissionMode`.

Update the `activeSessions` assignment:

```typescript
  activeSessions[projectPath] = { sessionId: newSessionId, windowId: win.id, permissionMode };
```

- [ ] **Step 5: Add change-permission-mode IPC handler**

Add a new IPC handler in `registerIpcHandlers()`, after the terminal IPC handlers section:

```typescript
  // Permission mode change from terminal badge
  ipcMain.on('change-permission-mode', (event, mode: PermissionMode) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    const sessionId = windowToSession.get(senderWindow.id);
    if (!sessionId) return;

    // Inject /permissions command into PTY
    pty.writeToSession(sessionId, `/permissions ${mode}\n`);

    // Update activeSessions record
    for (const [projectPath, session] of Object.entries(activeSessions)) {
      if (session.sessionId === sessionId) {
        activeSessions[projectPath] = { ...session, permissionMode: mode };
        notifySessionsChanged();
        break;
      }
    }
  });
```

- [ ] **Step 6: Verify build**

Run: `cd /home/user/cockpit && npm run build:main 2>&1 | tail -20`

Expected: Full main process compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): wire permissionMode through IPC, spawn, and session tracking"
```

---

### Task 6: Add permission mode dropdown to ProjectEditor

**Files:**
- Modify: `src/renderer/ProjectEditor.tsx`

- [ ] **Step 1: Add permissionMode state and dropdown**

In the `ProjectEditor` component, add state for permission mode alongside the existing `name` and `description` state:

```typescript
  const [permissionMode, setPermissionMode] = useState(project.permissionMode || 'default');
```

Add the import for `PermissionMode`:

```typescript
import type { Project, Schedule, ParsedSchedule, ScheduleRun, PermissionMode } from '../shared/types';
```

- [ ] **Step 2: Add the select element to the Details tab**

Between the Description field and the `editor-path` div, add:

```tsx
            <div className="editor-field">
              <label>Permission Mode</label>
              <select
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
              >
                <option value="default">Default</option>
                <option value="acceptEdits">Accept Edits</option>
                <option value="plan">Plan (read-only)</option>
                <option value="auto">Auto</option>
                <option value="dontAsk">Don't Ask</option>
                <option value="bypassPermissions">Bypass Permissions</option>
              </select>
            </div>
```

- [ ] **Step 3: Include permissionMode in handleSave**

Update `handleSave` to include the permission mode:

```typescript
  function handleSave() {
    onSave({ name: name || defaultName, description, permissionMode });
    onClose();
  }
```

- [ ] **Step 4: Verify build**

Run: `cd /home/user/cockpit && npm run build:renderer 2>&1 | tail -20`

Expected: Renderer builds cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ProjectEditor.tsx
git commit -m "feat(project-editor): add permission mode dropdown to Details tab"
```

---

### Task 7: Add altKey detection to popup click handler

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Pass altKey and project permission mode through openSession**

Update `handleProjectClick` to detect altKey and pass the project's permission mode:

```typescript
  async function handleProjectClick(project: Project, e: React.MouseEvent) {
    const altKey = e.altKey;
    const permissionMode = project.permissionMode || 'default';
    await window.cockpit.openSession(project.path, true, permissionMode, altKey);
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }
```

- [ ] **Step 2: Verify build**

Run: `cd /home/user/cockpit && npm run build:renderer 2>&1 | tail -20`

Expected: Renderer builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(popup): pass altKey and permissionMode on project click"
```

---

### Task 8: Add permission badge to terminal header

**Files:**
- Modify: `src/renderer/Terminal.tsx`
- Modify: `src/renderer/terminal.css`

- [ ] **Step 1: Add permission mode state and badge rendering**

In `Terminal.tsx`, add state for permission mode and dropdown visibility. Import `PermissionMode`:

```typescript
import type { PermissionMode } from '../shared/types';
```

Add state inside the component, after the existing `isFocused` state:

```typescript
  const params = new URLSearchParams(window.location.search);
  const title = params.get('title') || '';
  const githubUrl = params.get('githubUrl');
  const initialMode = (params.get('permissionMode') as PermissionMode) || 'default';

  const [permissionMode, setPermissionMode] = useState<PermissionMode>(initialMode);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
```

Remove the duplicate `params`/`title`/`githubUrl` declarations currently at the bottom of the component (lines 250-252), since we moved them into the component body before the return.

- [ ] **Step 2: Define badge display helpers**

Add these helpers inside the component, after the state declarations:

```typescript
  const modeLabels: Record<PermissionMode, string> = {
    default: 'default',
    acceptEdits: 'edits',
    plan: 'plan',
    auto: 'auto',
    dontAsk: 'dontAsk',
    bypassPermissions: 'bypass',
  };

  const modeDisplayNames: Record<PermissionMode, string> = {
    default: 'Default',
    acceptEdits: 'Accept Edits',
    plan: 'Plan (read-only)',
    auto: 'Auto',
    dontAsk: "Don't Ask",
    bypassPermissions: 'Bypass Permissions',
  };

  const modeColors: Record<PermissionMode, string> = {
    default: '',
    acceptEdits: 'yellow',
    plan: 'blue',
    auto: 'orange',
    dontAsk: 'red',
    bypassPermissions: 'darkred',
  };

  function handleModeChange(mode: PermissionMode) {
    setPermissionMode(mode);
    setShowModeDropdown(false);
    window.terminal.changePermissionMode(mode);
  }
```

- [ ] **Step 3: Add close-on-outside-click for dropdown**

Add a useEffect to close the dropdown when clicking outside:

```typescript
  useEffect(() => {
    if (!showModeDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (badgeRef.current && !badgeRef.current.contains(e.target as Node)) {
        setShowModeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showModeDropdown]);
```

- [ ] **Step 4: Render the badge in the drag-region**

Update the JSX return. Replace the entire return block:

```tsx
  return (
    <>
      <div className={`drag-region ${!isFocused ? 'unfocused' : ''}`}>
        <div className="drag-region-title">
          {githubUrl ? (
            <>
              <span
                className="github-link"
                title="Open on GitHub"
                onClick={() => window.terminal.openExternal(githubUrl)}
              >🐙</span>
              {' '}{title.replace(/^🐙\s*/, '')}
            </>
          ) : (
            title
          )}
        </div>
        <span
          ref={badgeRef}
          className={`permission-badge ${modeColors[permissionMode] || 'muted'}`}
          onClick={() => setShowModeDropdown(!showModeDropdown)}
          title={`Permission mode: ${modeDisplayNames[permissionMode]}`}
        >
          {permissionMode === 'default' ? '🛡' : modeLabels[permissionMode]}
        </span>
        {showModeDropdown && (
          <div className="permission-dropdown">
            {(Object.keys(modeDisplayNames) as PermissionMode[]).map((mode) => (
              <div
                key={mode}
                className={`permission-dropdown-item ${mode === permissionMode ? 'active' : ''}`}
                onClick={() => handleModeChange(mode)}
              >
                {modeDisplayNames[mode]}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={`terminal-wrapper ${!isFocused ? 'unfocused' : ''}`}>
        <div ref={containerRef} className="terminal-container" />
        <div className="terminal-spacer" />
      </div>
    </>
  );
```

- [ ] **Step 5: Add CSS for the badge and dropdown**

Append to `src/renderer/terminal.css`:

```css
/* Permission badge */
.drag-region {
  justify-content: space-between;
  padding: 0 80px 0 80px;
}

.drag-region-title {
  flex: 1;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-badge {
  -webkit-app-region: no-drag;
  cursor: pointer;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  position: relative;
  transition: opacity 0.15s ease;
}

.permission-badge.muted {
  opacity: 0.4;
  font-size: 12px;
}

.permission-badge.muted:hover {
  opacity: 0.7;
}

.permission-badge.blue {
  background: rgba(10, 132, 255, 0.25);
  color: #64d2ff;
}

.permission-badge.yellow {
  background: rgba(255, 189, 46, 0.25);
  color: #ffd60a;
}

.permission-badge.orange {
  background: rgba(255, 149, 0, 0.25);
  color: #ff9f0a;
}

.permission-badge.red {
  background: rgba(255, 69, 58, 0.25);
  color: #ff6961;
}

.permission-badge.darkred {
  background: rgba(200, 30, 30, 0.3);
  color: #ff453a;
}

/* Permission dropdown */
.permission-dropdown {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 32px;
  right: 80px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 4px 0;
  z-index: 1001;
  min-width: 160px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.permission-dropdown-item {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
  color: #ccc;
}

.permission-dropdown-item:hover {
  background: #3a3a3a;
}

.permission-dropdown-item.active {
  color: #fff;
  font-weight: 600;
}
```

- [ ] **Step 6: Verify build**

Run: `cd /home/user/cockpit && npm run build 2>&1 | tail -20`

Expected: Both main and renderer build cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/Terminal.tsx src/renderer/terminal.css
git commit -m "feat(terminal): add permission mode badge with dropdown to header"
```

---

### Task 9: Full build verification and manual test

- [ ] **Step 1: Full build**

Run: `cd /home/user/cockpit && npm run build 2>&1`

Expected: Clean build with no errors.

- [ ] **Step 2: Fix any build errors**

If there are TypeScript errors, fix them. Common issues:
- Missing `PermissionMode` imports
- Signature mismatches between types and implementations
- The `ActiveSession` now requires `permissionMode` — make sure all assignments include it

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build errors from permission mode integration"
```

---
