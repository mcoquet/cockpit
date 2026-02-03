import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog } from 'electron';
import path from 'path';
import * as store from './store';
import type { Project } from '../shared/types';

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

  // Placeholder handlers for session management (Task 5)
  ipcMain.handle('get-active-sessions', () => ({}));
  ipcMain.handle('open-session', async () => {});
}

app.dock?.hide();

app.whenReady().then(() => {
  createTray();
  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});
