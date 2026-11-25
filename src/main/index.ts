import { app, Tray, BrowserWindow, nativeImage, ipcMain, dialog, globalShortcut, screen, Notification, Menu, shell, clipboard } from 'electron';
import log from 'electron-log';
import fs from 'fs';
import path from 'path';
import * as store from './store';
import { findClaudeBinary } from './claude';
import * as pty from './pty';
import * as terminalWindow from './terminal-window';
import { shouldShowDock } from './window-count';
import { requestPermission } from './permissions';
import { resolvePermissionMode } from './permission-mode';
import { SessionRegistry } from './session-registry';
import * as settings from './settings';
import { getClaudeStats } from './claude-stats';
import * as sessions from './sessions';
import * as scheduler from './scheduler';
import * as schedulerExecutor from './scheduler-executor';
import { getEnvVarsForProject } from './session-env';
import { expandProjectPath, isDeletableProjectFolder } from './project-path';
import type { AppSettings } from '../shared/types';
import type { Project, ServiceStatus, ContextMenuOptions, Schedule, PermissionMode } from '../shared/types';

let tray: Tray | null = null;
let popupWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let statusWindow: BrowserWindow | null = null;

// Use omega (Ω) in dev mode, lambda (λ) in production
const TRAY_SYMBOL = process.env.NODE_ENV === 'development' ? 'Ω' : 'λ';

// Every running terminal session, keyed by terminal session id (#58). Window
// lookups (PTY input routing, Cmd+T, Cmd+N) and per-project views (popup,
// restore set) are all derived from it.
const terminalSessions = new SessionRegistry();

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
  const hasActive = terminalSessions.count() > 0;
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
    height: 600,
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

  // Count actual open terminal windows (#4): a window can still be open for a
  // moment after its terminal session has left the registry.
  if (shouldShowDock(terminalWindow.getTerminalWindowCount())) {
    app.dock.show();
  } else {
    app.dock.hide();
  }
}

function notifySessionsChanged(): void {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('sessions-changed', terminalSessions.projectView());
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

    // Update the title of every terminal window open for this project
    const projectName = updatedProject.name || projectPath.split('/').pop() || 'Terminal';
    for (const session of terminalSessions.forProject(projectPath)) {
      terminalWindow.updateTerminalWindowTitle(session.sessionId, projectName, {
        hasGit: updatedProject.hasGit,
        githubUrl: updatedProject.githubUrl,
      });
    }

    return updatedProject;
  });

  ipcMain.handle('remove-project', async (_event, projectPath: string) => {
    const expandedPath = expandProjectPath(projectPath, app.getPath('home'));

    // Offer to delete the folder only if it exists and is not home or above it
    const canDeleteFolder =
      fs.existsSync(expandedPath) && isDeletableProjectFolder(expandedPath, app.getPath('home'));

    if (canDeleteFolder) {
      // Ask user if they want to delete the folder too
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Remove from Cockpit', 'Delete Folder', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Remove Project',
        message: 'How would you like to remove this project?',
        detail: `Project: ${expandedPath}`,
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

  ipcMain.handle('get-active-sessions', () => terminalSessions.projectView());

  ipcMain.handle('open-session', async (_event, projectPath: string, forceNew?: boolean, permissionMode?: PermissionMode, altKey?: boolean) => {
    if (popupWindow) {
      popupWindow.hide();
    }

    if (altKey) {
      // Show native context menu for permission mode selection
      const project = store.getProjects().find(p => p.path === projectPath);
      const currentMode = resolvePermissionMode(permissionMode, project?.permissionMode);

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

    await openSessionForProject(projectPath, forceNew ?? false, permissionMode);
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

    const sessionId = terminalSessions.findByWindow(senderWindow.id)?.sessionId;
    if (sessionId) {
      pty.writeToSession(sessionId, data);
    }
  });

  ipcMain.on('pty-resize', (event, cols: number, rows: number) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    const sessionId = terminalSessions.findByWindow(senderWindow.id)?.sessionId;
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

  ipcMain.on('open-external-url', (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) {
      shell.openExternal(url);
    }
  });

  // Permission mode change from terminal badge
  ipcMain.on('change-permission-mode', (event, mode: PermissionMode) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) return;

    const sessionId = terminalSessions.findByWindow(senderWindow.id)?.sessionId;
    if (!sessionId) return;

    // Inject /permissions command into PTY
    pty.writeToSession(sessionId, `/permissions ${mode}\n`);

    if (terminalSessions.setPermissionMode(sessionId, mode)) {
      notifySessionsChanged();
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

  // Scheduler IPC handlers
  ipcMain.handle('scheduler:list', (_event, projectPath?: string) =>
    scheduler.listSchedules(projectPath)
  );

  ipcMain.handle('scheduler:get', (_event, id: string) =>
    scheduler.getSchedule(id)
  );

  ipcMain.handle('scheduler:create', (_event, data: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>) =>
    scheduler.createSchedule(data)
  );

  ipcMain.handle('scheduler:update', (_event, id: string, updates: Partial<Schedule>) =>
    scheduler.updateSchedule(id, updates)
  );

  ipcMain.handle('scheduler:delete', (_event, id: string) =>
    scheduler.deleteSchedule(id)
  );

  ipcMain.handle('scheduler:pause', (_event, id: string) => {
    scheduler.pauseSchedule(id);
  });

  ipcMain.handle('scheduler:resume', (_event, id: string) => {
    scheduler.resumeSchedule(id);
  });

  ipcMain.handle('scheduler:trigger', (_event, id: string) =>
    scheduler.triggerNow(id)
  );

  ipcMain.handle('scheduler:history', (_event, id: string, limit?: number) =>
    scheduler.getRunHistory(id, limit)
  );

  ipcMain.handle('scheduler:queued', (_event, id: string) =>
    scheduler.getQueuedRuns(id)
  );

  ipcMain.handle('scheduler:interpret', (_event, input: string) =>
    schedulerExecutor.interpretSchedule(input)
  );

  ipcMain.handle('scheduler:delete-run', (_event, runId: string) =>
    store.deleteScheduleRun(runId)
  );

  ipcMain.handle('scheduler:clear-history', (_event, scheduleId: string) =>
    store.clearScheduleHistory(scheduleId)
  );
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

  // The project of the last-used terminal window, whichever it is (#58)
  const projectPath = terminalSessions.findByWindow(focusedWindowId)?.projectPath;

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

const openingProjects = new Set<string>();

// With no explicitMode, the terminal session starts in the project's default
// permission mode (#56). Every open path goes through here.
// Resolves to the new terminal session's id, or undefined if none was opened.
async function openSessionForProject(projectPath: string, forceNew: boolean, explicitMode?: PermissionMode): Promise<string | undefined> {
  const existing = terminalSessions.latestForProject(projectPath);
  log.info('[open-session] projectPath:', projectPath, 'existing:', existing, 'forceNew:', forceNew);

  if (existing && !forceNew) {
    const exists = pty.sessionExists(existing.sessionId);
    log.info('[open-session] sessionExists:', exists);
    if (exists) {
      const focused = terminalWindow.focusTerminalWindow(existing.sessionId);
      log.info('[open-session] focusTerminalWindow result:', focused);
      return undefined;
    }
    log.info('[open-session] session gone, removing');
    terminalSessions.remove(existing.sessionId);
  }

  const claudePath = findClaudeBinary();
  if (!claudePath) {
    dialog.showErrorBox(
      'Claude not found',
      'Could not find the claude CLI. Please ensure claude is installed and accessible.'
    );
    return undefined;
  }

  const projects = store.getProjects();
  const project = projects.find((p) => p.path === projectPath);
  const projectName = project?.name || projectPath.split('/').pop() || 'Terminal';
  const permissionMode = resolvePermissionMode(explicitMode, project?.permissionMode);

  // Spawning waits on the shell env capture; ignore repeat clicks meanwhile.
  if (!forceNew && openingProjects.has(projectPath)) {
    log.info('[open-session] already opening, ignoring:', projectPath);
    return undefined;
  }

  log.info('[open-session] creating new session with claude at:', claudePath, 'forceNew:', forceNew);
  if (!forceNew) openingProjects.add(projectPath);
  let sessionId: string;
  try {
    ({ id: sessionId } = await pty.spawnClaude(projectPath, claudePath, {
      continueSession: !forceNew,
      permissionMode,
      envVars: getEnvVarsForProject(projectPath),
    }));
  } finally {
    if (!forceNew) openingProjects.delete(projectPath);
  }
  log.info('[open-session] new sessionId:', sessionId);

  const win = terminalWindow.createTerminalWindow({
    sessionId,
    projectName,
    projectPath,
    hasGit: project?.hasGit,
    githubUrl: project?.githubUrl,
    permissionMode,
    onClose: () => {
      log.info('[terminal-window] closed, cleaning up session:', sessionId);
      pty.killSession(sessionId);
      terminalSessions.remove(sessionId);
      delete lastBellTime[sessionId];
      notifySessionsChanged();
    },
  });

  terminalSessions.add({ sessionId, windowId: win.id, projectPath, permissionMode });
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
      terminalSessions.remove(sessionId);
      notifySessionsChanged();
      openSessionForProject(projectPath, true, explicitMode); // force new session, same mode
      return;
    }

    // Generate summary for the session that just closed
    const claudeSessionId = sessions.getMostRecentSessionId(projectPath, exitInfo.startTime);
    if (claudeSessionId) {
      sessions.generateSessionSummary(projectPath, claudeSessionId);
    }

    terminalWindow.closeTerminalWindow(sessionId);
  });

  return sessionId;
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
  const permissionMode = resolvePermissionMode(undefined, project?.permissionMode);

  log.info('[open-session-by-id] resuming session:', sessionId, 'in project:', projectPath);
  const { id: newSessionId } = await pty.spawnClaude(projectPath, claudePath, {
    resumeSessionId: sessionId,
    permissionMode,
    envVars: getEnvVarsForProject(projectPath),
  });
  log.info('[open-session-by-id] spawned with internal sessionId:', newSessionId);

  const win = terminalWindow.createTerminalWindow({
    sessionId: newSessionId,
    projectName,
    projectPath,
    hasGit: project?.hasGit,
    githubUrl: project?.githubUrl,
    permissionMode,
    onClose: () => {
      log.info('[terminal-window] closed, cleaning up session:', newSessionId);
      pty.killSession(newSessionId);
      terminalSessions.remove(newSessionId);
      delete lastBellTime[newSessionId];
      notifySessionsChanged();
    },
  });

  terminalSessions.add({ sessionId: newSessionId, windowId: win.id, projectPath, permissionMode });
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
            // Any terminal window, not only a project's newest one (#58)
            const session = terminalSessions.findByWindow(terminalWindow.getFocusedTerminalWindowId());
            if (session) terminalWindow.openExternalTerminal(session.sessionId);
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

          // Save the restore set (each project once) for auto-restore after upgrade
          const sessionPaths = terminalSessions.restoreSetPaths();
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

  // Initialize scheduler
  schedulerExecutor.setOpenSessionFn(async (projectPath: string, prompt: string) => {
    const sessionId = await openSessionForProject(projectPath, true);
    // Wait a moment for the terminal session to be ready, then send the prompt
    // to the one just opened (not some other window of the project)
    setTimeout(() => {
      if (sessionId && pty.sessionExists(sessionId)) {
        pty.writeToSession(sessionId, prompt + '\n');
      }
    }, 2000);
  });

  schedulerExecutor.setOutputCallback((runId, chunk) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('schedule-run-output', { runId, chunk });
    });
  });

  scheduler.setExecutor(schedulerExecutor.executeSchedule);
  scheduler.initializeScheduler();

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
  scheduler.shutdownScheduler();
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});

app.on('activate', () => {
  // Don't steal focus from popup or settings windows
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) return;
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isFocused()) return;

  // Defer focus to allow Space transition to complete on macOS
  setImmediate(() => {
    terminalWindow.focusLastTerminalWindow();
  });
});

// Confirm quit if active sessions exist
let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting) return;

  // Counts terminal sessions, not projects (#58)
  const sessionCount = terminalSessions.count();
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
    // Save the restore set (each project once) for potential restore
    const sessionPaths = terminalSessions.restoreSetPaths();
    store.savePreviousSession(sessionPaths);
    log.info('[quit] Saved', sessionPaths.length, 'sessions for restore');

    isQuitting = true;
    app.quit();
  }
});
