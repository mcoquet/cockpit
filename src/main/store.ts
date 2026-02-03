import path from 'path';
import os from 'os';
import type { Project } from '../shared/types';

// Use require for electron-store due to ESM/CJS compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Store = require('electron-store');

interface StoreSchema {
  projects: Project[];
}

const store = new Store({
  name: 'projects',
  defaults: {
    projects: [] as Project[],
  },
}) as {
  get: <K extends keyof StoreSchema>(key: K) => StoreSchema[K];
  set: <K extends keyof StoreSchema>(key: K, value: StoreSchema[K]) => void;
};

export function getProjects(): Project[] {
  return store.get('projects');
}

export function addProject(projectPath: string): Project {
  const projects = getProjects();

  // Convert absolute path to relative from home
  const homePath = os.homedir();
  const relativePath = projectPath.startsWith(homePath)
    ? projectPath.slice(homePath.length + 1)
    : projectPath;

  // Check if already exists
  if (projects.some((p) => p.path === relativePath)) {
    throw new Error('Project already exists');
  }

  const name = path.basename(relativePath);
  const project: Project = { path: relativePath, name };

  store.set('projects', [...projects, project]);
  return project;
}

export function updateProject(projectPath: string, updates: Partial<Project>): Project {
  const projects = getProjects();
  const index = projects.findIndex((p) => p.path === projectPath);

  if (index === -1) {
    throw new Error('Project not found');
  }

  const updated = { ...projects[index], ...updates, path: projectPath };
  projects[index] = updated;
  store.set('projects', projects);
  return updated;
}

export function removeProject(projectPath: string): void {
  const projects = getProjects();
  store.set(
    'projects',
    projects.filter((p) => p.path !== projectPath)
  );
}
