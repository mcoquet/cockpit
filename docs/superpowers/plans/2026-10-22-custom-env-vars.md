# Custom Environment Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users define global and per-project environment variables that are passed to every `claude` process Cockpit spawns (GitHub issue #42).

**Architecture:** Pure helpers in `src/shared/env-vars.ts` (validation, row conversion, merge) are shared by main and renderer. A main-process resolver `src/main/session-env.ts` reads global vars from settings and project vars from the project store, merges them, and every spawn site passes the result into `getClaudeSpawnEnv`. A shared React `EnvVarsEditor` component renders the key/value rows in both the Settings window and the project editor.

**Tech Stack:** Electron, TypeScript, React, electron-store, node-pty, `node:test` (tests run against compiled `dist/`).

**Spec:** Agreed in chat on 2026-10-22 (no separate doc). Restated verbatim-in-substance here:
- Scope is both global and per-project. Project vars override global vars with the same name.
- UI in both places: global in the Settings window, per-project in the project editor.
- No special handling for secrets; stored as plain values in electron-store.
- Interactive sessions and headless scheduled runs get global + project merged. Cockpit's internal helper calls (session summaries, schedule interpretation) get global only.
- External terminals are out of scope (they only `cd`, they do not launch claude).
- Editor: one row per variable (name, value, remove button) plus an "Add variable" button. Rows with an empty name are dropped on save.
- User vars are applied after the inherited env and computed PATH, so a user may override PATH. `TERM` stays forced to `xterm-256color` for PTY sessions.
- Changes apply to new sessions only.

## Global Constraints

- Type name: `export type EnvVars = Record<string, string>;` in `src/shared/types.ts`.
- Field names: `Project.envVars?: EnvVars` and `AppSettings.envVars: EnvVars` (default `{}`).
- Valid env var name: `/^[A-Za-z_][A-Za-z0-9_]*$/`. Names are trimmed before validation. Values are kept as-is (not trimmed).
- Tests live in `test/*.test.js`, use `node:test` + `node:assert/strict`, and `require` compiled modules from `../dist/main/...`. Run with `npm test`.
- Follow existing code style: no new dependencies, existing CSS conventions in `src/renderer/index.css` and `src/renderer/settings.css`.

## Review Focus

1. Duplicate names in the editor (two rows `FOO`): the last row wins. Pinned in Task 1 (`rowsToEnvVars` duplicate test).
2. Invalid name (`MY VAR`, `1ABC`, `A=B`): never reaches the process env; dropped on conversion and highlighted in the editor. Pinned in Task 1 (invalid-name test) and Task 3 (visual check).
3. Settings window auto-saves 300 ms after each change: a freshly added empty row must not disappear while the user types. Task 3 keeps rows in local state, separate from the saved `envVars`.
4. Projects and settings stored before this feature have no `envVars` field: everything must treat `undefined` as `{}`. Pinned in Task 1 (`mergeEnvVars(undefined, undefined)`).
5. User var named `PATH` overrides the computed PATH; `TERM` cannot be overridden in PTY sessions. Pinned in Task 2 (`getClaudeSpawnEnv` override test).

---

### Task 1: Shared types and pure helpers

**Files:**
- Modify: `src/shared/types.ts` (add `EnvVars`, `Project.envVars`, `AppSettings.envVars`)
- Create: `src/shared/env-vars.ts`
- Modify: `src/main/settings.ts` (`DEFAULT_SETTINGS.envVars = {}`)
- Test: `test/env-vars.test.js`

**Interfaces:**
- Produces (all exported from `src/shared/env-vars.ts`):
  - `interface EnvVarRow { name: string; value: string }`
  - `isValidEnvName(name: string): boolean`: true when the trimmed name matches the regex in Global Constraints.
  - `rowsToEnvVars(rows: EnvVarRow[]): EnvVars`: trims names, drops rows whose trimmed name is invalid (empty included), later duplicates overwrite earlier ones.
  - `envVarsToRows(vars: EnvVars | undefined): EnvVarRow[]`: one row per entry in insertion order; `undefined` → `[]`.
  - `mergeEnvVars(globalVars: EnvVars | undefined, projectVars: EnvVars | undefined): EnvVars`: `{...global, ...project}`, treating `undefined` as `{}`.

- [ ] **Step 1: Write the failing tests** in `test/env-vars.test.js`, requiring `../dist/main/shared/env-vars.js`:

```js
test('isValidEnvName accepts and rejects', () => {
  for (const n of ['FOO', '_x', 'A1_B', '  FOO  ']) assert.equal(isValidEnvName(n), true, n);
  for (const n of ['', '   ', '1ABC', 'MY VAR', 'A=B', 'A-B']) assert.equal(isValidEnvName(n), false, n);
});
test('rowsToEnvVars trims names, keeps values, drops invalid', () => {
  assert.deepEqual(
    rowsToEnvVars([{ name: ' FOO ', value: ' bar ' }, { name: '', value: 'x' }, { name: 'MY VAR', value: 'y' }]),
    { FOO: ' bar ' });
});
test('rowsToEnvVars: last duplicate wins', () => {
  assert.deepEqual(rowsToEnvVars([{ name: 'A', value: '1' }, { name: 'A', value: '2' }]), { A: '2' });
});
test('envVarsToRows round-trips and handles undefined', () => {
  assert.deepEqual(envVarsToRows({ A: '1', B: '2' }), [{ name: 'A', value: '1' }, { name: 'B', value: '2' }]);
  assert.deepEqual(envVarsToRows(undefined), []);
});
test('mergeEnvVars: project overrides global', () => {
  assert.deepEqual(mergeEnvVars({ A: 'g', B: 'g' }, { B: 'p', C: 'p' }), { A: 'g', B: 'p', C: 'p' });
  assert.deepEqual(mergeEnvVars(undefined, undefined), {});
  assert.deepEqual(mergeEnvVars({ A: 'g' }, undefined), { A: 'g' });
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, cannot find module `dist/main/shared/env-vars.js`.
- [ ] **Step 3: Add the types** to `src/shared/types.ts` and `envVars: {}` to `DEFAULT_SETTINGS` in `src/main/settings.ts`.
- [ ] **Step 4: Implement `src/shared/env-vars.ts`** per the Interfaces block. It must not import anything from electron or node (the renderer imports it too); `import type { EnvVars } from './types'` is fine.
- [ ] **Step 5: Run** `npm test`. Expected: all tests pass (7 existing + 5 new). Also run `npx tsc -p tsconfig.main.json --noEmit`. Expected: no errors. If `Settings.tsx` fails type-checking in the renderer because of the new required field, that is fixed in Task 3; `npm run build:main` does not compile the renderer.
- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/env-vars.ts src/main/settings.ts test/env-vars.test.js
git commit -m "feat(env): add env var types and pure helpers (#42)"
```

### Task 2: Pass env vars into every claude spawn

**Files:**
- Modify: `src/main/env.ts` (`getClaudeSpawnEnv`)
- Create: `src/main/session-env.ts`
- Modify: `src/main/pty.ts` (`spawnClaude` options)
- Modify: `src/main/index.ts` (both `pty.spawnClaude` calls, ~lines 722 and 822)
- Modify: `src/main/scheduler-executor.ts` (headless run spawn ~line 58; interpret spawn ~line 120)
- Modify: `src/main/sessions.ts` (summary spawn ~line 173)
- Test: `test/spawn-env.test.js`

**Interfaces:**
- Consumes: `EnvVars`, `mergeEnvVars` from Task 1; `settings.getSettings()` (`src/main/settings.ts`); `store.getProjects()` (`src/main/store.ts`).
- Produces:
  - `getClaudeSpawnEnv(claudePath: string, extraEnv?: EnvVars): NodeJS.ProcessEnv`: returns `{ ...process.env, PATH: <computed>, ...extraEnv }`.
  - `getEnvVarsForProject(projectPath?: string): EnvVars` in `src/main/session-env.ts`: global settings vars merged with the vars of the project whose `path === projectPath`; with no `projectPath`, global only.
  - `spawnClaude(projectPath, claudePath, options?: { ...existing, envVars?: EnvVars })`: PTY env becomes `{ ...getClaudeSpawnEnv(claudePath, options?.envVars), TERM: 'xterm-256color' }`.

- [ ] **Step 1: Write the failing test** `test/spawn-env.test.js`, requiring `../dist/main/main/env.js`:

```js
test('getClaudeSpawnEnv applies extra vars after PATH', () => {
  const env = getClaudeSpawnEnv('/x/bin/claude', { FOO: 'bar', PATH: '/custom' });
  assert.equal(env.FOO, 'bar');
  assert.equal(env.PATH, '/custom');
});
test('getClaudeSpawnEnv without extras keeps computed PATH', () => {
  const env = getClaudeSpawnEnv('/x/bin/claude');
  assert.ok(env.PATH.startsWith('/x/bin:'));
});
```

- [ ] **Step 2: Run** `npm test`. Expected: the first test FAILS (`env.FOO` undefined).
- [ ] **Step 3: Implement** the `getClaudeSpawnEnv` change, `src/main/session-env.ts`, and the `spawnClaude` option.
- [ ] **Step 4: Wire the call sites:**
  - `index.ts` both `spawnClaude` calls: add `envVars: getEnvVarsForProject(projectPath)`.
  - `scheduler-executor.ts` headless run: `getClaudeSpawnEnv(claudePath, getEnvVarsForProject(schedule.projectPath))`. Interpret call: `getClaudeSpawnEnv(claudePath, getEnvVarsForProject())`.
  - `sessions.ts` summary call: `getClaudeSpawnEnv(claudePath, getEnvVarsForProject())`.
  - Interactive schedules go through `index.ts` open-session, so they need nothing extra. Confirm by reading `openSessionFn` wiring.
- [ ] **Step 5: Run** `npm test` and `npx tsc -p tsconfig.main.json --noEmit`. Expected: all pass, no type errors. Then `grep -n "getClaudeSpawnEnv(" src/main/*.ts`: every call outside `env.ts` passes a second argument.
- [ ] **Step 6: Commit**

```bash
git add src/main/env.ts src/main/session-env.ts src/main/pty.ts src/main/index.ts src/main/scheduler-executor.ts src/main/sessions.ts test/spawn-env.test.js
git commit -m "feat(env): pass global and project env vars to claude processes (#42)"
```

### Task 3: Editor UI in Settings and project editor

**Files:**
- Create: `src/renderer/EnvVarsEditor.tsx`
- Modify: `src/renderer/Settings.tsx`
- Modify: `src/renderer/ProjectEditor.tsx` (General tab, below Permission Mode, ~line 269; `handleSave` ~line 238)
- Modify: `src/renderer/settings.css`, `src/renderer/index.css`

**Interfaces:**
- Consumes: `EnvVarRow`, `isValidEnvName`, `rowsToEnvVars`, `envVarsToRows` from `src/shared/env-vars.ts`; `Project.envVars`, `AppSettings.envVars`.
- Produces: `export default function EnvVarsEditor({ rows, onChange }: { rows: EnvVarRow[]; onChange: (rows: EnvVarRow[]) => void })`.

- [ ] **Step 1: Build `EnvVarsEditor`.** A controlled list. Each row has a name `<input>` (placeholder `NAME`, monospace), a value `<input>` (placeholder `value`), and a remove button (`×`, `aria-label="Remove variable"`). An "Add variable" button below appends `{ name: '', value: '' }`. A name input whose value is non-empty and fails `isValidEnvName` gets the class `env-var-invalid` (red border) and `title="Letters, digits and _ only; cannot start with a digit"`. Root class `env-vars-editor`. Add matching styles to both CSS files, following each file's existing input and button styles.
- [ ] **Step 2: Settings window.** Add `envVars: EnvVars` to the local `Settings` interface and initial state (`{}`). Keep a separate `envRows` state, initialised from `envVarsToRows(s.envVars)` on load. On rows change: `setEnvRows(rows)` and `setSettings(s => ({ ...s, envVars: rowsToEnvVars(rows) }))`. The existing debounced auto-save then persists it, and the empty row stays visible because it lives in `envRows`. Section label: "Environment Variables", with a hint line: "Passed to every Claude session. Project variables override these."
- [ ] **Step 3: Project editor.** In the General tab below Permission Mode, add an `editor-field` labelled "Environment Variables" with the hint "Override global variables with the same name." Rows state is initialised from `envVarsToRows(project.envVars)`. `handleSave` adds `envVars: rowsToEnvVars(envRows)` to the `onSave` payload. Confirm the `onSave` type and its caller in `App.tsx` forward the field to `window.cockpit.updateProject`, and widen the type if it is narrower than `Partial<Project>`.
- [ ] **Step 4: Verify the build.** Run `npm run build` (main and renderer). Expected: success with no type errors. Run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add src/renderer/EnvVarsEditor.tsx src/renderer/Settings.tsx src/renderer/ProjectEditor.tsx src/renderer/settings.css src/renderer/index.css
git commit -m "feat(env): env var editor in settings and project editor (#42)"
```

Manual check (for the human, not the implementer): in `npm run dev`, set global `FOO=global` and project `FOO=project`, `BAR=1`. Open a session, then run `! echo $FOO $BAR` inside claude. Expected: `project 1`.
