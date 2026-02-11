import { contextBridge, ipcRenderer } from 'electron';
import type { Project, ActiveSession, AppSettings, ClaudeStats, ServiceStatus, CockpitAPI, TerminalAPI } from './shared/types';

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
};

contextBridge.exposeInMainWorld('cockpit', cockpitApi);
contextBridge.exposeInMainWorld('terminal', terminalApi);
