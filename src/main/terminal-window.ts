import { BrowserWindow, dialog, shell } from 'electron';
import log from 'electron-log';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import { execFile } from 'child_process';
import * as settings from './settings';
import { countLiveWindows } from './window-count';
import { classifyNavigation } from './navigation-guard';
import { terminalAppScript, iTermScript } from './external-terminal-script';
import type { PermissionMode } from '../shared/types';

const terminalWindows = new Map<string, BrowserWindow>();
const terminalProjectPaths = new Map<string, string>();
let lastFocusedTerminalId: number | null = null;

export interface TerminalWindowOptions {
  sessionId: string;
  projectName: string;
  projectPath: string;
  hasGit?: boolean;
  githubUrl?: string;
  permissionMode?: PermissionMode;
  onClose?: () => void;
}

export function createTerminalWindow(options: TerminalWindowOptions): BrowserWindow {
  const { sessionId, projectName, projectPath, hasGit, githubUrl, permissionMode, onClose } = options;

  // Store project path for external terminal shortcut
  terminalProjectPaths.set(sessionId, projectPath);
  // Show GitHub indicator if github remote exists, otherwise show git indicator
  const gitIndicator = githubUrl ? '🐙' : hasGit ? '⎇' : '';
  const indicators = gitIndicator;
  const devSuffix = process.env.NODE_ENV === 'development' ? ' (Dev)' : '';
  const title = (indicators ? `${indicators} ${projectName}` : projectName) + devSuffix;

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    title,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The only page this window may show (#69); query strings are ignored.
  const terminalPagePath = path.join(__dirname, '../../renderer/terminal.html');
  const ownPage = process.env.NODE_ENV === 'development'
    ? 'http://localhost:5173/terminal.html'
    : pathToFileURL(terminalPagePath).href;

  // Pass sessionId and title to renderer via query param
  if (process.env.NODE_ENV === 'development') {
    const params = new URLSearchParams({
      sessionId,
      title,
      ...(githubUrl ? { githubUrl } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      dev: '1',
    });
    win.loadURL(`${ownPage}?${params.toString()}`);
  } else {
    win.loadFile(terminalPagePath, {
      query: {
        sessionId,
        title,
        ...(githubUrl ? { githubUrl } : {}),
        ...(permissionMode ? { permissionMode } : {}),
      },
    });
  }

  // Never open a second Electron window: web links go to the system browser,
  // anything else is dropped (#69).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, ownPage) === 'open-external') {
      shell.openExternal(url);
    } else {
      log.warn(`[terminal] Dropped window.open to ${url.slice(0, 200)}`);
    }
    return { action: 'deny' };
  });

  // A terminal window only ever shows its own page (#69). Web links open in
  // the system browser; other file:// pages, other localhost pages and odd
  // schemes are dropped.
  win.webContents.on('will-navigate', (event, url) => {
    const decision = classifyNavigation(url, ownPage);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'open-external') {
      shell.openExternal(url);
    } else {
      log.warn(`[terminal] Blocked navigation to ${url.slice(0, 200)}`);
    }
  });

  // Set title after page loads (HTML title would otherwise override)
  win.webContents.on('did-finish-load', () => {
    win.setTitle(title);
    // Open DevTools in dev mode for debugging
    if (process.env.NODE_ENV === 'development') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Intercept Cmd+Left/Right before xterm.js captures them
  win.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.type === 'keyDown') {
      if (input.key === 'ArrowRight') {
        event.preventDefault();
        cycleTerminalWindows('next');
      } else if (input.key === 'ArrowLeft') {
        event.preventDefault();
        cycleTerminalWindows('prev');
      } else if (input.key.toLowerCase() === 't') {
        // Cmd+T: Open external terminal in project directory
        event.preventDefault();
        openExternalTerminal(sessionId);
      }
    }
  });

  win.on('focus', () => {
    lastFocusedTerminalId = win.id;
  });

  win.on('closed', () => {
    if (lastFocusedTerminalId === win.id) {
      // Fall back to another open terminal window instead of null
      const remaining = Array.from(terminalWindows.values()).filter(
        w => w.id !== win.id && !w.isDestroyed()
      );
      lastFocusedTerminalId = remaining.length > 0 ? remaining[0].id : null;
    }
    terminalWindows.delete(sessionId);
    terminalProjectPaths.delete(sessionId);
    onClose?.();
  });

  terminalWindows.set(sessionId, win);
  return win;
}

export function getTerminalWindow(sessionId: string): BrowserWindow | undefined {
  return terminalWindows.get(sessionId);
}

// Number of terminal windows currently open. Authoritative source for dock
// visibility — unlike activeSessions (keyed by projectPath), this counts every
// open window, including multiple windows for the same project.
export function getTerminalWindowCount(): number {
  return countLiveWindows(terminalWindows.values());
}

export function focusTerminalWindow(sessionId: string): boolean {
  const win = terminalWindows.get(sessionId);
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return true;
  }
  return false;
}

export function closeTerminalWindow(sessionId: string): void {
  const win = terminalWindows.get(sessionId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
}

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

export function cycleTerminalWindows(direction: 'next' | 'prev' = 'next'): void {
  const windows = Array.from(terminalWindows.values()).filter(w => !w.isDestroyed());
  if (windows.length === 0) return;

  // Use tracked last focused window instead of isFocused() which is unreliable in shortcut handlers
  const lastFocused = lastFocusedTerminalId
    ? windows.find(w => w.id === lastFocusedTerminalId)
    : null;

  if (!lastFocused) {
    // No terminal was focused, focus the first one
    windows[0].show();
    windows[0].focus();
    return;
  }

  const currentIndex = windows.indexOf(lastFocused);
  const offset = direction === 'next' ? 1 : windows.length - 1;
  const nextIndex = (currentIndex + offset) % windows.length;
  windows[nextIndex].show();
  windows[nextIndex].focus();
}

export function getFocusedTerminalWindowId(): number | null {
  // Check if tracked window still exists
  if (lastFocusedTerminalId) {
    for (const win of terminalWindows.values()) {
      if (win.id === lastFocusedTerminalId && !win.isDestroyed()) {
        return lastFocusedTerminalId;
      }
    }
  }
  // Fallback: return any available terminal window
  const windows = Array.from(terminalWindows.values()).filter(w => !w.isDestroyed());
  if (windows.length > 0) {
    lastFocusedTerminalId = windows[0].id;
    return windows[0].id;
  }
  return null;
}

export function focusLastTerminalWindow(): boolean {
  // Focus the last focused terminal window if it still exists
  if (lastFocusedTerminalId) {
    for (const win of terminalWindows.values()) {
      if (win.id === lastFocusedTerminalId && !win.isDestroyed()) {
        win.show();
        win.focus();
        return true;
      }
    }
  }
  // Fallback: focus any available terminal window
  const windows = Array.from(terminalWindows.values()).filter(w => !w.isDestroyed());
  if (windows.length > 0) {
    windows[0].show();
    windows[0].focus();
    return true;
  }
  return false;
}

export function openExternalTerminal(sessionId: string): void {
  const projectPath = terminalProjectPaths.get(sessionId);
  if (!projectPath) return;

  // Expand ~ to home directory
  const fullPath = projectPath.startsWith('~')
    ? path.join(os.homedir(), projectPath.slice(1))
    : projectPath.startsWith('/')
      ? projectPath
      : path.join(os.homedir(), projectPath);

  const appSettings = settings.getSettings();
  const terminal = appSettings.externalTerminal || 'terminal';

  const handleError = (appName: string) => {
    dialog.showMessageBox({
      type: 'error',
      title: 'Could not open terminal',
      message: `Could not open ${appName}. Is it installed?`,
      detail: 'You can change your external terminal in Settings.',
      buttons: ['OK'],
    });
  };

  if (terminal === 'terminal') {
    // Terminal.app via AppleScript; the path is quoted for the shell and AppleScript (#52)
    execFile('osascript', ['-e', terminalAppScript(fullPath)], (err) => {
      if (err) handleError('Terminal.app');
    });
  } else if (terminal === 'iterm') {
    // iTerm2 via AppleScript; the path is quoted for the shell and AppleScript (#52)
    execFile('osascript', ['-e', iTermScript(fullPath)], (err) => {
      if (err) handleError('iTerm');
    });
  } else if (terminal === 'warp') {
    // Warp opens to directory natively
    execFile('open', ['-a', 'Warp', fullPath], (err) => {
      if (err) handleError('Warp');
    });
  } else if (terminal === 'kitty') {
    // Kitty supports directory argument
    execFile('open', ['-a', 'kitty', fullPath], (err) => {
      if (err) handleError('Kitty');
    });
  } else if (terminal.startsWith('custom:')) {
    // Custom app - use generic open command
    const appName = terminal.slice(7); // Remove "custom:" prefix
    execFile('open', ['-a', appName, fullPath], (err) => {
      if (err) handleError(appName);
    });
  }
}
