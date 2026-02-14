import path from 'path';
import os from 'os';
import fs from 'fs';
import type { Project, Schedule, ScheduleRun } from '../shared/types';

// Use require for electron-store due to ESM/CJS compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store');
const Store = ElectronStore.default || ElectronStore;

interface StoreSchema {
  projects: Project[];
  previousSession: string[];
  upgradeRestart: boolean;
  schedules: Schedule[];
  scheduleRuns: ScheduleRun[];
}

const store = new Store({
  name: 'projects',
  defaults: {
    projects: [] as Project[],
    previousSession: [] as string[],
    upgradeRestart: false,
    schedules: [] as Schedule[],
    scheduleRuns: [] as ScheduleRun[],
  },
}) as {
  get: <K extends keyof StoreSchema>(key: K) => StoreSchema[K];
  set: <K extends keyof StoreSchema>(key: K, value: StoreSchema[K]) => void;
};

function checkHasBeads(projectPath: string): boolean {
  const fullPath = path.join(os.homedir(), projectPath, '.beads');
  return fs.existsSync(fullPath);
}

function checkHasGit(projectPath: string): boolean {
  const fullPath = path.join(os.homedir(), projectPath, '.git');
  return fs.existsSync(fullPath);
}

function checkHasGithub(projectPath: string): boolean {
  const configPath = path.join(os.homedir(), projectPath, '.git', 'config');
  if (!fs.existsSync(configPath)) return false;
  try {
    const config = fs.readFileSync(configPath, 'utf-8');
    return config.includes('github.com');
  } catch {
    return false;
  }
}

export function getProjects(): Project[] {
  const projects = store.get('projects');
  return projects.map((p) => ({
    ...p,
    hasBeads: checkHasBeads(p.path),
    hasGit: checkHasGit(p.path),
    hasGithub: checkHasGithub(p.path),
  }));
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

export function savePreviousSession(projectPaths: string[]): void {
  store.set('previousSession', projectPaths);
}

export function getPreviousSession(): string[] {
  return store.get('previousSession');
}

export function clearPreviousSession(): void {
  store.set('previousSession', []);
}

export function setUpgradeRestart(value: boolean): void {
  store.set('upgradeRestart', value);
}

export function getUpgradeRestart(): boolean {
  return store.get('upgradeRestart') || false;
}

// Schedule storage functions

export function getSchedules(): Schedule[] {
  return store.get('schedules') as Schedule[];
}

export function getSchedulesByProject(projectPath: string): Schedule[] {
  return getSchedules().filter((s) => s.projectPath === projectPath);
}

export function getSchedule(id: string): Schedule | null {
  return getSchedules().find((s) => s.id === id) || null;
}

export function saveSchedule(schedule: Schedule): Schedule {
  const schedules = getSchedules();
  const index = schedules.findIndex((s) => s.id === schedule.id);
  if (index >= 0) {
    schedules[index] = schedule;
  } else {
    schedules.push(schedule);
  }
  store.set('schedules', schedules);
  return schedule;
}

export function deleteSchedule(id: string): boolean {
  const schedules = getSchedules();
  const filtered = schedules.filter((s) => s.id !== id);
  if (filtered.length === schedules.length) return false;
  store.set('schedules', filtered);
  // Also delete associated runs
  const runs = getScheduleRuns();
  store.set('scheduleRuns', runs.filter((r) => r.scheduleId !== id));
  return true;
}

export function getScheduleRuns(scheduleId?: string, limit = 100): ScheduleRun[] {
  const runs = store.get('scheduleRuns') as ScheduleRun[];
  const filtered = scheduleId ? runs.filter((r) => r.scheduleId === scheduleId) : runs;
  return filtered.slice(-limit);
}

export function saveScheduleRun(run: ScheduleRun): ScheduleRun {
  const runs = store.get('scheduleRuns') as ScheduleRun[];
  const index = runs.findIndex((r) => r.id === run.id);
  if (index >= 0) {
    runs[index] = run;
  } else {
    runs.push(run);
  }
  // Cap at 1000 runs total
  const capped = runs.slice(-1000);
  store.set('scheduleRuns', capped);
  return run;
}
