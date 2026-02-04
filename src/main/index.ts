import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog } from 'electron';
import path from 'path';
import * as store from './store';
import { findClaudeBinary } from './claude';
import * as pty from './pty';
import * as terminalWindow from './terminal-window';
import type { Project, ActiveSession } from '../shared/types';

let tray: Tray | null = null;
let popupWindow: BrowserWindow | null = null;

// Track active sessions in memory
const activeSessions: Record<string, ActiveSession> = {};

function createPopupWindow(): BrowserWindow {
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
    console.log('[tray] clicked, popupWindow exists:', !!popupWindow, 'isVisible:', popupWindow?.isVisible());
    if (!popupWindow) {
      popupWindow = createPopupWindow();
    }

    if (popupWindow.isVisible()) {
      console.log('[tray] hiding popupWindow');
      popupWindow.hide();
    } else {
      console.log('[tray] showing popupWindow');
      const { x, y } = bounds;
      const { width } = popupWindow.getBounds();
      popupWindow.setPosition(Math.round(x - width / 2), y);
      popupWindow.show();
      popupWindow.focus();
    }
  });
}

function notifySessionsChanged(): void {
  if (popupWindow) {
    popupWindow.webContents.send('sessions-changed', activeSessions);
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
    console.log('[open-session] projectPath:', projectPath, 'existing:', existing, 'forceNew:', forceNew);

    // Hide popup window immediately when opening a session
    if (popupWindow) {
      popupWindow.hide();
    }

    if (existing && !forceNew) {
      // Check if session still exists
      const exists = pty.sessionExists(existing.sessionId);
      console.log('[open-session] sessionExists:', exists);
      if (exists) {
        const focused = terminalWindow.focusTerminalWindow(existing.sessionId);
        console.log('[open-session] focusTerminalWindow result:', focused);
        return;
      }
      // Session is gone, remove it
      console.log('[open-session] session gone, removing');
      delete activeSessions[projectPath];
    }

    // Check for claude binary
    const claudePath = findClaudeBinary();
    if (!claudePath) {
      dialog.showErrorBox(
        'Claude not found',
        'Could not find the claude CLI. Please ensure claude is installed and accessible.'
      );
      return;
    }

    // Get project name for window title
    const projects = store.getProjects();
    const project = projects.find((p) => p.path === projectPath);
    const projectName = project?.name || projectPath.split('/').pop() || 'Terminal';

    // Spawn PTY with claude
    console.log('[open-session] creating new session with claude at:', claudePath);
    const { id: sessionId } = pty.spawnClaude(projectPath, claudePath);
    console.log('[open-session] new sessionId:', sessionId);

    // Create terminal window
    const win = terminalWindow.createTerminalWindow({
      sessionId,
      projectName,
      onClose: () => {
        console.log('[terminal-window] closed, cleaning up session:', sessionId);
        pty.killSession(sessionId);
        delete activeSessions[projectPath];
        notifySessionsChanged();
      },
    });

    activeSessions[projectPath] = { sessionId, windowId: win.id };
    notifySessionsChanged();

    // Relay PTY output to terminal window
    pty.onSessionOutput(sessionId, (data) => {
      const termWin = terminalWindow.getTerminalWindow(sessionId);
      if (termWin && !termWin.isDestroyed()) {
        termWin.webContents.send('pty-output', data);
      }
    });

    // Close terminal window when PTY exits
    pty.onSessionExit(sessionId, () => {
      console.log('[pty-exit] session exited:', sessionId);
      terminalWindow.closeTerminalWindow(sessionId);
    });
  });

  // Terminal IPC handlers
  ipcMain.on('pty-input', (event, data: string) => {
    // Get sessionId from the sender window
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    // Find the session for this window
    for (const session of Object.values(activeSessions)) {
      if (session.windowId === senderWindow.id) {
        pty.writeToSession(session.sessionId, data);
        break;
      }
    }
  });

  ipcMain.on('pty-resize', (event, cols: number, rows: number) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    for (const session of Object.values(activeSessions)) {
      if (session.windowId === senderWindow.id) {
        pty.resizeSession(session.sessionId, cols, rows);
        break;
      }
    }
  });
}

app.whenReady().then(() => {
  createTray();
  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});
