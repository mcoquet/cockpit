import { BrowserWindow } from 'electron';
import path from 'path';

const terminalWindows = new Map<string, BrowserWindow>();

export interface TerminalWindowOptions {
  sessionId: string;
  projectName: string;
  hasBeads?: boolean;
  hasGit?: boolean;
  hasGithub?: boolean;
  onClose?: () => void;
}

export function createTerminalWindow(options: TerminalWindowOptions): BrowserWindow {
  const { sessionId, projectName, hasBeads, hasGit, hasGithub, onClose } = options;
  // Show GitHub indicator if github remote exists, otherwise show git indicator
  const gitIndicator = hasGithub ? '🐙' : hasGit ? '⎇' : '';
  const indicators = [gitIndicator, hasBeads ? '◆' : ''].filter(Boolean).join('');
  const title = indicators ? `${indicators} ${projectName}` : projectName;

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
    win.loadURL(`http://localhost:5173/terminal.html?sessionId=${sessionId}&title=${encodeURIComponent(title)}`);
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/terminal.html'), {
      query: { sessionId, title },
    });
  }

  // Set title after page loads (HTML title would otherwise override)
  win.webContents.on('did-finish-load', () => {
    win.setTitle(title);
    // Open DevTools in dev mode for debugging
    if (process.env.NODE_ENV === 'development') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  win.on('closed', () => {
    terminalWindows.delete(sessionId);
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

export function cycleTerminalWindows(): void {
  const windows = Array.from(terminalWindows.values()).filter(w => !w.isDestroyed());
  if (windows.length === 0) return;

  const focused = windows.find(w => w.isFocused());
  if (!focused) {
    // No terminal focused, focus the first one
    windows[0].show();
    windows[0].focus();
    return;
  }

  const currentIndex = windows.indexOf(focused);
  const nextIndex = (currentIndex + 1) % windows.length;
  windows[nextIndex].show();
  windows[nextIndex].focus();
}

export function getFocusedTerminalWindowId(): number | null {
  for (const win of terminalWindows.values()) {
    if (!win.isDestroyed() && win.isFocused()) {
      return win.id;
    }
  }
  return null;
}
