# Cockpit

Cockpit is a macOS menubar app for launching and keeping track of Claude Code work across
local projects. Claude Code's own terms (permission mode names, `--continue`, `--resume`,
the CLI itself) mean what Claude Code says they mean; this glossary covers only what
Cockpit adds or narrows.

## Projects

**Project**:
A local folder that Cockpit keeps in its list so Claude Code can be launched in it. Its
identity is its location: relative to the user's home folder for folders inside it,
otherwise absolute.
_Avoid_: repo, workspace, folder (for the concept)

**Popup**:
The small window opened from the menubar icon (λ) that lists projects, their conversation
history, and the actions to add or create a project.
_Avoid_: dropdown, launcher, tray menu

**Create location**:
The folder in which "Create new project" makes a new project folder.
_Avoid_: projects folder, default location

## Terminal sessions and conversations

**Terminal session**:
One running Claude Code process started by Cockpit for a project, shown in its own
terminal window. It ends when Claude Code exits or the window closes.
_Avoid_: session (on its own), PTY, tab

**Active project**:
A project with at least one running terminal session. The popup marks it, and the menubar
icon shows a bullet (●) while any project is active. Cockpit tracks every running terminal
session of a project, not only the newest.
_Avoid_: active session, current session, open session

**Conversation**:
A Claude Code conversation recorded for a project. A terminal session either starts a new
conversation, continues the most recent one, or resumes a chosen one.
_Avoid_: session (on its own), chat, transcript, history entry

**Conversation history**:
The past conversations of a project, newest first, as listed in the popup.
_Avoid_: session history, sessions

**Summary**:
A short description of a conversation (at most 100 characters) that Cockpit generates
when the terminal session for it ends. The history shows it in place of the conversation's
first message.
_Avoid_: title, label

**Restore set**:
The projects that had running terminal sessions the last time Cockpit quit with any running,
or restarted for an upgrade, kept so they can be reopened together once. Each project is listed once, however many
terminal sessions it had.
_Avoid_: previous session, last session, workspace

**Upgrade restart**:
Cockpit restarting itself after its installed app has been replaced by a newer version,
reopening the restore set automatically.
_Avoid_: auto-update (Cockpit does not download updates itself)

**Permission mode**:
The Claude Code permission mode a terminal session starts in. A project may have a default
permission mode; Option+click on a project picks one for a single launch only.
_Avoid_: permissions (on its own), access level

**Bell notification**:
The macOS notification Cockpit shows when a terminal session that is not in front asks
for attention (rings the terminal bell).
_Avoid_: alert, ping

**External terminal**:
The user's own terminal app (Terminal, iTerm, Warp, Kitty or another app they pick), which
Cockpit can open in a project's folder alongside a terminal session.
_Avoid_: system terminal, shell

## Environment

**Global environment variables**:
Name–value pairs, set in Settings, that every Claude Code process Cockpit starts receives.
_Avoid_: env, secrets, global env

**Project environment variables**:
Name–value pairs set on one project, given to Claude Code processes started for that
project. Where a name is in both, the project's value wins.
_Avoid_: project env, overrides

**macOS privacy access**:
Calendar, Reminders and Automation access that the user grants to Cockpit, so that tools
running inside terminal sessions can use those apps.
_Avoid_: permissions (on its own), entitlements

## Scheduling

**Schedule**:
A recurring task for one project: when to run (a cron expression), the prompt to give
Claude Code, a run mode and a queue behaviour. Schedules run only while Cockpit is running.
_Avoid_: job, cron, task (for the schedule itself)

**Schedule run**:
One execution of a schedule, whether triggered by its timing or by "Run Now".
_Avoid_: job run, execution, task

**Run mode**:
How a schedule run happens. **Interactive**: Cockpit opens a new terminal session for the
project and types the prompt into it. **Headless**: Claude Code runs in the background and
its output is kept with the schedule run.
_Avoid_: type, kind

**Queue behaviour**:
What a schedule does when it comes due while its previous run is still going: **skip**
the new run, **queue** it until the previous one ends, or run both in **parallel**.
_Avoid_: concurrency, overlap policy

**Catch-up**:
A schedule setting meant to run occurrences that were missed while Cockpit was not
running.
_Avoid_: backfill, missed runs

## Status

**Status window**:
The window (Shift+Cmd+click on the menubar icon) showing Anthropic's service status and
the user's Claude Code usage stats.
_Avoid_: dashboard, stats window

**Usage stats**:
Counts of messages, Claude Code sessions and tool calls over the last 7 and the last 30
days, read from Claude Code's own local statistics.
_Avoid_: analytics, metrics
