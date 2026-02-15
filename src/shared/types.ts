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

export interface SessionInfo {
  sessionId: string;
  lastModified: number; // Unix timestamp for easy serialization
  lastUserMessage: string | null;
}

export type ExternalTerminal = 'terminal' | 'iterm' | 'warp' | 'kitty' | `custom:${string}`;

export interface AppSettings {
  globalShortcut: string;
  launchAtLogin: boolean;
  externalTerminal: ExternalTerminal;
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
  selectApp: () => Promise<string | null>;
  closePopup: () => void;
  onSessionsChanged: (callback: (sessions: Record<string, ActiveSession>) => void) => void;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  getCreateLocation: () => Promise<string>;
  setCreateLocation: (path: string) => Promise<void>;
  createProject: (name: string, location: string) => Promise<boolean>;
  getClaudeStats?: () => Promise<ClaudeStats>;
  getServiceStatus?: () => Promise<ServiceStatus>;
  onFocusSearch: (callback: () => void) => void;
  getProjectSessions: (path: string, limit?: number, offset?: number) => Promise<SessionInfo[]>;
  deleteSession: (path: string, sessionId: string) => Promise<boolean>;
  openSessionById: (path: string, sessionId: string) => Promise<void>;
  hasSessionHistory: (path: string) => Promise<boolean>;

  // Scheduler
  listSchedules: (projectPath?: string) => Promise<Schedule[]>;
  getSchedule: (id: string) => Promise<Schedule | null>;
  createSchedule: (data: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Schedule>;
  updateSchedule: (id: string, updates: Partial<Schedule>) => Promise<Schedule | null>;
  deleteSchedule: (id: string) => Promise<boolean>;
  pauseSchedule: (id: string) => Promise<void>;
  resumeSchedule: (id: string) => Promise<void>;
  triggerSchedule: (id: string) => Promise<ScheduleRun | null>;
  getScheduleHistory: (id: string, limit?: number) => Promise<ScheduleRun[]>;
  interpretSchedule: (input: string) => Promise<ParsedSchedule>;
  onScheduleRunOutput: (callback: (data: { runId: string; chunk: string }) => void) => void;
  deleteScheduleRun: (runId: string) => Promise<boolean>;
  clearScheduleHistory: (scheduleId: string) => Promise<number>;
}

export interface ContextMenuOptions {
  hasSelection: boolean;
  selectedText?: string;
  link?: { type: 'url' | 'path'; text: string };
}

export interface TerminalAPI {
  getSessionId: () => string | null;
  sendInput: (data: string) => void;
  onOutput: (callback: (data: string) => void) => void;
  resize: (cols: number, rows: number) => void;
  openPath: (path: string) => void;
  showContextMenu: (options: ContextMenuOptions) => void;
}

// Scheduler types
export interface Schedule {
  id: string;
  projectPath: string;
  name: string;
  cron: string;
  enabled: boolean;
  mode: 'interactive' | 'headless';
  prompt: string;
  catchUp: boolean;
  queueBehavior: 'skip' | 'queue' | 'parallel';
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  startedAt: number;
  completedAt?: number;
  status: 'queued' | 'running' | 'success' | 'failed';
  error?: string;
  output?: string;
}

export interface ParsedSchedule {
  cron: string;
  cronHuman: string;
  prompt: string;
  mode: 'interactive' | 'headless';
  queueBehavior: 'skip' | 'queue' | 'parallel';
  catchUp: boolean;
  name: string;
}

declare global {
  interface Window {
    cockpit: CockpitAPI;
    terminal: TerminalAPI;
  }
}
