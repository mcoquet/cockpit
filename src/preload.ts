import { contextBridge, ipcRenderer } from 'electron';
import type { Project, ActiveSession, CockpitAPI } from './shared/types';

const api: CockpitAPI = {
  getProjects: () => ipcRenderer.invoke('get-projects'),
  addProject: (path: string) => ipcRenderer.invoke('add-project', path),
  updateProject: (path: string, updates: Partial<Project>) =>
    ipcRenderer.invoke('update-project', path, updates),
  removeProject: (path: string) => ipcRenderer.invoke('remove-project', path),
  openSession: (path: string, forceNew?: boolean) =>
    ipcRenderer.invoke('open-session', path, forceNew),
  getActiveSessions: () => ipcRenderer.invoke('get-active-sessions'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  onSessionsChanged: (callback) => {
    ipcRenderer.on('sessions-changed', (_event, sessions: Record<string, ActiveSession>) =>
      callback(sessions)
    );
  },
};

contextBridge.exposeInMainWorld('cockpit', api);
