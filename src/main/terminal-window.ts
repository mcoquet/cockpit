import { BrowserWindow } from 'electron';
import path from 'path';

const terminalWindows = new Map<string, BrowserWindow>();
let lastFocusedTerminalId: number | null = null;

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

  // Intercept Cmd+Left/Right before xterm.js captures them
  win.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.type === 'keyDown') {
      if (input.key === 'ArrowRight') {
        event.preventDefault();
        cycleTerminalWindows('next');
      } else if (input.key === 'ArrowLeft') {
        event.preventDefault();
        cycleTerminalWindows('prev');
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
