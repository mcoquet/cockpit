// Every Cockpit window only ever shows its own page (#69, #76). This module
// gives each window its page URL and wires classifyNavigation into the
// window's will-navigate and setWindowOpenHandler. Electron is passed in
// (webContents, shell.openExternal, log.warn) so it can be unit-tested.

import path from 'path';
import { pathToFileURL } from 'url';
import { classifyNavigation } from './navigation-guard';

const DEV_SERVER = 'http://localhost:5173/';

/**
 * The URL of a renderer page: the Vite dev server in development (the popup's
 * index.html is served at the root), the packaged HTML file otherwise.
 */
export function rendererPageUrl(page: string, opts: { dev: boolean; rendererDir: string }): string {
  if (opts.dev) return page === 'index.html' ? DEV_SERVER : DEV_SERVER + page;
  return pathToFileURL(path.join(opts.rendererDir, page)).href;
}

// The parts of Electron's WebContents the guard uses.
export interface GuardableContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown;
}

export interface GuardDeps {
  openExternal(url: string): void;
  warn(message: string): void;
}

/**
 * Keeps a window on `ownPage`. Web links (will-navigate or window.open) open
 * in the system browser; other pages, files, loopback hosts and odd schemes
 * are dropped and logged. window.open never creates an Electron window.
 */
export function guardWindowNavigation(
  contents: GuardableContents,
  ownPage: string,
  label: string,
  deps: GuardDeps,
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, ownPage) === 'open-external') {
      deps.openExternal(url);
    } else {
      deps.warn(`[${label}] Dropped window.open to ${url.slice(0, 200)}`);
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const decision = classifyNavigation(url, ownPage);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'open-external') {
      deps.openExternal(url);
    } else {
      deps.warn(`[${label}] Blocked navigation to ${url.slice(0, 200)}`);
    }
  });
}
