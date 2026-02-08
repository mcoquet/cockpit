import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog, globalShortcut, screen, Notification, Menu } from 'electron';
import path from 'path';
import * as store from './store';
import { findClaudeBinary } from './claude';
import * as pty from './pty';
import * as terminalWindow from './terminal-window';
import { requestPermission } from './permissions';
import * as settings from './settings';
import { getClaudeStats } from './claude-stats';
import type { AppSettings } from '../shared/types';
import type { Project, ActiveSession, ServiceStatus } from '../shared/types';

let tray: Tray | null = null;
let popupWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let statusWindow: BrowserWindow | null = null;

// Use omega (Ω) in dev mode, lambda (λ) in production
const TRAY_SYMBOL = process.env.NODE_ENV === 'development' ? 'Ω' : 'λ';

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

  win.on('closed', () => {
    popupWindow = null;
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
  tray.setTitle(hasActive ? `● ${TRAY_SYMBOL}` : TRAY_SYMBOL);
}

function updateTrayIcon(): void {
  updateTrayTitle();
}

function showPopupWindow(): void {
  if (!popupWindow || popupWindow.isDestroyed()) {
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
  tray.setTitle(TRAY_SYMBOL);
  tray.setToolTip('Cockpit');

  tray.on('click', (event) => {
    // Shift+Cmd+click shows status window
    if (event.metaKey && event.shiftKey) {
      showStatusWindow();
    } else {
      showPopupWindow();
    }
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

function createStatusWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 320,
    title: 'Claude Status',
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
    win.loadURL('http://localhost:5173/status.html');
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/status.html'));
  }

  win.on('closed', () => {
    statusWindow = null;
  });

  return win;
}

function showStatusWindow(): void {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.focus();
    return;
  }
  statusWindow = createStatusWindow();
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
  if (popupWindow && !popupWindow.isDestroyed()) {
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

  ipcMain.handle('get-create-location', () => settings.getCreateLocation());

  ipcMain.handle('set-create-location', (_event, location: string) => {
    settings.setCreateLocation(location);
  });

  ipcMain.handle('create-project', async (_event, name: string, location: string) => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const pathModule = await import('path');

    // Expand ~ to home directory
    const expandedLocation = location.startsWith('~')
      ? pathModule.join(os.homedir(), location.slice(1))
      : location;

    const projectPath = pathModule.join(expandedLocation, name);

    try {
      // Create the directory
      await fs.mkdir(projectPath, { recursive: true });

      // Add to projects and open session
      const project = await store.addProject(projectPath);

      // Hide popup
      if (popupWindow) {
        popupWindow.hide();
      }

      await openSessionForProject(project.path, false);
      return true;
    } catch (err) {
      console.error('[create-project] Failed to create project:', err);
      dialog.showErrorBox('Failed to create project', `Could not create folder: ${projectPath}`);
      return false;
    }
  });

  ipcMain.handle('get-active-sessions', () => activeSessions);

  ipcMain.handle('open-session', async (_event, projectPath: string, forceNew?: boolean) => {
    // Hide popup window immediately when opening a session
    if (popupWindow) {
      popupWindow.hide();
    }

    await openSessionForProject(projectPath, forceNew ?? false);
  });

  ipcMain.handle('get-claude-stats', () => getClaudeStats());

  ipcMain.handle('get-service-status', async (): Promise<ServiceStatus> => {
    try {
      const response = await fetch('https://status.anthropic.com/api/v2/status.json');
      const data = await response.json();
      const indicator = data.status?.indicator || 'unknown';
      const description = data.status?.description || '';

      let status: ServiceStatus['status'] = 'unknown';
      if (indicator === 'none') status = 'operational';
      else if (indicator === 'minor' || indicator === 'major') status = 'degraded';
      else if (indicator === 'critical') status = 'outage';

      return { status, message: description };
    } catch (err) {
      console.error('[service-status] Failed to fetch:', err);
      return { status: 'unknown', message: 'Could not fetch status' };
    }
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
  // Cmd+` to cycle through terminal windows (forward) - global shortcut
  const registeredBacktick = globalShortcut.register('CommandOrControl+`', () => {
    terminalWindow.cycleTerminalWindows('next');
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

async function restorePreviousSession(): Promise<void> {
  const previousPaths = store.getPreviousSession();
  if (previousPaths.length === 0) {
    dialog.showMessageBox({
      type: 'info',
      title: 'No Previous Session',
      message: 'There is no previous session to restore.',
    });
    return;
  }

  console.log('[restore-session] Restoring', previousPaths.length, 'sessions');
  for (const projectPath of previousPaths) {
    await openSessionForProject(projectPath, false);
  }

  // Clear after restoring so we don't restore the same session twice
  store.clearPreviousSession();
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

  console.log('[open-session] creating new session with claude at:', claudePath, 'forceNew:', forceNew);
  const { id: sessionId } = pty.spawnClaude(projectPath, claudePath, { continueSession: !forceNew });
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
          const notification = new Notification({
            title: 'Cockpit',
            body: `${projectName} needs attention`,
            icon: iconPath,
          });
          notification.on('click', () => {
            terminalWindow.focusTerminalWindow(sessionId);
          });
          notification.show();
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
        { type: 'separator' },
        {
          label: 'Restore Previous Session',
          accelerator: 'CommandOrControl+Shift+T',
          click: () => restorePreviousSession(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
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
        { type: 'separator' },
        {
          label: 'Next Terminal',
          accelerator: 'CommandOrControl+Right',
          click: () => terminalWindow.cycleTerminalWindows('next'),
        },
        {
          label: 'Previous Terminal',
          accelerator: 'CommandOrControl+Left',
          click: () => terminalWindow.cycleTerminalWindows('prev'),
        },
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
    // Save active sessions for potential restore
    const sessionPaths = Object.keys(activeSessions);
    store.savePreviousSession(sessionPaths);
    console.log('[quit] Saved', sessionPaths.length, 'sessions for restore');

    isQuitting = true;
    app.quit();
  }
});
