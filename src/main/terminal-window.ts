import { BrowserWindow, dialog, shell } from 'electron';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import * as settings from './settings';

const terminalWindows = new Map<string, BrowserWindow>();
const terminalProjectPaths = new Map<string, string>();
let lastFocusedTerminalId: number | null = null;

export interface TerminalWindowOptions {
  sessionId: string;
  projectName: string;
  projectPath: string;
  hasGit?: boolean;
  githubUrl?: string;
  onClose?: () => void;
}

export function createTerminalWindow(options: TerminalWindowOptions): BrowserWindow {
  const { sessionId, projectName, projectPath, hasGit, githubUrl, onClose } = options;

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

  // Pass sessionId and title to renderer via query param
  if (process.env.NODE_ENV === 'development') {
    win.loadURL(`http://localhost:5173/terminal.html?sessionId=${sessionId}&title=${encodeURIComponent(title)}&dev=1${githubUrl ? '&githubUrl=' + encodeURIComponent(githubUrl) : ''}`);
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/terminal.html'), {
      query: { sessionId, title, ...(githubUrl ? { githubUrl } : {}) },
    });
  }

  // Open links in system browser instead of Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Intercept in-page navigation to external URLs
  win.webContents.on('will-navigate', (event, url) => {
    // Allow loading the app itself
    if (url.startsWith('http://localhost:') || url.startsWith('file://')) return;
    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
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
      lastFocusedTerminalId = null;
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

  // Escape path for shell usage
  const escapedPath = fullPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

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
    // Terminal.app via AppleScript
    const script = `
      tell application "Terminal"
        activate
        do script "cd \\"${escapedPath}\\""
      end tell
    `;
    execFile('osascript', ['-e', script], (err) => {
      if (err) handleError('Terminal.app');
    });
  } else if (terminal === 'iterm') {
    // iTerm2 via AppleScript
    const script = `
      tell application "iTerm"
        activate
        set newWindow to (create window with default profile)
        tell current session of newWindow
          write text "cd \\"${escapedPath}\\""
        end tell
      end tell
    `;
    execFile('osascript', ['-e', script], (err) => {
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
