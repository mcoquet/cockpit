// Decides what a window may do with a navigation (#69). A terminal window may
// only ever show its own page: the packaged terminal.html (production) or the
// Vite dev server's terminal.html (development). Kept free of Electron so it
// can be unit-tested.

import { fileURLToPath } from 'url';

export type NavigationDecision = 'allow' | 'open-external' | 'block';

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Path of a file: URL, or null if it isn't a plain local file path (a host,
// an encoded slash, or anything else fileURLToPath refuses).
function localFilePath(url: URL): string | null {
  if (url.hostname !== '') return null;
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

// True when `url` is `ownPage`, ignoring its query string and hash. The WHATWG
// URL parser has already resolved `.` and `..` segments (including %2e forms),
// so `renderer/../evil.html` no longer looks like the renderer folder.
export function isOwnPage(url: string, ownPage: string): boolean {
  const target = parse(url);
  const own = parse(ownPage);
  if (!target || !own) return false;
  if (target.protocol !== own.protocol) return false;
  if (target.username !== '' || target.password !== '') return false;

  if (own.protocol === 'file:') {
    const targetPath = localFilePath(target);
    const ownPath = localFilePath(own);
    return targetPath !== null && ownPath !== null && targetPath === ownPath;
  }

  return target.host === own.host && target.pathname === own.pathname;
}

// Loopback hosts: localhost (and *.localhost, trailing dot), 127.0.0.0/8, ::1.
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost')
    || /^127(\.\d{1,3}){3}$/.test(h) || h === '[::1]';
}

// What to do with a navigation away from (or within) a window whose page is
// `ownPage`: let it load, hand it to the system browser, or drop it.
export function classifyNavigation(url: string, ownPage: string): NavigationDecision {
  if (isOwnPage(url, ownPage)) return 'allow';
  const target = parse(url);
  // Other localhost pages (another port or path) are dropped rather than
  // opened externally: nothing in a terminal window navigates there on purpose.
  if (target && (target.protocol === 'http:' || target.protocol === 'https:')
      && target.hostname !== '' && !isLoopbackHost(target.hostname)) {
    return 'open-external';
  }
  return 'block';
}
