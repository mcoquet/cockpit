import { contextBridge, ipcRenderer } from 'electron';
import type { Project, ActiveSession, AppSettings, ClaudeStats, ServiceStatus, CockpitAPI, TerminalAPI, ContextMenuOptions, SessionInfo, Schedule, ScheduleRun } from './shared/types';

const cockpitApi: CockpitAPI = {
  getProjects: () => ipcRenderer.invoke('get-projects'),
  addProject: (path: string) => ipcRenderer.invoke('add-project', path),
  updateProject: (path: string, updates: Partial<Project>) =>
    ipcRenderer.invoke('update-project', path, updates),
  removeProject: (path: string) => ipcRenderer.invoke('remove-project', path),
  openSession: (path: string, forceNew?: boolean) =>
    ipcRenderer.invoke('open-session', path, forceNew),
  getActiveSessions: () => ipcRenderer.invoke('get-active-sessions'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectApp: () => ipcRenderer.invoke('select-app'),
  closePopup: () => ipcRenderer.send('close-popup'),
  onSessionsChanged: (callback) => {
    ipcRenderer.on('sessions-changed', (_event, sessions: Record<string, ActiveSession>) =>
      callback(sessions)
    );
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('save-settings', settings),
  getCreateLocation: () => ipcRenderer.invoke('get-create-location'),
  setCreateLocation: (path: string) => ipcRenderer.invoke('set-create-location', path),
  createProject: (name: string, location: string) => ipcRenderer.invoke('create-project', name, location),
  getClaudeStats: () => ipcRenderer.invoke('get-claude-stats'),
  getServiceStatus: () => ipcRenderer.invoke('get-service-status'),
  onFocusSearch: (callback) => {
    ipcRenderer.on('focus-search', () => callback());
  },
  getProjectSessions: (path: string, limit?: number, offset?: number): Promise<SessionInfo[]> =>
    ipcRenderer.invoke('get-project-sessions', path, limit, offset),
  hasSessionHistory: (path: string): Promise<boolean> =>
    ipcRenderer.invoke('has-session-history', path),
  deleteSession: (path: string, sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('delete-session', path, sessionId),
  openSessionById: (path: string, sessionId: string): Promise<void> =>
    ipcRenderer.invoke('open-session-by-id', path, sessionId),

  // Scheduler
  listSchedules: (projectPath?: string) =>
    ipcRenderer.invoke('scheduler:list', projectPath),
  getSchedule: (id: string) =>
    ipcRenderer.invoke('scheduler:get', id),
  createSchedule: (data: Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>) =>
    ipcRenderer.invoke('scheduler:create', data),
  updateSchedule: (id: string, updates: Partial<Schedule>) =>
    ipcRenderer.invoke('scheduler:update', id, updates),
  deleteSchedule: (id: string) =>
    ipcRenderer.invoke('scheduler:delete', id),
  pauseSchedule: (id: string) =>
    ipcRenderer.invoke('scheduler:pause', id),
  resumeSchedule: (id: string) =>
    ipcRenderer.invoke('scheduler:resume', id),
  triggerSchedule: (id: string) =>
    ipcRenderer.invoke('scheduler:trigger', id),
  getScheduleHistory: (id: string, limit?: number) =>
    ipcRenderer.invoke('scheduler:history', id, limit),
  interpretSchedule: (input: string) =>
    ipcRenderer.invoke('scheduler:interpret', input),
  onScheduleRunOutput: (callback: (data: { runId: string; chunk: string }) => void) => {
    ipcRenderer.on('schedule-run-output', (_event, data) => callback(data));
  },
  onScheduleRunStarted: (callback) => {
    ipcRenderer.on('schedule-run-started', (_event, run) => callback(run));
  },
  deleteScheduleRun: (runId: string) =>
    ipcRenderer.invoke('scheduler:delete-run', runId),
  clearScheduleHistory: (scheduleId: string) =>
    ipcRenderer.invoke('scheduler:clear-history', scheduleId),
};

const terminalApi: TerminalAPI = {
  getSessionId: () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('sessionId');
  },
  sendInput: (data: string) => {
    ipcRenderer.send('pty-input', data);
  },
  onOutput: (callback: (data: string) => void) => {
    ipcRenderer.on('pty-output', (_event, data: string) => {
      callback(data);
    });
  },
  resize: (cols: number, rows: number) => {
    ipcRenderer.send('pty-resize', cols, rows);
  },
  openPath: (path: string) => {
    ipcRenderer.send('open-path', path);
  },
  showContextMenu: (options: ContextMenuOptions) => {
    ipcRenderer.send('terminal-context-menu', options);
  },
};

contextBridge.exposeInMainWorld('cockpit', cockpitApi);
contextBridge.exposeInMainWorld('terminal', terminalApi);
