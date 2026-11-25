# Architecture

Cockpit is an Electron app with the usual three parts: a Node.js **main process** that owns
all state and side effects, **renderer** windows written in React, and a **preload** script
that is the only bridge between them. The system view (externals, containers, data files)
is in [`docs/architecture/`](docs/architecture/README.md); terms are in
[`GLOSSARY.md`](GLOSSARY.md); how the concepts relate is in
[`docs/domain-model.md`](docs/domain-model.md); decisions are in [`docs/adr/`](docs/adr/).

## Code map

### `src/main/`: main process

- `index.ts`: the app. Tray icon, popup, settings and status windows, the app menu, every
  `ipcMain` handler, global shortcuts, opening terminal sessions
  (`openSessionForProject`, `openSessionForProjectWithId`) and recording them in
  `terminalSessions` (a `SessionRegistry`), bell notifications, the dock,
  the restore set, upgrade restart and the quit confirmation. Start here.
- `pty.ts`: starts `claude` in a node-pty PTY and relays its output and exit. Its
  arguments (`--continue`, `--resume <id>` or neither, then the permission mode flags) come
  from `terminalSessionArgs` in `permission-mode.ts`.
- `terminal-window.ts`: creates terminal windows, cycles between them, and opens the
  external terminal (Cmd+T).
- `claude.ts`: finds the `claude` binary (known paths, then `which` in a login shell).
- `env.ts`: builds the environment for every `claude` process by capturing the user's
  interactive shell ([ADR 0005](docs/adr/0005-capture-interactive-shell-env-per-spawn.md)).
- `session-env.ts`: global environment variables merged with a project's.
- `sessions.ts`: conversation history. Reads Claude Code's `~/.claude/projects/<encoded
  path>/*.jsonl`, deletes conversations, and generates and caches summaries.
- `store.ts`: `projects.json` (projects, schedules, schedule runs, restore set).
- `settings.ts`: `settings.json`, the user's global shortcut and launch at login.
- `scheduler.ts`: schedule CRUD, node-cron jobs, queue behaviour, schedule-run records,
  and deleting a removed project's schedules (`deleteSchedulesForProject`).
- `job-registry.ts`: the scheduler's active node-cron jobs keyed by schedule ID
  (register, unregister, clear). Electron-free and unit-tested with real node-cron.
- `next-run.ts`: when a cron expression next comes due (`nextRunAt`), with cron-parser
  after node-cron's own validation; node-cron can't be asked for the next run of an
  unstarted task or from a given time. Backs `scheduler.getNextRunTime` and the
  `scheduler:next-run` IPC. Electron-free and unit-tested.
- `project-removal.ts`: which schedules and schedule runs go with a removed project, the
  remove dialog's checkbox label and schedule list, and the remove dialogs' flow
  (`askRemoveProject`, given `dialog.showMessageBox`; Cancel in any of them, the "Delete
  Permanently" confirmation included, removes nothing). Electron-free and unit-tested.
- `interrupted-runs.ts`: the scheduler's start-up sweep, which marks schedule runs a
  previous Cockpit process left "queued" or "running" as failed ("Cockpit quit before
  this ran"). Electron-free and unit-tested; `store.failInterruptedScheduleRuns` applies it.
- `scheduler-executor.ts`: runs a schedule run (interactive or headless) and turns a
  natural-language request into a schedule with Claude Code.
- `claude-stats.ts`: usage stats from `~/.claude/stats-cache.json`.
- `permissions.ts`: macOS privacy access prompts through `osascript`.
- `project-path.ts`: turns a stored project path (home-relative, `~/…` or absolute) into
  an absolute folder, and refuses home, its ancestors and the root as folders to delete.
  Kept free of Electron so it can be unit-tested.
- `window-count.ts`: pure dock-visibility helpers, kept free of Electron so they can be
  unit-tested.
- `external-terminal-script.ts`: builds the AppleScript Cmd+T sends to Terminal and iTerm.
  The folder path is single-quoted for the shell (`shellSingleQuote`, now in
  `src/shared/shell-quote.ts` and re-exported here), then escaped as an AppleScript string,
  so nothing in a folder name runs as a command. Electron-free and unit-tested.
- `permission-mode.ts`: pure helpers for the permission mode a terminal session or
  headless schedule run starts in (explicit choice, else the project's default, else
  Claude Code's default) and the matching CLI flags, for terminal sessions
  (`terminalSessionArgs`, used by `pty.ts`) and headless runs alike.
- `session-registry.ts`: `SessionRegistry`, every running terminal session keyed by
  terminal session id, with lookups by window and by project, the count, the per-project
  view the popup reads (`sessions-changed`, `get-active-sessions`: newest terminal session
  per project) and the restore set's project list (each project once). Electron-free and
  unit-tested.

### `src/preload.ts`

Exposes `window.cockpit` (popup, settings and status windows) and `window.terminal`
(terminal windows). Each method is one `ipcRenderer.invoke`/`send` to a channel handled in
`index.ts`, or an `ipcRenderer.on` subscription to an event the main process sends
(`schedule-run-started` comes from `scheduler.ts`). The one exception is
`window.terminal.getPathForFile`, which calls Electron's `webUtils.getPathForFile` in the
preload itself (Electron no longer gives renderers `File.path`). The types for both live in `src/shared/types.ts` (`CockpitAPI`, `TerminalAPI`).

### `src/renderer/`: windows

Four Vite entry points, each an HTML file plus a `*-main.tsx`:

- `index.html` → `App.tsx`: the popup. Project list with search and keyboard navigation,
  conversation history per project, add and create project, and `ProjectEditor.tsx`
  (details, permission mode, project environment variables, schedules and their runs).
  Multi-line fields use `UndoableTextarea.tsx` rather than a controlled `<textarea>`, so
  Cmd+Z undoes a typed run instead of one character (#33; see the invariant below).
- `terminal.html` → `Terminal.tsx`: xterm.js terminal, link handling, context menu,
  permission mode badge, the custom key handler (Shift+Enter, via `terminal-keys.ts`), and
  file drops: dropping files or folders types their quoted paths (via `dropped-paths.ts`),
  and every drop is `preventDefault`ed so the window never navigates to a dropped file.
- `settings.html` → `Settings.tsx` (with `EnvVarsEditor.tsx`).
- `status.html` → `Status.tsx`.

### `src/shared/`

`types.ts` (data types and the two bridge APIs) and `env-vars.ts` (pure environment
variable helpers used by both sides). Pure renderer helpers live here too, so the `node
--test` suite can reach them through `dist/main/shared/`: `terminal-keys.ts` (Shift+Enter
sends what xterm.js sends for Option+Enter, `ESC CR`, so Claude Code inserts a newline),
`path-display.ts` (splits a location so the popup's Create tab truncates it in the
middle and keeps the last folder visible), `shell-quote.ts` (`shellSingleQuote`, also
used by the main process for Cmd+T), `dropped-paths.ts` (the text a file drop types
into a terminal window: each path single-quoted, space-separated, one trailing space, no
Enter) and `next-run-label.ts` (the schedule editor's "Today 18:30" / "Mon 09:00" /
"Wed 2 Dec 09:05" label for a next run).

### Elsewhere

- `test/`: `node --test` unit tests for the Electron-free modules, run against the compiled
  output in `dist/main/` (`npm test` builds first).
  `test/electron/undo/` is a separate Electron check (Linux, `xvfb-run`; not part of `npm
  test`): it loads the built popup and settings pages with a stubbed `window.cockpit`, types
  into every text field and counts the undos needed to get back (`test/electron/undo/run.sh`
  after `npm run build:renderer`).
- `.githooks/pre-push`: when a `v*` tag is pushed, makes `package.json` match the tag;
  see Releases in `CLAUDE.md`.
- `.github/workflows/release.yml`: on a `v*` tag, runs `npm test` (a failure stops the
  release), builds unsigned arm64 and x64 DMGs,
  publishes a GitHub release and rewrites the Homebrew cask
  ([ADR 0004](docs/adr/0004-unsigned-homebrew-distribution.md)).
- `docs/plans/`, `docs/superpowers/`: past design docs and plans. History, not a
  description of the current system.

## Invariants

- **Renderers have no Node access.** Every window uses `contextIsolation: true` and
  `nodeIntegration: false`; anything that touches files, processes or the network is an IPC
  handler in `index.ts`.
- **Terminal input is routed by window, never by a renderer-supplied ID.** `pty-input` and
  `pty-resize` look up the sender window in the session registry (`findByWindow`).
- **Every running terminal session is in the session registry.** It is added when its
  window is created and removed when the window closes or a failed continue is replaced;
  nothing keeps a separate per-project record (#58).
- **A terminal window and its PTY end together.** Closing the window kills the PTY; the PTY
  exiting closes the window ([ADR 0001](docs/adr/0001-embedded-terminal-spawns-claude-directly.md)).
- **Every terminal session's permission mode comes from `resolvePermissionMode`.**
  `openSessionForProject` resolves it when no mode is passed, so callers pass a mode only
  for an explicit Option+click choice; `openSessionForProjectWithId` and headless schedule
  runs (`scheduler-executor.ts`) use it too.
- **Every `claude` process gets its environment from `getClaudeSpawnEnv`.** Terminal
  sessions, headless schedule runs, summaries and schedule interpretation all go through
  it, so they all see the user's shell environment plus Cockpit's environment variables.
- **Project paths are stored relative to home**
  ([ADR 0002](docs/adr/0002-project-identity-is-home-relative-path.md)), or absolute for
  folders outside it, and expanded at the point of use. `project-path.ts`
  (`expandProjectPath`) is the shared expansion; so far only the remove-project handler in
  `index.ts` uses it. The expansion is still written out separately, with slightly different
  rules, in `pty.ts`, `store.ts`, `sessions.ts`, `scheduler-executor.ts`,
  `terminal-window.ts` and elsewhere in `index.ts` (moving those over is #59).
- **A folder path never reaches a shell unquoted.** Cmd+T hands the path to Warp, Kitty
  and custom apps as an `open -a` argument, and to Terminal and iTerm only through
  `external-terminal-script.ts`.
- **Text fields keep the browser's undo.** Cmd+Z and Cmd+Shift+Z come from the Edit menu's
  `undo`/`redo` roles, which act on Chromium's own undo stack; nothing in the renderers keeps
  its own. A controlled React `<textarea>` breaks that stack's grouping (React rewrites its
  text child on every change), so textareas go through `UndoableTextarea`. `<input>` fields
  are not affected and stay ordinary controlled inputs.
- **Only the main process writes Cockpit's data.** Cockpit never writes Claude Code's data
  except to delete a conversation file the user asked to delete.

## Cross-cutting concerns

- **Logging:** `electron-log` in the main process; production logs go to
  `~/Library/Logs/Cockpit/main.log`. Messages are prefixed with a `[area]` tag.
- **Persistence:** electron-store, loaded with `require()` because of its ESM/CJS packaging.
  Stored settings are merged over defaults on read, so new fields need only a default.
- **Development vs production:** `NODE_ENV=development` (set by `npm run dev`) loads the
  renderers from the Vite dev server on `localhost:5173`, shows Ω instead of λ in the tray,
  adds "(Dev)" to window titles, opens DevTools for terminal windows, skips the single-instance lock (so dev and
  the installed app can run side by side), skips the launch-at-login registration, and
  skips the upgrade watcher.
- **Upgrade restart:** in production, Cockpit watches `/Applications/Cockpit.app`; when the
  bundle is replaced it saves the restore set and relaunches.
- **Errors:** IPC handlers mostly log and return an empty or `false` result; user-facing
  failures use native dialogs (`dialog.showErrorBox`, `showMessageBox`).
