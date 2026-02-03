export interface Project {
  path: string;
  name?: string;
  description?: string;
}

export interface ActiveSession {
  sessionId: string;
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

declare global {
  interface Window {
    cockpit: CockpitAPI;
  }
}
