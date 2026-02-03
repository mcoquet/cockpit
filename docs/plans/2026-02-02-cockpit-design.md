# Cockpit Design Spec

## Problem & Solution

**Problem:**
Managing multiple Claude Code projects across terminal tabs is chaotic. You lose track of which tab is which, and forget about projects that don't have open sessions.

**Solution:**
Cockpit — a macOS menubar app that serves as a central inventory of your Claude Code projects. Click the menubar icon to see all projects, launch sessions, and quickly return to active ones.

**Key behaviors:**
- Projects are identified by their path relative to `~` (folder name = project name)
- Each project has an optional description explaining its purpose
- Clicking a project opens or focuses a Claude Code session for it
- Cmd+click forces a new session even if one exists

**Phased approach:**
1. **Phase 1**: Menubar launcher that opens iTerm2 windows
2. **Phase 2**: Embed terminal sessions directly in Cockpit

---

## Data Model & Storage

**Project record:**
```json
{
  "path": "Documents/projects/cockpit",
  "name": "Cockpit",
  "description": "Claude Code project manager"
}
```
- `path` — Relative to home directory, used as the unique identifier
- `name` — Optional, defaults to folder name if not set (editable in Settings)
- `description` — Optional, explains what the project is for

**Runtime state (in memory, not persisted):**
```json
{
  "activeSessions": {
    "Documents/projects/cockpit": {
      "sessionId": "iTerm2-session-id"
    }
  }
}
```
- Tracks iTerm2 sessions by project path
- Cleared when session closes or app restarts

**Storage location:**
- Electron's `userData` folder (e.g., `~/Library/Application Support/Cockpit/`)
- Single `projects.json` file containing the project list

---

## Menubar UI

**Menubar icon:**
- Simple icon in the system tray
- Clicking opens a dropdown panel

**Dropdown layout (Phase 1):**
```
┌─────────────────────────────┐
│ Search...                   │
├─────────────────────────────┤
│ ● cockpit                   │
│   Claude Code project mgr   │
│                             │
│   my-api                    │
│   REST API for mobile app   │
│                             │
│   blog                      │
│   Personal site             │
├─────────────────────────────┤
│ + Add Project    ⚙ Settings │
└─────────────────────────────┘
```

- `●` indicator shows projects with active sessions
- Click project → focus existing session or open new one
- Cmd+click → force new session
- Search box filters the list as you type
- Footer has Add Project and Settings

**Dropdown layout (Phase 2 — future):**
- Active sessions section at top with live terminal previews
- Project list below

---

## Add Project Flow

1. Click "+ Add Project" in footer
2. Native macOS folder picker opens
3. Select a folder
4. Project added with:
   - `path` set to selected folder (relative to ~)
   - `name` defaults to folder name
   - `description` empty
5. Optionally edit name/description in Settings afterward

---

## Settings

**Per-project settings (accessed via right-click or edit button):**
- Edit display name
- Edit description
- Remove project from Cockpit

**Global settings:**
- (None for Phase 1 — iTerm2 is the hardcoded terminal)

---

## Technical Architecture

**Tech stack:**
- Electron (desktop app framework)
- React (UI)
- iTerm2 via AppleScript (terminal integration)

**Electron structure:**
```
src/
  main/           # Main process
    index.ts      # App entry, tray setup
    iterm.ts      # iTerm2 AppleScript integration
    store.ts      # Project data persistence
  renderer/       # UI (menubar dropdown)
    App.tsx       # React root
    ProjectList.tsx
    AddProject.tsx
    Settings.tsx
  preload.ts      # IPC bridge
```

**Key flows:**

### Opening a session
```applescript
tell application "iTerm2"
  create window with default profile command "cd ~/Documents/projects/cockpit && claude"
  set sessionId to id of current session of current window
end tell
```
- Store returned `sessionId` mapped to project path

### Focusing existing session
```applescript
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if id of s is "session-id-here" then
          select s
          activate
        end if
      end repeat
    end repeat
  end repeat
end tell
```

### Detecting session closure
- Query iTerm2 for session existence before focusing
- If session gone, clear from memory and offer to open new one

**Dependencies:**
- `electron` — App framework
- `electron-store` — Persist projects.json to userData
- React — UI rendering
- AppleScript (via `osascript`) — iTerm2 control
