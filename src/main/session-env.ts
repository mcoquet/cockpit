import type { EnvVars } from '../shared/types';
import { mergeEnvVars } from '../shared/env-vars';
import { getSettings } from './settings';
import { getProjects } from './store';

/**
 * Global env vars merged with the vars of the project at `projectPath`
 * (project wins). With no projectPath, global vars only.
 */
export function getEnvVarsForProject(projectPath?: string): EnvVars {
  const globalVars = getSettings().envVars;
  const project = projectPath ? getProjects().find((p) => p.path === projectPath) : undefined;
  return mergeEnvVars(globalVars, project?.envVars);
}
