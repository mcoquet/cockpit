// Every running terminal session Cockpit has opened, keyed by terminal session
// id (#58). Per-project views (the popup's active indicator, the restore set)
// are derived from it, so a project with several terminal windows has all of
// them tracked. Electron-free; unit-tested in test/session-registry.test.js.

import type { ActiveSession, PermissionMode } from '../shared/types';

export interface TrackedSession {
  sessionId: string;
  windowId: number;
  projectPath: string;
  permissionMode: PermissionMode;
}

export class SessionRegistry {
  // Map keeps insertion order, which is the order terminal sessions opened.
  private readonly sessions = new Map<string, TrackedSession>();

  add(session: TrackedSession): void {
    this.sessions.delete(session.sessionId);
    this.sessions.set(session.sessionId, { ...session });
  }

  /** Returns true if the terminal session was tracked. */
  remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  get(sessionId: string): TrackedSession | undefined {
    return this.sessions.get(sessionId);
  }

  findByWindow(windowId: number | null | undefined): TrackedSession | undefined {
    if (windowId == null) return undefined;
    for (const s of this.sessions.values()) {
      if (s.windowId === windowId) return s;
    }
    return undefined;
  }

  /** A project's running terminal sessions, oldest first. */
  forProject(projectPath: string): TrackedSession[] {
    return [...this.sessions.values()].filter((s) => s.projectPath === projectPath);
  }

  /** The most recently opened terminal session of a project that is still running. */
  latestForProject(projectPath: string): TrackedSession | undefined {
    const list = this.forProject(projectPath);
    return list[list.length - 1];
  }

  count(): number {
    return this.sessions.size;
  }

  setPermissionMode(sessionId: string, mode: PermissionMode): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.permissionMode = mode;
    return true;
  }

  /**
   * One entry per project with a running terminal session, its newest one.
   * This is the shape the popup reads from `sessions-changed` and
   * `get-active-sessions`.
   */
  projectView(): Record<string, ActiveSession> {
    const view: Record<string, ActiveSession> = {};
    for (const s of this.sessions.values()) {
      view[s.projectPath] = { sessionId: s.sessionId, windowId: s.windowId, permissionMode: s.permissionMode };
    }
    return view;
  }

  /** Projects for the restore set: each once, in the order its first terminal session opened. */
  restoreSetPaths(): string[] {
    return [...new Set([...this.sessions.values()].map((s) => s.projectPath))];
  }
}
