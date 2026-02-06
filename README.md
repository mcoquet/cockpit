# Cockpit

Stop juggling terminal windows. Cockpit lives in your menubar and gives you one-click access to all your Claude Code projects.

```bash
brew tap mcoquet/cockpit && brew install --cask cockpit
```

## How it works

Click the **λ** in your menubar to see your projects. Select one and a terminal opens with Claude ready to go.

That's it. No `cd`-ing around. No hunting for the right terminal tab.

**Adding projects:** Click "+ Add Project" and pick a folder. Cockpit remembers it.

**Multiple sessions:** Already have a project open? Clicking it again focuses that window. Want a fresh session anyway? **Cmd+click**.

**Finding windows:** **Cmd+`** cycles through your Cockpit terminals from anywhere, even when you're in another app.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Cmd+`** | Cycle through terminal windows (global) |
| **Cmd+N** | Open project list (when Cockpit is active) |
| **↑/↓** | Navigate projects |
| **Enter** | Open selected project |
| **Escape** | Close popup |
| **Type** | Filter projects |

In the terminal, **Enter** submits to Claude. **Alt+Enter** inserts a newline.

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
