export interface Project {
  path: string;
  name?: string;
  description?: string;
  hasBeads?: boolean;
}

export interface ActiveSession {
  sessionId: string;
  windowId: number;
}

export interface CockpitAPI {
  getProjects: () => Promise<Project[]>;
  addProject: (path: string) => Promise<Project>;
  updateProject: (path: string, updates: Partial<Project>) => Promise<Project>;
  removeProject: (path: string) => Promise<void>;
  openSession: (path: string, forceNew?: boolean) => Promise<void>;
  getActiveSessions: () => Promise<Record<string, ActiveSession>>;
  selectFolder: () => Promise<string | null>;
  onSessionsChanged: (callback: (sessions: Record<string, ActiveSession>) => void) => void;
}

export interface TerminalAPI {
  getSessionId: () => string | null;
  sendInput: (data: string) => void;
  onOutput: (callback: (data: string) => void) => void;
  resize: (cols: number, rows: number) => void;
}

declare global {
  interface Window {
    cockpit: CockpitAPI;
    terminal: TerminalAPI;
  }
}
