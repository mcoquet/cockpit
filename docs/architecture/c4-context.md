# System Context: Cockpit

Cockpit runs on one Mac, for one user. Everything it does happens on that machine except
two outbound calls: the Anthropic status page, and the Claude model calls that Claude Code
makes on its behalf (summaries, schedule interpretation, and the user's own work).

```mermaid
%% See docs/adr/0004-unsigned-homebrew-distribution.md
%% See docs/adr/0005-capture-interactive-shell-env-per-spawn.md
C4Context
  title System Context diagram for Cockpit

  Person(user, "Developer", "Runs Claude Code across local projects")

  System(cockpit, "Cockpit", "macOS menubar app: lists projects, opens Claude Code terminal sessions, runs schedules")

  System_Ext(claudeCode, "Claude Code CLI", "The claude binary and its local data in ~/.claude")
  System_Ext(anthropic, "Anthropic API", "Claude models used by Claude Code")
  System_Ext(statusPage, "Anthropic Status Page", "status.anthropic.com service status")
  System_Ext(shell, "User's login shell", "zsh/bash with the user's rc files")
  System_Ext(macos, "macOS", "Notifications, Calendar, Reminders, System Events, login items")
  System_Ext(extTerminal, "External terminal app", "Terminal, iTerm, Warp, Kitty or another")
  System_Ext(github, "GitHub", "Project repositories; Cockpit releases and Homebrew tap")

  Rel(user, cockpit, "Opens projects, conversations and schedules in")
  Rel(cockpit, claudeCode, "Starts, and reads conversations and usage stats from", "PTY, child process, files")
  Rel(claudeCode, anthropic, "Sends prompts to", "HTTPS")
  Rel(cockpit, statusPage, "Reads service status from", "HTTPS/JSON")
  Rel(cockpit, shell, "Captures the environment of", "child process")
  Rel(cockpit, macos, "Shows notifications and requests privacy access via", "Electron, osascript")
  Rel(cockpit, extTerminal, "Opens project folders in", "osascript / open -a")
  Rel(cockpit, github, "Opens repository pages from", "default browser")
  Rel(user, github, "Installs Cockpit from", "Homebrew cask / DMG")
```

- **Claude Code CLI** is the core dependency. Cockpit finds the `claude` binary
  (`src/main/claude.ts`), runs it in terminal sessions and headless schedule runs, and reads
  Claude Code's conversation files (`~/.claude/projects/`) and usage stats
  (`~/.claude/stats-cache.json`). It also uses it to generate summaries and to interpret
  natural-language schedules, both with the Haiku model.
- **Anthropic API** is reached only through Claude Code. When a terminal session ends,
  Cockpit sends the first and last 20 KB of that conversation's file to Claude Code to
  generate a summary, so part of every conversation goes to the model a second time.
- **Anthropic Status Page**: `GET https://status.anthropic.com/api/v2/status.json` for the
  status window. It is the only network call Cockpit makes itself.
- **User's login shell** is run as `$SHELL -ilc` before every Claude Code process starts, so
  the process gets the same environment as a new terminal tab.
- **macOS**: bell notifications, launch at login, and `osascript` prompts for Calendar,
  Reminders and Automation access (macOS privacy access).
- **External terminal app**: Cmd+T opens the project's folder in the user's chosen app.
- **GitHub**: project pages open in the browser. Cockpit itself is distributed from GitHub
  Releases and the `mcoquet/homebrew-cockpit` tap.
