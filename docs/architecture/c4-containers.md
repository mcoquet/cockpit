# Containers: Cockpit

Cockpit is one Electron app. Its containers are the processes it runs and the files it
keeps, all on the user's Mac. Claude Code processes are started by Cockpit but are Claude
Code, so they appear as one external system.

```mermaid
C4Container
  %% See docs/adr/0001-embedded-terminal-spawns-claude-directly.md
  %% See docs/adr/0003-in-process-scheduler.md
  title Container diagram for Cockpit

  Person(user, "Developer", "Runs Claude Code across local projects")

  System_Boundary(cockpit, "Cockpit") {
    Container(main, "Main process", "Electron, Node.js, TypeScript", "Tray, windows, IPC, terminal sessions, scheduler")
    Container(popup, "Popup", "React, Vite", "Project list, conversation history, project editor, schedules")
    Container(terminal, "Terminal window", "React, xterm.js", "One per terminal session")
    Container(settingsUi, "Settings window", "React", "Shortcut, login item, external terminal, global env vars")
    Container(statusUi, "Status window", "React", "Service status and usage stats")
    ContainerDb(projectsStore, "projects.json", "electron-store", "Projects, schedules, schedule runs, restore set")
    ContainerDb(settingsStore, "settings.json", "electron-store", "App settings, create location")
    ContainerDb(summaries, "summaries/", "Text files", "One summary per conversation")
  }

  System_Ext(claudeCode, "Claude Code CLI", "claude processes and ~/.claude data")
  System_Ext(shell, "User's login shell", "zsh/bash")
  System_Ext(statusPage, "Anthropic Status Page", "status.anthropic.com")
  System_Ext(macos, "macOS", "Notifications, osascript, login items")

  Rel(user, popup, "Picks projects and conversations in")
  Rel(user, terminal, "Works with Claude Code in")
  Rel(popup, main, "Calls", "Electron IPC via preload")
  Rel(terminal, main, "Sends keystrokes and resizes to", "Electron IPC via preload")
  Rel(main, terminal, "Streams terminal output to", "Electron IPC")
  Rel(settingsUi, main, "Reads and saves settings via", "Electron IPC")
  Rel(statusUi, main, "Requests status and stats from", "Electron IPC")
  Rel(main, projectsStore, "Reads and writes", "JSON file")
  Rel(main, settingsStore, "Reads and writes", "JSON file")
  Rel(main, summaries, "Reads and writes", "Files")
  Rel(main, claudeCode, "Runs terminal sessions and headless runs in", "node-pty, child_process")
  Rel(main, shell, "Captures environment from", "$SHELL -ilc")
  Rel(main, statusPage, "Fetches status from", "HTTPS/JSON")
  Rel(main, macos, "Notifies and requests access via", "Electron, osascript")

  UpdateLayoutConfig($c4ShapeInRow="4", $c4BoundaryInRow="1")
```


- **Main process** (`src/main/`): owns all state and every side effect. It spawns `claude`
  directly in a PTY for each terminal session, runs headless schedule runs as plain child
  processes, and runs the scheduler (node-cron) in-process, so schedules fire only while
  Cockpit is running.
- **Renderer windows** (`src/renderer/`): four Vite entry points (`index.html` for the popup,
  `terminal.html`, `settings.html`, `status.html`). They have no Node access
  (`contextIsolation`, no `nodeIntegration`) and reach the main process only through the
  `window.cockpit` and `window.terminal` APIs in `src/preload.ts`.
- **projects.json** and **settings.json**: electron-store files in
  `~/Library/Application Support/cockpit/`. Terminal sessions live only in memory, and so does
  the queue of waiting schedule runs (their records are saved as "queued").
- **summaries/**: `<userData>/summaries/<encoded project path>/<conversation id>.summary`,
  kept in Cockpit's app data rather than Claude Code's, so the cask's `zap` removes them. Conversations themselves stay in
  Claude Code's own folder; Cockpit only reads them, or deletes one when the user asks.
