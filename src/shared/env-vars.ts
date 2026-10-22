import type { EnvVars } from './types';

export interface EnvVarRow {
  name: string;
  value: string;
}

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvName(name: string): boolean {
  return ENV_NAME_PATTERN.test(name.trim());
}

export function rowsToEnvVars(rows: EnvVarRow[]): EnvVars {
  const result: EnvVars = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (isValidEnvName(name)) result[name] = row.value;
  }
  return result;
}

export function envVarsToRows(vars: EnvVars | undefined): EnvVarRow[] {
  return Object.entries(vars ?? {}).map(([name, value]) => ({ name, value }));
}

export function mergeEnvVars(globalVars: EnvVars | undefined, projectVars: EnvVars | undefined): EnvVars {
  return { ...globalVars, ...projectVars };
}
