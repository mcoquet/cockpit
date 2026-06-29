// Pure, Electron-free helpers for deciding dock visibility from open windows.
// Extracted from terminal-window.ts / index.ts so the dock logic can be
// unit-tested without booting Electron (see test/window-count.test.js).

export interface WindowLike {
  isDestroyed(): boolean;
}

/**
 * Count terminal windows that are still alive (not destroyed).
 *
 * This is the authoritative basis for dock visibility: it counts every open
 * window, unlike activeSessions (keyed by projectPath), which collapses
 * multiple windows of the same project into a single entry — the root cause of
 * the dock hiding while another window for that project was still open (#4).
 */
export function countLiveWindows(windows: Iterable<WindowLike>): number {
  let count = 0;
  for (const win of windows) {
    if (!win.isDestroyed()) count++;
  }
  return count;
}

/** The dock should stay visible whenever at least one terminal window is open. */
export function shouldShowDock(openWindowCount: number): boolean {
  return openWindowCount > 0;
}
