import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog } from 'electron';
import path from 'path';
import * as store from './store';
import * as iterm from './iterm';
import type { Project, ActiveSession } from '../shared/types';

let tray: Tray | null = null;
let window: BrowserWindow | null = null;

// Track active sessions in memory
const activeSessions: Record<string, ActiveSession> = {};

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

function createTray(): void {
  const iconPath = path.join(__dirname, '../../assets/iconTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
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
      const { width } = window.getBounds();
      window.setPosition(Math.round(x - width / 2), y);
      window.show();
    }
  });
}

function notifySessionsChanged(): void {
  if (window) {
    window.webContents.send('sessions-changed', activeSessions);
  }
}

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

app.dock?.hide();

app.whenReady().then(() => {
  createTray();
  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});
