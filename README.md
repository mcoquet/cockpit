# Cockpit

A launchpad for Claude Code.

```bash
brew tap mcoquet/cockpit && brew install --cask cockpit
```

## How it works

Click the **λ** in your menubar to see your projects. Select one and a terminal window opens with Claude Code ready to go.

That's it. No `cd`-ing around. No hunting for the right terminal tab.

**Adding projects:** Click "+ Add Project" and pick a folder, or create a new project folder from the popup. Cockpit remembers it.

**New or past conversations:** Selecting a project always starts a new conversation, in a new window. To pick up an earlier one, expand the project (→) to see its conversation history, with a short summary of each, and select it. Right-click a past conversation to delete it.

**Permission mode:** Set a project's default in its editor (right-click the project), or **Option+click** a project to choose one for this launch only. The badge in the terminal window switches it while you work.

**Schedules:** In the project editor, describe a recurring task in plain words ("every weekday at 9am check for security issues") and Cockpit turns it into a schedule. A schedule either opens a terminal window and types the prompt, or runs Claude Code in the background and keeps its output. Schedules run only while Cockpit is running.

**Environment variables:** Set variables for every project in Settings, or for one project in its editor. A project's value wins.

**Finding windows:** **Cmd+`** cycles through your Cockpit terminals from anywhere, even when you're in another app. A notification tells you when a terminal in the background needs attention.

**After quitting:** **Cmd+Shift+T** reopens the projects you had open. After a Homebrew upgrade Cockpit restarts and reopens them by itself.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Cmd+`** | Cycle through terminal windows (global) |
| **Cmd+N** | New conversation in the focused terminal's project, or open the project list |
| **Cmd+← / Cmd+→** | Previous / next terminal window |
| **Cmd+T** | Open the project folder in your external terminal (set in Settings) |
| **Cmd+Shift+T** | Reopen the projects open when Cockpit last quit |
| **Cmd+,** | Settings |
| **Shift+Cmd+click λ** | Claude status and usage stats |
| **↑/↓** | Navigate projects and conversations |
| **→ / ←** | Expand / collapse a project's conversation history |
| **Enter** | Open the selection |
| **Shift+Tab** | Switch between search and create project |
| **Escape** | Close popup |
| **Type** | Filter projects |

In the terminal, **Option+click** a file path to open it.

## Other ways to install

**Direct download:** Grab the DMG from [Releases](https://github.com/mcoquet/cockpit/releases). After installing, run:
```bash
xattr -d com.apple.quarantine /Applications/Cockpit.app
```

**From source:** See [CONTRIBUTING.md](CONTRIBUTING.md).

## Requirements

- macOS
- [Claude Code](https://claude.ai/code) installed

## License

ISC
