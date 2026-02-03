# Cockpit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a macOS menubar app to manage Claude Code projects with iTerm2 integration.

**Architecture:** Electron app with React renderer. Main process handles tray, iTerm2 AppleScript calls, and data persistence. Renderer displays project list in a dropdown panel. IPC bridges the two.

**Tech Stack:** Electron, React, TypeScript, electron-store, AppleScript (osascript)

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Initialize npm project**

Run:
```bash
cd /Users/miguelcoquet/Documents/projects/cockpit
npm init -y
```

**Step 2: Install dependencies**

Run:
```bash
npm install electron electron-store
npm install -D typescript @types/node electron-builder concurrently wait-on
npm install react react-dom
npm install -D @types/react @types/react-dom
npm install -D vite @vitejs/plugin-react
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
out/
.DS_Store
*.log
```

**Step 5: Update package.json scripts and main**

Add to package.json:
```json
{
  "main": "dist/main/index.js",
  "scripts": {
    "build:main": "tsc -p tsconfig.main.json",
    "build:renderer": "vite build",
    "build": "npm run build:main && npm run build:renderer",
    "dev:main": "tsc -p tsconfig.main.json --watch",
    "dev:renderer": "vite",
    "dev": "concurrently \"npm run dev:main\" \"wait-on dist/main/index.js && electron .\"",
    "start": "electron ."
  }
}
```

**Step 6: Create tsconfig.main.json for main process**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist/main",
    "rootDir": "./src/main",
    "resolveJsonModule": true
  },
  "include": ["src/main/**/*", "src/preload.ts"]
}
```

**Step 7: Create vite.config.ts for renderer**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
});
```

**Step 8: Initialize git and commit**

Run:
```bash
git init
git add .
git commit -m "chore: initial project scaffolding"
```

---

## Task 2: Electron Main Process - Basic Tray

**Files:**
- Create: `src/main/index.ts`
- Create: `assets/iconTemplate.png` (16x16 tray icon)
- Create: `assets/iconTemplate@2x.png` (32x32 tray icon)

**Step 1: Create placeholder tray icons**

Create `assets/` directory. For now, we'll use a simple approach - Electron can use a template image or we generate one. Create a simple 16x16 PNG named `iconTemplate.png` (black circle on transparent background works as placeholder).

Run:
```bash
mkdir -p assets
```

Note: You'll need to create or download a simple menubar icon. A 16x16 and 32x32 PNG with "Template" suffix tells macOS to auto-color it.

**Step 2: Create main process entry**

Create `src/main/index.ts`:

```typescript
import { app, Tray, BrowserWindow, nativeImage } from 'electron';
import path from 'path';

let tray: Tray | null = null;
let window: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../../assets/iconTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('Cockpit');

  tray.on('click', (_event, bounds) => {
    if (!window) {
      window = createWindow();
    }

    if (window.isVisible()) {
      window.hide();
    } else {
      const { x, y } = bounds;
      const { width, height } = window.getBounds();
      window.setPosition(Math.round(x - width / 2), y);
      window.show();
    }
  });
}

app.dock?.hide();

app.whenReady().then(() => {
  createTray();
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});
```

**Step 3: Build and test**

Run:
```bash
npm run build:main
npm start
```

Expected: App starts with tray icon. Clicking it does nothing visible yet (no renderer).

**Step 4: Commit**

Run:
```bash
git add .
git commit -m "feat: basic tray icon and window shell"
```

---

## Task 3: Preload Script and IPC Setup

**Files:**
- Create: `src/preload.ts`
- Create: `src/shared/types.ts`

**Step 1: Create shared types**

Create `src/shared/types.ts`:

```typescript
export interface Project {
  path: string;
  name?: string;
  description?: string;
}

export interface ActiveSession {
  sessionId: string;
}

export interface CockpitAPI {
  getProjects: () => Promise<Project[]>;
  addProject: (path: string) => Promise<Project>;
  updateProject: (path: string, updates: Partial<Project>) => Promise<Project>;
  removeProject: (path: string) => Promise<void>;
  openSession: (path: string, forceNew?: boolean) => Promise<void>;
  getActiveSessions: () => Promise<Record<string, ActiveSession>>;
  selectFolder: () => Promise<string | null>;
  onSessionsChanged: (callback: (sessions: Record<string, ActiveSession>) => void) => void;
}

declare global {
  interface Window {
    cockpit: CockpitAPI;
  }
}
```

**Step 2: Create preload script**

Create `src/preload.ts`:

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import type { Project, ActiveSession, CockpitAPI } from './shared/types';

const api: CockpitAPI = {
  getProjects: () => ipcRenderer.invoke('get-projects'),
  addProject: (path: string) => ipcRenderer.invoke('add-project', path),
  updateProject: (path: string, updates: Partial<Project>) =>
    ipcRenderer.invoke('update-project', path, updates),
  removeProject: (path: string) => ipcRenderer.invoke('remove-project', path),
  openSession: (path: string, forceNew?: boolean) =>
    ipcRenderer.invoke('open-session', path, forceNew),
  getActiveSessions: () => ipcRenderer.invoke('get-active-sessions'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  onSessionsChanged: (callback) => {
    ipcRenderer.on('sessions-changed', (_event, sessions) => callback(sessions));
  },
};

contextBridge.exposeInMainWorld('cockpit', api);
```

**Step 3: Update tsconfig.main.json to include shared types**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist/main",
    "rootDir": "./src",
    "resolveJsonModule": true
  },
  "include": ["src/main/**/*", "src/preload.ts", "src/shared/**/*"]
}
```

**Step 4: Build and verify preload compiles**

Run:
```bash
npm run build:main
```

Expected: No errors, `dist/preload.js` exists.

**Step 5: Commit**

Run:
```bash
git add .
git commit -m "feat: preload script with IPC types"
```

---

## Task 4: Project Store (Data Persistence)

**Files:**
- Create: `src/main/store.ts`
- Modify: `src/main/index.ts`

**Step 1: Create store module**

Create `src/main/store.ts`:

```typescript
import Store from 'electron-store';
import path from 'path';
import os from 'os';
import type { Project } from '../shared/types';

interface StoreSchema {
  projects: Project[];
}

const store = new Store<StoreSchema>({
  name: 'projects',
  defaults: {
    projects: [],
  },
});

export function getProjects(): Project[] {
  return store.get('projects');
}

export function addProject(projectPath: string): Project {
  const projects = getProjects();

  // Convert absolute path to relative from home
  const homePath = os.homedir();
  const relativePath = projectPath.startsWith(homePath)
    ? projectPath.slice(homePath.length + 1)
    : projectPath;

  // Check if already exists
  if (projects.some((p) => p.path === relativePath)) {
    throw new Error('Project already exists');
  }

  const name = path.basename(relativePath);
  const project: Project = { path: relativePath, name };

  store.set('projects', [...projects, project]);
  return project;
}

export function updateProject(projectPath: string, updates: Partial<Project>): Project {
  const projects = getProjects();
  const index = projects.findIndex((p) => p.path === projectPath);

  if (index === -1) {
    throw new Error('Project not found');
  }

  const updated = { ...projects[index], ...updates, path: projectPath };
  projects[index] = updated;
  store.set('projects', projects);
  return updated;
}

export function removeProject(projectPath: string): void {
  const projects = getProjects();
  store.set('projects', projects.filter((p) => p.path !== projectPath));
}
```

**Step 2: Wire up IPC handlers in main**

Update `src/main/index.ts`, add imports and handlers:

```typescript
import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog } from 'electron';
import path from 'path';
import * as store from './store';
import type { Project } from '../shared/types';

// ... existing code ...

// Add after app.whenReady():
app.whenReady().then(() => {
  createTray();
  registerIpcHandlers();
});

function registerIpcHandlers(): void {
  ipcMain.handle('get-projects', () => store.getProjects());

  ipcMain.handle('add-project', (_event, projectPath: string) =>
    store.addProject(projectPath)
  );

  ipcMain.handle('update-project', (_event, projectPath: string, updates: Partial<Project>) =>
    store.updateProject(projectPath, updates)
  );

  ipcMain.handle('remove-project', (_event, projectPath: string) =>
    store.removeProject(projectPath)
  );

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}
```

**Step 3: Build and test**

Run:
```bash
npm run build:main
```

Expected: Compiles without errors.

**Step 4: Commit**

Run:
```bash
git add .
git commit -m "feat: project store with persistence"
```

---

## Task 5: iTerm2 Integration

**Files:**
- Create: `src/main/iterm.ts`
- Modify: `src/main/index.ts`

**Step 1: Create iTerm2 module**

Create `src/main/iterm.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

interface SessionInfo {
  sessionId: string;
}

export async function openSession(relativePath: string): Promise<SessionInfo> {
  const fullPath = `${os.homedir()}/${relativePath}`;

  const script = `
    tell application "iTerm2"
      activate
      set newWindow to (create window with default profile command "cd ${fullPath} && claude")
      tell current session of newWindow
        set sessionId to id
      end tell
      return sessionId
    end tell
  `;

  const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
  return { sessionId: stdout.trim() };
}

export async function focusSession(sessionId: string): Promise<boolean> {
  const script = `
    tell application "iTerm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if id of s is "${sessionId}" then
              select s
              tell w to select t
              activate
              return true
            end if
          end repeat
        end repeat
      end repeat
      return false
    end tell
  `;

  const { stdout } = await execAsync(`osascript -e '${script}'`);
  return stdout.trim() === 'true';
}

export async function sessionExists(sessionId: string): Promise<boolean> {
  const script = `
    tell application "iTerm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if id of s is "${sessionId}" then
              return true
            end if
          end repeat
        end repeat
      end repeat
      return false
    end tell
  `;

  const { stdout } = await execAsync(`osascript -e '${script}'`);
  return stdout.trim() === 'true';
}
```

**Step 2: Add session tracking and IPC handlers**

Update `src/main/index.ts`:

```typescript
import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog } from 'electron';
import path from 'path';
import * as store from './store';
import * as iterm from './iterm';
import type { Project, ActiveSession } from '../shared/types';

let tray: Tray | null = null;
let window: BrowserWindow | null = null;

// Track active sessions in memory
const activeSessions: Record<string, ActiveSession> = {};

// ... existing createWindow and createTray functions ...

function registerIpcHandlers(): void {
  ipcMain.handle('get-projects', () => store.getProjects());

  ipcMain.handle('add-project', (_event, projectPath: string) =>
    store.addProject(projectPath)
  );

  ipcMain.handle('update-project', (_event, projectPath: string, updates: Partial<Project>) =>
    store.updateProject(projectPath, updates)
  );

  ipcMain.handle('remove-project', (_event, projectPath: string) =>
    store.removeProject(projectPath)
  );

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('get-active-sessions', () => activeSessions);

  ipcMain.handle('open-session', async (_event, projectPath: string, forceNew?: boolean) => {
    const existing = activeSessions[projectPath];

    if (existing && !forceNew) {
      // Check if session still exists
      const exists = await iterm.sessionExists(existing.sessionId);
      if (exists) {
        await iterm.focusSession(existing.sessionId);
        return;
      }
      // Session is gone, remove it
      delete activeSessions[projectPath];
    }

    // Open new session
    const { sessionId } = await iterm.openSession(projectPath);
    activeSessions[projectPath] = { sessionId };
    notifySessionsChanged();
  });
}

function notifySessionsChanged(): void {
  if (window) {
    window.webContents.send('sessions-changed', activeSessions);
  }
}

app.dock?.hide();

app.whenReady().then(() => {
  createTray();
  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});
```

**Step 3: Build and test**

Run:
```bash
npm run build:main
```

Expected: Compiles without errors.

**Step 4: Commit**

Run:
```bash
git add .
git commit -m "feat: iTerm2 session management"
```

---

## Task 6: React Renderer - Basic Setup

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/index.css`

**Step 1: Create HTML entry**

Create `src/renderer/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cockpit</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

**Step 2: Create main entry**

Create `src/renderer/main.tsx`:

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

**Step 3: Create App component**

Create `src/renderer/App.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import type { Project, ActiveSession } from '../shared/types';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Record<string, ActiveSession>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
    window.cockpit.onSessionsChanged(setSessions);
  }, []);

  async function loadData() {
    const [projectList, activeSessions] = await Promise.all([
      window.cockpit.getProjects(),
      window.cockpit.getActiveSessions(),
    ]);
    setProjects(projectList);
    setSessions(activeSessions);
  }

  async function handleAddProject() {
    const path = await window.cockpit.selectFolder();
    if (path) {
      await window.cockpit.addProject(path);
      loadData();
    }
  }

  async function handleProjectClick(project: Project, e: React.MouseEvent) {
    const forceNew = e.metaKey;
    await window.cockpit.openSession(project.path, forceNew);
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }

  const filtered = projects.filter((p) => {
    const name = p.name || p.path.split('/').pop() || '';
    const desc = p.description || '';
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  });

  return (
    <div className="app">
      <div className="search-container">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>
      <div className="project-list">
        {filtered.map((project) => {
          const name = project.name || project.path.split('/').pop();
          const isActive = !!sessions[project.path];
          return (
            <div
              key={project.path}
              className="project-item"
              onClick={(e) => handleProjectClick(project, e)}
            >
              <div className="project-header">
                {isActive && <span className="active-indicator">●</span>}
                <span className="project-name">{name}</span>
              </div>
              {project.description && (
                <div className="project-description">{project.description}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="footer">
        <button onClick={handleAddProject}>+ Add Project</button>
      </div>
    </div>
  );
}
```

**Step 4: Create styles**

Create `src/renderer/index.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  background: #1e1e1e;
  color: #e0e0e0;
  user-select: none;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.search-container {
  padding: 8px;
  border-bottom: 1px solid #333;
}

.search-input {
  width: 100%;
  padding: 8px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}

.search-input:focus {
  border-color: #0a84ff;
}

.project-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.project-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #2a2a2a;
}

.project-item:hover {
  background: #2a2a2a;
}

.project-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.active-indicator {
  color: #30d158;
  font-size: 10px;
}

.project-name {
  font-weight: 500;
}

.project-description {
  margin-top: 4px;
  color: #888;
  font-size: 12px;
}

.footer {
  padding: 8px;
  border-top: 1px solid #333;
  display: flex;
  gap: 8px;
}

.footer button {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  background: #333;
  color: #e0e0e0;
  font-size: 13px;
  cursor: pointer;
}

.footer button:hover {
  background: #444;
}
```

**Step 5: Create tsconfig for renderer**

Create `tsconfig.renderer.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

**Step 6: Update vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
```

**Step 7: Test dev mode**

Run:
```bash
npm run build:main
npm run dev:renderer
```

In another terminal:
```bash
npm start
```

Expected: Clicking tray shows dropdown with search and Add Project button.

**Step 8: Commit**

Run:
```bash
git add .
git commit -m "feat: React renderer with project list UI"
```

---

## Task 7: Project Edit/Remove UI

**Files:**
- Create: `src/renderer/ProjectEditor.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/index.css`

**Step 1: Create ProjectEditor component**

Create `src/renderer/ProjectEditor.tsx`:

```typescript
import React, { useState } from 'react';
import type { Project } from '../shared/types';

interface Props {
  project: Project;
  onSave: (updates: Partial<Project>) => void;
  onRemove: () => void;
  onClose: () => void;
}

export default function ProjectEditor({ project, onSave, onRemove, onClose }: Props) {
  const defaultName = project.path.split('/').pop() || '';
  const [name, setName] = useState(project.name || defaultName);
  const [description, setDescription] = useState(project.description || '');

  function handleSave() {
    onSave({ name: name || defaultName, description });
    onClose();
  }

  function handleRemove() {
    if (confirm('Remove this project from Cockpit?')) {
      onRemove();
      onClose();
    }
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor-panel" onClick={(e) => e.stopPropagation()}>
        <div className="editor-header">Edit Project</div>
        <div className="editor-field">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
          />
        </div>
        <div className="editor-field">
          <label>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project for?"
          />
        </div>
        <div className="editor-path">{project.path}</div>
        <div className="editor-actions">
          <button className="remove-btn" onClick={handleRemove}>Remove</button>
          <button className="save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Update App.tsx to include editor**

```typescript
import React, { useEffect, useState } from 'react';
import type { Project, ActiveSession } from '../shared/types';
import ProjectEditor from './ProjectEditor';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Record<string, ActiveSession>>({});
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);

  useEffect(() => {
    loadData();
    window.cockpit.onSessionsChanged(setSessions);
  }, []);

  async function loadData() {
    const [projectList, activeSessions] = await Promise.all([
      window.cockpit.getProjects(),
      window.cockpit.getActiveSessions(),
    ]);
    setProjects(projectList);
    setSessions(activeSessions);
  }

  async function handleAddProject() {
    const path = await window.cockpit.selectFolder();
    if (path) {
      await window.cockpit.addProject(path);
      loadData();
    }
  }

  async function handleProjectClick(project: Project, e: React.MouseEvent) {
    const forceNew = e.metaKey;
    await window.cockpit.openSession(project.path, forceNew);
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }

  function handleContextMenu(project: Project, e: React.MouseEvent) {
    e.preventDefault();
    setEditing(project);
  }

  async function handleSaveProject(updates: Partial<Project>) {
    if (editing) {
      await window.cockpit.updateProject(editing.path, updates);
      loadData();
    }
  }

  async function handleRemoveProject() {
    if (editing) {
      await window.cockpit.removeProject(editing.path);
      loadData();
    }
  }

  const filtered = projects.filter((p) => {
    const name = p.name || p.path.split('/').pop() || '';
    const desc = p.description || '';
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  });

  return (
    <div className="app">
      <div className="search-container">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>
      <div className="project-list">
        {filtered.map((project) => {
          const name = project.name || project.path.split('/').pop();
          const isActive = !!sessions[project.path];
          return (
            <div
              key={project.path}
              className="project-item"
              onClick={(e) => handleProjectClick(project, e)}
              onContextMenu={(e) => handleContextMenu(project, e)}
            >
              <div className="project-header">
                {isActive && <span className="active-indicator">●</span>}
                <span className="project-name">{name}</span>
              </div>
              {project.description && (
                <div className="project-description">{project.description}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="footer">
        <button onClick={handleAddProject}>+ Add Project</button>
      </div>
      {editing && (
        <ProjectEditor
          project={editing}
          onSave={handleSaveProject}
          onRemove={handleRemoveProject}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

**Step 3: Add editor styles to index.css**

Append to `src/renderer/index.css`:

```css
.editor-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.editor-panel {
  background: #2a2a2a;
  border-radius: 8px;
  padding: 16px;
  width: 280px;
}

.editor-header {
  font-weight: 600;
  margin-bottom: 12px;
}

.editor-field {
  margin-bottom: 12px;
}

.editor-field label {
  display: block;
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
}

.editor-field input {
  width: 100%;
  padding: 8px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #1e1e1e;
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}

.editor-field input:focus {
  border-color: #0a84ff;
}

.editor-path {
  font-size: 11px;
  color: #666;
  margin-bottom: 12px;
  word-break: break-all;
}

.editor-actions {
  display: flex;
  gap: 8px;
}

.editor-actions button {
  flex: 1;
  padding: 8px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}

.save-btn {
  background: #0a84ff;
  color: white;
}

.save-btn:hover {
  background: #0077ed;
}

.remove-btn {
  background: #444;
  color: #e0e0e0;
}

.remove-btn:hover {
  background: #ff453a;
  color: white;
}
```

**Step 4: Test**

Run dev mode and verify:
- Right-click a project opens editor
- Can edit name and description
- Can remove project

**Step 5: Commit**

Run:
```bash
git add .
git commit -m "feat: project edit and remove UI"
```

---

## Task 8: Window Behavior Polish

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Hide window when clicking outside**

Update `src/main/index.ts` - add blur handler:

```typescript
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 400,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('blur', () => {
    win.hide();
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}
```

**Step 2: Add rounded corners to CSS**

Update `src/renderer/index.css` body:

```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  background: #1e1e1e;
  color: #e0e0e0;
  user-select: none;
  border-radius: 10px;
  overflow: hidden;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  border-radius: 10px;
  border: 1px solid #333;
}
```

**Step 3: Test**

Clicking outside the dropdown should hide it.

**Step 4: Commit**

Run:
```bash
git add .
git commit -m "feat: window blur to hide, rounded corners"
```

---

## Task 9: Build and Package

**Files:**
- Modify: `package.json`
- Create: `electron-builder.json`

**Step 1: Create electron-builder config**

Create `electron-builder.json`:

```json
{
  "appId": "com.cockpit.app",
  "productName": "Cockpit",
  "directories": {
    "output": "out"
  },
  "files": [
    "dist/**/*",
    "assets/**/*"
  ],
  "mac": {
    "category": "public.app-category.developer-tools",
    "target": "dmg",
    "icon": "assets/icon.icns"
  }
}
```

**Step 2: Update package.json**

Add build script:

```json
{
  "scripts": {
    "build:main": "tsc -p tsconfig.main.json",
    "build:renderer": "vite build",
    "build": "npm run build:main && npm run build:renderer",
    "dev:main": "tsc -p tsconfig.main.json --watch",
    "dev:renderer": "vite",
    "dev": "concurrently \"npm run dev:main\" \"wait-on dist/main/index.js && NODE_ENV=development electron .\"",
    "start": "electron .",
    "package": "npm run build && electron-builder"
  }
}
```

**Step 3: Build the app**

Run:
```bash
npm run package
```

Expected: Creates `.dmg` in `out/` folder.

**Step 4: Commit**

Run:
```bash
git add .
git commit -m "feat: electron-builder packaging config"
```

---

## Summary

After completing all tasks, you'll have:

1. **Menubar app** that lives in the system tray
2. **Project list** with search filtering
3. **Add project** via native folder picker
4. **Edit/remove** projects via right-click
5. **iTerm2 integration** - opens Claude Code sessions
6. **Session tracking** - shows active indicator, focuses existing sessions
7. **Cmd+click** to force new session
8. **Packaged app** ready to install

The app stores projects in Electron's userData and tracks active iTerm2 sessions in memory.
