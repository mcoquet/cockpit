import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog, globalShortcut, screen, Notification, Menu } from 'electron';
import path from 'path';
import * as store from './store';
import { findClaudeBinary } from './claude';
import * as pty from './pty';
import * as terminalWindow from './terminal-window';
import { requestPermission } from './permissions';
import * as settings from './settings';
import type { AppSettings } from '../shared/types';
import type { Project, ActiveSession } from '../shared/types';

let tray: Tray | null = null;
let popupWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

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

  // Position window center-screen, slightly above middle (like Raycast/Alfred)
  const { width, height } = popupWindow.getBounds();
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.bounds.x + display.bounds.width / 2 - width / 2);
  const y = Math.round(display.bounds.y + display.bounds.height / 3 - height / 2);

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

function createSettingsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 420,
    title: 'Cockpit Settings',
    resizable: false,
    minimizable: false,
    maximizable: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    transparent: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173/settings.html');
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/settings.html'));
  }

  win.on('closed', () => {
    settingsWindow = null;
  });

  return win;
}

function showSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = createSettingsWindow();
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

  ipcMain.handle('get-settings', () => settings.getSettings());

  ipcMain.handle('save-settings', (_event, newSettings: AppSettings) => {
    settings.saveSettings(newSettings);
  });

  ipcMain.handle('get-active-sessions', () => activeSessions);

  ipcMain.handle('open-session', async (_event, projectPath: string, forceNew?: boolean) => {
    // Hide popup window immediately when opening a session
    if (popupWindow) {
      popupWindow.hide();
    }

    await openSessionForProject(projectPath, forceNew ?? false);
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
  // Cmd+` to cycle through terminal windows
  const registeredBacktick = globalShortcut.register('CommandOrControl+`', () => {
    terminalWindow.cycleTerminalWindows();
  });

  if (!registeredBacktick) {
    console.warn('[shortcuts] Failed to register Cmd+` shortcut');
  }
}

function openNewSessionInCurrentProject(): void {
  const focusedWindowId = terminalWindow.getFocusedTerminalWindowId();
  if (!focusedWindowId) {
    // No terminal window focused, show popup instead
    showPopupWindow();
    return;
  }

  // Find the project path for the focused window
  let projectPath: string | null = null;
  for (const [path, session] of Object.entries(activeSessions)) {
    if (session.windowId === focusedWindowId) {
      projectPath = path;
      break;
    }
  }

  if (!projectPath) {
    showPopupWindow();
    return;
  }

  // Trigger open-session with forceNew=true
  // We need to emit this as if it came from IPC
  openSessionForProject(projectPath, true);
}

async function openSessionForProject(projectPath: string, forceNew: boolean): Promise<void> {
  const existing = activeSessions[projectPath];
  console.log('[open-session] projectPath:', projectPath, 'existing:', existing, 'forceNew:', forceNew);

  if (existing && !forceNew) {
    const exists = pty.sessionExists(existing.sessionId);
    console.log('[open-session] sessionExists:', exists);
    if (exists) {
      const focused = terminalWindow.focusTerminalWindow(existing.sessionId);
      console.log('[open-session] focusTerminalWindow result:', focused);
      return;
    }
    console.log('[open-session] session gone, removing');
    delete activeSessions[projectPath];
  }

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

  console.log('[open-session] creating new session with claude at:', claudePath);
  const { id: sessionId } = pty.spawnClaude(projectPath, claudePath);
  console.log('[open-session] new sessionId:', sessionId);

  const win = terminalWindow.createTerminalWindow({
    sessionId,
    projectName,
    hasBeads: project?.hasBeads,
    hasGit: project?.hasGit,
    hasGithub: project?.hasGithub,
    onClose: () => {
      console.log('[terminal-window] closed, cleaning up session:', sessionId);
      pty.killSession(sessionId);
      // Only delete if this is the session for this project
      if (activeSessions[projectPath]?.sessionId === sessionId) {
        delete activeSessions[projectPath];
      }
      delete lastBellTime[sessionId];
      notifySessionsChanged();
    },
  });

  // For multiple sessions per project, we need a different key
  // But for now, keep the simple model - just track the latest
  activeSessions[projectPath] = { sessionId, windowId: win.id };
  notifySessionsChanged();

  pty.onSessionOutput(sessionId, (data) => {
    const termWin = terminalWindow.getTerminalWindow(sessionId);
    if (termWin && !termWin.isDestroyed()) {
      termWin.webContents.send('pty-output', data);

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

  pty.onSessionExit(sessionId, () => {
    console.log('[pty-exit] session exited:', sessionId);
    terminalWindow.closeTerminalWindow(sessionId);
  });
}

function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CommandOrControl+,',
          click: () => showSettingsWindow(),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session in Project',
          accelerator: 'CommandOrControl+N',
          click: () => openNewSessionInCurrentProject(),
        },
      ],
    },
    {
      label: 'Permissions',
      submenu: [
        {
          label: 'Request Calendar Access',
          click: async () => {
            const granted = await requestPermission('calendar');
            if (!granted) {
              dialog.showMessageBox({
                type: 'info',
                title: 'Calendar Access',
                message: 'Calendar access was denied or not yet granted.',
                detail: 'Go to System Settings > Privacy & Security > Calendar to enable access for Cockpit.',
              });
            }
          },
        },
        {
          label: 'Request Reminders Access',
          click: async () => {
            const granted = await requestPermission('reminders');
            if (!granted) {
              dialog.showMessageBox({
                type: 'info',
                title: 'Reminders Access',
                message: 'Reminders access was denied or not yet granted.',
                detail: 'Go to System Settings > Privacy & Security > Reminders to enable access for Cockpit.',
              });
            }
          },
        },
        {
          label: 'Request Automation Access',
          click: async () => {
            const granted = await requestPermission('automation');
            if (!granted) {
              dialog.showMessageBox({
                type: 'info',
                title: 'Automation Access',
                message: 'Automation access was denied or not yet granted.',
                detail: 'Go to System Settings > Privacy & Security > Automation to enable access for Cockpit.',
              });
            }
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Set dock icon for dev mode (packaged app uses icon from bundle)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(path.join(app.getAppPath(), 'assets/icon.png'));
    // Hide dock initially (show when sessions are active)
    app.dock.hide();
  }

  createTray();
  createAppMenu();
  registerIpcHandlers();
  registerGlobalShortcuts();

  // Initialize settings and register global shortcut for popup
  settings.initializeSettings(() => showPopupWindow());
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
