export interface Project {
  path: string;
  name?: string;
  description?: string;
  hasBeads?: boolean;
  hasGit?: boolean;
  hasGithub?: boolean;
}

export interface ActiveSession {
  sessionId: string;
  windowId: number;
}

export interface AppSettings {
  globalShortcut: string;
  launchAtLogin: boolean;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface ClaudeStats {
  today: DailyActivity | null;
  last7Days: {
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  };
  last30Days: {
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  };
  lastComputedDate: string | null;
}

export interface ServiceStatus {
  status: 'operational' | 'degraded' | 'outage' | 'unknown';
  message: string;
}

export interface CockpitAPI {
  getProjects: () => Promise<Project[]>;
  addProject: (path: string) => Promise<Project>;
  updateProject: (path: string, updates: Partial<Project>) => Promise<Project>;
  removeProject: (path: string) => Promise<void>;
  openSession: (path: string, forceNew?: boolean) => Promise<void>;
  getActiveSessions: () => Promise<Record<string, ActiveSession>>;
  selectFolder: () => Promise<string | null>;
  closePopup: () => void;
  onSessionsChanged: (callback: (sessions: Record<string, ActiveSession>) => void) => void;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getCreateLocation: () => Promise<string>;
  setCreateLocation: (path: string) => Promise<void>;
  createProject: (name: string, location: string) => Promise<boolean>;
  getClaudeStats?: () => Promise<ClaudeStats>;
  getServiceStatus?: () => Promise<ServiceStatus>;
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
