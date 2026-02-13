import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog, globalShortcut, screen, Notification, Menu, shell, clipboard } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import * as store from './store';
import { findClaudeBinary } from './claude';
import * as pty from './pty';
import * as terminalWindow from './terminal-window';
import { requestPermission } from './permissions';
import * as settings from './settings';
import { getClaudeStats } from './claude-stats';
import * as sessions from './sessions';
import type { AppSettings } from '../shared/types';
import type { Project, ActiveSession, ServiceStatus, ContextMenuOptions } from '../shared/types';

let tray: Tray | null = null;
let popupWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let statusWindow: BrowserWindow | null = null;

// Use omega (Ω) in dev mode, lambda (λ) in production
const TRAY_SYMBOL = process.env.NODE_ENV === 'development' ? 'Ω' : 'λ';

// Track active sessions in memory
const activeSessions: Record<string, ActiveSession> = {};

// Map windowId to sessionId for reliable PTY input routing
// (activeSessions is keyed by projectPath, which doesn't support multiple sessions per project)
const windowToSession = new Map<number, string>();

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
    win.loadURL('http://localhost:5173?dev=1');
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
  popupWindow.webContents.send('focus-search');
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
    title: process.env.NODE_ENV === 'development' ? 'Cockpit Settings (Dev)' : 'Cockpit Settings',
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
    win.loadURL('http://localhost:5173/settings.html?dev=1');
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
    title: process.env.NODE_ENV === 'development' ? 'Claude Status (Dev)' : 'Claude Status',
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
    win.loadURL('http://localhost:5173/status.html?dev=1');
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

  ipcMain.handle('update-project', (_event, projectPath: string, updates: Partial<Project>) => {
    const updatedProject = store.updateProject(projectPath, updates);

    // Update terminal window title if this project has an active session
    const session = activeSessions[projectPath];
    if (session) {
      const projectName = updatedProject.name || projectPath.split('/').pop() || 'Terminal';
      terminalWindow.updateTerminalWindowTitle(session.sessionId, projectName, {
        hasBeads: updatedProject.hasBeads,
        hasGit: updatedProject.hasGit,
        hasGithub: updatedProject.hasGithub,
      });
    }

    return updatedProject;
  });

  ipcMain.handle('remove-project', async (_event, projectPath: string) => {
    // Expand ~ to home directory for display and deletion
    const expandedPath = projectPath.startsWith('~')
      ? path.join(app.getPath('home'), projectPath.slice(1))
      : projectPath;

    // Check if folder exists
    const folderExists = fs.existsSync(expandedPath);

    if (folderExists) {
      // Ask user if they want to delete the folder too
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Remove from Cockpit', 'Delete Folder', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Remove Project',
        message: 'How would you like to remove this project?',
        detail: `Project: ${projectPath}`,
      });

      if (response === 2) {
        // User cancelled
        return;
      }

      if (response === 1) {
        // User wants to delete the folder - show confirmation
        const { response: confirmResponse } = await dialog.showMessageBox({
          type: 'warning',
          buttons: ['Cancel', 'Delete Permanently'],
          defaultId: 0,
          cancelId: 0,
          title: 'Delete Folder?',
          message: 'This action cannot be undone.',
          detail: `This will permanently delete:\n${expandedPath}\n\nand all its contents.`,
        });

        if (confirmResponse === 1) {
          try {
            fs.rmSync(expandedPath, { recursive: true, force: true });
          } catch (err) {
            dialog.showErrorBox('Failed to delete folder', `${err}`);
          }
        }
      }
    }

    // Always remove from store (unless cancelled above)
    store.removeProject(projectPath);
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('select-app', async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: '/Applications',
      properties: ['openFile'],
      filters: [{ name: 'Applications', extensions: ['app'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    // Extract app name from path (e.g., "/Applications/Alacritty.app" -> "Alacritty")
    const appPath = result.filePaths[0];
    const appName = path.basename(appPath, '.app');
    return appName;
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
      log.error('[create-project] Failed to create project:', err);
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
      log.error('[service-status] Failed to fetch:', err);
      return { status: 'unknown', message: 'Could not fetch status' };
    }
  });

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

  // Terminal IPC handlers
  ipcMain.on('pty-input', (event, data: string) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    const sessionId = windowToSession.get(senderWindow.id);
    if (sessionId) {
      pty.writeToSession(sessionId, data);
    }
  });

  ipcMain.on('pty-resize', (event, cols: number, rows: number) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    const sessionId = windowToSession.get(senderWindow.id);
    if (sessionId) {
      pty.resizeSession(sessionId, cols, rows);
    }
  });

  // Open file/folder path with OS default handler (alt+click in terminal)
  ipcMain.on('open-path', (_event, filePath: string) => {
    // Expand ~ to home directory
    const expandedPath = filePath.startsWith('~')
      ? path.join(app.getPath('home'), filePath.slice(1))
      : filePath;

    // Check if path exists before opening
    if (fs.existsSync(expandedPath)) {
      shell.openPath(expandedPath);
    } else {
      log.warn('[open-path] Path does not exist:', expandedPath);
    }
  });

  // Terminal context menu (right-click on links/selection)
  ipcMain.on('terminal-context-menu', (_event, options: ContextMenuOptions) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    // Link options
    if (options.link) {
      const { type, text } = options.link;
      menuItems.push({
        label: 'Open',
        click: () => {
          if (type === 'url') {
            shell.openExternal(text);
          } else {
            // File path - expand ~ and open
            const expandedPath = text.startsWith('~')
              ? path.join(app.getPath('home'), text.slice(1))
              : text;
            if (fs.existsSync(expandedPath)) {
              shell.openPath(expandedPath);
            }
          }
        },
      });
      menuItems.push({
        label: 'Copy Link',
        click: () => clipboard.writeText(text),
      });
    }

    // Selection options
    if (options.hasSelection && options.selectedText) {
      if (menuItems.length > 0) {
        menuItems.push({ type: 'separator' });
      }
      menuItems.push({
        label: 'Copy',
        click: () => clipboard.writeText(options.selectedText!),
      });
    }

    // Only show menu if there are items
    if (menuItems.length > 0) {
      const menu = Menu.buildFromTemplate(menuItems);
      menu.popup();
    }
  });
}

function registerGlobalShortcuts(): void {
  // Cmd+` to cycle through terminal windows (forward) - global shortcut
  const registeredBacktick = globalShortcut.register('CommandOrControl+`', () => {
    terminalWindow.cycleTerminalWindows('next');
  });

  if (!registeredBacktick) {
    log.warn('[shortcuts] Failed to register Cmd+` shortcut');
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

  log.info('[restore-session] Restoring', previousPaths.length, 'sessions');
  for (const projectPath of previousPaths) {
    await openSessionForProject(projectPath, false);
  }

  // Clear after restoring so we don't restore the same session twice
  store.clearPreviousSession();
}

async function openSessionForProject(projectPath: string, forceNew: boolean): Promise<void> {
  const existing = activeSessions[projectPath];
  log.info('[open-session] projectPath:', projectPath, 'existing:', existing, 'forceNew:', forceNew);

  if (existing && !forceNew) {
    const exists = pty.sessionExists(existing.sessionId);
    log.info('[open-session] sessionExists:', exists);
    if (exists) {
      const focused = terminalWindow.focusTerminalWindow(existing.sessionId);
      log.info('[open-session] focusTerminalWindow result:', focused);
      return;
    }
    log.info('[open-session] session gone, removing');
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

  log.info('[open-session] creating new session with claude at:', claudePath, 'forceNew:', forceNew);
  const { id: sessionId } = pty.spawnClaude(projectPath, claudePath, { continueSession: !forceNew });
  log.info('[open-session] new sessionId:', sessionId);

  const win = terminalWindow.createTerminalWindow({
    sessionId,
    projectName,
    projectPath,
    hasBeads: project?.hasBeads,
    hasGit: project?.hasGit,
    hasGithub: project?.hasGithub,
    onClose: () => {
      log.info('[terminal-window] closed, cleaning up session:', sessionId);
      pty.killSession(sessionId);
      // Only delete if this is the session for this project
      if (activeSessions[projectPath]?.sessionId === sessionId) {
        delete activeSessions[projectPath];
      }
      windowToSession.delete(win.id);
      delete lastBellTime[sessionId];
      notifySessionsChanged();
    },
  });

  // For multiple sessions per project, we need a different key
  // But for now, keep the simple model - just track the latest
  activeSessions[projectPath] = { sessionId, windowId: win.id };
  windowToSession.set(win.id, sessionId);
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

  pty.onSessionExit(sessionId, (exitInfo) => {
    log.info('[pty-exit] session exited:', sessionId);
    const sessionDuration = Date.now() - exitInfo.startTime;

    // If session failed quickly with exit code 1 and we used --continue, retry without it
    if (exitInfo.exitCode === 1 && sessionDuration < 3000 && !forceNew) {
      log.info('[pty-exit] quick failure with --continue, retrying without it');
      terminalWindow.closeTerminalWindow(sessionId);
      // Clean up and retry
      if (activeSessions[projectPath]?.sessionId === sessionId) {
        delete activeSessions[projectPath];
      }
      notifySessionsChanged();
      openSessionForProject(projectPath, true); // force new session
      return;
    }

    // Generate summary for the session that just closed
    const claudeSessionId = sessions.getMostRecentSessionId(projectPath, exitInfo.startTime);
    if (claudeSessionId) {
      sessions.generateSessionSummary(projectPath, claudeSessionId);
    }

    terminalWindow.closeTerminalWindow(sessionId);
  });
}

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
    // Generate summary for the resumed Claude session
    sessions.generateSessionSummary(projectPath, sessionId);
    terminalWindow.closeTerminalWindow(newSessionId);
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
        { type: 'separator' },
        {
          label: 'Open in External Terminal',
          accelerator: 'CommandOrControl+T',
          click: () => {
            const focusedWindowId = terminalWindow.getFocusedTerminalWindowId();
            if (!focusedWindowId) return;
            // Find the sessionId for the focused window
            for (const session of Object.values(activeSessions)) {
              if (session.windowId === focusedWindowId) {
                terminalWindow.openExternalTerminal(session.sessionId);
                break;
              }
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Enforce single instance - show popup if already running
// Skip in development to allow dev and prod to run side-by-side
const isDev = process.env.NODE_ENV === 'development';
const gotTheLock = isDev || app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to open a second instance, show our popup
    showPopupWindow();
  });
}

// Watch for app bundle updates (production only)
function watchForUpgrade(): void {
  if (process.env.NODE_ENV === 'development') return;

  const appPath = '/Applications/Cockpit.app';
  const plistPath = path.join(appPath, 'Contents/Info.plist');
  let debounceTimer: NodeJS.Timeout | null = null;

  try {
    fs.watch(appPath, { recursive: false }, (eventType) => {
      if (eventType !== 'rename') return;

      // Debounce: wait for upgrade to complete
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          // Check if the plist exists (app bundle is complete)
          if (!fs.existsSync(plistPath)) return;

          // Save active sessions for auto-restore after upgrade
          const sessionPaths = Object.keys(activeSessions);
          if (sessionPaths.length > 0) {
            store.savePreviousSession(sessionPaths);
            store.setUpgradeRestart(true);
            log.info('[upgrade] Saved', sessionPaths.length, 'sessions for restore');
          }

          log.info('[upgrade] App bundle changed, restarting...');
          app.relaunch();
          app.exit(0);
        } catch (err) {
          log.error('[upgrade] Error checking for upgrade:', err);
        }
      }, 2000); // Wait 2s for upgrade to complete
    });

    log.info('[upgrade] Watching for app updates at:', appPath);
  } catch (err) {
    log.warn('[upgrade] Could not watch for upgrades:', err);
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
  createAppMenu();
  registerIpcHandlers();
  registerGlobalShortcuts();

  // Initialize settings and register global shortcut for popup
  settings.initializeSettings(() => showPopupWindow());

  // Watch for Homebrew upgrades
  watchForUpgrade();

  // Auto-restore sessions after upgrade restart
  if (store.getUpgradeRestart()) {
    store.setUpgradeRestart(false);
    const previousPaths = store.getPreviousSession();
    if (previousPaths.length > 0) {
      log.info('[upgrade] Auto-restoring', previousPaths.length, 'sessions after upgrade');
      (async () => {
        for (const projectPath of previousPaths) {
          await openSessionForProject(projectPath, false);
        }
        store.clearPreviousSession();
      })();
    }
  }
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
    log.info('[quit] Saved', sessionPaths.length, 'sessions for restore');

    isQuitting = true;
    app.quit();
  }
});
