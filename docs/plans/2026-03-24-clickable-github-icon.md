# Clickable GitHub Icon in Terminal Window Header

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the 🐙 icon in the terminal window title bar clickable so it opens the project's GitHub repo in the system browser.

**Architecture:** Extract the GitHub remote URL in `store.ts` (replacing the boolean `hasGithub`), pass it through to the terminal window as a query param, and render it as a clickable element in `Terminal.tsx`. Add `openExternal` to the `TerminalAPI` preload bridge.

**Tech Stack:** Electron (shell.openExternal, IPC), React, TypeScript

---

### Task 1: Extract GitHub URL in store.ts

**Files:**
- Modify: `src/main/store.ts:38-47`

**Step 1: Replace `checkHasGithub` with `getGithubUrl`**

Replace the `checkHasGithub` function (lines 38-47) with:

```typescript
function getGithubUrl(projectPath: string): string | undefined {
  const configPath = path.join(os.homedir(), projectPath, '.git', 'config');
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const config = fs.readFileSync(configPath, 'utf-8');
    // Match github.com URLs in any remote (SSH or HTTPS)
    const match = config.match(/url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m);
    if (!match) return undefined;
    return `https://github.com/${match[1]}`;
  } catch {
    return undefined;
  }
}
```

**Step 2: Update `getProjects` to use it**

In `getProjects` (line 54), change:

```typescript
hasGithub: checkHasGithub(p.path),
```

to:

```typescript
githubUrl: getGithubUrl(p.path),
```

**Step 3: Verify build**

Run: `npm run build:main`
Expected: Compile errors (type mismatch — `githubUrl` not on `Project` type yet). That's fine, next task fixes it.

---

### Task 2: Update shared types

**Files:**
- Modify: `src/shared/types.ts:1-7`

**Step 1: Replace `hasGithub` with `githubUrl` on `Project`**

Change:

```typescript
export interface Project {
  path: string;
  name?: string;
  description?: string;
  hasGit?: boolean;
  hasGithub?: boolean;
}
```

to:

```typescript
export interface Project {
  path: string;
  name?: string;
  description?: string;
  hasGit?: boolean;
  githubUrl?: string;
}
```

**Step 2: Add `openExternal` to `TerminalAPI`**

In the `TerminalAPI` interface (around line 102), add:

```typescript
openExternal: (url: string) => void;
```

---

### Task 3: Update preload bridge

**Files:**
- Modify: `src/preload.ts:73-95`

**Step 1: Add `openExternal` to `terminalApi`**

In the `terminalApi` object, add after `showContextMenu`:

```typescript
openExternal: (url: string) => {
  ipcRenderer.send('open-external-url', url);
},
```

---

### Task 4: Handle IPC in main process

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Add IPC listener for `open-external-url`**

Add near the other `ipcMain.on` handlers (around line 475):

```typescript
ipcMain.on('open-external-url', (_event, url: string) => {
  // Only allow opening https URLs to prevent abuse
  if (typeof url === 'string' && url.startsWith('https://')) {
    shell.openExternal(url);
  }
});
```

---

### Task 5: Pass `githubUrl` to terminal window

**Files:**
- Modify: `src/main/terminal-window.ts:10-54`
- Modify: `src/main/terminal-window.ts:120-132`
- Modify: `src/main/index.ts` (3 call sites)

**Step 1: Update `TerminalWindowOptions` interface**

Change:

```typescript
hasGithub?: boolean;
```

to:

```typescript
githubUrl?: string;
```

**Step 2: Update `createTerminalWindow` to pass `githubUrl` as query param**

In `createTerminalWindow`, change line 21:

```typescript
const { sessionId, projectName, projectPath, hasGit, hasGithub, onClose } = options;
```

to:

```typescript
const { sessionId, projectName, projectPath, hasGit, githubUrl, onClose } = options;
```

Change line 26:

```typescript
const gitIndicator = hasGithub ? '🐙' : hasGit ? '⎇' : '';
```

to:

```typescript
const gitIndicator = githubUrl ? '🐙' : hasGit ? '⎇' : '';
```

Update both URL construction paths (dev and prod) to include `githubUrl` param:

Dev (line 49):
```typescript
win.loadURL(`http://localhost:5173/terminal.html?sessionId=${sessionId}&title=${encodeURIComponent(title)}&dev=1${githubUrl ? `&githubUrl=${encodeURIComponent(githubUrl)}` : ''}`);
```

Prod (line 51-53):
```typescript
win.loadFile(path.join(__dirname, '../../renderer/terminal.html'), {
  query: { sessionId, title, ...(githubUrl ? { githubUrl } : {}) },
});
```

**Step 3: Update `updateTerminalWindowTitle`**

Change the function signature and body:

```typescript
export function updateTerminalWindowTitle(
  sessionId: string,
  projectName: string,
  options?: { hasGit?: boolean; githubUrl?: string }
): void {
  const win = terminalWindows.get(sessionId);
  if (win && !win.isDestroyed()) {
    const gitIndicator = options?.githubUrl ? '🐙' : options?.hasGit ? '⎇' : '';
    const indicators = gitIndicator;
    const title = indicators ? `${indicators} ${projectName}` : projectName;
    win.setTitle(title);
  }
}
```

**Step 4: Update call sites in `index.ts`**

At line 238-239, change:

```typescript
hasGit: updatedProject.hasGit,
hasGithub: updatedProject.hasGithub,
```

to:

```typescript
hasGit: updatedProject.hasGit,
githubUrl: updatedProject.githubUrl,
```

At lines 670-671, change:

```typescript
hasGit: project?.hasGit,
hasGithub: project?.hasGithub,
```

to:

```typescript
hasGit: project?.hasGit,
githubUrl: project?.githubUrl,
```

At lines 765-766, same change:

```typescript
hasGit: project?.hasGit,
githubUrl: project?.githubUrl,
```

---

### Task 6: Render clickable icon in Terminal.tsx

**Files:**
- Modify: `src/renderer/Terminal.tsx:243-247`
- Modify: `src/renderer/terminal.css`

**Step 1: Parse `githubUrl` and render clickable icon**

Replace lines 243-247:

```typescript
const title = new URLSearchParams(window.location.search).get('title') || '';

return (
  <>
    <div className={`drag-region ${!isFocused ? 'unfocused' : ''}`}>{title}</div>
```

with:

```typescript
const params = new URLSearchParams(window.location.search);
const title = params.get('title') || '';
const githubUrl = params.get('githubUrl');

return (
  <>
    <div className={`drag-region ${!isFocused ? 'unfocused' : ''}`}>
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
```

**Step 2: Add CSS for clickable icon**

Add to `src/renderer/terminal.css`:

```css
.github-link {
  -webkit-app-region: no-drag;
  cursor: pointer;
  transition: transform 0.1s ease;
}

.github-link:hover {
  transform: scale(1.2);
}
```

---

### Task 7: Update popup UI (App.tsx)

**Files:**
- Modify: `src/renderer/App.tsx:423-431`

**Step 1: Update `hasGithub` reference to `githubUrl`**

Change:

```tsx
{project.hasGithub ? (
  <span className="github-indicator" title="GitHub repository">🐙</span>
```

to:

```tsx
{project.githubUrl ? (
  <span className="github-indicator" title="GitHub repository">🐙</span>
```

---

### Task 8: Build and test

**Step 1: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Manual test**

Run: `npm run dev`

Verify:
1. Open a project with a GitHub remote → 🐙 shows in terminal title bar
2. Click 🐙 → system browser opens the GitHub repo URL
3. Dragging the title bar still works (icon area excluded)
4. Projects without GitHub still show ⎇ or no icon
5. Popup project list still shows 🐙 for GitHub projects

**Step 3: Commit**

```bash
git add src/main/store.ts src/shared/types.ts src/preload.ts src/main/index.ts src/main/terminal-window.ts src/renderer/Terminal.tsx src/renderer/terminal.css src/renderer/App.tsx
git commit -m "feat: make GitHub icon clickable to open repo in browser (#34)"
```
