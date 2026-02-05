import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog, globalShortcut, screen, Notification } from 'electron';
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

// Debounce bell notifications per session (prevent spam)
const lastBellTime: Record<string, number> = {};
const BELL_DEBOUNCE_MS = 10000; // 10 seconds between notifications

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
    win.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  return win;
}

function updateTrayTitle(): void {
  if (!tray) return;
  const hasActive = Object.keys(activeSessions).length > 0;
  // Show bullet indicator when sessions are active
  tray.setTitle(hasActive ? '● λ' : 'λ');
}

function updateTrayIcon(): void {
  updateTrayTitle();
}

function showPopupWindow(): void {
  if (!popupWindow) {
    popupWindow = createPopupWindow();
  }

  if (popupWindow.isVisible()) {
    popupWindow.hide();
    return;
  }

  // Position window at tray if available, otherwise top-center of screen
  const { width } = popupWindow.getBounds();
  let x: number;
  let y: number;

  const trayBounds = tray?.getBounds();
  if (trayBounds && trayBounds.x > 0) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
    y = trayBounds.y + trayBounds.height;
  } else {
    // Fallback: top-center of primary display
    const display = screen.getPrimaryDisplay();
    x = Math.round(display.bounds.x + display.bounds.width / 2 - width / 2);
    y = display.bounds.y + 24; // Below menubar
  }

  popupWindow.setPosition(x, y);
  popupWindow.show();
  popupWindow.focus();
}

function createTray(): void {
  // Use empty icon - macOS will show just the title text
  const emptyIcon = nativeImage.createEmpty();
  tray = new Tray(emptyIcon);
  tray.setTitle('λ');
  tray.setToolTip('Cockpit');

  tray.on('click', () => {
    showPopupWindow();
  });
}

function updateDockVisibility(): void {
  if (process.platform !== 'darwin' || !app.dock) return;

  const hasActiveSessions = Object.keys(activeSessions).length > 0;
  if (hasActiveSessions) {
    app.dock.show();
  } else {
    app.dock.hide();
  }
}

function notifySessionsChanged(): void {
  if (popupWindow) {
    popupWindow.webContents.send('sessions-changed', activeSessions);
  }
  updateTrayIcon();
  updateDockVisibility();
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

  ipcMain.on('close-popup', () => {
    if (popupWindow) {
      popupWindow.hide();
    }
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
      hasBeads: project?.hasBeads,
      hasGit: project?.hasGit,
      hasGithub: project?.hasGithub,
      onClose: () => {
        console.log('[terminal-window] closed, cleaning up session:', sessionId);
        pty.killSession(sessionId);
        delete activeSessions[projectPath];
        delete lastBellTime[sessionId];
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

        // Detect bell character and show notification if window not focused
        if (data.includes('\x07') && !termWin.isFocused()) {
          const now = Date.now();
          const lastTime = lastBellTime[sessionId] || 0;
          if (now - lastTime > BELL_DEBOUNCE_MS) {
            lastBellTime[sessionId] = now;
            const iconPath = path.join(app.getAppPath(), 'assets/icon.png');
            new Notification({
              title: 'Cockpit',
              body: `${projectName} needs attention`,
              icon: iconPath,
            }).show();
          }
        }
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

function registerGlobalShortcuts(): void {
  // Cmd+N to open/toggle popup window
  const registered = globalShortcut.register('CommandOrControl+N', () => {
    showPopupWindow();
  });

  if (!registered) {
    console.warn('[shortcuts] Failed to register Cmd+N shortcut');
  }
}

app.whenReady().then(() => {
  // Set dock icon for dev mode (packaged app uses icon from bundle)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(app.getAppPath(), 'assets/icon.png'));
    // Hide dock initially (show when sessions are active)
    app.dock.hide();
  }

  createTray();
  registerIpcHandlers();
  registerGlobalShortcuts();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});

// Confirm quit if active sessions exist
let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting) return;

  const sessionCount = Object.keys(activeSessions).length;
  if (sessionCount === 0) return;

  event.preventDefault();

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    title: 'Quit Cockpit?',
    message: `You have ${sessionCount} active session${sessionCount > 1 ? 's' : ''}.`,
    detail: 'Quitting will terminate all running Claude sessions.',
  });

  if (response === 1) {
    isQuitting = true;
    app.quit();
  }
});
