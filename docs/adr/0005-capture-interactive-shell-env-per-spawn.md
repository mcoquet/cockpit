# Give every claude process the user's interactive shell environment

_Recorded retroactively on 2026-11-25. Evidence: commits c3d7e01 and 3a062ac (#45), and the comments in `src/main/env.ts`._

An app launched from Finder or the Dock does not inherit the user's shell environment, so Claude Code and its hooks could not find tools such as per-project Node versions. Before starting each Claude Code process, Cockpit runs the user's shell as a login, interactive shell (`$SHELL -ilc`) in the project folder and copies its environment, so the process sees what a new terminal tab would. It does this fresh every time, so `.zshrc` edits and per-folder tool versions apply without restarting Cockpit. This costs up to five seconds per launch (then it falls back to the login shell's `PATH`), and it runs the user's rc files on every launch.
